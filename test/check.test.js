import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check } from "../skills/quario-reports/scripts/check.mjs";

const SCRIPT = fileURLToPath(
  new URL("../skills/quario-reports/scripts/check.mjs", import.meta.url),
);

const definition = {
  data: "$.lines[*]",
  header: [{ type: "text", value: "Bill to {{ $.input.customer }}" }],
  detail: {
    columns: [
      { header: "Item", value: "{{ @.item }}{{#each @.tags as tag}} {{ tag.name }}{{/each}}" },
      { header: "Amount", value: "{{ round(@.qty * @.price, 2) }}" },
    ],
  },
};
const matching = {
  customer: "Sample Ltd",
  lines: [{ item: "Desk", qty: 2, price: 250, tags: [{ name: "office" }] }],
};

test("a definition that matches its data passes", async () => {
  assert.deepEqual(await check(definition, matching), {
    problems: [],
    warnings: [],
    missing: [],
    unread: [],
  });
});

test("a field the definition reads and the data lacks is missing", async () => {
  const data = {
    custmer: "Sample Ltd",
    lines: [{ item: "Desk", qty: 2, unitPrice: 250, tags: [{ nm: "office" }] }],
  };
  const { missing, unread } = await check(definition, data);
  assert.deepEqual(missing, ["$.customer", "$.lines[].price", "$.lines[].tags[].name"]);
  assert.deepEqual(unread, ["$.custmer", "$.lines[].tags[].nm", "$.lines[].unitPrice"]);
});

test("without data it only plans", async () => {
  const broken = { ...definition, sort: [{ by: "=@.qty", dir: "descending" }] };
  const result = await check(broken);
  assert.deepEqual(
    result.problems.map((p) => p.message),
    ['sort[0].dir: unknown sort direction "descending"'],
  );
  assert.equal(result.missing, undefined);
});

test("a render error is a problem, located at its band", async () => {
  const stray = { ...definition, footer: [{ type: "text", value: "{{ @.item }}" }] };
  const { problems } = await check(stray, matching);
  assert.match(problems[0].message, /^footer\[0\]\.value/);
});

test("one document per record reads clean: the engine's own probes are not fields", async () => {
  const letters = {
    data: "$.customers[*]",
    groups: [
      {
        name: "letter",
        by: "=@",
        break: "before",
        header: [{ type: "text", value: "Dear {{ letter.key.name }}" }],
      },
    ],
    detail: [{ type: "text", value: "Balance {{ @.balance }}" }],
  };
  const data = {
    customers: [
      { name: "Ada", balance: 12 },
      { name: "Grace", balance: 7 },
    ],
  };
  assert.deepEqual(await check(letters, data), {
    problems: [],
    warnings: [],
    missing: [],
    unread: [],
  });
});

function run(...args) {
  const dir = mkdtempSync(join(tmpdir(), "quario-check-"));
  const files = args.map((value, i) => {
    if (typeof value === "string") return value;
    const file = join(dir, `${i}.json`);
    writeFileSync(file, JSON.stringify(value));
    return file;
  });
  return spawnSync(process.execPath, [SCRIPT, ...files], { encoding: "utf8" });
}

test("the command exits 0 and says ok on a clean pair", () => {
  const { status, stdout } = run(definition, matching);
  assert.equal(stdout, "ok\n");
  assert.equal(status, 0);
});

test("the command exits 1 and names each missing field", () => {
  const { status, stdout } = run(definition, { ...matching, customer: undefined });
  assert.equal(status, 1);
  assert.match(stdout, /^missing \$\.customer: the definition reads it, the data lacks it$/m);
});

test("the command renders to the target it is given", () => {
  const { status, stderr } = run(definition, matching, "--target", "docx");
  assert.equal(status, 2);
  assert.match(stderr, /npm install @quario\/docx/);
});
