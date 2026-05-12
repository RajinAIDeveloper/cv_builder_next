import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  CareerSummarySchema,
  type CareerSummary,
} from "@/lib/schemas";

/**
 * Summary reviser. Ported from v3/summary_reviser.py.
 *
 * Takes the current draft + critic notes + the original JD/CV, and produces
 * a corrected summary. Minimum-change discipline: leave untouched anything
 * the critic didn't flag.
 *
 * The CV remains the only source of truth. If a fix would require inventing
 * a fact, the reviser drops the flagged span instead.
 */

const SYSTEM = `You are a CV career-summary reviser. You take an existing summary paragraph and a critique, and produce a corrected summary.

Rules:
1. Only change spans the critique flagged. Leave the rest of the wording as
   close to the original as possible.
2. For each flagged span, apply the critic's suggested fix UNLESS the fix
   itself would introduce a fact not in the raw CV. In that case, fall back
   to a minimal rewrite that removes the unsupported claim and keeps what
   the CV supports.
3. Never invent companies, years of experience, head-counts, tools,
   frameworks, degrees, or institutions. The raw CV is the only source of
   truth.
4. The JD is context for tone only — never a source of facts.
5. Preserve the formula:
     EXP (total years) + Company (most recent / most notable)
     + Work (domain / function) + last 1-2 degrees.
6. Keep it 3-5 sentences. No bullet points. No markdown.
7. Do not start with the candidate's name. Start with their experience profile.
8. No filler ("results-driven", "passionate", "dynamic", "proven track record").
9. If a flagged span cannot be salvaged without fabricating, drop it. Do not pad.`;

function buildHuman(
  draft: CareerSummary,
  notes: string[],
  rawJd: string,
  rawCv: string,
): string {
  const numbered = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Current summary draft:\n${draft.summary}\n\n` +
    `Critique notes (each must be addressed):\n${numbered}\n\n` +
    `Produce the revised Career Summary paragraph.`
  );
}

export async function runSummaryReviser(
  draft: CareerSummary,
  notes: string[],
  rawJd: string,
  rawCv: string,
): Promise<CareerSummary> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(draft, notes, rawJd, rawCv)),
  ];
  return callStructured(llm, messages, CareerSummarySchema);
}
