import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { recordLlmUsage } from "@/lib/usage";

type ZodDefLike = {
  type?: string;
  innerType?: z.ZodTypeAny;
  values?: string[];
};

type ZodIntrospectable = z.ZodTypeAny & {
  _def?: ZodDefLike;
  shape?: Record<string, z.ZodTypeAny>;
  element?: z.ZodTypeAny;
  description?: string;
  options?: string[];
};

const DEFAULT_RPM_LIMIT = 6;
const DEFAULT_MAX_CONCURRENT = 1;

const rpmLimit = readPositiveInt("LLM_RPM_LIMIT", DEFAULT_RPM_LIMIT);
const maxConcurrent = readPositiveInt(
  "LLM_MAX_CONCURRENT_REQUESTS",
  DEFAULT_MAX_CONCURRENT,
);
const minStartGapMs = Math.ceil(60_000 / rpmLimit);

let activeCalls = 0;
let nextStartAt = 0;
const waitQueue: Array<() => void> = [];

/**
 * Provider-agnostic structured output.
 *
 * Why this exists instead of `llm.withStructuredOutput(schema)`:
 *   `withStructuredOutput` uses the OpenAI tool-calling or json_schema path.
 *   AIShop24H proxies non-OpenAI backends (Gemini, Claude) and those paths
 *   don't translate cleanly — the model replies with prose or fenced JSON,
 *   which the LangChain parser then chokes on.
 *
 * This helper is the same pattern as v3/models.py `structured()`: we tell
 * the model exactly what JSON shape we want in the prompt, strip any
 * markdown fences from its reply, and validate with Zod ourselves.
 *
 * Usage:
 *   const result = await callStructured(llm, "Write a summary of: ...", Schema);
 */
export async function callStructured<T extends z.ZodTypeAny>(
  llm: ChatOpenAI,
  prompt: string | BaseMessage[],
  schema: T,
): Promise<z.infer<T>> {
  // Build a tiny JSON-shape description from the Zod schema. We don't need
  // a full JSON-Schema converter — listing the field names + descriptions
  // is enough for the model to fit the shape, and it keeps the helper
  // dependency-free.
  const shape = describeZod(schema);

  const instructions =
    `You MUST respond with ONE valid JSON value using EXACTLY the field names ` +
    `shown below. Do not rename, translate, or pluralise field names. Do not ` +
    `add fields that are not listed. Field names are case-sensitive.\n\n` +
    `Required shape:\n${shape}\n\n` +
    `Fields shown as <type>[] are ALWAYS JSON arrays, even when there is ` +
    `only one element. Wrap a single element as [ {...} ]; never emit a bare ` +
    `object where an array is required. Empty arrays must be [], not null.\n\n` +
    `Return JSON only — no markdown code fences, no prose, no commentary, ` +
    `no leading or trailing text. The reply must start with '{' or '[' and ` +
    `end with the matching '}' or ']'.`;

  const messages =
    typeof prompt === "string"
      ? [new HumanMessage(prompt + "\n\n" + instructions)]
      : [...prompt, new HumanMessage(instructions)];

  const reply = await invokeWithRateLimitRetry(llm, messages);
  // LangChain attaches the provider's `usage` on response_metadata.tokenUsage
  // or usage_metadata (depends on provider). Try both.
  const rmd = (reply as { response_metadata?: { tokenUsage?: Record<string, number> } })
    .response_metadata?.tokenUsage;
  const umd = (reply as { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } })
    .usage_metadata;
  recordLlmUsage({
    prompt_tokens: rmd?.promptTokens ?? umd?.input_tokens ?? 0,
    completion_tokens: rmd?.completionTokens ?? umd?.output_tokens ?? 0,
    total_tokens: rmd?.totalTokens ?? umd?.total_tokens ?? 0,
  });
  const text = stripFences(String(reply.content));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `Model did not return valid JSON. First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  // First pass: try as-is.
  let result = schema.safeParse(parsed);
  if (!result.success) {
    // Last-mile coercion: small models occasionally emit a bare object where
    // an array-of-one is expected (e.g. `items: {…}` instead of `items: [{…}]`).
    // Walk the schema and wrap any such mismatches. If it still fails after
    // coercion, surface the original error.
    const coerced = coerceSingletonArrays(parsed, schema);
    result = schema.safeParse(coerced);
  }
  if (!result.success) {
    throw new Error(
      `Model returned JSON that doesn't match schema. ` +
        `Got: ${JSON.stringify(parsed).slice(0, 300)}. ` +
        `Errors: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * If a Zod field is declared as an array but the model returned a single
 * object, wrap it. Runs recursively into nested objects/arrays.
 */
function coerceSingletonArrays(value: unknown, schema: z.ZodTypeAny): unknown {
  const zodSchema = schema as ZodIntrospectable;
  const def = zodSchema._def;
  const kind: string | undefined = def?.type;

  if (kind === "object" && value !== null && typeof value === "object") {
    const shape = zodSchema.shape ?? {};
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(shape)) {
      out[key] = coerceSingletonArrays(
        (value as Record<string, unknown>)[key],
        child,
      );
    }
    // Keep any extra fields the model added; they will be stripped by
    // strict schemas or kept by passthrough schemas at the caller's choice.
    for (const k of Object.keys(value as Record<string, unknown>)) {
      if (!(k in out)) out[k] = (value as Record<string, unknown>)[k];
    }
    return out;
  }

  if (kind === "array") {
    const inner = zodSchema.element;
    if (!inner) return value;
    if (Array.isArray(value)) {
      return value.map((item) => coerceSingletonArrays(item, inner));
    }
    // Wrap singleton object as array-of-one.
    if (value !== null && typeof value === "object") {
      return [coerceSingletonArrays(value, inner)];
    }
    return value;
  }

  if (kind === "optional" || kind === "default" || kind === "nullable") {
    if (!def?.innerType) return value;
    return coerceSingletonArrays(value, def.innerType);
  }

  return value;
}

/**
 * Invoke the LLM, retrying with exponential backoff on rate-limit (429)
 * errors. AIShop24H caps free accounts at 7 requests/minute; running 8+
 * parallel chains regularly trips it. Retrying makes the graph tolerant.
 *
 * We only retry on 429 — any other error bubbles up immediately.
 */
async function invokeWithRateLimitRetry(
  llm: ChatOpenAI,
  messages: BaseMessage[],
): Promise<{
  content: string | unknown;
  response_metadata?: { tokenUsage?: Record<string, number> };
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}> {
  const delays = [10_000, 20_000, 40_000, 60_000, 60_000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const release = await acquireLlmSlot();
    try {
      return (await llm.invoke(messages)) as Awaited<
        ReturnType<typeof invokeWithRateLimitRetry>
      >;
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      // Inspect the error chain too — OpenAI SDK wraps the original cause
      // (e.g. ECONNRESET) inside a generic "Connection error." message.
      const causeMessages = collectCauseMessages(err);
      const haystack = [message, ...causeMessages].join(" | ");
      const isRateLimit = /429|rate.?limit/i.test(haystack);
      const isConnReset =
        /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|connection error|socket hang up/i.test(
          haystack,
        );
      const isRetryable = isRateLimit || isConnReset;
      if (!isRetryable || attempt === delays.length) throw err;
      const delay = delays[attempt];
      const reason = isRateLimit ? "429 rate-limited" : "connection error";
      console.warn(
        `[llm] ${reason}; retry ${attempt + 1}/${delays.length} in ${delay / 1000}s — ${message}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      release();
    }
  }
  throw lastErr;
}

