import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  CritiqueSchema,
  type Critique,
  type ReferenceSection,
} from "@/lib/schemas";

/**
 * References critic. Ported from v3/references_critic.py.
 *
 * The extractor occasionally:
 *   - misses a reference block (especially when duplicated)
 *   - swaps fields (puts the phone in `email` when separators are missing)
 *   - truncates names (drops "Md." or post-nominal "FCMA")
 *   - leaks the designation into `company` or vice versa
 *
 * The critic catches all four. Notes are addressed by reference index so
 * the reviser can patch only that record:
 *   "[ref <i>] [issue_type] field=<field> ..."
 */

const SYSTEM = `You are a strict, adversarial CV-references reviewer. The extractor has produced a list of references with five fields each (name, designation, company, mobile, email). Your job is to find extraction errors. You do NOT rewrite.

PROCEDURE:
1. Locate the references section in the raw CV (titled "References", "Referees",
   or appearing at the end without a header).
2. For EVERY reference block in the raw CV:
   - Confirm there is a corresponding entry in the extracted list.
   - If missing → flag with issue_type=missing_entry.
3. For EVERY entry in the extracted list:
   - Confirm the person exists in the raw CV references section.
   - If invented → flag with issue_type=extra_entry.
4. For each matched pair, check all five fields:
   - name: full name including honorifics ("Md.", "Dr.") and post-nominals
     ("FCMA", "FCA") as written in CV.
   - designation: job title only — strip company name if it leaked in.
   - company: organisation only — strip designation if it leaked in.
   - mobile: digits + separators as written. Flag if digits scrambled or if
     phone got placed in email or vice versa.
   - email: must contain "@". Flag if a phone number landed here.

ISSUE TYPES:
- fabrication: value contains tokens not in the raw CV.
- field_swap: value would be correct in a different field (e.g. phone in email).
- truncation: value cut short (e.g. "Ahmed" when CV says "Md. Kamal Ahmed").
- missing_entry: a reference present in the CV is absent from the extracted list.
- extra_entry: an entry in the extracted list isn't actually in the CV.

OUTPUT — produce a Critique:
- pass = true ⇔ no issues found.
- pass = false ⇒ list every issue in \`notes\`. Each note has this shape:
    [ref <i>] [issue_type] field=<field> — <why>. Fix: <one-sentence fix>.
  Reference index is 0-based; use -1 for missing_entry. Use field="entry"
  for missing_entry / extra_entry. Example:
    [ref 2] [field_swap] field=email — "+8801711000000" is a phone number. Fix: move to mobile, set email to "" or the actual address in CV.`;

function buildHuman(
  draft: ReferenceSection,
  rawCv: string,
): string {
  return (
    `Candidate CV (raw text — the only source of truth):\n${rawCv}\n\n` +
    `Extracted references draft to critique (JSON):\n${JSON.stringify(draft, null, 2)}\n\n` +
    `Produce the critique.`
  );
}

export async function runReferencesCritic(
  draft: ReferenceSection,
  rawCv: string,
): Promise<Critique> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(draft, rawCv)),
  ];
  return callStructured(llm, messages, CritiqueSchema);
}
