import { StateGraph, START, END } from "@langchain/langgraph";
import {
  CvBuilderState,
  type CvBuilderStateType,
  type CvBuilderStateUpdate,
  type ReflexionLane,
} from "@/lib/state";
import { runParseJd } from "@/lib/sections/parse-jd";
import { runParseCv } from "@/lib/sections/parse-cv";
import { runSummary } from "@/lib/sections/summary";
import { runSummaryCritic } from "@/lib/sections/summary-critic";
import { runSummaryReviser } from "@/lib/sections/summary-reviser";
import { runExperience } from "@/lib/sections/experience";
import { runExperienceCritic } from "@/lib/sections/experience-critic";
import { runExperienceReviser } from "@/lib/sections/experience-reviser";
import { runEducation } from "@/lib/sections/education";
import { runTraining } from "@/lib/sections/training";
import { runOthers } from "@/lib/sections/others";
import { runReferences } from "@/lib/sections/references";
import { runReferencesCritic } from "@/lib/sections/references-critic";
import { runReferencesReviser } from "@/lib/sections/references-reviser";

/**
 * LangGraph StateGraph — Phase 5 Step 4.
 *
 * Three lanes now use a critic-reviser cycle:
 *   summary:    writeSummary → summaryCritic → (revise|END)
 *                              ↑──────── summaryReviser ←───┘
 *   experience: tailorExperience → experienceCritic → (revise|END)
 *                                  ↑─── experienceReviser ←────┘
 *   references: extractReferences → referencesCritic → (revise|END)
 *                                   ↑── referencesReviser ←─────┘
 *
 * Each lane's router reads state.latestCritiques[lane] and
 * state.revisionCounts[lane] to decide: route to the reviser or finish.
 */

const MAX_REVISIONS = 2;

// ============================================================================
// Parser nodes (unchanged)
// ============================================================================

async function parseJdNode(s: CvBuilderStateType): Promise<CvBuilderStateUpdate> {
  return { jd: await runParseJd(s.rawJd) };
}

async function parseCvNode(s: CvBuilderStateType): Promise<CvBuilderStateUpdate> {
  return { candidate: await runParseCv(s.rawCv) };
}

// ============================================================================
// Single-shot section nodes (unchanged)
// ============================================================================

async function educationNode(s: CvBuilderStateType): Promise<CvBuilderStateUpdate> {
  const result = await runEducation(s.rawCv);
  return { education: result.entries };
}

async function trainingNode(s: CvBuilderStateType): Promise<CvBuilderStateUpdate> {
  return { training: await runTraining(s.rawJd, s.rawCv) };
}

async function othersNode(s: CvBuilderStateType): Promise<CvBuilderStateUpdate> {
  return { others: await runOthers(s.rawCv) };
}

// ============================================================================
// Reflexion-loop nodes — writer / critic / reviser per lane
// ============================================================================

// --- Summary lane --- //

async function writeSummaryNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  return { summary: await runSummary(s.rawJd, s.rawCv) };
}

async function summaryCriticNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  if (!s.summary) throw new Error("summaryCritic called before writeSummary.");
  const verdict = await runSummaryCritic(s.summary, s.rawJd, s.rawCv);
  return {
    latestCritiques: { summary: verdict },
    critiques: [
      {
        lane: "summary",
        iteration: s.revisionCounts.summary ?? 0,
        pass: verdict.pass,
        notes: verdict.notes,
      },
    ],
  };
}

async function summaryReviserNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  if (!s.summary) throw new Error("summaryReviser called before writeSummary.");
  const verdict = s.latestCritiques.summary;
  if (!verdict) throw new Error("summaryReviser called before summaryCritic.");
  const revised = await runSummaryReviser(
    s.summary,
    verdict.notes,
    s.rawJd,
    s.rawCv,
  );
  return {
    summary: revised,
    revisionCounts: { summary: (s.revisionCounts.summary ?? 0) + 1 },
  };
}

// --- Experience lane ---

async function tailorExperienceNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  return { experience: await runExperience(s.rawJd, s.rawCv) };
}

async function experienceCriticNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  if (!s.experience)
    throw new Error("experienceCritic called before tailorExperience.");
  const verdict = await runExperienceCritic(s.experience, s.rawJd, s.rawCv);
  return {
    latestCritiques: { experience: verdict },
    critiques: [
      {
        lane: "experience",
        iteration: s.revisionCounts.experience ?? 0,
        pass: verdict.pass,
        notes: verdict.notes,
      },
    ],
  };
}

