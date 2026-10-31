#!/usr/bin/env python3
"""Find, and with --apply delete, files holding personal data that are older than the retention period.

Storage limitation in practice: exports, CSV dumps, support attachments and
old logs that nobody deletes. A file counts when it is older than --days
(by modification time) and pii_scanner.py finds personal data in it (keep the
two files together); --any counts every old file that matches --pattern.
The first run is a report. Symbolic links are never followed or deleted.

Usage:
  pii_retention.py /srv/exports --days 180 --pattern '*.csv'
  pii_retention.py /srv/exports --days 180 --pattern '*.csv' --apply --json

Exit: 0 nothing past retention (or all of it deleted), 1 files past retention
remain (a report, or a delete failed), 2 usage error.
"""
import argparse
import fnmatch
import json
import os
import sys
import time
from collections import Counter

import pii_scanner


def personal_data(path):
    """Counter of the kinds of personal data in a file (stops reading after 1,000 matches)."""
    kinds = Counter()
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            kinds.update(kind for kind, _, _ in pii_scanner.find(line))
            if sum(kinds.values()) >= 1000:
                break
    return kinds


def expired(root, days, pattern, any_file=False, now=None):
    """[{path, age_days, kinds}] for files past retention, oldest first."""
    now = now or time.time()
    cutoff = now - days * 86400
    out = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in pii_scanner.SKIP_DIRS]
        for name in fnmatch.filter(files, pattern):
            path = os.path.join(folder, name)
            st = os.lstat(path)
            if os.path.islink(path) or st.st_mtime >= cutoff:
                continue
            try:
                kinds = Counter() if any_file else personal_data(path)
            except OSError as e:
                print(f"skip {path}: {e.strerror}", file=sys.stderr)
                continue
            if any_file or kinds:
                out.append({"path": path, "age_days": int((now - st.st_mtime) // 86400), "kinds": dict(kinds)})
    return sorted(out, key=lambda f: -f["age_days"])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("directory")
    ap.add_argument("--days", type=int, required=True, help="retention period in days")
    ap.add_argument("--pattern", default="*", help="file names to consider (default every file)")
    ap.add_argument("--any", action="store_true", help="count every old file that matches, without scanning it")
    ap.add_argument("--apply", action="store_true", help="delete them; otherwise only report")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.days < 1 or not os.path.isdir(args.directory):
        ap.error("needs an existing directory and --days of at least 1")

    files = expired(args.directory, args.days, args.pattern, args.any)
    left = 0
    for f in files:
        f["deleted"] = False
        if args.apply:
            try:
                os.remove(f["path"])
                f["deleted"] = True
            except OSError as e:
                f["error"] = e.strerror
        left += not f["deleted"]

    if args.json:
        print(json.dumps(files, indent=2))
    else:
        for f in files:
            what = ", ".join(f"{k} {n}" for k, n in f["kinds"].items()) or "not scanned"
            state = "deleted" if f["deleted"] else f"FAILED: {f['error']}" if "error" in f else "delete"
            print(f"{state:<8} {f['path']}  ({f['age_days']} days old; {what})")
        if not files:
            print(f"No personal-data files older than {args.days} days.")
        elif not args.apply:
            print(f"\n{len(files)} file(s) past the {args.days}-day retention period. Nothing was deleted; run again with --apply.")
    return 1 if left else 0


if __name__ == "__main__":
    sys.exit(main())
