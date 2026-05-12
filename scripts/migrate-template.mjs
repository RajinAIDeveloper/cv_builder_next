#!/usr/bin/env node
/**
 * One-shot migration: v3 (docxtpl / Jinja2) → v4 (docxtemplater) template.
 *
 * Reads:  public/cv_template.docx     (the v3 Jinja-syntax file)
 * Writes: public/cv_template.v4.docx  (the docxtemplater-syntax file)
 *
 * Run with:  node scripts/migrate-template.mjs
 *
 * Why it's not just a string.replace pass:
 *   Word stores text as a sequence of <w:r><w:t>…</w:t></w:r> "runs". Editing
 *   even one character creates a new run. So a tag like `{% if summary %}`
 *   often appears as several runs glued together:
 *
 *       <w:r><w:t>{% </w:t></w:r>
 *       <w:r><w:t>if summary </w:t></w:r>
 *       <w:r><w:t>%}</w:t></w:r>
 *
 *   `buildJinjaPattern()` produces a regex that matches the tag's CHARACTERS
 *   even when the inert XML between them ("soft breaks") is interleaved. The
 *   replacement preserves those soft-break sequences so all surrounding
 *   styling stays intact — only the tag CONTENT changes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PizZip from "pizzip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(PROJECT_ROOT, "public", "cv_template.docx");
const OUTPUT = path.join(PROJECT_ROOT, "public", "cv_template.v4.docx");

// ----------------------------------------------------------------------------
// Soft-break-tolerant regex builder
// ----------------------------------------------------------------------------

// The inert XML Word inserts between text-character splits. Made optional so
// the same regex matches both contiguous and split tags.
const SOFT_BREAK =
  "(?:</w:t>(?:</w:r>)?" +
  "(?:<w:proofErr[^>]*/?>)?" +
  "\\s*" +
  "(?:<w:r[^>]*>)?" +
  "(?:<w:rPr>(?:[^<]|<[^>]+>)*</w:rPr>)?" +
  "<w:t[^>]*>)?";

/**
 * Build a regex that matches a Jinja tag whether contiguous or split across
 * runs. Captures all soft-break groups so we can splice them back into the
 * replacement and preserve styling.
 *
 *   buildJinjaPattern("{% if summary %}")
 *     ≈ /\{((?:<\/w:t>…<w:t[^>]*>)?)%(…)?\s(…)?i(…)?f(…)? …%\}/g
 *
 * Returns: { regex, replace(newText) -> function for String.prototype.replace }
 */
function jinjaTag(jinjaSource) {
  // Escape regex meta-characters in each literal character of the tag.
  const escapeChar = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chars = jinjaSource.split("").map(escapeChar);

  // Allow whitespace between Jinja tokens to be flexible too: instead of
  // requiring the exact " " characters, match any whitespace (including soft
  // breaks) between word boundaries. Simpler approach: build per-character.
  let pattern = chars[0];
  for (let i = 1; i < chars.length; i++) {
    pattern += SOFT_BREAK + chars[i];
  }
  return new RegExp(pattern, "g");
}

/**
 * Replace a Jinja tag with new docxtemplater syntax while preserving captured
 * soft-break XML so the surrounding Word runs stay intact.
 */
function replaceJinjaTag(xml, jinjaSource, newTag) {
  let count = 0;
  const regex = jinjaTag(jinjaSource);
  const out = xml.replace(regex, (...args) => {
    // args = [match, cap1, cap2, …, offset, fullString]
    const captures = args.slice(1, -2).filter(Boolean).join("");
    count++;
    return newTag + captures;
  });
  return { xml: out, count };
}

// ----------------------------------------------------------------------------
// Translation table
// ----------------------------------------------------------------------------

