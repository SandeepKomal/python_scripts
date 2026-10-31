"""Shared plumbing for the scripts in scripts/aws/: sessions, retries, regions, pages and errors.

Every script here imports this file, so copy it along with them. Credentials
come only from the standard chain (environment, --profile or AWS_PROFILE,
SSO, the instance or task role); nothing here reads, stores or prints a key.

Exit codes shared by all the scripts:
  0  ok
  1  problems found, or an action failed
  2  usage, configuration, credential or permission error (the check could not run)
"""
import argparse
import json
import sys

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, EndpointConnectionError, NoCredentialsError, NoRegionError, ParamValidationError, ProfileNotFound, WaiterError

OK, FOUND, ERROR = 0, 1, 2

# Adaptive retries back off and slow the client down when AWS throttles it;
# the timeouts stop a dead endpoint from hanging a cron job.
CONFIG = Config(retries={"mode": "adaptive", "max_attempts": 10}, connect_timeout=5, read_timeout=60)

EXPIRED = {"ExpiredToken", "ExpiredTokenException", "RequestExpired", "TokenRefreshRequired"}
REJECTED = {"InvalidClientTokenId", "SignatureDoesNotMatch", "UnrecognizedClientException", "AuthFailure", "InvalidAccessKeyId"}
DENIED = {"AccessDenied", "AccessDeniedException", "UnauthorizedOperation", "AuthorizationError", "AllAccessDisabled"}
THROTTLED = {"Throttling", "ThrottlingException", "RequestLimitExceeded", "TooManyRequestsException", "SlowDown"}


def parser(doc, regional=True):
    """The options every script shares: --profile, --region / --all-regions, --json."""
    ap = argparse.ArgumentParser(description=doc.splitlines()[0], epilog="Exit: 0 ok, 1 problems found or an action failed, 2 usage, credential or permission error.")
    ap.add_argument("--profile", help="named profile from ~/.aws/config (default: the standard credential chain)")
    if regional:
        where = ap.add_mutually_exclusive_group()
        where.add_argument("--region", help="region to use (default: AWS_REGION or the profile's region)")
        where.add_argument("--all-regions", action="store_true", help="every region enabled for the account")
    ap.add_argument("--json", action="store_true", help="print JSON instead of text")
    return ap


def session(args):
    return boto3.Session(profile_name=args.profile)


def client(sess, service, region=None):
    return sess.client(service, region_name=region, config=CONFIG)


def regions(sess, args):
    """The region from the options or the profile, or every enabled region with --all-regions."""
    if not getattr(args, "all_regions", False):
        region = getattr(args, "region", None) or sess.region_name
        if not region:
            raise NoRegionError()
        return [region]
    ec2 = client(sess, "ec2", getattr(args, "region", None) or sess.region_name or "us-east-1")
    resp = ec2.describe_regions(Filters=[{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}])
    return sorted(r["RegionName"] for r in resp["Regions"])


def items(c, operation, path, **kwargs):
    """Every item of a list call, across all pages. path is a JMESPath such as "Reservations[].Instances[]"."""
    for item in c.get_paginator(operation).paginate(**kwargs).search(path):
        if item is not None:
            yield item


def per_region(sess, args, fn):
    """fn(region) for each region. With several regions, one that fails is reported and the rest still run.

    Returns ({region: result}, number of regions that failed). Credential errors stop everything,
    because every region would fail the same way.
    """
    names = regions(sess, args)
    results, failed = {}, 0
    for region in names:
        try:
            results[region] = fn(region)
        except (ClientError, EndpointConnectionError) as e:
            if len(names) == 1 or code(e) in EXPIRED | REJECTED:
                raise
            print(f"error: {region}: {explain(e)}", file=sys.stderr)
            failed += 1
    return results, failed


def code(e):
    return e.response.get("Error", {}).get("Code", "") if isinstance(e, ClientError) else ""


def tags(resource):
    """{key: value} from an AWS Tags (EC2, ELB) or TagList (RDS) list."""
    return {t["Key"]: t["Value"] for t in resource.get("Tags") or resource.get("TagList") or []}


def dry_run(call, **kwargs):
    """Ask EC2 whether call(**kwargs) would succeed, without doing it. Raises the real error if not."""
    try:
        call(DryRun=True, **kwargs)
    except ClientError as e:
        if code(e) != "DryRunOperation":
            raise


def explain(e):
    """One line a person can act on, for any AWS or botocore error."""
    c = code(e)
    if isinstance(e, NoCredentialsError):
        return "no AWS credentials found: pass --profile or set AWS_PROFILE, run `aws sso login`, or run where an instance or task role is attached"
    if isinstance(e, ProfileNotFound):
        return f"{e}; list the profiles with `aws configure list-profiles`"
    if isinstance(e, NoRegionError):
        return "no region: pass --region (or --all-regions), set AWS_REGION, or set region in the profile"
    if isinstance(e, EndpointConnectionError):
        return f"{e}: check the region name, DNS, the proxy (HTTPS_PROXY) and any VPC endpoint"
    if isinstance(e, ParamValidationError):
        return f"the request was rejected before it was sent, check the options: {e}"
    if isinstance(e, WaiterError):
        return f"{e}: the resource did not reach that state in time; it may still get there, so look before retrying"
    if c in EXPIRED:
        return f"{c}: the temporary credentials have expired; refresh them (`aws sso login`, or assume the role again) and run again"
    if c in REJECTED:
        return f"{c}: AWS does not accept these credentials; check which identity is used (`aws sts get-caller-identity`), the secret key, and the system clock"
    if c in DENIED:
        return f"{c} on {e.operation_name}: this identity lacks the permission; grant it (the policy is in the script's header), and check SCPs and permission boundaries"
    if c in THROTTLED:
        return f"{c} on {e.operation_name}, after retries: AWS is rate-limiting this account; run fewer jobs at once or try again later"
    return str(e)


def run(main):
    """Run main(); AWS and credential errors become one clear line on stderr and exit status 2."""
    try:
        return main()
    except (BotoCoreError, ClientError) as e:
        print(f"error: {explain(e)}", file=sys.stderr)
        return ERROR


def show_json(data):
    print(json.dumps(data, indent=2, default=str))
