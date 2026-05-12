import { ChatOpenAI } from "@langchain/openai";

/**
 * Build a ready-to-call chat model.
 *
 * Why a factory and not a top-level `const llm = new ChatOpenAI(...)`:
 * - Reading process.env at import time can break in some build modes.
 * - Different roles (writer / critic / cheap) may want different models later.
 * - Tests can call this with overrides without re-importing the module.
 *
 * AIShop24H is OpenAI-compatible — same request/response shape as OpenAI's
 * own API — so we use the OpenAI client and just point it at a different URL.
 */

export function makeLlm(opts: { model?: string } = {}) {
  const apiKey = process.env.AISHOP24H_API_KEY;
  const baseURL = process.env.AISHOP24H_BASE_URL ?? "https://aishop24h.com/v1";
  const model = opts.model ?? process.env.MODEL_NAME ?? "google/gemini-3-flash-preview";

  if (!apiKey) {
    throw new Error(
      "AISHOP24H_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }

  return new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL },
    // 20k-char CVs cause the experience-critic to emit a long `notes[]`
    // array; default output caps (often 1-2k tokens) truncate it mid-JSON
    // and JSON.parse blows up downstream. 8192 covers worst-case critic
    // output without being wasteful.
    maxTokens: 8192,
    // 90s wasn't enough on long-input critic calls. 3 minutes gives the
    // model headroom before the request is killed.
    timeout: 180_000,
    maxRetries: 1,
  });
}
