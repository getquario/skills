---
name: quario-reports
description: Produce a report or document (invoice, statement, listing, summary) as PDF, XLSX, DOCX, HTML or CSV by writing a quario report definition. Use when the user asks for a report from data, for a report template before the data exists, or for an app feature that lets a model write reports, when writing or fixing a quario definition, or when the validate_report and render_report tools are available.
---

# quario reports

A quario report is a **definition**: JSON that describes the document. The engine computes every
figure from the data and renders the definition to a target. You write the definition. You never
write the document, and you never type a figure.

Work the **loop**, in order: **declare**, **validate**, **render**. Nothing renders before
validation is clean.

## Pick the route

- **MCP**: the `validate_report` and `render_report` tools are in your tool list. Use them.
  `render_report` writes a file and answers with its path.
- **Code**: you are working in a JavaScript project. Install the engine and one target, then call
  `plan()` and `render()` from a script or from the host's own code.
- **App**: the user wants their own application to let a model write reports, such as "add an AI
  invoice tool to our app". You do not write the report. You build the tool a model calls, and the
  loop below runs inside its handler. Read [APP.md](APP.md) and follow it instead of the steps
  here.

```bash
npm install quario @quario/pdf
```

## 1. Declare

**Find the data, or propose it.** The definition reads one data shape: which array holds the
rows, and which fields sit beside it. Take one of two branches:

- **Data in hand.** Read the file, the API response or the record the user named. Write down its
  shape. Every row, price and total comes from that data.
- **No data yet.** The user wants a **template**, and the host stitches the data in later. Propose
  the shape the report needs. Write it as a **sample file** beside the definition, such as
  `invoice.sample.json` beside `invoice.report.json`. The sample is the contract. It holds every
  field the definition reads, with the type the definition expects. Make each value plainly a
  sample, such as `"Sample Customer Ltd"`. Give every field a value that shows: a non-empty
  string, and a number other than `0`. The MCP check in step 2 relies on this.

**Then write the definition against that shape.** In a definition file, set `$schema` to
`./node_modules/quario/lib/schema.json`. An editor then reads the file against the schema as you
type.

- **Every figure is a formula.** A line amount is `{{ round(@.qty * @.unitPrice, 2) }}`. A total
  is an aggregate, `"total": "sum:=@.qty * @.unitPrice"`, read as `$.total`. A digit you type into
  a text cell is a figure the engine never computed.
- **Round currency arithmetic.** Wrap any sum, product or difference of money in
  `round(…, 2)`. Otherwise a cell can hold `83.75999999999999`.
- **Present with a format kind.** Put `"format": "currency"` on the cell and keep the value a
  number. Then the PDF shows `$1,440.00` and the spreadsheet keeps a real number. Name the
  denomination with `"currency": "USD"` on the same cell when the user names one.
- **One value per formatted run.** `format` applies only where a run renders a single
  `{{ … }}` value. For `Issued March 31, 2026`, split the text and the value into styled runs, as
  the header below does.

Format kinds: `number`, `currency`, `percent`, `date`

**Know which band you are in.** `@` is the current row. Only detail rows and per-row keys (`by`,
`where`, `sort`, aggregates) have one. Every other band reads `$` and group handles. `$` holds the
report aggregates, and `$.input` holds the whole data document.

The definition for "Invoice for Acme, line items for the March work, total in dollars":

```json definition
{
  "data": "$.lines[*]",
  "aggregates": { "total": "sum:=@.qty * @.unitPrice" },
  "style": { "family": "sans", "size": 10 },
  "header": [
    {
      "type": "text",
      "value": "Invoice {{ $.input.number }}",
      "style": { "size": 16, "bold": true, "spaceAfter": 4 }
    },
    { "type": "text", "value": "Bill to {{ $.input.customer }}" },
    {
      "type": "text",
      "value": [
        { "value": "Issued " },
        {
          "value": "{{ $.input.issued }}",
          "style": { "format": { "kind": "date", "form": "long" } }
        }
      ],
      "style": { "spaceAfter": 12 }
    }
  ],
  "detail": {
    "header": { "style": { "bold": true } },
    "columns": [
      { "header": "Item", "value": "{{ @.item }}", "width": 55 },
      {
        "header": { "value": "Qty", "style": { "align": "right" } },
        "value": "{{ @.qty }}",
        "width": 10,
        "style": { "align": "right" }
      },
      {
        "header": { "value": "Unit price", "style": { "align": "right" } },
        "value": "{{ @.unitPrice }}",
        "width": 15,
        "style": { "align": "right", "format": "currency", "currency": "USD" }
      },
      {
        "header": { "value": "Amount", "style": { "align": "right" } },
        "value": "{{ round(@.qty * @.unitPrice, 2) }}",
        "width": 20,
        "style": { "align": "right", "format": "currency", "currency": "USD" }
      }
    ],
    "total": {
      "rows": [
        {
          "style": { "bold": true },
          "cells": [
            { "value": "Total", "span": 3 },
            {
              "value": "{{ round($.total, 2) }}",
              "style": { "align": "right", "format": "currency", "currency": "USD" }
            }
          ]
        }
      ]
    }
  },
  "empty": [{ "type": "text", "value": "No billable work this period." }],
  "page": {
    "footer": [
      {
        "type": "text",
        "value": "Page {{ page.number }} of {{ page.total }}",
        "style": { "size": 8, "align": "right" }
      }
    ]
  }
}
```

It reads this data. With no data yet, the same JSON is its sample file:

