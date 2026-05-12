import { makeLlm } from "@/lib/llm";
import { callStructured } from "@/lib/structured";
import {
  CareerSummarySchema,
  ExperienceSectionSchema,
  TrainingSectionSchema,
  ReferenceSectionSchema,
  OthersSectionSchema,
  EducationEntrySchema,
  JobDescriptionSchema,
  CritiqueSchema,
} from "@/lib/schemas";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/schema-test?name=<schema-name>
 *
 * Smoke-tests every schema with a tiny canned input. The point isn't quality
 * of output — it's proving each schema round-trips: prompt -> JSON -> Zod
 * -> typed object. If even ExperienceSection (3 levels deep) works, the
 * pattern is solid.
 *
 * Available names: summary, experience, training, references, others,
 * education, jd, critique, all
 */
const TINY_CV =
  "Md. Karim. 8 years as IT Officer at Square Hospital, Dhaka. " +
  "MSc in CSE (Dhaka University, 2018). HSC 2010. " +
  "Trained: AWS Cloud Practitioner (2022), Power BI Workshop (2023), " +
  "First Aid (2015). " +
  "References: Dr. Rahim Ahmed, CTO, Square Hospital, +8801711000000, " +
  "rahim@square.com.bd. " +
  "Computer Skills: Linux, Python, AWS. " +
  "Personal: Father's Name: Md. Salim. Date of Birth: 1990-05-12.";

const TINY_JD =
  "Senior IT Manager — Hospital. 5+ years required. Must have: cloud, " +
  "leadership, hospital systems. Nice to have: Power BI.";

type Case = { schema: z.ZodTypeAny; prompt: string };

const CASES: Record<string, Case> = {
  summary: {
    schema: CareerSummarySchema,
    prompt:
      `Write a 3-5 sentence career summary tailored to the JD.\n\n` +
      `JD: ${TINY_JD}\n\nCV: ${TINY_CV}`,
  },
  experience: {
    schema: ExperienceSectionSchema,
    prompt:
      `Extract every role from the CV in reverse-chronological order. ` +
      `4-7 bullets per role.\n\nJD: ${TINY_JD}\n\nCV: ${TINY_CV}`,
  },
  training: {
    schema: TrainingSectionSchema,
    prompt:
      `Extract every training/certification. Mark keep=true for items ` +
      `relevant to the JD; keep=false otherwise; borderline -> keep.\n\n` +
      `JD: ${TINY_JD}\n\nCV: ${TINY_CV}`,
  },
  references: {
    schema: ReferenceSectionSchema,
    prompt: `Extract every reference projected to exactly 5 fields.\n\nCV: ${TINY_CV}`,
  },
  others: {
    schema: OthersSectionSchema,
    prompt:
      `Extract miscellaneous titled subsections (NOT experience, education, ` +
      `training, references, summary, header).\n\nCV: ${TINY_CV}`,
  },
  education: {
    schema: z.object({ entries: z.array(EducationEntrySchema) }),
    prompt: `Extract every education entry. Mark is_professional correctly.\n\nCV: ${TINY_CV}`,
  },
  jd: {
    schema: JobDescriptionSchema,
    prompt: `Extract structured signals from this JD.\n\nJD: ${TINY_JD}`,
  },
  critique: {
    schema: CritiqueSchema,
    prompt:
      `You are a critic. The summary below claims the candidate has 20 ` +
      `years experience but the CV says 8. Produce a critique.\n\n` +
      `Summary: "Md. Karim is a senior IT manager with 20 years of ` +
      `experience at Square Hospital."\n\nCV: ${TINY_CV}`,
  },
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = (searchParams.get("name") ?? "").trim().toLowerCase();

  if (!name) {
    return Response.json({
      error: "Pass ?name=<one-of>",
      options: [...Object.keys(CASES), "all"],
    });
  }

  const llm = makeLlm();

  if (name === "all") {
    const results: Record<string, { ok: boolean; data?: unknown; error?: string }> = {};
    for (const [k, c] of Object.entries(CASES)) {
      try {
        results[k] = { ok: true, data: await callStructured(llm, c.prompt, c.schema) };
      } catch (err) {
        results[k] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return Response.json(results);
  }

  const c = CASES[name];
  if (!c) {
    return Response.json(
      { error: `Unknown schema '${name}'`, options: Object.keys(CASES) },
      { status: 400 },
    );
  }

  try {
    const data = await callStructured(llm, c.prompt, c.schema);
    return Response.json({ name, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ name, error: message }, { status: 500 });
  }
}
