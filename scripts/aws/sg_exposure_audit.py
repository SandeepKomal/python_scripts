#!/usr/bin/env python3
"""Find security group rules open to the whole internet, and say which ones are attached to something.

Reports every inbound rule from 0.0.0.0/0 or ::/0 except the ports in
--allow-ports (80 and 443 by default). SSH, RDP, databases, caches and
"all traffic" are marked HIGH. A group no network interface uses is shown
as unused: still worth deleting, but nothing is exposed through it today.

Minimum IAM permissions:
  {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Resource": "*", "Action": [
    "ec2:DescribeRegions", "ec2:DescribeSecurityGroups", "ec2:DescribeNetworkInterfaces"]}]}

Usage:
  sg_exposure_audit.py --region eu-west-1
  sg_exposure_audit.py --all-regions --allow-ports 80,443,8443 --json

Exit: 0 nothing open, 1 open rules found (or a region failed), 2 credential, region or permission error.
"""
import sys
from collections import Counter

import awskit

ANYWHERE = {"0.0.0.0/0", "::/0"}
SENSITIVE = {22: "SSH", 3389: "RDP", 3306: "MySQL", 5432: "PostgreSQL", 1433: "SQL Server", 1521: "Oracle", 6379: "Redis", 11211: "Memcached",
             27017: "MongoDB", 9200: "Elasticsearch", 5601: "Kibana", 2375: "Docker API", 2379: "etcd", 10250: "kubelet", 445: "SMB", 23: "Telnet"}


def open_rules(group, allowed):
    """[(port text, source, severity)] for inbound rules open to the internet."""
    out = []
    for p in group.get("IpPermissions", []):
        sources = {r["CidrIp"] for r in p.get("IpRanges", [])} | {r["CidrIpv6"] for r in p.get("Ipv6Ranges", [])}
        for src in sorted(sources & ANYWHERE):
            if p["IpProtocol"] == "-1":
                out.append(("all traffic", src, "HIGH"))
                continue
            lo, hi = p.get("FromPort", 0), p.get("ToPort", 65535)
            if lo == hi and lo in allowed:
                continue
            hits = [name for port, name in SENSITIVE.items() if lo <= port <= hi]
            ports = f"{p['IpProtocol']}/{lo}" if lo == hi else f"{p['IpProtocol']}/{lo}-{hi}"
            out.append((ports + (f" ({', '.join(hits)})" if hits else ""), src, "HIGH" if hits or hi - lo > 100 else "medium"))
    return out


def audit(sess, region, allowed):
    ec2 = awskit.client(sess, "ec2", region)
    in_use = Counter(g["GroupId"] for g in awskit.items(ec2, "describe_network_interfaces", "NetworkInterfaces[].Groups[]"))
    found = []
    for g in awskit.items(ec2, "describe_security_groups", "SecurityGroups[]"):
        for ports, src, severity in open_rules(g, allowed):
            found.append({"group": g["GroupId"], "name": g["GroupName"], "vpc": g.get("VpcId", ""), "ports": ports, "source": src,
                          "severity": severity, "attached_interfaces": in_use[g["GroupId"]]})
    return found


def main(argv=None):
    ap = awskit.parser(__doc__)
    ap.add_argument("--allow-ports", default="80,443", help="ports that may be open to everyone (default 80,443)")
    args = ap.parse_args(argv)
    try:
        allowed = {int(p) for p in args.allow_ports.split(",") if p.strip()}
    except ValueError:
        ap.error("--allow-ports takes numbers, like 80,443")
    sess = awskit.session(args)
    found, failed = awskit.per_region(sess, args, lambda r: audit(sess, r, allowed))
    if args.json:
        awskit.show_json(found)
    else:
        for region, rows in found.items():
            for f in sorted(rows, key=lambda f: (f["severity"] != "HIGH", f["group"])):
                used = f"{f['attached_interfaces']} interface(s)" if f["attached_interfaces"] else "unused"
                print(f"{f['severity']:<6} {region:<14} {f['group']:<22} {f['name'][:24]:<24} {f['ports']:<28} from {f['source']:<10} {used}")
        n = sum(map(len, found.values()))
        print(f"\n{n} rule(s) open to the internet." if n else "No rules open to the internet.")
    return awskit.FOUND if failed or any(found.values()) else awskit.OK


if __name__ == "__main__":
    sys.exit(awskit.run(main))
