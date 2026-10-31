// DevOps Nimbus Python for DevOps site. No dependencies, no network requests.
"use strict";

(function () {
  const Q = window.TRACK;
  const $ = (sel) => document.querySelector(sel);
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollToEl = (el) => el && el.scrollIntoView({ block: "start", behavior: still() ? "auto" : "smooth" });

  // h("tag.class", {attr: value}, ...children): build DOM nodes, never HTML strings.
  function h(spec, attrs, ...kids) {
    const [tag, ...classes] = spec.split(".");
    const el = document.createElement(tag);
    if (classes.length) el.className = classes.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  // Text with `code` spans.
  const rich = (text) => text.split(/(`[^`]+`)/).map((p) => (p.startsWith("`") ? h("code", null, p.slice(1, -1)) : p));

  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem("dq-python:" + key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem("dq-python:" + key, JSON.stringify(value)); } catch { /* storage blocked */ } }
  };

  async function copyText(button, text, done) {
    try { await navigator.clipboard.writeText(text); button.textContent = done; } catch { button.textContent = "Select it"; }
    setTimeout(() => { button.textContent = button.dataset.label; }, 1400);
  }
  // A stable link to one scenario (#play/<id>) or problem (#fix/<id>).
  function copyLink(button, fragment) {
    button.dataset.label = button.dataset.label || button.textContent;
    copyText(button, location.href.split("#")[0] + "#" + fragment, "Link copied");
  }
  const copyButton = (text) => h("button.copy", { type: "button", "data-label": "Copy", onclick: (e) => copyText(e.currentTarget, text, "Copied") }, "Copy");
  const SCENARIOS = window.TRACK_SCENARIOS;
  const scenarioTitles = () => Object.fromEntries(SCENARIOS.map((s) => [s.id, s.title]));

  // --- heavy features load after the first screen ----------------------------------
  // The first screen needs only data.js, scenario-index.js, this file and engage.js. The
  // rest loads in the background once it is drawn, and at once when someone needs it.
  const FEATURES = {
    play: ["scenarios.js", "playground.js"],
    xray: ["scenarios.js", "playground.js", "xray.js"], // the X-ray reads Python with the playground's parser
    quiz: ["quiz-bank.js"],
    arch: ["architecture.js"]
  };
  const scripts = {};
  // Appends the scripts in order and resolves once they have all run. They download in
  // parallel; a list of several runs in its own order.
  function load(srcs) {
    return Promise.all(srcs.map((src) => scripts[src] || (scripts[src] = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = srcs.length === 1;
      el.onload = resolve;
      el.onerror = () => { delete scripts[src]; el.remove(); reject(new Error("Could not load " + src)); };
      document.body.append(el);
    }))));
  }
  const ready = {};
  // need("quiz").then(...): anything that calls into a lazy feature waits for it here.
  function need(name) {
    return ready[name] || (ready[name] = load(FEATURES[name]).then(() => { if (INIT[name]) INIT[name](); })
      .catch((e) => { delete ready[name]; throw e; }));
  }

  // The playground's picker, brief and checks. They are drawn from the index with the
  // first screen, so the playground keeps its size when its script arrives;
  // playground.js redraws them as scenarios change and runs finish.
  function renderPicker(currentId, justSolved) {
    const done = new Set(store.get("solved", []));
    const groups = [];
    for (const s of SCENARIOS) {
      let g = groups.find((x) => x.name === s.group);
      if (!g) groups.push(g = { name: s.group, list: [] });
      g.list.push(s);
    }
    $("#pg-scenarios").replaceChildren(...groups.map(({ name, list }) => {
      const n = list.filter((s) => done.has(s.id)).length;
      return h("div.pg-group", null,
        h("span.pg-group-name", null, name, h("span.pg-group-count" + (n === list.length ? ".done" : "") + (justSolved && list.some((s) => s.id === currentId) ? ".bump" : ""), null, `${n}/${list.length}`)),
        h("div.pg-group-items", null, list.map((s) => h("button.pg-scn" + (justSolved && s.id === currentId ? ".just-solved" : ""), {
          type: "button", "aria-pressed": String(s.id === currentId), title: done.has(s.id) ? `${s.title} (solved)` : s.title,
          onclick: () => { location.hash = "play/" + s.id; }
        }, done.has(s.id) ? h("span.pg-scn-done", { "aria-hidden": "true" }, "✓") : null, s.title))));
    }));
  }
  function renderChecks(labels, state) {
    $("#pg-checks").replaceChildren(...labels.map((label, i) => {
      const ok = state ? state.checks[i][1] : null;
      return h("li" + (ok === true ? ".ok" : ok === false ? ".bad" : ""), null,
        h("span.pg-check-dot", { "aria-hidden": "true" }, ok === true ? "✓" : ok === false ? "✕" : "·"),
        label, h("span.visually-hidden", null, ok === true ? " (passing)" : ok === false ? " (failing)" : " (not run yet)"));
    }));
  }
  function renderBrief(s) {
    $("#pg-file").textContent = s.file;
    $("#pg-title-now").textContent = s.title;
    $("#pg-story").textContent = s.story;
    $("#pg-goal").textContent = "Goal: " + s.goal;
    $("#pg-goal").className = "pg-goal";
    $("#pg-level").textContent = `Level ${s.level} · ${(Q.levels.find((l) => l.id === s.level) || {}).title || ""}`;
    $("#pg-level").href = "#path/" + s.level;
    $("#pg-out").replaceChildren(h("div.pg-line.dim", null, `$ ${s.cmd}`), h("div.pg-line.dim", null, "Edit the script, then choose Run (Ctrl+Enter)."));
    renderChecks(s.checks, null);
  }
  window.PYUI = { h, rich, copyLink, need, renderPicker, renderChecks, renderBrief };

  const practiseChips = (ids) => {
    const titles = scenarioTitles();
    const list = (ids || []).filter((id) => titles[id]);
    return list.length ? h("div.chips", null, h("span.muted.small", null, "Practise:"), list.map((id) => h("a.chip", { href: "#play/" + id }, titles[id]))) : null;
  };

  // --- tabs and links -----------------------------------------------------------

  const TABS = ["path", "scripts", "quiz", "xray", "fix", "cheats", "arch"];
  let current = null;
  function route() {
    const [want, sub] = decodeURIComponent(location.hash.slice(1)).split("/");
    const tab = want === "play" ? "path" : TABS.includes(want) ? want : "path";
    if (tab !== current) {
      for (const t of TABS) $("#tab-" + t).hidden = t !== tab;
      const page = $("#tab-" + tab);
      page.classList.remove("tab-in");
      void page.offsetWidth; // restart the fade
      page.classList.add("tab-in");
      const mode = [...document.querySelectorAll(".mode.fix a[data-tab]")].some((a) => a.dataset.tab === tab) ? "fix" : "learn";
      document.documentElement.dataset.mode = mode;
      document.querySelectorAll(".sw").forEach((a) => a.classList.contains(mode) ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current"));
      document.querySelectorAll(".subnav a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      if (!sub && want !== "play") window.scrollTo(0, 0);
    }
    current = tab;
    if (FEATURES[tab]) need(tab);
    if (tab === "cheats") drawCheats();
    if (tab === "scripts") drawScripts();
    if (want === "play" && sub) need("play").then(() => { if (decodeURIComponent(location.hash) === "#play/" + sub) { window.PYPlayground.load(sub); scrollToEl($("#pg")); } });
    if (want === "path" && sub) scrollToEl(document.getElementById("lv-" + sub));
    if (want === "fix") showFix(sub, Boolean(sub));
    document.title = want === "fix" && sub && fixById(sub) ? `${fixById(sub).title} · Python for DevOps` : "Python for DevOps · DevOps Nimbus";
  }
  window.addEventListener("hashchange", route);

  // --- hero: the live log analysis ------------------------------------------------

  function renderStage() {
    const chart = h("div.chart", { "aria-hidden": "true" });
    const bars = Array.from({ length: 36 }, () => h("i"));
    chart.append(...bars);
    const rate = h("b"), p95 = h("b"), req = h("b");
    let t = 0;
    const tick = () => {
      t++;
      bars.forEach((b, i) => {
        const spike = (i + t) % 36 > 26 && (i + t) % 36 < 31;
        b.style.height = `${spike ? 70 + ((i * 13) % 25) : 20 + ((i * 37 + t * 7) % 40)}%`;
        b.classList.toggle("err", spike);
      });
      const spiking = bars.some((b) => b.classList.contains("err"));
      rate.textContent = spiking ? "6.05%" : "0.4%";
      rate.className = spiking ? "bad" : "ok";
      p95.textContent = spiking ? "0.966 s" : "0.21 s";
      req.textContent = (48210 + t * 37).toLocaleString("en");
    };
    tick();
    if (!still()) setInterval(() => { if (!document.hidden) tick(); }, 1600);
    $("#stage").append(
      h("div.stage-bar", null, h("div", null, h("strong.mono", null, "log_analyzer.py access.log"), h("div", null, "Requests per minute; red is 5xx.")),
        h("a.toggle", { href: "#scripts" }, "See the script")),
      chart,
      h("div.readout", null, h("div", null, h("span.dim", null, "Requests"), req), h("div", null, h("span.dim", null, "5xx rate"), rate), h("div", null, h("span.dim", null, "p95 latency"), p95)));
  }

  function renderHome() {
    const n = SCENARIOS.length;
    $("#stats").replaceChildren(...[[String(n), "incidents to fix in the browser"], [String(Q.levels.length), "levels, basics to production"], [String(Q.scripts.length), "tested scripts, for servers and AWS"]]
      .map(([b, s]) => h("div", null, h("b", null, b), h("span", null, s))));
    const tiles = [
      ["#play/indent", "Playground", "Fix real scripts, here.", `${n} incidents: hangs, injection, cron, pip, secrets, the GIL.`, "wide"],
      ["#cheats", "Cheat sheet", "subprocess, pathlib, venv.", "Recipes with a scenario to try each one.", "wide"],
      ["#xray", "Script X-ray", "Every line, explained.", "Risky patterns flagged."],
      ["#scripts", "Scripts", `${Q.scripts.length}, tested.`, "Logs, certs, secrets, AWS, personal data."],
      ["#quiz", "Quiz", "Know why.", `${window.TRACK_QUIZ_SIZE} questions.`],
      ["#arch", "How Python runs", "Interpreter to system calls.", "Venvs, pip, the GIL, threads, processes, asyncio.", "wide"],
      ["#fix", "Stuck on an error?", "Learn why it happens, then practise the fix.", `Paste a traceback. ${Q.doctor.length} errors, each with cause, fix and prevention.`, "wide"]
    ];
    $("#bento").replaceChildren(...tiles.map(([href, k, title, text, size]) => h("a.tile" + (size ? "." + size : ""), { href },
      h("div", null, h("div.k", null, k), h("h3", null, title)), h("p", null, text))));
  }

  // --- path -----------------------------------------------------------------------

  function quizScores() { return store.get("quiz", {}); }
  function renderPath() {
    const done = new Set(store.get("done", []));
    const titles = scenarioTitles();
    const box = $("#levels");
    box.replaceChildren();
    let stage = "", list = null;
    for (const lv of Q.levels) {
      if (lv.stage !== stage) {
        stage = lv.stage;
        list = h("ol.levels");
        box.append(h("h3.stage-name", null, stage), list);
      }
      const isDone = done.has(lv.id);
      const score = quizScores()[lv.id];
      list.append(h("li.level" + (isDone ? ".done" : ""), { id: "lv-" + lv.id },
        h("input", { type: "checkbox", checked: isDone, "aria-label": `Mark level ${lv.id} complete`, onchange: (e) => {
          if (e.target.checked) done.add(lv.id); else done.delete(lv.id);
          store.set("done", [...done]);
          if (e.target.checked) window.PYEngage.active();
          renderPath();
        } }),
        h("div.level-body", null,
          h("div.level-head", null, h("span.num", null, lv.id), h("strong", null, lv.title), h("span.topic", null, lv.topic)),
          h("ul.learn", null, lv.learn.map((t) => h("li", null, ...rich(t)))),
          h("div.lab", null, h("span.small.muted", null, "Lab: ", lv.lab), h("div.lab-cmd", null, h("code", null, lv.cmd), copyButton(lv.cmd))),
          h("div.chips", null, lv.scenarios.filter((id) => titles[id]).map((id) => h("a.chip", { href: "#play/" + id }, titles[id])),
            h("a.chip.quiet", { href: "#quiz", onclick: () => quizFor(lv.id) }, score == null ? "Quiz" : `Quiz ${score}%`)))));
    }
    $("#bar-fill").style.width = (done.size / Q.levels.length * 100) + "%";
    $("#bar").setAttribute("aria-valuenow", String(done.size));
    $("#bar-text").textContent = `${done.size} of ${Q.levels.length} levels complete`;
  }

  // --- scripts --------------------------------------------------------------------

  // The catalogue is drawn after the first screen, or when its tab opens.
  let scriptsDrawn = false;
  function drawScripts() { if (!scriptsDrawn) { scriptsDrawn = true; renderScripts(); } }
  function renderScripts() {
    const groups = [...new Set(Q.scripts.map((s) => s.group || "Standard library"))];
    $("#scripts-list").replaceChildren(...groups.flatMap((g) => [h("h3.stage-name.script-group", null, g), ...Q.scripts.filter((s) => (s.group || "Standard library") === g).map((s) => h("article.card.script", { id: "script-" + s.file.replace(".py", "").replace(/\W/g, "-") },
      h("div.script-head", null, h("h3", null, s.title), h("a.mono.small", { href: `${Q.repo}/blob/main/scripts/${s.file}` }, "scripts/" + s.file)),
      h("p", null, s.what),
      h("h4", null, "Usage"),
      ...s.usage.map((u) => h("div.lab-cmd", null, h("code", null, u), copyButton(u))),
      h("h4", null, "A real run"),
      h("pre.sample", null, h("code", null, s.sample.join("\n"))),
      h("p.small.muted", null, "Exit status: ", s.exit)))]));
  }

  // --- quiz -----------------------------------------------------------------------

  const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // Opens the quiz at a level once the question bank has loaded.
  const quizFor = (id) => need("quiz").then(() => { $("#quiz-level").value = id; renderQuiz(); });
  function initQuiz() {
    $("#quiz-level").append(h("option", { value: "exam" }, "Exam: 15 random questions from every level"),
      ...Q.levels.map((l) => h("option", { value: l.id }, `${l.id} · ${l.topic} (${window.TRACK_QUIZ[l.id].length} questions)`)));
    $("#quiz-level").value = "00";
    renderQuiz();
  }
  function renderQuiz() {
    const mode = $("#quiz-level").value;
    const exam = mode === "exam";
    const items = exam ? shuffle(Q.levels.flatMap((l) => window.TRACK_QUIZ[l.id].map((q) => ({ ...q, level: l.id })))).slice(0, 15) : window.TRACK_QUIZ[mode].map((q) => ({ ...q, level: mode }));
    let answered = 0, correct = 0;
    const score = h("div.score", { "aria-live": "polite" });
    const update = () => {
      score.replaceChildren(h("span", null, h("strong", null, String(correct)), ` correct of ${answered} answered · ${items.length} questions`));
      if (answered === items.length) {
        const pct = Math.round(correct / items.length * 100);
        if (!exam) { const all = quizScores(); all[mode] = Math.max(all[mode] || 0, pct); store.set("quiz", all); window.PYEngage.active(); renderPath(); }
        score.append(h("p.result", null, h("strong", null, `${pct}%. `), pct === 100 ? "Perfect." : "Read the explanations, practise the scenarios, try again. ",
          h("button.link-btn", { type: "button", onclick: renderQuiz }, exam ? "New exam" : "Try again")));
      }
    };
    const out = $("#quiz-list");
    out.replaceChildren(score);
    items.forEach((item, qi) => {
      const fb = h("p.feedback", { "aria-live": "polite" });
      const opts = h("div.options", { role: "group", "aria-label": `Question ${qi + 1}` });
      shuffle(item.options.map((text, index) => ({ text, index }))).forEach((o) => opts.append(h("button.opt", { type: "button", "data-right": o.index === item.answer ? "1" : null, onclick: (e) => {
        const right = o.index === item.answer;
        opts.querySelectorAll("button").forEach((b) => { b.disabled = true; if (b.dataset.right) b.classList.add("right"); });
        if (!right) e.currentTarget.classList.add("wrong");
        fb.replaceChildren(h("strong", null, right ? "Correct. " : "Not quite. "), ...rich(item.why));
        fb.className = "feedback " + (right ? "ok" : "bad");
        answered++;
        if (right) correct++;
        update();
      } }, ...rich(o.text))));
      const lv = Q.levels.find((l) => l.id === item.level);
      out.append(h("div.card.question", null, exam ? h("p.tag", null, `Level ${lv.id} · ${lv.topic}`) : null, h("h3", null, `${qi + 1}. `, ...rich(item.q)), opts, fb));
    });
    update();
  }

  // --- Script X-ray ---------------------------------------------------------------

  function explainPasted() {
    const text = $("#xray-input").value;
    const error = $("#xray-error");
    const fail = (msg) => { error.textContent = msg; error.hidden = false; };
    if (!text.trim()) return fail("Paste a script first, or load an example.");
    const res = window.PYXray.explain(text);
    if (res.error) return fail(res.error);
    error.hidden = true;
    const rows = res.lines;
    const warned = rows.filter((r) => r.warns && r.warns.length).length;
    $("#xray-summary").textContent = [`${rows.filter((r) => r.note).length} lines explained`, `${warned} risky`, res.review.length ? `${res.review.length} missing essentials` : null].filter(Boolean).join(" · ");
    $("#xray-review").replaceChildren(...(res.syntax ? [h("p.xray-warn", null, "Python would not run this: ", res.syntax)] : []),
      ...(res.review.length ? [h("details.xray-missing", { open: true }, h("summary", null, "Missing essentials"), h("ul.xray-review", null, res.review.map((r) => h("li", null, ...rich(r)))))] : []));
    const list = $("#xray-lines");
    const note = $("#xray-note");
    list.replaceChildren(...rows.map((r, i) => {
      if (!r.note) return h("li", null, h("span.line.blank", null, r.line || " "));
      return h("li", null, h("button.line" + (r.warns && r.warns.length ? ".warn" : r.level === "unknown" ? ".unknown" : ""), { type: "button", onclick: (e) => {
        list.querySelectorAll(".line").forEach((b) => b.classList.remove("on"));
        e.currentTarget.classList.add("on");
        note.replaceChildren(h("pre", null, h("code", null, r.line.trim())), h("p", null, ...rich(r.note)), ...(r.warns || []).map((w) => h("p.xray-warn", null, ...rich(w))), h("p.muted.small", null, `Line ${i + 1} of ${rows.length}`));
        if (matchMedia("(max-width: 860px)").matches) e.currentTarget.parentElement.after(note);
      } }, r.line));
    }));
    note.replaceChildren(h("p.muted", null, "Select any line to see what it does. Amber lines are risky."));
    $(".xray").append(note);
    $("#xray-result").hidden = false;
    const first = list.querySelector(".line.warn") || list.querySelector("button.line");
    if (first && !matchMedia("(max-width: 860px)").matches) first.click();
  }

  // --- troubleshooting reference ----------------------------------------------------

  const fixById = (id) => Q.doctor.find((d) => d.id === id);
  const words = (s) => s.toLowerCase().split(/[^a-z0-9_.'-]+/).filter((w) => w.length > 2);
  // Scores entries against free text: an error message, a traceback or a few words.
  function searchFixes(text) {
    const q = words(text);
    if (!q.length) return null;
    const lower = text.toLowerCase();
    return Q.doctor.map((d) => {
      const hay = [d.title, d.error, d.symptom, ...d.cause].join(" ").toLowerCase();
      let s = q.filter((w) => hay.includes(w)).length;
      const head = d.error.split("\n")[0].toLowerCase().replace(/'[^']*'/g, "").replace(/\s+/g, " ").trim();
      if (head.length > 12 && lower.includes(head.slice(0, Math.min(40, head.length)))) s += 20;
      if (lower.includes(d.title.toLowerCase().split(":")[0])) s += 5;
      return [d, s];
    }).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([d]) => d);
  }
  function renderFixList() {
    const q = $("#fix-q").value;
    const hits = searchFixes(q);
    const index = new Map(Q.doctor.map((d) => [d.id, d]));
    if (hits) {
      $("#fix-list").replaceChildren(h("div.doctor-group", null, h("div.doctor-group-name", null, hits.length ? "Best matches" : "No match"),
        h("div.doctor-group-items", null, hits.slice(0, 8).map((d) => h("a.chip", { href: "#fix/" + d.id }, d.title)))));
      if (hits.length && q.length > 25) showFix(hits[0].id, false);
      return;
    }
    $("#fix-list").replaceChildren(...Q.doctorGroups.map(([name, ids]) => h("div.doctor-group", null,
      h("div.doctor-group-name", null, name, h("span.count", null, String(ids.length))),
      h("div.doctor-group-items", null, ids.map((id) => h("a.chip", { href: "#fix/" + id }, index.get(id).title))))));
  }
  function showFix(id, scroll) {
    const d = fixById(id);
    if (!d) { $("#fix-out").replaceChildren(); return; }
    const copy = h("button.copy", { type: "button", onclick: (e) => copyLink(e.currentTarget, "fix/" + d.id) }, "Copy link");
    const chips = practiseChips(d.scenarios);
    $("#fix-out").replaceChildren(h("article.card.fix", { id: "fix-" + d.id },
      h("div.pg-brief-top", null, h("h3", null, d.title), copy),
      h("pre.err-text", null, h("code", null, d.error)),
      h("h4", null, "Symptom"), h("p", null, d.symptom),
      h("h4", null, "Why it happens"), h("ul", null, d.cause.map((c) => h("li", null, ...rich(c)))),
      h("h4", null, "Confirm"), h("pre", null, h("code", null, d.confirm.join("\n"))),
      h("h4", null, "Fix"), h("p", null, ...rich(d.fix)),
      h("h4", null, "Prevent"), h("p", null, ...rich(d.prevent)),
      // Fixing is the way in; the point is to learn it, so every answer ends in practice.
      h("div.learn-it", null,
        h("h4", null, "Now learn it"),
        chips && h("p", null, "Break this yourself in a safe playground and fix it. Doing it once is what makes you recognise it next time."),
        chips,
        h("p.note", null, chips ? "Then the level that teaches it: " : "The level that teaches it: ", h("a", { href: "#path/" + d.level }, `Level ${d.level} · ${Q.levels.find((l) => l.id === d.level).title}`)))));
    if (scroll) scrollToEl($("#fix-out"));
  }

  // --- cheat sheet ------------------------------------------------------------------

  // The cheat sheet is drawn after the first screen, or when its tab opens.
  let cheatsDrawn = false;
  function drawCheats() { if (!cheatsDrawn) { cheatsDrawn = true; renderCheats(); } }
  function renderCheats() {
    const q = $("#cheat-q").value.trim().toLowerCase();
    const titles = scenarioTitles();
    const groups = new Map();
    for (const [code, what, group, where] of Q.cheats) {
      if (q && !`${code} ${what} ${group}`.toLowerCase().includes(q)) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([code, what, where]);
    }
    const out = $("#cheat-out");
    out.replaceChildren();
    if (!groups.size) { out.append(h("p.muted", null, "No match. Try subprocess, timeout, json or venv.")); return; }
    for (const [group, rows] of groups) {
      out.append(h("h3.group", null, group), h("ul.cheats", null, rows.map(([code, what, where]) => h("li", null,
        h("div", null, h("code", null, code), h("span.muted", null, what)),
        h("div.cheat-actions", null,
          where ? h("a.copy", { href: "#play/" + where, title: `Open the scenario "${titles[where] || where}", whose fix uses this` }, "Try")
            : h("a.copy.lab", { href: Q.repo + "#examples", title: "Needs your own machine" }, "Lab"),
          copyButton(code))))));
    }
  }

  // --- command palette (Ctrl+K, Cmd+K or /) ---------------------------------------------

  const palette = $("#palette"), pInput = $("#palette-input"), pList = $("#palette-list");
  let pItems = [], pActive = 0;
  const go = (hash) => { location.hash = hash; };
  function actions() {
    return [
      { label: "Playground", kind: "Section", run: () => { need("play"); go("path"); scrollToEl($("#pg")); } },
      { label: "Your path", kind: "Section", run: () => { go("path"); scrollToEl($("#levels-title")); } },
      ...TABS.slice(1).map((t) => ({ label: t === "fix" ? "Fix: troubleshoot an error" : $(`.top nav a[data-tab="${t}"]`).textContent, kind: "Section", run: () => go(t) })),
      ...SCENARIOS.map((s) => ({ label: s.title, hint: s.group, kind: "Scenario", run: () => go("play/" + s.id) })),
      ...Q.doctor.map((d) => ({ label: d.title, hint: d.error, kind: "Error", run: () => go("fix/" + d.id) })),
      ...Q.levels.map((l) => ({ label: `${l.id} · ${l.title}`, hint: l.topic, kind: "Level", run: () => go("path/" + l.id) }))
    ];
  }
  function renderPalette() {
    const ws = pInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    pItems = actions().filter((a) => ws.every((w) => `${a.label} ${a.hint || ""} ${a.kind}`.toLowerCase().includes(w))).slice(0, 8);
    pActive = Math.min(pActive, Math.max(0, pItems.length - 1));
    pList.replaceChildren(...pItems.map((a, i) => h("li", { role: "option", id: "pal-" + i, "aria-selected": String(i === pActive), onclick: () => choose(i) },
      h("span.pal-label", null, a.label), h("span.pal-kind", null, a.kind))));
    if (!pItems.length) pList.append(h("li.pal-empty", null, "Nothing matches. Try timeout, venv or KeyError."));
    pInput.setAttribute("aria-activedescendant", pItems.length ? "pal-" + pActive : "");
  }
  function openPalette() { if (palette.open) return; need("play"); pInput.value = ""; pActive = 0; renderPalette(); palette.showModal(); pInput.focus(); }
  function choose(i) { const a = pItems[i]; if (!a) return; palette.close(); a.run(); }
  pInput.addEventListener("input", () => { pActive = 0; renderPalette(); });
  pInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (pItems.length) pActive = (pActive + (e.key === "ArrowDown" ? 1 : pItems.length - 1)) % pItems.length;
      renderPalette();
    } else if (e.key === "Enter") { e.preventDefault(); choose(pActive); }
  });
  palette.addEventListener("click", (e) => { if (e.target === palette) palette.close(); });
  $("#palette-open").addEventListener("click", openPalette);
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) $("#palette-key").textContent = "⌘K";
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openPalette(); }
    else if (e.key === "/" && !typing) { e.preventDefault(); openPalette(); }
  });

  // --- init -----------------------------------------------------------------------

  $("#forget").addEventListener("click", () => {
    if (!confirm("Clear your progress, quiz scores, solved scenarios and drafts from this browser?")) return;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("dq-python:")) localStorage.removeItem(k); } catch { /* storage blocked */ }
    location.reload();
  });
  const INIT = { quiz: initQuiz };
  $("#quiz-level").addEventListener("change", renderQuiz);
  $("#xray-go").addEventListener("click", () => need("xray").then(explainPasted));
  $("#xray-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) need("xray").then(explainPasted); });
  $("#xray-clear").addEventListener("click", () => { $("#xray-input").value = ""; $("#xray-result").hidden = true; $("#xray-error").hidden = true; $("#xray-input").focus(); });
  $("#xray-examples").replaceChildren(...Q.xrayExamples.map((x) => h("button.pill.small-pill", { type: "button", onclick: () => { $("#xray-input").value = x.text; need("xray").then(explainPasted); } }, x.name)));
  $("#fix-q").addEventListener("input", renderFixList);
  // The home page's "Something broken?" box hands the pasted error to Troubleshoot.
  // Search once route() has shown the tab, since visiting #fix clears the answer.
  const doorGo = () => {
    $("#fix-q").value = $("#door-q").value;
    window.addEventListener("hashchange", () => { renderFixList(); $("#fix-q").focus(); }, { once: true });
    go("fix");
  };
  $("#door-go").addEventListener("click", doorGo);
  $("#door-q").addEventListener("keydown", (e) => { if (e.key === "Enter") doorGo(); });
  $("#cheat-q").addEventListener("input", renderCheats);

  // The first screen in one pass, as soon as the critical scripts have run; then the rest.
  window.addEventListener("DOMContentLoaded", () => {
    const first = SCENARIOS.find((s) => decodeURIComponent(location.hash) === "#play/" + s.id) || SCENARIOS[0];
    renderStage();
    renderHome();
    renderPath();
    window.PYEngage.render();
    renderPicker(first.id);
    renderBrief(first);
    renderFixList();
    route();
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 200)))(() => { drawCheats(); drawScripts(); for (const name of Object.keys(FEATURES)) need(name).catch(() => { /* retried on first use */ }); });
  });
})();
