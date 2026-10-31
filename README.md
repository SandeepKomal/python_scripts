# DevOps Nimbus Python

**Python for DevOps, zero to on-call.** Tested automation scripts for operations, AWS and personal data, and a free site that teaches Python for DevOps from the first venv to boto3 and privacy engineering, for anyone who runs servers or pipelines.

[![Learning site](https://img.shields.io/badge/learn-DevOps%20Nimbus-1d1d1f)](https://sandeepkomal.github.io/python_scripts/)
[![CI](https://github.com/SandeepKomal/python_scripts/actions/workflows/ci.yml/badge.svg)](https://github.com/SandeepKomal/python_scripts/actions/workflows/ci.yml)
[![Pages](https://github.com/SandeepKomal/python_scripts/actions/workflows/pages.yml/badge.svg)](https://github.com/SandeepKomal/python_scripts/actions/workflows/pages.yml)
[![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://docs.python.org/3/)
[![AWS](https://img.shields.io/badge/AWS-boto3-FF9900)](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)
![Security](https://img.shields.io/badge/security-secret%20scan-2ea44f)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![No trackers](https://img.shields.io/badge/site-no%20trackers%20%C2%B7%20no%20cookies-2ea44f)
[![Contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen)](https://github.com/SandeepKomal/python_scripts/issues)
![Last commit](https://img.shields.io/github/last-commit/SandeepKomal/python_scripts)
[![GitHub stars](https://img.shields.io/github/stars/SandeepKomal/python_scripts?style=social)](https://github.com/SandeepKomal/python_scripts/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/SandeepKomal/python_scripts?style=social)](https://github.com/SandeepKomal/python_scripts/network/members)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/SandeepKomal/python_scripts)

**[Open the learning site](https://sandeepkomal.github.io/python_scripts/)** · [Troubleshoot an error](https://sandeepkomal.github.io/python_scripts/#fix) · [Every error on one page](https://sandeepkomal.github.io/python_scripts/problems.html) · [All DevOps Nimbus tracks](https://sandeepkomal.github.io/devops-nimbus/)

## Contents

- [Learn it in your browser](#learn-it-in-your-browser)
- [What's in this repository](#whats-in-this-repository)
- [Quick start](#quick-start)
- [Scripts](#scripts)
- [AWS automation with boto3](#aws-automation-with-boto3)
- [Personal data and India's DPDP Act](#personal-data-and-indias-dpdp-act)
- [Repository layout](#repository-layout)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Security](#security)
- [Privacy and cost](#privacy-and-cost)
- [License and trademarks](#license-and-trademarks)
- [Author and contributors](#author-and-contributors)

## Learn it in your browser

[`site/`](site) is **Python for DevOps**, a [DevOps Nimbus](https://sandeepkomal.github.io/devops-nimbus/) track: a free static site published with GitHub Pages with a playground of 53 real automation incidents (scripts that hang, leak secrets, fail silently or break under cron), an eighteen-level path, a quiz, a Script X-ray that explains pasted Python and flags risky patterns, a troubleshooting reference for common Python errors (also as one plain page, [`problems.html`](site/problems.html)), a cheat sheet and an architecture page. It loads nothing from other sites and keeps progress only in your browser.

- A scoreboard tracks your score, a skill radar per stage, your learning uptime and on-call shifts; **Download my progress** and **Load my progress** move it to another browser.

```bash
python3 -m http.server 8000 --directory site    # then open http://localhost:8000
node tools/build-problems.js                    # after changing the troubleshooting data, scenarios or quiz
for t in check_site_data check_playground check_xray check_problems fuzz; do node site-tests/$t.js; done
```

## What's in this repository

Practical automation for the jobs that come up every week in operations. Every
script uses only the Python standard library (3.10 or newer), so there is
nothing to install, nothing to audit in a dependency tree, and it runs on any
server that has Python.

Each script has `--help`, safe defaults (it reports before it deletes, and
never prints a secret), JSON output where another tool might read it, and an
exit code you can use in cron or CI.

The one exception is [`scripts/aws/`](scripts/aws): AWS automation that needs boto3, pinned with hashes in its own [`requirements-aws.txt`](requirements-aws.txt). The scripts in `scripts/` keep working without it.

## Quick start

```bash
git clone https://github.com/SandeepKomal/python_scripts.git && cd python_scripts
python3 scripts/log_analyzer.py --help
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r requirements-aws.txt    # only for scripts/aws/
.venv/bin/python scripts/aws/aws_inventory.py --region eu-west-1
```

## Scripts

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
| [`pii_scanner.py`](scripts/pii_scanner.py) | Indian personal data in files and logs (Aadhaar with the Verhoeff check, PAN, mobile, UPI, email, bank account with IFSC, passport, voter ID); masked output, counts per file, for CI and pre-commit |
| [`log_redactor.py`](scripts/log_redactor.py) | Masks the same identifiers on a stream, or in log files in place with `--apply` (atomic, permissions kept) |
| [`pii_retention.py`](scripts/pii_retention.py) | Files with personal data older than a retention period; a report first, deletes with `--apply` |
| [`aws/aws_inventory.py`](scripts/aws/aws_inventory.py) | EC2, EBS, RDS, Lambda and load balancers per region, plus S3 buckets |
| [`aws/ec2_scheduler.py`](scripts/aws/ec2_scheduler.py) | Stop or start instances by tag; EC2 dry run by default, `--apply` and `--wait`; skips Auto Scaling members |
| [`aws/unused_resources.py`](scripts/aws/unused_resources.py) | Unattached volumes, unassociated Elastic IPs, old snapshots and idle load balancers, with an estimated monthly cost |
| [`aws/ebs_snapshot_cleanup.py`](scripts/aws/ebs_snapshot_cleanup.py) | Deletes old snapshots, never one behind an AMI; dry run by default |
| [`aws/s3_security_audit.py`](scripts/aws/s3_security_audit.py) | Public access, encryption, versioning, TLS-only policy, ACLs and logging for every bucket |
| [`aws/iam_access_audit.py`](scripts/aws/iam_access_audit.py) | Credential report: root keys, users without MFA, old and unused access keys |
| [`aws/sg_exposure_audit.py`](scripts/aws/sg_exposure_audit.py) | Security group rules open to the internet, and whether anything uses them |
| [`aws/tag_compliance.py`](scripts/aws/tag_compliance.py) | Resources missing required tags or with values outside the allowed list |
| [`aws/ssm_params.py`](scripts/aws/ssm_params.py) | Parameter Store and Secrets Manager audit and required names, without reading a value |
| [`aws/cloudwatch_alarm_audit.py`](scripts/aws/cloudwatch_alarm_audit.py) | Alarms with no action, a missing SNS topic, stale data or a deleted instance |
| [`aws/pii_storage_audit.py`](scripts/aws/pii_storage_audit.py) | S3, RDS and EBS tagged as personal data that are unencrypted, public or outside the expected regions |

### Examples

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

```bash
python3 scripts/pii_scanner.py logs/ exports/
journalctl -u app --since today | python3 scripts/log_redactor.py > shareable.log
python3 scripts/pii_retention.py /srv/exports --days 180 --pattern '*.csv'           # look first, then add --apply
.venv/bin/python scripts/aws/unused_resources.py --all-regions --json
.venv/bin/python scripts/aws/ec2_scheduler.py stop --tag Schedule=office-hours --region eu-west-1   # dry run; add --apply
```

## AWS automation with boto3

Every script in `scripts/aws/` shares [`awskit.py`](scripts/aws/awskit.py) (keep it next to them):

- `--profile`, `--region` or `--all-regions` (the regions enabled for the account), and `--json`.
- Credentials only from the standard chain: environment, profile, SSO, or the instance or task role. Nothing reads or prints a key.
- `botocore.config.Config(retries={"mode": "adaptive"})` with connect and read timeouts on every client, and paginators for every list call.
- Clear one-line messages for missing credentials or region, expired or rejected credentials, denied permissions, throttling and endpoint errors; with `--all-regions`, one failing region is reported and the rest still run.
- Anything that changes AWS is a dry run until `--apply`, and EC2 calls use `DryRun=True` so a missing permission shows up first.
- Each header lists the minimum IAM policy as JSON, usage and exit codes: 0 ok, 1 findings or a failed action, 2 usage, credential or permission error.

The tests use botocore's Stubber, so they need no network and no AWS account.

## Personal data and India's DPDP Act

`pii_scanner.py`, `log_redactor.py`, `pii_retention.py` and `aws/pii_storage_audit.py` help teams handle personal data as the Digital Personal Data Protection Act, 2023 expects: find it, keep it out of logs, erase it after its retention period, and keep where it is stored encrypted and private. They never print the data they find. Level 17 on the site explains what the Act asks of a Data Fiduciary and how engineers implement it. This is practical engineering guidance, not legal advice.

## Repository layout

| Path | What it holds |
| --- | --- |
| [`scripts/`](scripts) | The standard-library scripts |
| [`scripts/aws/`](scripts/aws) | The boto3 scripts and their shared `awskit.py` |
| [`tests/`](tests) | `unittest` tests; `test_aws.py` uses botocore's Stubber |
| [`requirements-aws.txt`](requirements-aws.txt) | boto3 and its dependencies, exact versions with hashes |
| [`site/`](site) | The learning site (static HTML, CSS and JavaScript) |
| [`site-tests/`](site-tests) | Node tests and a fuzzer for the site |
| [`tools/`](tools) | Generator for `site/problems.html` and `site/scenario-index.js` |
| [`.github/workflows/`](.github/workflows) | CI and the GitHub Pages deploy |

## Troubleshooting

The site's [Troubleshoot](https://sandeepkomal.github.io/python_scripts/#fix) tab gives the cause, the commands to confirm it, the fix and how to prevent it for common Python, boto3 and personal-data errors; [`problems.html`](https://sandeepkomal.github.io/python_scripts/problems.html) has every entry on one page.

## Contributing

Issues and pull requests are welcome in the [issue tracker](https://github.com/SandeepKomal/python_scripts/issues). Run the same checks as CI before you open one:

```bash
python3 -m unittest discover -s tests -v
```

CI runs the tests on Python 3.10 and 3.15, the oldest and newest supported releases, the secret scanner over the repository, and the site's Node tests and fuzzer, on every pull request.

With `requirements-aws.txt` installed, the same command also runs the AWS tests; without it they are skipped.

## Security

Never commit credentials. `scripts/secret_scanner.py` is a fast first check; known false positives go in `.secretsallow`, one regular expression per line, each with a comment saying why it is safe.

To report a vulnerability, contact [@SandeepKomal](https://github.com/SandeepKomal) privately rather than opening a public issue. CI runs the secret scanner on every pull request.

## Privacy and cost

The site runs entirely in your browser: no accounts, cookies, trackers or database, and your progress stays in your browser. It is free, hosted on GitHub Pages. See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

The scripts in `scripts/aws/` call AWS APIs with your credentials. The audits only read, though some AWS APIs are billed per request, and anything run with `--apply` changes or deletes resources in your account.

## License and trademarks

MIT. See [LICENSE](LICENSE).

Python® is a registered trademark of the Python Software Foundation. Amazon Web Services, AWS and the related marks are trademarks of Amazon.com, Inc. or its affiliates. This project is independent and not affiliated with either.

## Author and contributors

**Sandeep Komal** · [github.com/SandeepKomal](https://github.com/SandeepKomal)

Built and maintained with [DevopsNimbus](https://github.com/DevopsNimbus). See everyone who has contributed in the [contributors graph](https://github.com/SandeepKomal/python_scripts/graphs/contributors).

If this helped you, a ⭐ on the repository helps others find it.
