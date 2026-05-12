import { runEducation } from "@/lib/sections/education";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ raw_cv: z.string().min(20) });

/**
 * POST /api/sections/education
 * Body: { raw_cv: string }
 * Returns: { entries: EducationEntry[] } — already sorted (pro first, then
 * school; both reverse-chrono within their group).
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
    const result = await runEducation(parsed.data.raw_cv);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
