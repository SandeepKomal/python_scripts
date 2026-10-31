#!/usr/bin/env python3
"""Delete EBS snapshots older than a retention period, never one that an AMI still uses.

Only snapshots this account owns. It skips snapshots behind a registered AMI
(deleting those breaks every launch from the image), snapshots tagged with
--keep-tag, and AWS Backup's own recovery points. A dry run by default: it
lists what it would delete and asks EC2 (DryRun=True) whether the delete
would be allowed. --apply deletes.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "ec2:DescribeRegions", "ec2:DescribeSnapshots", "ec2:DescribeImages", "ec2:DeleteSnapshot"]}]}

Usage:
  ebs_snapshot_cleanup.py --days 90 --region eu-west-1             (dry run)
  ebs_snapshot_cleanup.py --days 90 --all-regions --apply --json

Exit: 0 ok, 1 a delete (or its dry run) was refused or failed, 2 usage, credential or region error.
"""
import datetime as dt
import sys

import awskit
from botocore.exceptions import ClientError


def plan(ec2, days, keep_tag, now=None):
    """(snapshots to delete, [(snapshot id, why kept)]) for one region."""
    cutoff = (now or dt.datetime.now(dt.timezone.utc)) - dt.timedelta(days=days)
    in_ami = {}
    for image in awskit.items(ec2, "describe_images", "Images[]", Owners=["self"], IncludeDeprecated=True, IncludeDisabled=True):
        for m in image.get("BlockDeviceMappings", []):
            if "Ebs" in m and "SnapshotId" in m["Ebs"]:
                in_ami[m["Ebs"]["SnapshotId"]] = image["ImageId"]
    delete, kept = [], []
    for s in awskit.items(ec2, "describe_snapshots", "Snapshots[]", OwnerIds=["self"]):
        if s["StartTime"] >= cutoff:
            continue
        sid = s["SnapshotId"]
        if sid in in_ami:
            kept.append((sid, f"used by {in_ami[sid]}"))
        elif keep_tag in awskit.tags(s):
            kept.append((sid, f"tagged {keep_tag}"))
        elif "aws:backup:source-resource" in awskit.tags(s):
            kept.append((sid, "managed by AWS Backup; expire it with the backup plan"))
        else:
            delete.append({"id": sid, "started": s["StartTime"], "gib": s["VolumeSize"], "volume": s.get("VolumeId", "")})
    return delete, kept


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--days", type=int, required=True, help="delete snapshots older than this many days")
    ap.add_argument("--keep-tag", default="Keep", help="never delete snapshots with this tag key (default Keep)")
    ap.add_argument("--apply", action="store_true", help="really delete; otherwise a dry run")
    args = ap.parse_args(argv)
    if args.days < 1:
        ap.error("--days must be at least 1")
    sess = awskit.session(args)

    def one(region):
        ec2 = awskit.client(sess, "ec2", region)
        delete, kept = plan(ec2, args.days, args.keep_tag)
        for s in delete:
            try:
                if args.apply:
                    ec2.delete_snapshot(SnapshotId=s["id"])
                else:
                    awskit.dry_run(ec2.delete_snapshot, SnapshotId=s["id"])
                s["error"] = None
            except ClientError as e:  # InvalidSnapshot.InUse, a permission, a lock...
                s["error"] = awskit.explain(e)
        return {"delete": delete, "kept": kept}

    done, failed = awskit.per_region(sess, args, one)
    errors = failed + sum(1 for r in done.values() for s in r["delete"] if s["error"])
    if args.json:
        awskit.show_json({"applied": args.apply, "regions": done})
    else:
        verb = "deleted" if args.apply else "would delete"
        for region, r in done.items():
            for s in r["delete"]:
                print(f"{region}  {s['id']}  {s['started']:%Y-%m-%d}  {s['gib']:>5} GiB  {'FAILED: ' + s['error'] if s['error'] else verb}")
            for sid, why in r["kept"]:
                print(f"{region}  {sid}  kept ({why})")
        n = sum(1 for r in done.values() for s in r["delete"] if not s["error"])
        print(f"\n{n} snapshot(s) {'deleted' if args.apply else 'would be deleted'}." + ("" if args.apply or not n else " Run again with --apply."))
    return awskit.FOUND if errors else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
