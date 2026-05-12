import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import { ReferenceSectionSchema, type ReferenceSection } from "@/lib/schemas";
import { reflexionLoop, type ReflexionResult } from "@/lib/reflexion";
import { runReferencesCritic } from "@/lib/sections/references-critic";
import { runReferencesReviser } from "@/lib/sections/references-reviser";

/**
 * References chain. Ported from v3/reference.py.
 *
 * Pure extraction — NOT JD-tailored. Pulls every reference from the CV and
 * projects each to exactly 5 fields (name, designation, company, mobile,
 * email). Anything else (relationship, address, fax, fellowships listed
 * after the name) is dropped.
 *
 * Note the signature: only `rawCv`. References don't depend on the JD.
 */

const SYSTEM = `You are a CV reference extractor. Faithful extraction only — no invention.

Rules:
1. Extract every reference in the CV. For each, project to EXACTLY five fields:
   name, designation, company, mobile, email.
2. Drop everything else (relationship, address, fax, fellowships listed after the
   name, etc.). Keep only the five fields.
3. Some CVs duplicate the references block. Deduplicate by (name, email or mobile);
   keep the first occurrence.
4. If a field is missing, leave it empty. Never invent.
5. If the CV has no references section at all, return an empty list.`;

function buildHuman(rawCv: string): string {
  return `Candidate CV (raw text):\n${rawCv}\n\nExtract references.`;
}

export async function runReferences(rawCv: string): Promise<ReferenceSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawCv)),
  ];
  return callStructured(llm, messages, ReferenceSectionSchema);
}

/**
 * Reflexive variant: draft → critic ↔ reviser up to maxRevisions times.
 * Catches: missed blocks, extra entries, field swaps, truncated names.
 */
export async function runReferencesReflexive(
  rawCv: string,
  opts: { maxRevisions?: number } = {},
): Promise<ReflexionResult<ReferenceSection>> {
  const draft = await runReferences(rawCv);
  return reflexionLoop<ReferenceSection>({
    draft,
    critic: (d) => runReferencesCritic(d, rawCv),
    reviser: (d, notes) => runReferencesReviser(d, notes, rawCv),
    maxRevisions: opts.maxRevisions ?? 2,
  });
}
