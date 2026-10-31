#!/usr/bin/env python3
"""Audit every S3 bucket for public access, encryption, versioning, TLS-only access and ACLs.

Checks the account-wide and per-bucket Block Public Access settings, whether
the bucket policy makes it public, ACL grants to everyone, default
encryption, versioning, a policy that denies plain HTTP, Object Ownership
(ACLs disabled) and access logging. It only reads; nothing is printed from
the policies except the findings.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "sts:GetCallerIdentity", "s3:GetAccountPublicAccessBlock", "s3:ListAllMyBuckets", "s3:GetBucketLocation",
    "s3:GetBucketPublicAccessBlock", "s3:GetBucketPolicyStatus", "s3:GetBucketPolicy", "s3:GetBucketAcl",
    "s3:GetEncryptionConfiguration", "s3:GetBucketVersioning", "s3:GetBucketOwnershipControls", "s3:GetBucketLogging"]}]}

Usage:
  s3_security_audit.py
  s3_security_audit.py --profile audit --region ap-south-1 --json    (only buckets in that region)

Exit: 0 no findings, 1 findings (or a bucket could not be read), 2 credential or permission error.
"""
import json
import sys

import awskit
from botocore.exceptions import ClientError

EVERYONE = ("http://acs.amazonaws.com/groups/global/AllUsers", "http://acs.amazonaws.com/groups/global/AuthenticatedUsers")
BPA_KEYS = ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets")


def missing(e, *codes):
    """True when e says the setting is simply not configured."""
    if isinstance(e, ClientError) and awskit.code(e) in codes:
        return True
    raise e


def account_block(sess):
    """True when the account blocks public access for every bucket."""
    account = awskit.client(sess, "sts").get_caller_identity()["Account"]
    try:
        cfg = awskit.client(sess, "s3control", sess.region_name or "us-east-1").get_public_access_block(AccountId=account)["PublicAccessBlockConfiguration"]
    except ClientError as e:
        return not missing(e, "NoSuchPublicAccessBlockConfiguration")
    return all(cfg.get(k) for k in BPA_KEYS)


def bucket_region(b, s3):
    return b.get("BucketRegion") or s3.get_bucket_location(Bucket=b["Name"]).get("LocationConstraint") or "us-east-1"


def public_access(s3, name):
    """Findings about who can read the bucket."""
    out = []
    try:
        cfg = s3.get_public_access_block(Bucket=name)["PublicAccessBlockConfiguration"]
        if not all(cfg.get(k) for k in BPA_KEYS):
            out.append("Block Public Access is only partly on")
    except ClientError as e:
        if missing(e, "NoSuchPublicAccessBlockConfiguration"):
            out.append("Block Public Access is off")
    try:
        if s3.get_bucket_policy_status(Bucket=name)["PolicyStatus"]["IsPublic"]:
            out.append("PUBLIC: the bucket policy allows anyone")
    except ClientError as e:
        missing(e, "NoSuchBucketPolicy")
    grants = s3.get_bucket_acl(Bucket=name)["Grants"]
    if any(g["Grantee"].get("URI") in EVERYONE for g in grants):
        out.append("PUBLIC: the ACL grants access to everyone")
    return out


def encryption(s3, name):
    """'aws:kms', 'AES256', ... or None."""
    try:
        rules = s3.get_bucket_encryption(Bucket=name)["ServerSideEncryptionConfiguration"]["Rules"]
    except ClientError as e:
        missing(e, "ServerSideEncryptionConfigurationNotFoundError")
        return None
    return rules[0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"] if rules else None


def denies_plain_http(s3, name):
    try:
        policy = json.loads(s3.get_bucket_policy(Bucket=name)["Policy"])
    except ClientError as e:
        missing(e, "NoSuchBucketPolicy")
        return False
    statements = policy.get("Statement", [])
    for st in statements if isinstance(statements, list) else [statements]:
        cond = st.get("Condition", {}).get("Bool", {})
        if st.get("Effect") == "Deny" and str(cond.get("aws:SecureTransport", "")).lower() == "false":
            return True
    return False


def audit_bucket(s3, name):
    findings = public_access(s3, name)
    if not encryption(s3, name):
        findings.append("no default encryption")
    if s3.get_bucket_versioning(Bucket=name).get("Status") != "Enabled":
        findings.append("versioning is off (deleted or overwritten objects cannot be recovered)")
    if not denies_plain_http(s3, name):
        findings.append("the policy does not deny plain HTTP (aws:SecureTransport)")
    try:
        rules = s3.get_bucket_ownership_controls(Bucket=name)["OwnershipControls"]["Rules"]
        if rules[0]["ObjectOwnership"] != "BucketOwnerEnforced":
            findings.append("ACLs are still enabled (Object Ownership is not BucketOwnerEnforced)")
    except ClientError as e:
        if missing(e, "OwnershipControlsNotFoundError"):
            findings.append("ACLs are still enabled (no Object Ownership setting)")
    if "LoggingEnabled" not in s3.get_bucket_logging(Bucket=name):
        findings.append("server access logging is off")
    return findings


def main(argv=None):
    ap = awskit.parser(__doc__, regional=False)
    ap.add_argument("--region", help="only buckets in this region")
    args = ap.parse_args(argv)
    sess = awskit.session(args)
    s3 = awskit.client(sess, "s3")
    report, errors = {}, 0
    for b in awskit.items(s3, "list_buckets", "Buckets[]"):
        region = bucket_region(b, s3)
        if args.region and region != args.region:
            continue
        try:
            report[b["Name"]] = {"region": region, "findings": audit_bucket(awskit.client(sess, "s3", region), b["Name"])}
        except ClientError as e:  # one unreadable bucket must not hide the others
            report[b["Name"]] = {"region": region, "findings": [f"could not audit: {awskit.explain(e)}"]}
            errors += 1
    blocked = account_block(sess)
    if args.json:
        awskit.show_json({"account_block_public_access": blocked, "buckets": report})
    else:
        print(f"Account-wide Block Public Access: {'on' if blocked else 'OFF (each bucket depends on its own setting)'}")
        for name, r in report.items():
            print(f"\n{name} ({r['region']})" + ("" if r["findings"] else "  ok"))
            for f in r["findings"]:
                print(f"  - {f}")
        bad = sum(1 for r in report.values() if r["findings"])
        print(f"\n{len(report)} bucket(s) checked, {bad} with findings.")
    return awskit.FOUND if errors or not blocked or any(r["findings"] for r in report.values()) else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
