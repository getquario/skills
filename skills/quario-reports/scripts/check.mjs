#!/usr/bin/env node
// Validates a quario report definition against a target, and with data, checks the two against
// each other.
//
//   node check.mjs <definition.json> [data.json] [--target pdf|xlsx|docx|html|csv]
//
// Validation cannot see the data, and the engine reads a missing field as null: a blank, or
// a 0 under arithmetic. So this renders the definition against the data through a proxy that
// records every field the render reads. A read the data cannot answer is `missing`. A data
// field no read reaches is `unread`, which is advice rather than a fault.
//
// quario and the target resolve from the project in the working directory, not from here.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const projectRequire = createRequire(join(process.cwd(), "package.json"));

class MissingPackage extends Error {}

async function load(name) {
  let path;
  try {
    path = projectRequire.resolve(name);
  } catch {
    throw new MissingPackage(`${name} is not installed here. Run: npm install ${name}`);
  }
  return import(pathToFileURL(path).href);
}

/** Wraps `value` so every property read lands in `reads`, and each unanswered one in `missing`. */
function watch(value, path, reads, missing) {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  const array = Array.isArray(value);
  return new Proxy(value, {
    get(target, key, receiver) {
      const result = Reflect.get(target, key, receiver);
      if (typeof key === "symbol" || (array && !/^\d+$/.test(key))) return result;
      const child = array ? `${path}[]` : `${path}.${key}`;
      if (!(key in target)) missing.add(child);
      else reads.add(child);
      return watch(result, child, reads, missing);
    },
  });
}

/** Every leaf path in `value`, with array indices collapsed to `[]`. */
function leaves(value, path, into) {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) {
    into.add(path);
  } else if (Array.isArray(value)) {
    for (const item of value) leaves(item, `${path}[]`, into);
  } else {
    for (const [key, item] of Object.entries(value)) leaves(item, `${path}.${key}`, into);
  }
  return into;
}

const located = (error) => ({
  path: error.message.match(/^(\S+?)(?: \[|:)/)?.[1] ?? "",
  message: error.message,
});

/**
 * Plans `definition`. Given `data`, also renders it to `target` and compares the fields the
 * render read with the fields the data holds.
 */
export async function check(definition, data, { target = "pdf" } = {}) {
  const { quario } = await load("quario");
  const q = quario();
  const { [target]: factory, capabilities } = await load(`@quario/${target}`);
  const { report, problems, warnings } = q.plan(definition, undefined, { targets: [capabilities] });
  const result = {
    problems: problems.map(({ path, message }) => ({ path, message })),
    warnings: warnings.map(({ path, message }) => ({ path, message })),
  };
  if (data === undefined) return result;

  const reads = new Set();
  const missing = new Set();
  if (report) {
    try {
      await report.render(factory(), watch(data, "$", reads, missing));
    } catch (error) {
      if (error instanceof MissingPackage) throw error;
      result.problems.push(located(error));
    }
  }
  result.missing = [...missing].sort();
  result.unread = [...leaves(data, "$", new Set())].filter((leaf) => !reads.has(leaf)).sort();
  return result;
}

const lines = ({ problems, warnings, missing = [], unread = [] }) => [
  ...problems.map((p) => `problem ${p.message}`),
  ...warnings.map((w) => `warning ${w.message}`),
  ...missing.map((path) => `missing ${path}: the definition reads it, the data lacks it`),
  ...unread.map((path) => `unread ${path}: the data holds it, the definition never reads it`),
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--target");
  const target = at === -1 ? undefined : args.splice(at, 2)[1];
  const [definitionFile, dataFile] = args;
  if (!definitionFile) {
    console.error("usage: node check.mjs <definition.json> [data.json] [--target pdf]");
    process.exit(2);
  }
  const read = (file) => JSON.parse(readFileSync(file, "utf8"));
  try {
    const result = await check(read(definitionFile), dataFile && read(dataFile), { target });
    const out = lines(result);
    console.log(out.length ? out.join("\n") : "ok");
    const failed = result.problems.length + result.warnings.length + (result.missing?.length ?? 0);
    process.exit(failed ? 1 : 0);
  } catch (error) {
    if (!(error instanceof MissingPackage)) throw error;
    console.error(error.message);
    process.exit(2);
  }
}
