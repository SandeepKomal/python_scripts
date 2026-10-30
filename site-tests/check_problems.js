// site/problems.html is generated from the troubleshooting data; it must be
// current. Regenerate with: node tools/build-problems.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const { render, target } = require("../tools/build-problems");
const { Q } = require("./load");

const html = render();
assert.strictEqual(fs.readFileSync(target, "utf8"), html, "site/problems.html is stale: run node tools/build-problems.js");
assert.ok(!/<script/i.test(html), "problems.html works without JavaScript");
for (const d of Q.doctor) assert.ok(html.includes(`id="${d.id}"`), `problems.html has a section for ${d.id}`);
console.log(`problems ok: ${Q.doctor.length} sections, in sync`);
