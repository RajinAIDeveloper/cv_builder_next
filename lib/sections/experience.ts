import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  ExperienceSectionSchema,
  type ExperienceSection,
} from "@/lib/schemas";
import { reflexionLoop, type ReflexionResult } from "@/lib/reflexion";
import { runExperienceCritic } from "@/lib/sections/experience-critic";
import { runExperienceReviser } from "@/lib/sections/experience-reviser";

/**
 * Experience tailoring chain. Ported from v3/experience.py.
 *
 * This is the heaviest section. The model has to:
 *   1. Extract every employment entry from the raw CV.
 *   2. Order reverse-chronologically.
 *   3. Rewrite bullets to emphasize JD-relevant duties — only when the CV
 *      supports them. No fabrication.
 *   4. Stay within a 4-7 bullets-per-role budget.
 *
 * Returns ExperienceSection: { roles: [{ company, title, dates, location,
 * bullets: [{ text }] }] }.
 *
 * "Lossy by design" — bullets are rewritten, not preserved verbatim. The
 * reflexion loop in Phase 4 is the safety net: a critic checks every
 * rewritten bullet against the CV, and the reviser strips anything that
 * can't be sourced.
 */

const SYSTEM = `You are a CV experience-section tailoring assistant.

1. Extract every employment entry from the raw CV.
2. Order them reverse-chronologically (most recent first).
3. Rewrite bullets to emphasize JD-relevant duties — ONLY when supported by the CV.
4. Never invent companies, dates, tools, scale, leadership, or domains.
5. Bullets must be concise, action-oriented, ATS-friendly. One line each.
6. 4-7 bullets per role; do not pad.`;

function buildHuman(rawJd: string, rawCv: string): string {
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Produce the tailored Experience section.`
  );
}

export async function runExperience(
  rawJd: string,
  rawCv: string,
): Promise<ExperienceSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawJd, rawCv)),
  ];
  return callStructured(llm, messages, ExperienceSectionSchema);
}

/**
 * Reflexive variant: draft → critic ↔ reviser up to maxRevisions times.
 * Use this when bullet fidelity matters (production runs). Use runExperience
 * for fast one-shot drafts (development).
 */
export async function runExperienceReflexive(
  rawJd: string,
  rawCv: string,
  opts: { maxRevisions?: number } = {},
): Promise<ReflexionResult<ExperienceSection>> {
  const draft = await runExperience(rawJd, rawCv);
  return reflexionLoop<ExperienceSection>({
    draft,
    critic: (d) => runExperienceCritic(d, rawJd, rawCv),
    reviser: (d, notes) => runExperienceReviser(d, notes, rawJd, rawCv),
    maxRevisions: opts.maxRevisions ?? 2,
  });
}
