import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  ExperienceSectionSchema,
  type ExperienceSection,
} from "@/lib/schemas";

/**
 * Experience reviser. Ported from v3/reviser.py.
 *
 * Minimum-change discipline: only touch the bullets the critic flagged;
 * leave everything else byte-identical. Preserve role count, order,
 * companies, titles, and dates exactly.
 */

const SYSTEM = `You are a CV reviser. You take an existing tailored Experience section and a critique, and produce a corrected Experience section.

Rules:
1. Only change bullets the critique flagged. Leave every other bullet EXACTLY
   as it is — same wording, same order, same role grouping.
2. For each flagged bullet, apply the critic's suggested fix UNLESS the fix
   itself would introduce a fact not in the raw CV. In that case, fall back
   to a minimal rewrite that removes the unsupported claim and keeps what the
   CV supports.
3. Never invent companies, dates, tools, scale, leadership, frameworks,
   clients, or outcomes. The raw CV is the only source of truth.
4. Preserve role count, role order (reverse-chronological), company names,
   titles, dates, and locations exactly as they appear in the original
   Experience draft.
5. Keep bullets concise, action-oriented, ATS-friendly. One line each.
6. If a flagged bullet cannot be salvaged without fabricating, drop it.
   Do not pad to keep counts.`;

function buildHuman(
  draft: ExperienceSection,
  notes: string[],
  rawJd: string,
  rawCv: string,
): string {
  const numbered = notes.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text — the only source of truth):\n${rawCv}\n\n` +
    `Original tailored Experience (JSON):\n${JSON.stringify(draft, null, 2)}\n\n` +
    `Critique notes (each must be addressed):\n${numbered}\n\n` +
    `Produce the revised Experience section.`
  );
}

export async function runExperienceReviser(
  draft: ExperienceSection,
  notes: string[],
  rawJd: string,
  rawCv: string,
): Promise<ExperienceSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(draft, notes, rawJd, rawCv)),
  ];
  return callStructured(llm, messages, ExperienceSectionSchema);
}
