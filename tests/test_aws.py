"""Tests for scripts/aws/. No network and no AWS account: every call is answered by botocore's Stubber.

Needs boto3 (pip install --require-hashes -r requirements-aws.txt); skipped without it.
Run with: python3 -m unittest discover -s tests
"""
import contextlib
import datetime as dt
import io
import os
import pathlib
import sys
import unittest
from unittest import mock

try:
    import boto3
    from botocore.exceptions import ClientError, NoCredentialsError, NoRegionError, WaiterError
    from botocore.stub import Stubber
except ImportError:
    boto3 = None

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts" / "aws"))

NOW = dt.datetime.now(dt.timezone.utc)
OLD = NOW - dt.timedelta(days=400)
ACCOUNT = "111122223333"  # the example account id from AWS's documentation


def error(code, message="x", op="Op"):
    return ClientError({"Error": {"Code": code, "Message": message}}, op)


@unittest.skipUnless(boto3, "boto3 is not installed: pip install --require-hashes -r requirements-aws.txt")
class AwsCase(unittest.TestCase):
    """Patches awskit so every client is a stubbed one, keyed by (service, region)."""

    def setUp(self):
        import awskit
        self.awskit = awskit
        # Dummy credentials, so botocore never looks for real ones; the Stubber answers before anything is sent.
        env = {"AWS_ACCESS_KEY_ID": "testing", "AWS_CONFIG_FILE": os.devnull, "AWS_SHARED_CREDENTIALS_FILE": os.devnull, "AWS_EC2_METADATA_DISABLED": "true"}
        env["AWS_SECRET_ACCESS_KEY"] = env["AWS_ACCESS_KEY_ID"]
        self.sess = boto3.Session(region_name="eu-west-1")
        self.stubs = {}
        for p in (mock.patch.dict(os.environ, env), mock.patch.object(awskit, "session", lambda args: self.sess),
                  mock.patch.object(awskit, "client", lambda s, service, region=None: self.stub(service, region)[0])):
            p.start()
            self.addCleanup(p.stop)

    def stub(self, service, region="eu-west-1"):
        key = (service, region)
        if key not in self.stubs:
            c = self.sess.client(service, region_name=region or "us-east-1")
            st = Stubber(c)
            st.activate()
            self.stubs[key] = (c, st)
        return self.stubs[key]

    def add(self, service, op, resp, params=None, region="eu-west-1"):
        self.stub(service, region)[1].add_response(op, resp, params)

    def refuse(self, service, op, code, region="eu-west-1", message="denied"):
        self.stub(service, region)[1].add_client_error(op, code, message)

    def run_main(self, main, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = self.awskit.run(lambda: main(list(args)))
        for _, st in self.stubs.values():
            st.assert_no_pending_responses()
        return code, out.getvalue(), err.getvalue()


def instance(iid, state="running", tags=None, **extra):
    return {"InstanceId": iid, "InstanceType": "t3.micro", "State": {"Name": state, "Code": 16}, "LaunchTime": OLD,
            "Tags": [{"Key": k, "Value": v} for k, v in (tags or {}).items()], **extra}


class Kit(AwsCase):
    def test_explain_gives_a_next_step(self):
        explain = self.awskit.explain
        self.assertIn("--profile", explain(NoCredentialsError()))
        self.assertIn("--region", explain(NoRegionError()))
        self.assertIn("aws sso login", explain(error("ExpiredToken")))
        self.assertIn("get-caller-identity", explain(error("SignatureDoesNotMatch")))
        self.assertIn("policy is in the script's header", explain(error("UnauthorizedOperation", op="StopInstances")))
        self.assertIn("rate-limiting", explain(error("Throttling")))

    def test_run_turns_errors_into_exit_2(self):
        def boom():
            raise NoCredentialsError()
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(self.awskit.run(boom), 2)
        self.assertIn("no AWS credentials found", err.getvalue())

    def test_regions(self):
        args = mock.Mock(all_regions=False, region=None)
        self.sess = boto3.Session(region_name=None)
        with self.assertRaises(NoRegionError):
            self.awskit.regions(self.sess, args)
        self.sess = boto3.Session(region_name="eu-west-1")
        self.add("ec2", "describe_regions", {"Regions": [{"RegionName": "us-east-1"}, {"RegionName": "ap-south-1"}]},
                 {"Filters": [{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}]})
        self.assertEqual(self.awskit.regions(self.sess, mock.Mock(all_regions=True, region=None)), ["ap-south-1", "us-east-1"])

    def test_paginates_to_the_end(self):
        ec2 = self.stub("ec2")[0]
        self.add("ec2", "describe_volumes", {"Volumes": [{"VolumeId": "vol-1"}], "NextToken": "p2"})
        self.add("ec2", "describe_volumes", {"Volumes": [{"VolumeId": "vol-2"}]}, {"NextToken": "p2"})
        self.assertEqual([v["VolumeId"] for v in self.awskit.items(ec2, "describe_volumes", "Volumes[]")], ["vol-1", "vol-2"])

    def test_one_region_failing_does_not_stop_the_rest(self):
        args = mock.Mock(all_regions=True, region=None)
        self.add("ec2", "describe_regions", {"Regions": [{"RegionName": "ap-south-1"}, {"RegionName": "eu-west-1"}]})

        def fn(region):
            if region == "ap-south-1":
                raise error("UnauthorizedOperation")
            return "ok"
        with contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(self.awskit.per_region(self.sess, args, fn), ({"eu-west-1": "ok"}, 1))
        self.assertIn("ap-south-1", err.getvalue())
        with self.assertRaises(ClientError):  # expired credentials would fail everywhere: stop at once
            self.add("ec2", "describe_regions", {"Regions": [{"RegionName": "ap-south-1"}, {"RegionName": "eu-west-1"}]})
            self.awskit.per_region(self.sess, args, lambda r: (_ for _ in ()).throw(error("ExpiredToken")))


class Inventory(AwsCase):
    def test_counts_across_pages(self):
        import aws_inventory
        self.add("ec2", "describe_instances", {"Reservations": [{"Instances": [instance("i-1", tags={"Name": "web"})]}], "NextToken": "n"})
        self.add("ec2", "describe_instances", {"Reservations": [{"Instances": [instance("i-2", "stopped")]}]})
        self.add("ec2", "describe_volumes", {"Volumes": [{"VolumeId": "vol-1", "Size": 20}, {"VolumeId": "vol-2", "Size": 100}]})
        self.add("rds", "describe_db_instances", {"DBInstances": [{"DBInstanceIdentifier": "shop", "Engine": "postgres", "DBInstanceClass": "db.t4g.micro", "DBInstanceStatus": "available"}]})
        self.add("lambda", "list_functions", {"Functions": [{"FunctionName": "resize"}]})
        self.add("elbv2", "describe_load_balancers", {"LoadBalancers": []})
        self.add("s3", "list_buckets", {"Buckets": [{"Name": "logs"}]}, region="eu-west-1")
        code, out, _ = self.run_main(aws_inventory.main, "--region", "eu-west-1")
        self.assertEqual(code, 0)
        self.assertIn("eu-west-1: 2 instances (1 running), 2 volumes (120 GiB), 1 databases, 1 functions, 0 load balancers", out)
        self.assertIn("S3: 1 buckets", out)

    def test_no_credentials_exit_2(self):
        import aws_inventory
        with mock.patch.object(self.awskit, "regions", side_effect=NoCredentialsError()):
            code, _, err = self.run_main(aws_inventory.main, "--region", "eu-west-1")
        self.assertEqual(code, 2)
        self.assertIn("no AWS credentials found", err)


class Scheduler(AwsCase):
    def describe(self):
        self.add("ec2", "describe_instances", {"Reservations": [{"Instances": [
            instance("i-dev"), instance("i-asg", tags={"aws:autoscaling:groupName": "web"})]}]},
            {"Filters": [{"Name": "tag:Schedule", "Values": ["office-hours"]}, {"Name": "instance-state-name", "Values": ["running"]}]})

    def test_dry_run_asks_ec2_and_changes_nothing(self):
        import ec2_scheduler
        self.describe()
        self.stub("ec2")[1].add_client_error("stop_instances", "DryRunOperation", "Request would have succeeded, but DryRun flag is set.",
                                             expected_params={"InstanceIds": ["i-dev"], "DryRun": True})
        code, out, _ = self.run_main(ec2_scheduler.main, "stop", "--tag", "Schedule=office-hours", "--region", "eu-west-1")
        self.assertEqual(code, 0)
        self.assertIn("i-dev  would stop", out)
        self.assertIn("i-asg  skipped (in an Auto Scaling group)", out)
        self.assertIn("run again with --apply", out)

    def test_missing_permission_fails_the_dry_run(self):
        import ec2_scheduler
        self.describe()
        self.refuse("ec2", "stop_instances", "UnauthorizedOperation", message="You are not authorized to perform this operation.")
        code, out, _ = self.run_main(ec2_scheduler.main, "stop", "--tag", "Schedule=office-hours", "--region", "eu-west-1")
        self.assertEqual(code, 1)
        self.assertIn("FAILED: UnauthorizedOperation", out)

    def test_apply_and_wait(self):
        import ec2_scheduler
        self.describe()
        self.add("ec2", "stop_instances", {"StoppingInstances": [{"InstanceId": "i-dev"}]}, {"InstanceIds": ["i-dev"]})
        with mock.patch("botocore.waiter.Waiter.wait", side_effect=WaiterError("InstanceStopped", "Max attempts exceeded", {})):
            code, out, _ = self.run_main(ec2_scheduler.main, "stop", "--tag", "Schedule=office-hours", "--region", "eu-west-1", "--apply", "--wait")
        self.assertEqual(code, 1, "a waiter timeout is reported, not hidden")
        self.assertIn("Waiter InstanceStopped failed: Max attempts exceeded", out)

    def test_bad_tag_is_a_usage_error(self):
        import ec2_scheduler
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as e:
            ec2_scheduler.main(["stop", "--tag", "office-hours"])
        self.assertEqual(e.exception.code, 2)


class Unused(AwsCase):
    def test_finds_and_prices(self):
        import unused_resources
        self.add("ec2", "describe_volumes", {"Volumes": [{"VolumeId": "vol-1", "Size": 100, "VolumeType": "gp3"}]})
        self.add("ec2", "describe_addresses", {"Addresses": [{"PublicIp": "203.0.113.10", "AllocationId": "eipalloc-1"},
                                                             {"PublicIp": "203.0.113.11", "AllocationId": "eipalloc-2", "AssociationId": "eipassoc-1"}]})
        self.add("ec2", "describe_snapshots", {"Snapshots": [{"SnapshotId": "snap-old", "VolumeSize": 50, "StartTime": OLD},
                                                             {"SnapshotId": "snap-new", "VolumeSize": 50, "StartTime": NOW}]})
        self.add("elbv2", "describe_load_balancers", {"LoadBalancers": [{"LoadBalancerArn": "arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/old/1",
                                                                         "LoadBalancerName": "old", "Type": "application"}]})
        self.add("elbv2", "describe_target_groups", {"TargetGroups": [{"TargetGroupArn": "arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/old/1"}]})
        self.add("elbv2", "describe_target_health", {"TargetHealthDescriptions": []})
        self.add("elb", "describe_load_balancers", {"LoadBalancerDescriptions": []})
        code, out, _ = self.run_main(unused_resources.main, "--region", "eu-west-1")
        self.assertEqual(code, 1)
        self.assertIn("vol-1", out)
        self.assertIn("eipalloc-1", out)
        self.assertNotIn("eipalloc-2", out)
        self.assertIn("snap-old", out)
        self.assertNotIn("snap-new", out)
        self.assertIn("Load balancer, no targets", out)
        self.assertIn("4 unused resource(s), about $30.58 a month", out)  # 8.00 + 3.65 + 2.50 + 16.43


class Snapshots(AwsCase):
    def test_keeps_ami_snapshots_and_dry_runs_the_rest(self):
        import ebs_snapshot_cleanup
        self.add("ec2", "describe_images", {"Images": [{"ImageId": "ami-1", "BlockDeviceMappings": [{"DeviceName": "/dev/xvda", "Ebs": {"SnapshotId": "snap-ami"}}]}]},
                 {"Owners": ["self"], "IncludeDeprecated": True, "IncludeDisabled": True})
        self.add("ec2", "describe_snapshots", {"Snapshots": [
            {"SnapshotId": "snap-ami", "VolumeSize": 8, "StartTime": OLD},
            {"SnapshotId": "snap-keep", "VolumeSize": 8, "StartTime": OLD, "Tags": [{"Key": "Keep", "Value": "audit"}]},
            {"SnapshotId": "snap-old", "VolumeSize": 8, "StartTime": OLD, "VolumeId": "vol-1"},
            {"SnapshotId": "snap-new", "VolumeSize": 8, "StartTime": NOW}]})
        self.stub("ec2")[1].add_client_error("delete_snapshot", "DryRunOperation", "Request would have succeeded, but DryRun flag is set.",
                                             expected_params={"SnapshotId": "snap-old", "DryRun": True})
        code, out, _ = self.run_main(ebs_snapshot_cleanup.main, "--days", "90", "--region", "eu-west-1")
        self.assertEqual(code, 0)
        self.assertIn("snap-old", out)
        self.assertIn("would delete", out)
        self.assertIn("snap-ami  kept (used by ami-1)", out)
        self.assertIn("snap-keep  kept (tagged Keep)", out)
        self.assertNotIn("snap-new", out)


class S3Audit(AwsCase):
    def test_public_and_unencrypted_bucket(self):
        import s3_security_audit
        self.add("s3", "list_buckets", {"Buckets": [{"Name": "site", "BucketRegion": "eu-west-1"}]}, region=None)
        s3 = "s3"
        self.refuse(s3, "get_public_access_block", "NoSuchPublicAccessBlockConfiguration")
        self.add(s3, "get_bucket_policy_status", {"PolicyStatus": {"IsPublic": True}})
        self.add(s3, "get_bucket_acl", {"Grants": [{"Grantee": {"Type": "Group", "URI": "http://acs.amazonaws.com/groups/global/AllUsers"}, "Permission": "READ"}]})
        self.refuse(s3, "get_bucket_encryption", "ServerSideEncryptionConfigurationNotFoundError")
        self.add(s3, "get_bucket_versioning", {})
        self.add(s3, "get_bucket_policy", {"Policy": '{"Statement": [{"Effect": "Allow", "Principal": "*", "Action": "s3:GetObject", "Resource": "*"}]}'})
        self.add(s3, "get_bucket_ownership_controls", {"OwnershipControls": {"Rules": [{"ObjectOwnership": "BucketOwnerEnforced"}]}})
        self.add(s3, "get_bucket_logging", {})
        self.add("sts", "get_caller_identity", {"Account": ACCOUNT}, region=None)
        self.add("s3control", "get_public_access_block", {"PublicAccessBlockConfiguration": dict.fromkeys(s3_security_audit.BPA_KEYS, True)})
        code, out, _ = self.run_main(s3_security_audit.main)
        self.assertEqual(code, 1)
        for text in ("Block Public Access is off", "PUBLIC: the bucket policy", "PUBLIC: the ACL", "no default encryption", "versioning is off", "deny plain HTTP", "logging is off"):
            self.assertIn(text, out)
        self.assertNotIn("ACLs are still enabled", out)

    def test_unreadable_bucket_is_reported_not_fatal(self):
        import s3_security_audit
        self.add("s3", "list_buckets", {"Buckets": [{"Name": "locked", "BucketRegion": "eu-west-1"}]}, region=None)
        self.refuse("s3", "get_public_access_block", "AccessDenied")
        self.add("sts", "get_caller_identity", {"Account": ACCOUNT}, region=None)
        self.add("s3control", "get_public_access_block", {"PublicAccessBlockConfiguration": dict.fromkeys(s3_security_audit.BPA_KEYS, True)})
        code, out, _ = self.run_main(s3_security_audit.main)
        self.assertEqual(code, 1)
        self.assertIn("could not audit: AccessDenied", out)


class Iam(AwsCase):
    HEAD = ("user,arn,user_creation_time,password_enabled,password_last_used,password_last_changed,password_next_rotation,mfa_active,"
            "access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_1_last_used_region,access_key_1_last_used_service,"
            "access_key_2_active,access_key_2_last_rotated,access_key_2_last_used_date,access_key_2_last_used_region,access_key_2_last_used_service,"
            "cert_1_active,cert_1_last_rotated,cert_2_active,cert_2_last_rotated")

    def report(self):
        old, recent = OLD.isoformat(), (NOW - dt.timedelta(days=3)).isoformat()
        rows = [f"<root_account>,arn:aws:iam::{ACCOUNT}:root,{old},not_supported,{recent},not_supported,not_supported,false,true,{old},{recent},us-east-1,s3,false,N/A,N/A,N/A,N/A,false,N/A,false,N/A",
                f"ci,arn:aws:iam::{ACCOUNT}:user/ci,{old},false,N/A,N/A,N/A,false,true,{old},N/A,N/A,N/A,false,N/A,N/A,N/A,N/A,false,N/A,false,N/A",
                f"asha,arn:aws:iam::{ACCOUNT}:user/asha,{old},true,{recent},{old},N/A,true,false,N/A,N/A,N/A,N/A,false,N/A,N/A,N/A,N/A,false,N/A,false,N/A"]
        return "\n".join([self.HEAD, *rows]).encode()

    def test_waits_for_the_report_and_flags(self):
        import iam_access_audit
        self.add("iam", "generate_credential_report", {"State": "STARTED"}, region=None)
        self.add("iam", "generate_credential_report", {"State": "COMPLETE"}, region=None)
        self.add("iam", "get_credential_report", {"Content": self.report(), "ReportFormat": "text/csv"}, region=None)
        with mock.patch("time.sleep"):
            code, out, _ = self.run_main(iam_access_audit.main)
        self.assertEqual(code, 1)
        for text in ("root has an active access key 1", "root has no MFA", "root signed in 3 day(s) ago", "access key 1 is 400 days old", "access key 1 was never used"):
            self.assertIn(text, out)
        self.assertNotIn("asha", out, "a user with MFA and a recently used password is fine")
        self.assertIn("3 identities checked, 5 finding(s)", out)


class SecurityGroups(AwsCase):
    def test_open_rules(self):
        import sg_exposure_audit
        self.add("ec2", "describe_network_interfaces", {"NetworkInterfaces": [{"Groups": [{"GroupId": "sg-db"}]}]})
        self.add("ec2", "describe_security_groups", {"SecurityGroups": [
            {"GroupId": "sg-db", "GroupName": "db", "IpPermissions": [{"IpProtocol": "tcp", "FromPort": 5432, "ToPort": 5432, "IpRanges": [{"CidrIp": "0.0.0.0/0"}]}]},
            {"GroupId": "sg-web", "GroupName": "web", "IpPermissions": [{"IpProtocol": "tcp", "FromPort": 443, "ToPort": 443, "IpRanges": [{"CidrIp": "0.0.0.0/0"}]},
                                                                         {"IpProtocol": "-1", "Ipv6Ranges": [{"CidrIpv6": "::/0"}]}]},
            {"GroupId": "sg-vpn", "GroupName": "vpn", "IpPermissions": [{"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": "10.0.0.0/8"}]}]}]})
        code, out, _ = self.run_main(sg_exposure_audit.main, "--region", "eu-west-1")
        self.assertEqual(code, 1)
        self.assertRegex(out, r"HIGH .*sg-db .*tcp/5432 \(PostgreSQL\) .*1 interface")
        self.assertRegex(out, r"HIGH .*sg-web .*all traffic .*::/0 .*unused")
        self.assertNotIn("tcp/443", out)
        self.assertNotIn("sg-vpn", out)


