import { z } from "zod";

// ============================================================================
// INPUT SCHEMAS — what the parsers produce from raw_jd / raw_cv
// ============================================================================

/**
 * Categorised JD signals. Replaces the flat list we briefly tried — the gold-
 * standard CV transformation needs seniority, must-haves, and domain
 * separately so each section chain can pull only the parts it cares about.
 */
export const JobDescriptionSchema = z.object({
  title: z.string().describe("Job title as written in the JD."),
  seniority: z
    .string()
    .default("unspecified")
    .describe('One of: "junior", "mid", "senior", "lead", "unspecified".'),
  domain: z.string().describe("Domain or department, e.g. 'HR & compliance'."),
  must_have_skills: z
    .array(z.string())
    .describe("Skills required for the position."),
  nice_to_have_skills: z
    .array(z.string())
    .describe("Skills that are desirable but not mandatory."),
  responsibilities: z
    .array(z.string())
    .describe("Key responsibilities of the role."),
  years_experience_required: z
    .string()
    .describe("Years of experience required, e.g. '3-5 years'."),
});
export type JobDescription = z.infer<typeof JobDescriptionSchema>;

/**
 * Header block of a CV. Lossless extraction — preserve the candidate's wording.
 */
export const CandidateSchema = z.object({
  name: z.string().describe("Full name as it appears in the CV."),
  location: z
    .string()
    .default("")
    .describe("City + country if present, else empty."),
  phone: z.string().default("").describe("Primary phone number as written."),
  email: z.string().default("").describe("Primary email as written."),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * One education row. is_professional drives the deterministic ordering later
 * (professional/postgrad first, school after — both reverse-chrono).
 */
export const EducationEntrySchema = z.object({
  degree: z
    .string()
    .describe("Degree name as written, e.g. 'M.Com in Accounting'."),
  institution: z.string().describe("School/University as written."),
  year: z
    .string()
    .default("")
    .describe("Graduation year or range as written."),
  result: z
    .string()
    .default("")
    .describe("Class/division/CGPA as written, else empty."),
  is_professional: z
    .boolean()
    .describe(
      "True if this is a professional / postgraduate / clinical degree " +
        "(e.g. MBBS, MD, MS, MPH, MBA, MPhil, PhD, MCom, MA, MSc, FCPS, MRCP, " +
        "CCD, ACCA, CMA, CA, postgraduate diplomas, fellowships). " +
        "False for school-level qualifications (HSC, SSC, A-Level, O-Level, " +
        "GED, Higher Secondary, Secondary School Certificate).",
    ),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

/**
 * Parsed CV — only the static, lossless parts. Experience is NOT here on
 * purpose: it is JD-aware and produced by the experience tailor chain.
 * The miscellaneous "others" section is handled separately too.
 */
export const CvParsedSchema = z.object({
  candidate: CandidateSchema,
  education: z
    .array(EducationEntrySchema)
    .describe("All education entries from the CV."),
});
export type CvParsed = z.infer<typeof CvParsedSchema>;

// ============================================================================
// SECTION OUTPUT SCHEMAS — one per CV section the agent produces
// ============================================================================

/** Career Summary — one tailored paragraph. */
export const CareerSummarySchema = z.object({
  summary: z
    .string()
    .min(40)
    .describe(
      "One concise paragraph (3-5 sentences) following the formula: " +
        "[Total years of experience] + [Most recent / notable companies] + " +
        "[Type of work / domain] + [Last one or two degrees]. " +
        "Tailored toward the JD's seniority, industry, and must-have skills, " +
        "but only using facts present in the raw CV. No fabrication.",
    ),
});
export type CareerSummary = z.infer<typeof CareerSummarySchema>;

/** Experience — reverse-chrono roles, each with tailored bullets. */
export const ExperienceBulletSchema = z.object({
  text: z
    .string()
    .describe(
      "One concise CV bullet, action-oriented, ATS-friendly, truthful.",
    ),
});
export type ExperienceBullet = z.infer<typeof ExperienceBulletSchema>;

export const ExperienceRoleSchema = z.object({
  company: z.string().describe("Employer name as it appears in the CV."),
  title: z.string().describe("Job title as it appears in the CV."),
  dates: z.string().describe("Date range as it appears in the CV."),
  location: z
    .string()
    .default("")
    .describe("Location if available, else empty."),
  bullets: z
    .array(ExperienceBulletSchema)
    .describe(
      "Tailored bullets for this role. Every bullet must be supported by " +
        "the raw CV. Emphasize JD-relevant tools, domains, scale, leadership " +
        "— but only when supported. No fabrication. 4-7 bullets per role.",
    ),
});
export type ExperienceRole = z.infer<typeof ExperienceRoleSchema>;

export const ExperienceSectionSchema = z.object({
  roles: z
    .array(ExperienceRoleSchema)
    .describe(
      "All roles in REVERSE-CHRONOLOGICAL order (most recent first).",
    ),
});
export type ExperienceSection = z.infer<typeof ExperienceSectionSchema>;

/** Training — extract every item, mark relevance to the JD. */
export const TrainingItemSchema = z.object({
  title: z.string().describe("Training / certification name as in CV."),
  provider: z
    .string()
    .default("")
    .describe("Issuing body or provider, if available."),
  year: z.string().default("").describe("Year obtained, if available."),
  keep: z
    .boolean()
    .describe(
      "True if this training is relevant to the JD's industry, must-have " +
        "skills, or domain. False if it is generic, outdated, or unrelated. " +
        "Borderline cases: keep it.",
    ),
  reason: z
    .string()
    .describe(
      "One short sentence (under 20 words) explaining the keep/drop " +
        "decision. Reference the JD when keeping (e.g. 'Matches JD must-have " +
        "Power BI'). Reference irrelevance when dropping (e.g. 'First Aid " +
        "training is unrelated to this software-engineering role'). Used for " +
        "debugging — never rendered to the candidate's CV.",
    ),
});
export type TrainingItem = z.infer<typeof TrainingItemSchema>;

export const TrainingSectionSchema = z.object({
  items: z
    .array(TrainingItemSchema)
    .describe(
      "Every training/certification from the raw CV, with a keep/drop decision.",
    ),
});
export type TrainingSection = z.infer<typeof TrainingSectionSchema>;

/** Others — every miscellaneous titled subsection of the CV. */
export const OthersGroupSchema = z.object({
  title: z
    .string()
    .describe(
      "The section header as it appears in the CV " +
        "(e.g. 'Computer Skills', 'Languages', 'Personal Details', " +
        "'Hobbies', 'Memberships', 'Awards'). Use the CV's wording.",
    ),
  items: z
    .array(z.string())
    .describe(
      "The bullet points / lines under that header, verbatim. " +
        "For 'Personal Details', each item is one 'Label: value' line " +
        "(e.g. \"Father's Name: ...\", 'Date of Birth: ...', " +
        "'Marital Status: ...'). Preserve the CV's wording.",
    ),
});
export type OthersGroup = z.infer<typeof OthersGroupSchema>;

export const OthersSectionSchema = z.object({
  groups: z
    .array(OthersGroupSchema)
    .describe(
      "Every miscellaneous titled subsection found in the CV that is NOT " +
        "Experience, Education, Training/Courses, References, or Career " +
        "Summary. Empty list if none.",
    ),
});
export type OthersSection = z.infer<typeof OthersSectionSchema>;

/** References — projected to exactly five fields. */
export const ReferenceSchema = z.object({
  name: z.string().describe("Full name as in CV."),
  designation: z.string().default("").describe("Job title."),
  company: z.string().default("").describe("Organization or company name."),
  mobile: z.string().default("").describe("Phone number, if available."),
  email: z.string().default("").describe("Email address, if available."),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const ReferenceSectionSchema = z.object({
  references: z
    .array(ReferenceSchema)
    .describe(
      "All references from the raw CV. Project to exactly five fields each. " +
        "If the CV has no references section, return an empty list.",
    ),
});
export type ReferenceSection = z.infer<typeof ReferenceSectionSchema>;

// ============================================================================
// CRITIC SCHEMAS — used by reflexion loops in Phase 4
// ============================================================================

/**
 * Generic critic verdict. Reused by summary/experience/references critics.
 * `pass` decides whether the loop exits. `notes` feeds the reviser.
 */
export const CritiqueSchema = z.object({
  pass: z
    .boolean()
    .describe(
      "True if the section is grounded, on-spec, and ready to ship. " +
        "False if the reviser must fix at least one issue from `notes`.",
    ),
  notes: z
    .array(z.string())
    .describe(
      "One short note per issue. Empty when pass=true. Each note is a " +
        "concrete instruction the reviser can act on (e.g. 'Bullet 3 in " +
        "role 1 mentions Python — not in CV; remove').",
    ),
});
export type Critique = z.infer<typeof CritiqueSchema>;
