import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  CritiqueSchema,
  type Critique,
  type CareerSummary,
} from "@/lib/schemas";

/**
 * Summary critic. Ported from v3/summary_critic.py with a flatter output
 * shape: instead of a list of {quote, issue_type, explanation, fix}
 * objects, we collapse each issue into one note that includes all four
 * pieces of information. The generic reflexionLoop helper then feeds those
 * notes to the reviser.
 *
 * The critic NEVER rewrites. Its only job: spot fabrications, unsupported
 * metrics, JD-overreach, and filler.
 */

const SYSTEM = `You are a strict, adversarial CV-summary reviewer. Assume the summary contains fabrications or JD-overreach until proven otherwise. You do NOT rewrite.

PROCEDURE — apply to every fact-bearing token in the summary:
1. Identify every fact-bearing token:
   - Total years of experience (e.g. "10+ years").
   - Company names.
   - Domain / industry claims (e.g. "hospital", "FMCG").
   - Function / specialism claims (e.g. "IPC protocols", "payroll").
   - Degrees / institutions / years of graduation.
2. For each token, locate it in the raw CV (verbatim or obvious paraphrase).
3. If a token is not in the raw CV → flag it.

ISSUE TYPES:
- fabrication: a company, degree, or named entity NOT in the raw CV.
- unsupported_metric: years/head-counts/numbers not derivable from the CV.
- overreach: claims a JD-favored skill or domain the CV doesn't support.
- filler: empty buzzwords ("results-driven", "passionate", "dynamic",
  "proven track record", "highly motivated").

OUTPUT — produce a Critique:
- pass = true  ⇔  the summary is clean (no fabrications, no overreach, no filler).
- pass = false ⇒ list every issue in \`notes\`. Each note is ONE sentence with
  this shape:
    [issue_type] "<the exact flagged span>" — <why it's a problem>. Fix: <one-sentence fix>.
  Example:
    [fabrication] "Oracle HCM expert" — CV never mentions Oracle. Fix: remove this claim or replace with a system actually present in the CV.`;

function buildHuman(
  draft: CareerSummary,
  rawJd: string,
  rawCv: string,
): string {
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Summary draft to critique:\n${draft.summary}\n\n` +
    `Produce the critique.`
  );
}

export async function runSummaryCritic(
  draft: CareerSummary,
  rawJd: string,
  rawCv: string,
): Promise<Critique> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(draft, rawJd, rawCv)),
  ];
  return callStructured(llm, messages, CritiqueSchema);
}