class Tags(AwsCase):
    def test_missing_and_bad_values(self):
        import tag_compliance
        self.add("sts", "get_caller_identity", {"Account": ACCOUNT}, region=None)
        self.add("resourcegroupstaggingapi", "get_resources", {"ResourceTagMappingList": [
            {"ResourceARN": "arn:aws:s3:::logs", "Tags": [{"Key": "Owner", "Value": "sre"}, {"Key": "Environment", "Value": "production"}]}]})
        self.add("ec2", "describe_instances", {"Reservations": [{"Instances": [instance("i-1")]}]})
        self.add("ec2", "describe_volumes", {"Volumes": []})
        code, out, _ = self.run_main(tag_compliance.main, "--require", "Owner", "--require", "Environment=prod|staging", "--region", "eu-west-1")
        self.assertEqual(code, 1)
        self.assertIn("Environment='production' is not one of prod|staging", out)
        self.assertIn(f"arn:aws:ec2:eu-west-1:{ACCOUNT}:instance/i-1\n  missing Owner; missing Environment", out)


class Params(AwsCase):
    def test_audit_and_require_without_reading_values(self):
        import ssm_params
        self.add("ssm", "describe_parameters", {"Parameters": [{"Name": "/shop/prod/DB_PASSWORD", "Type": "String"}, {"Name": "/shop/prod/API_TOKEN", "Type": "SecureString"}]})
        self.add("secretsmanager", "list_secrets", {"SecretList": [{"Name": "shop/prod/stripe", "RotationEnabled": False, "LastAccessedDate": OLD}]})
        code, out, _ = self.run_main(ssm_params.main, "--region", "eu-west-1", "--require", "/shop/prod/API_TOKEN", "--require", "/shop/prod/SENTRY_DSN")
        self.assertEqual(code, 1)
        self.assertIn("MISSING  /shop/prod/SENTRY_DSN", out)
        self.assertNotIn("MISSING  /shop/prod/API_TOKEN", out)
        self.assertIn("/shop/prod/DB_PASSWORD: looks like a secret but is a plain String", out)
        self.assertIn("shop/prod/stripe: rotation is off", out)
        self.assertIn("not read for 400 days", out)
        # Only describe and list calls were stubbed: a get_parameter or get_secret_value call would have failed the test.


