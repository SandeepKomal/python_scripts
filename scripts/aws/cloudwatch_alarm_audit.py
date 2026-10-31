#!/usr/bin/env python3
"""Find CloudWatch alarms that would not wake anyone: no actions, missing topics, stale data, deleted instances.

Flags alarms with no alarm action or with actions disabled, actions that
point at an SNS topic that no longer exists, alarms stuck in
INSUFFICIENT_DATA for more than --stale-hours, and alarms on EC2 instances
that are gone. Composite alarms are checked too; an alarm that only feeds a
composite alarm needs no action of its own.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "ec2:DescribeRegions", "cloudwatch:DescribeAlarms", "sns:ListTopics", "ec2:DescribeInstances"]}]}

Usage:
  cloudwatch_alarm_audit.py --region eu-west-1
  cloudwatch_alarm_audit.py --all-regions --stale-hours 48 --json

Exit: 0 no findings, 1 findings (or a region failed), 2 credential, region or permission error.
"""
import datetime as dt
import sys

import awskit


def audit(alarms, composites, topics, instances, stale_hours, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    out = []
    rules = " ".join(c.get("AlarmRule", "") for c in composites)
    for a in alarms + composites:
        name, actions = a["AlarmName"], a.get("AlarmActions", [])
        if not actions:
            if name not in rules:  # an alarm that only feeds a composite needs no action
                out.append((name, "no alarm action: it changes state and nobody hears"))
        elif not a.get("ActionsEnabled", True):
            out.append((name, "actions are disabled"))
        for arn in actions:
            if arn.split(":")[2] == "sns" and arn not in topics:
                out.append((name, f"notifies an SNS topic that does not exist: {arn.rsplit(':', 1)[-1]}"))
        if a["StateValue"] == "INSUFFICIENT_DATA" and now - a["StateUpdatedTimestamp"] > dt.timedelta(hours=stale_hours):
            out.append((name, f"INSUFFICIENT_DATA for {(now - a['StateUpdatedTimestamp']).days} day(s): the metric or its dimensions are wrong"))
    for a in alarms:
        ids = [d["Value"] for d in a.get("Dimensions", []) if d["Name"] == "InstanceId"]
        if ids and ids[0] not in instances:
            out.append((a["AlarmName"], f"watches {ids[0]}, which no longer exists"))
    return [{"alarm": n, "finding": f} for n, f in out]


def region_audit(sess, region, stale_hours):
    cw = awskit.client(sess, "cloudwatch", region)
    alarms = list(awskit.items(cw, "describe_alarms", "MetricAlarms[]", AlarmTypes=["MetricAlarm"]))
    composites = list(awskit.items(cw, "describe_alarms", "CompositeAlarms[]", AlarmTypes=["CompositeAlarm"]))
    topics = set(awskit.items(awskit.client(sess, "sns", region), "list_topics", "Topics[].TopicArn"))
    ec2 = awskit.client(sess, "ec2", region)
    instances = {i["InstanceId"] for i in awskit.items(ec2, "describe_instances", "Reservations[].Instances[]") if i["State"]["Name"] != "terminated"}
    return {"alarms": len(alarms) + len(composites), "findings": audit(alarms, composites, topics, instances, stale_hours)}


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--stale-hours", type=int, default=24, help="hours in INSUFFICIENT_DATA before an alarm is flagged (default 24)")
    args = ap.parse_args(argv)
    sess = awskit.session(args)
    found, failed = awskit.per_region(sess, args, lambda r: region_audit(sess, r, args.stale_hours))
    if args.json:
        awskit.show_json(found)
    else:
        for region, r in found.items():
            print(f"{region}: {r['alarms']} alarm(s), {len(r['findings'])} finding(s)")
            for f in r["findings"]:
                print(f"  {f['alarm']}: {f['finding']}")
    return awskit.FOUND if failed or any(r["findings"] for r in found.values()) else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