async function acquireLlmSlot(): Promise<() => void> {
  while (activeCalls >= maxConcurrent) {
    await new Promise<void>((resolve) => waitQueue.push(resolve));
  }

  activeCalls += 1;

  const now = Date.now();
  const waitMs = Math.max(0, nextStartAt - now);
  nextStartAt = Math.max(now, nextStartAt) + minStartGapMs;

  if (waitMs > 0) {
    console.log(
      `[llm] throttling ${Math.ceil(waitMs / 1000)}s ` +
        `(rpm=${rpmLimit}, maxConcurrent=${maxConcurrent})`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeCalls = Math.max(0, activeCalls - 1);
    waitQueue.shift()?.();
  };
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function collectCauseMessages(err: unknown, depth = 0): string[] {
  if (depth > 5 || !err) return [];
  const out: string[] = [];
  const e = err as { cause?: unknown; message?: string };
  if (typeof e.message === "string") out.push(e.message);
  if (e.cause) out.push(...collectCauseMessages(e.cause, depth + 1));
  return out;
}

function stripFences(text: string): string {
  let out = text.trim();
  if (out.startsWith("```")) {
    const lines = out.split("\n");
    if (lines[0]?.trimStart().startsWith("```")) lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") lines.pop();
    out = lines.join("\n").trim();
  }
  return out;
}

/**
 * Walk a Zod schema and produce a human-readable shape description for the
 * prompt. Not a full JSON-Schema serialiser — just enough for the model to
 * understand the field names, types, and per-field descriptions.
 *
 * Written against Zod 4 internals: schemas expose `.shape`, `.element`, and
 * `.description` directly; `_def.type` carries the kind tag.
 */
function describeZod(schema: z.ZodTypeAny, indent = 0): string {
  const pad = "  ".repeat(indent);
  const zodSchema = schema as ZodIntrospectable;
  const kind: string | undefined = zodSchema._def?.type;

  if (kind === "object") {
    const shape = zodSchema.shape ?? {};
    const entries = Object.entries(shape);
    const lines = entries.map(([key, value]) => {
      const desc = (value as ZodIntrospectable).description;
      const type = describeZod(value, indent + 1);
      const descSuffix = desc ? `  // ${desc}` : "";
      return `${pad}  "${key}": ${type}${descSuffix}`;
    });
    return `{\n${lines.join(",\n")}\n${pad}}`;
  }
  if (kind === "string") return "string";
  if (kind === "number") return "number";
  if (kind === "boolean") return "boolean";
  if (kind === "array") {
    return `${describeZod(zodSchema.element ?? z.unknown(), indent)}[]`;
  }
  if (kind === "optional" || kind === "default" || kind === "nullable") {
    return describeZod(zodSchema._def?.innerType ?? z.unknown(), indent);
  }
  if (kind === "enum") {
    const values: string[] = zodSchema._def?.values ?? zodSchema.options ?? [];
    return values.map((v) => `"${v}"`).join(" | ");
  }
  return "any";
}