class Alarms(AwsCase):
    def test_alarms_that_wake_nobody(self):
        import cloudwatch_alarm_audit
        topic = f"arn:aws:sns:eu-west-1:{ACCOUNT}:"
        base = {"StateValue": "OK", "StateUpdatedTimestamp": NOW, "ActionsEnabled": True}
        self.add("cloudwatch", "describe_alarms", {"MetricAlarms": [
            {**base, "AlarmName": "cpu-high", "AlarmActions": []},
            {**base, "AlarmName": "disk-full", "AlarmActions": [topic + "deleted-topic"]},
            {**base, "AlarmName": "old-box", "AlarmActions": [topic + "oncall"], "Dimensions": [{"Name": "InstanceId", "Value": "i-gone"}],
             "StateValue": "INSUFFICIENT_DATA", "StateUpdatedTimestamp": OLD},
            {**base, "AlarmName": "feeds-composite", "AlarmActions": []}]})
        self.add("cloudwatch", "describe_alarms", {"CompositeAlarms": [{**base, "AlarmName": "site-down", "AlarmActions": [topic + "oncall"],
                                                                         "AlarmRule": 'ALARM("feeds-composite")'}]})
        self.add("sns", "list_topics", {"Topics": [{"TopicArn": topic + "oncall"}]})
        self.add("ec2", "describe_instances", {"Reservations": []})
        code, out, _ = self.run_main(cloudwatch_alarm_audit.main, "--region", "eu-west-1")
        self.assertEqual(code, 1)
        self.assertIn("cpu-high: no alarm action", out)
        self.assertIn("disk-full: notifies an SNS topic that does not exist: deleted-topic", out)
        self.assertIn("old-box: INSUFFICIENT_DATA for 400 day(s)", out)
        self.assertIn("old-box: watches i-gone, which no longer exists", out)
        self.assertNotIn("feeds-composite", out)
        self.assertNotIn("site-down", out)


