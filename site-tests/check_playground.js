// Every scenario starts broken, its fix solves it, and each tempting wrong
// edit does not. The cheat sheet's Try and Lab marks are checked against the
// fixes, so neither list goes stale. Run with: node site-tests/check_playground.js
"use strict";
const assert = require("assert");
const { Q, sim } = require("./load");
const { SCENARIOS, evaluate, won, applyEdits, solution, parse, syntax } = sim;

const ids = new Set();
for (const s of SCENARIOS) {
  assert.ok(!ids.has(s.id), `${s.id}: duplicate id`);
  ids.add(s.id);
  for (const k of ["group", "title", "file", "cmd", "story", "goal", "lesson"]) assert.ok(typeof s[k] === "string" && s[k].length > 2, `${s.id}: ${k}`);
  assert.strictEqual(s.hints.length, 3, `${s.id}: three graded hints`);
  assert.ok(s.checks.length >= 1 && s.real.length >= 1, `${s.id}: checks and a real command`);
  assert.ok(s.wrong.length >= 1, `${s.id}: at least one wrong move`);
  assert.ok(Q.levels.some((l) => l.id === s.level), `${s.id}: level ${s.level} exists`);
  const start = evaluate(s, s.code);
  assert.ok(!won(start), `${s.id}: must start broken`);
  if (!s.lang && s.id !== "indent") assert.strictEqual(syntax(parse(s.code)), null, `${s.id}: the starting script parses (the bug is behaviour, not syntax)`);
  const fixed = evaluate(s, solution(s));
  assert.ok(won(fixed), `${s.id}: the fix must solve it, got ${JSON.stringify(fixed.checks)}`);
  s.wrong.forEach((w, i) => assert.ok(!won(evaluate(s, applyEdits(s.code, w))), `${s.id}: wrong move ${i + 1} must not solve it`));
  for (const st of [start, fixed]) for (const line of st.out) assert.ok(Array.isArray(line) && typeof line[0] === "string", `${s.id}: output lines are [text, class]`);
}
assert.ok(SCENARIOS.length >= 30, "at least 30 scenarios");

// Real error formats.
const err = (src) => syntax(parse(src));
assert.strictEqual(err("if x:\nprint(1)\n").msg, "IndentationError: expected an indented block after 'if' statement on line 1");
assert.strictEqual(err("x = 1\n    y = 2\n").msg, "IndentationError: unexpected indent");
assert.strictEqual(err("x = foo(1,\n").msg, "SyntaxError: '(' was never closed");
assert.strictEqual(err("if x\n    pass\n").msg, "SyntaxError: expected ':'");
assert.strictEqual(err("x = (1]\n").msg, "SyntaxError: closing parenthesis ']' does not match opening parenthesis '('");
assert.strictEqual(err("for a, b in [\n    (1, 2),\n]:\n    pass\n"), null, "a header whose colon is on a continuation line");
const timeout = SCENARIOS.find((s) => s.id === "timeout");
assert.match(evaluate(timeout, timeout.code.replace("import sys\n", "")).out.map((l) => l[0]).join("\n"), /NameError: name 'sys' is not defined/);

// Cheat sheet: Try rows appear in that scenario's fix; Lab rows in none.
const flat = (s) => s.replace(/\s+/g, " ");
const fixes = Object.fromEntries(SCENARIOS.map((s) => [s.id, flat(solution(s))]));
for (const [code, , , where] of Q.cheats) {
  if (where) assert.ok((fixes[where] || "").includes(flat(code)), `cheat sheet: "${code}" should appear in the fix of ${where}`);
  else assert.ok(!Object.values(fixes).some((f) => f.includes(flat(code))), `cheat sheet: "${code}" is in a fix; give it a Try`);
}

// Every link to a scenario resolves.
for (const d of Q.doctor) for (const id of d.scenarios) assert.ok(ids.has(id), `troubleshoot ${d.id} links to unknown scenario ${id}`);
for (const l of Q.levels) for (const id of l.scenarios) assert.ok(ids.has(id), `level ${l.id} links to unknown scenario ${id}`);
for (const c of Q.architecture.components) for (const id of c.practise) assert.ok(ids.has(id), `architecture ${c.id} links to unknown scenario ${id}`);
for (const [, , , id] of Q.architecture.stdlib) assert.ok(ids.has(id), `stdlib map links to unknown scenario ${id}`);

console.log(`playground ok: ${SCENARIOS.length} scenarios, ${Q.cheats.length} cheat sheet rows`);
