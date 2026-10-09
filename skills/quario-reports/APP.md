# A report tool inside the user's app

The user's application lets a model write reports. You build two things: the **tool** the model
calls, and the **handler** that runs when it calls it. The model writes a definition. The handler
validates it, and on a clean result renders it with data the application fetched itself.

The split is the product's trust line. The model writes formulas, and the application owns the
data, the license key and the output. So the tool takes one argument, the definition, and never
the data.

## 1. Describe the tool

`quario/schema.json` is the JSON Schema of a definition, with a description on every key. Use it
as the tool's input schema, unchanged:

```js
import schema from "quario/schema.json" with { type: "json" };

export const draftInvoice = {
  name: "draft_invoice",
  description:
    "Write a quario report definition for an invoice. It renders against " +
    "{ number, customer, issued, lines: [{ item, qty, unitPrice }] }. " +
    "Every figure is a formula over that data.",
  input_schema: schema,
};
```

- **The description states the data shape.** The model never sees the data, so the description is
  where it learns the field names. Read the shape from the application's own code: the query, the
  type, or the function that fetches the record. Name every field the report may use.
- **The field name belongs to the SDK.** The Anthropic Messages API calls it `input_schema`.
  OpenAI calls it `parameters`. The Vercel AI SDK wraps it as `inputSchema: jsonSchema(schema)`.
- **Use the ordinary mode, not a strict one.** OpenAI's strict mode requires every key, and a
  report leaves most of them out. Anthropic's strict mode limits optional keys, and the report
  schema has far more. Both refuse the schema.

## 2. Write the handler

The handler runs the loop from SKILL.md on the model's behalf. A definition with problems goes
back to the model as the tool result, and the model fixes it and calls again. Only a clean
definition renders.

```js
import { writeFile } from "node:fs/promises";
import { quario } from "quario";
import { capabilities, pdf } from "@quario/pdf";
import { getInvoice } from "./db.js";

const q = quario({ license: process.env.QUARIO_LICENSE, currency: "USD" });

export async function handleDraftInvoice(definition, invoiceId) {
  const { report, problems, warnings } = q.plan(definition, undefined, { targets: [capabilities] });
  if (!report || warnings.length > 0) return { ok: false, problems, warnings };

  const invoice = await getInvoice(invoiceId);
  const path = `out/invoice-${invoice.number}.pdf`;
  await writeFile(path, await report.render(pdf(), invoice));
  return { ok: true, path };
}
```

- **The model's input goes to `plan()` as it arrives.** `plan()` never throws. A string, `null` or
  a malformed object comes back as problems, each with a `path` and a `message` the model can act
  on.
- **Warnings go back too.** A warning names a declaration that contributes nothing. The model
  meant something by it.
- **The data comes from the application.** The handler fetches the record. Which record is the
  application's decision: a route parameter, the signed-in user, the conversation. It never comes
  from a model-written field.
- **Host settings stay in the handler.** The license key, `locale`, `currency`, `timeZone`, query
  budgets and registered functions belong to `quario({ … })` and `report(definition, functions)`.
  Keep them out of the tool's input.
- **The result is small.** Return a path or an id, never the file's bytes. The model reads every
  byte of a tool result.

Wire the tool into the application's existing model call, with its own SDK and agent loop. A loop
that feeds each tool result back to the model until `ok` is true is all the retry the handler
needs.

## 3. Prove the handler

Write a test beside the application's other tests, in its own test runner. It calls the handler
directly, with no model involved:

- A definition with a fault, such as `"dir": "descending"` in a sort, returns `ok: false`, with
  a problem at `sort[0].dir`. It writes no file.
- A valid definition over the application's real data shape returns `ok: true`, and the file it
  names exists.

Take the valid definition from the loop in SKILL.md: declare it against the record the handler
fetches, and check it with `scripts/check.mjs` against a sample of that record.

The step is done when both tests pass. Tell the user which files you added, and that the model
call itself is theirs to wire.
