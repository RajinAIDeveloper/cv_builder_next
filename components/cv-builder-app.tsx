"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useClerk } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { Download, FileText, LogOut, Pause, Play, RotateCcw } from "lucide-react";

import { FileInputPanel } from "@/components/file-input-panel";
import { SectionsGrid } from "@/components/sections-grid";
import { Button } from "@/components/ui/button";
import {
  initialMemory,
  sectionShells,
  SectionResult,
  WorkflowNodeId,
  workflowNodes,
  WorkflowStatus,
} from "@/lib/workflow";
import { validateCvAndJdInputs } from "@/lib/input-validation";
import { applyPatchToMemory, renderSectionContent } from "@/lib/ui-format";
import { sectionsToRenderContext } from "@/lib/sections-to-render";

type AppPhase = "input" | "running" | "complete";

const sampleCv = `Dr. Md. Farhan Sadik
Senior Medical Officer
Dhaka, Bangladesh | farhan@example.com

Experience
Senior Medical Officer, City Hospital, 2021 - Present
Medical Officer, Community Clinic, 2018 - 2021

Education
MBBS, Dhaka Medical College, 2017
HSC, Notre Dame College, 2011

Training
Basic Life Support
Clinical Audit Workshop

References
Prof. Rahman, City Hospital`;

const sampleJd = `Senior Medical Officer
Responsibilities include clinical supervision, patient care, compliance, emergency response, and reporting.
Requirements: MBBS, 5+ years clinical experience, leadership, patient safety, and audit exposure.`;

const idleStatuses = workflowNodes.reduce(
  (acc, node) => ({ ...acc, [node.id]: "idle" as WorkflowStatus }),
  {} as Record<WorkflowNodeId, WorkflowStatus>,
);
const queuedStatuses = workflowNodes.reduce(
  (acc, node) => ({ ...acc, [node.id]: "queued" as WorkflowStatus }),
  {} as Record<WorkflowNodeId, WorkflowStatus>,
);
const nodeById = new Map(workflowNodes.map((node) => [node.id, node]));
const maxLogLines = 600;

