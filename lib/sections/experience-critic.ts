import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  CritiqueSchema,
  type Critique,
  type ExperienceSection,
} from "@/lib/schemas";

/**
 * Experience critic. Ported from v3/critic.py.
 *
 * Bullets are the highest-risk text in a CV — they are the most rewritten
 * and the most JD-influenced. The critic's job: certify every fact-bearing
 * token in every bullet is grounded in the raw CV. If it can't, it flags.
 *
 * Notes are addressed-by-coordinate so the reviser knows which bullet to
 * fix: "[role 1 / bullet 3] ..." identifies role index (0-based) and bullet
 * index (0-based) so the reviser can rewrite only that span.
 */

const SYSTEM = `You are a strict, adversarial CV reviewer. Assume bullets contain fabrications until proven otherwise. Your job is to find problems. You do NOT rewrite.

PROCEDURE — apply to every bullet, in order:
1. Identify every fact-bearing token in the bullet:
   - Proper nouns: company names, buyer/client names, person names, tool brands.
   - Numbers: percentages, head-counts, durations, money, years, counts of anything.
   - Named frameworks/standards/certifications (BSCI, Sedex, Accord, PHRi, Six Sigma, etc.).
2. For each token, locate it in the raw CV (verbatim or as an obvious paraphrase).
3. If a token is not in the raw CV → flag the bullet.

ISSUE TYPES:
- fabrication: a proper noun, client name, or named entity NOT in the raw CV.
- unsupported_metric: a number NOT in the raw CV, or one that exceeds what the CV claims.
- vague: so generic it could fit any candidate ("worked on HR tasks").
- off_jd: ignores a JD must-have when the CV could have supported a stronger version.

KNOWN FABRICATION PATTERNS — flag every instance:
- Specific client/buyer names when the CV only says generic "buyers" or "clients".
- Outcome metrics ("zero major non-conformances", "30% reduction") that do not
  appear verbatim in the raw CV.
- Tool or system names not mentioned in the raw CV.
- Head-counts more precise than the CV ("1,200 employees" when CV says "1,000+").

RULES:
1. Approving means you certify every fact in every bullet is grounded in the raw CV.
   If you cannot certify that, you MUST flag.
2. pass=true is only valid when notes=[].
3. Do not flag a fact just because it sounds impressive — only when it is absent
   from the CV.

OUTPUT — produce a Critique:
- pass = true ⇔ every bullet is fully grounded.
- pass = false ⇒ list every issue in \`notes\`. Each note has this shape:
    [role <i> / bullet <j>] [issue_type] "<flagged span>" — <why>. Fix: <one-sentence fix>.
  Role and bullet indices are 0-based (first role = 0).
  Example:
    [role 0 / bullet 2] [fabrication] "H&M and Walmart audits" — CV says only "buyer audits", no brands. Fix: replace with "buyer audits" or drop the bullet.`;

function buildHuman(
  draft: ExperienceSection,
  rawJd: string,
  rawCv: string,
): string {
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text — the only source of truth):\n${rawCv}\n\n` +
    `Tailored Experience draft to critique (JSON):\n${JSON.stringify(draft, null, 2)}\n\n` +
    `Produce the critique.`
  );
}

export async function runExperienceCritic(
  draft: ExperienceSection,
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
