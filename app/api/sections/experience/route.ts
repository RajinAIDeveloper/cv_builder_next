import { runExperience, runExperienceReflexive } from "@/lib/sections/experience";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  raw_jd: z.string().min(20),
  raw_cv: z.string().min(20),
  reflexion: z.boolean().optional(),
  max_revisions: z.number().int().min(0).max(5).optional(),
});

/**
 * POST /api/sections/experience
 * Body: { raw_jd, raw_cv }
 * Returns: { roles: [{ company, title, dates, location, bullets: [{text}] }] }
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.reflexion) {
      const { final, history, exitReason } = await runExperienceReflexive(
        parsed.data.raw_jd,
        parsed.data.raw_cv,
        { maxRevisions: parsed.data.max_revisions },
      );
      return Response.json({ ...final, _reflexion: { exitReason, history } });
    }

    const result = await runExperience(parsed.data.raw_jd, parsed.data.raw_cv);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
