"""Phase 2 — Normalization (deterministic, runs once over the whole pool).

Reads data/extracted.json (raw per-job extraction), cleans the skill names with
plain code, aggregates, and writes dashboard/public/jobs.json for the React app.

The three steps, in order (see the plan's "Where normalization must live"):
  1. split known slash-lists ("GCP/AWS/Azure" -> 3 skills); CI/CD etc. are protected
  2. case-fold (group by lowercase; display = the most common spelling seen)
  3. apply a small, conservative hand-written alias map for real synonyms

Run:  uv run normalize.py
"""

import collections
import json
from pathlib import Path

IN_PATH = Path("data/extracted.json")
OUT_PATH = Path("dashboard/public/jobs.json")

# 1. Known multi-skill slash-lists to split. Only these split; everything else
#    (CI/CD, A/B Testing, ETL/ELT, ...) is left intact.
SPLITS = {
    "gcp/aws/azure": ["GCP", "AWS", "Azure"],
    "n8n/make/zapier": ["n8n", "Make", "Zapier"],
    "bigquery/snowflake": ["BigQuery", "Snowflake"],
}

# 3. Conservative alias map: lowercased spelling -> canonical display name.
#    Only merges we've eyeballed in the real data. When unsure, leave separate.
ALIASES = {
    "llm apis": "LLMs",
    "llm orchestration": "LLMs",
    "apache airflow": "Airflow",
    "version control": "Git",
    "github": "Git",
}


def split_skill(canonical: str) -> list[str]:
    key = canonical.strip().lower()
    if key in SPLITS:
        return SPLITS[key]
    return [canonical.strip()]


def main():
    data = json.loads(IN_PATH.read_text())
    jobs = data["jobs"]

    # Pass 1: pick a display spelling per case-folded key = the most common one seen.
    spelling_counts: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for job in jobs:
        for s in job["skills"]:
            for part in split_skill(s["canonical"]):
                spelling_counts[part.lower()][part] += 1
    display = {key: c.most_common(1)[0][0] for key, c in spelling_counts.items()}

    def resolve(part: str) -> str:
        key = part.strip().lower()
        if key in ALIASES:
            return ALIASES[key]
        return display.get(key, part.strip())

    # Pass 2: rebuild each job's skills with normalized canonical, distinct per job.
    # Also collect, per final canonical, the distinct model-canonical spellings that
    # folded into it — the clean "merged from" reveal for the chart.
    variants: dict[str, set] = collections.defaultdict(set)
    out_jobs = []
    for job in jobs:
        by_canon: dict[str, dict] = {}
        for s in job["skills"]:
            for part in split_skill(s["canonical"]):
                canon = resolve(part)
                variants[canon].add(s["raw_text"].strip())
                if canon not in by_canon:
                    by_canon[canon] = {"canonical": canon, "raw_text": s["raw_text"], "requirement": s["requirement"]}
                elif s["requirement"] == "required":
                    by_canon[canon]["requirement"] = "required"  # prefer required if any mention is
        out_jobs.append({
            "id": job["id"],
            "company": job["company"],
            "title": job["title"],
            "seniority": job["seniority"],
            "seniority_signal": job["seniority_signal"],
            "seniority_basis": job["seniority_basis"],
            "summary": job["summary"],
            "source": job.get("source", "screenshot"),
            "skills": list(by_canon.values()),
        })

    # "merged from" map: final canonical -> the distinct raw phrasings that folded in.
    # Keep short, skill-like phrases (drop full JD sentences), dedupe case-insensitively,
    # drop the canonical itself, cap for display.
    def clean_variants(canon, raws):
        seen = {}
        for r in sorted(raws, key=len):
            r = r.strip()
            low = r.lower()
            if not r or len(r) > 40 or low == canon.lower() or low in seen:
                continue
            seen[low] = r
        return sorted(seen.values())[:6]

    skill_variants = {}
    for canon, raws in variants.items():
        cv = clean_variants(canon, raws)
        if cv:
            skill_variants[canon] = cv

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(
        {"generated_at": data.get("generated_at"), "jobs": out_jobs, "skill_variants": skill_variants},
        indent=2, ensure_ascii=False,
    ))

    # --- eyeball: the ranked chart (document frequency), default view (required + >=2) ---
    df_required = collections.Counter()
    df_all = collections.Counter()
    companies = set()
    canon_all = set()
    for job in out_jobs:
        if job["company"]:
            companies.add(job["company"].strip().lower())
        req_seen, all_seen = set(), set()
        for s in job["skills"]:
            canon_all.add(s["canonical"])
            if s["canonical"] not in all_seen:
                df_all[s["canonical"]] += 1
                all_seen.add(s["canonical"])
            if s["requirement"] == "required" and s["canonical"] not in req_seen:
                df_required[s["canonical"]] += 1
                req_seen.add(s["canonical"])

    print(f"Wrote {OUT_PATH}")
    print(f"Stats: {len(out_jobs)} jobs · {len(canon_all)} skills · {len(companies)} companies\n")
    print("Default chart (required-only, document-freq >= 2):")
    for skill, cnt in df_required.most_common():
        if cnt >= 2:
            print(f"  {cnt:2}  {skill}")


if __name__ == "__main__":
    main()
