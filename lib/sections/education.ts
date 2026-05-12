import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import { EducationEntrySchema, type EducationEntry } from "@/lib/schemas";

/**
 * Education chain. LLM extracts; TypeScript sorts.
 *
 * The LLM's only job is faithful extraction + the is_professional flag.
 * Ordering is deterministic Python-equivalent code: professional first,
 * school second, reverse-chronological within each group.
 *
 * This is the "cheapest tool that works" pattern. Sorts are not a job for
 * an LLM — they are a job for a stable comparator that runs in 1ms with
 * zero cost and zero variance.
 */

const SYSTEM = `You are a CV education extractor. Faithful extraction only — no invention.

Rules:
1. Extract every education entry from the CV.
2. Preserve the CV's wording. Do not normalize, translate, or "clean up"
   degree or institution names.
3. For is_professional, use this rule:
   - true: MBBS, MD, MS, MPH, MBA, MPhil, PhD, MCom, MA, MSc, FCPS, MRCP,
     CCD, ACCA, CMA, CA, postgraduate diplomas, fellowships
   - false: HSC, SSC, A-Level, O-Level, GED, Higher Secondary,
     Secondary School Certificate
4. If a field is missing in the CV, leave it empty. Never invent.
5. Do NOT sort. Return entries in the order they appear in the CV.
   Sorting is handled by downstream code.`;

// We wrap the entries array in a one-field object, because callStructured's
// describeZod helper produces cleaner shape descriptions for objects than
// for top-level arrays, and JSON parsers vary on whether bare arrays are
// "valid JSON values" depending on options.
const ExtractionSchema = z.object({
  entries: z
    .array(EducationEntrySchema)
    .describe("All education entries, in CV order."),
});

function buildHuman(rawCv: string): string {
  return `Candidate CV (raw text):\n${rawCv}\n\nExtract education entries.`;
}

/**
 * Extract the last 4-digit year from a string like "2014-2016" or "Jul 2018"
 * or "2018". Used as the reverse-chrono sort key. Missing/unparseable years
 * sort last (year=0).
 */
function lastYear(year: string): number {
  const matches = year.match(/\d{4}/g);
  if (!matches || matches.length === 0) return 0;
  return parseInt(matches[matches.length - 1], 10);
}

/**
 * Order education entries: professional first, school second; both groups
 * reverse-chronological by last year on the entry. Stable within ties.
 */
export function orderEducation(entries: EducationEntry[]): EducationEntry[] {
  const professional = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.is_professional)
    .sort((a, b) => {
      const yb = lastYear(b.e.year);
      const ya = lastYear(a.e.year);
      return yb !== ya ? yb - ya : a.i - b.i; // stable on tie
    })
    .map((x) => x.e);

  const school = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => !x.e.is_professional)
    .sort((a, b) => {
      const yb = lastYear(b.e.year);
      const ya = lastYear(a.e.year);
      return yb !== ya ? yb - ya : a.i - b.i;
    })
    .map((x) => x.e);

  return [...professional, ...school];
}

export type EducationSection = { entries: EducationEntry[] };

export async function runEducation(rawCv: string): Promise<EducationSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawCv)),
  ];
  const extracted = await callStructured(llm, messages, ExtractionSchema);
  return { entries: orderEducation(extracted.entries) };
}
