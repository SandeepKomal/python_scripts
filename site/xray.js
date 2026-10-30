// Script X-ray: explains a pasted Python script line by line, offline, and
// flags risky patterns with the site's own rules. It reads the code with the
// playground's parser (comments and strings told apart, statements joined
// across brackets). Nothing leaves the browser. site-tests/check_xray.js
// drives it under Node.
"use strict";

(function (root) {
  const MAX_LINES = 600;

  // What each standard-library (and common third-party) module is for.
  const MODULES = {
    argparse: "command-line options, --help and usage errors", ast: "Python's syntax tree; ast.literal_eval reads literals safely", asyncio: "an event loop for many concurrent network tasks in one thread",
    base64: "base64 encoding (not encryption)", collections: "Counter, defaultdict, deque and other containers", concurrent: "thread and process pools (concurrent.futures)",
    "concurrent.futures": "thread and process pools", configparser: "INI-style config files", contextlib: "helpers for with-blocks", copy: "shallow and deep copies", csv: "reading and writing CSV correctly, quoting included",
    dataclasses: "classes that are mostly data", datetime: "dates, times, durations and time zones", email: "building and parsing email messages", enum: "named constants", fnmatch: "shell-style wildcard matching",
    fcntl: "file locks and other Unix file controls", functools: "caching, partial functions and decorator helpers", getpass: "reading a password without echoing it", glob: "file name wildcards",
    gzip: "reading and writing .gz files", hashlib: "checksums and hashes (sha256...)", heapq: "the smallest or largest N items without a full sort", hmac: "message signatures; compare_digest for safe comparison",
    http: "HTTP status codes, a client and a small server", io: "in-memory files and stream classes", ipaddress: "IP addresses and networks", itertools: "efficient looping helpers", json: "JSON encoding and decoding",
    logging: "levelled, configurable logs", math: "maths functions", multiprocessing: "processes, for CPU-bound work", os: "the operating system: environment, files, processes", pathlib: "file paths as objects, portable across systems",
    pickle: "Python object serialisation (never load untrusted data)", platform: "details of the OS and interpreter", pprint: "readable printing of nested data", queue: "thread-safe queues", random: "pseudo-random numbers (not for secrets)",
    re: "regular expressions", secrets: "secure random tokens and passwords", select: "waiting on several sockets or pipes", shlex: "shell-style splitting and quoting", shutil: "copying, moving, archives, disk usage, which",
    signal: "Unix signals such as SIGTERM", smtplib: "sending email over SMTP", socket: "low-level network connections", sqlite3: "an embedded SQL database", ssl: "TLS contexts and certificates",
    statistics: "mean, median, quantiles", string: "string constants and templates", subprocess: "running other programs", sys: "the interpreter: argv, exit, stdin and stdout", tarfile: ".tar archives",
    tempfile: "safe temporary files and directories", textwrap: "wrapping and dedenting text", threading: "threads, for waiting on I/O in parallel", time: "clocks and sleeping", tomllib: "reading TOML (3.11+)",
    traceback: "formatting tracebacks", typing: "type hints", unittest: "the standard test framework", "unittest.mock": "replacing objects in tests", urllib: "URLs and a basic HTTP client",
    "urllib.request": "a basic HTTP client (urlopen)", "urllib.parse": "building and splitting URLs", "urllib.error": "HTTPError and URLError", uuid: "unique identifiers", venv: "virtual environments",
    zipfile: ".zip archives", zoneinfo: "IANA time zones (3.9+)", distutils: "old packaging tools, removed in Python 3.12",
    requests: "third-party HTTP client (pip install requests)", yaml: "third-party YAML parser (pip install PyYAML)", boto3: "third-party AWS SDK", paramiko: "third-party SSH client",
    psutil: "third-party process and system metrics", click: "third-party command-line framework", jinja2: "third-party templates", psycopg: "third-party PostgreSQL driver", psycopg2: "third-party PostgreSQL driver",
    kubernetes: "third-party Kubernetes client", docker: "third-party Docker SDK", fabric: "third-party SSH task runner", pytest: "third-party test framework", httpx: "third-party HTTP client (sync and async)",
    aiohttp: "third-party async HTTP client", packaging: "third-party version and requirement parsing", dotenv: "third-party .env loader", rich: "third-party terminal formatting", toml: "third-party TOML parser"
  };

  // [callee pattern, note]. First match wins; checked against the start of the call.
  const CALLS = [
    [/^print$/, "Writes to standard output. In scripts that run unattended, logging gives levels and timestamps."],
    [/^logging\.basicConfig$/, "Configures logging once for the whole program: level, format, destination."],
    [/^logging\.getLogger$/, "Gets a named logger. Configure handlers once, at start-up, not here."],
    [/\.(debug|info|warning|error|critical)$/, "Writes a log record at this level. Pass values as arguments (\"%s\", x) so they are formatted only if the record is shown."],
    [/\.exception$/, "Logs an error with the current traceback; call it inside an except block."],
    [/^subprocess\.run$/, "Runs a program and waits for it. Pass a list of arguments; check=True raises on a non-zero exit; timeout= stops it waiting for ever."],
    [/^subprocess\.(check_output|check_call)$/, "Runs a program and raises CalledProcessError if it fails."],
    [/^subprocess\.(call|Popen)$/, "Starts a program. call returns the exit status; Popen gives full control over pipes."],
    [/^os\.system$/, "Runs a command line through the shell and returns a raw wait status."],
    [/^os\.(environ\.get|getenv)$/, "Reads an environment variable, or the default if it is unset. The value is always a string."],
    [/^os\.path\.join$/, "Joins path parts with the right separator."],
    [/^os\.path\.(exists|isfile|isdir)$/, "Tests whether a path exists (or is a file, or a directory)."],
    [/^os\.path\.(getsize|getmtime)$/, "Reads a file's size or modification time."],
    [/^os\.path\.(expanduser|abspath|realpath|dirname|basename|splitext)$/, "Transforms a path string."],
    [/^os\.(makedirs|mkdir)$/, "Creates a directory; makedirs(..., exist_ok=True) creates parents and does not fail if it exists."],
    [/^os\.(remove|unlink|rmdir)$/, "Deletes a file (or an empty directory)."],
    [/^os\.(replace|rename)$/, "Renames a file. os.replace overwrites the target atomically on the same file system."],
    [/^os\.(walk|scandir|listdir)$/, "Lists a directory (walk goes through the whole tree, without following symlinks by default)."],
    [/^os\.chmod$/, "Changes a file's permissions."],
    [/^shutil\.(copy|copy2|copyfile|copytree)$/, "Copies files (copy2 keeps timestamps)."],
    [/^shutil\.(move|rmtree)$/, "Moves a file or tree, or deletes a whole tree."],
    [/^shutil\.disk_usage$/, "Total, used and free bytes of the file system holding a path."],
    [/^shutil\.make_archive$/, "Creates a zip or tar archive of a directory."],
    [/^shutil\.which$/, "Finds a program on PATH, or returns None."],
    [/^(pathlib\.)?Path$/, "A path object; join with /, read with read_text(), list with glob()."],
    [/\.(read_text|read_bytes)$/, "Reads a whole file into memory."],
    [/\.(write_text|write_bytes)$/, "Replaces a file's content in one call."],
    [/\.(glob|rglob|iterdir)$/, "Lists matching paths (rglob searches subdirectories)."],
    [/^open$/, "Opens a file. Use it in a with block, and pass encoding= for text."],
    [/^json\.(load|loads)$/, "Parses JSON into dicts, lists, strings and numbers."],
    [/^json\.(dump|dumps)$/, "Writes JSON. Only dicts, lists, str, int, float, bool and None can be written as they are."],
    [/^yaml\.safe_load$/, "Parses YAML into plain data only; unknown tags are rejected."],
    [/^yaml\.(load|unsafe_load|full_load)$/, "Parses YAML; with the full loaders a file can create arbitrary Python objects."],
    [/^csv\.(reader|DictReader)$/, "Reads CSV rows, handling quotes and embedded commas."],
    [/^csv\.(writer|DictWriter)$/, "Writes CSV rows with correct quoting."],
    [/^re\.compile$/, "Compiles a regular expression once, for reuse in a loop."],
    [/^re\.(search|match|fullmatch|findall|finditer|sub|split)$/, "Applies a regular expression."],
    [/\.(search|match|fullmatch|findall|finditer|group|groupdict)$/, "Uses a compiled regular expression or its match."],
    [/^requests\.(get|post|put|patch|delete|head|request)$/, "Sends an HTTP request with the requests library."],
    [/^requests\.Session$/, "A session reuses connections and default headers across requests."],
    [/\.raise_for_status$/, "Raises HTTPError for a 4xx or 5xx response."],
    [/\.json$/, "Parses the response body as JSON."],
    [/^urllib\.request\.urlopen$|^urlopen$/, "Sends an HTTP request with the standard library; raises HTTPError for 4xx and 5xx."],
    [/^urllib\.request\.Request$/, "Describes an HTTP request: URL, headers, method and body."],
    [/^time\.sleep$/, "Pauses the whole thread."],
    [/^time\.(time|monotonic|perf_counter)$/, "Reads a clock. Use monotonic() to measure durations; time() can jump."],
    [/^(datetime\.)?datetime\.(now|utcnow|fromisoformat|strptime|fromtimestamp)$|^datetime\.(now|utcnow|fromisoformat|strptime|fromtimestamp)$/, "Creates a datetime. Make it aware (now(timezone.utc)) so it can be compared and converted."],
    [/^(datetime\.)?timedelta$/, "A duration, for date arithmetic."],
    [/^argparse\.ArgumentParser$/, "Creates the command-line parser; it writes --help and usage errors for you."],
    [/\.add_argument$/, "Declares an option or argument: type=, required=, choices= and default= do the validation."],
    [/\.parse_args$/, "Parses sys.argv; on bad input it prints usage and exits with status 2."],
    [/^sys\.exit$/, "Ends the program with an exit status: 0 for success, non-zero for failure."],
    [/^socket\.(create_connection|socket|getaddrinfo|gethostname)$/, "Low-level networking: connections, name lookups, the host name."],
    [/^ssl\.create_default_context$/, "TLS settings that verify certificates and host names."],
    [/^hashlib\.\w+$/, "Computes a hash of bytes."],
    [/^secrets\.\w+$/, "Generates unpredictable tokens, suitable for passwords and keys."],
    [/^random\.\w+$/, "Pseudo-random numbers: fine for jitter and sampling, not for secrets."],
    [/^(concurrent\.futures\.)?ThreadPoolExecutor$/, "A pool of threads: good for waiting on many network or disk calls at once."],
    [/^(concurrent\.futures\.)?ProcessPoolExecutor$/, "A pool of processes: runs CPU-bound Python on several cores."],
    [/\.submit$/, "Schedules a call on the pool and returns a Future; call .result() to get its value or its exception."],
    [/\.map$/, "Runs a function over items; iterate the results to collect them (and their exceptions)."],
    [/^(concurrent\.futures\.)?as_completed$/, "Yields futures as they finish."],
    [/^asyncio\.(run|gather|sleep|create_task|wait_for|open_connection|to_thread|TaskGroup)$/, "asyncio: runs coroutines concurrently on one event loop."],
    [/^threading\.(Thread|Lock|Event)$/, "A thread or a synchronisation primitive."],
    [/^tempfile\.\w+$/, "Creates a temporary file or directory with a safe, unique name."],
    [/^pickle\.(load|loads)$/, "Rebuilds Python objects from a pickle; the data decides which code runs."],
    [/^pickle\.(dump|dumps)$/, "Serialises Python objects."],
    [/^(eval|exec)$/, "Runs a string as Python code."],
    [/^input$/, "Waits for someone to type a line; scripts under cron or CI have no one there."],
    [/^(len|range|sorted|enumerate|zip|dict|list|set|tuple|sum|min|max|any|all|int|float|str|bool|isinstance|getattr|hasattr|round|abs|reversed|map|filter|repr|format|iter|next|type)$/, "A built-in function."],
    [/^(collections\.)?(Counter|defaultdict|deque|namedtuple|OrderedDict)$/, "A container from collections."],
    [/^heapq\.\w+$/, "Heap operations: the N largest or smallest items cheaply."],
    [/^(gzip|tarfile|zipfile)\.\w+$/, "Reads or writes a compressed archive."],
    [/^glob\.glob$/, "Lists paths matching a wildcard."],
    [/^getpass\.getpass$/, "Prompts for a password without echoing it."],
    [/\.set_missing_host_key_policy$/, "Decides what to do with SSH host keys the client has never seen."],
    [/^boto3\.(client|resource|Session)$/, "Creates an AWS client; credentials come from the environment, a profile or the instance role."],
    [/^signal\.signal$/, "Installs a handler for a signal such as SIGTERM."],
    [/^(functools\.)?(partial|reduce)$/, "Builds a function with some arguments fixed, or folds a sequence."],
    [/\.(append|extend|insert|pop|remove|clear|update|setdefault|get|items|keys|values|copy|sort|reverse|split|rsplit|strip|lstrip|rstrip|join|replace|startswith|endswith|lower|upper|format|encode|decode|splitlines|count|index|find|partition|rpartition|removeprefix|removesuffix|most_common)$/, "A method on a str, list or dict."],
    [/\.(close|flush|write|read|readline|readlines|seek|tell|fileno)$/, "A method on a file object."],
    [/\.(unlink|mkdir|exists|stat|resolve|is_file|is_dir|touch|rename|with_suffix|with_name|relative_to|expanduser|absolute)$/, "A method on a Path."],
    [/\.(result|exception|cancel|done)$/, "Reads a Future: its value, or the exception the work raised."],
    [/\.(assert\w+|fail|skipTest)$/, "A unittest assertion."],
    [/\.(cache_info|cache_clear)$/, "Inspects or empties an lru_cache."]
  ];

  const DECORATORS = [
    [/^dataclass(es\.dataclass)?/, "Generates __init__, __repr__ and comparisons from the class's fields."],
    [/^property$/, "Makes the method readable like an attribute."],
    [/^(staticmethod|classmethod)$/, "A method that does not take the instance (static) or takes the class (classmethod)."],
    [/^(functools\.)?lru_cache/, "Remembers results by argument. Give it a maxsize in long-running programs."],
    [/^(functools\.)?cache$/, "Remembers every result for ever: an unbounded cache."],
    [/^(functools\.)?wraps/, "Keeps the wrapped function's name and docstring."],
    [/^(contextlib\.)?contextmanager$/, "Turns a generator into a with-block helper."],
    [/^(mock\.|unittest\.mock\.)?patch/, "Replaces an object for the length of this test."],
    [/^unittest\.skip/, "Skips this test."],
    [/^pytest\./, "A pytest marker or fixture."]
  ];

  const isSecretName = (s) => /\b(\w*(password|passwd|secret|token|api_?key|apikey|access_?key|private_?key|credentials?)\w*)\b/i.test(s);

  // Risky patterns in one statement. n is its first line.
  function risks(py, n, stmt) {
    const w = [];
    const code = stmt;
    stmt = stmt.replace(/(["'])(?:\\.|(?!\1).)*\1/g, (q) => (/^["'](\/tmp\/|[a-z][\w+.-]*:\/\/)/.test(q) ? q : '""'));
    const calls = (re) => py.calls(re).filter((c) => c.line >= n && c.line <= n + stmt.split("\n").length - 1);
    for (const c of calls("requests\\.(get|post|put|patch|delete|head|request)|\\w+\\.session\\.(get|post)|session\\.(get|post|put|delete)")) {
      if (!c.kw.timeout) w.push("No timeout: if the server accepts the connection and never answers, this waits for ever. Add timeout=10 (or a (connect, read) tuple).");
      else if (/^None$/.test(c.kw.timeout)) w.push("timeout=None means no timeout at all.");
      if (/^False$/.test(c.kw.verify || "")) w.push("verify=False turns off certificate checks: anyone on the network path can impersonate the server. Point verify= at your CA bundle instead.");
    }
    for (const c of calls("(urllib\\.request\\.)?urlopen")) if (!c.kw.timeout && c.pos.length < 3) w.push("No timeout: urlopen waits for ever on a server that stops answering. Pass timeout=.");
    for (const c of calls("subprocess\\.(run|call|check_call|check_output|Popen)")) {
      const a = (c.pos[0] || c.kw.args || "").trim();
      if (/^True$/.test(c.kw.shell || "")) {
        w.push(/^f["']|\+|\.format\(|%\s*\(/.test(a) ? "shell=True with text built from variables: input containing ; | $( ) runs as extra commands (shell injection). Pass a list and drop shell=True." : "shell=True runs the command through /bin/sh. Prefer a list of arguments without a shell.");
      }
      if (c.name === "subprocess.run" && !/^True$/.test(c.kw.check || "")) {
        const v = (/^\s*(\w+)\s*=/.exec(py.code[c.line - 1]) || [])[1];
        if (!v || !new RegExp(`\\b${v}\\.(returncode|check_returncode)`).test(py.text)) w.push("The exit status is ignored: without check=True (or a returncode test) a failed command looks like success.");
      }
      if (/^(run|check_output|check_call|call)$/.test(c.name.split(".").pop()) && !c.kw.timeout && /ssh|curl|wget|kubectl|aws|gcloud|scp|rsync|git|ping|nc\b/.test(a)) w.push("No timeout on a command that talks to the network: a stuck remote side stops the script. Add timeout=.");
    }
    if (/(?<![\w.])os\.(system|popen)\s*\(/.test(stmt)) w.push("os.system and os.popen go through the shell and hide failures. Use subprocess.run with a list and check=True.");
    if (/(?<![\w.])(eval|exec)\s*\(/.test(stmt)) w.push("eval/exec run text as code. If any part comes from input, a file, an environment variable or the network, that is code execution. Parse values with int(), json.loads() or ast.literal_eval().");
    if (/\byaml\.load\s*\(/.test(stmt) && !/Loader\s*=\s*(yaml\.)?C?SafeLoader/.test(stmt)) w.push("yaml.load without SafeLoader: a YAML file can build arbitrary Python objects. Use yaml.safe_load().");
    if (/\byaml\.(unsafe_load|load_all)\s*\(|Loader\s*=\s*(yaml\.)?(C?Unsafe)?Loader\b/.test(stmt) && !/SafeLoader/.test(stmt)) w.push("This YAML loader can construct any Python object from the file. Use yaml.safe_load().");
    if (/\b(pickle|marshal|shelve|dill)\.(loads?|open)\s*\(/.test(stmt)) w.push("Unpickling runs code chosen by whoever wrote the data. Only load pickles you created and nobody else could change; use JSON for anything shared.");
    if (/^\s*except\s*:/.test(stmt)) w.push("A bare except also catches SystemExit and KeyboardInterrupt, and hides typos. Catch the specific exceptions you can handle.");
    if (/^\s*except\b.*:/.test(stmt) && /^\s*pass\s*$/.test(py.bodyText(n))) w.push("The error is swallowed without a trace. At least log it, and catch only what you expect.");
    if (/^\s*except\s+\(?\s*(Exception|BaseException)\b/.test(stmt) && /^\s*(pass|continue)\s*$/.test(py.bodyText(n))) w.push("A broad except that does nothing hides every bug in the try block.");
    const def = /^\s*(async\s+)?def\s+\w+\s*\(([\s\S]*)\)\s*(->[^:]+)?:/.exec(stmt);
    if (def && /=\s*(\[\]|\{\}|set\(\)|list\(\)|dict\(\))/.test(def[2])) w.push("A mutable default argument is created once and shared by every call. Default to None and create the list or dict inside.");
    const secret = /^\s*([A-Za-z_][\w.]*)\s*[:=]\s*[rbuf]?["']([^"'\s]{6,})["']/.exec(code) || /["'](password|passwd|secret|token|api_?key)["']\s*:\s*["']([^"'\s]{6,})["']/i.exec(code);
    if (secret && isSecretName(secret[1]) && !/^(changeme|example|placeholder|xxx+|<.*>|\$\{.*\}|test|dummy)/i.test(secret[2]) && !/^(https?:\/\/|\/|\.|[A-Z_]+$)/.test(secret[2])) w.push("A credential written into the code: everyone with the repository (and its history) has it. Read it from the environment or a secret store, and rotate this one.");
    if (/[a-z][\w+.-]*:\/\/[^/\s:@"']+:[^/\s:@"']{3,}@/.test(code)) w.push("A password inside a URL. It ends up in logs and tracebacks; pass credentials separately.");
    for (const c of calls("print|(logging|log|logger|self\\.log)\\.(debug|info|warning|error|critical|exception)")) {
      const named = /\b(headers|\w*password\w*|\w*passwd\w*|\w*secret\w*|\w*token\w*|\w*api_?key\w*|credentials?|authorization)\b/i.test(c.args.replace(/["'][^"']*["']/g, ""));
      const keyed = /\[\s*["'][^"']*(token|secret|password|passwd|api_?key|credential)[^"']*["']\s*\]/i.test(c.args);
      if ((named || keyed) && !/mask|redact|\[\s*:\s*\d+\s*\]/.test(c.args)) {
        w.push("This prints or logs something that looks like a credential. Logs are copied to many places; log that it happened, not the secret.");
      }
    }
    if (/\bopen\s*\(/.test(stmt) && !/^\s*(with|async\s+with)\b/.test(stmt) && !/\bwith\b[^\n]*open\s*\(/.test(stmt)) {
      const v = (/^\s*(\w+)\s*=.*\bopen\s*\(/.exec(stmt) || [])[1];
      const managed = v && new RegExp(`with\\s+${v}\\b|${v}\\.close\\(\\)|return\\s+${v}\\b|yield\\s+${v}\\b`).test(py.text);
      if (!managed && !/\b(os\.open|\.open\(|gzip\.open|tarfile\.open|zipfile)/.test(stmt.replace(/(?<![\w.])open\s*\(/, ""))) w.push("open() outside a with block: the file may not be flushed or closed when you expect. Use `with open(...) as f:`.");
    }
    if (/\bopen\s*\(/.test(stmt) && !/encoding\s*=|["'][rwax+]*b[rwax+]*["']|\bmode\s*=\s*["'][^"']*b/.test(code) && /(?<![\w.])open\s*\(/.test(stmt) && !/os\.open/.test(stmt)) w.push("No encoding=: the text encoding then depends on the machine's locale. Pass encoding=\"utf-8\" (or what the file really uses).");
    if (/\.readlines\s*\(\s*\)/.test(stmt)) w.push("readlines() loads the whole file into memory. Loop over the file object to stream it line by line.");
    const loop = py.inside(n, /^(while|for)\b/);
    if (/\btime\.sleep\s*\(\s*\d+(\.\d+)?\s*\)/.test(stmt) && loop && /\bexcept\b/.test(py.bodyText(loop.line))) {
      w.push("A fixed sleep in a retry loop: every client retries in step, and a long one wastes time. Back off exponentially with random jitter, and cap the attempts.");
    }
    if (/\btime\.sleep\s*\(/.test(stmt) && py.inside(n, /^async\s+def\b/)) w.push("time.sleep inside async code blocks the whole event loop. Use await asyncio.sleep().");
    if (/\bdatetime\.(utcnow|now)\s*\(\s*\)/.test(stmt) || /(?<![\w.])datetime\.now\s*\(\s*\)/.test(stmt)) w.push("A naive datetime (no time zone): it cannot be compared with aware ones, and means whatever the server's clock zone is. Use datetime.now(timezone.utc).");
    if (/\bsys\.argv\s*\[\s*[1-9]/.test(stmt)) w.push("sys.argv[n] raises IndexError when the argument is missing. argparse gives a usage message instead.");
    if (/^\s*assert\b/.test(stmt) && !/^\s*def\s+test|unittest|pytest/.test(py.text.slice(0, 200)) && !/test_/.test(py.fnOf(n))) w.push("assert is removed when Python runs with -O. Do not use it to validate input; raise an exception.");
    if (/\bverify\s*=\s*False\b|_create_unverified_context|check_hostname\s*=\s*False|CERT_NONE/.test(stmt) && !w.some((x) => /verify=False/.test(x))) w.push("Certificate verification is turned off.");
    if (/AutoAddPolicy|WarningPolicy/.test(stmt)) w.push("Unknown SSH host keys are accepted, so a machine in the middle is never noticed. Load known_hosts and use RejectPolicy.");
    if (/\btempfile\.mktemp\s*\(|["']\/tmp\/[\w.-]+["']/.test(stmt) && /open\s*\(|=\s*["']\/tmp/.test(stmt)) w.push("A fixed name in /tmp: other users can create it first or swap it. Use tempfile.mkstemp/NamedTemporaryFile, or a private directory.");
    if (/\brandom\.(choice|choices|randint|random|sample|getrandbits)\s*\(/.test(stmt) && /token|password|secret|key|salt|nonce/i.test(stmt)) w.push("random is predictable. Generate tokens and passwords with the secrets module.");
    if (/\bhashlib\.(md5|sha1)\s*\(/.test(stmt) && /password|passwd/i.test(stmt)) w.push("MD5 and SHA-1 are too fast for passwords. Use hashlib.scrypt or a dedicated password hash.");
    if (/\bchmod\s*\([^)]*0o?777\b/.test(stmt)) w.push("Mode 777 lets every user change this file.");
    if (/^\s*from\s+\S+\s+import\s+\*/.test(stmt)) w.push("import * hides where names come from and can overwrite yours.");
    if (/^\s*(from\s+distutils|import\s+distutils)\b|\bimport\s+(imp|asynchat|asyncore|smtpd|cgi|cgitb|crypt|telnetlib|pipes)\b/.test(stmt)) w.push("This module was removed from recent Python versions (distutils in 3.12; imp, asynchat, asyncore, smtpd in 3.12; cgi, crypt, telnetlib, pipes in 3.13).");
    if (/(?<![\w.])input\s*\(/.test(stmt)) w.push("input() waits for a person; under cron or CI it fails with EOFError. Take values from arguments or the environment.");
    if (/lru_cache\s*\(\s*maxsize\s*=\s*None|@(functools\.)?cache\b/.test(stmt)) w.push("An unbounded cache grows for as long as the process runs. Give lru_cache a maxsize.");
    return [...new Set(w)];
  }

  function explainStatement(py, n, t, stmt) {
    let m;
    if (/^[rRuUbBfF]{0,2}("""|''')/.test(t)) return py.logical[0] === n || py.inside(n, /^(class|(async\s+)?def)\b/) && py.body((py.inside(n, /^(class|(async\s+)?def)\b/)).line)[0] === n
      ? "A docstring: what this module, class or function does. --help texts and documentation tools read it." : "A string on its own line: Python evaluates it and throws it away.";
    if ((m = /^import\s+(.+)$/.exec(t))) return m[1].split(",").map((part) => { const mod = part.trim().split(/\s+as\s+/)[0]; return `Imports ${mod}: ${MODULES[mod] || MODULES[mod.split(".")[0]] || "a module"}.`; }).join(" ") + (/\sas\s/.test(m[1]) ? " `as` gives it a shorter local name." : "");
    if ((m = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(stmt.replace(/\s+/g, " ").trim()))) return `From ${m[1]} (${MODULES[m[1]] || MODULES[m[1].split(".")[0]] || "a module"}), imports ${m[2].replace(/[()]/g, "").trim()}.`;
    if (/^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(t)) return "Runs the block only when the file is executed as a script, not when it is imported (by tests, or by a process pool).";
    if ((m = /^(async\s+)?def\s+(\w+)/.exec(t))) {
      const name = m[2];
      const kind = m[1] ? "a coroutine (async function)" : "a function";
      return name === "main" ? `Defines main(), the script's entry point. Returning an exit status from it and calling sys.exit(main()) keeps the logic testable.`
        : /^test_?/.test(name) ? `Defines a test, ${name}. Test runners find it by its test_ prefix.`
          : /^__\w+__$/.test(name) ? `Defines the special method ${name}, which Python calls for you (${name === "__init__" ? "when an object is created" : "for an operator or protocol"}).`
            : `Defines ${kind}, ${name}. Its body is the indented block below.`;
    }
    if ((m = /^class\s+(\w+)\s*(\((.*)\))?/.exec(t))) return `Defines a class, ${m[1]}${m[3] ? `, based on ${m[3]}` : ""}.`;
    if ((m = /^@([\w.]+)/.exec(t))) { const d = DECORATORS.find(([re]) => re.test(m[1])); return d ? `Decorator: ${d[1]}` : `Decorator: wraps the next function or class with ${m[1]}.`; }
    if (/^if\b/.test(t)) return "Runs the indented block only when the condition is true.";
    if (/^elif\b/.test(t)) return "Checked only if the conditions above were false.";
    if (/^else\s*:/.test(t)) {
      const prev = [...py.logical].reverse().find((l) => l < n && py.ind[l - 1] === py.ind[n - 1]);
      const head = prev ? py.code[prev - 1].trim() : "";
      return /^(except|try)\b/.test(head) ? "Runs when the try block raised nothing." : /^(for|while)\b/.test(head) ? "Runs when the loop ended without break." : "Runs when the conditions above were false.";
    }
    if (/^while\s+True\s*:/.test(t)) return "Loops for ever, until break, return or an exception. Make sure something ends it.";
    if (/^(async\s+)?for\b/.test(t)) return /\bin\s+(f|fh|sys\.stdin|open\()/.test(t) ? "Loops over a file line by line: streamed, so memory stays flat." : "Loops over each item in turn.";
    if (/^while\b/.test(t)) return "Repeats the block while the condition stays true.";
    if (/^try\s*:/.test(t)) return "Runs the block; errors raised inside go to the except clauses below.";
    if (/^except\s*:/.test(t)) return "Catches every exception, including SystemExit and KeyboardInterrupt.";
    if ((m = /^except\s+(.+?)(\s+as\s+(\w+))?\s*:/.exec(t))) return `Handles ${m[1].replace(/[()]/g, "")} raised in the try block${m[3] ? `, as ${m[3]}` : ""}. Other errors pass through.`;
    if (/^finally\s*:/.test(t)) return "Always runs, error or not: the place for cleanup.";
    if (/^(async\s+)?with\b/.test(t)) return /open\s*\(/.test(t) ? "Opens a file for this block and closes it at the end, even after an error." : "A context manager: sets something up for the block and always tears it down.";
    if (/^return\b/.test(t)) return "Ends the function and hands back this value.";
    if (/^yield\b/.test(t)) return "Hands out one value and pauses: this function is a generator.";
    if (/^raise\b/.test(t)) return /\bfrom\b/.test(t) ? "Raises an error, keeping the original as its cause." : t === "raise" ? "Re-raises the exception being handled." : "Raises an error: the caller must handle it, or the script stops with a traceback.";
    if (/^break\b/.test(t)) return "Leaves the loop.";
    if (/^continue\b/.test(t)) return "Skips to the next item in the loop.";
    if (/^pass\b/.test(t)) return "Does nothing; a placeholder where Python needs a statement.";
    if (/^(global|nonlocal)\b/.test(t)) return "Lets this function assign to a variable from an outer scope.";
    if (/^assert\b/.test(t)) return "Fails with AssertionError if the condition is false (unless Python runs with -O).";
    if (/^del\b/.test(t)) return "Removes a name, list item or dict key.";
    if (/^await\b/.test(t)) return "Waits for a coroutine while other tasks run.";
    if (/^(match|case)\b/.test(t)) return "Structural pattern matching (Python 3.10+).";
    const call = (/^(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/.exec(t) || [])[1];
    const asg = /^([A-Za-z_][\w.]*(\[[\s\S]*\])?(\s*,\s*[A-Za-z_][\w.]*)*)\s*(:\s*[^=]+)?(=|\+=|-=|\*=|\/=|\|=|&=|\/\/=|%=)(?!=)\s*([\s\S]*)$/.exec(stmt.trim());
    if (asg) {
      const target = asg[1].trim(), op = asg[5], rhs = asg[6].trim();
      const rcall = (/^(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/.exec(rhs) || [])[1];
      const what = rcall ? noteFor(rcall) : null;
      const intro = op !== "=" ? `Updates ${target} in place (${op}).` : /^[A-Z][A-Z0-9_]*$/.test(target) ? `Sets the constant ${target}.` : `Stores the result in ${target}.`;
      if (/^\[.*\bfor\b.*\]$|^\{.*\bfor\b.*\}$/s.test(rhs)) return `${intro} A comprehension: builds the collection from a loop in one expression.`;
      return what ? `${intro} ${what}` : /^f?["']/.test(rhs) ? `${intro} ${/^f/.test(rhs) ? "An f-string: the {...} parts are filled in when it runs." : "A string."}` : intro;
    }
    if (call) return noteFor(call) || `Calls ${call}().`;
    const method = (/\.(\w+)\s*\([^()]*\)\s*$/.exec(t) || [])[1];
    if (method) return noteFor("." + method) || `Calls the ${method}() method.`;
    return null;
  }

  function noteFor(name) {
    const hit = CALLS.find(([re]) => re.test(name));
    return hit ? hit[1] : null;
  }

  function explain(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > MAX_LINES) return { error: `The X-ray reads up to ${MAX_LINES} lines; this has ${lines.length}. Paste one script or function at a time.` };
    const py = root.PYSim.parse(lines.join("\n"));
    const err = root.PYSim.syntax(py);
    const doc = new Set();
    // Lines inside a triple-quoted string, so they read as part of it.
    py.logical.forEach((n) => { if (/^[rRuUbBfF]{0,2}("""|''')/.test(py.code[n - 1].trim())) for (let i = n; i < py.code.length && py.cont[i]; i++) doc.add(i + 1); });
    const rows = lines.map((line, i) => {
      const n = i + 1, t = py.code[i].trim();
      if (!line.trim()) return { line, level: "blank" };
      if (py.cont[i]) {
        const owner = [...py.logical].reverse().find((l) => l < n) || 1;
        return { line, level: "cont", note: doc.has(n) ? "Part of the string that starts above." : `Continues the statement that starts on line ${owner}.` };
      }
      if (!t) {
        if (n === 1 && /^#!/.test(line)) return { line, level: "known", note: /python3/.test(line) ? "The shebang: run directly (./script.py), the system finds python3 through env. Under cron, env sees cron's short PATH." : "The shebang: which interpreter runs the file when it is executed directly.", warns: /python3/.test(line) || /python/.test(line) && /\.venv|venv/.test(line) ? [] : /python/.test(line) ? ["`python` may be Python 2 or missing on some systems; name python3, or the venv's interpreter."] : [] };
        if (/coding[:=]/.test(line)) return { line, level: "known", note: "An encoding declaration; UTF-8 is already the default in Python 3." };
        if (/#\s*(noqa|type:|pragma|pylint)/.test(line)) return { line, level: "known", note: "A directive for a linter or type checker." };
        return { line, level: "known", note: "A comment: ignored by Python, there for the reader." };
      }
      const stmt = py.stmt(n);
      const note = explainStatement(py, n, t, stmt);
      const warns = risks(py, n, stmt);
      return { line, level: note ? "known" : "unknown", note: note || "A Python statement the X-ray does not have a note for.", warns };
    });
    return { lines: rows, review: review(py), syntax: err ? `${err.msg} (line ${Math.min(err.line, lines.length)})` : null };
  }

  // Essentials that are missing from the script as a whole.
  function review(py) {
    const out = [];
    const t = py.text;
    const defs = /^\s*def\s+\w+/m.test(t);
    const topCalls = py.logical.some((n) => py.ind[n - 1] === 0 && /^[A-Za-z_][\w.]*\s*\(/.test(py.code[n - 1].trim()));
    if (defs && topCalls && !/__name__\s*==\s*["']__main__["']/.test(t)) out.push("No `if __name__ == \"__main__\":` guard: importing the file (from a test, or a process pool) runs it.");
    if (/def\s+main\s*\(/.test(t) && !/sys\.exit\(|raise\s+SystemExit|\bexit\(/.test(t)) out.push("main() exists but nothing passes an exit status to sys.exit(): cron and CI will see success even when it fails.");
    if (/\bsys\.argv\b/.test(t) && !/argparse|click|typer/.test(t)) out.push("Arguments come from sys.argv by hand. argparse adds --help, validation and a usage error for free.");
    if (/\brequests\.\w+\(/.test(t) && !/raise_for_status|status_code|\.ok\b/.test(t)) out.push("HTTP responses are used without checking their status: a 500 page would be treated as data.");
    if (/\bsubprocess\.\w+\(/.test(t) && !/timeout\s*=/.test(t)) out.push("No subprocess call has a timeout: one stuck command stops the whole script.");
    if (/^\s*except\b/m.test(t) && !/logging|log\.|logger\.|print\(|raise\b|sys\.exit/.test(t)) out.push("Errors are caught but never reported anywhere.");
    if (/\bThreadPoolExecutor\(/.test(t) && /\.submit\(/.test(t) && !/\.result\(|as_completed|\.exception\(/.test(t)) out.push("Work is submitted to a pool but no result is read: exceptions in the workers are lost.");
    if (defs && !/^\s*[rRuU]?("""|''')/.test(py.code[py.logical[0] - 1] || "") && !/^\s*[rRuU]?("""|''')/.test(py.code[(py.logical[1] || 1) - 1] || "")) out.push("No module docstring: a line at the top saying what the script is for, and how to run it, helps the next person.");
    return out;
  }

  root.PYXray = { explain };
})(typeof window !== "undefined" ? window : globalThis);
