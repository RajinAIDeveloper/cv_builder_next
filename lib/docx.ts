import type { CvBuilderStateType } from "@/lib/state";

/**
 * Shape passed to docxtemplater.render(). Every key here is referenced by a
 * tag in public/cv_template.v4.docx. See scripts/migrate-template.mjs for the
 * jinja→docxtemplater translation that produced those tags.
 *
 * Scope notes:
 *   - {#experience} iterates `experience` (an array of roles). Inside, {title},
 *     {company}, {dates}, {#bullets} resolve against the current role.
 *   - {#others_rows} iterates row pairs. {#left}/{#right} enter the sub-object
 *     and act as truthy guards. {left_items_joined}/{right_items_joined} live
 *     at the row level so they're visible from either sub-scope via scope-chain.
 */
export type RenderContext = {
  candidate_name_upper: string;

  hasSummary: boolean;
  summary_text: string;

  hasExperience: boolean;
  experience: {
    title: string;
    company: string;
    dates: string;
    bullets: { text: string }[];
  }[];

  hasEducation: boolean;
  education: {
    degree: string;
    institution: string;
    year: string;
    result: string;
  }[];

  hasTraining: boolean;
  training: {
    title: string;
    provider: string;
    year: string;
  }[];

  hasOthers: boolean;
  others_rows: {
    left: { title: string } | false;
    right: { title: string } | false;
    left_items_joined: string;
    right_items_joined: string;
  }[];

  hasReferences: boolean;
  references: {
    name: string;
    designation: string;
    company: string;
    mobile: string;
    email: string;
  }[];

  has_photo: false;
  not_last: false;
};

/**
 * Build the docxtemplater render context from the agent's final state.
 *
 * Everything the template needs is precomputed here: uppercased name, joined
 * items lists, paired others_rows, training filtered to kept items, and
 * truthy section flags. The template never does any logic of its own.
 */
export function buildRenderContext(state: CvBuilderStateType): RenderContext {
  const candidateName = state.candidate?.name ?? "";

  const summaryText = state.summary?.summary ?? "";
  const roles = state.experience?.roles ?? [];
  const education = state.education ?? [];
  const trainingKept = (state.training?.items ?? []).filter((i) => i.keep);
  const othersGroups = state.others?.groups ?? [];
  const refs = state.references?.references ?? [];

  return {
    candidate_name_upper: candidateName.toUpperCase(),

    hasSummary: summaryText.length > 0,
    summary_text: summaryText,

    hasExperience: roles.length > 0,
    experience: roles.map((r) => ({
      title: r.title,
      company: r.company,
      dates: r.dates,
      bullets: r.bullets.map((b) => ({ text: b.text })),
    })),

    hasEducation: education.length > 0,
    education: education.map((e) => ({
      degree: e.degree,
      institution: e.institution,
      year: e.year,
      result: e.result,
    })),

    hasTraining: trainingKept.length > 0,
    training: trainingKept.map((t) => ({
      title: t.title,
      provider: t.provider,
      year: t.year,
    })),

    hasOthers: othersGroups.length > 0,
    others_rows: pairOthers(othersGroups),

    hasReferences: refs.length > 0,
    references: refs.map((r) => ({
      name: r.name,
      designation: r.designation,
      company: r.company,
      mobile: r.mobile,
      email: r.email,
    })),

    // Always-false flags. The template still has `{#has_photo}…{/}` and
    // `{#not_last}…{/}` markers left over from the docxtpl original; rendering
    // them as falsy sections collapses them to nothing.
    has_photo: false,
    not_last: false,
  };
}

/**
 * Pair the Others groups into 2-column rows, matching the docxtpl layout
 * where `others_rows` was a list of (left, right) tuples rendered into a
 * 2-column table.
 *
 * Odd group count → the trailing right cell is rendered as falsy so the
 * `{#right}…{/}` section collapses to nothing.
 */
function pairOthers(
  groups: { title: string; items: string[] }[],
): RenderContext["others_rows"] {
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
