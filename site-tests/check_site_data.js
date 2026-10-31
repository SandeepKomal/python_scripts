// Site data is complete and consistent. Run with: node site-tests/check_site_data.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Q, quiz, sim } = require("./load");
const root = path.resolve(__dirname, "..");

let total = 0;
for (const lv of Q.levels) {
  for (const k of ["title", "topic", "stage", "lab", "cmd"]) assert.ok(lv[k], `level ${lv.id}: ${k}`);
  assert.ok(lv.learn.length >= 2, `level ${lv.id}: what you learn`);
  const items = quiz[lv.id] || [];
  assert.ok(items.length >= 5, `level ${lv.id} needs at least 5 quiz questions`);
  for (const it of items) {
    total++;
    assert.strictEqual(it.options.length, 4, `"${it.q}": 4 options`);
    assert.strictEqual(new Set(it.options).size, 4, `"${it.q}": options differ`);
    assert.ok(Number.isInteger(it.answer) && it.answer >= 0 && it.answer < 4, `"${it.q}": answer index`);
    assert.ok(it.why.length > 20, `"${it.q}": explanation`);
    for (const t of [it.q, it.why, ...it.options]) assert.strictEqual((t.match(/`/g) || []).length % 2, 0, `unbalanced backticks: ${t}`);
  }
}
assert.deepStrictEqual(Object.keys(quiz).sort(), Q.levels.map((l) => l.id).sort(), "quiz levels match the path");

// Troubleshoot: reference-style entries, unique ids, each in one group.
const ids = Q.doctor.map((d) => d.id);
assert.strictEqual(new Set(ids).size, ids.length, "troubleshoot ids are unique");
assert.deepStrictEqual(Q.doctorGroups.flatMap(([, g]) => g).sort(), [...ids].sort(), "every entry in exactly one group");
for (const d of Q.doctor) {
  for (const k of ["title", "error", "symptom", "fix", "prevent"]) assert.ok(d[k] && d[k].length > 5, `${d.id}: ${k}`);
  assert.ok(d.cause.length && d.confirm.length, `${d.id}: cause and confirm`);
  assert.ok(/^[a-z0-9]+$/.test(d.id), `${d.id}: link-safe id`);
  assert.ok(Q.levels.some((l) => l.id === d.level), `${d.id}: level`);
}
for (const must of ["ModuleNotFoundError", "ImportError", "IndentationError", "NoneType", "KeyError", "UnicodeDecodeError", "PermissionError", "ConnectionRefusedError",
  "CERTIFICATE_VERIFY_FAILED", "ReadTimeout", "JSONDecodeError", "RecursionError", "externally-managed-environment", "source: not found",
  "NoCredentialsError", "NoRegionError", "ExpiredToken", "InvalidClientTokenId", "SignatureDoesNotMatch", "AccessDenied", "UnauthorizedOperation", "Throttling",
  "EndpointConnectionError", "ParamValidationError", "DryRunOperation", "Only the first page", "WaiterError", "Personal data in logs"]) {
  assert.ok(Q.doctor.some((d) => d.title.includes(must) || d.error.includes(must)), `troubleshoot covers ${must}`);
}

// The scripts page matches scripts/ and scripts/aws/ (awskit.py is their shared module, not a script).
const pyIn = (dir, prefix) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".py") && f !== "awskit.py").map((f) => prefix + f);
assert.deepStrictEqual(Q.scripts.map((s) => s.file).sort(), [...pyIn("scripts", ""), ...pyIn("scripts/aws", "aws/")].sort(), "every script in scripts/ and scripts/aws/ is on the page");
for (const s of Q.scripts) assert.ok(s.usage.length && s.sample.length && s.exit, `${s.file}: usage, sample and exit`);

// Architecture: every component has its text.
for (const c of Q.architecture.components) for (const k of ["name", "short", "where", "role", "breaks"]) assert.ok(c[k], `${c.id}: ${k}`);

// The page's counts and required lines.
const html = fs.readFileSync(path.join(root, "site/index.html"), "utf8");
assert.ok(html.includes(`fix ${sim.SCENARIOS.length} real automation incidents`), "meta description states the real scenario count");
assert.ok(html.includes("Python® is a registered trademark of the Python Software Foundation. This project is independent and not affiliated with the PSF."), "trademark line");
assert.ok(html.includes("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'"), "CSP");
for (const f of fs.readdirSync(path.join(root, "site"))) {
  if (!/\.(js|html|css)$/.test(f)) continue;
  const t = fs.readFileSync(path.join(root, "site", f), "utf8");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(t), `${f}: no HTML injection APIs`);
  assert.ok(!/https?:\/\/(cdn|fonts|unpkg|ajax)\./.test(t), `${f}: nothing loaded from other sites`);
  if (f.endsWith(".html")) assert.ok(!/\sstyle="|\son[a-z]+="/.test(t), `${f}: no inline styles or handlers`);
}
assert.ok(fs.existsSync(path.join(root, "site/robots.txt")) && /problems\.html/.test(fs.readFileSync(path.join(root, "site/sitemap.xml"), "utf8")), "robots.txt and sitemap.xml");

console.log(`site data ok: ${Q.levels.length} levels, ${total} quiz questions, ${Q.doctor.length} problems, ${Q.scripts.length} scripts`);