class PersonalDataStorage(AwsCase):
    def test_flags_unencrypted_public_and_out_of_region(self):
        import pii_storage_audit
        tag = [{"Key": "DataClassification", "Value": "personal"}]
        self.add("rds", "describe_db_instances", {"DBInstances": [
            {"DBInstanceArn": f"arn:aws:rds:eu-west-1:{ACCOUNT}:db:customers", "StorageEncrypted": False, "PubliclyAccessible": True, "TagList": tag},
            {"DBInstanceArn": f"arn:aws:rds:eu-west-1:{ACCOUNT}:db:metrics", "StorageEncrypted": False, "PubliclyAccessible": False, "TagList": []}]})
        self.add("rds", "describe_db_clusters", {"DBClusters": []})
        self.add("ec2", "describe_volumes", {"Volumes": [{"VolumeId": "vol-1", "Encrypted": True}]},
                 {"Filters": [{"Name": "tag:DataClassification", "Values": ["personal"]}]})
        self.add("s3", "list_buckets", {"Buckets": [{"Name": "kyc-docs", "BucketRegion": "ap-south-1"}, {"Name": "assets", "BucketRegion": "ap-south-1"}]}, region=None)
        self.add("s3", "get_bucket_tagging", {"TagSet": tag}, region="ap-south-1")
        blocked = dict.fromkeys(("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"), True)
        self.add("s3", "get_public_access_block", {"PublicAccessBlockConfiguration": blocked}, region="ap-south-1")
        self.stub("s3", "ap-south-1")[1].add_client_error("get_bucket_policy_status", "NoSuchBucketPolicy")
        self.add("s3", "get_bucket_acl", {"Grants": []}, region="ap-south-1")
        self.add("s3", "get_bucket_encryption", {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms"}}]}}, region="ap-south-1")
        self.stub("s3", "ap-south-1")[1].add_client_error("get_bucket_tagging", "NoSuchTagSet")
        code, out, _ = self.run_main(pii_storage_audit.main, "--region", "eu-west-1", "--expected-regions", "ap-south-1,ap-south-2")
        self.assertEqual(code, 1)
        self.assertIn("db:customers (eu-west-1)\n       - storage not encrypted\n       - publicly accessible\n       - stored in eu-west-1, outside the expected regions", out)
        self.assertNotIn("metrics", out)
        self.assertIn("ok   s3://kyc-docs (ap-south-1)", out)
        self.assertNotIn("assets", out)
        self.assertIn("3 resource(s) tagged DataClassification=personal, 2 need attention", out)


if __name__ == "__main__":
    unittest.main()
