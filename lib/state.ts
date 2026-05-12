import { Annotation } from "@langchain/langgraph";
import type {
  JobDescription,
  Candidate,
  CareerSummary,
  ExperienceSection,
  EducationEntry,
  TrainingSection,
  OthersSection,
  ReferenceSection,
  Critique,
} from "@/lib/schemas";

/** The three lanes that use a reflexion loop. */
export type ReflexionLane = "summary" | "experience" | "references";

/**
 * CvBuilderState — the shared notebook every node reads from and writes to.
 *
 * Mental model:
 *   - rawJd / rawCv are the inputs. They are set ONCE at graph entry and
 *     never overwritten.
 *   - jd / candidate are produced by the two parse nodes.
 *   - summary / experience / education / training / others / references are
 *     produced by the six section nodes (some via reflexion loops).
 *   - critiques is an append-only audit trail. Every reflexion lane appends
 *     its critic verdicts here so a UI panel can show the agent's thinking.
 *
 * Why Annotation.Root() and not a plain interface:
 *   - Plain TS interfaces describe types, but LangGraph needs RUNTIME info
 *     about how to merge updates from each node.
 *   - Annotation.Root({...}) is both the type AND the merge config.
 *   - For most fields, the default reducer is "last write wins" — perfect
 *     for fields written by exactly one node.
 *   - For `critiques` we override with a custom reducer that concatenates,
 *     so multiple lanes' critiques accumulate instead of overwriting.
 *
 * LangGraph reads State.spec.<field>.value to know how to merge. If you add
 * a new field later, just append it here.
 */

/** One critique audit entry, written by any reflexion lane. */
export type CritiqueLogEntry = {
  /** Which lane produced this entry (e.g. "summary", "experience"). */
  lane: "summary" | "experience" | "references";
  /** Iteration index within the lane (0 = first critique). */
  iteration: number;
  /** Did this critique pass? */
  pass: boolean;
  /** Critic notes for this iteration. */
  notes: string[];
};

export const CvBuilderState = Annotation.Root({
  // ---- Inputs ----
  rawJd: Annotation<string>(),
  rawCv: Annotation<string>(),

  // ---- Parsed structures (one writer each) ----
  jd: Annotation<JobDescription | null>(),
  candidate: Annotation<Candidate | null>(),

  // ---- Section outputs (one writer each) ----
  summary: Annotation<CareerSummary | null>(),
  experience: Annotation<ExperienceSection | null>(),
  education: Annotation<EducationEntry[] | null>(),
  training: Annotation<TrainingSection | null>(),
  others: Annotation<OthersSection | null>(),
  references: Annotation<ReferenceSection | null>(),

  // ---- Reflexion-loop scratchpad ----
  // The latest critic verdict per lane — read by the router to decide
  // "pass=true → END" vs "pass=false + revisions-left → reviser".
  // We use a small object keyed by lane so we don't need three fields.
  latestCritiques: Annotation<Partial<Record<ReflexionLane, Critique>>>({
    reducer: (existing, update) => ({ ...(existing ?? {}), ...(update ?? {}) }),
    default: () => ({}),
  }),

  // How many revisions each lane has performed. Incremented by each reviser.
  revisionCounts: Annotation<Partial<Record<ReflexionLane, number>>>({
    reducer: (existing, update) => ({ ...(existing ?? {}), ...(update ?? {}) }),
    default: () => ({}),
  }),

  // ---- Audit trail (multi-writer; concatenate) ----
  critiques: Annotation<CritiqueLogEntry[]>({
    reducer: (existing, update) => [...(existing ?? []), ...(update ?? [])],
    default: () => [],
  }),
});

/** The runtime type produced by Annotation.Root — for use in node signatures. */
export type CvBuilderStateType = typeof CvBuilderState.State;

/** The partial-update shape — what a node returns. */
export type CvBuilderStateUpdate = typeof CvBuilderState.Update;
