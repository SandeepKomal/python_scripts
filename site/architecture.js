// The "How Python runs" tab: how a script runs, from the shell to system calls.
// Every component can be pointed at, tapped or reached with Tab.
"use strict";

(function () {
  const { h, rich } = window.PYUI;
  const A = window.TRACK.architecture;
  const parts = Object.fromEntries(A.components.map((c) => [c.id, c]));
  const NS = "http://www.w3.org/2000/svg";
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    el.append(...kids);
    return el;
  };

  // Hand-placed layouts. Boxes are [x, y, width, height].
  const LAYOUTS = {
    wide: {
      size: [1040, 560], font: [13, 11],
      panels: [["Your machine", 20, 20, 200, 250], ["Interpreter (CPython)", 240, 20, 560, 250], ["Packages", 820, 20, 200, 250],
        ["Concurrency", 20, 290, 500, 130], ["Libraries", 540, 290, 480, 130], ["Operating system", 20, 440, 1000, 100]],
      boxes: { shell: [35, 60, 170, 56], venv: [35, 170, 170, 56], source: [260, 60, 150, 56], compiler: [430, 60, 150, 56], pyc: [600, 60, 180, 56],
        eval: [345, 170, 330, 64], pypi: [835, 60, 170, 56], pip: [835, 170, 170, 56], gil: [35, 330, 110, 56], threads: [160, 330, 110, 56],
        processes: [285, 330, 110, 56], asyncio: [410, 330, 95, 56], stdlib: [560, 330, 200, 56], sitepkgs: [800, 330, 200, 56], os: [35, 470, 970, 50] },
      edges: [["shell", "venv", [[120, 116], [120, 170]]], ["shell", "source", [[205, 88], [260, 88]]], ["source", "compiler", [[410, 88], [430, 88]]],
        ["compiler", "pyc", [[580, 88], [600, 88]]], ["compiler", "eval", [[505, 116], [505, 170]]], ["venv", "eval", [[205, 198], [345, 198]]],
        ["pypi", "pip", [[920, 116], [920, 170]]], ["pip", "sitepkgs", [[920, 226], [920, 330]]], ["eval", "stdlib", [[620, 234], [620, 330]]],
        ["eval", "sitepkgs", [[660, 234], [660, 280], [860, 280], [860, 330]]], ["eval", "gil", [[380, 234], [380, 300], [90, 300], [90, 330]]],
        ["gil", "threads", [[145, 358], [160, 358]]], ["eval", "processes", [[420, 234], [420, 310], [340, 310], [340, 330]]],
        ["eval", "asyncio", [[460, 234], [460, 330]]], ["stdlib", "os", [[660, 386], [660, 470]]], ["processes", "os", [[340, 386], [340, 470]]]]
    },
    narrow: {
      size: [360, 775], font: [12, 10],
      panels: [["Your machine", 5, 5, 350, 80], ["Interpreter (CPython)", 5, 100, 350, 225], ["Concurrency", 5, 340, 350, 155],
        ["Libraries and packages", 5, 510, 350, 160], ["Operating system", 5, 685, 350, 82]],
      boxes: { shell: [15, 30, 155, 46], venv: [190, 30, 155, 46], source: [15, 125, 155, 46], compiler: [190, 125, 155, 46], pyc: [190, 190, 155, 46],
        eval: [15, 255, 330, 52], gil: [15, 365, 155, 46], threads: [190, 365, 155, 46], processes: [15, 430, 155, 46], asyncio: [190, 430, 155, 46],
        stdlib: [15, 535, 155, 46], sitepkgs: [190, 535, 155, 46], pypi: [15, 605, 155, 46], pip: [190, 605, 155, 46], os: [15, 710, 330, 46] },
      edges: [["shell", "venv", [[170, 53], [190, 53]]], ["shell", "source", [[92, 76], [92, 125]]], ["source", "compiler", [[170, 148], [190, 148]]],
        ["compiler", "pyc", [[268, 171], [268, 190]]], ["source", "eval", [[92, 171], [92, 255]]], ["eval", "gil", [[92, 307], [92, 365]]],
        ["eval", "threads", [[268, 307], [268, 365]]], ["pypi", "pip", [[170, 628], [190, 628]]], ["pip", "sitepkgs", [[268, 605], [268, 581]]]]
    }
  };

  const TOUR = [
    [[["shell", "venv"]], "cron runs /opt/monitor/.venv/bin/python check.py: the venv's interpreter starts, with the venv's site-packages."],
    [[["shell", "source"]], "Python reads check.py and parses it. IndentationError and SyntaxError stop it here, before anything runs."],
    [[["source", "compiler"], ["compiler", "pyc"]], "The code is compiled to bytecode. Imported modules are cached in __pycache__."],
    [[["compiler", "eval"]], "The evaluation loop runs the bytecode, one instruction at a time, holding the GIL."],
    [[["eval", "stdlib"], ["eval", "sitepkgs"]], "import json comes from the standard library; import requests from the venv's site-packages."],
    [[["stdlib", "os"]], "subprocess, sockets and open() become system calls. Timeouts, permissions and signals live here."],
    [[], "Python exits with a status: 0, 1 after an uncaught exception, or what sys.exit() was given. cron and CI read it."]
  ];

  const root = document.getElementById("arch");
  const figure = h("div.arch-figure");
  const tip = h("div.arch-tip", { "aria-hidden": "true" });
  const detail = h("div.arch-detail", { hidden: true, "aria-live": "polite" });
  const play = h("button.pill.small-pill", { type: "button", onclick: () => (touring ? stopTour() : tour()) }, "Follow python3 check.py");
  const caption = h("p.arch-caption", { "aria-live": "polite" }, "Point at any component to see what it does and how it breaks.");
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let svg = null, dot = null, pinned = null, touring = 0;

  function draw() {
    const L = LAYOUTS[matchMedia("(max-width: 720px)").matches ? "narrow" : "wide"];
    const arrow = (id) => s("marker", { id, viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, s("path", { d: "M0 0 8 4 0 8z" }));
    svg = s("svg", { viewBox: `0 0 ${L.size[0]} ${L.size[1]}`, class: "arch-svg", role: "group", "aria-label": "How Python runs a script" }, s("defs", null, arrow("arch-arrow"), arrow("arch-arrow-on")));
    for (const [label, x, y, w, ht] of L.panels) svg.append(s("rect", { x, y, width: w, height: ht, rx: 16, class: "arch-panel" }), s("text", { x: x + 14, y: y + 18, class: "arch-panel-label" }, label));
    for (const [from, to, pts] of L.edges) svg.append(s("polyline", { points: pts.join(" "), class: "arch-edge", "data-from": from, "data-to": to, "marker-end": "url(#arch-arrow)" }));
    for (const [id, [x, y, w, ht]] of Object.entries(L.boxes)) {
      const c = parts[id];
      const g = s("g", { class: "arch-box", "data-id": id, tabindex: "0", role: "button", "aria-label": `${c.name}: ${c.short}` },
        s("rect", { x, y, width: w, height: ht, rx: 10 }),
        s("text", { x: x + w / 2, y: y + ht / 2 - 2, class: "arch-name", "font-size": L.font[0] }, c.name),
        s("text", { x: x + w / 2, y: y + ht / 2 + L.font[1] + 3, class: "arch-short", "font-size": L.font[1] }, c.short));
      g.addEventListener("mouseenter", () => touring || select(id));
      g.addEventListener("focus", () => touring || select(id));
      g.addEventListener("click", () => { stopTour(); pinned = id; select(id); open(id); });
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); g.dispatchEvent(new Event("click")); } });
      svg.append(g);
    }
    dot = s("circle", { r: 6, class: "arch-dot" });
    svg.append(dot);
    svg.addEventListener("mouseleave", () => touring || select(pinned));
    figure.replaceChildren(svg, tip, h("div.arch-tour", null, play, caption));
    stopTour();
    select(pinned);
  }

  function light(ids, edges) {
    svg.classList.toggle("has-focus", ids.length > 0);
    const near = new Set(ids);
    svg.querySelectorAll(".arch-edge").forEach((e) => {
      const ends = [e.dataset.from, e.dataset.to];
      const on = edges ? edges.includes(e) : ends.some((x) => ids.includes(x));
      if (on) ends.forEach((x) => near.add(x));
      e.classList.toggle("is-on", on);
      e.setAttribute("marker-end", `url(#arch-arrow${on ? "-on" : ""})`);
    });
    svg.querySelectorAll(".arch-box").forEach((g) => {
      g.classList.toggle("is-on", ids.includes(g.dataset.id));
      g.classList.toggle("is-near", !ids.includes(g.dataset.id) && near.has(g.dataset.id));
    });
  }
  function select(id) { light(id ? [id] : []); place(id); }

  const practise = (c) => {
    const titles = Object.fromEntries((window.PYPlayground ? window.PYPlayground.scenarios : []).map((x) => [x.id, x.title]));
    const ids = c.practise.filter((id) => titles[id]);
    return ids.length ? h("div.chips", null, h("span.muted.small", null, "Practise:"), ids.map((id) => h("a.chip", { href: "#play/" + id }, titles[id]))) : null;
  };
  function open(id) {
    const c = parts[id];
    detail.replaceChildren(h("div.card", null, h("p.arch-where", null, c.where), h("h3", null, c.name), h("p", null, rich(c.role)),
      h("h4", null, "What it does"), h("ul", null, c.does.map((d) => h("li", null, rich(d)))),
      h("h4", null, "When it breaks"), h("p", null, rich(c.breaks)),
      h("h4", null, "Look at it"), h("pre", null, h("code", null, c.look.join("\n"))), practise(c)));
    detail.hidden = false;
    detail.scrollIntoView({ block: "nearest", behavior: still() ? "auto" : "smooth" });
  }
  function place(id) {
    const show = id && figure.offsetParent && !matchMedia("(max-width: 720px), (hover: none)").matches;
    tip.classList.toggle("is-shown", Boolean(show));
    if (!show) return;
    const c = parts[id];
    tip.replaceChildren(h("p.arch-where", null, c.where), h("h3", null, c.name), h("p", null, rich(c.role)), h("p.muted.small", null, "Click for commands and practice"));
    const box = svg.querySelector(`[data-id="${id}"] rect`).getBoundingClientRect();
    const frame = figure.getBoundingClientRect();
    const right = box.right - frame.left + 12;
    tip.style.left = `${right + tip.offsetWidth <= frame.width ? right : Math.max(0, box.left - frame.left - tip.offsetWidth - 12)}px`;
    tip.style.top = `${Math.min(Math.max(0, box.top - frame.top - 8), Math.max(0, frame.height - tip.offsetHeight - 60))}px`;
  }

  // Move the dot along an edge; an edge missing from this layout is skipped.
  function travel(from, to, run) {
    const e = [...svg.querySelectorAll(".arch-edge")].find((x) => x.dataset.from === from && x.dataset.to === to);
    if (!e) return { edge: null, done: Promise.resolve() };
    const pts = e.getAttribute("points").split(" ").map((p) => p.split(",").map(Number));
    const segs = pts.slice(1).map((p, i) => [pts[i], p, Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])]);
    const total = segs.reduce((n, sg) => n + sg[2], 0);
    const at = (d) => { for (const [a, b, len] of segs) { if (d <= len) return [a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len]; d -= len; } return pts[pts.length - 1]; };
    dot.classList.add("is-on");
    return { edge: e, done: new Promise((resolve) => {
      if (still()) { [dot.cx.baseVal.value, dot.cy.baseVal.value] = pts[pts.length - 1]; return resolve(); }
      const ms = Math.max(450, total * 2.2), start = performance.now();
      const frame = (now) => {
        if (run !== touring) return resolve();
        const t = Math.min(1, (now - start) / ms), ease = t < .5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
        [dot.cx.baseVal.value, dot.cy.baseVal.value] = at(total * ease);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    }) };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function tour() {
    const run = ++touring;
    pinned = null;
    place(null);
    play.textContent = "Stop";
    for (const [n, [hops, text]] of TOUR.entries()) {
      caption.replaceChildren(h("span.arch-step", null, `${n + 1} of ${TOUR.length}`), text);
      const edges = [];
      light([...new Set(hops.flat())]);
      for (const [from, to] of hops) {
        const leg = travel(from, to, run);
        if (leg.edge) edges.push(leg.edge);
        light([...new Set(hops.flat())], edges);
        await leg.done;
        if (run !== touring) return;
      }
      await wait(still() ? 3200 : 1700);
      if (run !== touring) return;
    }
    stopTour("Played. Point at any component to read more, or play it again.");
  }
  function stopTour(text) {
    touring = 0;
    if (dot) dot.classList.remove("is-on");
    play.textContent = "Follow python3 check.py";
    if (text) caption.textContent = text;
    if (svg) light([]);
  }

  function renderStdlib() {
    const titles = Object.fromEntries((window.PYPlayground ? window.PYPlayground.scenarios : []).map((x) => [x.id, x.title]));
    document.getElementById("stdlib").replaceChildren(...A.stdlib.map(([name, what, code, id]) => h("div.card.stdlib-card", null,
      h("h4", null, name), h("p", null, what), h("pre", null, h("code", null, code)),
      titles[id] ? h("a.chip", { href: "#play/" + id }, titles[id]) : null)));
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (pinned || touring)) { pinned = null; stopTour(); select(null); } });
  matchMedia("(max-width: 720px)").addEventListener("change", draw);
  window.addEventListener("hashchange", () => { if (location.hash !== "#arch") stopTour(); });
  window.addEventListener("DOMContentLoaded", () => { draw(); root.replaceChildren(figure, detail); renderStdlib(); });
})();