```json data
{
  "number": "2026-031",
  "customer": "Acme Corp",
  "issued": "2026-03-31",
  "lines": [
    { "item": "Discovery workshop", "qty": 2, "unitPrice": 720 },
    { "item": "API integration", "qty": 14.5, "unitPrice": 95 },
    { "item": "Hosting, March", "qty": 1, "unitPrice": 49.99 }
  ]
}
```

The step is done when every figure the user asked for is a formula over the data.

For grouped reports, page setup, styled runs, the band defaults PDF and XLSX add, and the full
syntax, read
[REFERENCE.md](REFERENCE.md).

## 2. Validate

Validation reads the definition. It cannot see the data, and a field the data lacks reads as
`null`: a blank, or a `0` under arithmetic. So check the definition against the data too, whether
that is the user's data or your sample.

**Code**: run the check that ships with this skill, from the project directory. `<skill>` is the
folder this file sits in.

```bash
node <skill>/scripts/check.mjs invoice.report.json invoices/acme-2026-03.json --target pdf
```

Leave out the data file to validate the definition alone. `--target` names the target you will
render to, and defaults to `pdf`. The check needs `quario` and that target installed. It prints
`ok`, or one line per finding:

```text
problem sort[0].dir: unknown sort direction "descending"
problem detail.columns[1].style.format: expected number, currency, percent, or date
missing $.lines[].price: the definition reads it, the data lacks it
unread $.lines[].unitPrice: the data holds it, the definition never reads it
```

- **problem**: fix the definition at the path the message names.
- **warning**: fix it too. A warning names a declaration that contributes nothing.
- **missing**: the definition reads a field by the wrong name. Change the definition to the name
  the data uses.
- **unread**: the report never shows that field. Keep it when the user did not ask for it. In a
  sample file, show it or remove it, because the sample is the contract.

Every row field reads as unread when the `data` path matches nothing. Fix the path first.

The step is done when the check prints `ok`, or only `unread` lines you chose to keep.

**MCP**: call `validate_report` with `{ definition, targets: ["pdf"] }`. It answers
`{ problems, warnings }` with the same messages, and you fix both lists the same way. It does not
compare the definition with the data. So call `render_report` with `"target": "html"` and the
data, and read the file it wrote. A blank, a `0` or a `$0.00` that the data does not hold names a
field the definition misreads. The step is done when both lists are empty and every field you
meant to show appears in that file.

## 3. Render

Pick the target from what the user asked for: `pdf` for a document to send, `xlsx` for numbers to
work on, `docx` for a document to edit, `html` for a page, `csv` for records.

**MCP**: call `render_report`. Pass the data inline as `data`, or name a JSON file inside the data
root as `dataPath`. Give exactly one of them.

```json
{
  "definition": { "data": "$.lines[*]", "...": "the validated definition" },
  "target": "pdf",
  "dataPath": "invoices/acme-2026-03.json",
  "filename": "acme-invoice-2026-03"
}
```

The tool answers `Wrote acme-invoice-2026-03.pdf (2.1 kB): /…/acme-invoice-2026-03.pdf`. Tell the
user that path.

**Code**: compile once with `plan()`, then render with the host's data. Every target factory is
named after its package: `pdf()` from `@quario/pdf`, `xlsx()`, `docx()`, `html()` and `csv()`.

```js
import { readFile, writeFile } from "node:fs/promises";
import { quario } from "quario";
import { capabilities, pdf } from "@quario/pdf";

const definition = JSON.parse(await readFile("invoice.report.json", "utf8"));
const data = JSON.parse(await readFile("invoices/acme-2026-03.json", "utf8"));

const q = quario({ license: process.env.QUARIO_LICENSE });
const { report, problems, warnings } = q.plan(definition, undefined, { targets: [capabilities] });
if (!report || warnings.length > 0) throw new Error(JSON.stringify({ problems, warnings }));

await writeFile("acme-invoice-2026-03.pdf", await report.render(pdf(), data));
```

`html()` and `csv()` return a string. `pdf()`, `xlsx()` and `docx()` return a `Uint8Array`.

**No data yet**: render a **preview** from the sample file, then save the template.

1. **Preview.** Render the target the user asked for, with the sample as its data. Put
   `-preview` in the filename, such as `invoice-preview`. Tell the user that its figures come
   from the sample.
2. **Save.** Write the definition as `invoice.report.json` beside `invoice.sample.json`. The host
   renders that definition with real data later. Leave that step to the host.

The render is done when the file exists and you have told the user its path. For a template, the
definition file and its sample file also exist.

## The trust line

A definition is untrusted input, whoever writes it. Tell the user this when they ask whether an
agent-written report is safe:

- **It cannot execute code.** Expressions compile to closures. There is no string-to-code path.
- **It cannot inject markup.** Every target reads the definition's text as text.
- **It cannot reach past the host.** It calls only functions the host registered, under the host's
  query budgets and link schemes.
- **The numbers come from the data.** The definition holds formulas, and the engine evaluates them
  against the data the host supplies. In a preview, the data is the sample file.

A formula can still be wrong: `sum:=@.unitPrice` where you meant `@.qty * @.unitPrice`. Read each
aggregate against what the user asked for before you render.

## Licensing

quario is commercial software. Evaluation is free and has no time limit. A render that no license
key covers carries the unlicensed marking. The marking is expected. It is not an error to fix.

The key comes from the host. Over MCP it is the server's `QUARIO_LICENSE` environment variable. In
code it is `quario({ license })`. Each production deployment needs one key from
https://getquario.com. Development, staging, CI and test need none. The key stays in the host's
configuration, outside the definition.
