#!/usr/bin/env python3
"""Find AWS resources you pay for and nobody uses, with an estimated monthly cost.

Unattached EBS volumes, Elastic IPs not associated with anything, snapshots
older than --snapshot-days, and load balancers with no registered targets.
It only reads and reports; review the list, then delete with the console,
the CLI or ebs_snapshot_cleanup.py.

Costs are estimates at us-east-1 on-demand list prices (see PRICES); other
regions differ by a few percent, and snapshot sizes are the source volume's
size, an upper bound because snapshots are incremental. Check your bill.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "ec2:DescribeRegions", "ec2:DescribeVolumes", "ec2:DescribeAddresses", "ec2:DescribeSnapshots",
    "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth"]}]}

Usage:
  unused_resources.py --region eu-west-1
  unused_resources.py --all-regions --snapshot-days 180 --json

Exit: 0 nothing unused, 1 unused resources found (or a region failed), 2 credential, region or permission error.
"""
import datetime as dt
import sys

import awskit

# USD per month, us-east-1 list prices. EBS per GiB, the rest per resource (730 hours).
PRICES = {"gp3": 0.08, "gp2": 0.10, "io1": 0.125, "io2": 0.125, "st1": 0.045, "sc1": 0.015, "standard": 0.05,
          "snapshot": 0.05, "public_ipv4": 0.005 * 730, "alb": 0.0225 * 730, "nlb": 0.0225 * 730, "gwlb": 0.0125 * 730, "classic": 0.025 * 730}


def unused(sess, region, snapshot_days, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    ec2 = awskit.client(sess, "ec2", region)
    found = []
    for v in awskit.items(ec2, "describe_volumes", "Volumes[]", Filters=[{"Name": "status", "Values": ["available"]}]):
        found.append({"kind": "EBS volume, unattached", "id": v["VolumeId"], "detail": f"{v['Size']} GiB {v['VolumeType']}",
                      "monthly_usd": v["Size"] * PRICES.get(v["VolumeType"], 0.10)})
    for a in ec2.describe_addresses()["Addresses"]:  # not paginated: at most a few per region
        if "AssociationId" not in a:
            found.append({"kind": "Elastic IP, unassociated", "id": a.get("AllocationId", a["PublicIp"]), "detail": a["PublicIp"], "monthly_usd": PRICES["public_ipv4"]})
    cutoff = now - dt.timedelta(days=snapshot_days)
    for s in awskit.items(ec2, "describe_snapshots", "Snapshots[]", OwnerIds=["self"]):
        if s["StartTime"] < cutoff:
            found.append({"kind": f"EBS snapshot, older than {snapshot_days} days", "id": s["SnapshotId"],
                          "detail": f"{s['VolumeSize']} GiB, {s['StartTime']:%Y-%m-%d}", "monthly_usd": s["VolumeSize"] * PRICES["snapshot"]})
    elb = awskit.client(sess, "elbv2", region)
    for lb in awskit.items(elb, "describe_load_balancers", "LoadBalancers[]"):
        groups = list(awskit.items(elb, "describe_target_groups", "TargetGroups[]", LoadBalancerArn=lb["LoadBalancerArn"]))
        if not any(elb.describe_target_health(TargetGroupArn=g["TargetGroupArn"])["TargetHealthDescriptions"] for g in groups):
            kind = {"application": "alb", "network": "nlb", "gateway": "gwlb"}[lb["Type"]]
            found.append({"kind": "Load balancer, no targets", "id": lb["LoadBalancerName"], "detail": f"{lb['Type']}, {len(groups)} target group(s)", "monthly_usd": PRICES[kind]})
    classic = awskit.client(sess, "elb", region)
    for lb in awskit.items(classic, "describe_load_balancers", "LoadBalancerDescriptions[]"):
        if not lb["Instances"]:
            found.append({"kind": "Load balancer, no targets", "id": lb["LoadBalancerName"], "detail": "classic", "monthly_usd": PRICES["classic"]})
    for f in found:
        f["monthly_usd"] = round(f["monthly_usd"], 2)
    return found


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--snapshot-days", type=int, default=90, help="report snapshots older than this (default 90)")
    args = ap.parse_args(argv)
    sess = awskit.session(args)
    found, failed = awskit.per_region(sess, args, lambda r: unused(sess, r, args.snapshot_days))
    total = round(sum(f["monthly_usd"] for rows in found.values() for f in rows), 2)
    if args.json:
        awskit.show_json({"regions": found, "estimated_monthly_usd": total})
    else:
        for region, rows in found.items():
            for f in sorted(rows, key=lambda f: -f["monthly_usd"]):
                print(f"{region:<14} {f['kind']:<36} {f['id']:<24} {f['detail']:<32} ~${f['monthly_usd']:>8.2f}/month")
        count = sum(map(len, found.values()))
        print(f"\n{count} unused resource(s), about ${total:,.2f} a month at list prices." if count else "Nothing unused found.")
    return awskit.FOUND if failed or any(found.values()) else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
