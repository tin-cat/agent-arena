#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "typer>=0.12",
#     "rich>=13.7",
#     "questionary>=2.0",
#     "pydantic>=2.6",
#     "ruamel.yaml>=0.18",
# ]
# ///
"""CLI for managing AgentArena tests and their runs.

Just run it — dependencies install themselves on first run:

    scripts/cli.py browse            # TUI for tests, runs, and their details
    scripts/cli.py test add          # interactively create a new test
    scripts/cli.py run add           # interactively record a run for a test
    scripts/cli.py validate          # validate every test.yaml / run.yaml
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# ----------------------------------------------------------------------------
# Self-bootstrap: on first run (or after deps change), create scripts/.venv/
# and install dependencies there, then re-exec the script with that venv's
# Python so the rest of the file can import normally.
# ----------------------------------------------------------------------------

_DEPS = (
    "typer>=0.12",
    "rich>=13.7",
    "questionary>=2.0",
    "pydantic>=2.6",
    "ruamel.yaml>=0.18",
    "textual>=0.50",
)
_VENV = Path(__file__).resolve().parent / ".venv"
_VENV_PY = _VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python3")


def _have_deps() -> bool:
    try:
        import questionary  # noqa: F401
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
        sys.stderr.write("Setting up CLI dependencies in scripts/.venv (first run)...\n")
        try:
            subprocess.run(
                [sys.executable, "-m", "venv", str(_VENV)],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            _fail_setup(
                "Failed to create the virtual environment at scripts/.venv.",
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
                "Failed to install CLI dependencies into scripts/.venv.",
                detail=f"`pip install` exited with status {e.returncode}",
                hint=(
                    "Common causes:\n"
                    "  - No internet connection (pip couldn't reach PyPI)\n"
                    "  - Corporate proxy or firewall blocking pip\n"
                    "  - A corrupted venv — try deleting scripts/.venv and re-running\n"
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

import re
import typing
from datetime import date
from io import StringIO
from typing import Any, Literal, Optional

import click
import questionary
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
from textual import on as _on_event
from textual.app import App as _TextualApp, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.screen import Screen
from textual.widgets import DataTable, Footer, Header, Label, Static
from ruamel.yaml.scalarstring import LiteralScalarString

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

REPO_ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = REPO_ROOT / "tests"

LOGO = (
    "[cyan]   ▄▄▄▄▄▄▄▄  [/]\n"
    "[cyan]  ▐█ [/][bold magenta]▀▄▄▀[/][cyan] █▌ [/]\n"
    "[cyan]  ▐█  ▀▀  █▌ [/]\n"
    "[cyan]   ▀██████▀  [/]\n"
    "[cyan]    ▄▀  ▀▄   [/]"
)

RATINGS = ("excellent", "good", "partial", "failed")
RATING_GLYPH = {
    "excellent": "[bold green]●[/]",
    "good":      "[green]●[/]",
    "partial":   "[yellow]●[/]",
    "failed":    "[red]●[/]",
}
RATING_BLURB = {
    "excellent": "clean one-shot, no follow-up needed",
    "good":      "completed, minor follow-up needed",
    "partial":   "major requirements unmet",
    "failed":    "could not be completed",
}

DomainT = Literal[
    "full-stack-web", "backend", "frontend", "cli",
    "mobile", "data", "library", "other",
]
ThemeT = Literal[
    "bootstrap", "features", "refinements", "refactor",
    "extension", "performance", "security", "other",
]
DOMAINS: tuple[str, ...] = typing.get_args(DomainT)
THEMES: tuple[str, ...] = typing.get_args(ThemeT)

PROVIDERS = ("anthropic", "openai", "openrouter", "bedrock", "gemini", "self-hosted", "other")
SELF_HOSTED_FRAMEWORKS = ("lm-studio", "ollama", "llama.cpp", "vllm", "mlx", "other")

DOMAIN_LABELS = {
    "full-stack-web": "full-stack-web — web app, frontend + backend",
    "backend":        "backend        — APIs, services, databases",
    "frontend":       "frontend       — UI-only (SPA, static site)",
    "cli":            "cli            — command-line tool or script",
    "mobile":         "mobile         — iOS / Android / cross-platform",
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
    results_dir = TESTS_DIR / test_name / "results"
    if not results_dir.is_dir():
        return []
    return sorted(p.name for p in results_dir.iterdir() if (p / "run.yaml").is_file())


def load_run(test_name: str, run_id: str) -> Run:
    path = TESTS_DIR / test_name / "results" / run_id / "run.yaml"
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


def require(value: Optional[str]) -> str:
    """Exit gracefully if the user aborted a questionary prompt (Ctrl-C / Esc)."""
    if value is None:
        err_console.print("[yellow]Aborted.[/yellow]")
        raise typer.Exit(130)
    return value


def read_pasted_text(label: str) -> str:
    """Read multi-line text from stdin, paste-friendly.

    Terminates on Ctrl-D (macOS / Linux) or Ctrl-Z + Enter (Windows),
    or on a line containing only `END` (case-insensitive).
    """
    console.print(f"\n[bold]{label}[/bold]")
    console.print(
        "[dim]Paste the text below. When done, finish with [bold]Ctrl-D[/bold] "
        "([bold]Ctrl-Z[/bold] then [bold]Enter[/bold] on Windows), or type "
        "[bold]END[/bold] on its own line and press [bold]Enter[/bold].[/dim]"
    )
    lines: list[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip().upper() == "END":
            break
        lines.append(line)
    return "\n".join(lines).strip()


# --------------------------------------------------------------------------- #
# Textual UI — the `browse` command launches AgentArenaApp at TestsScreen.
# Esc walks up the stack (RunScreen / TestDetailsScreen → TestScreen →
# TestsScreen → quit). Q quits from anywhere. The questionary-based `*_add`
# forms are intentionally separate — they collect input, not display data.
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
"""


