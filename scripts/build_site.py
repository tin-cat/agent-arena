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
# Schemas — kept in sync with scripts/cli.py. Duplicated rather than imported
# so this script stays standalone and doesn't drag typer/questionary along.
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = REPO_ROOT / "tests"
TEMPLATE_DIR = Path(__file__).resolve().parent / "site_template"

RATINGS = ("excellent", "good", "partial", "failed")
RATING_SCORE = {"excellent": 1.0, "good": 0.75, "partial": 0.4, "failed": 0.0}
RATING_COLOR = {
    "excellent": "#34d399",   # emerald-400
    "good":      "#a7f3d0",   # emerald-200
    "partial":   "#fbbf24",   # amber-400
    "failed":    "#f87171",   # red-400
}

DomainT = Literal[
    "full-stack-web", "backend", "frontend", "cli",
    "mobile", "data", "library", "other",
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
    name: str
    title: str
    description: str
    domain: Optional[DomainT] = None
    stages: list[TestStage]


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
            "stages_total": len(lt.test.stages),
            "test_stages": [
                {"id": s.id, "theme": s.theme, "prompt": s.prompt, "builds_on": s.builds_on}
                for s in lt.test.stages
            ],
            "run_count": len(lt.runs),
            "runs": run_summaries,
        })
    return out


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


def render(out_dir: Path, github_url: str) -> None:
    loaded = load_all()
    build_date = date.today().isoformat()

    summary      = build_summary(loaded)
    leaderboard  = build_leaderboard(loaded)
    scatter      = build_scatter(loaded)
    theme_stats  = build_theme_stats(loaded)
    per_test     = build_per_test(loaded)
    all_runs     = build_all_runs(loaded)
    contributors = build_contributors(loaded)
    activity     = build_activity(loaded)

    data_for_js = {
        "build_date":   build_date,
        "github_url":   github_url,
        "tagline":      "Community contributed benchmarks of agentic AI coding setups",
        "summary":      summary,
        "leaderboard":  leaderboard,
        "scatter":      scatter,
        "theme_stats":  theme_stats,
        "per_test":     per_test,
        "all_runs":     all_runs,
        "contributors": contributors,
        "activity":     activity,
        "rating_score": RATING_SCORE,
        "rating_color": RATING_COLOR,
    }

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        undefined=StrictUndefined,
        autoescape=select_autoescape(enabled_extensions=("html",)),
    )
    tmpl = env.get_template("index.html")
    html_out = tmpl.render(
        project_name="AgentArena",
        tagline="Community contributed benchmarks of agentic AI coding setups",
        github_url=github_url,
        build_date=build_date,
        summary=summary,
        data_json=json.dumps(data_for_js, separators=(",", ":"), default=str),
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(html_out, encoding="utf-8")
    (out_dir / "stats.json").write_text(json.dumps({
        "generated_at": build_date,
        **{k: v for k, v in data_for_js.items() if k not in ("rating_score", "rating_color")},
    }, indent=2, default=str), encoding="utf-8")
    (out_dir / ".nojekyll").write_text("", encoding="utf-8")  # GitHub Pages: skip Jekyll

    print(f"✓ Wrote {out_dir / 'index.html'}")
    print(f"✓ Wrote {out_dir / 'stats.json'}")
    print(f"  {summary['tests']} tests · {summary['runs']} runs · "
          f"{summary['stages']} stages · {summary['contributors']} contributors")


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
    args = parser.parse_args()
    render(args.out, discover_github_url(args.github_url))


if __name__ == "__main__":
    main()
