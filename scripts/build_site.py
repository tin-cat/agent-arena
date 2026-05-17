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
import html
import json
import typing
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Optional
from urllib.parse import urlparse

from jinja2 import Environment, StrictUndefined
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from ruamel.yaml import YAML

# --------------------------------------------------------------------------- #
# Schemas — kept in sync with scripts/cli.py. Duplicated rather than imported
# so this script stays standalone and doesn't drag typer/questionary along.
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = REPO_ROOT / "tests"

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
    """One point per run: total cost vs avg rating score."""
    points: list[dict] = []
    for lt in loaded.values():
        for lr in lt.runs:
            score = rating_score(lr.run.stages)
            cost = total_cost(lr.run.stages)
            if score is None or cost is None:
                continue
            points.append({
                "x": cost,
                "y": score,
                "label": f"{lr.run.agent.name} / {lr.run.model}",
                "test": lt.test.title,
                "run_id": lr.run_id,
            })
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


def build_per_test(loaded: dict[str, LoadedTest]) -> list[dict]:
    """One card per test, with its top runs."""
    out = []
    for lt in sorted(loaded.values(), key=lambda x: x.test.name):
        run_summaries = []
        for lr in lt.runs:
            score = rating_score(lr.run.stages)
            cost = total_cost(lr.run.stages)
            run_summaries.append({
                "run_id": lr.run_id,
                "agent": lr.run.agent.name,
                "provider": lr.run.provider,
                "model": lr.run.model,
                "contributor_url": lr.run.contributor_url,
                "contributor_handle": handle_from_url(lr.run.contributor_url),
                "date": lr.run.date.isoformat(),
                "stages_run": len(lr.run.stages),
                "stages_total": len(lt.test.stages),
                "avg_rating_score": score,
                "total_cost_usd": cost,
                "total_duration_sec": total_duration(lr.run.stages),
                "stage_ratings": [
                    {"id": s.id, "rating": s.rating} for s in lr.run.stages
                ],
            })
        run_summaries.sort(key=lambda r: (r["avg_rating_score"] or 0), reverse=True)
        out.append({
            "name": lt.test.name,
            "title": lt.test.title,
            "description": lt.test.description.strip(),
            "domain": lt.test.domain,
            "stages_total": len(lt.test.stages),
            "run_count": len(lt.runs),
            "runs": run_summaries,
        })
    return out


def build_contributors(loaded: dict[str, LoadedTest]) -> dict[str, list[dict]]:
    """Most active (by total runs) + most recent contributors."""
    by_url: dict[str, list[LoadedRun]] = defaultdict(list)
    for lt in loaded.values():
        for lr in lt.runs:
            by_url[lr.run.contributor_url].append(lr)

    most_active: list[dict] = []
    for url, runs in by_url.items():
        all_stages = [s for lr in runs for s in lr.run.stages]
        score = rating_score(all_stages) if all_stages else None
        latest = max((lr.run.date for lr in runs), default=None)
        most_active.append({
            "url": url,
            "handle": handle_from_url(url),
            "run_count": len(runs),
            "test_count": len({lr.test_name for lr in runs}),
            "stage_count": len(all_stages),
            "avg_rating_score": score,
            "latest_date": latest.isoformat() if latest else None,
        })
    most_active.sort(key=lambda r: (r["run_count"], r["stage_count"]), reverse=True)

    all_runs: list[LoadedRun] = [lr for lt in loaded.values() for lr in lt.runs]
    all_runs.sort(key=lambda lr: lr.run.date, reverse=True)
    recent = []
    for lr in all_runs[:10]:
        recent.append({
            "url": lr.run.contributor_url,
            "handle": handle_from_url(lr.run.contributor_url),
            "date": lr.run.date.isoformat(),
            "test_name": lr.test_name,
            "run_id": lr.run_id,
            "agent": lr.run.agent.name,
            "model": lr.run.model,
            "provider": lr.run.provider,
        })

    return {"most_active": most_active, "recent": recent}


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


TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ project_name }} — {{ tagline }}</title>
<meta name="description" content="{{ tagline }}. Community benchmark stats for coding agents across providers and models.">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<style>
  :root {
    --bg:        #0a0e14;
    --bg-2:      #0f141c;
    --panel:     #131a24;
    --panel-2:   #182030;
    --border:    #1f2a3a;
    --text:      #d5dde8;
    --text-dim:  #8a96a8;
    --text-mute: #5d6878;
    --cyan:      #5ad1ff;
    --cyan-2:    #2da3d3;
    --magenta:   #ff6ad5;
    --good:      #34d399;
    --warn:      #fbbf24;
    --bad:       #f87171;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace;
    font-size: 12.5px; line-height: 1.55;
  }
  a { color: var(--cyan); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px; }

  /* ---------- Header ---------- */
  .hero {
    position: relative;
    padding: 48px 0 40px;
    border-bottom: 1px solid var(--border);
    background:
      radial-gradient(900px 380px at 12% 0%, rgba(90,209,255,.10), transparent 60%),
      radial-gradient(700px 300px at 88% 10%, rgba(255,106,213,.08), transparent 60%),
      linear-gradient(180deg, #0c1119 0%, var(--bg) 100%);
  }
  .hero-row {
    display: grid; grid-template-columns: auto 1fr auto;
    gap: 28px; align-items: center;
  }
  .logo {
    color: var(--cyan);
    font-size: 18px; line-height: 1em;
    white-space: pre;
    text-shadow: 0 0 18px rgba(90,209,255,.35);
  }
  .logo .eyes { color: var(--magenta); text-shadow: 0 0 12px rgba(255,106,213,.55); }
  .title { font-size: 34px; font-weight: 700; letter-spacing: -.5px; color: #f0f5ff; margin: 0; }
  .title .accent { color: var(--cyan); }
  .tag { color: var(--text-dim); margin-top: 8px; font-size: 15px; }
  .sub { color: var(--text-mute); margin-top: 2px; font-size: 13px; }
  .gh-link {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    background: var(--panel);
    font-weight: 600;
    transition: border-color .15s, transform .15s;
  }
  .gh-link:hover { border-color: var(--cyan); text-decoration: none; transform: translateY(-1px); }
  .gh-link svg { width: 18px; height: 18px; fill: currentColor; }

  /* ---------- Summary chips ---------- */
  .chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 28px; }
  .chip {
    padding: 10px 16px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    display: flex; gap: 8px; align-items: baseline;
  }
  .chip b { color: var(--cyan); font-size: 17px; }
  .chip span { color: var(--text-dim); font-size: 13px; }

  /* ---------- Sections ---------- */
  section { padding: 44px 0; border-bottom: 1px solid var(--border); }
  section:last-child { border-bottom: none; }
  h2 {
    margin: 0 0 8px;
    font-size: 22px; font-weight: 700; color: #f0f5ff;
    display: flex; align-items: center; gap: 12px;
  }
  h2::before {
    content: ""; width: 8px; height: 8px; border-radius: 50%;
    background: var(--cyan); box-shadow: 0 0 12px var(--cyan);
  }
  .lead { color: var(--text-dim); margin: 0 0 22px; font-size: 14px; }

  /* ---------- Cards ---------- */
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px;
  }
  .card + .card { margin-top: 14px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 820px) { .grid-2 { grid-template-columns: 1fr; } }

  /* ---------- Tables ---------- */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--border); }
  th { color: var(--text-dim); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .5px; }
  tr:hover td { background: rgba(90,209,255,.04); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600;
    background: rgba(90,209,255,.12); color: var(--cyan);
    border: 1px solid rgba(90,209,255,.25);
  }
  .pill.muted { background: rgba(255,255,255,.04); color: var(--text-dim); border-color: var(--border); }
  .rank { color: var(--text-mute); width: 28px; }
  .rank.top { color: var(--magenta); font-weight: 700; }

  /* Rating bar — visualizes avg_rating_score from 0..1 */
  .bar { position: relative; height: 8px; background: var(--panel-2); border-radius: 4px; overflow: hidden; min-width: 80px; }
  .bar > div {
    height: 100%;
    background: linear-gradient(90deg, var(--magenta), var(--cyan));
    border-radius: 4px;
  }
  .bar-row { display: flex; align-items: center; gap: 10px; }
  .bar-row span { min-width: 36px; font-variant-numeric: tabular-nums; color: var(--text-dim); font-size: 12px; }

  /* Stage rating dots */
  .dots { display: inline-flex; gap: 4px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

  /* ---------- Charts ---------- */
  .chart-box { position: relative; height: 320px; }

  /* ---------- Per-test ---------- */
  .test-card h3 { margin: 0 0 4px; font-size: 17px; color: #f0f5ff; }
  .test-meta { color: var(--text-mute); font-size: 12px; margin-bottom: 12px; }
  .test-desc { color: var(--text-dim); margin: 0 0 14px; }

  /* ---------- Contributors ---------- */
  .contrib-list { list-style: none; padding: 0; margin: 0; }
  .contrib-list li {
    display: grid; grid-template-columns: 28px 1fr auto;
    align-items: center; gap: 12px;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .contrib-list li:last-child { border-bottom: none; }
  .contrib-list .handle { font-weight: 600; color: var(--text); }
  .contrib-list .meta { color: var(--text-mute); font-size: 12px; }

  /* ---------- Footer ---------- */
  footer {
    padding: 28px 0 36px; color: var(--text-mute); font-size: 12px;
    border-top: 1px solid var(--border);
    text-align: center;
  }
  footer a { color: var(--text-dim); }
</style>
</head>
<body>

<header class="hero">
  <div class="wrap hero-row">
    <pre class="logo" aria-hidden="true">   ▄▄▄▄▄▄▄▄
  ▐█ <span class="eyes">▀▄▄▀</span> █▌
  ▐█  ▀▀  █▌
   ▀██████▀
    ▄▀  ▀▄   </pre>
    <div>
      <h1 class="title"><span class="accent">Agent</span>Arena</h1>
      <div class="tag">{{ tagline }}</div>
      <div class="sub">Auto-generated from every <code>test.yaml</code> and <code>run.yaml</code> in the repo.</div>
    </div>
    <a class="gh-link" href="{{ github_url }}" rel="noopener">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2.9-.3 2-.4 3-.4s2.1.1 3 .4c2.3-1.6 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg>
      View on GitHub
    </a>
  </div>

  <div class="wrap">
    <div class="chips">
      <div class="chip"><b>{{ summary.tests }}</b><span>tests</span></div>
      <div class="chip"><b>{{ summary.runs }}</b><span>contributed runs</span></div>
      <div class="chip"><b>{{ summary.stages }}</b><span>stages executed</span></div>
      <div class="chip"><b>{{ summary.models }}</b><span>provider/model combos</span></div>
      <div class="chip"><b>{{ summary.contributors }}</b><span>contributors</span></div>
    </div>
  </div>
</header>

{% if leaderboard %}
<section id="leaderboard">
  <div class="wrap">
    <h2>Leaderboard</h2>
    <p class="lead">Aggregated across every contributed stage. Ranked by average rating score
      (excellent = 1.0, good = 0.75, partial = 0.4, failed = 0.0).</p>
    <div class="card" style="padding: 4px 16px;">
    <table>
      <thead>
        <tr>
          <th class="rank">#</th>
          <th>Agent</th>
          <th>Provider</th>
          <th>Model</th>
          <th>Score</th>
          <th class="num">Success</th>
          <th class="num">Runs</th>
          <th class="num">Stages</th>
          <th class="num">Avg cost / stage</th>
          <th class="num">Avg time / stage</th>
          <th class="num">Score per $</th>
        </tr>
      </thead>
      <tbody>
      {% for row in leaderboard %}
        <tr>
          <td class="rank{% if loop.index == 1 %} top{% endif %}">{{ loop.index }}</td>
          <td>{{ row.agent }}</td>
          <td><span class="pill muted">{{ row.provider }}</span></td>
          <td><b>{{ row.model }}</b></td>
          <td>
            <div class="bar-row">
              <div class="bar"><div style="width: {{ (row.avg_rating_score * 100) | round(0) }}%"></div></div>
              <span>{{ '%.2f' | format(row.avg_rating_score) }}</span>
            </div>
          </td>
          <td class="num">{{ (row.success_rate * 100) | round(0) | int }}%</td>
          <td class="num">{{ row.run_count }}</td>
          <td class="num">{{ row.stage_count }}</td>
          <td class="num">{% if row.avg_cost_per_stage is not none %}${{ '%.2f' | format(row.avg_cost_per_stage) }}{% else %}—{% endif %}</td>
          <td class="num">{{ fmt_duration(row.avg_duration_sec) }}</td>
          <td class="num">{% if row.rating_per_dollar is not none %}{{ '%.2f' | format(row.rating_per_dollar) }}{% else %}—{% endif %}</td>
        </tr>
      {% endfor %}
      </tbody>
    </table>
    </div>
  </div>
</section>
{% endif %}

{% if scatter %}
<section id="cost-quality">
  <div class="wrap">
    <h2>Cost vs quality</h2>
    <p class="lead">Each dot is one contributed run. X = total cost in USD across all stages.
      Y = average rating score. Upper-left is the sweet spot.</p>
    <div class="card">
      <div class="chart-box"><canvas id="scatterChart"></canvas></div>
    </div>
  </div>
</section>
{% endif %}

{% if theme_stats %}
<section id="themes">
  <div class="wrap">
    <h2>Stage themes — where agents shine and struggle</h2>
    <p class="lead">Rating breakdown for every stage executed, grouped by the stage's theme in <code>test.yaml</code>.</p>
    <div class="card">
      <div class="chart-box"><canvas id="themeChart"></canvas></div>
    </div>
  </div>
</section>
{% endif %}

{% if per_test %}
<section id="tests">
  <div class="wrap">
    <h2>Tests</h2>
    <p class="lead">Top-rated contributed runs per test, with a quick view of each stage's rating.</p>
    {% for t in per_test %}
      <div class="card test-card">
        <h3><a href="{{ github_url }}/tree/main/tests/{{ t.name }}" rel="noopener">{{ t.title }}</a> <span class="pill muted">{{ t.name }}</span>{% if t.domain %} <span class="pill">{{ t.domain }}</span>{% endif %}</h3>
        <div class="test-meta">{{ t.stages_total }} stage{{ '' if t.stages_total == 1 else 's' }} · {{ t.run_count }} contributed run{{ '' if t.run_count == 1 else 's' }}</div>
        <p class="test-desc">{{ t.description }}</p>
        {% if t.runs %}
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Contributor</th>
              <th>Agent</th>
              <th>Model</th>
              <th>Stages</th>
              <th>Score</th>
              <th class="num">Total cost</th>
              <th class="num">Total time</th>
              <th class="num">Date</th>
            </tr>
          </thead>
          <tbody>
          {% for r in t.runs %}
            <tr>
              <td><a href="{{ github_url }}/tree/main/tests/{{ t.name }}/results/{{ r.run_id }}" rel="noopener"><code style="font-size: 12px;">{{ r.run_id }}</code></a></td>
              <td><a href="{{ r.contributor_url }}" rel="noopener">{{ r.contributor_handle }}</a></td>
              <td>{{ r.agent }}</td>
              <td><b>{{ r.model }}</b> <span class="pill muted">{{ r.provider }}</span></td>
              <td>
                <span class="dots" title="{{ r.stages_run }} of {{ r.stages_total }} stages run">
                  {% for s in r.stage_ratings %}
                    <span class="dot" style="background: {{ rating_color(s.rating) }};" title="{{ s.id }}: {{ s.rating }}"></span>
                  {% endfor %}
                </span>
              </td>
              <td>
                <div class="bar-row">
                  <div class="bar"><div style="width: {{ (r.avg_rating_score * 100) | round(0) }}%"></div></div>
                  <span>{{ '%.2f' | format(r.avg_rating_score) }}</span>
                </div>
              </td>
              <td class="num">{% if r.total_cost_usd is not none %}${{ '%.2f' | format(r.total_cost_usd) }}{% else %}—{% endif %}</td>
              <td class="num">{{ fmt_duration(r.total_duration_sec) }}</td>
              <td class="num">{{ r.date }}</td>
            </tr>
          {% endfor %}
          </tbody>
        </table>
        {% else %}
          <div style="color: var(--text-mute); padding: 8px 0;">No runs contributed yet.</div>
        {% endif %}
      </div>
    {% endfor %}
  </div>
</section>
{% endif %}

<section id="contributors">
  <div class="wrap">
    <h2>Contributors</h2>
    <p class="lead">The folks running these tests. Want to see your handle here? Check the contribution guide.</p>
    <div class="grid-2">
      <div class="card">
        <h3 style="margin:0 0 12px; font-size:15px; color:var(--text);">Most active</h3>
        {% if contributors.most_active %}
        <ul class="contrib-list">
          {% for c in contributors.most_active[:10] %}
            <li>
              <span class="rank{% if loop.index == 1 %} top{% endif %}">{{ loop.index }}</span>
              <div>
                <a class="handle" href="{{ c.url }}" rel="noopener">{{ c.handle }}</a>
                <div class="meta">{{ c.run_count }} run{{ '' if c.run_count == 1 else 's' }} · {{ c.stage_count }} stage{{ '' if c.stage_count == 1 else 's' }} · across {{ c.test_count }} test{{ '' if c.test_count == 1 else 's' }}</div>
              </div>
              <div class="bar-row">
                <div class="bar" style="min-width: 70px;"><div style="width: {{ ((c.avg_rating_score or 0) * 100) | round(0) }}%"></div></div>
              </div>
            </li>
          {% endfor %}
        </ul>
        {% else %}
          <div style="color: var(--text-mute);">No contributors yet.</div>
        {% endif %}
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px; font-size:15px; color:var(--text);">Latest contributions</h3>
        {% if contributors.recent %}
        <ul class="contrib-list">
          {% for c in contributors.recent %}
            <li>
              <span class="rank">{{ c.date[5:] }}</span>
              <div>
                <a class="handle" href="{{ c.url }}" rel="noopener">{{ c.handle }}</a>
                <div class="meta">{{ c.agent }} · {{ c.model }} <span class="pill muted">{{ c.provider }}</span></div>
              </div>
              <div class="meta" style="text-align:right;">
                <div><a href="{{ github_url }}/tree/main/tests/{{ c.test_name }}/results/{{ c.run_id }}" rel="noopener">{{ c.test_name }}</a></div>
                <div style="color: var(--text-mute);">{{ c.date }}</div>
              </div>
            </li>
          {% endfor %}
        </ul>
        {% else %}
          <div style="color: var(--text-mute);">No contributions yet.</div>
        {% endif %}
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    Built {{ build_date }} from {{ summary.runs }} contributed run{{ '' if summary.runs == 1 else 's' }} ·
    <a href="{{ github_url }}">Source on GitHub</a> ·
    Raw data: <a href="stats.json">stats.json</a>
    <div style="margin-top: 10px;">By <a href="https://tin.cat" rel="noopener">tin.cat</a></div>
  </div>
</footer>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
  const DATA = {{ data_json | safe }};

  const FONT = 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace';
  Chart.defaults.font.family = FONT;
  Chart.defaults.color = '#8a96a8';
  Chart.defaults.borderColor = '#1f2a3a';
  Chart.defaults.animation = false;

  // ---------- Cost vs quality scatter ----------
  if (DATA.scatter && DATA.scatter.length && document.getElementById('scatterChart')) {
    new Chart(document.getElementById('scatterChart'), {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'runs',
          data: DATA.scatter,
          backgroundColor: 'rgba(90,209,255,.7)',
          borderColor: '#ff6ad5',
          borderWidth: 1,
          pointRadius: 6,
          pointHoverRadius: 9,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f141c',
            borderColor: '#1f2a3a', borderWidth: 1,
            titleColor: '#d5dde8', bodyColor: '#8a96a8',
            callbacks: {
              title: (items) => items[0].raw.label,
              label: (ctx) => [
                ctx.raw.test + ' · ' + ctx.raw.run_id,
                '$' + ctx.raw.x.toFixed(2) + ' total · score ' + ctx.raw.y.toFixed(2),
              ],
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Total cost (USD)', color: '#8a96a8' },
            grid: { color: 'rgba(31,42,58,.6)' },
            ticks: { callback: (v) => '$' + v },
          },
          y: {
            min: 0, max: 1,
            title: { display: true, text: 'Avg rating score', color: '#8a96a8' },
            grid: { color: 'rgba(31,42,58,.6)' },
          },
        }
      }
    });
  }

  // ---------- Theme stacked bar ----------
  if (DATA.theme_stats && DATA.theme_stats.length && document.getElementById('themeChart')) {
    const labels = DATA.theme_stats.map(t => t.theme);
    const ratings = ['excellent', 'good', 'partial', 'failed'];
    const colors = {
      excellent: '#34d399', good: '#a7f3d0', partial: '#fbbf24', failed: '#f87171',
    };
    const datasets = ratings.map(r => ({
      label: r,
      data: DATA.theme_stats.map(t => t.counts[r] || 0),
      backgroundColor: colors[r],
      borderWidth: 0,
    }));
    new Chart(document.getElementById('themeChart'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#d5dde8' } },
          tooltip: { backgroundColor: '#0f141c', borderColor: '#1f2a3a', borderWidth: 1 },
        },
        scales: {
          x: { stacked: true, grid: { color: 'rgba(31,42,58,.6)' } },
          y: { stacked: true, grid: { color: 'rgba(31,42,58,.6)' }, ticks: { precision: 0 } },
        }
      }
    });
  }
