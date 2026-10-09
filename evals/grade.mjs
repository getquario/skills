// Grades one eval run of the quario-reports skill. Every assertion is a program, not a judgement,
// and each eval's entry in evals.json says which of them apply.
//
//   node evals/grade.mjs <run-dir> <eval-name>
//
// <run-dir> holds `outputs/`, the project the agent worked in. The verdict goes to
// <run-dir>/grading.json in the shape the skill-creator viewer reads.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHECK = fileURLToPath(new URL("../skills/quario-reports/scripts/check.mjs", import.meta.url));
const { evals } = JSON.parse(readFileSync(new URL("evals.json", import.meta.url), "utf8"));

const [run, name] = process.argv.slice(2);
const runDir = resolve(run);
const spec = evals.find((e) => e.name === name);
if (!spec) throw new Error(`unknown eval ${name}`);
const out = join(runDir, "outputs");
const results = [];
const expect = (text, passed, evidence) => results.push({ text, passed: !!passed, evidence });

/** Writes the verdict in the shape the skill-creator viewer reads. */
function verdict() {
  const passed = results.filter((r) => r.passed).length;
  writeFileSync(
    join(runDir, "grading.json"),
    JSON.stringify(
      {
        expectations: results,
        summary: {
          passed,
          failed: results.length - passed,
          total: results.length,
          pass_rate: +(passed / results.length).toFixed(2),
        },
      },
      null,
      2,
    ),
  );
  console.log(
    `${name} ${basename(join(runDir, "..", ".."))}/${basename(join(runDir, ".."))}: ${passed}/${results.length}`,
  );
}

/** The app checks after the first, so a missing module still fails each of them. */
const APP_EXPECTATIONS = [
  "uses quario/schema.json unchanged as the tool's input schema",
  "keeps the choice of record out of the model's input",
  "names the invoice's fields in the tool description",
  "answers a faulty definition with its problem, not a render",
  "answers malformed model input without throwing",
  "renders a clean definition to a PDF in out/",
  "renders with the application's data: the PDF shows the correct total",
  "adds a passing test for the handler",
];

if (spec.app) {
  await gradeApp();
  verdict();
  process.exit(0);
}

/** An app eval: the agent built a tool and its handler. Call them the way the app would. */
async function gradeApp() {
  const module = join(out, "src/invoice-tool.js");
  let tool;
  let handle;
  try {
    ({ draftInvoice: tool, handleDraftInvoice: handle } = await import(pathToFileURL(module).href));
  } catch (error) {
    expect(
      "exports draftInvoice and handleDraftInvoice from src/invoice-tool.js",
      false,
      error.message,
    );
    for (const text of APP_EXPECTATIONS) expect(text, false, "no module to call");
    return;
  }
  expect(
    "exports draftInvoice and handleDraftInvoice from src/invoice-tool.js",
    tool && typeof handle === "function",
    `tool: ${!!tool}, handler: ${typeof handle}`,
  );

  const projectSchema = JSON.parse(
    readFileSync(join(out, "node_modules/quario/lib/schema.json"), "utf8"),
  );
  const inputSchema = tool?.input_schema ?? tool?.parameters ?? tool?.inputSchema;
  expect(
    "uses quario/schema.json unchanged as the tool's input schema",
    inputSchema && JSON.stringify(inputSchema) === JSON.stringify(projectSchema),
    inputSchema
      ? `${Object.keys(inputSchema).length} top-level keys, ${JSON.stringify(inputSchema).length} chars`
      : "no input schema",
  );
  const chosen = Object.keys(inputSchema?.properties ?? {}).filter((k) =>
    /invoice|record|id$/i.test(k),
  );
  expect(
    "keeps the choice of record out of the model's input",
    inputSchema && chosen.length === 0,
    chosen.length ? `the model supplies ${chosen.join(", ")}` : "the application picks the record",
  );
  const named = spec.fields.filter((f) => new RegExp(`\\b${f}\\b`).test(tool?.description ?? ""));
  expect(
    "names the invoice's fields in the tool description",
    named.length === spec.fields.length,
    `names ${named.length}/${spec.fields.length}: missing ${spec.fields.filter((f) => !named.includes(f)).join(", ") || "none"}`,
  );

  process.chdir(out);
  const pdfs = () =>
    statSync("out", { throwIfNoEntry: false })
      ? readdirSync("out").filter((f) => f.endsWith(".pdf"))
      : [];
  const valid = JSON.parse(readFileSync(new URL(`../${spec.valid}`, import.meta.url), "utf8"));
  const call = async (definition) => {
    try {
      return { result: await handle(definition, spec.invoiceId) };
    } catch (error) {
      return { error };
    }
  };

  const before = pdfs().length;
  const faulty = await call({ ...valid, sort: [{ by: "=@.hours", dir: "descending" }] });
  const told = JSON.stringify(faulty.result ?? faulty.error?.message ?? "");
  expect(
    "answers a faulty definition with its problem, not a render",
    told.includes("sort[0].dir") && pdfs().length === before,
    `${faulty.error ? "threw: " : "returned: "}${told.slice(0, 160)}; new pdfs: ${pdfs().length - before}`,
  );

  const junk = [];
  for (const input of [null, "make me an invoice", {}]) {
    const { error } = await call(input);
    if (error) junk.push(`${JSON.stringify(input)} threw ${error.message}`);
  }
  expect(
    "answers malformed model input without throwing",
    junk.length === 0,
    junk.join(" | ") || "no throws",
  );

  const clean = await call(valid);
  const made = pdfs();
  const text = made
    .map((f) => execFileSync("pdftotext", ["-layout", join("out", f), "-"], { encoding: "utf8" }))
    .join("\n");
  const shown = spec.total.toLocaleString("en-US", { minimumFractionDigits: 2 });
  expect(
    "renders a clean definition to a PDF in out/",
    !clean.error && made.length > 0,
    clean.error
      ? `threw: ${clean.error.message}`
      : `returned ${JSON.stringify(clean.result).slice(0, 120)}; pdfs: ${made.join(", ")}`,
  );
  expect(
    "renders with the application's data: the PDF shows the correct total",
    text.includes(shown),
    text.includes(shown) ? `shows ${shown}` : `${shown} absent`,
  );

  const tests = readdirSync(out, { recursive: true }).filter(
    (f) => !f.startsWith("node_modules") && /\.test\.m?js$/.test(f),
  );
  const run = tests.length
    ? spawnSync(process.execPath, ["--test", ...tests], { cwd: out, encoding: "utf8" })
    : undefined;
  expect(
    "adds a passing test for the handler",
    run?.status === 0,
    tests.length ? `${tests.join(", ")}: exit ${run.status}` : "no *.test.js file",
  );
}

