type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
    };

const jdMarkers = [
  "job description",
  "job title",
  "key responsibilities",
  "requirements",
  "salary range",
  "employment type",
  "probation period",
  "working days",
  "reports to",
  "how to apply",
  "about the company",
  "about ",
];

const cvMarkers = [
  "curriculum vitae",
  "resume",
  "career summary",
  "professional summary",
  "experience",
  "employment history",
  "career history",
  "work history",
  "education",
  "academic",
  "training",
  "reference",
];

export function validateCvAndJdInputs(rawCv: string, rawJd: string): ValidationResult {
  const cv = normalize(rawCv);
  const jd = normalize(rawJd);

  if (looksLikeJobDescription(cv) && !looksLikeCandidateCv(cv)) {
    return {
      ok: false,
      message:
        "The CV input looks like a job description, not a candidate CV. " +
        "Put the candidate resume in the CV box and the job post in the JD box.",
    };
  }

  if (looksLikeCandidateCv(jd) && !looksLikeJobDescription(jd)) {
    return {
      ok: false,
      message:
        "The JD input looks like a candidate CV. The CV and JD may be swapped.",
    };
  }

  return { ok: true };
}

function looksLikeJobDescription(text: string) {
  const hits = countHits(text, jdMarkers);
  const hasApplyInstruction = /apply|send your resume|share your resume|whatsapp|salary/i.test(text);
  return hits >= 3 || (hits >= 2 && hasApplyInstruction);
}

function looksLikeCandidateCv(text: string) {
  const hits = countHits(text, cvMarkers);
  const hasEmail = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text);
  const hasPhone = /(?:\+?\d[\d\s().-]{7,}\d)/.test(text);
  return hits >= 2 || (hits >= 1 && (hasEmail || hasPhone));
}

function countHits(text: string, markers: string[]) {
  return markers.reduce((count, marker) => (text.includes(marker) ? count + 1 : count), 0);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
