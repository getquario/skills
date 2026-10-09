# quario skills

**Teach your coding agent to make reports with [quario](https://getquario.com).** Ask for an
invoice, a statement or a sales summary, and the agent writes a JSON report definition instead of
HTML or PDF code. quario checks that definition before anything renders. It then computes every
figure from your data and writes the PDF, workbook, Word file, page or CSV.

- **Validated before render.** The agent fixes each problem at the path the engine names. It
  renders only after validation comes back clean.
- **Numbers from your data.** The agent writes formulas such as `sum:=@.qty * @.unitPrice`, and
  quario evaluates them. The agent never types a total.
- **Two routes.** With the [`@quario/mcp`](https://github.com/getquario/mcp) server, the agent calls
  `validate_report` and `render_report`. In a JavaScript project, it calls `plan()` and a render
  target.
- **Tested against the engine.** `npm test` plans every definition in the skill against the
  published `quario` package and renders each one to PDF.
- **Small.** `SKILL.md` is about 1,400 words. The agent opens the 1,200-word syntax reference only
  when a report needs it.

An agent with the skill and the MCP server, asked for "the March invoice for Acme, total in
dollars". Its first draft has two problems:

```text
validate_report  { definition, targets: ["pdf"] }
→ detail.columns[3].value [{{ round(@.qty * @.unitPrice, 2 }}]: Unexpected end of expression
→ detail.columns[3].style.format: expected number, currency, percent, or date
validate_report  { definition, targets: ["pdf"] }   fixed
→ { "problems": [], "warnings": [] }
render_report  { definition, target: "pdf", dataPath: "invoices/acme-2026-03.json" }
→ Wrote acme-invoice-2026-03.pdf (1.7 kB): /tmp/quario-mcp/acme-invoice-2026-03.pdf
```

## Contents

- [Getting started](#getting-started)
- [Skills](#skills)
- [License](#license)
- [Development](#development)

---

## Getting started

**1. Install the skill.** The [skills](https://github.com/vercel-labs/skills) CLI copies it into
your agent's skills directory:

```bash
npx skills add getquario/skills --skill quario-reports
```

The CLI asks which agents to install for. For Claude Code without prompts, add `-a claude-code -y`.
To install by hand, copy `skills/quario-reports` into `.claude/skills/` in your project.

**2. Give the agent a route to the engine.** Pick one.

For an agent client such as Claude Code, add the MCP server. It needs Node 22 or later:

```bash
claude mcp add quario -- npx -y @quario/mcp
```

For a JavaScript project, install the engine and a target:

```bash
npm install quario @quario/pdf
```

**3. Ask for a report.** Name the data and the format:

> Make the March invoice for Acme from `invoices/acme-2026-03.json` as a PDF, total in dollars.

The agent answers with the path of the file it wrote. Under Claude Code, the MCP server reads
`dataPath` files from your project directory. Other clients set `QUARIO_DATA_ROOT`.

No data yet? Ask for a template instead:

> Make an invoice template for Acme as a PDF, totals in dollars.

The agent proposes the data shape and writes it as a sample file, such as `invoice.sample.json`.
It renders a preview from that sample, then saves the definition as `invoice.report.json`. Your
code renders that definition with real data later.

---

## Skills

| Skill                                              | Teaches                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`quario-reports`](skills/quario-reports/SKILL.md) | Declare a definition, validate it, render it to PDF, XLSX, DOCX, HTML or CSV |

---

## License

The skills in this repository are Apache-2.0. See [LICENSE](LICENSE).

**The engine they drive is commercial.** `quario` and the `@quario/*` render targets are under the
[Quario License](https://getquario.com). Evaluation is free and has no time limit. A render that no
license key covers carries the unlicensed marking. Each production deployment needs one license
key. The key goes in the host's configuration: `QUARIO_LICENSE` for the MCP server, or
`quario({ license })` in code.

---

## Development

```bash
npm install
npm test
```

The test reads every definition that a skill tags as ` ```json definition `. It plans each one
against the published engine. A problem or a warning fails the test. When a ` ```json data `
block follows the definition, the test also renders the definition to PDF with that data. Run it
after any edit to a skill, and again after an engine release.
