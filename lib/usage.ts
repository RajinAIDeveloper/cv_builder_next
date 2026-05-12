import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request token accounting.
 *
 * Why AsyncLocalStorage and not a parameter:
 *   Every LLM call funnels through `callStructured` in lib/structured.ts.
 *   Threading an accumulator parameter through every section/critic/reviser
 *   would touch ~14 files. ALS gives us a request-scoped "ambient" sink
 *   that callStructured writes to without anyone in between having to know.
 *
 * Lifecycle:
 *   The /api/run route wraps the graph invocation in `withUsageTracking(...)`.
 *   Each LLM call adds its `usage` to the active accumulator. The route
 *   reads the running totals after each node-end and emits a `usage` SSE
 *   event so the UI can update live.
 */

export type UsageSnapshot = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** USD, calculated from the active model's pricing table. */
  cost_usd: number;
  /** How many LLM calls have been made so far this run. */
  calls: number;
};

type UsageAccumulator = {
  snapshot: UsageSnapshot;
  /** Cents-per-token of the active model: input + output. */
  pricing: { in_per_mtok: number; out_per_mtok: number };
  /** Optional listener fired after every add — used by the route to push SSE. */
  onUpdate?: (snapshot: UsageSnapshot) => void;
};

const storage = new AsyncLocalStorage<UsageAccumulator>();

/**
 * Pricing per million tokens (USD). Add models here as they're enabled.
 * Source: Anthropic + Google public pricing pages. Update when models change.
 */
const PRICING: Record<string, { in_per_mtok: number; out_per_mtok: number }> = {
  "anthropic/claude-haiku-4.5": { in_per_mtok: 1, out_per_mtok: 5 },
  "anthropic/claude-sonnet-4.5": { in_per_mtok: 3, out_per_mtok: 15 },
  "anthropic/claude-sonnet-4.6": { in_per_mtok: 3, out_per_mtok: 15 },
  "anthropic/claude-opus-4.5-thinking": { in_per_mtok: 15, out_per_mtok: 75 },
  "anthropic/claude-opus-4.6": { in_per_mtok: 15, out_per_mtok: 75 },
  "google/gemini-3-flash-preview": { in_per_mtok: 0.5, out_per_mtok: 3 },
  "google/gemini-3-pro-preview": { in_per_mtok: 1.25, out_per_mtok: 10 },
  "google/gemini-3.1-pro-preview": { in_per_mtok: 1.25, out_per_mtok: 10 },
};

function pricingFor(model: string) {
  return PRICING[model] ?? { in_per_mtok: 1, out_per_mtok: 5 };
}

/**
 * Run `fn` inside a usage-tracking scope. Returns whatever fn returns.
 * The accumulator is reachable from anywhere within fn (including async
 * descendants) via `recordLlmUsage`.
 */
export async function withUsageTracking<T>(
  model: string,
  onUpdate: ((s: UsageSnapshot) => void) | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const acc: UsageAccumulator = {
    snapshot: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      calls: 0,
    },
    pricing: pricingFor(model),
    onUpdate,
  };
  return storage.run(acc, fn);
}

/**
 * Add one LLM call's usage to the active accumulator. Safe to call even
 * when no accumulator is active (no-op) — useful for tests/standalone runs.
 */
export function recordLlmUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): void {
  const acc = storage.getStore();
  if (!acc) return;
  const pin = usage.prompt_tokens ?? 0;
  const pout = usage.completion_tokens ?? 0;
  acc.snapshot.prompt_tokens += pin;
  acc.snapshot.completion_tokens += pout;
  acc.snapshot.total_tokens += usage.total_tokens ?? pin + pout;
  acc.snapshot.cost_usd +=
    (pin / 1_000_000) * acc.pricing.in_per_mtok +
    (pout / 1_000_000) * acc.pricing.out_per_mtok;
  acc.snapshot.calls += 1;
  acc.onUpdate?.({ ...acc.snapshot });
}

/** Read the current snapshot without mutating. Returns null outside a scope. */
export function readUsageSnapshot(): UsageSnapshot | null {
  const acc = storage.getStore();
  return acc ? { ...acc.snapshot } : null;
}
