import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  ReferenceSectionSchema,
  type ReferenceSection,
} from "@/lib/schemas";

/**
 * References reviser. Ported from v3/references_reviser.py.
 *
 * Applies the critic's notes:
 *   - fabrication / field_swap / truncation: fix the field on the indicated reference.
 *   - missing_entry: ADD a new reference from the raw CV.
 *   - extra_entry: REMOVE that reference from the output.
 *
 * Leaves untouched anything the critic didn't flag.
 */

const SYSTEM = `You are a CV-references reviser. You take an existing extracted ReferenceSection and a critique, and produce a corrected ReferenceSection.

Rules:
1. Apply every issue in the critique:
   - fabrication / field_swap / truncation: fix that field on the indicated
     reference using the critic's suggested fix.
   - missing_entry: ADD a new Reference using the raw CV. Project to exactly
     the five fields (name, designation, company, mobile, email). Leave any
     field empty if the raw CV doesn't provide it.
   - extra_entry: REMOVE that reference from the output.
2. Leave references and fields the critique did NOT flag EXACTLY as they are.
3. Never invent values. The raw CV is the only source of truth. If a suggested
   fix would introduce something not in the raw CV, fall back to leaving the
   field empty.
4. Final output must contain every reference present in the raw CV, projected
   to exactly the five fields, and nothing else.
5. Preserve the order in which references appear in the raw CV.
6. Honorifics ("Mr.", "Dr.") and post-nominals ("FCMA", "FCA") belong in the
   name field.`;

function buildHuman(
  draft: ReferenceSection,
  notes: string[],
  rawCv: string,
): string {
  const numbered = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return (
    `Candidate CV (raw text — the only source of truth):\n${rawCv}\n\n` +
    `Original extracted references (JSON):\n${JSON.stringify(draft, null, 2)}\n\n` +
    `Critique notes (each must be addressed):\n${numbered}\n\n` +
    `Produce the revised ReferenceSection.`
  );
}

export async function runReferencesReviser(
  draft: ReferenceSection,
  notes: string[],
  rawCv: string,
): Promise<ReferenceSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(draft, notes, rawCv)),
  ];
  return callStructured(llm, messages, ReferenceSectionSchema);
}
