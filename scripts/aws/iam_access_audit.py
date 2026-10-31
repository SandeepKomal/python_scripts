#!/usr/bin/env python3
"""Audit IAM users from the credential report: root keys, missing MFA, old and unused access keys.

Flags root access keys and root sign-ins, console users without MFA, active
access keys older than --max-key-age days, and active keys or passwords not
used for --max-unused days (or never). The report holds names and dates
only, never a secret. IAM is global, so there is no --region.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*",
    "Action": ["iam:GenerateCredentialReport", "iam:GetCredentialReport"]}]}

Usage:
  iam_access_audit.py
  iam_access_audit.py --profile audit --max-key-age 90 --max-unused 45 --json

Exit: 0 no findings, 1 findings, 2 credential or permission error, or the report never became ready.
"""
import csv
import datetime as dt
import io
import sys
import time

import awskit

ROOT = "<root_account>"


def credential_report(iam, attempts=30):
    """The credential report as a list of dicts; asks IAM to build it and waits until it is ready."""
    for _ in range(attempts):
        if iam.generate_credential_report()["State"] == "COMPLETE":
            body = iam.get_credential_report()["Content"].decode("utf-8")
            return list(csv.DictReader(io.StringIO(body)))
        time.sleep(2)
    raise TimeoutError("the credential report was not ready after a minute; try again")


def when(value):
    """A report timestamp, or None for N/A, no_information and not_supported."""
    try:
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def findings(rows, max_key_age, max_unused, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    out = []
    for r in rows:
        msgs = []
        if r["user"] == ROOT:
            msgs += [f"root has an active access key {n}: delete it and use roles" for n in "12" if r[f"access_key_{n}_active"] == "true"]
            if r["mfa_active"] != "true":
                msgs.append("root has no MFA")
            used = when(r["password_last_used"])
            if used and (now - used).days < max_unused:
                msgs.append(f"root signed in {(now - used).days} day(s) ago: keep it for the few tasks that need it")
        else:
            if r["password_enabled"] == "true":  # noqa: S105 (a CSV column of the report, not a password)
                if r["mfa_active"] != "true":
                    msgs.append("console password without MFA")
                msgs += stale("console password", when(r["password_last_used"]), now, max_unused)
            for n in "12":
                if r[f"access_key_{n}_active"] == "true":
                    rotated = when(r[f"access_key_{n}_last_rotated"])
                    if rotated and (now - rotated).days > max_key_age:
                        msgs.append(f"access key {n} is {(now - rotated).days} days old: rotate it")
                    msgs += stale(f"access key {n}", when(r[f"access_key_{n}_last_used_date"]), now, max_unused)
        out += [{"user": r["user"], "finding": m} for m in msgs]
    return out


def stale(what, used, now, max_unused):
    if not used:
        return [f"{what} was never used: disable it"]
    return [f"{what} not used for {(now - used).days} days: disable it"] if (now - used).days > max_unused else []


def main(argv=None):
    ap = awskit.parser(__doc__, regional=False)
    ap.add_argument("--max-key-age", type=int, default=90, help="days before an access key needs rotating (default 90)")
    ap.add_argument("--max-unused", type=int, default=90, help="days without use before a key or password is stale (default 90)")
    args = ap.parse_args(argv)
    iam = awskit.client(awskit.session(args), "iam")
    try:
        rows = credential_report(iam)
    except TimeoutError as e:
        print(f"error: {e}", file=sys.stderr)
        return awskit.ERROR
    found = findings(rows, args.max_key_age, args.max_unused)
    if args.json:
        awskit.show_json({"users": len(rows), "findings": found})
    else:
        for f in found:
            print(f"{f['user']:<32} {f['finding']}")
        print(f"\n{len(rows)} identities checked, {len(found)} finding(s).")
    return awskit.FOUND if found else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
