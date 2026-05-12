# CV Builder — Agentic AI CV Tailoring (Next.js + LangGraph)

An AI agent that takes a candidate's raw CV and a target job description, runs a multi-node reasoning graph (parse, tailor, critique, revise, render), and produces a fully tailored, ATS-friendly DOCX targeted at the South Asian (Bangladesh) hiring market.

The frontend visualises the live LangGraph execution: a workflow diagram with status-coloured nodes, a shared-memory panel that updates as nodes write to state, and a per-section results grid. The backend is a LangGraph `StateGraph` running inside Next.js Route Handlers, calling Claude/OpenAI via LangChain with structured (Zod-validated) outputs.

---

## Table of contents

1. [Demo flow](#demo-flow)
2. [Architecture](#architecture)
3. [Agent graph](#agent-graph)
4. [Shared state](#shared-state)
5. [Tech stack](#tech-stack)
6. [Project structure](#project-structure)
7. [Prerequisites](#prerequisites)
8. [Environment variables](#environment-variables)
9. [Local development](#local-development)
10. [API surface](#api-surface)
11. [DOCX template](#docx-template)
12. [Testing](#testing)
13. [Deployment](#deployment)
14. [Roadmap](#roadmap)
15. [License](#license)

---

## Demo flow

1. Paste a raw CV (any format — pasted plain text from a Word/PDF export) into the left panel.
2. Paste the target Job Description into the right panel.
3. Click **Run workflow**.
4. Watch the workflow diagram light up node-by-node as the LangGraph executes. The memory panel shows each node's writes to shared state in real time.
5. The six output sections — **Summary, Experience, Education, Training, Others, Reference** — populate the results grid as their lanes complete.
6. Click **Download DOCX** to fetch a rendered Word document built from the agent's outputs and the project's Jinja-style template.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (React 19)                          │
│  cv-builder-app.tsx  ──>  workflow-diagram │ memory-panel │ grid    │
└──────────────┬──────────────────────────────────────────────────────┘
               │ POST /api/run  (SSE: node events stream back)
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Next.js Route Handler  (Edge/Node)                 │
│                                                                     │
│   LangGraph StateGraph<CvBuilderState>                              │
│   ────────────────────────────────────                              │
│     parseJd ──┐                                                     │
│               ├─> tailorExperience ─> expCritic ─> expReviser ──┐   │
│     parseCv ──┤                                                  │  │
│               ├─> writeSummary ──── summaryCritic ── reviser ───┤   │
│               ├─> orderEducation ── eduCritic ────── reviser ───┤   │
│               ├─> filterTraining ────────────────────────────────│  │
│               ├─> extractOthers ─────────────────────────────────│  │
│               └─> extractReferences ── refCritic ── refReviser ─┘   │
│                                                                     │
│   Each node: ChatPromptTemplate | llm.withStructuredOutput(zod)     │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Claude / OpenAI API                          │
│         (Anthropic Claude Sonnet 4.6 by default; configurable)      │
└─────────────────────────────────────────────────────────────────────┘

POST /api/render-docx  →  docxtemplater render of cv_template.docx
                          using the StateGraph's final outputs
```

**Why LangGraph and not a chain of `await`s?** Because three sections (Experience, Summary, References) run a *reflexion loop* — generator → critic → reviser → critic again — and that loop has cycles. LangGraph's `StateGraph` models cycles cleanly with `addConditionalEdges`. The other three sections (Training, Others, Education) are single-shot or pure-deterministic and join the graph as terminal nodes.

---

## Agent graph

| Lane | Nodes | LLM? | Notes |
|---|---|---|---|
| **Inputs** | `parseJd`, `parseCv` | yes | `parseJd` produces categorised `JDSignals` (job_title, industry, seniority, must_have_skills, nice_to_have_skills, domain_keywords, responsibilities). `parseCv` produces a canonical `CvStruct`. |
| **Summary** | `writeSummary` → `summaryCritic` → `summaryReviser` | yes (loop) | Formula: `EXP + Company + Work + last 1–2 degrees`, JD-flavoured. Loop exits when critic returns `pass: true` or after 2 revisions. |
| **Experience** | `tailorExperience` → `expCritic` → `expReviser` | yes (loop, per-role) | Reverse-chronological. Critic enforces: no fabrications, must-have-skills coverage, ATS-friendly verbs. |
| **Education** | `orderEducation` → `eduCritic` → `eduReviser` | mixed | LLM extracts entries + flags `is_professional`. Pure TypeScript sorts: professional degrees (MBBS/MPH/MBA/PhD/FCPS/MRCP/CCD/etc.) first, then HSC/SSC/A-Level/O-Level — both groups reverse-chrono. |
| **Training** | `filterTraining` | yes (single-shot) | Drops JD-irrelevant items; keeps borderline ones. Each item carries a one-line `reason` for debugging. |
| **Others** | `extractOthers` | yes (single-shot) | Computer skills + South Asian personal details (father's name, NID, permanent/present address, languages, etc.). |
| **References** | `extractReferences` → `refCritic` → `refReviser` | yes (loop) | Projected to exactly 5 fields: `name, designation, company, mobile, email`. |

All graph node IDs match those declared in [`lib/workflow.ts`](lib/workflow.ts) so the UI's workflow diagram lights up correctly as events stream from the server.

---

## Shared state

The graph state (`CvBuilderState`) is the single source of truth between nodes. Every node returns a partial-state object that LangGraph merges via channel reducers.

```ts
type CvBuilderState = {
  // Raw inputs
  rawCv: string;
  rawJd: string;

  // Parsed structures
  jd: JDSignals | null;
  candidate: CvStruct | null;

  // Section outputs
  summary: string;
  experience: ExperienceRole[];
  education: EducationEntry[];
  training: TrainingItem[];
  others: OthersSection | null;
  references: Reference[];

  // Reflexion-loop scratchpad (per-lane)
  critiques: Record<LaneId, CritiqueNote[]>;
  revisionCounts: Record<LaneId, number>;
};
```

Schemas live in [`lib/schemas.ts`](lib/schemas.ts) (Zod) and are passed to `llm.withStructuredOutput(schema)` so the LLM is *forced* to return validated JSON. No regex parsing, no string surgery.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Route Handlers) |
| UI | React 19, Tailwind CSS v4, shadcn/ui, Framer Motion, lucide-react |
| Agent | LangGraph (`@langchain/langgraph`) |
| LLM client | LangChain (`@langchain/core`, `@langchain/anthropic`, `@langchain/openai`) |
| Schema validation | Zod |
| DOCX render | docxtemplater + pizzip |
| PDF/text ingest (roadmap) | pdf-parse, mammoth |
| Streaming | Server-Sent Events (SSE) for live node updates |
| Package manager | pnpm |
| Lint | ESLint 9 (`eslint-config-next`) |
| Types | TypeScript 5 |

---

## Project structure

```
cv_builder/
├── app/
│   ├── api/
│   │   ├── run/route.ts             # POST: stream LangGraph node events (SSE)
│   │   ├── sections/
│   │   │   ├── summary/route.ts     # POST: standalone summary chain (debug)
│   │   │   ├── experience/route.ts
│   │   │   ├── education/route.ts
│   │   │   ├── training/route.ts
│   │   │   ├── others/route.ts
│   │   │   └── references/route.ts
│   │   └── render-docx/route.ts     # POST: render DOCX from final state
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
│
├── components/
│   ├── cv-builder-app.tsx           # Top-level page, owns WS/SSE client + state
│   ├── file-input-panel.tsx         # CV + JD textareas, run button
│   ├── workflow-diagram.tsx         # Animated graph view
│   ├── memory-panel.tsx             # Live shared-state inspector
│   ├── sections-grid.tsx            # Six section cards (Summary..Reference)
│   └── ui/                          # shadcn/ui primitives
│
├── lib/
│   ├── workflow.ts                  # Node metadata for the UI diagram
│   ├── schemas.ts                   # Zod schemas: JDSignals, CvStruct, ...
│   ├── graph.ts                     # LangGraph StateGraph definition
│   ├── nodes/
│   │   ├── parse-jd.ts
│   │   ├── parse-cv.ts
│   │   ├── summary.ts               # generator + critic + reviser
│   │   ├── experience.ts
│   │   ├── education.ts             # LLM extract + deterministic sort
│   │   ├── training.ts
│   │   ├── others.ts
│   │   └── references.ts
│   ├── llm.ts                       # ChatModel factory (provider-agnostic)
│   ├── reflexion.ts                 # Generic critic-reviser loop helper
│   ├── docx.ts                      # docxtemplater wrapper + data shaping
│   └── utils.ts
│
├── public/
│   ├── cv_template.docx             # Jinja-style placeholders + {% for %}
│   └── samples/                     # Sample CV + JD pairs for the demo
│
├── scripts/
│   └── eval/                        # Offline evaluation harness (roadmap)
│
├── AGENTS.md                        # Repo-specific notes for AI assistants
├── CLAUDE.md
├── README.md
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs
├── package.json
└── pnpm-lock.yaml
```

---

## Prerequisites

- **Node.js 20.x or newer** (required by Next.js 16)
- **pnpm 9+** (`corepack enable && corepack prepare pnpm@latest --activate`)
- An **Anthropic API key** (default provider) or an **OpenAI API key**

---

## Environment variables

Create a `.env.local` in the project root.

| Variable | Required | Default | Notes |
|---|---|---|---|

| `LLM_PROVIDER` | no | `anthropic` | `anthropic` or `openai`. |
| `ANTHROPIC_API_KEY` | conditional | — | Required if `LLM_PROVIDER=anthropic`. |
| `OPENAI_API_KEY` | conditional | — | Required if `LLM_PROVIDER=openai`. |
| `MODEL_NAME` | no | `claude-sonnet-4-6` | Or e.g. `gpt-5-mini`. |
| `MAX_REVISIONS` | no | `2` | Reflexion-loop cap per lane. |
| `LANGSMITH_TRACING` | no | `false` | Set `true` + `LANGSMITH_API_KEY` to trace runs. |
| `LANGSMITH_API_KEY` | no | — | LangSmith trace ingestion. |
| `LANGSMITH_PROJECT` | no | `cv-builder` | LangSmith project name. |

> **Never commit `.env.local`.** It is already in `.gitignore`.

---

## Local development

```bash
# Install
pnpm install

# Run dev server
pnpm dev
# → http://localhost:3000

# Type-check
pnpm exec tsc --noEmit

# Lint
pnpm lint

# Production build
pnpm build && pnpm start
```

### Smoke test the agent end-to-end

1. `pnpm dev`
2. Open http://localhost:3000
3. Paste the sample JD from [`public/samples/operational-manager-jd.txt`](public/samples/) and the sample CV from [`public/samples/farhan-sadik-cv.txt`](public/samples/).
4. Click **Run workflow**. All 15 nodes should turn green within ~30–60s.
5. Click **Download DOCX** and verify the output matches the gold-standard tailored CV in `public/samples/expected/`.

---

## API surface

### `POST /api/run`

Run the full agent graph. Returns a Server-Sent Events stream of node events.

**Request body**

```json
{ "rawCv": "string", "rawJd": "string" }
```

**Event stream** — one event per state mutation:

```
event: node-start
data: {"nodeId":"parse-jd"}

event: node-end
data: {"nodeId":"parse-jd","memoryPatch":{"jd":{...}}}

event: section-update
data: {"sectionId":"summary","content":["..."]}

event: done
data: {"state":{...full final state...}}

event: error
data: {"nodeId":"experience-critic","message":"..."}
```

### `POST /api/sections/{section}`

Run a single section chain in isolation — useful for debugging or for a faster "regenerate just this section" flow in the UI. Available for all six sections.

**Request body**

```json
{ "rawCv": "string", "rawJd": "string" }
```

**Response** — the typed section output (e.g. `CareerSummary`, `ExperienceSection`, ...).

### `POST /api/render-docx`

Render the final DOCX from a completed state.

**Request body**

```json
{ "state": { ... CvBuilderState ... } }
```

**Response** — `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

---

## DOCX template

The renderer uses [`docxtemplater`](https://docxtemplater.com/) against [`public/cv_template.docx`](public/cv_template.docx).

The template is a real Word document, hand-edited once with placeholders:

```
{candidate.name}
{candidate.email}  |  {candidate.phone}

CAREER SUMMARY
{summary}

EXPERIENCE
{#experience}
{title} — {company}                          {dates}
{location}
{#bullets}• {.}{/bullets}
{/experience}

EDUCATION
{#education}
{degree}, {institution} ({year})
{/education}

...
```

Editing rules:
- Use `{tag}` for scalars and `{#list}…{/list}` for arrays.
- **Do not paste from rich-text sources into the template** — the placeholder runs must not be split across `<w:r>` boundaries. If a placeholder breaks, retype it in Word as plain text.

---

## Testing

| Layer | Tool | Where |
|---|---|---|
| Type safety | `tsc --noEmit` | CI |
| Lint | `eslint` | CI |
| Schema parsing | Vitest unit tests on each Zod schema | `lib/schemas.test.ts` |
| Node behaviour | Vitest with **mocked** LLM (golden-input → golden-output snapshots) | `lib/nodes/*.test.ts` |
| End-to-end | Playwright: paste sample CV+JD, run, download DOCX, assert key sections | `e2e/` (roadmap) |
| Eval | LangSmith dataset + run-pair scoring | `scripts/eval/` (roadmap) |

> Integration tests **do not mock the LLM** — they hit the real API at low temperature with the smallest available model. Mocked tests are fine for graph wiring; real-LLM tests are needed for prompt regressions.

---

## Deployment

### Vercel (recommended)

1. Import the repo on Vercel.
2. Add `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) under **Project Settings → Environment Variables**.
3. Set the **Function Region** close to the LLM provider's API region for lower latency.
4. The `/api/run` route is **Node runtime** (LangGraph + docxtemplater are not Edge-compatible). Confirm `export const runtime = "nodejs"` is set in the route file.
5. Increase the **Function Max Duration** to at least 60s for `/api/run`.

### Self-host (Docker)

A `Dockerfile` and `docker-compose.yml` ship in the repo root. Build with `docker compose build` and run with `docker compose up`. The container exposes port 3000.

---

## Roadmap

- [ ] **PDF/DOCX upload** instead of paste — wire `pdf-parse` and `mammoth` into a `/api/ingest` route.
- [ ] **Multi-language support** — Bangla CVs and JDs, with localised summary phrasing.
- [ ] **Versioning** — store every generated CV per (candidate, JD) pair so users can A/B compare.
- [ ] **Auth + persistence** — Supabase or Clerk + Postgres.
- [ ] **LangSmith eval harness** — labelled dataset of (raw_cv, raw_jd, gold_cv) triples with automated grader.
- [ ] **Reference-grade DOCX** — pixel-match the South Asian template family (3-column header table, photo placement).
- [ ] **Streaming partial outputs** — render summary/experience as tokens arrive instead of after the node completes.

---

## License

Proprietary — all rights reserved. Contact the author before reuse.
