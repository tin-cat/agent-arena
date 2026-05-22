<img src="logo.svg" alt="Alt text" width="100">

# AgentArena
**A community benchmark for AI coding agent performance**

[![Test Results](https://img.shields.io/badge/➜%20See%20Current%20test%20results-cyan?style=for-the-badge)](https://agentarena.tin.cat)

Pick your favorite AI coding setup: agent, model, provider or your own self-hosted rig if you're feeling spicy. Run one of the tests, and send a PR with the results. Your handle goes on the [leaderboard](https://agentarena.tin.cat). Your rig joins the silicon beasts roster.

Each test is a multi-stage gauntlet: an unattended first build, then progressively harder refinement stages. Every stage is a single prompt fed to the agent as-is, with no hand-holding and no fixing its mistakes between stages. Setups that one-shot the easy stuff but fall apart on the harder later stages get exposed.

The leaderboard is fun, but the goal is real: a community-run, real-world view of how agentic AI coding setups *actually* perform on tasks they'll be asked to do: the kind of comparison vendor benchmarks rarely give you. Cloud vs. self-hosted, frontier vs. open-weight, high-effort vs. fast — all on the same prompts, on the same scale.

## Tests structure

Each test has its directory under `/tests`. Inside each test, you'll find:

- `test.yaml` — Test definition: name, description, and each stage's prompt.
- `/runs/` — One subdirectory per contributed run. Each run directory contains a `run.yaml` manifest and an optional subdirectory per stage with the resulting source code.

## Example test structure

Here is an example of the directory structure for the `live-message-wall` test:

```
/tests
    /live-message-wall
        test.yaml
        /runs
            /tin-cat-claude-code-sonnet-4.6-high-effort
                run.yaml
                /stage-1-first-run
                /stage-2-advanced-features
                /stage-3-refinements
                /stage-4-complex-refinements
```

Each run directory is flat: its `run.yaml` carries all the metadata (contributor, agent, provider, model, settings, hardware) and per-stage metrics (time, tokens, cost, rating).

Optionally, each `stage-*/` subdirectory holds the complete source code that resulted from running that stage (even if most of it is duplicated from earlier stages).

## The CLI

The repository ships with a single-file CLI, `agent-arena-cli.py`, that handles the boilerplate for adding new tests or runs interactively, and can validate any manual YAML edits.

```sh
# Requirements: Python 3.11+

# Add (interactive)
./agent-arena-cli.py run add # record a new run
./agent-arena-cli.py test add # create a new test

# Validate
./agent-arena-cli.py validate # check all yaml files against the schema
```

Run `./agent-arena-cli.py --help` for the full command list.

### On Windows

- **Command Prompt:** `agent-arena-cli.py run add`
- **PowerShell:** `.\agent-arena-cli.py run add`
- **Git Bash / WSL:** `./agent-arena-cli.py run add`

You can always invoke Python directly with `py agent-arena-cli.py …` or `python agent-arena-cli.py …`.

## Contribute
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## About
Reach me at [@lorenzoherrera](https://twitter.com/lorenzoherrera) ❤️ [tin.cat](https://tin.cat)