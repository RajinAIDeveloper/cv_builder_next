import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  TrainingSectionSchema,
  type TrainingSection,
  type TrainingItem,
} from "@/lib/schemas";

/**
 * Training chain. Ported from v3/training.py with one v4 enhancement:
 * each item carries a `reason` field explaining its keep/drop decision.
 *
 * The chain returns ALL items with keep/drop flags. Downstream code
 * filters to keep=true items for rendering. Keeping the dropped items
 * (with reasons) makes debugging trivial — no "where did Power BI go?"
 * mystery.
 */

const SYSTEM = `You are a CV training-section relevance filter.

Tasks:
1. Extract every training, course, certification, or workshop from the raw CV.
2. For each one, decide if it is relevant to the JD's industry, must-have skills, or domain.
3. Set keep=true for relevant items. Set keep=false for clearly irrelevant or outdated items.
4. Borderline cases: keep them.
5. For every item, write a short reason (under 20 words) explaining the decision.
   - Keep examples: "Matches JD must-have: cloud" / "Hospital relevance".
   - Drop examples: "Generic first-aid course unrelated to this software role" /
     "Outdated 1998 IT certification".

Do NOT include items already covered as professional qualifications (CA, CMA, ACCA,
PHRi, etc.) — those belong to the Qualifications section, not Training.

Do not rewrite titles. Just extract, filter, and reason.`;

function buildHuman(rawJd: string, rawCv: string): string {
  return (
    `Job Description (raw text):\n${rawJd}\n\n` +
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Extract all training items and filter by JD relevance.`
  );
}

export async function runTraining(
  rawJd: string,
  rawCv: string,
): Promise<TrainingSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawJd, rawCv)),
  ];
  return callStructured(llm, messages, TrainingSectionSchema);
}

/**
 * Convenience: split the section into kept vs dropped items. Used at render
 * time (kept goes into the CV) and for debug logging (dropped is shown so we
 * can see what the agent threw away).
 */
export function splitTraining(section: TrainingSection): {
  kept: TrainingItem[];
  dropped: TrainingItem[];
} {
  const kept: TrainingItem[] = [];
  const dropped: TrainingItem[] = [];
  for (const item of section.items) {
    (item.keep ? kept : dropped).push(item);
  }
  return { kept, dropped };
}
