#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pydantic>=2.6",
#     "ruamel.yaml>=0.18",
#     "jinja2>=3.1",
# ]
# ///
"""Build the AgentArena static stats site.

Walks every test.yaml + run.yaml under /tests, aggregates leaderboard /
contributor / theme stats, and renders a single static page (plus a
stats.json companion) into /site.

Just run it — dependencies install themselves on first run into the same
scripts/.venv used by cli.py:

    scripts/build_site.py                # build into ./site
    scripts/build_site.py --out public   # build into ./public
    scripts/build_site.py --github-url https://github.com/foo/bar
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# ----------------------------------------------------------------------------
# Self-bootstrap: shares scripts/.venv with cli.py. Same pattern, smaller deps.
# ----------------------------------------------------------------------------

_DEPS = (
    "pydantic>=2.6",
    "ruamel.yaml>=0.18",
    "jinja2>=3.1",
)
_VENV = Path(__file__).resolve().parent / ".venv"
_VENV_PY = _VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python3")


def _have_deps() -> bool:
    try:
        import jinja2       # noqa: F401
        import pydantic     # noqa: F401
        import ruamel.yaml  # noqa: F401
        return True
    except ImportError:
        return False


def _fail_setup(summary: str, hint: str, *, detail: str = "") -> None:
    sys.stderr.write(f"\n[build_site setup] {summary}\n")
    if detail:
        sys.stderr.write(f"  {detail}\n")
    sys.stderr.write(f"\n{hint}\n")
    sys.exit(1)


def _bootstrap() -> None:
    try:
        if _VENV.is_dir() and os.path.samefile(sys.prefix, _VENV):
            return
    except (FileNotFoundError, OSError):
        pass

    if _have_deps():
        return

    if not _VENV_PY.exists():
        if sys.version_info < (3, 11):
            current = ".".join(map(str, sys.version_info[:3]))
            _fail_setup(
                f"Python 3.11+ is required, but you're running Python {current}.",
                hint=f"Install a newer Python, then invoke explicitly:\n  python3.11 {sys.argv[0]}",
            )
        sys.stderr.write("Setting up build dependencies in scripts/.venv (first run)...\n")
        try:
            subprocess.run([sys.executable, "-m", "venv", str(_VENV)], check=True)
        except subprocess.CalledProcessError as e:
            _fail_setup(
                "Failed to create the virtual environment at scripts/.venv.",
                detail=f"`python -m venv` exited with status {e.returncode}",
                hint="On Debian/Ubuntu, install python3-venv first (sudo apt install python3-venv).",
            )

    sys.stderr.write("Installing build dependencies...\n")
    try:
        subprocess.run(
            [str(_VENV_PY), "-m", "pip", "install", "--quiet", *_DEPS],
            check=True,
        )
    except subprocess.CalledProcessError as e:
        _fail_setup(
            "Failed to install build dependencies into scripts/.venv.",
            detail=f"`pip install` exited with status {e.returncode}",
            hint=f"To install manually:\n  {_VENV_PY} -m pip install {' '.join(_DEPS)}",
        )

    args = [str(_VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]]
    if sys.platform == "win32":
        sys.exit(subprocess.run(args).returncode)
    try:
        os.execv(str(_VENV_PY), args)
    except OSError as e:
        _fail_setup(
            "Could not re-launch the build script inside its virtual environment.",
            detail=f"os.execv failed: {e}",
            hint=f"Try invoking the venv's Python directly:\n  {_VENV_PY} {Path(__file__).resolve()}",
        )


_bootstrap()

# ----------------------------------------------------------------------------
# Real imports — guaranteed available now.
# ----------------------------------------------------------------------------

import argparse
import json
import re
import shutil
import typing
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Optional
from urllib.parse import urlparse

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from ruamel.yaml import YAML

# --------------------------------------------------------------------------- #
# Schemas — kept in sync with /agent-arena-cli.py. Duplicated rather than
# imported so this script stays standalone and doesn't drag typer/questionary
# along.
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = REPO_ROOT / "tests"
TEMPLATE_DIR = Path(__file__).resolve().parent / "site_template"
CONTRIBUTE_TPL_DIR = TEMPLATE_DIR / "contribute"

RATINGS = ("excellent", "good", "partial", "failed")
RATING_SCORE = {"excellent": 1.0, "good": 0.75, "partial": 0.4, "failed": 0.0}
RATING_COLOR = {
    "excellent": "#34d399",   # emerald-400
    "good":      "#7dd3fc",   # sky-300
    "partial":   "#fbbf24",   # amber-400
    "failed":    "#f87171",   # red-400
}

DomainT = Literal[
    "full-stack-web", "backend", "frontend", "cli",
    "mobile", "game", "data", "library", "other",
]
ThemeT = Literal[
    "bootstrap", "features", "refinements", "refactor",
    "extension", "performance", "security", "other",
]
THEMES: tuple[str, ...] = typing.get_args(ThemeT)


class Hardware(BaseModel, extra="allow"):
    device: Optional[str] = None
    gpu: Optional[str] = None
    vram_gb: Optional[int] = None
    ram_gb: Optional[int] = None


class Agent(BaseModel):
    name: str
    plan: Optional[str] = None


class RunStage(BaseModel):
    id: str
    duration_sec: int = Field(ge=0)
    tokens_in: Optional[int] = Field(default=None, ge=0)
    tokens_out: Optional[int] = Field(default=None, ge=0)
    cost_usd: Optional[float] = Field(default=None, ge=0)
    rating: Literal["excellent", "good", "partial", "failed"]
    notes: Optional[str] = None


class Run(BaseModel):
    contributor_url: str
    date: date
    agent: Agent
    provider: str
    framework: Optional[str] = None
    model: str
    quantization: Optional[str] = None
    settings: dict[str, Any] = Field(default_factory=dict)
    hardware: Optional[Hardware] = None
    stages: list[RunStage]

    @field_validator("contributor_url")
    @classmethod
    def _check_contributor_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("must be a URL starting with http:// or https://")
        return v

    @model_validator(mode="after")
    def _require_framework_for_self_hosted(self) -> "Run":
        if self.provider == "self-hosted" and not (self.framework and self.framework.strip()):
            raise ValueError("framework is required when provider is 'self-hosted'")
        return self


class TestStage(BaseModel):
    id: str
    theme: ThemeT
    prompt: str
    builds_on: Optional[str] = None


class Test(BaseModel):
    contributor_url: str
    name: str
    title: str
    description: str
    domain: Optional[DomainT] = None
    stages: list[TestStage]

    @field_validator("contributor_url")
    @classmethod
    def _check_contributor_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("must be a URL starting with http:// or https://")
        return v


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #


yaml = YAML(typ="safe")


@dataclass
class LoadedRun:
    test_name: str
    run_id: str
    run: Run


@dataclass
class LoadedTest:
    test: Test
    runs: list[LoadedRun] = field(default_factory=list)


def _warn(msg: str) -> None:
    sys.stderr.write(f"[warn] {msg}\n")


def load_all() -> dict[str, LoadedTest]:
    tests: dict[str, LoadedTest] = {}
    if not TESTS_DIR.is_dir():
        return tests
    for test_dir in sorted(TESTS_DIR.iterdir()):
        test_yaml = test_dir / "test.yaml"
        if not test_yaml.is_file():
            continue
        try:
            t = Test.model_validate(yaml.load(test_yaml.read_text(encoding="utf-8")))
        except (ValidationError, Exception) as e:
            _warn(f"skipping invalid test '{test_dir.name}': {e}")
            continue
        loaded = LoadedTest(test=t)

        results_dir = test_dir / "results"
        if results_dir.is_dir():
            for run_dir in sorted(results_dir.iterdir()):
                run_yaml = run_dir / "run.yaml"
                if not run_yaml.is_file():
                    continue
                try:
                    r = Run.model_validate(yaml.load(run_yaml.read_text(encoding="utf-8")))
                except (ValidationError, Exception) as e:
                    _warn(f"skipping invalid run '{test_dir.name}/{run_dir.name}': {e}")
                    continue
                loaded.runs.append(LoadedRun(test_name=t.name, run_id=run_dir.name, run=r))

        tests[t.name] = loaded
    return tests


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def load_catalog(filename: str) -> dict[str, dict]:
    """Read a repo-root catalog file (agents.json or providers.json) and return
    a dict keyed by `id`. Each value carries the entry's display metadata
    (name, description, homepage, category, logo) for the site to render."""
    path = REPO_ROOT / filename
    if not path.is_file():
        _warn(f"missing catalog {filename}; entries will have no metadata")
        return {}
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        _warn(f"{filename}: invalid JSON: {e}")
        return {}
    out: dict[str, dict] = {}
    for entry in entries:
        if isinstance(entry, dict) and "id" in entry:
            out[entry["id"]] = entry
    return out


def handle_from_url(url: str) -> str:
    parsed = urlparse(url.strip())
    parts = [p for p in parsed.path.split("/") if p]
    if parts:
        return parts[-1]
    netloc = parsed.netloc.removeprefix("www.")
    return netloc.split(".")[0] if netloc else url


def avatar_from_url(url: str) -> Optional[str]:
    """If `url` is a github.com profile, return its avatar PNG URL.
    GitHub serves `https://github.com/<handle>.png` for any public account."""
    try:
        parsed = urlparse(url.strip())
        host = parsed.netloc.removeprefix("www.").lower()
        parts = [p for p in parsed.path.split("/") if p]
        if host == "github.com" and parts:
            return f"https://github.com/{parts[0]}.png?size=160"
    except (ValueError, AttributeError):
        pass
    return None


def safe_avg(values: list[float]) -> Optional[float]:
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def rating_score(stages: list[RunStage]) -> Optional[float]:
    if not stages:
        return None
    return sum(RATING_SCORE[s.rating] for s in stages) / len(stages)


def total_cost(stages: list[RunStage]) -> Optional[float]:
    costs = [s.cost_usd for s in stages if s.cost_usd is not None]
    return sum(costs) if costs else None


def total_duration(stages: list[RunStage]) -> int:
    return sum(s.duration_sec for s in stages)


# --------------------------------------------------------------------------- #
# Aggregations
# --------------------------------------------------------------------------- #


def build_leaderboard(loaded: dict[str, LoadedTest]) -> list[dict]:
    """Group runs by (agent, provider, model). One row per combination."""
    groups: dict[tuple[str, str, str], list[LoadedRun]] = defaultdict(list)
    for lt in loaded.values():
        for lr in lt.runs:
            key = (lr.run.agent.name, lr.run.provider, lr.run.model)
            groups[key].append(lr)

    rows: list[dict] = []
    for (agent_name, provider, model), runs in groups.items():
        all_stages = [s for lr in runs for s in lr.run.stages]
        if not all_stages:
            continue
        score = rating_score(all_stages)
        excellent_good = sum(1 for s in all_stages if s.rating in ("excellent", "good"))
        success_rate = excellent_good / len(all_stages)
        costs = [s.cost_usd for s in all_stages if s.cost_usd is not None]
        avg_cost = sum(costs) / len(costs) if costs else None
        avg_dur = sum(s.duration_sec for s in all_stages) / len(all_stages)
        rating_per_dollar = (score / avg_cost) if (score is not None and avg_cost and avg_cost > 0) else None

        rows.append({
            "agent": agent_name,
            "provider": provider,
            "model": model,
            "run_count": len(runs),
            "stage_count": len(all_stages),
            "test_count": len({lr.test_name for lr in runs}),
            "avg_rating_score": score,
            "success_rate": success_rate,
            "avg_cost_per_stage": avg_cost,
            "avg_duration_sec": avg_dur,
            "rating_per_dollar": rating_per_dollar,
        })

    rows.sort(key=lambda r: (r["avg_rating_score"] or 0, r["run_count"]), reverse=True)
    return rows


def build_scatter(loaded: dict[str, LoadedTest]) -> list[dict]:
    """One point per model — aggregates every run and stage of that model.
    X = avg cost per stage, Y = avg rating score, size = total runs."""
    by_model_stages:    dict[str, list[RunStage]]   = defaultdict(list)
    by_model_runs:      dict[str, list[LoadedRun]]  = defaultdict(list)
    by_model_tests:     dict[str, set[str]]         = defaultdict(set)
    by_model_providers: dict[str, set[str]]         = defaultdict(set)
    by_model_agents:    dict[str, set[str]]         = defaultdict(set)

    for lt in loaded.values():
        for lr in lt.runs:
            model = lr.run.model
            by_model_stages[model].extend(lr.run.stages)
            by_model_runs[model].append(lr)
            by_model_tests[model].add(lt.test.name)
            by_model_providers[model].add(lr.run.provider)
            by_model_agents[model].add(lr.run.agent.name)

    points: list[dict] = []
    for model, stages in by_model_stages.items():
        if not stages:
            continue
        score = rating_score(stages)
        costs = [s.cost_usd for s in stages if s.cost_usd is not None]
        avg_cost = sum(costs) / len(costs) if costs else None
        if score is None or avg_cost is None:
            continue
        points.append({
            "x":           avg_cost,
            "y":           score,
            "label":       model,
            "model":       model,
            "providers":   sorted(by_model_providers[model]),
            "agents":      sorted(by_model_agents[model]),
            "run_count":   len(by_model_runs[model]),
            "stage_count": len(stages),
            "test_count":  len(by_model_tests[model]),
        })
    points.sort(key=lambda p: p["run_count"], reverse=True)
    return points


def build_theme_stats(loaded: dict[str, LoadedTest]) -> list[dict]:
    """For each theme, count stages by rating across all runs."""
    # Map stage_id -> theme via each test's definition.
    rows: dict[str, dict[str, int]] = {t: {r: 0 for r in RATINGS} for t in THEMES}
    for lt in loaded.values():
        theme_by_stage = {s.id: s.theme for s in lt.test.stages}
        for lr in lt.runs:
            for s in lr.run.stages:
                theme = theme_by_stage.get(s.id)
                if theme is None:
                    continue
                rows[theme][s.rating] += 1
    out = []
    for theme in THEMES:
        counts = rows[theme]
        total = sum(counts.values())
        if total == 0:
            continue
        out.append({
            "theme": theme,
            "total": total,
            "counts": counts,
        })
    return out


def _run_summary(lr: LoadedRun, lt: LoadedTest) -> dict:
    score = rating_score(lr.run.stages)
    cost = total_cost(lr.run.stages)
    return {
        "run_id": lr.run_id,
        "test_name": lt.test.name,
        "test_title": lt.test.title,
        "agent": lr.run.agent.name,
        "agent_plan": lr.run.agent.plan,
        "provider": lr.run.provider,
        "framework": lr.run.framework,
        "model": lr.run.model,
        "quantization": lr.run.quantization,
        "contributor_url": lr.run.contributor_url,
        "contributor_handle": handle_from_url(lr.run.contributor_url),
        "contributor_avatar": avatar_from_url(lr.run.contributor_url),
        "date": lr.run.date.isoformat(),
        "stages_run": len(lr.run.stages),
        "stages_total": len(lt.test.stages),
        "avg_rating_score": score,
        "total_cost_usd": cost,
        "total_duration_sec": total_duration(lr.run.stages),
        "stages": [
            {
                "id": s.id,
                "rating": s.rating,
                "duration_sec": s.duration_sec,
                "tokens_in": s.tokens_in,
                "tokens_out": s.tokens_out,
                "cost_usd": s.cost_usd,
                "notes": s.notes,
            }
            for s in lr.run.stages
        ],
        "hardware": lr.run.hardware.model_dump() if lr.run.hardware else None,
        "settings": lr.run.settings,
    }


def build_per_test(loaded: dict[str, LoadedTest]) -> list[dict]:
    """One card per test, with its full stage definitions and ranked runs."""
    out = []
    for lt in sorted(loaded.values(), key=lambda x: x.test.name):
        run_summaries = [_run_summary(lr, lt) for lr in lt.runs]
        run_summaries.sort(key=lambda r: (r["avg_rating_score"] or 0), reverse=True)
        out.append({
            "name": lt.test.name,
            "title": lt.test.title,
            "description": lt.test.description.strip(),
            "domain": lt.test.domain,
            "contributor_url":    lt.test.contributor_url,
            "contributor_handle": handle_from_url(lt.test.contributor_url),
            "contributor_avatar": avatar_from_url(lt.test.contributor_url),
            "stages_total": len(lt.test.stages),
            "test_stages": [
                {"id": s.id, "theme": s.theme, "prompt": s.prompt, "builds_on": s.builds_on}
                for s in lt.test.stages
            ],
            "run_count": len(lt.runs),
            "runs": run_summaries,
        })
    return out


def _build_grouped(
    loaded: dict[str, LoadedTest],
    key_fn,
    cross_fn,
    catalog: dict[str, dict],
    *,
    self_key: str,
    cross_key: str,
    top_combo_fn=None,
) -> list[dict]:
    """Shared aggregator used by build_per_agent, build_per_provider, build_per_model.

    `key_fn(run) -> str` picks the grouping id (e.g. agent name or provider).
    `cross_fn(run) -> str` picks the cross-reference id for the table on the
    detail page (the other axis). `catalog` adds display metadata when the id
    is in /agents.json or /providers.json; ids missing from the catalog still
    get a row (using the raw id as the display name).
    `top_combo_fn(run) -> str` produces the "top combo" headline. Defaults to
    "<cross> · <model>", which is right for agents/providers but redundant for
    models (the model is the thing being described); models override it.
    """
    if top_combo_fn is None:
        top_combo_fn = lambda r: f"{cross_fn(r)} · {r.model}"
    groups: dict[str, list[tuple[LoadedTest, LoadedRun]]] = defaultdict(list)
    for lt in loaded.values():
        for lr in lt.runs:
            groups[key_fn(lr.run)].append((lt, lr))

    out: list[dict] = []
    for gid, items in groups.items():
        meta = catalog.get(gid, {})
        all_stages = [s for _, lr in items for s in lr.run.stages]

        # Cross-reference rollup: counts and top score for each "other axis" id
        # encountered among this group's runs.
        cross: dict[str, dict] = defaultdict(lambda: {"run_count": 0, "stages": []})
        for lt, lr in items:
            cid = cross_fn(lr.run)
            cross[cid]["run_count"] += 1
            cross[cid]["stages"].extend(lr.run.stages)
        cross_rows = [
            {
                cross_key:          cid,
                "run_count":        cell["run_count"],
                "stage_count":      len(cell["stages"]),
                "avg_rating_score": rating_score(cell["stages"]),
            }
            for cid, cell in cross.items()
        ]
        cross_rows.sort(key=lambda r: (r["avg_rating_score"] or 0, r["run_count"]), reverse=True)

        # Per-test rollup: one row per test this agent/provider has runs against.
        tests: dict[str, dict] = defaultdict(lambda: {"run_count": 0, "stages": [], "title": ""})
        for lt, lr in items:
            cell = tests[lt.test.name]
            cell["run_count"] += 1
            cell["stages"].extend(lr.run.stages)
            cell["title"] = lt.test.title
        test_rows = [
            {
                "test_name":        name,
                "test_title":       cell["title"],
                "run_count":        cell["run_count"],
                "stage_count":      len(cell["stages"]),
                "avg_rating_score": rating_score(cell["stages"]),
            }
            for name, cell in tests.items()
        ]
        test_rows.sort(key=lambda r: (r["avg_rating_score"] or 0, r["run_count"]), reverse=True)

        # Pick a "top combo" headline — best-scoring cross-axis paired with the
        # most-used model among this group's runs.
        top_combo = None
        if items:
            best_stages: list[RunStage] = []
            best_score = -1.0
            for lt, lr in items:
                s = rating_score(lr.run.stages) or 0
                if s > best_score:
                    best_score = s
                    best_stages = [lr]
            if best_stages:
                lr = best_stages[0]
                top_combo = top_combo_fn(lr.run)

        # Per-day run counts → "usage over time" chart on the detail page.
        by_date: dict[str, int] = defaultdict(int)
        for _, lr in items:
            by_date[lr.run.date.isoformat()] += 1
        activity = [{"date": d, "count": c} for d, c in sorted(by_date.items())]

        out.append({
            "id":                 gid,
            self_key:             gid,                              # convenience alias for the SPA
            "name":               meta.get("name") or gid,
            "description":        meta.get("description"),
            "homepage":           meta.get("homepage"),
            "category":           meta.get("category"),
            "logo":               meta.get("logo"),
            "in_catalog":         gid in catalog,
            "run_count":          len(items),
            "stage_count":        len(all_stages),
            "test_count":         len({lt.test.name for lt, _ in items}),
            "contributor_count":  len({lr.run.contributor_url for _, lr in items}),
            "avg_rating_score":   rating_score(all_stages),
            "total_cost_usd":     total_cost(all_stages),
            "total_duration_sec": sum(s.duration_sec for s in all_stages),
            "top_combo":          top_combo,
            "cross":              cross_rows,
            "tests":              test_rows,
            "activity":           activity,
        })
    out.sort(
        key=lambda r: (r["run_count"], r["stage_count"], r["avg_rating_score"] or 0),
        reverse=True,
    )
    return out


def build_per_agent(loaded: dict[str, LoadedTest], catalog: dict[str, dict]) -> list[dict]:
    """One entry per coding agent used in any run. Each entry carries summary
    stats, a cross-reference of providers used with this agent, the tests it
    has runs against, and the full ranked run list."""
    return _build_grouped(
        loaded,
        key_fn=lambda r: r.agent.name,
        cross_fn=lambda r: r.provider,
        catalog=catalog,
        self_key="agent",
        cross_key="provider",
    )


def build_per_provider(loaded: dict[str, LoadedTest], catalog: dict[str, dict]) -> list[dict]:
    """One entry per inference provider used in any run. Mirror of
    build_per_agent — cross-reference is which agents have been used here."""
    return _build_grouped(
        loaded,
        key_fn=lambda r: r.provider,
        cross_fn=lambda r: r.agent.name,
        catalog=catalog,
        self_key="provider",
        cross_key="agent",
    )


def _slug_model(model_id: str) -> str:
    """URL-and-filename-safe identifier for a model. Hugging Face uses
    'org/repo' paths which would otherwise create unwanted subdirectories
    when used as a file name and break a single-segment URL route."""
    return model_id.replace("/", "__")


# Heuristic: map model id prefixes to the lab that made the model. We don't
# maintain a full catalog (models churn too fast) but a handful of well-known
# families can be detected from the id alone. When a match exists and the
# referenced logo file is in /logos/, we point the model's `logo` field at it
# so the hero shows the lab's mark; otherwise just the display name is set
# (for the "by <vendor>" chip) and the SPA falls back to a first-letter tile.
_VENDOR_PATTERNS: list[tuple[re.Pattern, str, Optional[str]]] = [
    (re.compile(r"^(claude|sonnet|opus|haiku)",  re.I), "Anthropic", "/logos/providers/anthropic.svg"),
    (re.compile(r"^(gpt-|o[3-9])",                re.I), "OpenAI",    None),
    (re.compile(r"^gemini",                       re.I), "Google",    "/logos/providers/gemini.svg"),
    (re.compile(r"^grok",                         re.I), "xAI",       "/logos/providers/xai.svg"),
    (re.compile(r"^deepseek",                     re.I), "DeepSeek",  "/logos/providers/deepseek.svg"),
    (re.compile(r"^(qwen|Qwen/)",                 re.I), "Qwen",      "/logos/agents/qwen-code.svg"),
    (re.compile(r"^(llama|meta-llama/)",          re.I), "Meta",      None),
    (re.compile(r"^(mistral|mixtral|mistralai/)", re.I), "Mistral",   "/logos/providers/mistral.svg"),
]


def _infer_vendor(model_id: str) -> tuple[Optional[str], Optional[str]]:
    """Return (vendor_display_name, logo_path) for a model id, or (None, None)
    when no pattern matches."""
    for pattern, name, logo in _VENDOR_PATTERNS:
        if pattern.search(model_id):
            return name, logo
    return None, None


def build_per_model(loaded: dict[str, LoadedTest]) -> list[dict]:
    """One entry per model identifier used in any run. No catalog file
    backs this (models are too volatile to maintain a fixed list); display
    metadata is left empty and the SPA falls back to the raw id and
    first-letter logo."""
    rows = _build_grouped(
        loaded,
        key_fn=lambda r: r.model,
        cross_fn=lambda r: r.provider,
        catalog={},
        self_key="model",
        cross_key="provider",
        # For a model's "top combo" the cross-axis already implies the model;
        # show provider · agent instead so the headline is informative.
        top_combo_fn=lambda r: f"{r.provider} · {r.agent.name}",
    )
    # The raw id (possibly an HF "org/repo" path) is what we want to display;
    # the URL-safe slug is what we want to route to and write as a filename.
    # We also try to infer the model's vendor (lab that made it) from the id
    # prefix — when it matches, the SPA shows a "by <vendor>" chip and points
    # the logo at the lab's existing brand mark.
    for row in rows:
        original = row["id"]
        row["name"] = original
        row["id"] = _slug_model(original)
        row["model"] = original
        vendor_name, vendor_logo = _infer_vendor(original)
        row["vendor_name"] = vendor_name
        if vendor_logo:
            row["logo"] = vendor_logo
    return rows


def build_all_runs(loaded: dict[str, LoadedTest]) -> list[dict]:
    """Flat list of every run across every test — for the Runs tab."""
    out: list[dict] = []
    for lt in loaded.values():
        for lr in lt.runs:
            out.append(_run_summary(lr, lt))
    out.sort(key=lambda r: r["date"], reverse=True)
    return out


def build_activity(loaded: dict[str, LoadedTest]) -> list[dict]:
    """Run count per date — drives the contributor activity timeline."""
    by_date: dict[str, int] = defaultdict(int)
    for lt in loaded.values():
        for lr in lt.runs:
            by_date[lr.run.date.isoformat()] += 1
    return [{"date": d, "count": c} for d, c in sorted(by_date.items())]


def _stage_perf(stages: list[RunStage]) -> dict:
    """Shared aggregator: avg rating / duration / tokens-per-sec for a stage list."""
    if not stages:
        return {"avg_rating_score": None, "avg_duration_sec": None, "avg_tokens_per_sec": None}
    score = rating_score(stages)
    avg_dur = sum(s.duration_sec for s in stages) / len(stages)
    tok_stages = [s for s in stages if s.tokens_out and s.duration_sec > 0]
    avg_tps = (
        sum(s.tokens_out / s.duration_sec for s in tok_stages) / len(tok_stages)
        if tok_stages else None
    )
    return {
        "avg_rating_score":   score,
        "avg_duration_sec":   avg_dur,
        "avg_tokens_per_sec": avg_tps,
    }


def build_hardware(loaded: dict[str, LoadedTest]) -> dict:
    """Self-hosted-only aggregates for the 'silicon beasts' section.
    Returns headline totals, per-device / per-GPU / per-contributor rankings,
    and a hardware-combo leaderboard sorted by throughput."""
    sh_runs: list[tuple[LoadedTest, LoadedRun, Hardware]] = []
    for lt in loaded.values():
        for lr in lt.runs:
            if lr.run.provider != "self-hosted" or not lr.run.hardware:
                continue
            sh_runs.append((lt, lr, lr.run.hardware))

    empty = {
        "headline":     {"devices": 0, "vram_gb": 0, "ram_gb": 0,
                          "contributors": 0, "runs": 0, "stages": 0},
        "combos":       [],
        "by_device":    [],
        "by_gpu":       [],
        "contributors": [],
    }
    if not sh_runs:
        return empty

    # Unique (contributor, device) → headline VRAM/RAM totals (avoid double-counting
    # the same device when a contributor submits multiple runs from it).
    unique_devices: dict[tuple[str, str], dict[str, int]] = {}
    for _, lr, hw in sh_runs:
        key = (lr.run.contributor_url, hw.device or "(unknown device)")
        cell = unique_devices.setdefault(key, {"vram_gb": 0, "ram_gb": 0})
        cell["vram_gb"] = max(cell["vram_gb"], hw.vram_gb or 0)
        cell["ram_gb"]  = max(cell["ram_gb"],  hw.ram_gb  or 0)
    total_vram = sum(d["vram_gb"] for d in unique_devices.values())
    total_ram  = sum(d["ram_gb"]  for d in unique_devices.values())

    # ── Hardware combos (device + gpu + framework + model + quantization) ──
    combos: dict[tuple[str, ...], list[tuple[LoadedTest, LoadedRun, Hardware]]] = defaultdict(list)
    for lt, lr, hw in sh_runs:
        key = (
            hw.device or "(unknown)",
            hw.gpu or "(none)",
            lr.run.framework or "",
            lr.run.model,
            lr.run.quantization or "",
        )
        combos[key].append((lt, lr, hw))

    combo_rows: list[dict] = []
    for _key, items in combos.items():
        stages = [s for _, lr, _ in items for s in lr.run.stages]
        if not stages:
            continue
        first_hw = items[0][2]
        first_run = items[0][1].run
        # Deduplicated contributors who submitted runs with this exact combo.
        # Sorted by handle so output is stable across builds.
        seen_urls: set[str] = set()
        contribs: list[dict] = []
        for _, lr, _ in items:
            url = lr.run.contributor_url
            if url in seen_urls:
                continue
            seen_urls.add(url)
            contribs.append({"url": url, "handle": handle_from_url(url)})
        contribs.sort(key=lambda c: c["handle"])
        combo_rows.append({
            **_stage_perf(stages),
            "device":            first_hw.device,
            "gpu":               first_hw.gpu,
            "framework":         first_run.framework,
            "model":             first_run.model,
            "quantization":      first_run.quantization,
            "vram_gb":           first_hw.vram_gb,
            "ram_gb":            first_hw.ram_gb,
            "run_count":         len(items),
            "stage_count":       len(stages),
            "contributor_count": len(contribs),
            "contributors":      contribs,
        })
    # Rank by tokens/sec when available, otherwise by inverse avg duration.
    combo_rows.sort(
        key=lambda r: (
            r["avg_tokens_per_sec"] or 0,
            -(r["avg_duration_sec"] or 1e9),
            r["avg_rating_score"]   or 0,
        ),
        reverse=True,
    )
    for i, r in enumerate(combo_rows):
        r["rank"] = i + 1

    # ── Per-device aggregate (device name only) ──
    by_device: dict[str, list] = defaultdict(list)
    for lt, lr, hw in sh_runs:
        by_device[hw.device or "(unknown)"].append((lt, lr, hw))
    device_rows = [
        {
            **_stage_perf([s for _, lr, _ in items for s in lr.run.stages]),
            "device":            dev,
            "run_count":         len(items),
            "stage_count":       sum(len(lr.run.stages) for _, lr, _ in items),
            "contributor_count": len({lr.run.contributor_url for _, lr, _ in items}),
        }
        for dev, items in by_device.items()
    ]
    device_rows.sort(key=lambda r: (r["avg_tokens_per_sec"] or 0, r["stage_count"]), reverse=True)

    # ── Per-GPU aggregate ──
    by_gpu: dict[str, list] = defaultdict(list)
    for lt, lr, hw in sh_runs:
        by_gpu[hw.gpu or "(none)"].append((lt, lr, hw))
    gpu_rows = [
        {
            **_stage_perf([s for _, lr, _ in items for s in lr.run.stages]),
            "gpu":               gpu,
            "run_count":         len(items),
            "stage_count":       sum(len(lr.run.stages) for _, lr, _ in items),
            "contributor_count": len({lr.run.contributor_url for _, lr, _ in items}),
        }
        for gpu, items in by_gpu.items()
    ]
    gpu_rows.sort(key=lambda r: (r["avg_tokens_per_sec"] or 0, r["stage_count"]), reverse=True)

    # ── Per-contributor self-hosted leaderboard ──
    by_contrib: dict[str, list] = defaultdict(list)
    for lt, lr, hw in sh_runs:
        by_contrib[lr.run.contributor_url].append((lt, lr, hw))
    contrib_rows = []
    for url, items in by_contrib.items():
        stages = [s for _, lr, _ in items for s in lr.run.stages]
        devices = sorted({hw.device for _, _, hw in items if hw.device})
        gpus    = sorted({hw.gpu    for _, _, hw in items if hw.gpu})
        total_v = sum(unique_devices[(url, d)]["vram_gb"] for d in devices)
        total_r = sum(unique_devices[(url, d)]["ram_gb"]  for d in devices)
        contrib_rows.append({
            **_stage_perf(stages),
            "url":           url,
            "handle":        handle_from_url(url),
            "avatar_url":    avatar_from_url(url),
            "run_count":     len(items),
            "stage_count":   len(stages),
            "device_count":  len(devices),
            "devices":       devices,
            "gpus":          gpus,
            "total_vram_gb": total_v,
            "total_ram_gb":  total_r,
        })
    contrib_rows.sort(
        key=lambda r: (r["stage_count"], r["total_vram_gb"], r["avg_rating_score"] or 0),
        reverse=True,
    )
    for i, r in enumerate(contrib_rows):
        r["rank"] = i + 1

    return {
        "headline": {
            "devices":      len(unique_devices),
            "vram_gb":      total_vram,
            "ram_gb":       total_ram,
            "contributors": len(by_contrib),
            "runs":         len(sh_runs),
            "stages":       sum(len(lr.run.stages) for _, lr, _ in sh_runs),
        },
        "combos":       combo_rows,
        "by_device":    device_rows,
        "by_gpu":       gpu_rows,
        "contributors": contrib_rows,
    }


def build_contributors(loaded: dict[str, LoadedTest]) -> dict[str, list[dict]]:
    """Per-contributor profiles (ranked) + latest contributions feed."""
    # Pair every run with its containing test so we can build per-contributor run lists.
    by_url: dict[str, list[tuple[LoadedTest, LoadedRun]]] = defaultdict(list)
    for lt in loaded.values():
        for lr in lt.runs:
            by_url[lr.run.contributor_url].append((lt, lr))

    profiles: list[dict] = []
    for url, items in by_url.items():
        all_stages = [s for _, lr in items for s in lr.run.stages]
        score = rating_score(all_stages) if all_stages else None
        costs = [s.cost_usd for s in all_stages if s.cost_usd is not None]
        cost_total = sum(costs) if costs else None
        dur_total  = sum(s.duration_sec for s in all_stages)
        dates = [lr.run.date for _, lr in items]
        latest = max(dates, default=None)
        first  = min(dates, default=None)

        # Most-used provider/model combo — flavor metadata for the hero.
        combos: dict[str, int] = defaultdict(int)
        for _, lr in items:
            combos[f"{lr.run.provider} / {lr.run.model}"] += 1
        top_combo = max(combos.items(), key=lambda x: x[1])[0] if combos else None

        # Favourite rig — most-used (device, gpu) among their self-hosted runs.
        rigs: dict[tuple[str, str], dict] = defaultdict(lambda: {"count": 0, "vram_gb": 0, "ram_gb": 0})
        for _, lr in items:
            if lr.run.provider != "self-hosted" or not lr.run.hardware:
                continue
            hw = lr.run.hardware
            key = (hw.device or "", hw.gpu or "")
            cell = rigs[key]
            cell["count"]   += 1
            cell["vram_gb"]  = max(cell["vram_gb"], hw.vram_gb or 0)
            cell["ram_gb"]   = max(cell["ram_gb"],  hw.ram_gb  or 0)
        if rigs:
            (dev, gpu), meta = max(rigs.items(), key=lambda kv: kv[1]["count"])
            parts = [p for p in (dev, gpu) if p]
            rig_str = " · ".join(parts) if parts else None
            specs = []
            if meta["vram_gb"]: specs.append(f"{meta['vram_gb']} gb vram")
            if meta["ram_gb"]:  specs.append(f"{meta['ram_gb']} gb ram")
            if specs and rig_str: rig_str = f"{rig_str} ({', '.join(specs)})"
            top_rig = rig_str
        else:
            top_rig = None

        # Per-rig (device + gpu) performance for the contributor's hardware panel.
        rigs_agg: dict[tuple[str, str], dict] = defaultdict(lambda: {
            "stages": [], "models": set(), "frameworks": set(),
            "vram_gb": 0, "ram_gb": 0, "run_count": 0,
        })
        for _lt, lr in items:
            if lr.run.provider != "self-hosted" or not lr.run.hardware:
                continue
            hw = lr.run.hardware
            cell = rigs_agg[(hw.device or "", hw.gpu or "")]
            cell["run_count"] += 1
            cell["stages"].extend(lr.run.stages)
            cell["models"].add(lr.run.model)
            if lr.run.framework:
                cell["frameworks"].add(lr.run.framework)
            cell["vram_gb"] = max(cell["vram_gb"], hw.vram_gb or 0)
            cell["ram_gb"]  = max(cell["ram_gb"],  hw.ram_gb  or 0)
        rig_rows = [
            {
                **_stage_perf(cell["stages"]),
                "device":      dev or None,
                "gpu":         gpu or None,
                "vram_gb":     cell["vram_gb"],
                "ram_gb":      cell["ram_gb"],
                "models":      sorted(cell["models"]),
                "frameworks":  sorted(cell["frameworks"]),
                "run_count":   cell["run_count"],
                "stage_count": len(cell["stages"]),
            }
            for (dev, gpu), cell in rigs_agg.items()
        ]
        rig_rows.sort(
            key=lambda r: (
                r["avg_tokens_per_sec"] or 0,
                -(r["avg_duration_sec"] or 1e9),
                r["avg_rating_score"]   or 0,
            ),
            reverse=True,
        )

        runs = [_run_summary(lr, lt) for lt, lr in items]
        runs.sort(key=lambda r: r["date"], reverse=True)

        profiles.append({
            "url":                url,
            "handle":             handle_from_url(url),
            "avatar_url":         avatar_from_url(url),
            "run_count":          len(items),
            "test_count":         len({lt.test.name for lt, _ in items}),
            "stage_count":        len(all_stages),
            "avg_rating_score":   score,
            "total_cost_usd":     cost_total,
            "total_duration_sec": dur_total,
            "first_date":         first.isoformat() if first else None,
            "latest_date":        latest.isoformat() if latest else None,
            "top_combo":          top_combo,
            "top_rig":            top_rig,
            "rigs":               rig_rows,
            "runs":               runs,
        })

    # Rank by activity, then quality, then recency as tiebreakers.
    profiles.sort(
        key=lambda p: (
            p["run_count"],
            p["stage_count"],
            p["avg_rating_score"] or 0,
            p["latest_date"] or "",
        ),
        reverse=True,
    )
    for i, p in enumerate(profiles):
        p["rank"] = i + 1

    all_runs: list[tuple[LoadedTest, LoadedRun]] = [
        (lt, lr) for lt in loaded.values() for lr in lt.runs
    ]
    all_runs.sort(key=lambda x: x[1].run.date, reverse=True)
    recent = [
        {
            "url":       lr.run.contributor_url,
            "handle":    handle_from_url(lr.run.contributor_url),
            "date":      lr.run.date.isoformat(),
            "test_name": lt.test.name,
            "run_id":    lr.run_id,
            "agent":     lr.run.agent.name,
            "model":     lr.run.model,
            "provider":  lr.run.provider,
        }
        for lt, lr in all_runs[:10]
    ]

    return {"profiles": profiles, "recent": recent}


def build_summary(loaded: dict[str, LoadedTest]) -> dict:
    runs = [lr for lt in loaded.values() for lr in lt.runs]
    stages = [s for lr in runs for s in lr.run.stages]
    contributors = {lr.run.contributor_url for lr in runs}
    return {
        "tests": len(loaded),
        "runs": len(runs),
        "stages": len(stages),
        "contributors": len(contributors),
        "models": len({(lr.run.provider, lr.run.model) for lr in runs}),
    }


# --------------------------------------------------------------------------- #
# GitHub URL discovery
# --------------------------------------------------------------------------- #


def discover_github_url(override: Optional[str]) -> str:
    if override:
        return override.rstrip("/")
    env_repo = os.environ.get("GITHUB_REPOSITORY")
    if env_repo:
        return f"https://github.com/{env_repo}"
    try:
        out = subprocess.check_output(
            ["git", "remote", "get-url", "origin"],
            cwd=REPO_ROOT, text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "https://github.com/"
    # Normalize git@github.com:foo/bar.git and https forms.
    if out.startswith("git@"):
        _, _, rest = out.partition(":")
        out = "https://github.com/" + rest
    if out.endswith(".git"):
        out = out[:-4]
    return out


# --------------------------------------------------------------------------- #
# Render
# --------------------------------------------------------------------------- #


def fmt_duration(seconds: Optional[float]) -> str:
    if seconds is None:
        return "—"
    seconds = int(round(seconds))
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m}m {s:02d}s"
    h, m = divmod(m, 60)
    return f"{h}h {m:02d}m"


TAGLINE = "Community contributed benchmarks of agentic AI coding setups"


def _write_json(path: Path, data: Any) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(data, separators=(",", ":"), default=str)
    path.write_text(blob, encoding="utf-8")
    return len(blob)


def _compact_run(r: dict) -> dict:
    """Trim a run summary down to what listings need (no stage details/notes/hw/settings).
    Stages keep only id+rating so the run-rating dots still render."""
    return {
        "run_id":             r["run_id"],
        "test_name":          r["test_name"],
        "test_title":         r["test_title"],
        "agent":              r["agent"],
        "model":              r["model"],
        "provider":           r["provider"],
        "contributor_handle": r["contributor_handle"],
        "contributor_url":    r["contributor_url"],
        "contributor_avatar": r.get("contributor_avatar"),
        "date":               r["date"],
        "stages_run":         r["stages_run"],
        "stages_total":       r["stages_total"],
        "avg_rating_score":   r["avg_rating_score"],
        "total_cost_usd":     r["total_cost_usd"],
        "total_duration_sec": r["total_duration_sec"],
        "stages":             [{"id": s["id"], "rating": s["rating"]} for s in r["stages"]],
    }


def _compact_test(t: dict) -> dict:
    return {
        "name":               t["name"],
        "title":              t["title"],
        "description":        t["description"],
        "domain":             t["domain"],
        "contributor_handle": t["contributor_handle"],
        "contributor_url":    t["contributor_url"],
        "contributor_avatar": t["contributor_avatar"],
        "stages_total":       t["stages_total"],
        "run_count":          t["run_count"],
        "top_score":          t["runs"][0]["avg_rating_score"] if t["runs"] else None,
    }


def _compact_profile(p: dict) -> dict:
    return {k: v for k, v in p.items() if k != "runs"}


def _compact_catalog_row(r: dict) -> dict:
    """Trim a per-agent / per-provider entry down to the listing-row payload.
    Drops the runs/cross/tests detail tables — those are loaded lazily."""
    return {
        "id":                 r["id"],
        "name":               r["name"],
        "description":        r["description"],
        "category":           r["category"],
        "logo":               r["logo"],
        "in_catalog":         r["in_catalog"],
        "run_count":          r["run_count"],
        "stage_count":        r["stage_count"],
        "test_count":         r["test_count"],
        "contributor_count":  r["contributor_count"],
        "avg_rating_score":   r["avg_rating_score"],
        "total_cost_usd":     r["total_cost_usd"],
        "total_duration_sec": r["total_duration_sec"],
        "top_combo":          r["top_combo"],
    }


def _validate_via_cli() -> None:
    """Run the CLI's `validate` command before any site work so a malformed
    test.yaml / run.yaml fails the build with a clear, source-of-truth error
    instead of being silently dropped by load_all()."""
    cli = REPO_ROOT / "agent-arena-cli.py"
    if not cli.is_file():
        sys.stderr.write(f"\n[build_site] cannot find {cli}; skipping pre-build validate.\n")
        return
    print("→ Validating YAML via agent-arena-cli.py …", flush=True)
    result = subprocess.run([str(cli), "validate"], cwd=REPO_ROOT)
    if result.returncode != 0:
        sys.stderr.write(
            "\n[build_site] YAML validation failed (see errors above). "
            "Fix them and re-run; the site will not be built until all "
            "test.yaml / run.yaml files pass.\n"
        )
        sys.exit(result.returncode)


def render(out_dir: Path, github_url: str, site_url: str) -> None:
    _validate_via_cli()
    loaded = load_all()
    build_date = date.today().isoformat()

    agents_catalog    = load_catalog("agents.json")
    providers_catalog = load_catalog("providers.json")

    summary      = build_summary(loaded)
    leaderboard  = build_leaderboard(loaded)
    scatter      = build_scatter(loaded)
    theme_stats  = build_theme_stats(loaded)
    per_test     = build_per_test(loaded)
    per_agent    = build_per_agent(loaded, agents_catalog)
    per_provider = build_per_provider(loaded, providers_catalog)
    per_model    = build_per_model(loaded)
    all_runs     = build_all_runs(loaded)
    contributors = build_contributors(loaded)
    activity     = build_activity(loaded)
    hardware     = build_hardware(loaded)

    # Jinja env covers every site_template/**/*.html template. Constructed once
    # and reused for the contribute fragment (below) and the per-route shells.
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        undefined=StrictUndefined,
        autoescape=select_autoescape(enabled_extensions=("html",)),
    )

    # ── Contribute page · render fragment now so the SPA can inject it. ──
    contribute_html = env.get_template("contribute/contribute.html").render(
        github_url=github_url,
        git_clone_url=github_url.rstrip("/") + ".git",
        rating_color=RATING_COLOR,
        run_yaml_example=(CONTRIBUTE_TPL_DIR / "run.yaml.example").read_text(encoding="utf-8").rstrip(),
        test_yaml_example=(CONTRIBUTE_TPL_DIR / "test.yaml.example").read_text(encoding="utf-8").rstrip(),
        directory_tree=(CONTRIBUTE_TPL_DIR / "directory-tree.txt.example").read_text(encoding="utf-8").rstrip(),
    )

    # ── index payload — always loaded by the SPA. Small, no per-run details. ──
    index_data = {
        "build_date":   build_date,
        "github_url":   github_url,
        "tagline":      TAGLINE,
        "rating_color": RATING_COLOR,
        "rating_score": RATING_SCORE,
        "contribute_html": contribute_html,
        "summary":      summary,
        "leaderboard":  leaderboard,
        "scatter":      scatter,
        "theme_stats":  theme_stats,
        "activity":     activity,
        "hardware":     hardware,
        "tests":        [_compact_test(t) for t in per_test],
        "agents":       [_compact_catalog_row(a) for a in per_agent],
        "providers":    [_compact_catalog_row(p) for p in per_provider],
        "models":       [_compact_catalog_row(m) for m in per_model],
        "contributors": {
            "profiles": [_compact_profile(p) for p in contributors["profiles"]],
            "recent":   contributors["recent"],
        },
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    sizes: dict[str, int] = {}
    sizes["index.json"]  = _write_json(out_dir / "index.json", index_data)
    sizes["runs.json"]   = _write_json(out_dir / "runs.json", {
        "runs": [_compact_run(r) for r in all_runs],
    })

    # ── per-test detail (prompts + compact runs list) ──
    for t in per_test:
        _write_json(out_dir / "tests" / f"{t['name']}.json", {
            "name":               t["name"],
            "title":              t["title"],
            "description":        t["description"],
            "domain":             t["domain"],
            "contributor_url":    t["contributor_url"],
            "contributor_handle": t["contributor_handle"],
            "contributor_avatar": t["contributor_avatar"],
            "stages_total":       t["stages_total"],
            "run_count":          t["run_count"],
            "test_stages":        t["test_stages"],
            "runs":               [_compact_run(r) for r in t["runs"]],
        })

    # ── per-run detail (full stage data, hardware, settings, notes) ──
    for r in all_runs:
        _write_json(out_dir / "runs" / r["test_name"] / f"{r['run_id']}.json", r)

    # ── per-contributor detail (profile + their compact runs list) ──
    for p in contributors["profiles"]:
        _write_json(out_dir / "contributors" / f"{p['handle']}.json", {
            **_compact_profile(p),
            "runs": [_compact_run(r) for r in p["runs"]],
        })

    # ── per-agent / per-provider detail (metadata + cross-ref + per-test + activity) ──
    for a in per_agent:
        _write_json(out_dir / "agents" / f"{a['id']}.json", {
            **_compact_catalog_row(a),
            "homepage": a["homepage"],
            "cross":    a["cross"],     # providers used with this agent
            "tests":    a["tests"],
            "activity": a["activity"],
        })
    for p in per_provider:
        _write_json(out_dir / "providers" / f"{p['id']}.json", {
            **_compact_catalog_row(p),
            "homepage": p["homepage"],
            "cross":    p["cross"],     # agents used with this provider
            "tests":    p["tests"],
            "activity": p["activity"],
        })
    for m in per_model:
        _write_json(out_dir / "models" / f"{m['id']}.json", {
            **_compact_catalog_row(m),
            "homepage":    m.get("homepage"),
            "vendor_name": m.get("vendor_name"),
            "cross":       m["cross"],   # providers serving this model
            "tests":       m["tests"],
            "activity":    m["activity"],
        })

    # ── logo assets — mirror the /logos/ tree into the site output so the SPA
    # can fetch each entry's logo at /logos/<kind>/<id>.svg. Missing files just
    # 404; the SPA falls back to a placeholder. ──
    src_logos = REPO_ROOT / "logos"
    dst_logos = out_dir / "logos"
    if src_logos.is_dir():
        shutil.rmtree(dst_logos, ignore_errors=True)
        shutil.copytree(src_logos, dst_logos)

    # ── stats.json — full dump for raw data access (not fetched by the SPA) ──
    sizes["stats.json"] = _write_json(out_dir / "stats.json", {
        "generated_at": build_date,
        "summary":      summary,
        "leaderboard":  leaderboard,
        "scatter":      scatter,
        "theme_stats":  theme_stats,
        "activity":     activity,
        "hardware":     hardware,
        "all_runs":     all_runs,
        "tests":        per_test,
        "agents":       per_agent,
        "providers":    per_provider,
        "models":       per_model,
        "contributors": contributors,
    })

    # ── Externalize JS, CSS, and boot data ──
    # The per-route HTML files (below) are now thin shells that reference these
    # shared assets, so the browser can cache them once across the whole site.
    shutil.copyfile(TEMPLATE_DIR / "app.js",    out_dir / "app.js")
    shutil.copyfile(TEMPLATE_DIR / "styles.css", out_dir / "styles.css")
    boot_js = (
        "// AgentArena boot payload. The SPA reads window.DATA on startup.\n"
        f"window.DATA = {json.dumps(index_data, separators=(',', ':'), default=str)};\n"
    )
    sizes["boot.js"] = len(boot_js)
    (out_dir / "boot.js").write_text(boot_js, encoding="utf-8")

    # ── Pre-generate one HTML file per SPA route ──
    tmpl = env.get_template("index.html")

    def _abs(url_path: Optional[str]) -> Optional[str]:
        """site-root-relative path → absolute URL on the deployed site."""
        if not url_path:
            return None
        if url_path.startswith(("http://", "https://")):
            return url_path
        return site_url.rstrip("/") + url_path

    def _trim(text: Optional[str], n: int = 200) -> str:
        if not text:
            return ""
        t = " ".join(text.split())
        return t if len(t) <= n else t[: n - 1].rstrip() + "…"

    # Canonical URLs of pages that should appear in sitemap.xml. Pages whose
    # canonical points elsewhere (the alt-form run URLs) are intentionally
    # excluded so the sitemap only advertises one URL per piece of content.
    sitemap_urls: list[str] = []

    def write_route(rel_path: str, *, page_title: str, page_description: str,
                    og_type: str = "website", og_image: Optional[str] = None,
                    canonical: Optional[str] = None) -> None:
        """Render the SPA shell for one URL and write it to <out>/<rel>/index.html.
        rel_path is "" for the root, otherwise a trailing-slashed path like
        "agents/claude-code/". canonical defaults to site_url + "/" + rel_path."""
        if rel_path and not rel_path.endswith("/"):
            rel_path += "/"
        page_path = "/" + rel_path if rel_path else "/"
        self_url = _abs(page_path)
        canonical_url = canonical or self_url
        html = tmpl.render(
            project_name="AgentArena",
            tagline=TAGLINE,
            github_url=github_url,
            build_date=build_date,
            summary=summary,
            page_title=page_title,
            page_description=_trim(page_description),
            canonical_url=canonical_url,
            og_type=og_type,
            og_image=_abs(og_image),
        )
        out_file = out_dir / rel_path / "index.html" if rel_path else out_dir / "index.html"
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(html, encoding="utf-8")
        # Only list this URL in the sitemap if it's its own canonical.
        if canonical_url == self_url:
            sitemap_urls.append(self_url)

    # Section landings and the overview.
    write_route("",                page_title=f"AgentArena — {TAGLINE}",
                                   page_description=f"{TAGLINE}. Compare AI coding agents, providers, and models on the same tests, contributed by the community.")
    write_route("leaderboard/",    page_title="Leaderboard — AgentArena",
                                   page_description="Leaderboard of agent · provider · model combos aggregated across every contributed run.")
    write_route("tests/",          page_title="Tests — AgentArena",
                                   page_description="Browse community-defined coding tests, their stage prompts, and the runs contributed against each.")
    write_route("runs/",           page_title="Runs — AgentArena",
                                   page_description="Every contributed run across every test, with per-stage timing, cost, and rating.")
    write_route("contributors/",   page_title="Contributors — AgentArena",
                                   page_description="People running these tests against agents. Each contributor's profile lists their rigs, tests, and runs.")
    write_route("hardware/",       page_title="Silicon beasts — AgentArena",
                                   page_description="Self-hosted rigs powering local inference in this benchmark — devices, GPUs, frameworks, throughput.")
    write_route("agents/",         page_title="Coding agents — AgentArena",
                                   page_description="Per-agent breakdown of contributed activity, with the providers used alongside each.")
    write_route("providers/",      page_title="Inference providers — AgentArena",
                                   page_description="Per-provider breakdown of contributed activity, with the agents observed against each.")
    write_route("models/",         page_title="Models — AgentArena",
                                   page_description="Per-model breakdown of contributed activity, with the providers serving each.")
    write_route("contribute/",     page_title="Contribute — AgentArena",
                                   page_description="Step into the arena. How to record a run, forge a new test, write run.yaml / test.yaml, and get on the leaderboard.")

    # Per-test detail pages.
    for t in per_test:
        write_route(f"tests/{t['name']}/",
                    page_title=f"{t['title']} — AgentArena",
                    page_description=f"{t['title']}. {_trim(t['description'], 160)} — {t['run_count']} run{'s' if t['run_count'] != 1 else ''} contributed.",
                    og_type="article")

    # Per-run detail pages. Each run is reachable via two URLs (the runs-tab
    # form and the tests-tab form); we generate both, but point canonical at
    # the runs-tab form so search engines de-dupe.
    for r in all_runs:
        primary = f"/runs/{r['test_name']}/{r['run_id']}/"
        title = f"{r['agent']} · {r['model']} on {r['test_name']} — AgentArena"
        desc = (f"Run by {r['contributor_handle']} on {r['date']}: {r['agent']} "
                f"with {r['model']} via {r['provider']}, "
                f"{r['stages_run']}/{r['stages_total']} stages.")
        write_route(f"runs/{r['test_name']}/{r['run_id']}/",
                    page_title=title, page_description=desc, og_type="article")
        write_route(f"tests/{r['test_name']}/runs/{r['run_id']}/",
                    page_title=title, page_description=desc, og_type="article",
                    canonical=_abs(primary))

    # Per-contributor profiles.
    for p in contributors["profiles"]:
        title = f"{p['handle']} — AgentArena"
        desc = (f"{p['handle']}'s contribution profile: {p['run_count']} run"
                f"{'s' if p['run_count'] != 1 else ''} across {p['test_count']} test"
                f"{'s' if p['test_count'] != 1 else ''}"
                f"{', avg score ' + format(p['avg_rating_score'], '.2f') if p['avg_rating_score'] is not None else ''}.")
        write_route(f"contributors/{p['handle']}/",
                    page_title=title, page_description=desc,
                    og_type="profile", og_image=p.get("avatar_url"))

    # Per-agent, per-provider, per-model detail pages.
    def _catalog_desc(row: dict, kind_lead: str) -> str:
        base = row.get("description") or kind_lead
        return (f"{row['name']}: {_trim(base, 130)} — "
                f"{row['run_count']} run{'s' if row['run_count'] != 1 else ''} "
                f"across {row['test_count']} test{'s' if row['test_count'] != 1 else ''}.")

    for a in per_agent:
        write_route(f"agents/{a['id']}/",
                    page_title=f"{a['name']} (coding agent) — AgentArena",
                    page_description=_catalog_desc(a, "coding agent"),
                    og_type="article", og_image=a.get("logo"))
    for p in per_provider:
        write_route(f"providers/{p['id']}/",
                    page_title=f"{p['name']} (inference provider) — AgentArena",
                    page_description=_catalog_desc(p, "inference provider"),
                    og_type="article", og_image=p.get("logo"))
    for m in per_model:
        write_route(f"models/{m['id']}/",
                    page_title=f"{m['name']} (model) — AgentArena",
                    page_description=_catalog_desc(m, "model"),
                    og_type="article", og_image=m.get("logo"))

    # SPA fallback for unknown paths. GitHub Pages serves this for 404s; the
    # SPA will then resolve location.pathname and either render the matching
    # route or show its "no route" panel.
    fallback_html = tmpl.render(
        project_name="AgentArena",
        tagline=TAGLINE,
        github_url=github_url,
        build_date=build_date,
        summary=summary,
        page_title="Not found — AgentArena",
        page_description=TAGLINE,
        canonical_url=site_url,
        og_type="website",
        og_image=None,
    )
    (out_dir / "404.html").write_text(fallback_html, encoding="utf-8")

    # ── sitemap.xml + robots.txt ──
    # Only canonical URLs are listed (the alt-form run URLs are excluded above),
    # so the sitemap advertises each piece of content exactly once.
    from xml.sax.saxutils import escape as _xml_escape
    sm_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for url in sitemap_urls:
        sm_lines.append(f"  <url><loc>{_xml_escape(url)}</loc><lastmod>{build_date}</lastmod></url>")
    sm_lines.append("</urlset>\n")
    (out_dir / "sitemap.xml").write_text("\n".join(sm_lines), encoding="utf-8")

    (out_dir / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nSitemap: {site_url}/sitemap.xml\n",
        encoding="utf-8",
    )

    # ── llms.txt — site map for LLMs (llmstxt.org convention) ──
    # Markdown index pointing at every meaningful canonical URL, grouped by
    # kind, with a short description so an LLM crawler can decide what to
    # fetch without parsing each HTML page.
    def _line(title: str, path: str, desc: Optional[str] = None) -> str:
        url = path if path.startswith(("http://", "https://")) else f"{site_url}{path}"
        link = f"- [{title}]({url})"
        return f"{link}: {desc}" if desc else link

    llms_parts: list[str] = [
        "# AgentArena",
        "",
        f"> {TAGLINE}.",
        "",
        ("AgentArena is a community-run, real-world benchmark of how agentic AI "
         "coding setups perform on shared tasks. Each test defines an ordered "
         "sequence of prompts; contributors run those prompts against their "
         "preferred agent · model · provider stack and submit per-stage scores. "
         "Aggregates roll up into a leaderboard, per-agent / per-provider / "
         "per-model breakdowns, and per-contributor profiles."),
        "",
        f"Snapshot: {summary['tests']} tests · {summary['runs']} runs · "
        f"{summary['stages']} stages · {summary['contributors']} contributors. "
        f"Built {build_date}.",
        "",
        "## Project",
        "",
        _line("Overview",      "/",              "Project summary, top performers, latest activity."),
        _line("Leaderboard",   "/leaderboard/",  "Agent · provider · model combinations ranked by average score."),
        _line("Silicon beasts","/hardware/",     "Self-hosted rigs powering local inference — devices, GPUs, throughput."),
        _line("Source & CONTRIBUTING.md", github_url, "How to contribute a new test or a new run."),
        _line("Raw data dump (JSON)", "/stats.json", "Complete machine-readable dump of every aggregation."),
        "",
        "## Tests",
        "",
    ]
    for t in per_test:
        llms_parts.append(_line(t["title"], f"/tests/{t['name']}/", _trim(t["description"], 140)))

    llms_parts += ["", "## Coding agents", ""]
    for a in per_agent:
        llms_parts.append(_line(a["name"], f"/agents/{a['id']}/",
                                a.get("description") or f"{a['run_count']} run(s)."))

    llms_parts += ["", "## Inference providers", ""]
    for p in per_provider:
        llms_parts.append(_line(p["name"], f"/providers/{p['id']}/",
                                p.get("description") or f"{p['run_count']} run(s)."))

    llms_parts += ["", "## Models", ""]
    for m in per_model:
        vendor = m.get("vendor_name")
        desc = (f"by {vendor}. " if vendor else "") + f"{m['run_count']} run(s) across {m['test_count']} test(s)."
        llms_parts.append(_line(m["name"], f"/models/{m['id']}/", desc))

    llms_parts += ["", "## Contributors", ""]
    for p in contributors["profiles"]:
        desc = (f"{p['run_count']} run(s) across {p['test_count']} test(s)"
                + (f", avg score {p['avg_rating_score']:.2f}." if p["avg_rating_score"] is not None else "."))
        llms_parts.append(_line(p["handle"], f"/contributors/{p['handle']}/", desc))

    llms_parts.append("")
    (out_dir / "llms.txt").write_text("\n".join(llms_parts), encoding="utf-8")

    (out_dir / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: skip Jekyll

    n_tests = len(per_test)
    n_runs  = len(all_runs)
    n_contribs = len(contributors["profiles"])
    n_agents = len(per_agent)
    n_providers = len(per_provider)
    n_models = len(per_model)
    # Per-route HTML files written: 9 section landings + per-entity pages
    # (one per test, contributor, agent, provider, model) + per-run pages
    # (each run is duplicated under runs/ and tests/.../runs/).
    n_html = 9 + n_tests + 2 * n_runs + n_contribs + n_agents + n_providers + n_models + 1  # +1 for 404
    print(f"✓ Wrote {n_html} HTML files (per-route shells + 404.html)")
    print(f"✓ Wrote sitemap.xml ({len(sitemap_urls)} canonical URLs) + robots.txt + llms.txt")
    print(f"✓ Wrote app.js, styles.css, boot.js (boot payload {sizes['boot.js']:,} bytes)")
    print(f"✓ Wrote {out_dir / 'index.json'} ({sizes['index.json']:,} bytes)")
    print(f"✓ Wrote {out_dir / 'runs.json'} ({sizes['runs.json']:,} bytes)")
    print(f"✓ Wrote {n_tests} tests/, {n_runs} runs/, {n_contribs} contributors/, "
          f"{n_agents} agents/, {n_providers} providers/, {n_models} models/ shards")
    print(f"  {summary['tests']} tests · {summary['runs']} runs · "
          f"{summary['stages']} stages · {summary['contributors']} contributors")
    print(f"  Local preview: python3 -m http.server -d {out_dir} 8000  →  http://localhost:8000")


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the AgentArena static stats site.")
    parser.add_argument(
        "--out", type=Path, default=REPO_ROOT / "site",
        help="Output directory (default: ./site)",
    )
    parser.add_argument(
        "--github-url", type=str, default=None,
        help="GitHub URL for the project (default: derived from origin remote or $GITHUB_REPOSITORY)",
    )
    parser.add_argument(
        "--site-url", type=str, default="https://agentarena.tin.cat",
        help="Base URL where the site is deployed (used in canonical/OG tags).",
    )
    args = parser.parse_args()
    render(args.out, discover_github_url(args.github_url), args.site_url.rstrip("/"))


if __name__ == "__main__":
    main()
