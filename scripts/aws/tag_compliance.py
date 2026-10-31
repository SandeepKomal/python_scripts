#!/usr/bin/env python3
"""Report AWS resources that are missing required tags, or have a value outside the allowed list.

Rules are KEY or KEY=v1|v2|v3, for example Owner and Environment=prod|staging|dev.
The Resource Groups Tagging API lists every resource that has (or once had)
tags; EC2 instances and EBS volumes that were never tagged are not in it,
so those two are also read from EC2 directly.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "sts:GetCallerIdentity", "ec2:DescribeRegions", "tag:GetResources", "ec2:DescribeInstances", "ec2:DescribeVolumes"]}]}

Usage:
  tag_compliance.py --require Owner --require CostCenter --require 'Environment=prod|staging|dev' --region eu-west-1
  tag_compliance.py --require Owner --all-regions --type ec2:instance --type rds:db --json

Exit: 0 all compliant, 1 resources out of policy (or a region failed), 2 usage, credential or permission error.
"""
import sys

import awskit


def rules_of(specs):
    """{key: allowed values or None} from KEY / KEY=a|b specs."""
    rules = {}
    for spec in specs:
        key, _, values = spec.partition("=")
        rules[key.strip()] = {v.strip() for v in values.split("|") if v.strip()} or None
    return rules


def problems(tags, rules):
    out = []
    for key, allowed in rules.items():
        if key not in tags:
            out.append(f"missing {key}")
        elif allowed and tags[key] not in allowed:
            out.append(f"{key}={tags[key]!r} is not one of {'|'.join(sorted(allowed))}")
    return out


def resources(sess, region, types, account):
    """{arn: tags} for one region."""
    api = awskit.client(sess, "resourcegroupstaggingapi", region)
    kwargs = {"ResourceTypeFilters": types} if types else {}
    found = {r["ResourceARN"]: awskit.tags(r) for r in awskit.items(api, "get_resources", "ResourceTagMappingList[]", **kwargs)}
    if not types or {"ec2", "ec2:instance", "ec2:volume"} & set(types):
        ec2 = awskit.client(sess, "ec2", region)
        arn = f"arn:{sess.get_partition_for_region(region)}:ec2:{region}:{account}"
        for i in awskit.items(ec2, "describe_instances", "Reservations[].Instances[]"):
            if i["State"]["Name"] != "terminated":
                found.setdefault(f"{arn}:instance/{i['InstanceId']}", awskit.tags(i))
        for v in awskit.items(ec2, "describe_volumes", "Volumes[]"):
            found.setdefault(f"{arn}:volume/{v['VolumeId']}", awskit.tags(v))
    return found


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--require", action="append", required=True, metavar="KEY[=a|b]", help="a required tag, optionally with allowed values; repeat it")
    ap.add_argument("--type", action="append", dest="types", metavar="SERVICE[:TYPE]", help="only these resource types, e.g. ec2:instance, s3, rds:db")
    args = ap.parse_args(argv)
    rules = rules_of(args.require)
    sess = awskit.session(args)
    account = awskit.client(sess, "sts").get_caller_identity()["Account"]

    def one(region):
        return [{"resource": arn, "problems": p} for arn, tags in resources(sess, region, args.types, account).items() if (p := problems(tags, rules))]

    found, failed = awskit.per_region(sess, args, one)
    if args.json:
        awskit.show_json(found)
    else:
        for rows in found.values():
            for r in rows:
                print(f"{r['resource']}\n  {'; '.join(r['problems'])}")
        n = sum(map(len, found.values()))
        print(f"\n{n} resource(s) out of policy." if n else "Every resource has the required tags.")
    return awskit.FOUND if failed or any(found.values()) else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
