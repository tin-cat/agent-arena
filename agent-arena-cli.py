#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "typer>=0.12",
#     "rich>=13.7",
#     "pydantic>=2.6",
#     "ruamel.yaml>=0.18",
#     "textual>=0.50",
# ]
# ///
"""CLI for managing AgentArena tests and their runs.

Just run it — dependencies install themselves on first run:

    ./agent-arena-cli.py test add          # interactively create a new test
    ./agent-arena-cli.py run add           # interactively record a run for a test
    ./agent-arena-cli.py validate          # validate every test.yaml / run.yaml
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# ----------------------------------------------------------------------------
# Self-bootstrap: on first run (or after deps change), create .venv/ alongside
# this script and install dependencies there, then re-exec with that venv's
# Python so the rest of the file can import normally.
# ----------------------------------------------------------------------------

_DEPS = (
    "typer>=0.12",
    "rich>=13.7",
    "pydantic>=2.6",
    "ruamel.yaml>=0.18",
    "textual>=0.50",
)
_VENV = Path(__file__).resolve().parent / ".venv"
_VENV_PY = _VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python3")


def _have_deps() -> bool:
    try:
        import pydantic     # noqa: F401
        import rich         # noqa: F401
        import ruamel.yaml  # noqa: F401
        import textual      # noqa: F401
        import typer        # noqa: F401
        return True
    except ImportError:
        return False


def _fail_setup(summary: str, hint: str, *, detail: str = "") -> None:
    sys.stderr.write(f"\n[AgentArena CLI setup] {summary}\n")
    if detail:
        sys.stderr.write(f"  {detail}\n")
    sys.stderr.write(f"\n{hint}\n")
    sys.exit(1)


def _check_python_version() -> None:
    if sys.version_info < (3, 11):
        current = ".".join(map(str, sys.version_info[:3]))
        _fail_setup(
            f"Python 3.11+ is required, but you're running Python {current}.",
            hint=(
                "Install a newer Python (via pyenv, asdf, uv, or your OS package manager),\n"
                "then invoke this script with it explicitly, e.g.:\n"
                f"  python3.11 {sys.argv[0]}"
            ),
        )


def _check_venv_module() -> None:
    # The stdlib `venv` module ships separately on some distros — most notably
    # Debian/Ubuntu, where you need `apt install python3-venv`.
    try:
        import venv  # noqa: F401
    except ImportError:
        _fail_setup(
            "The Python `venv` module is missing from this interpreter.",
            hint=(
                "On Debian/Ubuntu, install it with:\n"
                "  sudo apt install python3-venv\n"
                "On other systems, you may need to reinstall Python including the standard library."
            ),
        )


def _bootstrap() -> None:
    # Already running inside the managed venv? Nothing to do.
    try:
        if _VENV.is_dir() and os.path.samefile(sys.prefix, _VENV):
            return
    except (FileNotFoundError, OSError):
        pass

    # Current interpreter already has everything? Use it.
    if _have_deps():
        return

    expected = "\n".join(_DEPS)
    marker = _VENV / ".deps"

    # Create the venv if missing. This uses the *current* interpreter, so it must
    # satisfy our Python version requirement and have a working `venv` module.
    if not _VENV_PY.exists():
        _check_python_version()
        _check_venv_module()
        sys.stderr.write("Setting up CLI dependencies in ./.venv (first run)...\n")
        try:
            subprocess.run(
                [sys.executable, "-m", "venv", str(_VENV)],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            _fail_setup(
                "Failed to create the virtual environment at ./.venv.",
                detail=f"`python -m venv` exited with status {e.returncode}",
                hint=(
                    "Common causes:\n"
                    "  - Missing system package (Debian/Ubuntu: sudo apt install python3-venv)\n"
                    "  - No write permission for the scripts/ directory\n"
                    "  - Insufficient disk space"
                ),
            )

    # Install or refresh deps inside the venv.
    if not marker.exists() or marker.read_text() != expected:
        sys.stderr.write("Installing CLI dependencies...\n")
        try:
            subprocess.run(
                [str(_VENV_PY), "-m", "pip", "install", "--quiet", *_DEPS],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            _fail_setup(
                "Failed to install CLI dependencies into ./.venv.",
                detail=f"`pip install` exited with status {e.returncode}",
                hint=(
                    "Common causes:\n"
                    "  - No internet connection (pip couldn't reach PyPI)\n"
                    "  - Corporate proxy or firewall blocking pip\n"
                    "  - A corrupted venv — try deleting ./.venv and re-running\n"
                    "\n"
                    "To install the dependencies manually:\n"
                    f"  {_VENV_PY} -m pip install {' '.join(_DEPS)}"
                ),
            )
        marker.write_text(expected)

    # Re-exec under the venv's Python so the rest of the file can import normally.
    args = [str(_VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]]
    if sys.platform == "win32":
        sys.exit(subprocess.run(args).returncode)
    try:
        os.execv(str(_VENV_PY), args)
    except OSError as e:
        _fail_setup(
            "Could not re-launch the CLI inside its virtual environment.",
            detail=f"os.execv failed: {e}",
            hint=(
                "Try invoking the venv's Python directly:\n"
                f"  {_VENV_PY} {Path(__file__).resolve()} {' '.join(sys.argv[1:])}"
            ),
        )


_bootstrap()

# ----------------------------------------------------------------------------
# Real imports — guaranteed available now that _bootstrap() returned.
# ----------------------------------------------------------------------------

import json
import re
import typing
from datetime import date
from io import StringIO
from typing import Any, Literal, Optional

import click
import typer
import typer.core
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from rich import box
from rich.console import Console, Group
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table
from rich.text import Text
from ruamel.yaml import YAML
from dataclasses import dataclass, field
from textual import on as _on_event
from textual.app import App as _TextualApp, ComposeResult
from textual.binding import Binding
from textual.containers import Container, Horizontal, Vertical, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import Button, DataTable, Footer, Header, Input, Label, Select, Static, TextArea
from ruamel.yaml.scalarstring import LiteralScalarString

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent
TESTS_DIR = REPO_ROOT / "tests"

LOGO = (
    "[bold cyan] ▄[/]        [bold cyan]▄[/] \n"
    "[bold cyan]  ▀▄[/]    [bold cyan]▄▀[/]  \n"
    "[bold cyan]    ▀▄[/][cyan]▄[/][bold cyan]▀[/]    \n"
    "[bold cyan]    ▄[/][cyan]▀[/][bold cyan]▀▄[/]    \n"
    "[bold magenta] █[/][cyan]▄▀[/]    [cyan]▀▄[/][magenta]█[/] \n"
    "[bold magenta]▄[/][magenta]▀▀▀[/]    [bold magenta]▀▀[/][magenta]▀[/][bold magenta]▄[/]"
)

RATINGS = ("excellent", "good", "partial", "failed")
RATING_GLYPH = {
    "excellent": "[bold green]●[/]",
    "good":      "[green]●[/]",
    "partial":   "[yellow]●[/]",
    "failed":    "[red]●[/]",
}
RATING_BLURB = {
    "excellent": "clean one-shot, fully met the prompt",
    "good":      "completed, but with minor flaws",
    "partial":   "major requirements unmet",
    "failed":    "could not be completed",
}

DomainT = Literal[
    "full-stack-web", "backend", "frontend", "cli",
    "mobile", "game", "data", "library", "other",
]
ThemeT = Literal[
    "bootstrap", "features", "refinements", "refactor",
    "extension", "performance", "security", "other",
]
DOMAINS: tuple[str, ...] = typing.get_args(DomainT)
THEMES: tuple[str, ...] = typing.get_args(ThemeT)

# Coding agents and inference providers — the source of truth is the
# /agents.json and /providers.json files at the repo root, so both the CLI and
# the generated site can consume the same data (id, name, description,
# homepage, category, logo). Anything not in those files fails validation;
# the "other" id is the catch-all.

def _load_id_list(filename: str) -> tuple[str, ...]:
    path = REPO_ROOT / filename
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        sys.stderr.write(f"\n[AgentArena] Missing {filename} at repo root.\n")
        sys.exit(1)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"\n[AgentArena] {filename}: invalid JSON: {e}\n")
        sys.exit(1)
    if not isinstance(entries, list):
        sys.stderr.write(f"\n[AgentArena] {filename}: top level must be a JSON array.\n")
        sys.exit(1)
    ids: list[str] = []
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict) or "id" not in entry:
            sys.stderr.write(f"\n[AgentArena] {filename}[{i}]: each entry must be an object with an 'id'.\n")
            sys.exit(1)
        ids.append(entry["id"])
    return tuple(ids)


AGENT_NAMES: tuple[str, ...] = _load_id_list("agents.json")
PROVIDERS: tuple[str, ...] = _load_id_list("providers.json")


def _load_models() -> tuple[list[dict], dict[str, str]]:
    """Load /models.json and return (entries, alias_map). Unlike agents and
    providers, models are NOT a closed set — the model field accepts any
    string. The catalog drives the wizard dropdown and aggregation; the
    alias map normalizes legacy / short-form ids to canonical ones at
    validation time so runs of the same model merge on the leaderboard."""
    path = REPO_ROOT / "models.json"
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [], {}
    except json.JSONDecodeError as e:
        sys.stderr.write(f"\n[AgentArena] models.json: invalid JSON: {e}\n")
        return [], {}
    if not isinstance(entries, list):
        return [], {}
    alias_map: dict[str, str] = {}
    valid: list[dict] = []
    for e in entries:
        if not isinstance(e, dict) or "id" not in e:
            continue
        valid.append(e)
        for alias in (e.get("aliases") or []):
            alias_map[alias] = e["id"]
    return valid, alias_map


MODELS_CATALOG, MODEL_ALIASES = _load_models()
MODEL_IDS: tuple[str, ...] = tuple(m["id"] for m in MODELS_CATALOG)

# Sentinel value used by the RunAddScreen's model Select dropdown to reveal
# the free-form input. Any unique non-id string would do.
_MODEL_OTHER_VALUE = "__other__"
_MODEL_OTHER_LABEL = "Other (type your own)"

SELF_HOSTED_FRAMEWORKS = ("lm-studio", "ollama", "llama.cpp", "vllm", "mlx", "other")

DOMAIN_LABELS = {
    "full-stack-web": "full-stack-web — web app, frontend + backend",
    "backend":        "backend        — APIs, services, databases",
    "frontend":       "frontend       — UI-only (SPA, static site)",
    "cli":            "cli            — command-line tool or script",
    "mobile":         "mobile         — iOS / Android / cross-platform",
    "game":           "game           — game, simulation, or interactive toy",
    "data":           "data           — pipelines, ETL, analytics",
    "library":        "library        — SDK, library, or framework",
    "other":          "other",
}
THEME_LABELS = {
    "bootstrap":   "bootstrap   — initial creation from scratch",
    "features":    "features    — add new functionality",
    "refinements": "refinements — polish, bug fixes, small improvements",
    "refactor":    "refactor    — restructure without changing behavior",
    "extension":   "extension   — significant new capability",
    "performance": "performance — optimization work",
    "security":    "security    — security hardening",
    "other":       "other",
}

console = Console()
err_console = Console(stderr=True)

yaml = YAML()
yaml.indent(mapping=2, sequence=4, offset=2)
yaml.preserve_quotes = True
yaml.width = 120

# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class Hardware(BaseModel, extra="allow"):
    device: Optional[str] = None        # overall machine label (e.g. nvidia-spark, m3-max)
    gpu: Optional[str] = None           # GPU model if not implied by `device`
    vram_gb: Optional[int] = None
    ram_gb: Optional[int] = None


class Agent(BaseModel):
    name: str
    plan: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _check_name(cls, v: str) -> str:
        if v not in AGENT_NAMES:
            opts = ", ".join(f"'{n}'" for n in AGENT_NAMES)
            raise ValueError(f"must be one of {opts} (see /agents.json)")
        return v


class RunStage(BaseModel):
    id: str
    duration_sec: int = Field(ge=0)
    tokens_in: Optional[int] = Field(default=None, ge=0)
    tokens_out: Optional[int] = Field(default=None, ge=0)
    cost_usd: Optional[float] = Field(default=None, ge=0)
    rating: Literal["excellent", "good", "partial", "failed"]
    notes: Optional[str] = None


class Run(BaseModel):
    contributor_url: str                # URL identifying the contributor (GitHub profile, personal site, Mastodon, etc.)
    date: date                          # the day the run was performed (YYYY-MM-DD)
    agent: Agent
    provider: str
    framework: Optional[str] = None     # inference engine (e.g. lm-studio, ollama, vllm). Required when provider == "self-hosted".
    model: str
    quantization: Optional[str] = None  # how the model is loaded (e.g. q4_K_M, fp16). Meaningful for self-hosted inference.
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

    @field_validator("provider")
    @classmethod
    def _check_provider(cls, v: str) -> str:
        if v not in PROVIDERS:
            opts = ", ".join(f"'{n}'" for n in PROVIDERS)
            raise ValueError(f"must be one of {opts} (see /providers.json)")
        return v

    @field_validator("model")
    @classmethod
    def _normalize_model(cls, v: str) -> str:
        """Rewrite legacy / short-form model ids to the canonical id from
        /models.json. Unknown ids are accepted as-is — the model field is
        free-form; the catalog only drives aggregation and the wizard
        dropdown."""
        v = v.strip()
        return MODEL_ALIASES.get(v, v)

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
    contributor_url: str                # URL identifying the test's author (same convention as run.yaml).
    name: str
    title: str
    description: str
    domain: Optional[DomainT] = None
    stack: Optional[str] = None         # optional tech stack id from /stacks.json (e.g. "php-symfony").
    stages: list[TestStage]

    @field_validator("contributor_url")
    @classmethod
    def _check_contributor_url(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            raise ValueError("must be a URL starting with http:// or https://")
        return v


# --------------------------------------------------------------------------- #
# IO helpers
# --------------------------------------------------------------------------- #


def list_test_names() -> list[str]:
    if not TESTS_DIR.is_dir():
        return []
    return sorted(p.name for p in TESTS_DIR.iterdir() if (p / "test.yaml").is_file())


def load_test(name: str) -> Test:
    path = TESTS_DIR / name / "test.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Test '{name}' not found at {path}")
    data = yaml.load(path.read_text(encoding="utf-8"))
    return Test.model_validate(data)


def list_run_ids(test_name: str) -> list[str]:
    runs_dir = TESTS_DIR / test_name / "runs"
    if not runs_dir.is_dir():
        return []
    return sorted(p.name for p in runs_dir.iterdir() if (p / "run.yaml").is_file())


def load_run(test_name: str, run_id: str) -> Run:
    path = TESTS_DIR / test_name / "runs" / run_id / "run.yaml"
    if not path.is_file():
        raise FileNotFoundError(f"Run '{run_id}' for test '{test_name}' not found")
    data = yaml.load(path.read_text(encoding="utf-8"))
    return Run.model_validate(data)


def write_yaml(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = StringIO()
    yaml.dump(data, buf)
    path.write_text(buf.getvalue(), encoding="utf-8")


def test_to_yaml(t: Test) -> dict:
    d = t.model_dump(exclude_none=True)
    for stage in d.get("stages", []):
        if stage.get("prompt") and "\n" in stage["prompt"]:
            stage["prompt"] = LiteralScalarString(stage["prompt"])
    if "description" in d and "\n" in d["description"]:
        d["description"] = LiteralScalarString(d["description"])
    return d


def run_to_yaml(r: Run) -> dict:
    d = r.model_dump(exclude_none=True)
    for stage in d.get("stages", []):
        notes = stage.get("notes")
        if notes and "\n" in notes:
            stage["notes"] = LiteralScalarString(notes)
    return d


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def parse_duration(s: str) -> Optional[int]:
    """Parse a duration like '7:27', '1:30:45', or '447' into seconds."""
    s = s.strip()
    if not s:
        return None
    try:
        if ":" in s:
            parts = s.split(":")
            if len(parts) == 2:
                m, sec = parts
                return int(m) * 60 + int(sec)
            if len(parts) == 3:
                h, m, sec = parts
                return int(h) * 3600 + int(m) * 60 + int(sec)
            return None
        return int(s)
    except (ValueError, TypeError):
        return None


def parse_token_count(s: str) -> Optional[int]:
    """Parse a token count like '26300', '26,300', '26.3k', '147.9k'."""
    s = s.strip().replace(",", "").lower()
    if not s:
        return None
    try:
        if s.endswith("k"):
            return int(float(s[:-1]) * 1000)
        if s.endswith("m"):
            return int(float(s[:-1]) * 1_000_000)
        return int(float(s))
    except (ValueError, TypeError):
        return None


def parse_cost(s: str) -> Optional[float]:
    s = s.strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def parse_iso_date(s: str) -> Optional[date]:
    try:
        return date.fromisoformat(s.strip())
    except (ValueError, TypeError):
        return None


def handle_from_url(url: str) -> str:
    """Extract a short human-readable handle from a URL for use in slugs/displays.

    Examples:
      https://github.com/tin-cat        -> tin-cat
      https://tin-cat.dev               -> tin-cat
      https://twitter.com/tin-cat       -> tin-cat
    """
    from urllib.parse import urlparse
    parsed = urlparse(url.strip())
    path_parts = [p for p in parsed.path.split("/") if p]
    if path_parts:
        return path_parts[-1]
    netloc = parsed.netloc.removeprefix("www.")
    return netloc.split(".")[0] if netloc else url


def short_url(url: str) -> str:
    """Strip the scheme for compact display in tables."""
    for prefix in ("https://", "http://"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return url


_KEBAB_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")


def is_kebab_case(s: str) -> bool:
    return bool(_KEBAB_RE.match(s))


def sanitize_slug(s: str, *, allow_dots: bool = True) -> str:
    s = s.lower()
    keep = r"a-z0-9.\-" if allow_dots else r"a-z0-9\-"
    s = re.sub(rf"[^{keep}]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def truncate(text: str, width: int) -> str:
    text = " ".join((text or "").split())
    if len(text) <= width:
        return text
    return text[: width - 1] + "…"


# --------------------------------------------------------------------------- #
# Textual UI — `test add` / `run add` open form screens. Esc walks up the
# stack (modals → form → quit); Q quits from anywhere. Stage editing happens
# in modal screens; a preview modal shows the YAML before writing to disk.
# --------------------------------------------------------------------------- #


AGENT_ARENA_CSS = """
Screen {
    background: $background;
}

