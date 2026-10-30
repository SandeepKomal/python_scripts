// Throws thousands of random and mangled scripts at the playground's
// evaluator and at the X-ray. Any exception fails. Run with: node site-tests/fuzz.js [rounds]
"use strict";
const assert = require("assert");
const { sim, xray, Q } = require("./load");
const { SCENARIOS, evaluate, solution, applyEdits } = sim;

let seed = 20261030;
const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const pick = (a) => a[rand(a.length)];
const TOKENS = ["(", ")", "[", "]", "{", "}", ":", "'", "\"", "\"\"\"", "#", "\\", "\t", "    ", "\n", "=", "==", ",", ".", "**", "lambda", "def f(", "class C:", "try:", "except:",
  "with open(x) as f:", "if", "else:", "for x in y:", "while True:", "return", "import os", "from x import *", "subprocess.run(", "requests.get(", "shell=True", "timeout=", "check=True",
  "eval(", "yaml.load(", "pickle.load(", "async def", "await", "@functools.lru_cache(maxsize=None)", "sys.exit(", "é", "\u0000", "\uFFFD", "😀", "\r\n", "None", "0x", "1e9"];
const mutate = (src) => {
  const lines = src.split("\n");
  for (let k = 0; k < 1 + rand(5); k++) {
    const i = rand(lines.length + 1);
    const op = rand(5);
    if (op === 0) lines.splice(i, 1);
    else if (op === 1) lines.splice(i, 0, Array.from({ length: 1 + rand(6) }, () => pick(TOKENS)).join(pick(["", " "])));
    else if (op === 2 && lines[i]) lines[i] = lines[i].slice(0, rand(lines[i].length + 1));
    else if (op === 3 && lines[i]) lines[i] = " ".repeat(rand(9)) + lines[i].trimStart();
    else if (lines[i]) lines[i] = lines[i] + pick(TOKENS);
  }
  return lines.join(pick(["\n", "\r\n"]));
};

const rounds = Number(process.argv[2]) || 6000;
for (let r = 0; r < rounds; r++) {
  const s = SCENARIOS[r % SCENARIOS.length];
  const base = pick([s.code, solution(s), ...s.wrong.map((w) => applyEdits(s.code, w))]);
  const src = rand(10) === 0 ? Array.from({ length: rand(200) }, () => String.fromCharCode(rand(0x2fff))).join("") : mutate(base);
  try {
    const st = evaluate(s, src);
    assert.ok(Array.isArray(st.out) && st.out.every((l) => typeof l[0] === "string") && Number.isInteger(st.exit));
    const x = xray.explain(src);
    assert.ok(x.error || Array.isArray(x.lines));
  } catch (e) {
    console.error(`scenario ${s.id}, round ${r}, source: ${JSON.stringify(src)}`);
    throw e;
  }
}
for (const t of ["", "\n\n", "(((((", "'''", "\"", "\\", ")]}", "x".repeat(5000), Q.xrayExamples[0].text.repeat(3)]) {
  xray.explain(t);
  for (const s of SCENARIOS) evaluate(s, t);
}
console.log(`fuzz ok: ${rounds} mangled scripts, no exceptions`);