class TestsScreen(Screen):
    """List all tests; Enter to drill into one."""

    BINDINGS = [
        Binding("escape,q", "app.quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header()
        yield Label("Tests", classes="section-title")
        yield DataTable(id="tests-table", zebra_stripes=True)
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Tests"
        table = self.query_one("#tests-table", DataTable)
        table.add_columns("Name", "Stages", "Runs", "Description")
        names = list_test_names()
        for name in names:
            try:
                t = load_test(name)
                runs = len(list_run_ids(name))
                table.add_row(
                    name,
                    str(len(t.stages)),
                    str(runs),
                    truncate(t.description, 80),
                    key=name,
                )
            except (ValidationError, FileNotFoundError):
                table.add_row(name, "?", "?", "[invalid]", key=name)
        table.cursor_type = "row"
        table.focus()
        if not names:
            self.notify("No tests found under /tests.", severity="warning")

    @_on_event(DataTable.RowSelected)
    def _open_test(self, event: DataTable.RowSelected) -> None:
        name = str(event.row_key.value)
        self.app.push_screen(TestScreen(name))


class TestScreen(Screen):
    """A test's info + its runs in a DataTable; drill into runs or details."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
        Binding("q", "app.quit", "Quit"),
        Binding("d", "show_details", "Test details"),
    ]

    def __init__(self, test_name: str) -> None:
        super().__init__()
        self.test_name = test_name

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static("", id="test-info")
        yield Label("Runs", classes="section-title")
        yield DataTable(id="runs-table", zebra_stripes=True)
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = self.test_name
        try:
            t = load_test(self.test_name)
        except (FileNotFoundError, ValidationError) as e:
            self.query_one("#test-info", Static).update(f"[red]Error: {e}[/red]")
            return

        runs = list_run_ids(self.test_name)
        info_lines = [
            f"[bold]{t.title}[/bold]",
            t.description.strip(),
        ]
        meta = [f"[dim]Stages:[/dim] {len(t.stages)}", f"[dim]Runs:[/dim] {len(runs)}"]
        if t.domain:
            meta.insert(0, f"[dim]Domain:[/dim] {t.domain}")
        info_lines.append("    ".join(meta))
        self.query_one("#test-info", Static).update("\n".join(info_lines))

        table = self.query_one("#runs-table", DataTable)
        table.add_columns("Run ID", "Date", "Model", "Agent", "Stages")
        for run_id in runs:
            try:
                r = load_run(self.test_name, run_id)
                agent_str = r.agent.name + (f" ({r.agent.plan})" if r.agent.plan else "")
                ratings = "  ".join(s.rating[0].upper() for s in r.stages)
                table.add_row(run_id, r.date.isoformat(), r.model, agent_str, ratings, key=run_id)
            except (ValidationError, FileNotFoundError):
                table.add_row(run_id, "?", "?", "?", "[invalid]", key=run_id)
        table.cursor_type = "row"
        table.focus()

    @_on_event(DataTable.RowSelected)
    def _open_run(self, event: DataTable.RowSelected) -> None:
        run_id = str(event.row_key.value)
        self.app.push_screen(RunScreen(self.test_name, run_id))

    def action_show_details(self) -> None:
        self.app.push_screen(TestDetailsScreen(self.test_name))


class TestDetailsScreen(Screen):
    """Full test info — header + every stage's prompt."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
        Binding("q", "app.quit", "Quit"),
    ]

    def __init__(self, test_name: str) -> None:
        super().__init__()
        self.test_name = test_name

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(id="content")
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = f"{self.test_name} · details"
        content = self.query_one("#content", VerticalScroll)
        try:
            t = load_test(self.test_name)
        except (FileNotFoundError, ValidationError) as e:
            content.mount(Static(f"[red]Error: {e}[/red]", classes="error"))
            return

        runs = len(list_run_ids(self.test_name))
        info_lines = [
            f"[bold]{t.title}[/bold]",
            t.description.strip(),
        ]
        meta = [f"[dim]Stages:[/dim] {len(t.stages)}", f"[dim]Runs:[/dim] {runs}"]
        if t.domain:
            meta.insert(0, f"[dim]Domain:[/dim] {t.domain}")
        info_lines.append("    ".join(meta))
        content.mount(Static("\n".join(info_lines), id="test-info"))

        for i, stage in enumerate(t.stages, 1):
            content.mount(Label(f"Stage {i} — {stage.id}", classes="section-title"))
            stage_meta = f"[dim]Theme:[/dim] {stage.theme}"
            if stage.builds_on:
                stage_meta += f"    [dim]Builds on:[/dim] {stage.builds_on}"
            content.mount(Static(stage_meta, classes="stage-meta"))
            content.mount(Static(stage.prompt.strip(), classes="prompt-panel"))


class RunScreen(Screen):
    """Full run info — metadata + per-stage metrics table."""

    BINDINGS = [
        Binding("escape", "app.pop_screen", "Back"),
        Binding("q", "app.quit", "Quit"),
    ]

    def __init__(self, test_name: str, run_id: str) -> None:
        super().__init__()
        self.test_name = test_name
        self.run_id = run_id

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(id="content")
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = f"{self.test_name} / {self.run_id}"
        content = self.query_one("#content", VerticalScroll)
        try:
            r = load_run(self.test_name, self.run_id)
        except (FileNotFoundError, ValidationError) as e:
            content.mount(Static(f"[red]Error: {e}[/red]", classes="error"))
            return

        meta_lines = [
            f"[dim]Contributor:[/dim] {r.contributor_url}",
            f"[dim]Date:[/dim] {r.date.isoformat()}",
        ]
        agent_str = r.agent.name + (f" ({r.agent.plan})" if r.agent.plan else "")
        meta_lines.append(f"[dim]Agent:[/dim] {agent_str}")
        meta_lines.append(f"[dim]Provider:[/dim] {r.provider}")
        if r.framework:
            meta_lines.append(f"[dim]Framework:[/dim] {r.framework}")
        meta_lines.append(f"[dim]Model:[/dim] {r.model}")
        if r.quantization:
            meta_lines.append(f"[dim]Quantization:[/dim] {r.quantization}")
        if r.settings:
            meta_lines.append("[dim]Settings:[/dim] " + ", ".join(f"{k}={v}" for k, v in r.settings.items()))
        if r.hardware:
            hw_items = r.hardware.model_dump(exclude_none=True)
            meta_lines.append("[dim]Hardware:[/dim] " + ", ".join(f"{k}={v}" for k, v in hw_items.items()))
        content.mount(Static("\n".join(meta_lines), id="run-info"))

        content.mount(Label("Stages", classes="section-title"))
        stages_table = DataTable(zebra_stripes=False, show_cursor=False, id="stages-table")
        stages_table.add_columns("Stage", "Time", "In", "Out", "Cost", "Rating", "Notes")
        total_dur = total_in = total_out = 0
        total_cost = 0.0
        for s in r.stages:
            mins, secs = divmod(s.duration_sec, 60)
            duration = f"{mins}:{secs:02d}"
            tokens_in = f"{s.tokens_in:,}" if s.tokens_in is not None else "—"
            tokens_out = f"{s.tokens_out:,}" if s.tokens_out is not None else "—"
            cost = f"${s.cost_usd:.2f}" if s.cost_usd is not None else "—"
            notes = truncate(s.notes or "", 60)
            stages_table.add_row(s.id, duration, tokens_in, tokens_out, cost, s.rating, notes)
            total_dur += s.duration_sec
            total_in += s.tokens_in or 0
            total_out += s.tokens_out or 0
            total_cost += s.cost_usd or 0.0
        mins, secs = divmod(total_dur, 60)
        stages_table.add_row(
            "total",
            f"{mins}:{secs:02d}",
            f"{total_in:,}" if total_in else "—",
            f"{total_out:,}" if total_out else "—",
            f"${total_cost:.2f}" if total_cost else "—",
            "",
            "",
        )
        content.mount(stages_table)


class ValidateScreen(Screen):
    """Validation results — one row per error."""

    BINDINGS = [
        Binding("escape,q", "app.quit", "Quit"),
    ]

    def __init__(self, errors: list[tuple[Path, str]]) -> None:
        super().__init__()
        self.errors = errors

    def compose(self) -> ComposeResult:
        yield Header()
        yield Label("Validation", classes="section-title")
        yield DataTable(id="errors-table", zebra_stripes=True)
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = f"{len(self.errors)} error(s)" if self.errors else "✓ all valid"
        table = self.query_one("#errors-table", DataTable)
        table.add_columns("File", "Error")
        for path, message in self.errors:
            table.add_row(str(path), message)
        table.cursor_type = "row"
        if self.errors:
            table.focus()
        else:
            self.notify("All YAML files valid.", severity="information")


class AgentArenaApp(_TextualApp):
    """Textual app for browsing AgentArena tests and runs."""

    CSS = AGENT_ARENA_CSS
    TITLE = "AgentArena"
    BINDINGS = [Binding("ctrl+c", "quit", "Quit", show=False)]

    def __init__(self, *, initial_stack: Optional[list[Screen]] = None) -> None:
        super().__init__()
        self._initial_stack: list[Screen] = initial_stack or [TestsScreen()]

    def on_mount(self) -> None:
        for screen in self._initial_stack:
            self.push_screen(screen)


# --------------------------------------------------------------------------- #
# Typer app
# --------------------------------------------------------------------------- #


def _walk_commands(group: click.Group, prefix: str = ""):
    """Yield (path, signature, help_text) for every leaf command, in registration order."""
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
        signature = " ".join([path, *arg_parts]) if arg_parts else path
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
# browse  →  the TUI is now the only display command. It covers everything the
# old `test list / show` and `run list / show` did, with full keyboard nav.
# --------------------------------------------------------------------------- #


@app.command("browse")
def browse_cmd() -> None:
    """Open the AgentArena TUI to navigate tests, runs, and their details."""
    AgentArenaApp().run()


# --------------------------------------------------------------------------- #
# run add (interactive)
# --------------------------------------------------------------------------- #


def _required(v: str) -> Any:
    return True if v and v.strip() else "Required"


@run_app.command("add")
def run_add_cmd() -> None:
    """Interactively record a new run for an existing test."""
    tests = list_test_names()
    if not tests:
        err_console.print("[red]No tests exist yet. Create one first with `test add`.[/red]")
        raise typer.Exit(1)

    console.rule("[bold cyan]Add a run[/bold cyan]")
    console.print(
        "[dim]Tip: you'll be able to manually edit the generated run.yaml file afterwards "
        "if anything needs tweaking.[/dim]\n"
    )

    test_name = require(questionary.select("Which test did you run?", choices=tests).ask())
    test = load_test(test_name)

    contributor_url = require(questionary.text(
        "Your personal URL (GitHub profile, website, Mastodon, etc.):",
        validate=lambda v: v.strip().startswith(("http://", "https://")) or "Must be a URL starting with http:// or https://",
    ).ask()).strip()

    run_date_raw = require(questionary.text(
        "Date of the run (YYYY-MM-DD):",
        default=date.today().isoformat(),
        validate=lambda v: (parse_iso_date(v) is not None) or "Use ISO date format, e.g. 2026-05-16",
    ).ask())
    run_date = parse_iso_date(run_date_raw)
    assert run_date is not None

    agent_choice = require(questionary.select(
        "Coding agent / client:",
        choices=["claude-code", "cursor", "aider", "opencode", "other"],
    ).ask())
    if agent_choice == "other":
        agent_choice = require(questionary.text("Agent name:", validate=_required).ask()).strip()

    agent_plan_raw = require(questionary.text(
        "Agent plan / tier (e.g. 'pro'; empty if N/A):",
    ).ask()).strip()
    agent_plan = agent_plan_raw or None

    provider_choice = require(questionary.select(
        "Inference provider (pick 'self-hosted' if you run the inference yourself, on your own or rented infra):",
        choices=list(PROVIDERS),
    ).ask())
    if provider_choice == "other":
        provider_choice = require(questionary.text("Provider name:", validate=_required).ask()).strip()

    model = require(questionary.text(
        "Model identifier (e.g. sonnet-4.6):",
        validate=_required,
    ).ask()).strip()

    console.print()
    console.print("[dim]Add any agent/model settings that affect behavior (e.g. effort=high).[/dim]")
    console.print("[dim]Leave the key empty to finish.[/dim]")
    settings: dict[str, Any] = {}
    while True:
        key = require(questionary.text("  setting key (empty to finish):").ask()).strip()
        if not key:
            break
        value = require(questionary.text(f"  value for '{key}':").ask()).strip()
        settings[key] = value

    framework: Optional[str] = None
    quantization: Optional[str] = None
    hardware: Optional[Hardware] = None
    if provider_choice == "self-hosted":
        console.print()
        console.print("[dim]Self-hosted inference: tell us about the engine, quantization, and hardware.[/dim]")
        framework_choice = require(questionary.select(
            "Inference engine / framework:",
            choices=list(SELF_HOSTED_FRAMEWORKS),
        ).ask())
        if framework_choice == "other":
            framework = require(questionary.text(
                "Framework name (e.g. text-generation-webui, gpt4all):",
                validate=_required,
            ).ask()).strip()
        else:
            framework = framework_choice

        quantization = require(questionary.text(
            "Quantization (e.g. q4_K_M, q8_0, fp16; empty to skip):"
        ).ask()).strip() or None

        console.print("[dim]Hardware details (all optional, but recommended):[/dim]")
        device = require(questionary.text(
            "  Machine label (e.g. nvidia-spark, m3-max, rtx-4090-pc; empty to skip):"
        ).ask()).strip() or None
        gpu = require(questionary.text(
            "  GPU model (e.g. rtx-4090, h100; empty to skip):"
        ).ask()).strip() or None
        vram_raw = require(questionary.text("  VRAM in GB (integer; empty to skip):").ask()).strip()
        vram_gb = int(vram_raw) if vram_raw else None
        ram_raw = require(questionary.text("  System RAM in GB (integer; empty to skip):").ask()).strip()
        ram_gb = int(ram_raw) if ram_raw else None
        if any([device, gpu, vram_gb, ram_gb]):
            hardware = Hardware(device=device, gpu=gpu, vram_gb=vram_gb, ram_gb=ram_gb)

    console.rule("Stages")
    stages: list[RunStage] = []
    for stage_def in test.stages:
        ran = require(questionary.confirm(
            f"Did you run {stage_def.id}?",
            default=True,
        ).ask())
        if not ran:
            continue

        duration_sec = None
        while duration_sec is None:
            raw = require(questionary.text(
                f"  {stage_def.id} — duration (mm:ss or seconds):",
                validate=lambda v: (parse_duration(v) is not None) or "Use mm:ss or a number of seconds",
            ).ask())
            duration_sec = parse_duration(raw)

        tokens_in_raw = require(questionary.text(
            "  input tokens (e.g. 12300 or 12.3k; empty to skip):",
            validate=lambda v: (not v.strip() or parse_token_count(v) is not None) or "Use a number, with optional k/M suffix",
        ).ask())
        tokens_in = parse_token_count(tokens_in_raw)

        tokens_out_raw = require(questionary.text(
            "  output tokens (e.g. 26300 or 26.3k; empty to skip):",
            validate=lambda v: (not v.strip() or parse_token_count(v) is not None) or "Use a number, with optional k/M suffix",
        ).ask())
        tokens_out = parse_token_count(tokens_out_raw)

        cost_raw = require(questionary.text(
            "  cost in USD (e.g. 0.63; empty to skip):",
            validate=lambda v: (not v.strip() or parse_cost(v) is not None) or "Use a number, optionally with $",
        ).ask())
        cost_usd = parse_cost(cost_raw)

        rating = require(questionary.select(
            "  rating:",
            choices=[
                questionary.Choice(f"{r} — {RATING_BLURB[r]}", value=r) for r in RATINGS
            ],
        ).ask())

        notes_raw = require(questionary.text("  notes (optional, single line):").ask()).strip()
        notes = notes_raw or None

        stages.append(RunStage(
            id=stage_def.id,
            duration_sec=duration_sec,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_usd=cost_usd,
            rating=rating,
            notes=notes,
        ))

    if not stages:
        console.print("[yellow]No stages recorded. Aborting.[/yellow]")
        raise typer.Exit(0)

    # Suggest run-id (derived from contributor URL's handle)
    suggested = f"{handle_from_url(contributor_url)}-{agent_choice}-{model}"
    if settings:
        settings_part = "-".join(f"{k}-{v}" for k, v in settings.items())
        suggested += f"-{settings_part}"
    suggested = sanitize_slug(suggested)

    run_id = require(questionary.text(
        "Run directory name (slug):",
        default=suggested,
        validate=lambda v: (bool(v.strip()) and v.strip() == sanitize_slug(v)) or "Use lowercase letters, digits, dots, and dashes",
    ).ask()).strip()

    run = Run(
        contributor_url=contributor_url,
        date=run_date,
        agent=Agent(name=agent_choice, plan=agent_plan),
        provider=provider_choice,
        framework=framework,
        model=model,
        quantization=quantization,
        settings=settings,
        hardware=hardware,
        stages=stages,
    )

    target = TESTS_DIR / test_name / "results" / run_id / "run.yaml"
    console.rule("Preview")
    buf = StringIO()
    yaml.dump(run_to_yaml(run), buf)
    console.print(Syntax(buf.getvalue(), "yaml", theme="ansi_dark", background_color="default"))
    console.print(f"[dim]Target:[/dim] {target.relative_to(REPO_ROOT)}")

    if target.exists():
        if not require(questionary.confirm(
            "That run.yaml already exists. Overwrite?",
            default=False,
        ).ask()):
            console.print("[yellow]Aborted.[/yellow]")
            raise typer.Exit(0)

    if not require(questionary.confirm("Write run.yaml?", default=True).ask()):
        console.print("[yellow]Aborted.[/yellow]")
        raise typer.Exit(0)

    write_yaml(target, run_to_yaml(run))
    for s in stages:
        (target.parent / s.id).mkdir(exist_ok=True)

    console.print(f"\n[green]✓[/green] Wrote {target.relative_to(REPO_ROOT)}")
    console.print("\nNext: drop the source code your LLM produced for each stage into:")
    for s in stages:
        console.print(f"  [dim]•[/dim] {(target.parent / s.id).relative_to(REPO_ROOT)}/")
    console.print(
        f"\n[dim]You can edit [bold]{target.relative_to(REPO_ROOT)}[/bold] manually at any time.[/dim]"
    )
    console.print(
        "[dim]After making changes, run [bold]scripts/cli.py validate[/bold] "
        "to check that they still match the schema.[/dim]"
    )


# --------------------------------------------------------------------------- #
# test add (interactive)
# --------------------------------------------------------------------------- #


@test_app.command("add")
def test_add_cmd() -> None:
    """Interactively create a new test."""
    console.rule("[bold cyan]Create a new test[/bold cyan]")
    console.print(
        "[dim]Tip: you'll be able to manually edit the generated test.yaml file afterwards "
        "if anything needs tweaking.[/dim]\n"
    )

    name = require(questionary.text(
        "Test directory name (kebab-case, e.g. live-message-wall):",
        validate=lambda v: is_kebab_case(v.strip()) or "Use lowercase kebab-case",
    ).ask()).strip()

    target_dir = TESTS_DIR / name
    if target_dir.exists():
        err_console.print(f"[red]Directory already exists: {target_dir.relative_to(REPO_ROOT)}[/red]")
        raise typer.Exit(1)

    title = require(questionary.text("Short human-readable title:", validate=_required).ask()).strip()
    description = require(questionary.text(
        "Description (one or two sentences):",
        validate=_required,
    ).ask()).strip()
    domain_choice = require(questionary.select(
        "Domain (optional, pick the closest match):",
        choices=[questionary.Choice("(skip)", value=None)]
        + [questionary.Choice(DOMAIN_LABELS[d], value=d) for d in DOMAINS],
    ).ask())
    domain = domain_choice

    console.rule("Stages")
    stages: list[TestStage] = []
    while True:
        next_num = len(stages) + 1
        if stages:
            if not require(questionary.confirm(f"Add stage {next_num}?", default=True).ask()):
                break

        stage_id_prefix = f"stage-{next_num}-"
        stage_id = require(questionary.text(
            f"Stage {next_num} id (must start with '{stage_id_prefix}'):",
            default=stage_id_prefix,
            validate=lambda v: (v.strip().startswith(stage_id_prefix) and is_kebab_case(v.strip())) or f"Must be kebab-case starting with '{stage_id_prefix}'",
        ).ask()).strip()

        theme = require(questionary.select(
            "Theme (pick the closest match):",
            choices=[questionary.Choice(THEME_LABELS[t], value=t) for t in THEMES],
        ).ask())

        prompt = read_pasted_text(f"Prompt for {stage_id} (will be fed to the LLM verbatim):")
        if not prompt:
            err_console.print("[red]Prompt cannot be empty.[/red]")
            raise typer.Exit(1)

        builds_on: Optional[str] = None
        if stages:
            previous_ids = [s.id for s in stages]
            choice = require(questionary.select(
                "Does this stage build on a previous one?",
                choices=["(no)"] + previous_ids,
                default=previous_ids[-1],
            ).ask())
            builds_on = None if choice == "(no)" else choice

        stages.append(TestStage(
            id=stage_id,
            theme=theme,
            prompt=prompt,
            builds_on=builds_on,
        ))

    if not stages:
        console.print("[yellow]No stages added. Aborting.[/yellow]")
        raise typer.Exit(0)

    test = Test(
        name=name,
        title=title,
        description=description,
        domain=domain,
        stages=stages,
    )

    console.rule("Preview")
    buf = StringIO()
    yaml.dump(test_to_yaml(test), buf)
    console.print(Syntax(buf.getvalue(), "yaml", theme="ansi_dark", background_color="default"))
    console.print(f"[dim]Target:[/dim] {(target_dir / 'test.yaml').relative_to(REPO_ROOT)}")

    if not require(questionary.confirm("Create test directory and write test.yaml?", default=True).ask()):
        console.print("[yellow]Aborted.[/yellow]")
        raise typer.Exit(0)

    write_yaml(target_dir / "test.yaml", test_to_yaml(test))
    (target_dir / "results").mkdir(exist_ok=True)
    test_yaml_path = (target_dir / "test.yaml").relative_to(REPO_ROOT)
    console.print(f"\n[green]✓[/green] Created {target_dir.relative_to(REPO_ROOT)}/")
    console.print(
        f"\n[dim]You can edit [bold]{test_yaml_path}[/bold] manually at any time.[/dim]"
    )
    console.print(
        "[dim]After making changes, run [bold]scripts/cli.py validate[/bold] "
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
    path = TESTS_DIR / test_name / "results" / run_id / "run.yaml"
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
        stage_dir = path.parent / s.id
        if not stage_dir.is_dir():
            errors.append((path, f"missing source directory for stage '{s.id}'"))
    return errors


@app.command("validate")
def validate_cmd(
    path: Optional[Path] = typer.Argument(
        None,
        help="Optional path to a single test.yaml or run.yaml. Validates the whole repo if omitted.",
    ),
) -> None:
    """Validate test.yaml and run.yaml files against the schema and cross-check references."""
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
                run_yaml = TESTS_DIR / test_name / "results" / run_id / "run.yaml"
                errors += _validate_path(run_yaml)
                errors += _cross_check_run(test_name, run_id, valid_ids)

    # Normalize paths for display.
    pretty: list[tuple[Path, str]] = []
    for p, msg in errors:
        try:
            rel = p.relative_to(REPO_ROOT)
        except ValueError:
            rel = p
        pretty.append((rel, msg))

    AgentArenaApp(initial_stack=[ValidateScreen(pretty)]).run()
    if errors:
        raise typer.Exit(1)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def _print_banner() -> None:
    title = "AgentArena"
    tagline = (
        "A community benchmark for coding agent performance"
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
