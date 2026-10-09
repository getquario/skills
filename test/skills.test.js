import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { pdf, capabilities } from "@quario/pdf";
import { quario } from "quario";
import schema from "quario/schema.json" with { type: "json" };

const root = new URL("../skills/", import.meta.url);
const SKILL = "quario-reports/SKILL.md";

const pages = readdirSync(root, { recursive: true })
  .filter((path) => path.endsWith(".md"))
  .map((path) => [path, readFileSync(new URL(path, root), "utf8")]);

/**
 * The fenced blocks a page tags with a role: ```json definition, ```json data.
 * A data block belongs to the definition it follows.
 */
function examples(text) {
  const found = [];
  for (const [, role, body] of text.matchAll(/^```json (definition|data)\n([\s\S]*?)^```$/gm)) {
    if (role === "definition") found.push({ definition: JSON.parse(body) });
    else found.at(-1).data = JSON.parse(body);
  }
  return found;
}

test("the quario-reports skill exists and names itself", () => {
  const skill = pages.find(([path]) => path === SKILL);
  assert.ok(skill, SKILL);
  assert.match(skill[1], /^---\nname: quario-reports\ndescription: .+\n/);
});

test("every SKILL.md shows at least one tagged definition", () => {
  for (const [path, text] of pages) {
    if (path.endsWith("SKILL.md")) assert.ok(examples(text).length > 0, path);
  }
});

for (const [path, text] of pages) {
  for (const [i, { definition, data }] of examples(text).entries()) {
    test(`${path} definition ${i + 1} plans clean and renders to PDF`, async () => {
      const { report, problems, warnings } = quario().plan(definition, undefined, {
        targets: [capabilities],
      });
      assert.deepEqual(problems, []);
      assert.deepEqual(warnings, []);
      if (data === undefined) return;
      const bytes = await report.render(pdf(), data);
      assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
    });
  }
}

/** Leaves a preview would show as blank or zero, by JSONPath. */
function hidden(value, path = "$") {
  if (Array.isArray(value)) return value.flatMap((v, i) => hidden(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => hidden(v, `${path}.${k}`));
  }
  return value === "" || value === 0 || value == null ? [path] : [];
}

for (const [path, text] of pages) {
  for (const [i, { data }] of examples(text).entries()) {
    if (data === undefined) continue;
    test(`${path} data ${i + 1} gives every field a value that shows`, () => {
      assert.deepEqual(hidden(data), []);
    });
  }
}

test("the format kinds the skill names are the schema's", () => {
  const kinds = schema.$defs.FormatKind.enum;
  const [, skill] = pages.find(([path]) => path === SKILL);
  const line = skill.match(/^Format kinds: (.+)$/m);
  assert.ok(line, "SKILL.md states a `Format kinds:` line");
  assert.deepEqual(
    [...line[1].matchAll(/`(\w+)`/g)].map((m) => m[1]),
    kinds,
  );
});
