import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import katex from "katex";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const warnings = [];
const counts = { topics: 0, problems: 0, examples: 0, formulas: 0, scientists: 0 };
function check(condition, message) { if (!condition) failures.push(message); }
function dataModule(relative) {
  const source = readFileSync(join(root, relative), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  new Function("exports", "require", outputText)(exports, (id) => { throw new Error(`Unexpected runtime import in data module: ${id}`); });
  return exports;
}
function formula(math, location) {
  counts.formulas++;
  try { katex.renderToString(math, { throwOnError: true, strict: "ignore" }); }
  catch (error) { failures.push(`${location}: ${error.message}`); }
}
function textMath(value, location) {
  if (typeof value === "string") {
    check(!value.includes("\ufffd"), `${location}: replacement character`);
    check((value.match(/\$/g)?.length ?? 0) % 2 === 0, `${location}: unbalanced inline math delimiters`);
    for (const match of value.matchAll(/\$([^$]+)\$/g)) formula(match[1], location);
  } else if (Array.isArray(value)) value.forEach((item, i) => textMath(item, `${location}[${i}]`));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) textMath(item, `${location}.${key}`);
}
const { sections } = dataModule("src/data/sections.ts");
const { scientists } = dataModule("src/data/scientists.ts");
const { contentIndex } = dataModule("src/data/contentIndex.ts");
const { REAL_TOPIC_SLUGS } = dataModule("src/topics/manifest.ts");
const allRefs = sections.flatMap(section => section.topics.map(topic => ({ ...topic, sectionId: section.id })));
const slugs = allRefs.map(topic => topic.slug);
assert.equal(new Set(slugs).size, slugs.length, "Duplicate route slug");
assert.deepEqual([...REAL_TOPIC_SLUGS].sort(), [...slugs].sort(), "Manifest and routes differ");
assert.deepEqual(readdirSync(join(root, "src/topics"), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(), [...slugs].sort(), "Topic directories and routes differ");
assert.deepEqual(Object.keys(contentIndex).sort(), [...slugs].sort(), "Generated content index and routes differ");
for (const ref of allRefs) {
  const base = `src/topics/${ref.slug}`;
  counts.topics++;
  const indexSource = readFileSync(join(root, base, "index.ts"), "utf8");
  const sourceFile = ts.createSourceFile("index.ts", indexSource, ts.ScriptTarget.Latest, true);
  let metaNode;
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "meta") metaNode = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(metaNode, `${base}: missing metadata`);
  const meta = new Function(`return (${metaNode.getText(sourceFile)})`)();
  for (const key of ["slug", "sectionId"]) check(meta[key] === ref[key], `${base}: metadata ${key} mismatch`);
  if (meta.title !== ref.title) warnings.push(`${base}: catalog and topic titles use different wording`);
  check(contentIndex[ref.slug].summary === meta.summary, `${base}: generated summary mismatch`);
  const { notes } = dataModule(`${base}/notes.ts`);
  const { examples } = dataModule(`${base}/examples.ts`);
  const { problems } = dataModule(`${base}/problems.ts`);
  const { history } = dataModule(`${base}/history.ts`);
  check(notes.length > 0 && examples.length > 0 && problems.length > 0 && history.facts.length > 0, `${base}: empty authored content`);
  check(new Set(problems.map(problem => problem.id)).size === problems.length, `${base}: duplicate problem IDs`);
  check(contentIndex[ref.slug].problemCount === problems.length, `${base}: generated problem count mismatch`);
  check(JSON.stringify(contentIndex[ref.slug].headings) === JSON.stringify(notes.filter(block => block.type === "heading").map(block => block.content)), `${base}: generated headings mismatch`);
  for (const block of notes) {
    check(["heading", "paragraph", "formula", "list"].includes(block.type), `${base}: unsupported note block`);
    check(block.type === "list" ? Array.isArray(block.content) : typeof block.content === "string", `${base}: invalid note content`);
    if (block.type === "formula") formula(block.content, `${base}/notes`);
    else textMath(block.content, `${base}/notes`);
  }
  for (const problem of problems) {
    counts.problems++;
    check(typeof problem.id === "string" && problem.id.length > 0, `${base}: empty problem ID`);
    check(Number.isFinite(problem.answer), `${base}/${problem.id}: nonfinite answer`);
    check(Number.isFinite(problem.tolerancePercent) && problem.tolerancePercent >= 0 && problem.tolerancePercent < 100, `${base}/${problem.id}: invalid tolerance`);
    check(problem.question.length > 0 && problem.solution.length > 0, `${base}/${problem.id}: missing question/solution`);
    textMath(problem, `${base}/${problem.id}`);
  }
  counts.examples += examples.length;
  textMath(examples, `${base}/examples`);
  textMath(history, `${base}/history`);
  for (const scientist of history.scientists ?? []) {
    if (!scientists[scientist]) warnings.push(`${base}: portrait registry entry missing for ${scientist}`);
  }
  const sim = readFileSync(join(root, base, "sim.tsx"), "utf8");
  const simExport = indexSource.match(/default:\s*m\.(\w+)/)?.[1];
  check(Boolean(simExport && new RegExp(`export function ${simExport}\\b`).test(sim)), `${base}: missing lazy simulation export`);
  check(sim.includes("<TransportControls") && sim.includes("onReset=") && sim.includes("onToggle="), `${base}: missing transport controls`);
}
for (const [slug, scientist] of Object.entries(scientists)) {
  counts.scientists++;
  check(existsSync(join(root, "public/physicists", scientist.photo)), `scientists/${slug}: missing local image`);
  check(new URL(scientist.sourceUrl).protocol === "https:", `scientists/${slug}: insecure source URL`);
}
console.log(JSON.stringify(counts));
if (warnings.length) console.warn(`Editorial/media gaps (${warnings.length}):\n${warnings.join("\n")}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("Content routes, metadata, manifests, math, problem schema, media, and transport wiring passed.");
