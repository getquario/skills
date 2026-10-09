// Grades one eval run of the quario-reports skill. Every assertion is a program, not a judgement.
//
//   node evals/grade.mjs <run-dir> <eval-name>
//
// <run-dir> holds `outputs/`, the project the agent worked in. The verdict goes to
// <run-dir>/grading.json in the shape the skill-creator viewer reads.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(new URL("../skills/quario-reports/scripts/check.mjs", import.meta.url));
const { evals } = JSON.parse(readFileSync(new URL("evals.json", import.meta.url), "utf8"));

const [runDir, name] = process.argv.slice(2);
const spec = evals.find((e) => e.name === name);
if (!spec) throw new Error(`unknown eval ${name}`);
const out = join(runDir, "outputs");

/** Files the agent left in the project, newest first, outside node_modules. */
const files = readdirSync(out, { recursive: true })
  .filter((f) => !f.startsWith("node_modules") && statSync(join(out, f)).isFile())
  .sort((a, b) => statSync(join(out, b)).mtimeMs - statSync(join(out, a)).mtimeMs);
const json = (f) => JSON.parse(readFileSync(join(out, f), "utf8"));

const definitionFile = files.find((f) => f.endsWith(".report.json"));
const definition = definitionFile && json(definitionFile);
const sampleFile = files.find((f) => f.endsWith(".sample.json"));
const dataFile = spec.data ?? sampleFile;
const data = dataFile && json(dataFile);
const rendered = files.filter((f) => f.endsWith(`.${spec.target}`));
const source = JSON.stringify(definition ?? {});

const results = [];
const expect = (text, passed, evidence) => results.push({ text, passed: !!passed, evidence });

function checkRun() {
  if (!definitionFile || !dataFile) return undefined;
  const args = [CHECK, definitionFile, dataFile, "--target", spec.target];
  const { stdout, stderr, status } = spawnSync(process.execPath, args, {
    cwd: out,
    encoding: "utf8",
  });
  return { lines: stdout.trim().split("\n").filter(Boolean), stderr, status };
}
const checked = checkRun();
const kind = (prefix) => checked?.lines.filter((l) => l.startsWith(prefix)) ?? [];

/** The figure a correct total must come to, which must never appear typed into the definition. */
function grandTotal() {
  if (name === "invoice-from-timesheet")
    return data.entries.reduce((s, e) => s + e.hours * e.rate, 0);
  if (name === "grouped-xlsx-from-orders")
    return data.orders.reduce((s, o) => s + o.units * o.unitPrice, 0);
  return undefined;
}

expect(
  "saves the definition as a .report.json file",
  definitionFile,
  definitionFile ?? `no .report.json among: ${files.join(", ")}`,
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
expect(
  "computes totals with a sum aggregate",
  /"sum:=/.test(source),
  source.match(/"[^"]*": ?"sum:=[^"]*"/g)?.join(", ") ?? "no sum aggregate",
);
expect(
  `reads only fields the ${spec.data ? "data" : "sample"} holds`,
  checked && kind("missing").length === 0,
  checked ? kind("missing").join(" | ") || "no missing reads" : "no definition or data to compare",
);

const total = data && grandTotal();
if (total !== undefined) {
  const spellings = [total.toFixed(2), total.toLocaleString("en-US", { minimumFractionDigits: 2 })];
  expect(
    "types no figure from the data into the definition",
    definition && !spellings.some((s) => source.includes(s)),
    `grand total ${spellings.join(" / ")} ${spellings.some((s) => source.includes(s)) ? "found" : "absent"} in the definition`,
  );
}

if (name === "invoice-from-timesheet") {
  expect(
    "rounds money arithmetic with round(…, 2)",
    /round\([^)]*,\s*2\s*\)/.test(source),
    source.match(/round\([^}]*/)?.[0] ?? "no round(…, 2)",
  );
  expect(
    "presents money as currency in USD",
    /"format":\s*(\{[^}]*"kind":\s*)?"currency"/.test(source) && /"USD"/.test(source),
    `format currency: ${/"currency"/.test(source)}, USD: ${/"USD"/.test(source)}`,
  );
}

if (name === "statement-template-no-data") {
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
  const stored = data ? JSON.stringify(data).match(/"[^"]*closing[^"]*":/gi) : null;
  expect(
    "computes the closing balance instead of storing it in the sample",
    data && !stored,
    stored ? `sample stores ${stored.join(", ")}` : "no closing-balance field in the sample",
  );
}

if (name === "grouped-xlsx-from-orders") {
  const group = definition?.groups?.find((g) => /region/.test(g.by ?? ""));
  expect(
    "groups by region with a subtotal aggregate",
    group && Object.values(group.aggregates ?? {}).some((a) => a.startsWith("sum:=")),
    group ? JSON.stringify({ by: group.by, aggregates: group.aggregates }) : "no group by region",
  );
  let sheets = "";
  for (const f of rendered) {
    sheets += execFileSync("unzip", ["-p", join(out, f), "xl/worksheets/*.xml"], {
      encoding: "utf8",
    });
  }
  const numbers = [
    ...sheets.matchAll(
      /<c [^>]*?(?<!t="s"|t="inlineStr"|t="str")>(?:<f>[^<]*<\/f>)?<v>([^<]+)<\/v>/g,
    ),
  ].map((m) => +m[1]);
  expect(
    "keeps the grand total a number in the workbook",
    numbers.some((n) => Math.abs(n - total) < 0.005),
    `numeric cells near ${total.toFixed(2)}: ${numbers.filter((n) => Math.abs(n - total) < 1).join(", ") || "none"}`,
  );
  expect(
    "presents amounts with a format kind, not a formatting function",
    /"format":/.test(source) && !/toFixed|money\(|currency\(/.test(source),
    `format declared: ${/"format":/.test(source)}, formatting function: ${/toFixed|money\(|currency\(/.test(source)}`,
  );
}

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
console.log(`${name} ${basename(join(runDir, ".."))}: ${passed}/${results.length}`);
