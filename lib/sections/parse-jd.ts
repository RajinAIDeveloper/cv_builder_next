import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import { JobDescriptionSchema, type JobDescription } from "@/lib/schemas";

/**
 * JD parser. Ported from v3/jd_parser.py.
 * Turns raw JD text into structured JobDescription signals.
 */

const SYSTEM = `You are a job description analyzer.

Rules:
1. No invention. Use only facts present in the JD. If a field is not stated,
   leave list fields empty and use "unspecified" for seniority.
2. Preserve the JD's wording for skills. "React.js" stays "React.js".
3. Distinguish must-have from nice-to-have using the JD's own signal words
   ("required" / "must have" vs "preferred" / "nice to have" / "bonus").`;

function buildHuman(rawJd: string): string {
  return `Job Description (raw text):\n${rawJd}\n\nExtract all fields.`;
}

export async function runParseJd(rawJd: string): Promise<JobDescription> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawJd)),
  ];
  return callStructured(llm, messages, JobDescriptionSchema);
}
