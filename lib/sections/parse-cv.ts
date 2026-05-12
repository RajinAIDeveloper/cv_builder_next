import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import { CandidateSchema, type Candidate } from "@/lib/schemas";

/**
 * CV header parser. Adapted from v3/cv_parser.py.
 *
 * Extracts ONLY the candidate header block (name, location, phone, email).
 * The full v3 parser also did education, but in v4 education has its own
 * section chain with deterministic ordering. So we split.
 *
 * Skip: experience, education, training, references, qualifications,
 * personal details, languages, hobbies — those are handled by other lanes.
 */

const SYSTEM = `You are a CV header extractor. Faithful extraction only — no invention.

Rules:
1. Extract ONLY the candidate header: name, location, phone, email.
2. Preserve the CV's wording. Do not normalize, translate, or "clean up".
3. If a field is missing in the CV, leave it as an empty string.
4. Do NOT extract experience, education, training, references, qualifications,
   personal details, languages, hobbies, or any other section — those are
   handled by separate extractors.`;

function buildHuman(rawCv: string): string {
  return (
    `Candidate CV (raw text):\n${rawCv}\n\n` +
    `Extract the candidate header only (name, location, phone, email).`
  );
}

export async function runParseCv(rawCv: string): Promise<Candidate> {
  const llm = makeLlm();
  const messages = [
    new SystemMessage(SYSTEM),
    new HumanMessage(buildHuman(rawCv)),
  ];
  return callStructured(llm, messages, CandidateSchema);
}