.section-title {
    color: cyan;
    text-style: bold;
    margin: 1 1 0 1;
}

#test-info, #run-info {
    border: round cyan;
    padding: 0 1;
    margin: 0 1 1 1;
    height: auto;
}

.intro-banner {
    border: round cyan 50%;
    padding: 0 1;
    margin: 0 1 1 1;
    height: auto;
}

.prompt-panel {
    border: round $primary 50%;
    padding: 0 1;
    margin: 0 1 1 1;
    height: auto;
}

.stage-meta {
    margin: 0 1;
}

.error {
    color: $error;
    padding: 1 2;
}

DataTable {
    margin: 0 1;
}

/* form styles */
.field-label {
    color: cyan;
    margin: 1 1 0 1;
}

.help-text {
    color: $foreground 60%;
    margin: 0 1 1 1;
}

.button-row {
    height: auto;
    margin: 1 1 0 1;
}

.button-row > Button {
    margin: 0 1 0 0;
}

Input, TextArea, Select {
    margin: 0 1 1 1;
}

#description, #settings-area {
    height: 6;
}

#stage-prompt-area {
    height: 14;
}

#notes-area {
    height: 4;
}

#self-hosted-section {
    height: auto;
}

#self-hosted-section.hidden {
    display: none;
}

#model-other-section {
    height: auto;
}

