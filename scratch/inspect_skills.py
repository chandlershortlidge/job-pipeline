"""Eyeball the raw extraction to plan normalization (Phase 2).

Shows document frequency (jobs per skill) using a case-folded canonical, and the
distinct spellings that fold together — so we can see what the alias map must catch.

Run:  uv run scratch/inspect_skills.py
"""
import collections
import json
from pathlib import Path

d = json.loads(Path("data/extracted.json").read_text())
jobs = d["jobs"]

df = collections.Counter()              # jobs-per-skill (case-folded)
variants = collections.defaultdict(set)  # case-folded -> {raw canonical spellings}
for j in jobs:
    seen = set()
    for s in j["skills"]:
        c = s["canonical"].strip()
        key = c.lower()
        variants[key].add(c)
        if key not in seen:
            df[key] += 1
            seen.add(key)

print(f"{len(jobs)} jobs, {len(df)} distinct skills (case-folded)\n")
print("doc-freq  skill (spellings that fold together)")
for key, cnt in df.most_common():
    vs = sorted(variants[key])
    show = vs[0] if len(vs) == 1 else " | ".join(vs)
    flag = "  <-- case dupes" if len(vs) > 1 else ""
    print(f"  {cnt:2}      {show}{flag}")
