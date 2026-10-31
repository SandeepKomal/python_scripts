# Python scripts for DevOps and DevSecOps

Practical automation for the jobs that come up every week in operations. Every
script uses only the Python standard library (3.10 or newer), so there is
nothing to install, nothing to audit in a dependency tree, and it runs on any
server that has Python.

Each script has `--help`, safe defaults (it reports before it deletes, and
never prints a secret), JSON output where another tool might read it, and an
exit code you can use in cron or CI.

| Script | What it is for |
| --- | --- |
| [`log_analyzer.py`](scripts/log_analyzer.py) | nginx/Apache logs: requests, status mix, 5xx rate, p50/p95/p99 latency, top clients, failing and slowest paths; fails above a 5xx threshold |
| [`http_monitor.py`](scripts/http_monitor.py) | Many URLs at once: status, body text and latency, with retries; for post-deploy smoke tests and cron checks |
| [`cert_checker.py`](scripts/cert_checker.py) | TLS certificate expiry and validity for many hosts, with JSON for dashboards |
| [`port_check.py`](scripts/port_check.py) | Is `host:port` reachable from here, or, with `--expect closed`, properly firewalled? |
| [`backup_retention.py`](scripts/backup_retention.py) | Grandfather-father-son retention (daily, weekly, monthly) for dated backups; reports before deleting |
| [`env_validator.py`](scripts/env_validator.py) | `.env` against `.env.example`: missing, empty, placeholder and extra variables, without printing any value |
| [`secret_scanner.py`](scripts/secret_scanner.py) | Committed keys, tokens, private keys and passwords; masked output, allowlist, pre-commit friendly |
| [`disk_report.py`](scripts/disk_report.py) | Biggest directories and files in one pass on one file system, with an alert threshold |
| [`webhook_notify.py`](scripts/webhook_notify.py) | Alerts to Slack, Microsoft Teams, Discord or any JSON webhook; the URL comes from an environment variable |

## Examples

```bash
zcat /var/log/nginx/access.log.*.gz | python3 scripts/log_analyzer.py - --top 20
python3 scripts/http_monitor.py --file endpoints.txt --slow 0.8
python3 scripts/cert_checker.py example.com api.example.com:8443 --json
python3 scripts/port_check.py db.internal:5432 cache.internal:6379
python3 scripts/backup_retention.py /backups --pattern '*.tar.gz'     # look first, then add --delete
python3 scripts/env_validator.py .env
git diff --cached --name-only | python3 scripts/secret_scanner.py --stdin-files
python3 scripts/disk_report.py /var --alert-percent 85
backup.sh || WEBHOOK_URL=https://hooks.slack.com/... python3 scripts/webhook_notify.py "backup failed on $(hostname)" --level error
```

## Learning site

[`site/`](site) is **Python for DevOps**, a [DevOps Nimbus](https://sandeepkomal.github.io/devops-nimbus/) track: a free static site published with GitHub Pages with a playground of 48 real automation incidents (scripts that hang, leak secrets, fail silently or break under cron), a fourteen-level path, a quiz, a Script X-ray that explains pasted Python and flags risky patterns, a troubleshooting reference for common Python errors (also as one plain page, [`problems.html`](site/problems.html)), a cheat sheet and an architecture page. It loads nothing from other sites and keeps progress only in your browser.

```bash
python3 -m http.server 8000 --directory site    # then open http://localhost:8000
node tools/build-problems.js                    # after changing the troubleshooting data
for t in check_site_data check_playground check_xray check_problems fuzz; do node site-tests/$t.js; done
```

## Tests

```bash
python3 -m unittest discover -s tests -v
```

CI runs the tests on Python 3.10 and 3.15, the oldest and newest supported releases, the secret scanner over the repository, and the site's Node tests and fuzzer, on every pull request.

## Security

Never commit credentials. `scripts/secret_scanner.py` is a fast first check; known false positives go in `.secretsallow`, one regular expression per line, each with a comment saying why it is safe.

## License

MIT. See [LICENSE](LICENSE).