// Each entry: [jinja source, new docxtemplater tag].
// Order matters: more specific patterns first (e.g. `{% if not loop.last %}`
// before generic `{% if … %}`), variable replacements before block replacements
// (so we don't accidentally consume variable braces inside blocks).
const REPLACEMENTS = [
  // Filtered variables — JS precomputes these on the data side
  ["{{ candidate.name | upper }}", "{candidate_name_upper}"],
  ["{{ right.items | join(', ') }}", "{right_items_joined}"],
  ["{{ left.items | join(', ') }}", "{left_items_joined}"],

  // Top-level scalars
  ["{{ summary.summary }}", "{summary_text}"],

  // Loop-local variables (inside their parent {#…} sections, scope is local)
  ["{{ role.title }}", "{title}"],
  ["{{ role.company }}", "{company}"],
  ["{{ role.dates }}", "{dates}"],
  ["{{ b.text }}", "{text}"],
  ["{{ e.degree }}", "{degree}"],
  ["{{ e.institution }}", "{institution}"],
  ["{{ e.year }}", "{year}"],
  ["{{ e.result }}", "{result}"],
  ["{{ t.title }}", "{title}"],
  ["{{ t.provider }}", "{provider}"],
  ["{{ t.year }}", "{year}"],
  ["{{ left.title }}", "{title}"],
  ["{{ right.title }}", "{title}"],
  ["{{ r.name }}", "{name}"],
  ["{{ r.designation }}", "{designation}"],
  ["{{r.company}}", "{company}"],
  ["{{r.mobile}}", "{mobile}"],
  ["{{r.email}}", "{email}"],

  // Inline conditional opens → docxtemplater sections (closed later by endif)
  ["{% if summary %}", "{#hasSummary}"],
  ["{% if experience %}", "{#hasExperience}"],
  ["{% if education %}", "{#hasEducation}"],
  ["{% if training %}", "{#hasTraining}"],
  ["{% if others_rows %}", "{#hasOthers}"],
  ["{% if references %}", "{#hasReferences}"],
  ["{% if e.result %}", "{#result}"],
  ["{% if t.provider %}", "{#provider}"],
  ["{% if t.year %}", "{#year}"],
  ["{% if r.email %}", "{#email}"],
  ["{% if r.mobile %}", "{#mobile}"],
  ["{% if r.company %}", "{#company}"],
  ["{% if left %}", "{#left}"],
  ["{% if right %}", "{#right}"],

  // loop.last separators — JS will pre-attach commas to data; the tag itself
  // becomes a no-op section that always renders empty.
  // We can't match the whole `{% if not loop.last %},{% endif %}` as one
  // because the `{% endif %}` is generic. Instead, leave the if-open in place
  // and rely on the data side to send `not_last:false`. Simpler: convert the
  // open to a section the data will never satisfy.
  ["{% if not loop.last %}", "{#not_last}"],

  // Photo: docxtemplater needs an image module we haven't installed in v1.
  // We strip the entire `{% if photo %}…{% endif %}` block by converting the
  // open to a section keyed off `has_photo` (always false), and let the
  // generic endif close it.
  ["{% if photo %}", "{#has_photo}"],
  ["{{ photo }}", ""],

  // Loops → docxtemplater sections. The `{%p …%}` paragraph-mode prefix in
  // docxtpl has no equivalent in docxtemplater (it handles paragraph loops
  // automatically); both kinds map to the same section tag here.
  ["{%p for role in experience.roles %}", "{#experience}"],
  ["{%p for b in role.bullets %}", "{#bullets}"],
  ["{%p for e in education %}", "{#education}"],
  ["{%p for t in training %}", "{#training}"],
  ["{% for left, right in others_rows %}", "{#others_rows}"],
  ["{% for r in references %}", "{#references}"],

  // Generic closes — must be LAST because they would otherwise close anything.
  ["{% endif %}", "{/}"],
  ["{%p endfor %}", "{/}"],
  ["{% endfor %}", "{/}"],
];

// ----------------------------------------------------------------------------
// Run
// ----------------------------------------------------------------------------

console.log(`Reading ${path.relative(PROJECT_ROOT, INPUT)} …`);
const buffer = fs.readFileSync(INPUT);
const zip = new PizZip(buffer);

const file = zip.file("word/document.xml");
if (!file) {
  console.error("word/document.xml not found in the input docx.");
  process.exit(1);
}

let xml = file.asText();
const originalLength = xml.length;

console.log(`Applying ${REPLACEMENTS.length} translations …\n`);
const stats = [];
for (const [from, to] of REPLACEMENTS) {
  const { xml: newXml, count } = replaceJinjaTag(xml, from, to);
  stats.push({ from, to, count });
  xml = newXml;
}

// Report
const colW = Math.max(...stats.map(s => s.from.length));
for (const s of stats) {
  const indicator = s.count > 0 ? "✓" : "·";
  console.log(`  ${indicator} ${s.from.padEnd(colW)}  →  ${s.to.padEnd(28)} ${s.count}×`);
}

// Sanity: any unmatched Jinja syntax left in the document?
const leftovers = xml.match(/\{%[^%]*%\}|\{\{[^}]*\}\}/g) ?? [];
if (leftovers.length > 0) {
  console.warn(
    `\n⚠  ${leftovers.length} unmatched Jinja-looking token(s) remain ` +
      `(may be split across runs in ways the regex missed):`,
  );
  for (const l of leftovers.slice(0, 12)) console.warn(`    ${l}`);
  if (leftovers.length > 12) console.warn(`    … and ${leftovers.length - 12} more`);
}

// Write
zip.file("word/document.xml", xml);
const outBuffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(OUTPUT, outBuffer);

console.log(
  `\nWrote ${path.relative(PROJECT_ROOT, OUTPUT)}  ` +
    `(${(outBuffer.length / 1024).toFixed(1)} KB; ` +
    `xml ${originalLength} → ${xml.length} chars)`,
);
