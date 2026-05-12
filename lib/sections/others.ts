import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import { OthersSectionSchema, type OthersSection } from "@/lib/schemas";

/**
 * "Others" chain. Ported from v3/others.py.
 *
 * The flexible bucket: extracts every titled subsection of the CV that is
 * NOT one of the six handled-elsewhere sections (header, summary,
 * experience, education, training, references). Computer Skills, Languages,
 * Personal Details, Hobbies, Memberships, Awards — anything.
 *
 * This is what makes the agent work on Bangladesh-style CVs that include
 * arbitrary extras like Father's Name, NID, Religion, Marital Status.
 *
 * Pure extraction — preserves the CV's wording, no JD awareness.
 */

const SYSTEM = `You are a CV miscellaneous-section extractor. Faithful extraction only — no invention.

WHAT TO EXTRACT:
Every titled subsection in the CV that is NOT one of these (those are handled elsewhere):
  - Experience / Work History / Professional Experience / Career History
  - Education / Academic Qualifications / Educational Background
  - Training / Courses / Workshops / Certifications
  - References / Referees
  - Career Summary / Profile / Objective / About Me
  - The candidate's name, address, phone, email header block

INCLUDE (typical examples):
  - Computer Skills / Technical Skills / IT Skills / Software Proficiency
  - Languages / Language Proficiency
  - Personal Details / Personal Information (DOB, NID, marital status,
    nationality, father's name, etc.)
  - Hobbies / Interests
  - Strengths / Key Strengths / Core Competencies
  - Memberships / Professional Memberships / Affiliations
  - Awards / Honours / Achievements
  - Publications / Research
  - Volunteer Work / Community Involvement
  - ANY other titled block that is not in the exclude list above.

RULES:
1. Use the CV's exact section title as \`title\`. Do NOT translate or normalize
   ("Computer Knowledge" stays "Computer Knowledge", not "Computer Skills").
2. Each line / bullet under that title becomes one \`items\` entry, verbatim.
3. For Personal Details, keep each "Label: value" pair as one item.
4. If a section is split across pages or repeated, merge into one group, dedupe.
5. Never invent sections, items, or content. If the CV has no such sections,
   return an empty list.
6. Order groups in the order they appear in the CV.`;

function buildHuman(rawCv: string): string {
  return (
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Extract all miscellaneous titled subsections.`
  );
}

export async function runOthers(rawCv: string): Promise<OthersSection> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawCv)),
  ];
  return callStructured(llm, messages, OthersSectionSchema);
}
