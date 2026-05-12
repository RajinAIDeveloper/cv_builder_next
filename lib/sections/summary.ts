import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import { CareerSummarySchema, type CareerSummary } from "@/lib/schemas";
import { reflexionLoop, type ReflexionResult } from "@/lib/reflexion";
import { runSummaryCritic } from "@/lib/sections/summary-critic";
import { runSummaryReviser } from "@/lib/sections/summary-reviser";

/**
 * Career-summary chain. Ported from v3/summary.py.
 *
 * Takes the raw JD + raw CV. Returns one tailored paragraph following the
 * formula EXP + Company + Work + last 1-2 degrees. JD-aware, but every
 * factual claim must be supported by the CV.
 *
 * No HTTP here. The Route Handler imports this; in Phase 5 the LangGraph
 * node will too.
 */

const SYSTEM = `You are a CV career-summary writer. You produce ONE truthful, ATS-friendly paragraph.

Formula:
  EXP (total years) + Company (most recent / most notable) + Work (domain / function) + last 1-2 degrees.

Rules:
- Only use facts from the raw CV. Never invent companies, years, or credentials.
- Tailor language toward the JD's industry, seniority, and must-have skills, but ONLY when the CV supports them.
- Keep it 3-5 sentences. No bullet points. No markdown.
- Use restrained, specific wording. Avoid filler like "passionate", "dynamic", "results-driven", "proven track record".
- Do not start with the candidate's name. Start with their experience profile.`;

function buildHuman(rawJd: string, rawCv: string): string {
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Produce the Career Summary paragraph.`
  );
}

export async function runSummary(
  rawJd: string,
  rawCv: string,
): Promise<CareerSummary> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawJd, rawCv)),
  ];
  return callStructured(llm, messages, CareerSummarySchema);
}

/**
 * Reflexive variant: produce a draft, then run critic ↔ reviser up to
 * maxRevisions times. Returns the final summary plus the full history so
 * callers can inspect the iteration.
 *
 * Use this when you want quality guarantees. Use runSummary when you just
 * want a fast one-shot draft.
 */
export async function runSummaryReflexive(
  rawJd: string,
  rawCv: string,
  opts: { maxRevisions?: number } = {},
): Promise<ReflexionResult<CareerSummary>> {
  const draft = await runSummary(rawJd, rawCv);
  return reflexionLoop<CareerSummary>({
    draft,
    critic: (d) => runSummaryCritic(d, rawJd, rawCv),
    reviser: (d, notes) => runSummaryReviser(d, notes, rawJd, rawCv),
    maxRevisions: opts.maxRevisions ?? 2,
  });
}
