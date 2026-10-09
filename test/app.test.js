import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import schema from "quario/schema.json" with { type: "json" };

// APP.md's two snippets, run as written: the tool definition and the handler.
const page = readFileSync(new URL("../skills/quario-reports/APP.md", import.meta.url), "utf8");
const [tool, handler] = [...page.matchAll(/^```js\n([\s\S]*?)^```$/gm)].map((m) => m[1]);

const skill = readFileSync(new URL("../skills/quario-reports/SKILL.md", import.meta.url), "utf8");
const [definition, invoice] = [
  ...skill.matchAll(/^```json (?:definition|data)\n([\s\S]*?)^```$/gm),
].map((m) => JSON.parse(m[1]));

// Inside the repo, so the snippets' bare imports resolve to its node_modules.
const dir = mkdtempSync(fileURLToPath(new URL("./app-", import.meta.url)));
after(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, "out"));
writeFileSync(join(dir, "tool.js"), tool);
writeFileSync(join(dir, "handler.js"), handler);
writeFileSync(
  join(dir, "db.js"),
  `export const getInvoice = async () => (${JSON.stringify(invoice)});\n`,
);

const cwd = process.cwd();
after(() => process.chdir(cwd));

test("the tool takes the report schema unchanged as its input schema", async () => {
  const { draftInvoice } = await import(join(dir, "tool.js"));
  assert.equal(draftInvoice.input_schema, schema);
});

test("the tool's description names every field the skill's invoice reads", async () => {
  const { draftInvoice } = await import(join(dir, "tool.js"));
  for (const field of ["number", "customer", "issued", "lines", "item", "qty", "unitPrice"]) {
    assert.match(draftInvoice.description, new RegExp(`\\b${field}\\b`));
  }
});

test("the handler returns a faulty definition's problems and writes nothing", async () => {
  process.chdir(dir);
  const { handleDraftInvoice } = await import(join(dir, "handler.js"));
  const faulty = { ...definition, sort: [{ by: "=@.qty", dir: "descending" }] };
  const result = await handleDraftInvoice(faulty, "2026-031");
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.problems.map((p) => p.path),
    ["sort[0].dir"],
  );
  assert.equal(existsSync(join(dir, "out/invoice-2026-031.pdf")), false);
});

test("the handler answers anything a model sends with problems, never a throw", async () => {
  process.chdir(dir);
  const { handleDraftInvoice } = await import(join(dir, "handler.js"));
  for (const input of [null, "an invoice please", [], {}]) {
    assert.equal((await handleDraftInvoice(input, "2026-031")).ok, false);
  }
});

test("the handler renders a clean definition with the application's data", async () => {
  process.chdir(dir);
  const { handleDraftInvoice } = await import(join(dir, "handler.js"));
  assert.deepEqual(await handleDraftInvoice(definition, "2026-031"), {
    ok: true,
    path: "out/invoice-2026-031.pdf",
  });
  assert.equal(readFileSync(join(dir, "out/invoice-2026-031.pdf"), "latin1").slice(0, 5), "%PDF-");
});
