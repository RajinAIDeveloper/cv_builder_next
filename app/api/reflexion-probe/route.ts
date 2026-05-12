import { reflexionLoop } from "@/lib/reflexion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reflexion-probe
 *
 * Sanity-tests the reflexion helper with NO LLM calls. The critic and
 * reviser are pure functions. We're proving the loop logic itself works
 * before wiring real chains in Step 2.
 *
 * The "task" is: keep adding 1 to a number until it reaches 3.
 */
export async function GET() {
  // Scenario A: passes after 2 revisions
  const a = await reflexionLoop<{ n: number }>({
    draft: { n: 1 },
    critic: async (d) => ({
      pass: d.n >= 3,
      notes: d.n >= 3 ? [] : [`n is ${d.n}, need it >= 3`],
    }),
    reviser: async (d) => ({ n: d.n + 1 }),
    maxRevisions: 5,
  });

  // Scenario B: hits the revision cap
  const b = await reflexionLoop<{ n: number }>({
    draft: { n: 0 },
    critic: async (d) => ({
      pass: d.n >= 100,
      notes: [`n is ${d.n}, need it >= 100`],
    }),
    reviser: async (d) => ({ n: d.n + 1 }),
    maxRevisions: 2,
  });

  // Scenario C: critic says fail but has no notes → exit "no-notes"
  const c = await reflexionLoop<{ n: number }>({
    draft: { n: 0 },
    critic: async () => ({ pass: false, notes: [] }),
    reviser: async (d) => ({ n: d.n + 1 }),
    maxRevisions: 3,
  });

  return Response.json({
    passes_after_revisions: {
      final: a.final,
      exitReason: a.exitReason,
      iterations: a.history.length,
    },
    hits_revision_cap: {
      final: b.final,
      exitReason: b.exitReason,
      iterations: b.history.length,
    },
    no_notes_exit: {
      final: c.final,
      exitReason: c.exitReason,
      iterations: c.history.length,
    },
  });
}
