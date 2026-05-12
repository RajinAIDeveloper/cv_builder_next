import { makeLlm } from "@/lib/llm";
import { CareerSummarySchema } from "@/lib/schemas";
import { callStructured } from "@/lib/structured";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/hello-structured?cv=<short-cv-text>
 *
 * Demonstrates structured output: instead of prose, the AI returns a typed
 * object that matches CareerSummarySchema. Try:
 *   /api/hello-structured?cv=10 years as nurse manager at City Hospital, MPH 2020
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cv = searchParams.get("cv")?.trim();

  if (!cv) {
    return Response.json(
      {
        error: "Pass some CV text via ?cv=...",
        example: "/api/hello-structured?cv=10 years as nurse manager, MPH 2020",
      },
      { status: 400 },
    );
  }

  try {
    // The magic line. withStructuredOutput(schema) wraps the model so its
    // raw JSON output is parsed and validated against our Zod schema before
    // it ever reaches us. If the AI returns garbage, we get a clean error
    // here instead of half-broken downstream code.
    const llm = makeLlm();
    const result = await callStructured(
      llm,
      `Write a career summary for this candidate:\n\n${cv}`,
      CareerSummarySchema,
    );

    // `result` is now typed as CareerSummary — TypeScript knows it has a
    // `summary: string` field. No casting, no JSON.parse, no surgery.
    return Response.json({
      input: cv,
      structured: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
