<img src="logo.svg" alt="Alt text" width="100">

# AgentArena
**A community benchmark for AI coding agent performance**

[➜ See current test results](https://agentarena.tin.cat)

Choosing the right AI coding agent setup has too many moving parts to evaluate alone. Between the agent, model, provider, configurations, and hardware, there are too many variables—and vendor benchmarks rarely reflect real-world workloads. This repository collects community-contributed runs of the same real coding tasks across the combinations that matter, so you can compare them head-to-head.

Each test unfolds in stages: an unattended first build, then progressively harder refinements so results reflect not just whether a setup ships something, but whether it holds up under realistic follow-up work. [Contributors](CONTRIBUTING.md) add their own runs and new tests, and coverage grows with what the community cares about: cloud vs. self-hosted, frontier vs. open-weight, high-effort vs. fast, all rated against the same prompts on the same scale.

---

## Tests structure

Each test has its directory under `/tests`. Inside each test, you'll find:

- `test.yaml` — Test definition: name, description, and each stage's prompt.
- `/results/` — One subdirectory per contributed run. Each run directory contains a `run.yaml` manifest and one subdirectory per stage with the resulting source code.

## Example test structure

Here is an example of the directory structure for the `live-message-wall` test:

```
/tests
    /live-message-wall
        test.yaml
        /results
            /tin-cat-claude-code-sonnet-4.6-high-effort
                run.yaml
                /stage-1-first-run
                /stage-2-advanced-features
                /stage-3-refinements
                /stage-4-complex-refinements
```

Each run directory is flat — its `run.yaml` carries all the metadata (contributor, agent, provider, model, settings, hardware) and per-stage metrics (time, tokens, cost, rating). Each `stage-*/` subdirectory holds the complete source code that resulted from running that stage (even if most of it is duplicated from earlier stages).

## Browse with the CLI

The repository ships with a small CLI at `scripts/cli.py` for exploring tests and runs from the command line. It also handles the boilerplate for adding new tests or runs interactively, and can validate any manual YAML edits.

You only need Python 3.11+. The script bootstraps its own dependencies into `scripts/.venv/` on first run (gitignored); subsequent runs are instant.

```sh
# Browse
scripts/cli.py browse                          # full TUI for tests, runs, and their details

# Add (interactive)
scripts/cli.py run add                         # record a new run
scripts/cli.py test add                        # create a new test

# Validate
scripts/cli.py validate                        # check all yaml files against the schema
```

Run `scripts/cli.py --help` for the full command list. On Windows, invoke with `python scripts/cli.py …` since the shebang isn't honored.

---

## Contribute
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
