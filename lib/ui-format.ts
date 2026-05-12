import type { MemorySnapshot, CvSectionId } from "@/lib/workflow";

/**
 * Translate one piece of an agent state patch into the strings/lists the
 * MemoryPanel knows how to render. The agent's state has rich objects
 * (JobDescription, ExperienceSection, etc.); the panel was scaffolded
 * around strings.
 *
 * Anything the patch didn't touch is left as-is by the caller (this fn
 * only returns the keys it knows how to translate).
 */
export function applyPatchToMemory(
  current: MemorySnapshot,
  patch: Record<string, unknown>,
): MemorySnapshot {
  const next: MemorySnapshot = { ...current };

  if (patch.jd && typeof patch.jd === "object") {
    const jd = patch.jd as {
      title: string;
      seniority: string;
      domain: string;
      must_have_skills: string[];
    };
    next.jd =
      `${jd.title} | seniority: ${jd.seniority} | domain: ${jd.domain}` +
      ` | must-haves: ${jd.must_have_skills.slice(0, 3).join(", ")}…`;
  }

  if (patch.candidate && typeof patch.candidate === "object") {
    const c = patch.candidate as {
      name: string;
      email: string;
      phone: string;
    };
    next.candidate = `${c.name} | ${c.email} | ${c.phone}`;
  }

  if (patch.summary && typeof patch.summary === "object") {
    const s = patch.summary as { summary: string };
    next.summary = s.summary;
  }

  if (patch.experience && typeof patch.experience === "object") {
    const e = patch.experience as { roles: { company: string; title: string }[] };
    next.experience = e.roles.map((r) => `${r.title} — ${r.company}`);
  }

  if (Array.isArray(patch.education)) {
    const entries = patch.education as { degree: string; year: string }[];
    next.education = entries.map((x) => `${x.degree} (${x.year})`);
  }

  if (patch.training && typeof patch.training === "object") {
    const t = patch.training as { items: { title: string; keep: boolean }[] };
    next.training = t.items.map(
      (i) => `${i.keep ? "✓" : "✗"} ${i.title}`,
    );
  }

  if (patch.others && typeof patch.others === "object") {
    const o = patch.others as { groups: { title: string; items: string[] }[] };
    next.others = o.groups.map((g) => `${g.title} (${g.items.length})`);
  }

  if (patch.references && typeof patch.references === "object") {
    const r = patch.references as {
      references: { name: string; designation: string }[];
    };
    next.references = r.references.map(
      (x) => `${x.name} — ${x.designation}`,
    );
  }

  if (Array.isArray(patch.critiques)) {
    const adds = patch.critiques as {
      lane: string;
      iteration: number;
      pass: boolean;
      notes: string[];
    }[];
    const formatted = adds.map(
      (c) =>
        `[${c.lane} #${c.iteration}] ${c.pass ? "PASS" : `${c.notes.length} issue(s)`}`,
    );
    next.critiques = [...current.critiques, ...formatted];
  }

  return next;
}

/**
 * Given a section ID + a patch, return the lines the SectionsGrid card
 * should display.
 */
export function renderSectionContent(
  sectionId: CvSectionId,
  patch: Record<string, unknown>,
): string[] | null {
  switch (sectionId) {
    case "summary": {
      const s = patch.summary as { summary?: string } | undefined;
      return s?.summary ? [s.summary] : null;
    }
    case "experience": {
      const e = patch.experience as
        | { roles: { company: string; title: string; dates: string; bullets: { text: string }[] }[] }
        | undefined;
      if (!e) return null;
      if (e.roles.length === 0) return ["No experience roles found in the CV input."];
      const lines: string[] = [];
      for (const r of e.roles) {
        lines.push(`${r.title} — ${r.company} (${r.dates})`);
        for (const b of r.bullets) lines.push(`  • ${b.text}`);
      }
      return lines;
    }
    case "education": {
      const arr = patch.education as
        | { degree: string; institution: string; year: string }[]
        | undefined;
      if (!arr) return null;
      if (arr.length === 0) return ["No education entries found in the CV input."];
      return arr.map((x) => `${x.degree}, ${x.institution} (${x.year})`);
    }
    case "training": {
      const t = patch.training as
        | { items: { title: string; year: string; keep: boolean }[] }
        | undefined;
      if (!t) return null;
      if (t.items.length === 0) return ["No training items found in the CV input."];
      const kept = t.items
        .filter((i) => i.keep)
        .map((i) => `${i.title}${i.year ? ` (${i.year})` : ""}`);
      return kept.length > 0 ? kept : ["No JD-relevant training items were kept."];
    }
    case "others": {
      const o = patch.others as
        | { groups: { title: string; items: string[] }[] }
        | undefined;
      if (!o) return null;
      const lines: string[] = [];
      for (const g of o.groups) {
        lines.push(`# ${g.title}`);
        for (const item of g.items) lines.push(`  ${item}`);
      }
      return lines;
    }
    case "references": {
      const r = patch.references as
        | { references: { name: string; designation: string; company: string; mobile: string; email: string }[] }
        | undefined;
      if (!r) return null;
      if (r.references.length === 0) return ["No references found in the CV input."];
      return r.references.map(
        (x) =>
          `${x.name} | ${x.designation} | ${x.company} | ${x.mobile} | ${x.email}`,
      );
    }
  }
}
