#!/usr/bin/env python3
"""Inventory an AWS account: EC2, EBS, RDS, Lambda and load balancers per region, plus S3 buckets.

For audits, cost reviews and "what is running in this account?". It only
reads. Text for people, --json for a spreadsheet or dashboard.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "ec2:DescribeRegions", "ec2:DescribeInstances", "ec2:DescribeVolumes", "rds:DescribeDBInstances",
    "lambda:ListFunctions", "elasticloadbalancing:DescribeLoadBalancers", "s3:ListAllMyBuckets"]}]}

Usage:
  aws_inventory.py --region eu-west-1
  aws_inventory.py --all-regions --profile audit --json > inventory.json

Exit: 0 ok, 2 credential, region or permission error (1 when some regions failed).
"""
import sys

import awskit


def region_inventory(sess, region):
    ec2 = awskit.client(sess, "ec2", region)
    instances = [{"id": i["InstanceId"], "name": awskit.tags(i).get("Name", ""), "type": i["InstanceType"], "state": i["State"]["Name"],
                  "launched": i["LaunchTime"]} for i in awskit.items(ec2, "describe_instances", "Reservations[].Instances[]")]
    volumes = list(awskit.items(ec2, "describe_volumes", "Volumes[]"))
    rds = awskit.client(sess, "rds", region)
    databases = [{"id": d["DBInstanceIdentifier"], "engine": d["Engine"], "class": d["DBInstanceClass"], "status": d["DBInstanceStatus"]}
                 for d in awskit.items(rds, "describe_db_instances", "DBInstances[]")]
    functions = [f["FunctionName"] for f in awskit.items(awskit.client(sess, "lambda", region), "list_functions", "Functions[]")]
    elb = awskit.client(sess, "elbv2", region)
    balancers = [{"name": b["LoadBalancerName"], "type": b["Type"], "scheme": b["Scheme"]} for b in awskit.items(elb, "describe_load_balancers", "LoadBalancers[]")]
    return {"instances": instances, "volumes": len(volumes), "volume_gib": sum(v["Size"] for v in volumes),
            "databases": databases, "functions": functions, "load_balancers": balancers}


def main(argv=None):
    args = awskit.parser(__doc__).parse_args(argv)
    sess = awskit.session(args)
    found, failed = awskit.per_region(sess, args, lambda r: region_inventory(sess, r))
    buckets = list(awskit.items(awskit.client(sess, "s3", next(iter(found), None)), "list_buckets", "Buckets[].Name"))

    if args.json:
        awskit.show_json({"regions": found, "s3_buckets": buckets})
    else:
        for region, inv in found.items():
            running = sum(i["state"] == "running" for i in inv["instances"])
            print(f"{region}: {len(inv['instances'])} instances ({running} running), {inv['volumes']} volumes ({inv['volume_gib']} GiB), "
                  f"{len(inv['databases'])} databases, {len(inv['functions'])} functions, {len(inv['load_balancers'])} load balancers")
            for i in inv["instances"]:
                print(f"  {i['id']:<20} {i['state']:<10} {i['type']:<12} {i['name']}")
            for d in inv["databases"]:
                print(f"  {d['id']:<20} {d['status']:<10} {d['class']:<12} {d['engine']}")
        print(f"S3: {len(buckets)} buckets")
    return awskit.FOUND if failed else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
