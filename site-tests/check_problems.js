// site/problems.html is generated from the troubleshooting data, and
// site/scenario-index.js from the scenarios and quiz bank; both must be
// current. Regenerate with: node tools/build-problems.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const { render, target, scenarioIndex, indexTarget } = require("../tools/build-problems");
const { Q } = require("./load");

const html = render();
assert.strictEqual(fs.readFileSync(target, "utf8"), html, "site/problems.html is stale: run node tools/build-problems.js");
assert.strictEqual(fs.readFileSync(indexTarget, "utf8"), scenarioIndex(), "site/scenario-index.js is stale: run node tools/build-problems.js");
assert.ok(!/<script/i.test(html), "problems.html works without JavaScript");
for (const d of Q.doctor) assert.ok(html.includes(`id="${d.id}"`), `problems.html has a section for ${d.id}`);
console.log(`problems ok: ${Q.doctor.length} sections, in sync; scenario index in sync`);