async function experienceReviserNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  if (!s.experience)
    throw new Error("experienceReviser called before tailorExperience.");
  const verdict = s.latestCritiques.experience;
  if (!verdict)
    throw new Error("experienceReviser called before experienceCritic.");
  const revised = await runExperienceReviser(
    s.experience,
    verdict.notes,
    s.rawJd,
    s.rawCv,
  );
  return {
    experience: revised,
    revisionCounts: { experience: (s.revisionCounts.experience ?? 0) + 1 },
  };
}

// --- References lane ---

async function extractReferencesNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  return { references: await runReferences(s.rawCv) };
}

async function referencesCriticNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  if (!s.references)
    throw new Error("referencesCritic called before extractReferences.");
  const verdict = await runReferencesCritic(s.references, s.rawCv);
  return {
    latestCritiques: { references: verdict },
    critiques: [
      {
        lane: "references",
        iteration: s.revisionCounts.references ?? 0,
        pass: verdict.pass,
        notes: verdict.notes,
      },
    ],
  };
}

async function referencesReviserNode(
  s: CvBuilderStateType,
): Promise<CvBuilderStateUpdate> {
  if (!s.references)
    throw new Error("referencesReviser called before extractReferences.");
  const verdict = s.latestCritiques.references;
  if (!verdict)
    throw new Error("referencesReviser called before referencesCritic.");
  const revised = await runReferencesReviser(
    s.references,
    verdict.notes,
    s.rawCv,
  );
  return {
    references: revised,
    revisionCounts: { references: (s.revisionCounts.references ?? 0) + 1 },
  };
}

// ============================================================================
// Routers — read state, return next-node name (or END)
// ============================================================================

/**
 * Generic router for a reflexion lane. After the critic runs, decide:
 *   - critic passed → END
 *   - critic has nothing concrete to fix → END
 *   - revisions cap reached → END
 *   - otherwise → reviserName
 */
function routerFor(lane: ReflexionLane, reviserName: string) {
  return function router(s: CvBuilderStateType): string {
    const verdict = s.latestCritiques[lane];
    const n = s.revisionCounts[lane] ?? 0;
    if (!verdict) return END;
    if (verdict.pass) return END;
    if (verdict.notes.length === 0) return END;
    if (n >= MAX_REVISIONS) return END;
    return reviserName;
  };
}

// ============================================================================
// Build & compile
// ============================================================================

export function buildGraph() {
  const graph = new StateGraph(CvBuilderState)
    // Parser nodes
    .addNode("parseJd", parseJdNode)
    .addNode("parseCv", parseCvNode)
    // Single-shot section nodes
    .addNode("extractEducation", educationNode)
    .addNode("filterTraining", trainingNode)
    .addNode("extractOthers", othersNode)
    // Summary lane (writer → critic → reviser cycle)
    .addNode("writeSummary", writeSummaryNode)
    .addNode("summaryCritic", summaryCriticNode)
    .addNode("summaryReviser", summaryReviserNode)
    // Experience lane
    .addNode("tailorExperience", tailorExperienceNode)
    .addNode("experienceCritic", experienceCriticNode)
    .addNode("experienceReviser", experienceReviserNode)
    // References lane
    .addNode("extractReferences", extractReferencesNode)
    .addNode("referencesCritic", referencesCriticNode)
    .addNode("referencesReviser", referencesReviserNode)
    // Fan out from START
    .addEdge(START, "parseJd")
    .addEdge(START, "parseCv")
    .addEdge(START, "writeSummary")
    .addEdge(START, "tailorExperience")
    .addEdge(START, "extractEducation")
    .addEdge(START, "filterTraining")
    .addEdge(START, "extractOthers")
    .addEdge(START, "extractReferences")
    // Single-shot lanes → END
    .addEdge("parseJd", END)
    .addEdge("parseCv", END)
    .addEdge("extractEducation", END)
    .addEdge("filterTraining", END)
    .addEdge("extractOthers", END)
    // Summary cycle: write → critic → (revise|END); reviser → critic
    .addEdge("writeSummary", "summaryCritic")
    .addConditionalEdges("summaryCritic", routerFor("summary", "summaryReviser"), [
      "summaryReviser",
      END,
    ])
    .addEdge("summaryReviser", "summaryCritic")
    // Experience cycle
    .addEdge("tailorExperience", "experienceCritic")
    .addConditionalEdges(
      "experienceCritic",
      routerFor("experience", "experienceReviser"),
      ["experienceReviser", END],
    )
    .addEdge("experienceReviser", "experienceCritic")
    // References cycle
    .addEdge("extractReferences", "referencesCritic")
    .addConditionalEdges(
      "referencesCritic",
      routerFor("references", "referencesReviser"),
      ["referencesReviser", END],
    )
    .addEdge("referencesReviser", "referencesCritic");

  return graph.compile();
}
