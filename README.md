# AgentArena
*See how coding agents really perform across models, providers, and hardware.*  
A community benchmark — contribute your runs and tests.

This repository gives you a clearer picture of how different tools perform on real coding tasks. Useful if you're deciding, for example, whether a self-hosted inference setup or a cloud-based one is the better fit for your workflow.

Each test simulates a real coding task, with results divided into multiple stages that progress from a first unattended run to the incremental implementation of complex refinements. Users [contribute](CONTRIBUTING.md) their runs across different combinations of models, providers, and settings, and also new tests.

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
scripts/cli.py test list                       # list all tests
scripts/cli.py test show <test>                # view a test, including its prompts
scripts/cli.py run list <test>                 # list runs for a test
scripts/cli.py run show <test> <run-id>        # view a run's metadata and metrics

# Add (interactive)
scripts/cli.py run add                         # record a new run
scripts/cli.py test add                        # create a new test

# Validate
scripts/cli.py validate                        # check all yaml files against the schema
```

Run `scripts/cli.py --help` for the full command list. On Windows, invoke with `python scripts/cli.py …` since the shebang isn't honored.

## Contribute
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
