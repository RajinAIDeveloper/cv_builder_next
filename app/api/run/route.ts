import { buildGraph } from "@/lib/graph";
import {
  graphToUiNodeId,
  stateKeysToSectionIds,
} from "@/lib/workflow";
import { validateCvAndJdInputs } from "@/lib/input-validation";
import { withUsageTracking, type UsageSnapshot } from "@/lib/usage";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  raw_jd: z.string().min(20),
  raw_cv: z.string().min(20),
});

const GRAPH_MAX_CONCURRENCY = readPositiveInt("GRAPH_MAX_CONCURRENCY", 2);
const SSE_HEARTBEAT_MS = readPositiveInt("SSE_HEARTBEAT_MS", 15_000);

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
  const validation = validateCvAndJdInputs(parsed.data.raw_cv, parsed.data.raw_jd);
  if (!validation.ok) {
    return Response.json({ error: validation.message }, { status: 400 });
  }

  const stream = iteratorToStream(makeGraphIterator(parsed.data));
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function iteratorToStream(
  iterator: AsyncIterator<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
}

/**
 * SSE iterator.
 *
 * Design: the entire graph iteration runs inside `withUsageTracking(...)`
 * (so AsyncLocalStorage propagates to every LLM call), and pushes SSE
 * frames into a queue. This outer generator drains the queue with a
 * promise-based wait — no polling. The END sentinel terminates iteration.
 */
async function* makeGraphIterator(input: { raw_jd: string; raw_cv: string }) {
  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // 2KB comment prologue — some browsers buffer the first ~2KB before
  // exposing chunks to fetch's reader.
  yield encoder.encode(`: ${" ".repeat(2048)}\n\n`);
  yield frame("ready", { at: Date.now() });

  const END = Symbol("end");
  const queue: (Uint8Array | typeof END)[] = [];
  let wake: (() => void) | null = null;
  const signal = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const wait = () => new Promise<void>((resolve) => (wake = resolve));

  const model = process.env.MODEL_NAME ?? "anthropic/claude-haiku-4.5";

  // Kick off the graph in the background. Do NOT await here — we want the
  // pump loop below to start draining frames as soon as the first one is
  // queued. Errors are funneled into the queue as `error` frames.
  void withUsageTracking(
    model,
    (snap: UsageSnapshot) => {
      queue.push(frame("usage", snap));
      signal();
    },
    async () => {
      const startedAt = Date.now();
      let lastNodeEndAt = startedAt;
      console.log(
        `[graph] start  rawJd=${input.raw_jd.length}ch  rawCv=${input.raw_cv.length}ch  model=${model}`,
      );
      try {
        const graph = buildGraph();
        const events = await graph.stream(
          { rawJd: input.raw_jd, rawCv: input.raw_cv },
          { streamMode: "updates", maxConcurrency: GRAPH_MAX_CONCURRENCY },
        );
        const final: Record<string, unknown> = {};
        for await (const chunk of events) {
          for (const [node, patch] of Object.entries(
            chunk as Record<string, Record<string, unknown>>,
          )) {
            const now = Date.now();
            const since = ((now - lastNodeEndAt) / 1000).toFixed(1);
            const total = ((now - startedAt) / 1000).toFixed(1);
            console.log(
              `[graph] +${since}s  total=${total}s  ${node} done` +
                `  → keys=${Object.keys(patch).join(",")}`,
            );
            lastNodeEndAt = now;
            queue.push(
              frame("node-end", {
                node,
                uiNode: graphToUiNodeId(node),
                sections: stateKeysToSectionIds(Object.keys(patch)),
                patch,
              }),
            );
            Object.assign(final, patch);
            signal();
          }
        }
        console.log(
          `[graph] done   total=${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
        queue.push(frame("done", { final }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[graph] error:", err);
        queue.push(frame("error", { message }));
      } finally {
        queue.push(END);
        signal();
      }
    },
  );

  // Drain pump.
  while (true) {
    if (queue.length === 0) {
      await Promise.race([
        wait(),
        new Promise<void>((resolve) => setTimeout(resolve, SSE_HEARTBEAT_MS)),
      ]);
      if (queue.length === 0) {
        yield encoder.encode(`: heartbeat ${Date.now()}\n\n`);
      }
      continue;
    }
    const item = queue.shift()!;
    if (item === END) break;
    yield item;
  }
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