</script>
</body>
</html>
"""


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

    summary      = build_summary(loaded)
    leaderboard  = build_leaderboard(loaded)
    scatter      = build_scatter(loaded)
    theme_stats  = build_theme_stats(loaded)
    per_test     = build_per_test(loaded)
    contributors = build_contributors(loaded)

    data_for_js = {
        "scatter": scatter,
        "theme_stats": theme_stats,
    }

    env = Environment(undefined=StrictUndefined, autoescape=True)
    env.filters["round"] = round  # ensure Jinja uses Python round
    tmpl = env.from_string(TEMPLATE)
    html_out = tmpl.render(
        project_name="AgentArena",
        tagline="A community benchmark for coding agent performance",
        github_url=github_url,
        build_date=date.today().isoformat(),
        summary=summary,
        leaderboard=leaderboard,
        scatter=scatter,
        theme_stats=theme_stats,
        per_test=per_test,
        contributors=contributors,
        data_json=json.dumps(data_for_js, separators=(",", ":")),
        fmt_duration=fmt_duration,
        rating_color=lambda r: RATING_COLOR.get(r, "#5d6878"),
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(html_out, encoding="utf-8")
    (out_dir / "stats.json").write_text(json.dumps({
        "generated_at": date.today().isoformat(),
        "summary": summary,
        "leaderboard": leaderboard,
        "scatter": scatter,
        "theme_stats": theme_stats,
        "per_test": per_test,
        "contributors": contributors,
    }, indent=2), encoding="utf-8")
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
