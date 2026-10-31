// The playground: each scenario is a real automation script with a bug. The
// learner edits it and presses Run; the script is not executed by Python.
// It is read by the small analyser below (syntax, imports, calls, blocks),
// and the scenario's model of the world says what that script would print.
//
// PYSim has no DOM access so site-tests/check_playground.js and the fuzzer
// can drive it under Node; the UI below it only renders what PYSim returns.
"use strict";

(function (root) {
  const HOME = "/home/ops";
  const LIB = "/usr/lib/python3.13";
  const VENV = `${HOME}/.venv/lib/python3.13/site-packages`;

  // --- reading Python ---------------------------------------------------------

  const OPENERS = { if: "'if' statement", elif: "'elif' statement", else: "'else' statement", for: "'for' statement", while: "'while' statement",
    try: "'try' statement", except: "'except' statement", finally: "'finally' statement", with: "'with' statement",
    def: "function definition", class: "class definition", async: "function definition", match: "'match' statement", case: "'case' statement" };
  const CLOSE = { ")": "(", "]": "[", "}": "{" };

  // One pass over the source: comments removed (code), string contents
  // blanked as well (bare), which lines continue a bracket or a triple-quoted
  // string, and the first tokenizer error.
  function parse(source) {
    const raw = String(source).replace(/\r\n?/g, "\n").split("\n");
    const code = [], bare = [], cont = [];
    const stack = [];
    let triple = null, error = null, prevSlash = false;
    const fail = (e) => { if (!error) error = e; };
    raw.forEach((line, i) => {
      cont.push(Boolean(triple || stack.length || prevSlash));
      let out = "", plain = "", j = 0;
      while (j < line.length) {
        if (triple) {
          const k = line.indexOf(triple, j);
          const end = k < 0 ? line.length : k + 3;
          out += line.slice(j, end);
          plain += k < 0 ? "" : triple;
          if (k >= 0) triple = null;
          j = end;
          continue;
        }
        const ch = line[j];
        if (ch === "#") break;
        if (ch === "'" || ch === '"') {
          if (line.startsWith(ch.repeat(3), j)) { triple = ch.repeat(3); out += triple; plain += triple; j += 3; continue; }
          let k = j + 1;
          while (k < line.length && line[k] !== ch) k += line[k] === "\\" ? 2 : 1;
          if (k >= line.length) {
            fail({ line: i + 1, col: j, msg: `SyntaxError: unterminated string literal (detected at line ${i + 1})` });
            out += line.slice(j); plain += ch + ch; j = line.length;
            continue;
          }
          out += line.slice(j, k + 1); plain += ch + ch; j = k + 1;
          continue;
        }
        if ("([{".includes(ch)) stack.push([ch, i + 1, j]);
        else if (CLOSE[ch]) {
          const open = stack.pop();
          if (!open) fail({ line: i + 1, col: j, msg: `SyntaxError: unmatched '${ch}'` });
          else if (open[0] !== CLOSE[ch]) fail({ line: i + 1, col: j, msg: `SyntaxError: closing parenthesis '${ch}' does not match opening parenthesis '${open[0]}'` });
        }
        out += ch; plain += ch; j++;
      }
      prevSlash = /\\$/.test(out);
      code.push(out);
      bare.push(plain);
    });
    if (stack.length) fail({ line: stack[0][1], col: stack[0][2], msg: `SyntaxError: '${stack[0][0]}' was never closed` });
    if (triple) fail({ line: raw.length, col: 0, msg: `SyntaxError: unterminated triple-quoted string literal (detected at line ${raw.length})` });
    return new Py(raw, code, bare, cont, error);
  }

  const width = (s) => s.replace(/\t/g, "        ").length;

  class Py {
    constructor(raw, code, bare, cont, error) {
      Object.assign(this, { raw, code, bare, cont, tokenError: error });
      this.text = code.join("\n");
      // Logical lines: not blank, not a continuation. Each has its indent.
      this.logical = [];
      code.forEach((c, i) => { if (!cont[i] && c.trim()) this.logical.push(i + 1); });
      this.ind = code.map((c) => width(/^\s*/.exec(c)[0]));
      // Each statement's text with strings blanked, joined across brackets: a
      // header like "for x in [" ... "]:" ends with its colon on a later line.
      this.head = bare.map((b, i) => {
        let s = b;
        for (let j = i + 1; j < bare.length && cont[j]; j++) s += " " + bare[j].trim();
        return s.trim();
      });
    }
    has(re) { return re.test(this.text); }
    // First (or every) 1-based line whose code matches.
    line(re) { const i = this.code.findIndex((c) => re.test(c)); return i + 1; }
    lines(re) { return this.code.map((c, i) => (re.test(c) ? i + 1 : 0)).filter(Boolean); }
    src(n) { return (this.raw[n - 1] || "").trim(); }
    // The whole statement starting on line n, joined across brackets.
    stmt(n) {
      let s = this.code[n - 1] || "";
      for (let i = n; i < this.code.length && this.cont[i]; i++) s += "\n" + this.code[i];
      return s;
    }
    // Enclosing block headers of line n, innermost first.
    parents(n) {
      const out = [];
      let w = this.ind[n - 1];
      for (const l of [...this.logical].reverse()) {
        if (l >= n || this.ind[l - 1] >= w) continue;
        if (/:\s*$/.test(this.head[l - 1])) { out.push({ line: l, text: this.head[l - 1], code: this.code[l - 1].trim() }); w = this.ind[l - 1]; }
        if (w === 0) break;
      }
      return out;
    }
    inside(n, re) { return this.parents(n).find((p) => re.test(p.code)) || null; }
    // The lines of the block a header opens.
    body(n) {
      const w = this.ind[n - 1], out = [];
      for (const l of this.logical) {
        if (l <= n) continue;
        if (this.ind[l - 1] <= w) break;
        out.push(l);
      }
      return out;
    }
    bodyText(n) { return this.body(n).map((l) => this.stmt(l)).join("\n"); }
    fnOf(n) {
      const d = this.inside(n, /^(async\s+)?def\s/);
      return d ? /def\s+(\w+)/.exec(d.code)[1] : "<module>";
    }
    // The except clauses that would handle an error raised on line n.
    handlers(n) {
      const out = [];
      for (const t of this.parents(n).filter((p) => /^try\s*:/.test(p.text))) {
        const w = this.ind[t.line - 1];
        for (const l of this.logical) {
          if (l <= t.line || this.ind[l - 1] > w) continue;
          const head = this.code[l - 1].trim();
          const m = /^except\b\s*(.*?)(\s+as\s+\w+)?\s*:/.exec(head);
          if (this.ind[l - 1] < w || !(m || /^(else|finally)\b/.test(head))) break;
          if (m) out.push({ line: l, types: m[1].replace(/[()]/g, "").split(",").map((x) => x.trim().split(".").pop()).filter(Boolean), body: this.bodyText(l) });
        }
      }
      return out;
    }
    // The handler that catches an exception of one of these class names, if any.
    catches(n, names) {
      return this.handlers(n).find((h) => !h.types.length || h.types.some((t) => names.includes(t) || t === "Exception" || t === "BaseException")) || null;
    }
    // Calls whose callee matches pattern (a regex source), with arguments.
    calls(pattern) {
      const re = new RegExp(`(?<![\\w.])(${pattern})\\s*\\(`, "g");
      const out = [];
      let m;
      while ((m = re.exec(this.text))) {
        const open = m.index + m[0].length - 1;
        const close = matchParen(this.text, open);
        const inner = this.text.slice(open + 1, close < 0 ? this.text.length : close);
        const args = splitTop(inner);
        const kw = {}, pos = [];
        for (const a of args) {
          const k = /^\s*(\w+)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
          if (k) kw[k[1]] = k[2].trim(); else if (a.trim()) pos.push(a.trim());
        }
        out.push({ name: m[1], line: this.text.slice(0, m.index).split("\n").length, args: inner, pos, kw });
      }
      return out;
    }
    call(pattern) { return this.calls(pattern)[0] || null; }
  }

  function matchParen(text, open) {
    let depth = 0, q = null;
    for (let i = open; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"') q = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch) && --depth === 0) return i;
    }
    return -1;
  }

  function splitTop(s) {
    const out = [];
    let depth = 0, q = null, cur = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { cur += ch; if (ch === "\\") cur += s[++i] || ""; else if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"') q = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      else if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  }

  // What CPython's parser would reject: tokenizer errors, a missing colon,
  // and indentation, reported the way Python 3.12 prints them.
  function syntax(py) {
    const found = [];
    if (py.tokenError) found.push(py.tokenError);
    const stack = [0];
    let open = null, kind = null;
    for (const n of py.logical) {
      const line = py.code[n - 1], lead = /^\s*/.exec(line)[0], w = py.ind[n - 1];
      const t = py.head[n - 1];
      if (lead) {
        const k = lead.includes("\t") ? "tab" : "space";
        if (!kind) kind = k;
        else if (k !== kind) { found.push({ line: n, msg: "TabError: inconsistent use of tabs and spaces in indentation" }); break; }
      }
      if (open) {
        if (w <= stack[stack.length - 1]) { found.push({ line: n, col: w, carets: Math.max(1, (/^[A-Za-z_]\w*/.exec(t) || ["x"])[0].length), msg: `IndentationError: expected an indented block after ${open.what} on line ${open.line}` }); break; }
        stack.push(w);
      } else if (w > stack[stack.length - 1]) { found.push({ line: n, msg: "IndentationError: unexpected indent" }); break; }
      else if (w < stack[stack.length - 1]) {
        while (stack.length > 1 && stack[stack.length - 1] > w) stack.pop();
        if (stack[stack.length - 1] !== w) { found.push({ line: n, col: line.trimEnd().length, msg: "IndentationError: unindent does not match any outer indentation level" }); break; }
      }
      const first = (/^[a-z]+/.exec(t) || [""])[0];
      if (OPENERS[first] && !/:/.test(t) && !(first === "match" || first === "case")) {
        found.push({ line: n, col: line.trimEnd().length, msg: "SyntaxError: expected ':'" });
        break;
      }
      open = /:\s*$/.test(t) && !/^lambda\b/.test(t) ? { line: n, what: OPENERS[first] || `'${first || "if"}' statement` } : null;
    }
    if (open && !found.length) found.push({ line: py.raw.length + 1, msg: `IndentationError: expected an indented block after ${open.what} on line ${open.line}` });
    return found.sort((a, b) => a.line - b.line)[0] || null;
  }

  // Names a script uses that need an import (or an assignment) first.
  const NAMES = ["Path", "time", "random", "shlex", "subprocess", "json", "logging", "sys", "os", "yaml", "csv", "re", "shutil", "ast", "asyncio",
    "ThreadPoolExecutor", "ProcessPoolExecutor", "as_completed", "concurrent", "timezone", "datetime", "requests", "urllib", "socket", "ssl",
    "argparse", "pickle", "functools", "lru_cache", "sysconfig", "tempfile", "secrets", "hashlib", "itertools", "collections", "Counter", "gzip", "glob",
    "boto3", "Config", "ClientError"];
  function undefinedName(py) {
    for (const name of NAMES) {
      const bound = new RegExp(`^\\s*(import\\s+([\\w.]+(\\s+as\\s+\\w+)?\\s*,\\s*)*${name}\\b(?!\\s+as)|from\\s+[\\w.]+\\s+import\\s+[^\\n]*\\b${name}\\b|import\\s+[\\w.]+\\s+as\\s+${name}\\b|(async\\s+)?def\\s+${name}\\b|class\\s+${name}\\b)|^\\s*${name}\\s*=[^=]|\\bfor\\s+${name}\\b|\\bas\\s+${name}\\b|\\bdef\\s+\\w+\\([^)]*\\b${name}\\b`, "m");
      if (bound.test(py.text)) continue;
      const use = new RegExp(`(?<![\\w.'"])${name}(?![\\w'"])(?!\\s*=[^=])`);
      const n = py.bare.findIndex((b, i) => use.test(b) && !/^\s*(import|from)\s/.test(py.code[i]));
      if (n >= 0) return { name, line: n + 1 };
    }
    return null;
  }

  // --- what the run prints ------------------------------------------------------

  // A traceback: the script's own frames (from line n up through its callers),
  // then library frames [file, line, function, source], then the error.
  function traceback(py, file, n, lib, error, chained) {
    const frames = [];
    const seen = new Set();
    let at = n;
    while (at && !seen.has(at) && frames.length < 6) {
      seen.add(at);
      const fn = py.fnOf(at);
      frames.unshift([`${HOME}/${file}`, at, fn, py.src(at)]);
      if (fn === "<module>") break;
      const callers = py.lines(new RegExp(`(?<![\\w.])${fn}\\s*\\(`)).filter((l) => !/^\s*(async\s+)?def\s/.test(py.code[l - 1]));
      at = callers.find((l) => py.fnOf(l) !== fn) || 0;
    }
    return [...(chained || []).map((t) => [t, "err"]), ["Traceback (most recent call last):", "err"],
      ...[...frames, ...(lib || [])].flatMap(([f, l, fn, s]) => [[`  File "${f}", line ${l}, in ${fn}`, "err"], ...(s ? s.split("\n").map((x) => [`    ${x}`, "err"]) : [])]),
      ...error.split("\n").map((e) => [e, "err"])];
  }

  function syntaxReport(py, file, e) {
    const out = [[`  File "${HOME}/${file}", line ${e.line}`, "err"]];
    const text = py.raw[e.line - 1];
    if (text != null && text.trim()) {
      const lead = text.length - text.trimStart().length;
      out.push([`    ${text.trim()}`, "err"]);
      if (e.col != null) out.push([`    ${" ".repeat(Math.max(0, e.col - lead))}${"^".repeat(e.carets || 1)}`, "err"]);
    }
    out.push([e.msg, "err"]);
    return out;
  }

  // Values of a print or logging call, for showing what it writes:
  // the first string literal, with simple {name} fields filled in.
  function say(call, vars) {
    if (!call) return "";
    const m = /^[fr]*(["'])(.*)\1$/s.exec((call.pos[0] || "").trim());
    if (!m) return call.pos.map((p) => (p in (vars || {}) ? vars[p] : p)).join(" ");
    return m[2].replace(/\{([^{}:!]+)(![rsa])?(:[^{}]*)?\}/g, (_, k) => {
      const v = (vars || {})[k.trim()];
      return v == null ? `{${k}}` : String(v);
    }).replace(/\\n/g, " ");
  }

  // --- scenarios ----------------------------------------------------------------

  const H = { HOME, LIB, VENV, traceback, say, splitTop };
  const SCENARIOS = (root.PY_SCENARIOS || (() => []))(H);

  // Edits are [old, new] pairs applied in order; each old text must exist.
  function applyEdits(text, edits) {
    return edits.reduce((t, [a, b]) => {
      if (!t.includes(a)) throw new Error(`edit not found: ${a.slice(0, 60)}`);
      return t.replace(a, () => b);
    }, text);
  }
  const solution = (s) => applyEdits(s.code, s.fix);

  // Run a script against its scenario: the printed lines, the exit status,
  // and each live check with whether it holds now.
  function evaluate(s, source) {
    const py = parse(source);
    const checks = (ok) => s.checks.map((label, i) => [label, Boolean(ok && ok[i])]);
    // Crontabs, shell scripts and requirements files are not Python.
    const e = s.lang ? null : syntax(py);
    if (e) return { out: syntaxReport(py, s.file, e), exit: 1, checks: checks([]), errorLine: Math.min(e.line, py.raw.length) };
    const u = s.lang ? null : undefinedName(py);
    if (u) {
      return { out: traceback(py, s.file, u.line, null, `NameError: name '${u.name}' is not defined`), exit: 1, checks: checks([]), errorLine: u.line };
    }
    const r = s.sim(py, H);
    const errorLine = (r.out.find(([t]) => t.startsWith(`  File "${HOME}/`)) && [...r.out].reverse().map(([t]) => /^ {2}File "\/home\/ops\/[^"]+", line (\d+)/.exec(t)).find(Boolean)) || null;
    return { out: r.out, exit: r.exit, checks: checks(r.ok), errorLine: errorLine ? Number(errorLine[1]) : 0 };
  }
  const won = (state) => state.checks.length > 0 && state.checks.every(([, ok]) => ok);
  for (const s of SCENARIOS) s.won = won;

  root.PYSim = { SCENARIOS, parse, syntax, evaluate, won, applyEdits, solution, undefinedName };

  // --- UI -------------------------------------------------------------------------

  if (typeof document === "undefined") return;
  const box = document.getElementById("pg");
  if (!box) return;
  const { h } = root.PYUI;
  const $ = (id) => document.getElementById(id);
  const editor = $("pg-code"), gutter = $("pg-gutter"), out = $("pg-out"), picker = $("pg-scenarios");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem("dq-python:" + k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("dq-python:" + k, JSON.stringify(v)); } catch { /* storage blocked */ } }
  };
  let scenario = SCENARIOS[0], hint = 0, solved = false;

  // The picker, brief and checks are shared with app.js, which draws them before this script loads.
  const renderPicker = (justSolved) => root.PYUI.renderPicker(scenario.id, justSolved);

  function numbers() {
    const n = editor.value.split("\n").length;
    const bad = Number(editor.dataset.errorLine || 0);
    gutter.replaceChildren(...Array.from({ length: n }, (_, i) => h("span" + (i + 1 === bad ? ".err" : ""), null, String(i + 1))));
    gutter.scrollTop = editor.scrollTop;
  }

  const renderChecks = (state) => root.PYUI.renderChecks(scenario.checks, state);

  function load(id, keep) {
    scenario = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
    hint = 0;
    solved = false;
    const drafts = store.get("drafts", {});
    editor.value = keep && drafts[scenario.id] != null ? drafts[scenario.id] : scenario.code;
    editor.dataset.errorLine = "";
    root.PYUI.renderBrief(scenario);
    $("pg-real").textContent = scenario.real.join("\n");
    $("pg-hint").replaceChildren();
    renderPicker();
    numbers();
    const cur = picker.querySelector('[aria-pressed="true"]');
    if (cur && picker.scrollWidth > picker.clientWidth) picker.scrollLeft = cur.offsetLeft - 48;
  }

  function run() {
    const state = evaluate(scenario, editor.value);
    editor.dataset.errorLine = state.errorLine || "";
    numbers();
    out.replaceChildren(h("div.pg-line.cmd", null, `$ ${scenario.cmd}`),
      ...state.out.map(([t, c]) => h("div.pg-line" + (c ? "." + c : ""), null, t || " ")),
      h("div.pg-line.dim", null, `[exit status ${state.exit}]`));
    out.scrollTop = 0;
    renderChecks(state);
    if (won(state) && !solved) {
      solved = true;
      store.set("solved", [...new Set([...store.get("solved", []), scenario.id])]);
      document.dispatchEvent(new CustomEvent("dq:solved", { detail: scenario.id }));
      renderPicker(true);
      $("pg-goal").textContent = "Fixed. " + scenario.lesson;
      $("pg-goal").className = "pg-goal done";
      const next = SCENARIOS.find((s) => !store.get("solved", []).includes(s.id));
      out.append(h("div.pg-line.ok", null, "✓ Fixed. " + scenario.lesson),
        h("div.pg-line.dim", null, next ? `Next: ${next.title}. Pick it above.` : "You solved every scenario. Now run the real scripts in scripts/."));
    } else if (!won(state) && solved) {
      solved = false;
      $("pg-goal").textContent = "Goal: " + scenario.goal;
      $("pg-goal").className = "pg-goal";
    }
  }

  // A small code editor: Tab indents, Enter keeps the indentation (and adds
  // a level after a colon), Ctrl+Enter runs, Esc lets Tab leave the editor.
  let tabLeaves = false;
  editor.addEventListener("keydown", (e) => {
    const { selectionStart: a, selectionEnd: b, value: v } = editor;
    if (e.key === "Escape") { tabLeaves = true; return; }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); return; }
    if (e.key === "Tab" && !tabLeaves) {
      e.preventDefault();
      const start = v.lastIndexOf("\n", a - 1) + 1;
      if (e.shiftKey) {
        const lead = /^ {1,4}/.exec(v.slice(start));
        if (lead) editor.setRangeText("", start, start + lead[0].length, "end");
      } else editor.setRangeText("    ", a, b, "end");
      editor.dispatchEvent(new Event("input"));
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const line = v.slice(v.lastIndexOf("\n", a - 1) + 1, a);
      const lead = /^\s*/.exec(line)[0] + (/:\s*$/.test(line) ? "    " : "");
      editor.setRangeText("\n" + lead, a, b, "end");
      editor.dispatchEvent(new Event("input"));
    }
  });
  editor.addEventListener("blur", () => { tabLeaves = false; });
  editor.addEventListener("input", () => {
    editor.dataset.errorLine = "";
    numbers();
    const drafts = store.get("drafts", {});
    drafts[scenario.id] = editor.value;
    store.set("drafts", drafts);
  });
  editor.addEventListener("scroll", () => { gutter.scrollTop = editor.scrollTop; });
  $("pg-run").addEventListener("click", run);
  $("pg-reset").addEventListener("click", () => {
    const drafts = store.get("drafts", {});
    delete drafts[scenario.id];
    store.set("drafts", drafts);
    load(scenario.id);
  });
  $("pg-hint-btn").addEventListener("click", () => {
    const i = Math.min(hint++, scenario.hints.length - 1);
    $("pg-hint").replaceChildren(h("p", null, h("strong", null, `Hint ${i + 1} of ${scenario.hints.length}. `), ...root.PYUI.rich(scenario.hints[i])));
  });
  $("pg-copy").addEventListener("click", (e) => root.PYUI.copyLink(e.currentTarget, "play/" + scenario.id));

  root.PYPlayground = {
    scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title, group: s.group, story: s.story, level: s.level })),
    current: () => scenario.id,
    load: (id) => { if (id !== scenario.id || !editor.value) load(id, true); }
  };
  load(SCENARIOS[0].id, true);
})(typeof window !== "undefined" ? window : globalThis);