export function CvBuilderApp() {
  const { signOut } = useClerk();
  const [cvText, setCvText] = useState(sampleCv);
  const [jdText, setJdText] = useState(sampleJd);
  const [cvFileName, setCvFileName] = useState("");
  const [jdFileName, setJdFileName] = useState("");
  const [, setStatuses] = useState(idleStatuses);
  const [, setActiveNode] = useState<WorkflowNodeId | null>(null);
  const [, setMemory] = useState(initialMemory);
  const [sections, setSections] = useState<SectionResult[]>(sectionShells);
  const [isRunning, setIsRunning] = useState(false);
  const [isRenderingDocx, setIsRenderingDocx] = useState(false);
  const [phase, setPhase] = useState<AppPhase>("input");
  const [, setLogLines] = useState<string[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [usage, setUsage] = useState<{
    tokens: number;
    cost: number;
    calls: number;
  } | null>(null);
  const [runError, setRunError] = useState("");
  const cancelRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // Accumulated final state from /api/run's `done` event; sent verbatim to
  // /api/render-docx so the server can build the docx render context from
  // the same shape the agent produced.
  const finalStateRef = useRef<Record<string, unknown> | null>(null);

  // Live elapsed-time ticker — only runs while a graph is in flight.
  useEffect(() => {
    return () => clearElapsedTimer(timerRef);
  }, []);

  const canRun = useMemo(() => cvText.trim().length > 0 && jdText.trim().length > 0, [cvText, jdText]);
  const hasSectionContent = useMemo(
    () => sections.some((section) => section.content.some((line) => line.trim())),
    [sections],
  );

  async function runWorkflow() {
    if (!canRun || isRunning) return;
    const validation = validateCvAndJdInputs(cvText, jdText);
    if (!validation.ok) {
      setRunError(validation.message);
      return;
    }

    cancelRef.current = false;
    setRunError("");
    finalStateRef.current = null;
    setUsage(null);
    setIsRunning(true);
    setPhase("running");
    setStatuses(queuedStatuses);
    setMemory(initialMemory);
    setSections(sectionShells.map((section) => ({ ...section, content: [] })));
    startElapsedTimer(timerRef, setElapsedSec);
    setLogLines([
      line("CV BUILDER v4 - live graph pipeline"),
      line(`Raw JD chars: ${jdText.length}   Raw CV chars: ${cvText.length}`),
      line("Building graph ..."),
      line("Invoking graph ..."),
    ]);

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_jd: jdText, raw_cv: cvText }),
      });

      if (!response.ok || !response.body) {
        const message = await readErrorResponse(response);
        throw new Error(message || `Agent run failed (HTTP ${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (cancelRef.current) {
          await reader.cancel();
          break;
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line (\n\n).
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const parsed = parseSseFrame(frame);
          if (!parsed) continue;
          handleSseEvent(parsed.event, parsed.data);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLogLines([`ERROR: ${msg}`]);
      setRunError(msg);
      setIsRunning(false);
      setActiveNode(null);
      clearElapsedTimer(timerRef);
      setPhase("input");
      return;
    }

    setActiveNode(null);
    setIsRunning(false);
    clearElapsedTimer(timerRef);
    if (!cancelRef.current) {
      setPhase("complete");
      pushLogLines([
        "Graph completed.",
        "Generated sections: summary, experience, education, training, others, references",
      ]);
    }
  }

  function handleSseEvent(event: string, data: string) {
    if (event === "ready") {
      pushLogLines(["Stream connected (ready frame received)."]);
      return;
    }
    if (event === "usage") {
      const obj = safeJson<{
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        cost_usd: number;
        calls: number;
      }>(data);
      if (obj) {
        setUsage({
          tokens: obj.total_tokens,
          cost: obj.cost_usd,
          calls: obj.calls,
        });
      }
      return;
    }
    if (event === "node-end") {
      const obj = safeJson<{
        node: string;
        uiNode: WorkflowNodeId | null;
        sections: SectionResult["id"][];
        patch: Record<string, unknown>;
      }>(data);
      if (!obj) return;
      // 1. Light up the workflow node.
      if (obj.uiNode) {
        setActiveNode(obj.uiNode);
        setStatuses((current) => ({ ...current, [obj.uiNode!]: "done" }));
      }

      // 2. Update the memory panel.
      setMemory((current) => applyPatchToMemory(current, obj.patch));

      // 3. Fill section cards whose data just arrived.
      if (obj.sections.length > 0) {
        setSections((current) =>
          current.map((section) => {
            if (!obj.sections.includes(section.id)) return section;
            const content = renderSectionContent(section.id, obj.patch);
            return content ? { ...section, content } : section;
          }),
        );
      }

      // 4. Log.
      const node = obj.uiNode ? nodeById.get(obj.uiNode) : undefined;
      pushLogLines([
        `  [node] ${node?.label ?? obj.node} — done` +
          (obj.sections.length > 0 ? ` (section: ${obj.sections.join(", ")})` : ""),
      ]);
    } else if (event === "error") {
      const obj = safeJson<{ message: string }>(data);
      const msg = obj?.message ?? "Unknown agent error.";
      pushLogLines([`ERROR: ${msg}`]);
      cancelRef.current = true;
    } else if (event === "done") {
      const obj = safeJson<{ final: Record<string, unknown> }>(data);
      if (obj?.final) finalStateRef.current = obj.final;
      pushLogLines(["Graph emitted `done` event."]);
    }
  }

  function resetWorkflow() {
    cancelRef.current = true;
    finalStateRef.current = null;
    setIsRunning(false);
    setActiveNode(null);
    setStatuses(idleStatuses);
    setMemory(initialMemory);
    setSections(sectionShells.map((section) => ({ ...section, content: [] })));
    setPhase("input");
    setRunError("");
    setLogLines([]);
    clearElapsedTimer(timerRef);
    setElapsedSec(0);
  }

  function stopWorkflow() {
    cancelRef.current = true;
    setIsRunning(false);
    setActiveNode(null);
    setPhase("input");
    clearElapsedTimer(timerRef);
    pushLogLines(["Graph stopped by user."]);
  }

  function pushLogLines(messages: string[]) {
    setLogLines((current) => [...current, ...messages.map(line)].slice(-maxLogLines));
  }

  function updateSection(id: SectionResult["id"], value: string) {
    setSections((current) =>
      current.map((section) =>
        section.id === id
          ? { ...section, content: value.split(/\r?\n/) }
          : section,
      ),
    );
  }

  async function createDocx() {
    if (!hasSectionContent || isRenderingDocx) return;

    const candidateName =
      (finalStateRef.current?.candidate as { name?: string } | null)?.name ?? "";
    const renderContext = sectionsToRenderContext(sections, candidateName);

    setIsRenderingDocx(true);
    try {
      const response = await fetch("/api/render-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(renderContext),
      });

      if (!response.ok) {
        const ct = response.headers.get("Content-Type") ?? "";
        const message = ct.includes("application/json")
          ? ((await response.json()) as { error?: string }).error
          : await response.text();
        throw new Error(message || "DOCX render failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "tailored_cv.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      pushLogLines(["DOCX created from edited sections using the v3 Word template."]);
    } catch (error) {
      pushLogLines([error instanceof Error ? error.message : "DOCX render failed."]);
    } finally {
      setIsRenderingDocx(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">HRPlus CV Builder v4</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">{titleForPhase(phase)}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {descriptionForPhase(phase)}
            </p>
            {runError ? (
              <div className="mt-3 max-w-3xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
                {runError}
              </div>
            ) : null}
            {/* Running-phase progress is now shown in the loader card below. */}
          </div>
          <div className="flex flex-wrap gap-2">
            {phase === "input" ? (
              <>
                <Button
                  onClick={() => {
                    setCvText(sampleCv);
                    setJdText(sampleJd);
                  }}
                  variant="outline"
                  size="lg"
                >
                  <FileText />
                  Load sample
                </Button>
                <Button onClick={runWorkflow} disabled={!canRun || isRunning} size="lg">
                  <Play />
                  Run graph
                </Button>
              </>
            ) : null}
            {phase === "running" ? (
              <Button onClick={stopWorkflow} disabled={!isRunning} variant="outline" size="lg">
                <Pause />
                Stop
              </Button>
            ) : null}
            {phase === "complete" ? (
              <>
                <Button onClick={runWorkflow} disabled={!canRun || isRunning} variant="outline" size="lg">
                  <Play />
                  Run again
                </Button>
                <Button onClick={createDocx} disabled={!hasSectionContent || isRenderingDocx} variant="secondary" size="lg">
                  <Download />
                  {isRenderingDocx ? "Creating..." : "Download DOCX"}
                </Button>
              </>
            ) : null}
            <Button onClick={resetWorkflow} variant="outline" size="lg">
              <RotateCcw />
              Reset
            </Button>
            <Button
              onClick={() => signOut({ redirectUrl: "/sign-in" })}
              variant="outline"
              size="lg"
            >
              <LogOut />
              Logout
            </Button>
          </div>
        </header>

        {phase === "input" ? (
          <motion.section layout className="grid gap-4 xl:grid-cols-2">
            <FileInputPanel
              title="1. Candidate CV"
              description="Accepts pasted plain text, TXT upload, or PDF upload placeholder for backend extraction."
              text={cvText}
              fileName={cvFileName}
              onTextChange={setCvText}
              onFileNameChange={setCvFileName}
            />
            <FileInputPanel
              title="2. Job Description"
              description="Paste or upload the role requirements used to tailor the CV."
              text={jdText}
              fileName={jdFileName}
              onTextChange={setJdText}
              onFileNameChange={setJdFileName}
            />
          </motion.section>
        ) : null}

        {phase === "running" ? (
          <motion.div
            layout
            className="flex min-h-[50vh] flex-col items-center justify-center gap-6 rounded-lg border border-slate-200 bg-white p-12"
          >
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-sky-600" />
            <div className="text-center">
              <div className="text-2xl font-semibold text-slate-900 tabular-nums">
                {formatElapsed(elapsedSec)}
              </div>
              <div className="mt-1 text-sm text-slate-500">Agent is running</div>
            </div>
            <div className="grid w-full max-w-md grid-cols-3 gap-3 text-center text-xs text-slate-500">
              <div className="rounded border border-slate-200 p-3">
                <div className="text-[10px] uppercase tracking-wide">LLM calls</div>
                <div className="mt-1 font-mono text-slate-700">
                  {usage ? usage.calls : "—"}
                </div>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <div className="text-[10px] uppercase tracking-wide">Tokens used</div>
                <div className="mt-1 font-mono text-slate-700">
                  {usage ? usage.tokens.toLocaleString() : "—"}
                </div>
              </div>
              <div className="rounded border border-slate-200 p-3">
                <div className="text-[10px] uppercase tracking-wide">Est. cost</div>
                <div className="mt-1 font-mono text-slate-700">
                  {usage ? `$${usage.cost.toFixed(4)}` : "—"}
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}

        {phase === "complete" ? (
          <motion.div layout className="space-y-4">
            <SectionsGrid sections={sections} onSectionChange={updateSection} />
          </motion.div>
        ) : null}
      </div>
    </main>
  );
}

function titleForPhase(phase: AppPhase) {
  if (phase === "running") return "Running LangGraph workflow";
  if (phase === "complete") return "Generated CV sections";
  return "Upload CV and job description";
}

function descriptionForPhase(phase: AppPhase) {
  if (phase === "running") {
    return "Generating tailored CV sections. This usually takes 30-90 seconds.";
  }
  if (phase === "complete") {
    return "Review and edit the generated CV sections, then download a DOCX rendered with the v3 Word template.";
  }
  return "Start by pasting or uploading the candidate CV and job description. The graph view appears after you run it.";
}

function line(message: string) {
  return `[${new Date().toLocaleTimeString()}] ${message}`;
}

function startElapsedTimer(
  timerRef: MutableRefObject<number | null>,
  setElapsedSec: Dispatch<SetStateAction<number>>,
) {
  clearElapsedTimer(timerRef);
  setElapsedSec(0);
  timerRef.current = window.setInterval(() => {
    setElapsedSec((seconds) => seconds + 1);
  }, 1000);
}

function clearElapsedTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) return;
  window.clearInterval(timerRef.current);
  timerRef.current = null;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  const lines = frame.split("\n");
  let event = "";
  let data = "";
  for (const ln of lines) {
    if (ln.startsWith("event:")) event = ln.slice(6).trim();
    else if (ln.startsWith("data:")) data = ln.slice(5).trim();
  }
  if (!event) return null;
  return { event, data };
}

function safeJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function readErrorResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json()) as { error?: string };
    return body.error ?? "";
  }
  return response.text();
}
