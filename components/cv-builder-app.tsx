"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Pause, Play, RotateCcw } from "lucide-react";

import { FileInputPanel } from "@/components/file-input-panel";
import { MemoryPanel } from "@/components/memory-panel";
import { SectionsGrid } from "@/components/sections-grid";
import { Button } from "@/components/ui/button";
import { WorkflowDiagram } from "@/components/workflow-diagram";
import {
  createWorkflowSteps,
  initialMemory,
  MemorySnapshot,
  sectionShells,
  SectionResult,
  WorkflowNodeId,
  workflowNodes,
  WorkflowStatus,
} from "@/lib/workflow";

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

export function CvBuilderApp() {
  const [cvText, setCvText] = useState(sampleCv);
  const [jdText, setJdText] = useState(sampleJd);
  const [cvFileName, setCvFileName] = useState("");
  const [jdFileName, setJdFileName] = useState("");
  const [statuses, setStatuses] = useState(idleStatuses);
  const [activeNode, setActiveNode] = useState<WorkflowNodeId | null>(null);
  const [memory, setMemory] = useState<MemorySnapshot>(initialMemory);
  const [sections, setSections] = useState<SectionResult[]>(sectionShells);
  const [latestNote, setLatestNote] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isRenderingDocx, setIsRenderingDocx] = useState(false);
  const [phase, setPhase] = useState<AppPhase>("input");
  const cancelRef = useRef(false);

  const canRun = useMemo(() => cvText.trim().length > 0 && jdText.trim().length > 0, [cvText, jdText]);
  const hasSectionContent = useMemo(
    () => sections.some((section) => section.content.some((line) => line.trim())),
    [sections],
  );

  async function runWorkflow() {
    if (!canRun || isRunning) return;

    cancelRef.current = false;
    setIsRunning(true);
    setPhase("running");
    setStatuses(
      workflowNodes.reduce(
        (acc, node) => ({ ...acc, [node.id]: "queued" as WorkflowStatus }),
        {} as Record<WorkflowNodeId, WorkflowStatus>,
      ),
    );
    setMemory(initialMemory);
    setSections(sectionShells.map((section) => ({ ...section, content: [] })));
    setLatestNote("Graph started. Inputs are now entering shared memory.");

    for (const step of createWorkflowSteps(cvText, jdText)) {
      if (cancelRef.current) break;

      setActiveNode(step.nodeId);
      setStatuses((current) => ({ ...current, [step.nodeId]: "running" }));
      setLatestNote(step.note);

      await wait(step.duration);
      if (cancelRef.current) break;

      setMemory((current) => ({
        ...current,
        ...step.memoryPatch,
      }));

      if (step.sectionsPatch) {
        setSections((current) =>
          current.map((section) => ({
            ...section,
            content: step.sectionsPatch?.[section.id] ?? section.content,
          })),
        );
      }

      setStatuses((current) => ({ ...current, [step.nodeId]: "done" }));
    }

    setActiveNode(null);
    setIsRunning(false);
    if (!cancelRef.current) {
      setPhase("complete");
      setLatestNote("Graph complete. Six CV sections are ready for review.");
    }
  }

  function resetWorkflow() {
    cancelRef.current = true;
    setIsRunning(false);
    setActiveNode(null);
    setStatuses(idleStatuses);
    setMemory(initialMemory);
    setSections(sectionShells.map((section) => ({ ...section, content: [] })));
    setLatestNote("");
    setPhase("input");
  }

  function stopWorkflow() {
    cancelRef.current = true;
    setIsRunning(false);
    setActiveNode(null);
    setPhase("input");
    setLatestNote("Graph stopped. Inputs are still available.");
  }

  function updateSection(id: SectionResult["id"], value: string) {
    setSections((current) =>
      current.map((section) =>
        section.id === id
          ? {
              ...section,
              content: value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean),
            }
          : section,
      ),
    );
  }

  async function createDocx() {
    if (!hasSectionContent || isRenderingDocx) return;

    setIsRenderingDocx(true);
    try {
      const response = await fetch("/api/render-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName: memory.candidate === "Not parsed" ? "Candidate" : memory.candidate,
          jdTitle: memory.jd === "Not parsed" ? "Target role" : memory.jd,
          sections: sections.map(({ id, title, content }) => ({ id, title, content })),
        }),
      });

      if (!response.ok) {
        const message = await response.text();
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
      setLatestNote("DOCX created from edited sections using the v3 Word template.");
    } catch (error) {
      setLatestNote(error instanceof Error ? error.message : "DOCX render failed.");
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
          </div>
          <div className="flex flex-wrap gap-2">
            {phase === "input" ? (
              <Button onClick={runWorkflow} disabled={!canRun || isRunning} size="lg">
                <Play />
                Run graph
              </Button>
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
          <motion.div layout className="space-y-4">
            <WorkflowDiagram nodes={workflowNodes} statuses={statuses} activeNode={activeNode} />
            <MemoryPanel memory={memory} latestNote={latestNote} />
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
    return "The graph is running. Watch node calls and shared memory changes before the final sections appear.";
  }
  if (phase === "complete") {
    return "Review and edit the generated CV sections, then download a DOCX rendered with the v3 Word template.";
  }
  return "Start by pasting or uploading the candidate CV and job description. The graph view appears after you run it.";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
