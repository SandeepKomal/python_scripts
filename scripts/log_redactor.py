#!/usr/bin/env python3
"""Mask Indian personal data in logs: on a stream (stdin to stdout), or in files in place.

Uses pii_scanner.py's rules (keep the two files together) and replaces each
match with a label such as [AADHAAR] or [PHONE], so the line still says what
was there. As a filter it changes nothing on disk:
  journalctl -u app | log_redactor.py > shareable.log
Given files, it reports how much it would mask; --apply rewrites each file
atomically (a temporary file in the same directory, then os.replace), keeping
its permissions. Use it on rotated logs, not on a file a process still writes
(the writer keeps the old file open, and its new lines would be lost). Decompress .gz logs first.

Usage:
  app | log_redactor.py [--loose]
  log_redactor.py /var/log/app/*.log            (report only)
  log_redactor.py /var/log/app/*.log --apply

Exit: 0 ok, 1 a file could not be read or rewritten, 2 usage error.
"""
import argparse
import os
import sys
import tempfile
from collections import Counter

import pii_scanner

LABELS = {"Aadhaar number": "[AADHAAR]", "PAN": "[PAN]", "Email address": "[EMAIL]", "UPI ID": "[UPI]", "Indian mobile number": "[PHONE]",
          "Passport number": "[PASSPORT]", "Voter ID (EPIC)": "[VOTER_ID]", "Bank account number": "[BANK_ACCOUNT]"}


def redact(line, loose=False, counts=None):
    """The line with every match replaced by its label; counts (a Counter) is updated."""
    out, last = [], 0
    for kind, start, end in pii_scanner.find(line, loose):
        out += [line[last:start], LABELS[kind]]
        last = end
        if counts is not None:
            counts[kind] += 1
    return "".join(out) + line[last:]


def rewrite(path, loose):
    """Redact one file in place, atomically. Returns the Counter of what was masked."""
    counts = Counter()
    folder = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".redact-")
    try:
        with open(path, encoding="utf-8", errors="surrogateescape", newline="") as src, os.fdopen(fd, "w", encoding="utf-8", errors="surrogateescape", newline="") as dst:
            for line in src:
                dst.write(redact(line, loose, counts))
        os.chmod(tmp, os.stat(path).st_mode & 0o7777)
        os.replace(tmp, path)
    except BaseException:
        os.unlink(tmp)
        raise
    return counts


def count(path, loose):
    counts = Counter()
    with open(path, encoding="utf-8", errors="surrogateescape") as f:
        for line in f:
            redact(line, loose, counts)
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="*", help="files to redact; none (or -) filters stdin to stdout")
    ap.add_argument("--apply", action="store_true", help="rewrite the files; otherwise only report")
    ap.add_argument("--loose", action="store_true", help="also mask mobile, passport and voter ID numbers without a context word")
    args = ap.parse_args(argv)
    if not args.files or args.files == ["-"]:
        for line in sys.stdin:
            sys.stdout.write(redact(line, args.loose))
        return 0

    failed = 0
    for path in args.files:
        try:
            counts = rewrite(path, args.loose) if args.apply else count(path, args.loose)
        except OSError as e:
            print(f"error: {path}: {e.strerror}", file=sys.stderr)
            failed += 1
            continue
        total = sum(counts.values())
        detail = ", ".join(f"{LABELS[k]} {n}" for k, n in counts.most_common())
        print(f"{path}: {'masked' if args.apply else 'would mask'} {total}" + (f" ({detail})" if total else ""))
    if not args.apply:
        print("\nNothing was changed. Run again with --apply to rewrite the files.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
