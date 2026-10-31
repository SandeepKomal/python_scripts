#!/usr/bin/env python3
"""Audit SSM Parameter Store and Secrets Manager, and check required names exist, without reading a value.

It uses only the describe and list calls, so it never fetches, decrypts or
prints a parameter value or a secret, and needs no kms:Decrypt. It flags
parameters whose names look secret but are stored as plain String,
secrets with rotation off or not rotated for --max-age days, and secrets
nobody has read for --unused-days. --require NAME (repeatable) fails the
run when a parameter or secret is missing: a pre-deploy check.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*",
    "Action": ["ssm:DescribeParameters", "secretsmanager:ListSecrets"]}]}

Usage:
  ssm_params.py --region eu-west-1 --path /shop/prod
  ssm_params.py --region eu-west-1 --require /shop/prod/DATABASE_URL --require shop/prod/stripe

Exit: 0 ok, 1 findings or a required name is missing, 2 credential, region or permission error.
"""
import datetime as dt
import re
import sys

import awskit

SECRET_NAME = re.compile(r"(?i)(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|dsn|database_url)")


def parameters(ssm, path):
    kwargs = {"ParameterFilters": [{"Key": "Path", "Option": "Recursive", "Values": [path]}]} if path else {}
    return list(awskit.items(ssm, "describe_parameters", "Parameters[]", **kwargs))


def secrets(sm, path):
    kwargs = {"Filters": [{"Key": "name", "Values": [path.strip("/")]}]} if path else {}
    return list(awskit.items(sm, "list_secrets", "SecretList[]", **kwargs))


def audit(params, secs, max_age, unused_days, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    out = []
    for p in params:
        if p["Type"] != "SecureString" and SECRET_NAME.search(p["Name"]):
            out.append((p["Name"], f"looks like a secret but is a plain {p['Type']}: store it as SecureString"))
    for s in secs:
        if not s.get("RotationEnabled"):
            out.append((s["Name"], "rotation is off"))
        else:
            last = s.get("LastRotatedDate") or s.get("CreatedDate")
            if last and (now - last).days > max_age:
                out.append((s["Name"], f"not rotated for {(now - last).days} days"))
        used = s.get("LastAccessedDate")
        if used and (now - used).days > unused_days:
            out.append((s["Name"], f"not read for {(now - used).days} days: is it still needed?"))
    return out


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--path", help="only parameters under this path, and secrets whose names start with it")
    ap.add_argument("--require", action="append", default=[], metavar="NAME", help="a parameter or secret that must exist; repeat it")
    ap.add_argument("--max-age", type=int, default=90, help="days before a rotating secret is overdue (default 90)")
    ap.add_argument("--unused-days", type=int, default=90, help="days without a read before a secret is flagged (default 90)")
    args = ap.parse_args(argv)
    sess = awskit.session(args)

    def one(region):
        params, secs = parameters(awskit.client(sess, "ssm", region), args.path), secrets(awskit.client(sess, "secretsmanager", region), args.path)
        names = {p["Name"] for p in params} | {s["Name"] for s in secs}
        return {"parameters": len(params), "secrets": len(secs), "missing": [n for n in args.require if n not in names],
                "findings": [{"name": n, "finding": f} for n, f in audit(params, secs, args.max_age, args.unused_days)]}

    found, failed = awskit.per_region(sess, args, one)
    if args.json:
        awskit.show_json(found)
    else:
        for region, r in found.items():
            print(f"{region}: {r['parameters']} parameter(s), {r['secrets']} secret(s)")
            for n in r["missing"]:
                print(f"  MISSING  {n}")
            for f in r["findings"]:
                print(f"  {f['name']}: {f['finding']}")
    bad = failed or any(r["missing"] or r["findings"] for r in found.values())
    return awskit.FOUND if bad else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