#model-other-section.hidden {
    display: none;
}

/* Two-column form layout for the RunAddScreen upper fields. Each column is
   a Vertical with width: 1fr so the two cols share available width evenly.
   The "Stages" section below remains full-width (it lives outside the row). */
#form-columns {
    height: auto;
    margin: 0 1;
}

.form-col {
    width: 1fr;
    height: auto;
    margin: 0 1 0 0;
}

.form-col:last-of-type {
    margin-right: 0;
}

.preview-yaml {
    border: round cyan;
    padding: 0 1;
    margin: 0 1 1 1;
    height: 1fr;
}

.modal-container {
    width: 90%;
    height: 90%;
    border: thick cyan;
    background: $surface;
    padding: 0 1;
}

/* RunStageEditScreen: prompt reference (left) beside the metrics form (right). */
#stage-columns {
    height: 1fr;
}

#stage-prompt-col {
    width: 1fr;
    height: 1fr;
    margin: 0 1 0 0;
}

/* Labels default to width:auto and won't wrap; let them fill the column. */
#stage-prompt-col Label {
    width: 1fr;
}

#stage-form-col {
    width: 1fr;
    height: 1fr;
}

.prompt-scroll {
    border: round $primary 50%;
    padding: 0 1;
    margin: 0 1 1 1;
    height: 1fr;
}

#stage-prompt-text {
    width: 1fr;
}

