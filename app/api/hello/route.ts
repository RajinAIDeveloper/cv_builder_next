// app/api/hello/route.ts
import { makeLlm } from "@/lib/llm";

// LangGraph + LangChain pull in Node-only modules (fs, crypto, etc.) so this
// route MUST run on the Node runtime, not the Edge runtime.
export const runtime = "nodejs";

// Don't cache — every call should hit the model fresh.
export const dynamic = "force-dynamic";

/**
 * GET /api/hello?q=your+question
 *
 * Sends `q` to the AI and returns the answer as JSON.
 *
 * Try it in the browser once `pnpm dev` is running:
 *   http://localhost:3000/api/hello?q=what is a CV
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const question = searchParams.get("q")?.trim();

  if (!question) {
    return Response.json(
      { error: "Pass a question via ?q=...", example: "/api/hello?q=hi" },
      { status: 400 },
    );
  }

  try {
    const llm = makeLlm();
    const reply = await llm.invoke(question);

    return Response.json({
      question,
      answer: reply.content,
      model: llm.model,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
