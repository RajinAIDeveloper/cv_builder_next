import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";

type RenderPayload = {
  candidateName?: string;
  jdTitle?: string;
  sections?: Array<{
    id: string;
    title: string;
    content: string[];
  }>;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as RenderPayload;

  if (!payload.sections?.length) {
    return new Response("No CV sections were provided.", { status: 400 });
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "cv-builder-"));
  const payloadPath = path.join(workDir, "payload.json");
  const outputPath = path.join(workDir, "tailored_cv.docx");
  const scriptPath = path.join(process.cwd(), "scripts", "render_docx.py");
  const templatePath = path.resolve(process.cwd(), "..", "..", "v3", "files", "cv_template.docx");
  const pythonPath =
    process.env.PYTHON_PATH ||
    path.resolve(process.cwd(), "..", "..", "..", "..", "venv", "Scripts", "python.exe");

  await fs.writeFile(payloadPath, JSON.stringify(payload), "utf-8");

  try {
    await runPython(pythonPath, [scriptPath, payloadPath, templatePath, outputPath]);
    const file = await fs.readFile(outputPath);

    return new Response(file, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": 'attachment; filename="tailored_cv.docx"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCX render failed.";
    return new Response(message, { status: 500 });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

function runPython(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `Python renderer exited with code ${code}`));
      }
    });
  });
}
