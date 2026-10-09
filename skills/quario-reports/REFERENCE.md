# quario definition reference

The syntax a definition uses, on one page. The normative spec is the
[report schema](https://getquario.com/docs/reference/report-schema/). The JSON Schema in
`quario/schema.json` carries a description on every key.

## Document shape

```jsonc
{
  "$schema": "./node_modules/quario/lib/schema.json", // optional, an editor hint
  "params": { "year": { "type": "number", "default": 2026 } }, // read as $.params.year
  "data": "$.orders[*]", // JSONPath: which array holds the rows
  "where": "=@.amount != 0", // optional row filter
  "sort": [{ "by": "=@.date", "dir": "asc" }], // "asc" or "desc"
  "take": 10, // optional: keep the first N rows
  "aggregates": { "total": "sum:=@.amount" }, // read as $.total
  "run": { "cumulative": "sum:=@.amount" }, // running totals, read as run.cumulative
  "style": { "family": "sans", "size": 10 }, // the report default: family and size only
  "header": [], // items, once at the top
  "groups": [], // nested groups, outermost first
  "detail": {}, // a table, or an item array once per row
  "empty": [], // items that replace the body when no rows remain
  "footer": [], // items, once at the bottom
  "page": { "header": [], "footer": [], "size": "A4", "orientation": "portrait", "margin": 54 },
}
```

Only `data` is required. `page.size` is `"A4"` or `"letter"`. `margin` is points: one number, or
`{ top, right, bottom, left }`.

## The three string syntaxes

| Syntax                   | Where                                       | Is                                       |
| ------------------------ | ------------------------------------------- | ---------------------------------------- |
| `"{{ @.product }}"`      | every cell `value`, image `alt`             | a template: literal text plus values     |
| `"=@.price * @.qty"`     | `where`, `by`, sort `by`, `visible`, styles | an expression                            |
| `"sum:=@.price * @.qty"` | `aggregates`, `run`                         | a reducer, then `:=`, then an expression |

A style value without `=` is a literal: `"color": "#cc0000"`. With `=` it computes per row:
`"color": "=@.amount < 0 ? '#cc0000' : '#000000'"`. Strings inside an expression take single
quotes.

Templates also take blocks: `{{#if @.note}}Note: {{ @.note }}{{#else}}No note{{/if}}` and
`{{#each @.tags as tag, i}}{{ tag }} {{/each}}`. `{{{ }}}` is always an error. Every value is
text, never markup.

## Scope

| Anchor       | Is                                                        | Readable in                        |
| ------------ | --------------------------------------------------------- | ---------------------------------- |
| `@`          | the current row                                           | detail rows and per-row keys only  |
| `$`          | `$.input` (the whole data), `$.params`, report aggregates | everywhere                         |
| `<group>`    | a group's handle: `region.key` plus its aggregates        | that group's bands and inside them |
| `run.<name>` | a running total                                           | detail rows                        |
| `page`       | `page.number`, `page.total`                               | page bands only                    |

A missing field reads as `null`. Test with `== null`, default with `??`, and read through a
possible null with `?.`: `@.address?.city`.

## Reducers and functions

Reducers: `sum`, `count` (no expression), `countDistinct`, `avg`, `min`, `max`, `first`, `last`.
An empty `sum`, `count` or `countDistinct` is `0`. The others are `null`.

Built-in functions: `round(x, n)`, `floor(x, n)`, `ceil(x, n)`, `abs(x)`. `round` halves away
from zero on the decimal you wrote. Inside an expression, a reducer folds a row's own array:
`sum(@.lines, l => l.qty * l.price)`.

The host registers every other function. The MCP server registers none, so
present values with `format` instead of a `money()` or `date()` helper.

## Items

```jsonc
{ "type": "text", "value": "{{ @.name }}", "visible": "=@.name != null", "style": { "bold": true } }
{ "type": "image", "source": "=$.input.logo", "fit": "width" }  // PNG or JPEG bytes from data
{ "type": "split", "slots": [ /* items side by side, each with an optional width */ ] }
```

`visible` hides an item only when it is exactly `false`.

A `value` is one template string, or an array of styled runs:
`[{ "value": "Due " }, { "value": "{{ @.due }}", "style": { "format": "date" } }]`.

## Tables

`detail` as an object is a table. `columns` is required, and each column has `header` and `value`.
`width` is a percentage share. With every column sized, the widths total at most 100. With some
sized, they total under 100.

`detail.header.style` styles the header row. `detail.row` takes `visible` and `style` per data row.
`detail.total` is `{ "rows": [{ "cells": [...] }] }`. The cells of a total row cover every column
once, and a cell's `span` covers more than one. A total row has no `@`. It reads aggregates.

## Groups

```jsonc
{
  "name": "region", // the handle: region.key, region.subtotal
  "by": "=@.region", // rows with the same key form one instance
  "sort": [{ "by": "=@.amount", "dir": "desc" }], // rows within each instance
  "aggregates": { "subtotal": "sum:=@.amount" },
  "break": "before", // paginated targets: "before", "between", "after", "around"
  "header": [],
  "footer": [],
}
```

`"by": "=@"` gives one instance per row: one letter, label or statement per record. Add
`"break": "before"` and `"reset": "page"` to put each on its own pages, numbered from 1.

## Style

The vocabulary is closed. It is not CSS. `family` (`"sans"`, `"serif"`, `"mono"`), `size`
(points), `bold`, `italic`, `underline`, `strikethrough`, `uppercase`, `color` and `background`
(`#rgb` or `#rrggbb`), `align` (`"left"`, `"center"`, `"right"`), `valign` (`"top"`, `"middle"`,
`"bottom"`), `format`, `currency`, `href`, `spaceBefore`, `spaceAfter`, `padding<Side>`, and the
border triple `border<Side>Width`, `border<Side>Style`, `border<Side>Color`. A border side needs
all three.

`format` takes a kind, or an object with modifiers:

| Kind       | Modifiers                                                                  |
| ---------- | -------------------------------------------------------------------------- |
| `number`   | `digits` (0–20), `negative` (`minus`, `parens`), `zero` (`number`, `dash`) |
| `currency` | the same three. The code comes from `currency` on the cell, or the host    |
| `percent`  | the same three. It shows a ratio: `0.125` is `12.50%`                      |
| `date`     | `form`: `short`, `medium` (the default), `long`, `full`                    |

A `date` reads a `YYYY-MM-DD` string or a timestamp with an offset, such as
`2026-03-31T09:00:00Z`.

## A grouped listing

Sales by region, a subtotal per region, and a grand total:

```json definition
{
  "data": "$.orders[*]",
  "sort": [{ "by": "=@.region", "dir": "asc" }],
  "aggregates": { "total": "sum:=@.qty * @.price" },
  "header": [
    {
      "type": "text",
      "value": "Sales, {{ $.input.period }}",
      "style": { "size": 14, "bold": true }
    }
  ],
  "groups": [
    {
      "name": "region",
      "by": "=@.region",
      "aggregates": { "subtotal": "sum:=@.qty * @.price" },
      "header": [
        { "type": "text", "value": "{{ region.key }}", "style": { "bold": true, "spaceBefore": 8 } }
      ],
      "footer": [
        {
          "type": "text",
          "value": [
            { "value": "Subtotal " },
            {
              "value": "{{ round(region.subtotal, 2) }}",
              "style": { "format": "currency", "currency": "EUR" }
            }
          ],
          "style": { "align": "right" }
        }
      ]
    }
  ],
  "detail": {
    "columns": [
      { "header": "Product", "value": "{{ @.product }}" },
      {
        "header": "Qty",
        "value": "{{ @.qty }}",
        "width": 15,
        "style": { "align": "right", "format": { "kind": "number", "digits": 0 } }
      },
      {
        "header": "Amount",
        "value": "{{ round(@.qty * @.price, 2) }}",
        "width": 25,
        "style": { "align": "right", "format": "currency", "currency": "EUR" }
      }
    ]
  },
  "footer": [
    {
      "type": "text",
      "value": [
        { "value": "Total " },
        { "value": "{{ round($.total, 2) }}", "style": { "format": "currency", "currency": "EUR" } }
      ],
      "style": { "align": "right", "bold": true, "spaceBefore": 8 }
    }
  ]
}
```

```json data
{
  "period": "Q1 2026",
  "orders": [
    { "region": "North", "product": "Desk", "qty": 2, "price": 250 },
    { "region": "North", "product": "Chair", "qty": 4, "price": 120 },
    { "region": "South", "product": "Lamp", "qty": 10, "price": 39.9 }
  ]
}
```