TestStageEditScreen, RunStageEditScreen, _TestPreviewScreen, _RunPreviewScreen {
    align: center middle;
}
"""


class AgentArenaApp(_TextualApp):
    """Textual app hosting the interactive test/run creation wizards."""

    CSS = AGENT_ARENA_CSS
    TITLE = "AgentArena"
    # Hide Textual's built-in command palette (the top-left "o" icon and the
    # ^p footer hint). Our screens have their own buttons / bindings; the
    # palette is just extra surface area for a single-purpose form app.
    ENABLE_COMMAND_PALETTE = False
    BINDINGS = [Binding("ctrl+c", "quit", "Quit", show=False)]

    def __init__(self, *, initial_stack: list[Screen]) -> None:
        super().__init__()
        self._initial_stack: list[Screen] = initial_stack

    def on_mount(self) -> None:
        for screen in self._initial_stack:
            self.push_screen(screen)


# --------------------------------------------------------------------------- #
# Textual forms — test add / run add. Both flows reuse AgentArenaApp with a
# dedicated form screen as the initial stack. Stage editing happens in modal
# screens; a final preview modal shows the YAML before writing to disk.
# --------------------------------------------------------------------------- #


@dataclass
class _StageDraft:
    """Test-stage data captured while filling out the test-add form."""
    idx: int
    id: str = ""
    theme: str = "bootstrap"
    builds_on: Optional[str] = None
    prompt: str = ""


@dataclass
class _RunStageDraft:
    """Per-stage metrics captured while filling out the run-add form."""
    stage_id: str
    recorded: bool = False
    duration_sec: Optional[int] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    cost_usd: Optional[float] = None
    rating: str = "good"
    notes: Optional[str] = None


class TestStageEditScreen(ModalScreen[Optional[_StageDraft]]):
    """Modal: add or edit a single test stage."""

    BINDINGS = [
        Binding("escape", "cancel", "Cancel"),
        Binding("ctrl+s", "save", "Save stage"),
    ]

    def __init__(self, idx: int, *, previous_stage_ids: list[str], initial: Optional[_StageDraft] = None) -> None:
        super().__init__()
        self.idx = idx
        self.previous_stage_ids = previous_stage_ids
        self.initial = initial

    def compose(self) -> ComposeResult:
        with Container(classes="modal-container"):
            yield Header()
            with VerticalScroll():
                yield Label(f"Stage {self.idx}", classes="section-title")
                prefix = f"stage-{self.idx}-"
                yield Label(f"ID (must start with '{prefix}'):", classes="field-label")
                yield Input(
                    value=self.initial.id if self.initial else prefix,
                    placeholder=prefix,
                    id="stage-id",
                )
                yield Label("Theme:", classes="field-label")
                yield Select(
                    options=[(THEME_LABELS[t], t) for t in THEMES],
                    value=self.initial.theme if self.initial else THEMES[0],
                    id="stage-theme",
                    allow_blank=False,
                )
                if self.previous_stage_ids:
                    yield Label("Builds on (optional):", classes="field-label")
                    yield Select(
                        options=[(p, p) for p in self.previous_stage_ids],
                        value=self.initial.builds_on if (self.initial and self.initial.builds_on) else Select.BLANK,
                        id="stage-builds-on",
                    )
                yield Label("Prompt (fed to the LLM verbatim):", classes="field-label")
                yield TextArea(
                    self.initial.prompt if self.initial else "",
                    id="stage-prompt-area",
                )
                with Horizontal(classes="button-row"):
                    yield Button("Cancel", id="cancel")
                    yield Button("Save stage", id="save", variant="success")
            yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = f"stage {self.idx}"
        self.query_one("#stage-id", Input).focus()

    def action_cancel(self) -> None:
        self.dismiss(None)

    def action_save(self) -> None:
        self._save()

    @_on_event(Button.Pressed, "#cancel")
    def _on_cancel(self) -> None:
        self.dismiss(None)

    @_on_event(Button.Pressed, "#save")
    def _on_save(self) -> None:
        self._save()

    def _save(self) -> None:
        stage_id = self.query_one("#stage-id", Input).value.strip()
        prefix = f"stage-{self.idx}-"
        if not stage_id.startswith(prefix) or not is_kebab_case(stage_id):
            self.notify(f"ID must be kebab-case starting with '{prefix}'.", severity="error", title="Invalid stage ID")
            return
        theme = str(self.query_one("#stage-theme", Select).value)
        builds_on: Optional[str] = None
        if self.previous_stage_ids:
            v = self.query_one("#stage-builds-on", Select).value
            if v not in (Select.BLANK, None):
                builds_on = str(v)
        prompt = self.query_one("#stage-prompt-area", TextArea).text.strip()
        if not prompt:
            self.notify("Prompt cannot be empty.", severity="error")
            return
        self.dismiss(_StageDraft(idx=self.idx, id=stage_id, theme=theme, builds_on=builds_on, prompt=prompt))


class _TestPreviewScreen(ModalScreen[bool]):
    """Modal: preview the test.yaml that will be written; True = save, False = back."""

    BINDINGS = [
        Binding("escape", "back", "Back"),
        Binding("ctrl+s", "save", "Save"),
    ]

    def __init__(self, test_yaml_text: str, target_path: Path) -> None:
        super().__init__()
        self.test_yaml_text = test_yaml_text
        self.target_path = target_path

    def compose(self) -> ComposeResult:
        with Container(classes="modal-container"):
            yield Header()
            yield Label("Preview", classes="section-title")
            try:
                rel = self.target_path.relative_to(REPO_ROOT)
            except ValueError:
                rel = self.target_path
            yield Label(f"Will write to: {rel}", classes="help-text")
            with VerticalScroll(classes="preview-yaml"):
                yield Static(self.test_yaml_text)
            with Horizontal(classes="button-row"):
                yield Button("Back to edit", id="back")
                yield Button("Save test.yaml", id="save", variant="success")
            yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "preview"

    def action_back(self) -> None:
        self.dismiss(False)

    def action_save(self) -> None:
        self.dismiss(True)

    @_on_event(Button.Pressed, "#back")
    def _on_back(self) -> None:
        self.dismiss(False)

    @_on_event(Button.Pressed, "#save")
    def _on_save(self) -> None:
        self.dismiss(True)


class TestAddScreen(Screen):
    """Form: create a new test.yaml."""

    BINDINGS = [
        Binding("escape", "app.quit", "Cancel"),
        Binding("ctrl+s", "save", "Preview & save"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.stages: list[_StageDraft] = []

    def compose(self) -> ComposeResult:
        yield Header()
        with VerticalScroll(id="content"):
            with Horizontal(id="form-columns"):
                # ── column 1: identity + name + title ──
                with Vertical(classes="form-col"):
                    yield Label("Your contributor URL (GitHub profile, personal site, Mastodon, etc.):", classes="field-label")
                    yield Input(placeholder="https://github.com/your-username", id="contributor-url")
                    yield Label(
                        "This identifies you on the site. Use the same URL for all your tests and runs so they group under one profile.",
                        classes="help-text",
                    )
                    yield Label("Name (test directory, kebab-case):", classes="field-label")
                    yield Input(placeholder="e.g. live-message-wall", id="name")
                    yield Label("Short human-readable title:", classes="field-label")
                    yield Input(placeholder="A live message wall", id="title")

                # ── column 2: description + domain ──
                with Vertical(classes="form-col"):
                    yield Label("Description (one or two sentences):", classes="field-label")
                    yield TextArea("", id="description")
                    yield Label("Domain (optional, pick the closest match):", classes="field-label")
                    yield Select(
                        options=[(DOMAIN_LABELS[d], d) for d in DOMAINS],
                        allow_blank=True,
                        id="domain",
                        prompt="(skip)",
                    )

            yield Label("Stages", classes="section-title")
            yield Label("Add stages in order; later stages may build on earlier ones.", classes="help-text")
            yield DataTable(id="stages-table", show_cursor=False, zebra_stripes=True)
            with Horizontal(classes="button-row"):
                yield Button("+ Add stage", id="add-stage", variant="primary")
                yield Button("- Remove last", id="remove-stage")
            with Horizontal(classes="button-row"):
                yield Button("Cancel", id="cancel")
                yield Button("Preview & save", id="save", variant="success")
        yield Footer()

    def on_mount(self) -> None:
        self.app.title = "AgentArena"
        self.app.sub_title = "new test"
        table = self.query_one("#stages-table", DataTable)
        table.add_columns("#", "ID", "Theme", "Builds on")
        self.query_one("#contributor-url", Input).focus()

    def _refresh_stages(self) -> None:
        table = self.query_one("#stages-table", DataTable)
        table.clear()
        for s in self.stages:
            table.add_row(str(s.idx), s.id, s.theme, s.builds_on or "-")

    @_on_event(Button.Pressed, "#add-stage")
    def _add_stage(self) -> None:
        next_idx = len(self.stages) + 1
        prev_ids = [s.id for s in self.stages]
        self.app.push_screen(
            TestStageEditScreen(next_idx, previous_stage_ids=prev_ids),
            self._stage_returned,
        )

    def _stage_returned(self, draft: Optional[_StageDraft]) -> None:
        if draft is None:
            return
        self.stages.append(draft)
        self._refresh_stages()

    @_on_event(Button.Pressed, "#remove-stage")
    def _remove_stage(self) -> None:
        if self.stages:
            self.stages.pop()
            self._refresh_stages()

    @_on_event(Button.Pressed, "#cancel")
    def _cancel(self) -> None:
        self.app.exit()

    @_on_event(Button.Pressed, "#save")
    def _save_button(self) -> None:
        self.action_save()

    def action_save(self) -> None:
        contributor_url = self.query_one("#contributor-url", Input).value.strip()
        name = self.query_one("#name", Input).value.strip()
        title = self.query_one("#title", Input).value.strip()
        description = self.query_one("#description", TextArea).text.strip()
        domain_widget = self.query_one("#domain", Select)
        dv = domain_widget.value
        domain = str(dv) if dv not in (Select.BLANK, None) else None

        errors: list[str] = []
        if not contributor_url:
            errors.append("Contributor URL is required — it identifies you on the site.")
        elif not contributor_url.startswith(("http://", "https://")):
            errors.append("Contributor URL must start with http:// or https://.")
        if not name or not is_kebab_case(name):
            errors.append("Name must be kebab-case (lowercase letters/digits/dashes).")
        target_dir = TESTS_DIR / name if name else None
        if target_dir and target_dir.exists():
            errors.append(f"Directory already exists: tests/{name}")
        if not title:
            errors.append("Title is required.")
        if not description:
            errors.append("Description is required.")
        if not self.stages:
            errors.append("Add at least one stage.")
        if errors:
            self.notify("\n".join(errors), severity="error", title="Cannot save")
            return

        try:
            test = Test(
                contributor_url=contributor_url,
                name=name,
                title=title,
                description=description,
                domain=domain,
                stages=[TestStage(id=s.id, theme=s.theme, prompt=s.prompt, builds_on=s.builds_on) for s in self.stages],
            )
        except ValidationError as e:
            self.notify(str(e), severity="error", title="Schema validation failed")
            return

        buf = StringIO()
        yaml.dump(test_to_yaml(test), buf)
        target_path = target_dir / "test.yaml"  # type: ignore[union-attr]
        self.app.push_screen(
            _TestPreviewScreen(buf.getvalue(), target_path),
            lambda confirmed: self._after_preview(confirmed, test, target_dir),
        )

    def _after_preview(self, confirmed: bool, test: "Test", target_dir: Path) -> None:
        if not confirmed:
            return
        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "runs").mkdir(exist_ok=True)
        write_yaml(target_dir / "test.yaml", test_to_yaml(test))
        rel = (target_dir / "test.yaml").relative_to(REPO_ROOT)
        self.app.exit(result=str(rel))


class RunStageEditScreen(ModalScreen[Optional[_RunStageDraft]]):
    """Modal: record metrics for one stage of a run."""

    BINDINGS = [
        Binding("escape", "cancel", "Cancel"),
        Binding("ctrl+s", "save", "Save"),
        Binding("ctrl+y", "copy_prompt", "Copy prompt"),
    ]

    def __init__(
        self,
        stage_id: str,
        *,
        prompt: str = "",
        theme: str = "",
        test_title: str = "",
        initial: Optional[_RunStageDraft] = None,
    ) -> None:
        super().__init__()
        self.stage_id = stage_id
        self.prompt = prompt
        self.theme = theme
        self.test_title = test_title
        self.initial = initial

    def compose(self) -> ComposeResult:
        with Container(classes="modal-container"):
            yield Header()
            with Horizontal(id="stage-columns"):
                # ── left: the test's prompt, ready to copy & paste into the agent ──
                with Vertical(id="stage-prompt-col"):
                    yield Label(f"Test: {self.test_title or '?'}", classes="section-title")
                    stage_line = f"Stage: {self.stage_id}"
                    if self.theme:
                        stage_line += f"  ·  {self.theme}"
                    yield Label(stage_line, classes="field-label")
                    yield Label(
                        "Feed this prompt verbatim into a fresh agent session (close & reopen the "
                        "agent), working on the code left by the previous stage.",
                        classes="help-text",
                    )
                    with Horizontal(classes="button-row"):
                        yield Button("Copy prompt", id="copy-prompt")
                    with VerticalScroll(classes="prompt-scroll"):
                        yield Static(self.prompt or "(no prompt on file for this stage)", id="stage-prompt-text")
                # ── right: the metrics form ──
                with VerticalScroll(id="stage-form-col"):
                    yield Label("API time (mm:ss or seconds):", classes="field-label")
                    yield Input(
                        value=str(self.initial.duration_sec) if (self.initial and self.initial.duration_sec) else "",
                        placeholder="e.g. 7:27 or 447",
                        id="duration",
                    )
                    yield Label(
                        "Time the agent spent calling the model (API time), not time you spent reading"
                        "responses or approving confirmations.",
                        classes="help-text",
                    )
                    yield Label("Input tokens (optional, e.g. 12300 or 12.3k):", classes="field-label")
                    yield Input(
                        value=str(self.initial.tokens_in) if (self.initial and self.initial.tokens_in is not None) else "",
                        placeholder="empty to skip",
                        id="tokens-in",
                    )
                    yield Label("Output tokens (optional):", classes="field-label")
                    yield Input(
                        value=str(self.initial.tokens_out) if (self.initial and self.initial.tokens_out is not None) else "",
                        placeholder="empty to skip",
                        id="tokens-out",
                    )
                    yield Label("Cost in USD (optional, e.g. 0.63):", classes="field-label")
                    yield Input(
                        value=str(self.initial.cost_usd) if (self.initial and self.initial.cost_usd is not None) else "",
                        placeholder="empty to skip",
                        id="cost",
                    )
                    yield Label("Rating:", classes="field-label")
                    yield Select(
                        options=[(f"{r} - {RATING_BLURB[r]}", r) for r in RATINGS],
                        value=self.initial.rating if self.initial else "good",
                        id="rating",
                        allow_blank=False,
                    )
                    yield Label("Notes (optional):", classes="field-label")
                    yield TextArea(
                        self.initial.notes if (self.initial and self.initial.notes) else "",
                        id="notes-area",
                    )
                    with Horizontal(classes="button-row"):
                        yield Button("Cancel", id="cancel")
                        yield Button("Save metrics", id="save", variant="success")
            yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = f"stage: {self.stage_id}"
        self.query_one("#duration", Input).focus()

    def action_copy_prompt(self) -> None:
        self._copy_prompt()

    @_on_event(Button.Pressed, "#copy-prompt")
    def _on_copy_prompt(self) -> None:
        self._copy_prompt()

    def _copy_prompt(self) -> None:
        if not self.prompt:
            self.notify("No prompt to copy for this stage.", severity="warning")
            return
        self.app.copy_to_clipboard(self.prompt)
        self.notify("Prompt copied to clipboard.")

    def action_cancel(self) -> None:
        self.dismiss(None)

    def action_save(self) -> None:
        self._save()

    @_on_event(Button.Pressed, "#cancel")
    def _on_cancel(self) -> None:
        self.dismiss(None)

    @_on_event(Button.Pressed, "#save")
    def _on_save(self) -> None:
        self._save()

    def _save(self) -> None:
        duration_raw = self.query_one("#duration", Input).value.strip()
        if not duration_raw:
            self.notify("Duration is required.", severity="error")
            return
        duration_sec = parse_duration(duration_raw)
        if duration_sec is None:
            self.notify("Duration must be mm:ss or a plain number of seconds.", severity="error")
            return

        ti_raw = self.query_one("#tokens-in", Input).value.strip()
        tokens_in = parse_token_count(ti_raw) if ti_raw else None
        if ti_raw and tokens_in is None:
            self.notify("Invalid input tokens (use a number, optional k/M suffix).", severity="error")
            return

        to_raw = self.query_one("#tokens-out", Input).value.strip()
        tokens_out = parse_token_count(to_raw) if to_raw else None
        if to_raw and tokens_out is None:
            self.notify("Invalid output tokens.", severity="error")
            return

        cost_raw = self.query_one("#cost", Input).value.strip()
        cost_usd = parse_cost(cost_raw) if cost_raw else None
        if cost_raw and cost_usd is None:
            self.notify("Invalid cost (use a number, optionally with $).", severity="error")
            return

        rating = str(self.query_one("#rating", Select).value)
        notes = self.query_one("#notes-area", TextArea).text.strip() or None

        self.dismiss(_RunStageDraft(
            stage_id=self.stage_id,
            recorded=True,
            duration_sec=duration_sec,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
            rating=rating,
            notes=notes,
        ))


class _RunPreviewScreen(ModalScreen[Optional[str]]):
    """Modal: preview run.yaml and pick the run-id slug. Returns the slug on save, None on back."""

    BINDINGS = [
        Binding("escape", "back", "Back"),
        Binding("ctrl+s", "save", "Save"),
    ]

    def __init__(self, run_yaml_text: str, test_name: str, suggested_id: str) -> None:
        super().__init__()
        self.run_yaml_text = run_yaml_text
        self.test_name = test_name
        self.suggested_id = suggested_id

    def compose(self) -> ComposeResult:
        with Container(classes="modal-container"):
            yield Header()
            yield Label("Preview", classes="section-title")
            yield Label("Run directory name (slug):", classes="field-label")
            yield Input(value=self.suggested_id, id="run-id")
            with VerticalScroll(classes="preview-yaml"):
                yield Static(self.run_yaml_text)
            with Horizontal(classes="button-row"):
                yield Button("Back to edit", id="back")
                yield Button("Save run.yaml", id="save", variant="success")
            yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "preview"
        self.query_one("#run-id", Input).focus()

    def action_back(self) -> None:
        self.dismiss(None)

    def action_save(self) -> None:
        self._save()

    @_on_event(Button.Pressed, "#back")
    def _on_back(self) -> None:
        self.dismiss(None)

    @_on_event(Button.Pressed, "#save")
    def _on_save(self) -> None:
        self._save()

    def _save(self) -> None:
        run_id = self.query_one("#run-id", Input).value.strip()
        if not run_id or run_id != sanitize_slug(run_id):
            self.notify("Run ID must be lowercase kebab-case (letters, digits, dots, dashes).", severity="error")
            return
        target = TESTS_DIR / self.test_name / "runs" / run_id / "run.yaml"
        if target.exists():
            self.notify(f"{target.relative_to(REPO_ROOT)} already exists - pick a different ID.", severity="warning")
            return
        self.dismiss(run_id)


class RunAddScreen(Screen):
    """Form: record a new run for an existing test."""

    BINDINGS = [
        Binding("escape", "app.quit", "Cancel"),
        Binding("ctrl+s", "save", "Preview & save"),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.run_stages: list[_RunStageDraft] = []
        self.test: Optional[Test] = None

    def compose(self) -> ComposeResult:
        yield Header()
        with VerticalScroll(id="content"):
            yield Static(
                "Browse every available test and its stage prompts at "
                "[bold cyan]https://agentarena.tin.cat/tests/[/]\n"
                "Copy each stage's prompt verbatim into your coding agent to run the test, then come back here to record the results.\n"
                "Always start your agent fresh for each stage, on the code left by the previous stage.\n"
                "Find more about how to run tests here: [bold cyan]https://agentarena.tin.cat/contribute/[/]",
                classes="intro-banner",
            )
            with Horizontal(id="form-columns"):
                # ── column 1: identity + agent ──
                with Vertical(classes="form-col"):
                    yield Label("Test you ran:", classes="field-label")
                    yield Select(
                        options=[(n, n) for n in list_test_names()],
                        id="test-name",
                        allow_blank=False,
                    )
                    yield Label("Your personal URL (GitHub, website, Mastodon...):", classes="field-label")
                    yield Input(placeholder="https://github.com/yourname", id="contributor-url")
                    yield Label("Date of the run (YYYY-MM-DD):", classes="field-label")
                    yield Input(value=date.today().isoformat(), id="date")
                    yield Label("Coding agent / client:", classes="field-label")
                    yield Select(
                        options=[(a, a) for a in AGENT_NAMES],
                        value="claude-code",
                        id="agent-name",
                        allow_blank=False,
                    )
                    yield Label("Agent plan / tier (optional, e.g. pro):", classes="field-label")
                    yield Input(placeholder="empty if N/A", id="agent-plan")

                # ── column 2: provider + model + settings + self-hosted ──
                with Vertical(classes="form-col"):
                    yield Label("Inference provider:", classes="field-label")
                    yield Select(
                        options=[(p, p) for p in PROVIDERS],
                        value="anthropic",
                        id="provider",
                        allow_blank=False,
                    )
                    yield Label("Model:", classes="field-label")
                    yield Select(
                        options=[(_MODEL_OTHER_LABEL, _MODEL_OTHER_VALUE)]
                                + [(f"{m['name']} · {m['id']}", m["id"]) for m in MODELS_CATALOG],
                        id="model-select",
                        allow_blank=True,
                        prompt="Select a model…",
                    )
                    with Container(id="model-other-section", classes="hidden"):
                        yield Label("Model identifier (free-form):", classes="field-label")
                        yield Input(
                            placeholder="e.g. some-new-model, my-org/my-finetune-v2",
                            id="model-other",
                        )
                    yield Static(
                        "Pick your model from the list. If it isn't there, choose 'Other (type your own)' "
                        "and enter the id below. To have a new model added to the list, contribute "
                        "a new entry in models.json. More info: [bold cyan]https://agentarena.tin.cat/contribute/[/].",
                        classes="help-text",
                    )
                    yield Label("Settings (one 'key=value' per line, optional):", classes="field-label")
                    yield TextArea("", id="settings-area")
                    yield Static(
                        "If you used any extra MCP servers, skills, custom subagents, or hooks beyond the "
                        "agent's defaults, list them here (e.g. 'mcps=linear,sentry', 'skills=simplify,review'). "
                        "Runs with undisclosed tooling aren't comparable to vanilla runs.",
                        classes="help-text",
                    )
                    with Container(id="self-hosted-section", classes="hidden"):
                        yield Label("Self-hosted details", classes="section-title")
                        yield Label("Inference framework:", classes="field-label")
                        yield Input(placeholder="e.g. lm-studio, ollama, llama.cpp, vllm, mlx", id="framework")
                        yield Label("Quantization (optional):", classes="field-label")
                        yield Input(placeholder="e.g. q4_K_M, q8_0, fp16", id="quantization")
                        yield Label("Machine label / device (optional):", classes="field-label")
                        yield Input(placeholder="e.g. nvidia-spark, m3-max, rtx-4090-pc", id="hw-device")
                        yield Label("GPU model (optional):", classes="field-label")
                        yield Input(placeholder="e.g. rtx-4090, h100", id="hw-gpu")
                        yield Label("VRAM in GB (integer, optional):", classes="field-label")
                        yield Input(id="hw-vram")
                        yield Label("System RAM in GB (integer, optional):", classes="field-label")
                        yield Input(id="hw-ram")

            yield Label("Stages", classes="section-title")
            yield Label("Select a row, then 'Record' to fill in its metrics.", classes="help-text")
            yield Static(
                "Start every stage from a fresh agent session: fully close your coding agent and "
                "reopen it before each stage, so no prior context carries over (the codebase is "
                "preserved, but the session is not). Record API time only: the time the agent spent "
                "calling the model, not time you spent reading responses or approving tool "
                "confirmations.",
                classes="help-text",
            )
            yield DataTable(id="run-stages-table", zebra_stripes=True)
            with Horizontal(classes="button-row"):
                yield Button("Record selected", id="record-stage", variant="primary")
                yield Button("Clear selected", id="clear-stage")
            with Horizontal(classes="button-row"):
                yield Button("Cancel", id="cancel")
                yield Button("Preview & save", id="save", variant="success")
        yield Footer()

    def on_mount(self) -> None:
        self.app.title = "AgentArena"
        self.app.sub_title = "new run"
        table = self.query_one("#run-stages-table", DataTable)
        table.add_columns("Stage", "Status", "Time", "Rating", "Cost")
        table.cursor_type = "row"
        names = list_test_names()
        if names:
            self._reload_test(names[0])
        self._update_self_hosted_visibility()
        self.query_one("#contributor-url", Input).focus()

    def _reload_test(self, test_name: str) -> None:
        try:
            self.test = load_test(test_name)
        except (FileNotFoundError, ValidationError) as e:
            self.notify(f"Cannot load test '{test_name}': {e}", severity="error")
            self.test = None
            return
        self.run_stages = [_RunStageDraft(stage_id=s.id) for s in self.test.stages]
        self._refresh_run_stages()

    def _refresh_run_stages(self) -> None:
        table = self.query_one("#run-stages-table", DataTable)
        table.clear()
        for s in self.run_stages:
            if s.recorded:
                mins, secs = divmod(s.duration_sec or 0, 60)
                duration = f"{mins}:{secs:02d}"
                cost = f"${s.cost_usd:.2f}" if s.cost_usd is not None else "-"
                table.add_row(s.stage_id, "recorded", duration, s.rating, cost, key=s.stage_id)
            else:
                table.add_row(s.stage_id, "-", "-", "-", "-", key=s.stage_id)

    @_on_event(Select.Changed, "#test-name")
    def _on_test_changed(self, event: Select.Changed) -> None:
        if event.value not in (Select.BLANK, None):
            self._reload_test(str(event.value))

    @_on_event(Select.Changed, "#provider")
    def _on_provider_changed(self, event: Select.Changed) -> None:  # noqa: ARG002
        self._update_self_hosted_visibility()

    @_on_event(Select.Changed, "#model-select")
    def _on_model_select_changed(self, event: Select.Changed) -> None:
        section = self.query_one("#model-other-section", Container)
        if event.value == _MODEL_OTHER_VALUE:
            section.remove_class("hidden")
        else:
            section.add_class("hidden")

    def _update_self_hosted_visibility(self) -> None:
        section = self.query_one("#self-hosted-section", Container)
        if str(self.query_one("#provider", Select).value) == "self-hosted":
            section.remove_class("hidden")
        else:
            section.add_class("hidden")

    @_on_event(Button.Pressed, "#record-stage")
    def _on_record_stage(self) -> None:
        table = self.query_one("#run-stages-table", DataTable)
        if table.row_count == 0:
            return
        try:
            row_key = table.coordinate_to_cell_key(table.cursor_coordinate).row_key
        except Exception:
            return
        stage_id = str(row_key.value)
        existing = next((s for s in self.run_stages if s.stage_id == stage_id), None)
        stage = next((st for st in self.test.stages if st.id == stage_id), None) if self.test else None
        self.app.push_screen(
            RunStageEditScreen(
                stage_id,
                prompt=stage.prompt if stage else "",
                theme=stage.theme if stage else "",
                test_title=self.test.title if self.test else "",
                initial=existing if (existing and existing.recorded) else None,
            ),
            lambda result: self._stage_returned(stage_id, result),
        )

    def _stage_returned(self, stage_id: str, draft: Optional[_RunStageDraft]) -> None:
        if draft is None:
            return
        for i, s in enumerate(self.run_stages):
            if s.stage_id == stage_id:
                self.run_stages[i] = draft
                break
        self._refresh_run_stages()

    @_on_event(Button.Pressed, "#clear-stage")
    def _on_clear_stage(self) -> None:
        table = self.query_one("#run-stages-table", DataTable)
        if table.row_count == 0:
            return
        try:
            row_key = table.coordinate_to_cell_key(table.cursor_coordinate).row_key
        except Exception:
            return
        stage_id = str(row_key.value)
        for i, s in enumerate(self.run_stages):
            if s.stage_id == stage_id:
                self.run_stages[i] = _RunStageDraft(stage_id=stage_id)
                break
        self._refresh_run_stages()

    @_on_event(Button.Pressed, "#cancel")
    def _cancel(self) -> None:
        self.app.exit()

    @_on_event(Button.Pressed, "#save")
    def _save_button(self) -> None:
        self.action_save()

    def action_save(self) -> None:
        test_name = str(self.query_one("#test-name", Select).value)
        if not test_name or self.test is None:
            self.notify("Pick a test first.", severity="error")
            return

        contributor_url = self.query_one("#contributor-url", Input).value.strip()
        date_raw = self.query_one("#date", Input).value.strip()
        agent_name = str(self.query_one("#agent-name", Select).value)
        agent_plan = self.query_one("#agent-plan", Input).value.strip() or None
        provider = str(self.query_one("#provider", Select).value)
        # The model dropdown stores the canonical id directly, except for the
        # "other" sentinel which routes to the free-form input below it.
        model_select_value = self.query_one("#model-select", Select).value
        if model_select_value == _MODEL_OTHER_VALUE:
            model = self.query_one("#model-other", Input).value.strip()
        elif model_select_value in (Select.BLANK, None):
            model = ""
        else:
            model = str(model_select_value)
        settings_raw = self.query_one("#settings-area", TextArea).text.strip()

        errors: list[str] = []
        if not contributor_url.startswith(("http://", "https://")):
            errors.append("Contributor URL must be a full http(s) URL.")
        run_date = parse_iso_date(date_raw)
        if run_date is None:
            errors.append("Date must be YYYY-MM-DD.")
        if not agent_name:
            errors.append("Agent name is required.")
        if not model:
            errors.append("Model identifier is required.")

        settings: dict[str, Any] = {}
        for line in settings_raw.splitlines():
            line_stripped = line.strip()
            if not line_stripped:
                continue
            if "=" not in line_stripped:
                errors.append(f"Settings line missing '=': {line_stripped!r}")
                continue
            k, _, v = line_stripped.partition("=")
            settings[k.strip()] = v.strip()

        framework: Optional[str] = None
        quantization: Optional[str] = None
        hardware: Optional[Hardware] = None
        if provider == "self-hosted":
            framework = self.query_one("#framework", Input).value.strip() or None
            quantization = self.query_one("#quantization", Input).value.strip() or None
            device = self.query_one("#hw-device", Input).value.strip() or None
            gpu = self.query_one("#hw-gpu", Input).value.strip() or None
            vram_raw = self.query_one("#hw-vram", Input).value.strip()
            ram_raw = self.query_one("#hw-ram", Input).value.strip()
            try:
                vram_gb = int(vram_raw) if vram_raw else None
            except ValueError:
                errors.append("VRAM must be an integer (GB).")
                vram_gb = None
            try:
                ram_gb = int(ram_raw) if ram_raw else None
            except ValueError:
                errors.append("RAM must be an integer (GB).")
                ram_gb = None
            if not framework:
                errors.append("Framework is required for self-hosted runs.")
            if any([device, gpu, vram_gb, ram_gb]):
                hardware = Hardware(device=device, gpu=gpu, vram_gb=vram_gb, ram_gb=ram_gb)

        recorded_stages = [s for s in self.run_stages if s.recorded]
        if not recorded_stages:
            errors.append("Record at least one stage.")

        if errors:
            self.notify("\n".join(errors), severity="error", title="Cannot save")
            return

        assert run_date is not None
        try:
            run = Run(
                contributor_url=contributor_url,
                date=run_date,
                agent=Agent(name=agent_name, plan=agent_plan),
                provider=provider,
                framework=framework,
                model=model,
                quantization=quantization,
                settings=settings,
                hardware=hardware,
                stages=[RunStage(
                    id=s.stage_id,
                    duration_sec=s.duration_sec or 0,
                    tokens_in=s.tokens_in,
                    tokens_out=s.tokens_out,
                    cost_usd=s.cost_usd,
                    rating=s.rating,
                    notes=s.notes,
                ) for s in recorded_stages],
            )
        except ValidationError as e:
            self.notify(str(e), severity="error", title="Schema validation failed")
            return

        suggested = f"{handle_from_url(contributor_url)}-{agent_name}-{model}"
        if settings:
            suggested += "-" + "-".join(f"{k}-{v}" for k, v in settings.items())
        suggested = sanitize_slug(suggested)

        buf = StringIO()
        yaml.dump(run_to_yaml(run), buf)
        self.app.push_screen(
            _RunPreviewScreen(buf.getvalue(), test_name, suggested),
            lambda run_id: self._after_preview(run_id, run, test_name, recorded_stages),
        )

    def _after_preview(self, run_id: Optional[str], run: "Run", test_name: str, recorded_stages: list[_RunStageDraft]) -> None:
        if run_id is None:
            return
        target = TESTS_DIR / test_name / "runs" / run_id / "run.yaml"
        target.parent.mkdir(parents=True, exist_ok=True)
        write_yaml(target, run_to_yaml(run))
        for s in recorded_stages:
            (target.parent / s.stage_id).mkdir(exist_ok=True)
        self.app.exit(result=str(target.relative_to(REPO_ROOT)))


# --------------------------------------------------------------------------- #
# Typer app
# --------------------------------------------------------------------------- #


_SCRIPT_INVOCATION = "./agent-arena-cli.py"


def _walk_commands(group: click.Group, prefix: str = ""):
    """Yield (path, signature, help_text) for every leaf command, in registration order.
    `signature` is the full invocation (script + subcommand chain + args) so the
    help screen shows commands exactly as they should be typed."""
    for name, cmd in group.commands.items():
        path = f"{prefix} {name}".strip()
        if isinstance(cmd, click.Group):
            yield from _walk_commands(cmd, path)
            continue
        arg_parts = []
        for p in cmd.params:
            if isinstance(p, click.Argument):
                meta = p.metavar or p.name.upper()
                arg_parts.append(f"<{meta}>" if p.required else f"[{meta}]")
        signature = " ".join([_SCRIPT_INVOCATION, path, *arg_parts])
        yield (path, signature, cmd.help or "")


def _print_main_help(root: click.Group) -> None:
    """Print a flat tree of every command under the root group. This is the
    one and only help screen — `--help` at any level routes here."""
    table = Table.grid(padding=(0, 4))
    table.add_column(style="bold cyan", no_wrap=True)
    table.add_column()

    for _path, signature, help_text in _walk_commands(root):
        table.add_row(signature, help_text)

    console.print("[bold]Usage:[/bold]\n")
    console.print(table)
    console.print()


class _MainHelpGroup(typer.core.TyperGroup):
    """Main-app help renderer — delegates to the shared main-help printer."""

    def format_help(self, ctx, formatter):  # noqa: ARG002
        _print_main_help(ctx.find_root().command)


# Route every --help (at any level: subgroup, leaf command) to the same main
# help screen. typer's rich_format_help is what every TyperGroup / TyperCommand
# eventually calls when rendering --help, so patching it here covers them all.
import typer.rich_utils as _typer_rich_utils

def _all_help_is_main_help(*, obj, ctx, markup_mode):  # noqa: ARG001
    _print_main_help(ctx.find_root().command)

_typer_rich_utils.rich_format_help = _all_help_is_main_help


app = typer.Typer(
    name="aact",
    no_args_is_help=True,
    add_completion=False,
    rich_markup_mode="rich",
    cls=_MainHelpGroup,
)
test_app = typer.Typer(help="Test definitions.", no_args_is_help=True)
run_app = typer.Typer(help="Test runs (contributed results).", no_args_is_help=True)
app.add_typer(test_app, name="test")
app.add_typer(run_app, name="run")


# --------------------------------------------------------------------------- #
# run add (interactive)
# --------------------------------------------------------------------------- #


@run_app.command("add")
def run_add_cmd() -> None:
    """Interactively record a new run for an existing test."""
    if not list_test_names():
        err_console.print("[red]No tests exist yet. Create one first with `test add`.[/red]")
        raise typer.Exit(1)
    app = AgentArenaApp(initial_stack=[RunAddScreen()])
    result = app.run()
    if result:
        run_dir = Path(result).parent
        console.print(
            f"\n[green]✓[/green] Created [bold]{run_dir}/[/bold] with your "
            "[bold]run.yaml[/bold] and a subdirectory for each stage to hold the source code."
        )
        console.print(
            "\n[dim]Optional: drop the source code your agent produced for each stage into its "
            "stage subdirectory. This last step is entirely optional, your run.yaml on its own "
            "is already a valid contribution.[/dim]"
        )
        console.print(
            "[dim]After making changes, run [bold]./agent-arena-cli.py validate[/bold] "
            "to check that they still match the schema.[/dim]"
        )


# --------------------------------------------------------------------------- #
# test add (Textual form)
# --------------------------------------------------------------------------- #


@test_app.command("add")
def test_add_cmd() -> None:
    """Interactively create a new test."""
    app = AgentArenaApp(initial_stack=[TestAddScreen()])
    result = app.run()
    if result:
        console.print(f"\n[green]✓[/green] Wrote {result}")
        console.print(
            f"\n[dim]You can edit {result} manually at any time.[/dim]\n"
            "[dim]After making changes, run [bold]./agent-arena-cli.py validate[/bold] "
            "to check that they still match the schema.[/dim]"
        )

# --------------------------------------------------------------------------- #
# validate
# --------------------------------------------------------------------------- #


def _validate_path(path: Path) -> list[tuple[Path, str]]:
    if not path.is_file():
        return [(path, "File not found")]
    try:
        data = yaml.load(path.read_text(encoding="utf-8"))
    except Exception as e:
        return [(path, f"YAML parse error: {e}")]

    if path.name == "test.yaml":
        model: type[BaseModel] = Test
    elif path.name == "run.yaml":
        model = Run
    else:
        return [(path, "Unknown YAML kind (expected test.yaml or run.yaml)")]

    try:
        model.model_validate(data)
        return []
    except ValidationError as e:
        errors = []
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"])
            errors.append((path, f"{loc}: {err['msg']}"))
        return errors


def _cross_check_test(test_name: str) -> list[tuple[Path, str]]:
    """Check builds_on references inside a test.yaml."""
    path = TESTS_DIR / test_name / "test.yaml"
    try:
        t = load_test(test_name)
    except (FileNotFoundError, ValidationError):
        return []
    errors: list[tuple[Path, str]] = []
    seen_ids: set[str] = set()
    for stage in t.stages:
        if stage.builds_on and stage.builds_on not in seen_ids:
            errors.append((path, f"stage '{stage.id}' builds_on '{stage.builds_on}' which does not appear earlier"))
        seen_ids.add(stage.id)
    return errors


def _cross_check_run(test_name: str, run_id: str, valid_stage_ids: set[str]) -> list[tuple[Path, str]]:
    path = TESTS_DIR / test_name / "runs" / run_id / "run.yaml"
    try:
        r = load_run(test_name, run_id)
    except (FileNotFoundError, ValidationError):
        return []
    errors: list[tuple[Path, str]] = []
    seen: set[str] = set()
    for s in r.stages:
        if valid_stage_ids and s.id not in valid_stage_ids:
            errors.append((path, f"stage '{s.id}' is not defined in test.yaml"))
        if s.id in seen:
            errors.append((path, f"stage '{s.id}' appears more than once"))
        seen.add(s.id)
    return errors


@app.command("validate")
def validate_cmd(
    path: Optional[Path] = typer.Argument(
        None,
        help="Path to a single test.yaml or run.yaml to validate. Omit to validate every YAML file in the repo.",
    ),
) -> None:
    """Validate every test.yaml/run.yaml in the repo, or just the file at PATH if given."""
    errors: list[tuple[Path, str]] = []

    if path is not None:
        errors += _validate_path(path)
    else:
        for test_name in list_test_names():
            test_yaml = TESTS_DIR / test_name / "test.yaml"
            errors += _validate_path(test_yaml)
            errors += _cross_check_test(test_name)

            try:
                t = load_test(test_name)
                valid_ids = {s.id for s in t.stages}
            except (FileNotFoundError, ValidationError):
                valid_ids = set()

            for run_id in list_run_ids(test_name):
                run_yaml = TESTS_DIR / test_name / "runs" / run_id / "run.yaml"
                errors += _validate_path(run_yaml)
                errors += _cross_check_run(test_name, run_id, valid_ids)

    if not errors:
        console.print("[green]✓ All YAML files valid.[/green]")
        return

    console.print(f"[red]Found {len(errors)} validation error(s):[/red]\n")
    for p, msg in errors:
        try:
            rel = p.relative_to(REPO_ROOT)
        except ValueError:
            rel = p
        console.print(f"  [bold]{rel}[/bold]: {msg}")
    raise typer.Exit(1)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def _print_banner() -> None:
    title = "AgentArena"
    tagline = (
        "A community benchmark for AI coding agent performance"
    )
    subtagline = "Contribute your tests and runs"
    right = (
        "\n"
        f"[bold cyan]{title}[/bold cyan]\n"
        f"[bold]{tagline}[/bold]\n"
        f"[dim]{subtagline}[/dim]\n"
    )
    grid = Table.grid(padding=(0, 2))
    grid.add_column()
    grid.add_column()
    grid.add_row(LOGO, right)

    console.print()
    console.print(grid)
    console.print()


if __name__ == "__main__":
    # Show the banner on help screens and on no-args invocation (which prints help).
    if len(sys.argv) == 1 or any(a in ("--help", "-h") for a in sys.argv[1:]):
        _print_banner()
    try:
        app()
    except KeyboardInterrupt:
        err_console.print("\n[yellow]Interrupted.[/yellow]")
        sys.exit(130)
