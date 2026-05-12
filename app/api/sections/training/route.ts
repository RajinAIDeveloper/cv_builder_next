import { runTraining, splitTraining } from "@/lib/sections/training";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  raw_jd: z.string().min(20),
  raw_cv: z.string().min(20),
});

/**
 * POST /api/sections/training
 * Body: { raw_jd, raw_cv }
 * Returns: { items, kept, dropped }
 *   items   — every training item with keep/reason flags
 *   kept    — only the items where keep=true (what gets rendered)
 *   dropped — only the items where keep=false (logged for debugging)
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
    const section = await runTraining(parsed.data.raw_jd, parsed.data.raw_cv);
    const { kept, dropped } = splitTraining(section);
    return Response.json({ items: section.items, kept, dropped });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
