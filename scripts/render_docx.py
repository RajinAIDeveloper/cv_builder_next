import json
import sys
from pathlib import Path
from types import SimpleNamespace

from docxtpl import DocxTemplate
from jinja2 import Environment, StrictUndefined


def lines(section):
    return [line.strip() for line in section.get("content", []) if line.strip()]


def section_map(payload):
    return {section["id"]: lines(section) for section in payload.get("sections", [])}


def pair_groups(groups):
    rows = []
    for index in range(0, len(groups), 2):
        rows.append((groups[index], groups[index + 1] if index + 1 < len(groups) else None))
    return rows


def obj(value):
    if isinstance(value, dict):
        return SimpleNamespace(**{key: obj(item) for key, item in value.items()})
    if isinstance(value, list):
        return [obj(item) for item in value]
    if isinstance(value, tuple):
        return tuple(obj(item) for item in value)
    return value


def context_from_payload(payload):
    sections = section_map(payload)
    candidate_name = payload.get("candidateName") or "Candidate"
    jd_title = payload.get("jdTitle") or "Target role"

    summary_lines = sections.get("summary", [])
    experience_lines = sections.get("experience", [])
    education_lines = sections.get("education", [])
    training_lines = sections.get("training", [])
    other_lines = sections.get("others", [])
    reference_lines = sections.get("references", [])

    others = [{"title": "Others", "items": other_lines}] if other_lines else []

    context = {
        "jd": {
            "title": jd_title,
            "seniority": "",
            "domain": "",
            "must_have_skills": [],
            "nice_to_have_skills": [],
            "responsibilities": [],
            "years_experience_required": "",
        },
        "candidate": {
            "name": candidate_name,
            "location": "",
            "phone": "",
            "email": "",
        },
        "summary": {"summary": " ".join(summary_lines)},
        "experience": {
            "roles": [
                {
                    "company": "",
                    "title": "Tailored Experience",
                    "dates": "",
                    "location": "",
                    "bullets": [{"text": line} for line in experience_lines],
                }
            ]
            if experience_lines
            else []
        },
        "education": [
            {
                "degree": line,
                "institution": "",
                "year": "",
                "result": "",
                "is_professional": True,
            }
            for line in education_lines
        ],
        "training": [
            {"title": line, "provider": "", "year": "", "keep": True}
            for line in training_lines
        ],
        "references": [
            {
                "name": line,
                "designation": "",
                "company": "",
                "mobile": "",
                "email": "",
            }
            for line in reference_lines
        ],
        "others": others,
        "others_rows": pair_groups(others),
        "photo": None,
    }
    return {key: obj(value) for key, value in context.items()}


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: render_docx.py payload.json template.docx output.docx")

    payload_path = Path(sys.argv[1])
    template_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])

    payload = json.loads(payload_path.read_text(encoding="utf-8-sig"))
    context = context_from_payload(payload)

    template = DocxTemplate(str(template_path))
    template.render(context, jinja_env=Environment(undefined=StrictUndefined))
    template.save(str(output_path))


if __name__ == "__main__":
    main()
