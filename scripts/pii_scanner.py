#!/usr/bin/env python3
"""Scan files and logs for Indian personal data: Aadhaar, PAN, mobile, UPI, email, bank, passport, voter ID.

A gate for CI and pre-commit, and a check before logs or exports leave a
system. Aadhaar numbers must pass the Verhoeff checksum; bank account
numbers count only next to an IFSC code; mobile numbers need +91 or a
word like "phone" on the line, and passport and voter ID numbers need
their word (--loose drops those context rules). Emails at reserved example
domains are ignored. Every match is printed masked, never in full, with a
count per file. Known false positives go in an allowlist file (one regular
expression per line).

Usage:
  pii_scanner.py [paths ...] [--allowlist .piiallow] [--loose] [--json]
  git diff --cached --name-only | pii_scanner.py --stdin-files

Exit: 0 clean, 1 personal data found, 2 usage error.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

# Verhoeff checksum tables: multiplication (D) and permutation (P).
D = ["0123456789", "1234067895", "2340178956", "3401289567", "4012395678", "5987604321", "6598710432", "7659821043", "8765932104", "9876543210"]
P = ["0123456789", "1576283094", "5803796142", "8916043527", "9453126870", "4286573901", "2793806415", "7046913258"]

CONTEXT = {
    "mobile": re.compile(r"(?i)mobile|phone|\btel\b|contact|whatsapp|msisdn|\bcell"),
    "passport": re.compile(r"(?i)passport"),
    "voter": re.compile(r"(?i)voter|\bepic\b|electoral"),
}
EXAMPLE_DOMAIN = re.compile(r"(?i)@(.+\.)?(example\.(com|org|net)|[\w-]+\.(example|test|invalid|localhost))$")
IFSC = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")

# [kind, pattern, context rule or None]
RULES = [
    ("Aadhaar number", re.compile(r"(?<![\d-])[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?![\d-])"), None),
    ("PAN", re.compile(r"\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b"), None),
    ("Email address", re.compile(r"\b[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\b"), None),
    ("UPI ID", re.compile(r"(?<![\w.+-])[\w.-]{2,256}@[A-Za-z]{2,64}(?![\w.@-])"), None),
    ("Indian mobile number", re.compile(r"(?<![\w+])(\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b"), "mobile"),
    ("Passport number", re.compile(r"\b[A-PR-WY][1-9]\d{5}[1-9]\b"), "passport"),
    ("Voter ID (EPIC)", re.compile(r"\b[A-Z]{3}\d{7}\b"), "voter"),
    ("Bank account number", re.compile(r"(?<![\w-])\d{9,18}(?![\w-])"), "ifsc"),
]
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".terraform"}
SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".gz", ".tar", ".jar", ".woff", ".woff2", ".lock"}


def verhoeff_ok(digits):
    check = 0
    for i, d in enumerate(reversed(digits)):
        check = int(D[check][int(P[i % 8][int(d)])])
    return check == 0


def valid(kind, value):
    if kind == "Aadhaar number":
        return verhoeff_ok(re.sub(r"\D", "", value))
    if kind == "Email address":
        return not EXAMPLE_DOMAIN.search(value)
    return True


def find(line, loose=False):
    """[(kind, start, end)] for personal data in one line; overlapping matches count once."""
    spans = []
    for kind, rule, context in RULES:
        if context == "ifsc" and not IFSC.search(line):
            continue
        if context in CONTEXT and not loose and not (kind == "Indian mobile number" and "+91" in line) and not CONTEXT[context].search(line):
            continue
        for m in rule.finditer(line):
            if valid(kind, m.group(0)) and not any(s < m.end() and m.start() < e for _, s, e in spans):
                spans.append((kind, m.start(), m.end()))
    return sorted(spans, key=lambda s: s[1])


def mask(value):
    return "…" + value[-2:]


def scan_text(text, allow=(), loose=False):
    hits = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if any(a.search(line) for a in allow):
            continue
        hits += [{"line": lineno, "kind": kind, "match": mask(line[s:e])} for kind, s, e in find(line, loose)]
    return hits


def walk(paths):
    for p in paths:
        if os.path.isfile(p):
            yield p
            continue
        for root, dirs, files in os.walk(p):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            for f in files:
                if os.path.splitext(f)[1].lower() not in SKIP_EXT:
                    yield os.path.join(root, f)


def load_allowlist(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [re.compile(line.strip()) for line in f if line.strip() and not line.startswith("#")]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("paths", nargs="*", default=["."])
    ap.add_argument("--stdin-files", action="store_true", help="read file names from standard input")
    ap.add_argument("--allowlist", default=".piiallow")
    ap.add_argument("--loose", action="store_true", help="also report mobile, passport and voter ID numbers without a context word")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    paths = [line.strip() for line in sys.stdin if line.strip()] if args.stdin_files else args.paths
    try:
        allow = load_allowlist(args.allowlist)
    except re.error as e:
        print(f"error: {args.allowlist}: {e}", file=sys.stderr)
        return 2

    findings = []
    for path in walk(paths):
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read(5_000_000)
        except (UnicodeDecodeError, OSError):
            continue
        findings += [{"file": path, **h} for h in scan_text(text, allow, args.loose)]

    if args.json:
        print(json.dumps(findings, indent=2, ensure_ascii=False))
    else:
        for h in findings:
            print(f"{h['file']}:{h['line']}: {h['kind']} ({h['match']})")
        per_file = Counter(h["file"] for h in findings)
        for path, n in per_file.most_common():
            kinds = Counter(h["kind"] for h in findings if h["file"] == path)
            print(f"{n:>6}  {path}  ({', '.join(f'{k} {c}' for k, c in kinds.most_common())})")
        print(f"{len(findings)} item(s) of personal data in {len(per_file)} file(s)." if findings else "No personal data found.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
