import { buildRenderContext } from "@/lib/docx";
import type { CvBuilderStateType } from "@/lib/state";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/render-docx
 *
 * Body: the accumulated final state from /api/run (whatever the client
 * collected from the SSE stream). We trust the client to send back what we
 * gave it — this endpoint is for the same browser session, not a public API.
 *
 * Response: the rendered .docx as a binary attachment.
 */
export async function POST(request: Request) {
  let state: CvBuilderStateType;
  try {
    state = (await request.json()) as CvBuilderStateType;
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const templatePath = path.join(
    process.cwd(),
    "public",
    "cv_template.docx",
  );

  let templateBuffer: Buffer;
  try {
    templateBuffer = fs.readFileSync(templatePath);
  } catch {
    return Response.json(
      { error: "Template not found at public/cv_template.docx" },
      { status: 500 },
    );
  }

  const data = buildRenderContext(state);

  let outBuffer: Buffer;
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(data);
    outBuffer = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  } catch (err) {
    // Docxtemplater throws a structured error with `.properties.errors` —
    // surface the per-tag details so template bugs are debuggable.
    const e = err as {
      message?: string;
      properties?: { errors?: { message: string; properties: unknown }[] };
    };
    return Response.json(
      {
        error: e.message ?? "Failed to render template.",
        details: e.properties?.errors ?? null,
      },
      { status: 500 },
    );
  }

  const safeName =
    (state.candidate?.name ?? "cv")
      .replace(/[^a-zA-Z0-9-_ ]+/g, "")
      .trim()
      .replace(/\s+/g, "_") || "cv";

  return new Response(new Uint8Array(outBuffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}
