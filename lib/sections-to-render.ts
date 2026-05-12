import type { RenderContext } from "@/lib/docx";
import type { SectionResult } from "@/lib/workflow";

/**
 * Build a docxtemplater RenderContext from the user-edited section cards.
 *
 * Each section card stores its content as the same flat-text lines that
 * renderSectionContent() in ui-format.ts produced from the agent state.
 * We parse those lines back into the structured shapes the template expects.
 *
 * This is called immediately before download so edits are always captured.
 */
export function sectionsToRenderContext(
  sections: SectionResult[],
  candidateName: string,
): RenderContext {
  const get = (id: string) =>
    sections.find((s) => s.id === id)?.content ?? [];

  const summaryText = get("summary")
    .filter((l) => l.trim())
    .join(" ");

  const roles = parseExperience(get("experience"));
  const education = parseEducation(get("education").filter((l) => l.trim()));
  const training = parseTraining(get("training").filter((l) => l.trim()));
  const othersGroups = parseOthers(get("others"));
  const references = parseReferences(get("references").filter((l) => l.trim()));

  return {
    candidate_name_upper: candidateName.toUpperCase(),

    hasSummary: summaryText.length > 0,
    summary_text: summaryText,

    hasExperience: roles.length > 0,
    experience: roles,

    hasEducation: education.length > 0,
    education,

    hasTraining: training.length > 0,
    training,

    hasOthers: othersGroups.length > 0,
    others_rows: pairOthers(othersGroups),

    hasReferences: references.length > 0,
    references,

    has_photo: false,
    not_last: false,
  };
}

// ---------------------------------------------------------------------------
// Per-section parsers — each mirrors the format emitted by renderSectionContent
// ---------------------------------------------------------------------------

type Role = RenderContext["experience"][number];

/**
 * Experience lines:
 *   "Title — Company (Dates)"   → role header
 *   "  • bullet text"           → bullet for current role
 */
function parseExperience(lines: string[]): Role[] {
  const roles: Role[] = [];
  let current: Role | null = null;

  for (const raw of lines) {
    if (!raw.trim()) continue;

    const isBullet = /^\s+/.test(raw) || raw.trimStart().startsWith("•");
    if (isBullet && current) {
      const text = raw.replace(/^[\s•]+/, "").trim();
      if (text) current.bullets.push({ text });
      continue;
    }

    // Role header
    const m = raw.match(/^(.+?)\s+[—–-]+\s+(.+?)\s+\((.+?)\)\s*$/);
    current = m
      ? { title: m[1].trim(), company: m[2].trim(), dates: m[3].trim(), bullets: [] }
      : { title: raw.trim(), company: "", dates: "", bullets: [] };
    roles.push(current);
  }

  return roles;
}

type EducationEntry = RenderContext["education"][number];

/** "Degree, Institution (Year)" or "Degree, Institution" */
function parseEducation(lines: string[]): EducationEntry[] {
  return lines.map((l) => {
    const withYear = l.match(/^(.+?),\s*(.+?)\s+\((.+?)\)\s*$/);
    if (withYear) {
      return { degree: withYear[1].trim(), institution: withYear[2].trim(), year: withYear[3].trim(), result: "" };
    }
    const comma = l.indexOf(",");
    if (comma !== -1) {
      return { degree: l.slice(0, comma).trim(), institution: l.slice(comma + 1).trim(), year: "", result: "" };
    }
    return { degree: l.trim(), institution: "", year: "", result: "" };
  });
}

type TrainingEntry = RenderContext["training"][number];

/** "Title (Year)" or "Title" */
function parseTraining(lines: string[]): TrainingEntry[] {
  return lines.map((l) => {
    const m = l.match(/^(.+?)\s+\((\d{4})\)\s*$/);
    return m
      ? { title: m[1].trim(), provider: "", year: m[2] }
      : { title: l.trim(), provider: "", year: "" };
  });
}

type OthersGroup = { title: string; items: string[] };

/**
 * Others lines:
 *   "# Group Title"   → new group
 *   "  item"          → item for current group
 */
function parseOthers(lines: string[]): OthersGroup[] {
  const groups: OthersGroup[] = [];
  let current: OthersGroup | null = null;
  for (const raw of lines) {
    if (raw.trimStart().startsWith("#")) {
      current = { title: raw.replace(/^#+\s*/, "").trim(), items: [] };
      groups.push(current);
    } else if (raw.trim() && current) {
      current.items.push(raw.trim());
    }
  }
  return groups;
}

type ReferenceEntry = RenderContext["references"][number];

/** "Name | Designation | Company | Mobile | Email" */
function parseReferences(lines: string[]): ReferenceEntry[] {
  return lines.map((l) => {
    const [name = "", designation = "", company = "", mobile = "", email = ""] =
      l.split("|").map((s) => s.trim());
    return { name, designation, company, mobile, email };
  });
}

function pairOthers(groups: OthersGroup[]): RenderContext["others_rows"] {
  const rows: RenderContext["others_rows"] = [];
  for (let i = 0; i < groups.length; i += 2) {
    const left = groups[i];
    const right = groups[i + 1];
    rows.push({
      left: { title: left.title },
      right: right ? { title: right.title } : false,
      left_items_joined: left.items.join(", "),
      right_items_joined: right ? right.items.join(", ") : "",
    });
  }
  return rows;
}
