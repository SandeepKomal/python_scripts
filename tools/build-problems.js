// Writes site/problems.html: every troubleshooting entry as plain HTML that
// reads without JavaScript and can be indexed by search engines.
// Run with: node tools/build-problems.js   (site-tests/check_problems.js keeps it in sync)
"use strict";
const fs = require("fs");
const path = require("path");

const site = path.resolve(__dirname, "../site");
function render() {
  global.window = globalThis;
  for (const f of ["data.js", "scenarios.js", "playground.js"]) require(path.join(site, f));
  const Q = window.TRACK;
  const titles = Object.fromEntries(window.PYSim.SCENARIOS.map((s) => [s.id, s.title]));
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rich = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
  const byId = Object.fromEntries(Q.doctor.map((d) => [d.id, d]));
  const levels = Object.fromEntries(Q.levels.map((l) => [l.id, l.title]));
  const toc = Q.doctorGroups.map(([group, ids]) => `      <h2>${esc(group)}</h2>\n      <ul>\n${ids.map((id) => `        <li><a href="#${id}">${esc(byId[id].title)}</a></li>`).join("\n")}\n      </ul>`).join("\n");
  const entries = Q.doctorGroups.flatMap(([, ids]) => ids).map((id) => {
    const d = byId[id];
    const practise = d.scenarios.filter((s) => titles[s]).map((s) => `<a href="index.html#play/${s}">${esc(titles[s])}</a>`).join(", ");
    const level = `<a href="index.html#path/${d.level}">Level ${d.level} · ${esc(levels[d.level])}</a>`;
    return `    <section class="card fix" id="${d.id}">
      <h2>${esc(d.title)}</h2>
      <pre class="err-text"><code>${esc(d.error)}</code></pre>
      <h3>Symptom</h3>
      <p>${rich(d.symptom)}</p>
      <h3>Why it happens</h3>
      <ul>
${d.cause.map((c) => `        <li>${rich(c)}</li>`).join("\n")}
      </ul>
      <h3>Confirm</h3>
      <pre><code>${esc(d.confirm.join("\n"))}</code></pre>
      <h3>Fix</h3>
      <p>${rich(d.fix)}</p>
      <h3>Prevent</h3>
      <p>${rich(d.prevent)}</p>
      <p><strong>Now learn it:</strong> ${practise ? `break and fix it yourself in ${practise}, then take ${level}` : `take ${level}`}. Interactive version: <a href="index.html#fix/${d.id}">#fix/${d.id}</a>.</p>
    </section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="description" content="Common Python errors in automation scripts, each with the exact error text, its cause, how to confirm it, the fix and how to prevent it: ${esc(Q.doctor.slice(0, 6).map((d) => d.title.split(":")[0]).join(", "))} and more.">
  <meta property="og:type" content="article">
  <meta property="og:title" content="Python errors and fixes for DevOps">
  <meta property="og:description" content="${Q.doctor.length} common Python errors in automation, with cause, fix and prevention.">
  <meta property="og:url" content="${Q.site}problems.html">
  <link rel="canonical" href="${Q.site}problems.html">
  <title>Python errors and fixes for DevOps</title>
  <link rel="stylesheet" href="style.css">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
</head>
<body>
  <main class="wrap problems">
    <p><a href="index.html">DevOps Nimbus · Python for DevOps</a></p>
    <h1>Python errors and fixes for DevOps</h1>
    <p class="lede">${Q.doctor.length} errors that automation scripts meet, each with the exact message, why it happens, how to confirm it, the fix and how to prevent it. Then learn it for good: break and fix each one yourself in the <a href="index.html#pg">browser playground</a>. Generated from the site's troubleshooting reference.</p>
    <nav class="card" aria-label="Problems">
${toc}
    </nav>
${entries}
  </main>
  <footer class="foot">
    <div class="wrap foot-base">
      <p>© 2024–2026 Sandeep Komal Pothu and contributors. Open source under the MIT License. No trackers, no cookies.</p>
      <p class="foot-tm">Python® is a registered trademark of the Python Software Foundation. This project is independent and not affiliated with the PSF.</p>
    </div>
  </footer>
</body>
</html>
`;
}

module.exports = { render, target: path.join(site, "problems.html") };
if (require.main === module) {
  fs.writeFileSync(module.exports.target, render());
  console.log("wrote site/problems.html");
}
