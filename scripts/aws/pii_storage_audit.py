#!/usr/bin/env python3
"""Audit where tagged personal data lives on AWS: S3 buckets, RDS databases and EBS volumes.

For privacy engineering, for example under India's DPDP Act 2023: reasonable
security safeguards for personal data. Resources are found by a
classification tag (--tag, default DataClassification=personal; exact match). For each one
it flags missing encryption, public access, and a region outside
--expected-regions. Where personal data may be stored is your organisation's
policy (and any rule that applies to you); this script only checks that the
resources match it. It reads configuration only, never the data.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "ec2:DescribeRegions", "ec2:DescribeVolumes", "rds:DescribeDBInstances", "rds:DescribeDBClusters",
    "s3:ListAllMyBuckets", "s3:GetBucketLocation", "s3:GetBucketTagging", "s3:GetBucketPublicAccessBlock",
    "s3:GetBucketPolicyStatus", "s3:GetBucketAcl", "s3:GetEncryptionConfiguration"]}]}

Usage:
  pii_storage_audit.py --all-regions --expected-regions ap-south-1,ap-south-2
  pii_storage_audit.py --region ap-south-1 --tag DataClassification=personal,sensitive --json

Exit: 0 no findings, 1 findings (or a region or bucket could not be read), 2 credential or permission error.
"""
import sys

import awskit
import s3_security_audit as s3audit
from botocore.exceptions import ClientError


def classified(tags, key, values):
    return tags.get(key) in values


def buckets(sess, key, values, expected):
    s3 = awskit.client(sess, "s3")
    out, errors = [], 0
    for b in awskit.items(s3, "list_buckets", "Buckets[]"):
        region = s3audit.bucket_region(b, s3)
        regional = awskit.client(sess, "s3", region)
        try:
            tags = {t["Key"]: t["Value"] for t in regional.get_bucket_tagging(Bucket=b["Name"])["TagSet"]}
        except ClientError as e:
            if awskit.code(e) == "NoSuchTagSet":
                continue
            out.append({"resource": f"s3://{b['Name']}", "region": region, "findings": [f"could not read tags: {awskit.explain(e)}"]})
            errors += 1
            continue
        if not classified(tags, key, values):
            continue
        try:
            findings = [f for f in s3audit.public_access(regional, b["Name"]) if f.startswith("PUBLIC") or "off" in f]
            if not s3audit.encryption(regional, b["Name"]):
                findings.append("not encrypted")
        except ClientError as e:
            findings, errors = [f"could not audit: {awskit.explain(e)}"], errors + 1
        out.append({"resource": f"s3://{b['Name']}", "region": region, "findings": findings + where(region, expected)})
    return out, errors


def where(region, expected):
    return [f"stored in {region}, outside the expected regions"] if expected and region not in expected else []


def databases_and_volumes(sess, region, key, values, expected):
    rds = awskit.client(sess, "rds", region)
    out = []
    for d in awskit.items(rds, "describe_db_instances", "DBInstances[]"):
        if not classified(awskit.tags(d), key, values):
            continue
        f = [] if d["StorageEncrypted"] else ["storage not encrypted"]
        if d["PubliclyAccessible"]:
            f.append("publicly accessible")
        out.append({"resource": d["DBInstanceArn"], "region": region, "findings": f + where(region, expected)})
    for c in awskit.items(rds, "describe_db_clusters", "DBClusters[]"):
        if classified(awskit.tags(c), key, values):
            out.append({"resource": c["DBClusterArn"], "region": region,
                        "findings": ([] if c["StorageEncrypted"] else ["storage not encrypted"]) + where(region, expected)})
    ec2 = awskit.client(sess, "ec2", region)
    for v in awskit.items(ec2, "describe_volumes", "Volumes[]", Filters=[{"Name": f"tag:{key}", "Values": sorted(values)}]):
        out.append({"resource": v["VolumeId"], "region": region, "findings": ([] if v["Encrypted"] else ["not encrypted"]) + where(region, expected)})
    return out


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--tag", default="DataClassification=personal", metavar="KEY=v1,v2", help="the tag that marks personal data (default DataClassification=personal)")
    ap.add_argument("--expected-regions", default="", metavar="r1,r2", help="regions where personal data may be stored (default: any)")
    args = ap.parse_args(argv)
    key, _, vals = args.tag.partition("=")
    values = {v.strip() for v in vals.split(",") if v.strip()}
    if not key or not values:
        ap.error("--tag must look like DataClassification=personal")
    expected = {r.strip() for r in args.expected_regions.split(",") if r.strip()}
    sess = awskit.session(args)
    found, failed = awskit.per_region(sess, args, lambda r: databases_and_volumes(sess, r, key, values, expected))
    rows = [row for region_rows in found.values() for row in region_rows]
    s3_rows, s3_errors = buckets(sess, key, values, expected)
    rows += s3_rows
    if args.json:
        awskit.show_json(rows)
    else:
        for r in rows:
            print(f"{'ok ' if not r['findings'] else 'FIX'}  {r['resource']} ({r['region']})" + "".join(f"\n       - {f}" for f in r["findings"]))
        bad = sum(1 for r in rows if r["findings"])
        print(f"\n{len(rows)} resource(s) tagged {key}={','.join(sorted(values))}, {bad} need attention.")
    return awskit.FOUND if failed or s3_errors or any(r["findings"] for r in rows) else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
