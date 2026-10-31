#!/usr/bin/env python3
"""Stop or start EC2 instances by tag, for example development servers out of office hours.

A dry run by default: it lists the instances and asks EC2 itself (DryRun=True)
whether the call would be allowed, so a missing permission shows up before
the evening it matters. --apply really stops or starts them; --wait waits
until they get there. Instances in an Auto Scaling group are skipped, because
the group would replace a stopped one.

Minimum IAM permissions (the tag condition limits it to scheduled instances):
  {"Version": "2012-10-17", "Statement": [
    {"Effect": "Allow", "Action": ["ec2:DescribeInstances", "ec2:DescribeRegions"], "Resource": "*"},
    {"Effect": "Allow", "Action": ["ec2:StopInstances", "ec2:StartInstances"], "Resource": "arn:aws:ec2:*:*:instance/*",
     "Condition": {"StringEquals": {"aws:ResourceTag/Schedule": "office-hours"}}}]}
  Starting instances whose volumes use a customer managed KMS key also needs kms:CreateGrant on that key.

Usage:
  ec2_scheduler.py stop --tag Schedule=office-hours --region eu-west-1          (dry run)
  ec2_scheduler.py stop --tag Schedule=office-hours --all-regions --apply --wait
  ec2_scheduler.py start --tag Schedule=office-hours --region eu-west-1 --apply

Exit: 0 ok, 1 a stop or start (or its dry run) was refused or failed, 2 usage, credential or region error.
"""
import sys

import awskit
from botocore.exceptions import ClientError, WaiterError

# Which instances each action applies to, and the waiter that confirms it.
ACTIONS = {"stop": ("running", "stop_instances", "instance_stopped"), "start": ("stopped", "start_instances", "instance_running")}


def targets(ec2, key, value, state):
    """(instance ids to act on, [(id, why skipped)])."""
    act, skipped = [], []
    filters = [{"Name": f"tag:{key}", "Values": [value]}, {"Name": "instance-state-name", "Values": [state]}]
    for i in awskit.items(ec2, "describe_instances", "Reservations[].Instances[]", Filters=filters):
        if "aws:autoscaling:groupName" in awskit.tags(i):
            skipped.append((i["InstanceId"], "in an Auto Scaling group"))
        elif i.get("InstanceLifecycle") == "spot":
            skipped.append((i["InstanceId"], "spot instance"))
        else:
            act.append(i["InstanceId"])
    return act, skipped


def schedule(ec2, action, ids, apply, wait):
    """Dry-run or run the action in batches; returns a list of (ids, error or None)."""
    _, call, waiter = ACTIONS[action]
    results = []
    for n in range(0, len(ids), 50):
        batch = ids[n:n + 50]
        try:
            if not apply:
                awskit.dry_run(getattr(ec2, call), InstanceIds=batch)
            else:
                getattr(ec2, call)(InstanceIds=batch)
                if wait:
                    ec2.get_waiter(waiter).wait(InstanceIds=batch, WaiterConfig={"Delay": 15, "MaxAttempts": 40})
            results.append((batch, None))
        except (ClientError, WaiterError) as e:
            results.append((batch, awskit.explain(e)))
    return results


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("action", choices=sorted(ACTIONS))
    ap.add_argument("--tag", required=True, metavar="KEY=VALUE", help="act on instances with this tag")
    ap.add_argument("--apply", action="store_true", help="really stop or start; otherwise a dry run")
    ap.add_argument("--wait", action="store_true", help="with --apply, wait until every instance has stopped or started")
    args = ap.parse_args(argv)
    key, sep, value = args.tag.partition("=")
    if not (key and sep and value):
        ap.error("--tag must look like Schedule=office-hours")
    state = ACTIONS[args.action][0]
    sess = awskit.session(args)

    def one(region):
        ec2 = awskit.client(sess, "ec2", region)
        ids, skipped = targets(ec2, key, value, state)
        return {"skipped": skipped, "results": schedule(ec2, args.action, ids, args.apply, args.wait) if ids else []}

    done, failed = awskit.per_region(sess, args, one)
    errors = failed + sum(1 for r in done.values() for _, err in r["results"] if err)
    if args.json:
        awskit.show_json({"action": args.action, "applied": args.apply, "regions": done})
    else:
        past = {"stop": "stopped", "start": "started"}[args.action]
        verb = past if args.apply else f"would {args.action}"
        total = 0
        for region, r in done.items():
            for ids, err in r["results"]:
                for i in ids:
                    print(f"{region}  {i}  {'FAILED: ' + err if err else verb}")
                total += 0 if err else len(ids)
            for i, why in r["skipped"]:
                print(f"{region}  {i}  skipped ({why})")
        print(f"\n{total} instance(s) {past if args.apply else 'would be ' + past}." + ("" if args.apply or not total else " The dry run passed; run again with --apply."))
    return awskit.FOUND if errors else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