/** Files the agent left in the project, newest first, outside node_modules. */
const files = readdirSync(out, { recursive: true })
  .filter((f) => !f.startsWith("node_modules") && statSync(join(out, f)).isFile())
  .sort((a, b) => statSync(join(out, b)).mtimeMs - statSync(join(out, a)).mtimeMs);
const json = (f) => JSON.parse(readFileSync(join(out, f), "utf8"));

// Found by content, not by name: a baseline agent has no naming convention to follow.
const jsons = files.filter(
  (f) => f.endsWith(".json") && basename(f) !== "package.json" && f !== spec.data,
);
const isDefinition = (f) => {
  try {
    const value = json(f);
    return (
      typeof value.data === "string" &&
      value.data.startsWith("$") &&
      ("detail" in value || "groups" in value)
    );
  } catch {
    return false;
  }
};
const definitionFile = jsons.find((f) => f.endsWith(".report.json")) ?? jsons.find(isDefinition);
const definition = definitionFile && json(definitionFile);
const sampleFile =
  jsons.find((f) => f.endsWith(".sample.json")) ??
  jsons.find((f) => f !== definitionFile && !isDefinition(f));
const dataFile = spec.data ?? sampleFile;
const data = dataFile && json(dataFile);
const rendered = files.filter((f) => f.endsWith(`.${spec.target}`));
const source = JSON.stringify(definition ?? {});
const source_ = spec.data ? "data" : "sample";

function checkRun() {
  if (!definitionFile || !dataFile) return undefined;
  const args = [CHECK, definitionFile, dataFile, "--target", spec.target];
  const { stdout, stderr } = spawnSync(process.execPath, args, { cwd: out, encoding: "utf8" });
  return { lines: stdout.trim().split("\n").filter(Boolean), stderr: stderr.trim() };
}
const checked = checkRun();
const kind = (prefix) => checked?.lines.filter((l) => l.startsWith(prefix)) ?? [];

/** Every key path in a JSON value, at any depth, such as `employees.ytdBefore.gross`. */
const keys = (v, p = "") =>
  Array.isArray(v)
    ? v.flatMap((x) => keys(x, p))
    : v && typeof v === "object"
      ? Object.entries(v).flatMap(([k, x]) => [p + k, ...keys(x, `${p}${k}.`)])
      : [];

// What every eval asks.

