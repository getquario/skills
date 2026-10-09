# quario skills

**Agent skills for [quario](https://getquario.com).** A skill teaches a coding agent how to
produce a report with quario. The agent declares a definition, validates it, and then renders it.

| Skill                                              | Teaches                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`quario-reports`](skills/quario-reports/SKILL.md) | The loop: declare a definition, validate it, render it to PDF, XLSX, DOCX, HTML or CSV |

## Install

Install with the [skills](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add getquario/skills
```

The CLI asks which agents to install for. To install the one skill for Claude Code, without
prompts:

```bash
npx skills add getquario/skills --skill quario-reports -a claude-code -y
```

To install by hand, copy `skills/quario-reports` into your agent's skills directory. For Claude
Code, that directory is `.claude/skills/` in your project.

## What the agent needs

The skill works over two routes. The agent picks the route from what it finds:

- **MCP.** Add the [`@quario/mcp`](https://github.com/getquario/mcp) server. The agent then calls
  `validate_report` and `render_report`.
- **Code.** The agent works in a JavaScript project. It installs `quario` and a target, such as
  `@quario/pdf`, and calls `plan()` and `render()`.

## License

The skills in this repository are Apache-2.0. See [LICENSE](LICENSE).

The skills drive `quario` and the `@quario/*` render targets. Those packages are commercial
software under the [Quario License](https://getquario.com). Evaluation is free and has no time
limit. A render that no license key covers carries the unlicensed marking. Each production deployment
needs one license key. The key goes in the host's configuration: `QUARIO_LICENSE` for the MCP
server, or `quario({ license })` in code.

## Development

```bash
npm install
npm test
```

The test reads every definition that a skill tags as ` ```json definition `. It plans each one
against the published engine. A problem or a warning fails the test. When a ` ```json data `
block follows the definition, the test also renders the definition to PDF with that data. Run it
after any edit to a skill, and again after an engine release.
