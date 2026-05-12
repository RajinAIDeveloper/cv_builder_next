import type { Critique } from "@/lib/schemas";

/**
 * Generic critic-reviser loop.
 *
 * The loop is content-agnostic: it doesn't know whether `draft` is a
 * summary paragraph, an experience section, or a reference list. It just
 * calls the critic and reviser you hand it. That's why the same helper
 * works for every reflexion-loop lane in Phase 5's graph.
 *
 * Termination — the loop exits when ANY of these is true:
 *   1. critic returns pass=true
 *   2. critic returns pass=false with an empty notes list (nothing to fix)
 *   3. we hit maxRevisions
 *
 * History is returned for two reasons:
 *   - The UI's memory panel will show "first draft / critic verdict /
 *     reviser output" as the loop progresses.
 *   - If the final critic still says pass=false, you can inspect why.
 */

export type ReflexionStep<T> = {
  draft: T;
  verdict: Critique;
};

export type ReflexionResult<T> = {
  final: T;
  history: ReflexionStep<T>[];
  exitReason: "passed" | "no-notes" | "max-revisions";
};

export type ReflexionOptions<T> = {
  /** The first version, produced by the section's main chain. */
  draft: T;
  /** Grades a draft. Returns { pass, notes }. */
  critic: (draft: T) => Promise<Critique>;
  /** Takes a draft + critic notes, returns a patched draft. */
  reviser: (draft: T, notes: string[]) => Promise<T>;
  /**
   * Maximum number of revisions. Default 2 — enough to fix most issues
   * without burning tokens. The critic still runs once more after the last
   * revision so the caller knows whether it finally passed.
   */
  maxRevisions?: number;
};

export async function reflexionLoop<T>(
  opts: ReflexionOptions<T>,
): Promise<ReflexionResult<T>> {
  const maxRevisions = opts.maxRevisions ?? 2;
  const history: ReflexionStep<T>[] = [];
  let draft = opts.draft;

  for (let i = 0; i <= maxRevisions; i++) {
    const verdict = await opts.critic(draft);
    history.push({ draft, verdict });

    if (verdict.pass) {
      return { final: draft, history, exitReason: "passed" };
    }
    if (verdict.notes.length === 0) {
      return { final: draft, history, exitReason: "no-notes" };
    }
    if (i === maxRevisions) {
      // Last critique was negative AND we're out of revisions — return
      // the most recent draft anyway. The caller decides what to do.
      return { final: draft, history, exitReason: "max-revisions" };
    }

    draft = await opts.reviser(draft, verdict.notes);
  }

  // Unreachable: the for-loop always returns. Satisfies TS.
  return { final: draft, history, exitReason: "max-revisions" };
}
