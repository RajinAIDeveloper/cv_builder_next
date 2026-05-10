import {
  Award,
  BookOpen,
  BriefcaseBusiness,
  FileSearch,
  GraduationCap,
  ListChecks,
  MessageSquareText,
  Network,
  ScanText,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import type { ElementType } from "react";

export type WorkflowStatus = "idle" | "queued" | "running" | "done" | "error";

export type WorkflowNodeId =
  | "parse-jd"
  | "parse-cv"
  | "tailor-experience"
  | "experience-critic"
  | "experience-reviser"
  | "summary"
  | "summary-critic"
  | "summary-reviser"
  | "education-critic"
  | "education-reviser"
  | "training"
  | "others"
  | "references"
  | "references-critic"
  | "references-reviser";

export type CvSectionId =
  | "summary"
  | "experience"
  | "education"
  | "training"
  | "others"
  | "references";

export type WorkflowNode = {
  id: WorkflowNodeId;
  label: string;
  lane: string;
  icon: ElementType;
  reads: string[];
  writes: string[];
};

export type MemorySnapshot = {
  rawCv: string;
  rawJd: string;
  jd: string;
  candidate: string;
  summary: string;
  experience: string[];
  education: string[];
  training: string[];
  others: string[];
  references: string[];
  critiques: string[];
};

export type SectionResult = {
  id: CvSectionId;
  title: string;
  icon: ElementType;
  content: string[];
};

export type WorkflowStep = {
  nodeId: WorkflowNodeId;
  duration: number;
  memoryPatch: Partial<MemorySnapshot>;
  sectionsPatch?: Partial<Record<CvSectionId, string[]>>;
  note: string;
};

export const workflowNodes: WorkflowNode[] = [
  {
    id: "parse-jd",
    label: "Parse JD",
    lane: "Inputs",
    icon: FileSearch,
    reads: ["rawJd"],
    writes: ["jd"],
  },
  {
    id: "parse-cv",
    label: "Parse CV",
    lane: "Inputs",
    icon: ScanText,
    reads: ["rawCv"],
    writes: ["candidate", "education"],
  },
  {
    id: "tailor-experience",
    label: "Tailor Experience",
    lane: "Experience",
    icon: BriefcaseBusiness,
    reads: ["rawCv", "rawJd"],
    writes: ["experience"],
  },
  {
    id: "experience-critic",
    label: "Experience Critic",
    lane: "Experience",
    icon: ShieldCheck,
    reads: ["experience", "rawCv"],
    writes: ["critiques"],
  },
  {
    id: "experience-reviser",
    label: "Experience Reviser",
    lane: "Experience",
    icon: Sparkles,
    reads: ["experience", "critiques"],
    writes: ["experience"],
  },
  {
    id: "summary",
    label: "Write Summary",
    lane: "Summary",
    icon: MessageSquareText,
    reads: ["rawCv", "rawJd"],
    writes: ["summary"],
  },
  {
    id: "summary-critic",
    label: "Summary Critic",
    lane: "Summary",
    icon: ShieldCheck,
    reads: ["summary", "rawCv"],
    writes: ["critiques"],
  },
  {
    id: "summary-reviser",
    label: "Summary Reviser",
    lane: "Summary",
    icon: Sparkles,
    reads: ["summary", "critiques"],
    writes: ["summary"],
  },
  {
    id: "education-critic",
    label: "Education Critic",
    lane: "Education",
    icon: GraduationCap,
    reads: ["education", "rawCv"],
    writes: ["critiques"],
  },
  {
    id: "education-reviser",
    label: "Education Reviser",
    lane: "Education",
    icon: Sparkles,
    reads: ["education", "critiques"],
    writes: ["education"],
  },
  {
    id: "training",
    label: "Filter Training",
    lane: "Sections",
    icon: Award,
    reads: ["rawCv", "rawJd"],
    writes: ["training"],
  },
  {
    id: "others",
    label: "Extract Others",
    lane: "Sections",
    icon: ListChecks,
    reads: ["rawCv"],
    writes: ["others"],
  },
  {
    id: "references",
    label: "Extract References",
    lane: "References",
    icon: UserRoundCheck,
    reads: ["rawCv"],
    writes: ["references"],
  },
  {
    id: "references-critic",
    label: "Reference Critic",
    lane: "References",
    icon: ShieldCheck,
    reads: ["references", "rawCv"],
    writes: ["critiques"],
  },
  {
    id: "references-reviser",
    label: "Reference Reviser",
    lane: "References",
    icon: Sparkles,
    reads: ["references", "critiques"],
    writes: ["references"],
  },
];

export const sectionShells: SectionResult[] = [
  { id: "summary", title: "Summary", icon: MessageSquareText, content: [] },
  { id: "experience", title: "Experience", icon: BriefcaseBusiness, content: [] },
  { id: "education", title: "Education", icon: BookOpen, content: [] },
  { id: "training", title: "Training", icon: Award, content: [] },
  { id: "others", title: "Others", icon: Network, content: [] },
  { id: "references", title: "Reference", icon: UserRoundCheck, content: [] },
];

export const initialMemory: MemorySnapshot = {
  rawCv: "Waiting for CV input",
  rawJd: "Waiting for JD input",
  jd: "Not parsed",
  candidate: "Not parsed",
  summary: "Not written",
  experience: [],
  education: [],
  training: [],
  others: [],
  references: [],
  critiques: [],
};

export function createWorkflowSteps(cvText: string, jdText: string): WorkflowStep[] {
  const cvLines = cvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jdLines = jdText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = cvLines[0] || "Candidate";
  const title =
    jdLines.find((line) => /manager|engineer|developer|officer|analyst|lead/i.test(line)) ||
    "Target role";

  return [
    {
      nodeId: "parse-jd",
      duration: 720,
      memoryPatch: {
        rawJd: summarize(jdText),
        jd: `${title} | ${keywordLine(jdText)}`,
      },
      note: "Job description converted into role, requirements, and keywords.",
    },
    {
      nodeId: "parse-cv",
      duration: 840,
      memoryPatch: {
        rawCv: summarize(cvText),
        candidate,
        education: ["Latest degree detected", "School-level education separated"],
      },
      sectionsPatch: {
        education: [
          "Professional/postgraduate education appears first.",
          "School-level credentials are preserved below professional education.",
        ],
      },
      note: "Candidate identity and education are stored in shared memory.",
    },
    {
      nodeId: "tailor-experience",
      duration: 980,
      memoryPatch: {
        experience: [
          "Most recent role rewritten toward JD keywords.",
          "Older roles kept truthful and reverse chronological.",
        ],
      },
      sectionsPatch: {
        experience: [
          "Reframed recent responsibilities around the target role.",
          "Kept claims grounded in the uploaded CV.",
          "Preserved employer names, dates, and role order.",
        ],
      },
      note: "Experience section is drafted from CV evidence plus JD priorities.",
    },
    {
      nodeId: "experience-critic",
      duration: 640,
      memoryPatch: {
        critiques: ["Experience check: remove unsupported wording and keep bullets concise."],
      },
      note: "Critic checks whether every bullet is supported by the CV.",
    },
    {
      nodeId: "experience-reviser",
      duration: 620,
      memoryPatch: {
        experience: [
          "Unsupported phrases removed.",
          "JD-relevant responsibilities kept.",
          "Bullets shortened for ATS scanning.",
        ],
      },
      sectionsPatch: {
        experience: [
          "Tailored bullets now emphasize JD-relevant work without adding facts.",
          "Each role remains concise and reverse chronological.",
        ],
      },
      note: "Reviser patches the experience section using the critic notes.",
    },
    {
      nodeId: "summary",
      duration: 760,
      memoryPatch: {
        summary: `${candidate} positioned for ${title} using CV-backed experience and education.`,
      },
      sectionsPatch: {
        summary: [
          `${candidate} is presented with a concise profile aligned to the target JD.`,
          "The summary uses only uploaded CV facts and avoids generic filler.",
        ],
      },
      note: "Career summary is drafted from candidate facts and job priorities.",
    },
    {
      nodeId: "summary-critic",
      duration: 520,
      memoryPatch: {
        critiques: ["Summary check: keep it specific, grounded, and short."],
      },
      note: "Critic checks for invention, filler, and missing grounding.",
    },
    {
      nodeId: "summary-reviser",
      duration: 520,
      memoryPatch: {
        summary: "Final summary is concise, role-aligned, and evidence-backed.",
      },
      sectionsPatch: {
        summary: [
          "Concise role-aligned paragraph.",
          "Mentions experience, domain, and education only when supported.",
        ],
      },
      note: "Summary is revised into the final section text.",
    },
    {
      nodeId: "education-critic",
      duration: 540,
      memoryPatch: {
        critiques: ["Education check: verify degree names and professional/school classification."],
      },
      note: "Education entries are checked against the original CV.",
    },
    {
      nodeId: "education-reviser",
      duration: 520,
      memoryPatch: {
        education: ["Professional education", "School education"],
      },
      sectionsPatch: {
        education: [
          "Professional and postgraduate credentials grouped first.",
          "HSC/SSC or equivalent entries grouped after professional education.",
        ],
      },
      note: "Education is corrected and sorted for rendering.",
    },
    {
      nodeId: "training",
      duration: 680,
      memoryPatch: {
        training: ["JD-relevant courses kept", "Unrelated courses dropped"],
      },
      sectionsPatch: {
        training: [
          "Relevant training and certifications are retained.",
          "Generic or unrelated items are filtered out.",
        ],
      },
      note: "Training is filtered against the JD.",
    },
    {
      nodeId: "others",
      duration: 700,
      memoryPatch: {
        others: ["Skills", "Languages", "Personal Details"],
      },
      sectionsPatch: {
        others: [
          "Skills, languages, personal details, and miscellaneous sections are preserved.",
          "The original section labels are kept for the template.",
        ],
      },
      note: "Miscellaneous CV sections are extracted as flexible groups.",
    },
    {
      nodeId: "references",
      duration: 620,
      memoryPatch: {
        references: ["Reference 1", "Reference 2"],
      },
      sectionsPatch: {
        references: ["Reference names, designations, companies, phone, and email are extracted."],
      },
      note: "References are extracted from the raw CV.",
    },
    {
      nodeId: "references-critic",
      duration: 480,
      memoryPatch: {
        critiques: ["Reference check: remove duplicates and keep contact fields faithful."],
      },
      note: "Reference fields are checked against the CV.",
    },
    {
      nodeId: "references-reviser",
      duration: 480,
      memoryPatch: {
        references: ["Verified reference list"],
      },
      sectionsPatch: {
        references: [
          "Duplicate references removed.",
          "Contact fields remain exactly as supported by the CV.",
        ],
      },
      note: "References are finalized for the rendered CV.",
    },
  ];
}

function summarize(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "No text provided";
  return trimmed.length > 110 ? `${trimmed.slice(0, 110)}...` : trimmed;
}

function keywordLine(value: string) {
  const matches = value.match(/\b[A-Z][A-Za-z+#.]{2,}\b/g) ?? [];
  const unique = Array.from(new Set(matches)).slice(0, 4);
  return unique.length ? `keywords: ${unique.join(", ")}` : "keywords pending";
}
