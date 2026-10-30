// Script X-ray: the repository's own scripts are fully explained and raise no
// warnings; the risky example raises each warning. Run with: node site-tests/check_xray.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Q, xray } = require("./load");

const dir = path.resolve(__dirname, "../scripts");
let lines = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".py"))) {
  const r = xray.explain(fs.readFileSync(path.join(dir, f), "utf8"));
  assert.strictEqual(r.syntax, null, `${f}: parses`);
  for (const l of r.lines) {
    if (l.level === "blank") continue;
    lines++;
    assert.ok(l.note, `${f}: a note for "${l.line}"`);
    assert.notStrictEqual(l.level, "unknown", `${f}: "${l.line}" is not in the dictionary`);
    assert.deepStrictEqual(l.warns || [], [], `${f}: no false alarm on "${l.line.trim()}"`);
  }
  assert.deepStrictEqual(r.review, [], `${f}: nothing essential missing`);
}

const risky = xray.explain(Q.xrayExamples[0].text);
const warns = risky.lines.flatMap((l) => l.warns || []).join("\n");
for (const re of [/No timeout/, /verify=False/, /bare except/, /shell=True with text/, /os\.system/, /eval\/exec/, /credential written into the code/, /yaml\.load without SafeLoader/,
  /Unpickling/, /mutable default/, /open\(\) outside a with/, /fixed sleep in a retry/, /prints or logs something that looks like a credential/, /exit status is ignored/, /sys\.argv\[n\]/, /fixed name in \/tmp/]) {
  assert.match(warns, re);
}
assert.ok(risky.review.some((r) => /__main__/.test(r)), "review: missing __main__ guard");
const careful = xray.explain(Q.xrayExamples[1].text);
assert.ok(careful.lines.every((l) => !l.warns || !l.warns.length) && !careful.review.length, "the careful example is clean");
assert.match(xray.explain("x\n".repeat(700)).error, /up to 600 lines/);
assert.match(xray.explain("def f(:\n").syntax || "", /SyntaxError|IndentationError/);

console.log(`xray ok: ${lines} lines of the repository's scripts explained, no false alarms`);