expect(
  "saves the definition as a JSON file",
  definitionFile,
  definitionFile ?? `no definition among: ${files.join(", ")}`,
);
expect(
  `the definition plans with no problems or warnings for ${spec.target}`,
  checked && kind("problem").length + kind("warning").length === 0 && !checked.stderr,
  checked
    ? [...kind("problem"), ...kind("warning"), checked.stderr].filter(Boolean).join(" | ") ||
        "clean"
    : "nothing to plan",
);
expect(
  `renders the requested ${spec.target} file`,
  rendered.length > 0,
  rendered.join(", ") || `no .${spec.target} file`,
);
if (spec.aggregate !== false)
  expect(
    "computes totals with a sum aggregate",
    /"sum:=/.test(source),
    source.match(/"[^"]*": ?"sum:=[^"]*"/g)?.join(", ") ?? "no sum aggregate",
  );
expect(
  `reads only fields the ${source_} holds`,
  checked && kind("missing").length === 0,
  checked
    ? kind("missing").join(" | ") || "no missing reads"
    : `no definition or ${source_} to compare`,
);

// A known total: never typed in, and shown correctly.

if (spec.total !== undefined) {
  const spellings = [
    spec.total.toFixed(2),
    spec.total.toLocaleString("en-US", { minimumFractionDigits: 2 }),
  ];
  const typed = spellings.filter((s) => source.includes(s));
  expect(
    "types no figure from the data into the definition",
    definition && typed.length === 0,
    typed.length ? `found ${typed.join(", ")}` : "no total typed in",
  );

  let shown = false;
  let evidence = "nothing rendered";
  for (const f of rendered) {
    if (spec.target === "pdf") {
      const text = execFileSync("pdftotext", ["-layout", join(out, f), "-"], { encoding: "utf8" });
      shown ||= text.includes(spellings[1]);
      evidence = shown ? `${f} shows ${spellings[1]}` : `${f} never shows ${spellings[1]}`;
    } else {
      const sheets = execFileSync("unzip", ["-p", join(out, f), "xl/worksheets/*.xml"], {
        encoding: "utf8",
      });
      const numbers = [
        ...sheets.matchAll(
          /<c [^>]*?(?<!t="s"|t="inlineStr"|t="str")>(?:<f>[^<]*<\/f>)?<v>([^<]+)<\/v>/g,
        ),
      ].map((m) => +m[1]);
      shown ||= numbers.some((n) => Math.abs(n - spec.total) < 0.005);
      evidence = shown
        ? `${f} holds ${spellings[0]} as a number`
        : `${f} holds no number near ${spellings[0]}`;
    }
  }
  expect(`the output shows the correct total, ${spellings[1]}`, shown, evidence);
}

if (spec.rounds) {
  expect(
    "rounds money arithmetic with round(…, 2)",
    /round\([^)]*,\s*2\s*\)/.test(source),
    source.match(/round\([^}]*/)?.[0] ?? "no round(…, 2)",
  );
}

if (spec.currency) {
  const money = /"format":\s*(\{[^}]*"kind":\s*)?"currency"/.test(source);
  const code = source.includes(`"${spec.currency}"`);
  expect(
    `presents money as currency in ${spec.currency}`,
    money && code,
    `format currency: ${money}, ${spec.currency}: ${code}`,
  );
}

// A template: the sample is its contract.

if (spec.template) {
  expect(
    "saves a sample data file as the template's contract",
    sampleFile,
    sampleFile ?? "no .sample.json",
  );
  const hidden = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    else if (v === "" || v === 0 || v == null) hidden.push(p);
  };
  if (data) walk(data, "$");
  expect(
    "gives every sample field a value that shows",
    data && hidden.length === 0,
    hidden.join(", ") || "every value shows",
  );
  expect(
    "names the preview file as a preview",
    rendered.some((f) => /preview/i.test(basename(f))),
    rendered.join(", ") || "no pdf",
  );
  const { label, pattern, except } = spec.computed;
  const stored = data
    ? keys(data).filter(
        (k) =>
          new RegExp(pattern, "i").test(k.split(".").at(-1)) &&
          !(except && new RegExp(except, "i").test(k)),
      )
    : [];
  expect(
    `computes ${label} instead of storing it in the sample`,
    data && stored.length === 0,
    stored.length ? `sample stores ${stored.join(", ")}` : "computed",
  );
}

// A grouped workbook.

if (spec.group) {
  const group = definition?.groups?.find((g) => new RegExp(spec.group).test(g.by ?? ""));
  expect(
    `groups by ${spec.group} with a subtotal aggregate`,
    group && Object.values(group.aggregates ?? {}).some((a) => a.startsWith("sum:=")),
    group
      ? JSON.stringify({ by: group.by, aggregates: group.aggregates })
      : `no group by ${spec.group}`,
  );
  expect(
    "presents amounts with a format kind, not a formatting function",
    /"format":/.test(source) && !/toFixed|money\(|currency\(/.test(source),
    `format declared: ${/"format":/.test(source)}, formatting function: ${/toFixed|money\(|currency\(/.test(source)}`,
  );
}

verdict();
