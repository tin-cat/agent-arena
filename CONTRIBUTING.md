# Contributing
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests.

The easiest way is the CLI: `scripts/cli.py run add` and `scripts/cli.py test add` walk you through it interactively. See [Browse with the CLI](README.md#browse-with-the-cli) for setup. The sections below describe the same workflow manually, in case you'd rather edit files directly — run `scripts/cli.py validate` after any manual edit to check the result.

## Contribute your run of an existing test

1. Pick a test under `/tests/<test name>/`. Open its `test.yaml` to see the test description and each stage's prompt.

2. For each stage, feed the prompt to the LLM **exactly as written**, in order. Each stage continues from the previous stage's output — don't start from a fresh codebase.

3. Create a run directory at `/tests/<test name>/results/<run-id>/`. The run ID is a short, unique slug that makes your run easy to identify — typically `<your-github-username>-<agent>-<model>-<settings>`, e.g. `tin-cat-claude-code-sonnet-4.6-high-effort`. If you have multiple runs with the same configuration, append a suffix such as `-2` or a date.

4. Inside the run directory, place one subdirectory per stage you ran, named exactly like the stage `id` from `test.yaml` (e.g. `stage-1-first-run`). Put the complete source code the LLM produced for that stage inside — even if most of it is duplicated from earlier stages.

5. Add a `run.yaml` manifest at the root of your run directory. See the schema below.

### `run.yaml` schema

```yaml
contributor_url: https://github.com/your-username   # any URL identifying you (GitHub profile, personal site, Mastodon, etc.)
date: 2026-05-16              # the day the run was performed (YYYY-MM-DD)

agent:
  name: claude-code           # the coding agent / client (e.g. claude-code, cursor, aider, opencode)
  plan: pro                   # optional; the agent's plan or tier

provider: anthropic           # one of: anthropic, openai, openrouter, bedrock, gemini, self-hosted, other
model: sonnet-4.6             # the model identifier
settings:                     # any agent or model settings that affect behavior
  effort: high

# Required when provider is "self-hosted" (you run the inference on your own or rented infra); omit otherwise.
framework: lm-studio          # inference engine (e.g. lm-studio, ollama, llama.cpp, vllm, mlx)

# Optional; meaningful for self-hosted inference. How the model is loaded (e.g. q4_K_M, q8_0, fp16).
quantization: q4_K_M

# Recommended when provider is "self-hosted"; omit otherwise. Physical machine only.
hardware:
  device: nvidia-spark        # overall machine label
  gpu: rtx-4090               # GPU model (if not implied by `device`)
  vram_gb: 24
  ram_gb: 64

stages:
  - id: stage-1-first-run     # must match a stage id from test.yaml
    duration_sec: 447         # wall-clock duration of the run, in seconds
    tokens_in: 12300          # optional; input tokens (cumulative across the stage)
    tokens_out: 26300         # output tokens (cumulative across the stage)
    cost_usd: 0.63            # total USD cost for the stage
    rating: excellent         # one of: excellent, good, partial, failed
    notes: |                  # optional free-text notes
      Anything noteworthy about this stage's run.
```

Only include stages you actually ran. Do not add empty placeholder entries for stages you intend to run later.

### Rating scale

- `excellent` — Stage completed cleanly on the original prompt with no follow-up prompting needed.
- `good` — Stage completed but required minor follow-up prompting to fix issues.
- `partial` — Stage left major requirements unmet, even after follow-up.
- `failed` — Stage could not be completed.

### Example

If your github username were `anthony` and you ran the first two stages of the `live-message-wall` test using Claude Code Pro with Sonnet 4.6 at "high effort", the resulting layout would be:

```
/tests
    /live-message-wall
        /results
            /anthony-claude-code-sonnet-4.6-high-effort
                run.yaml
                /stage-1-first-run
                /stage-2-advanced-features
```

## Contribute a new test

1. Create a directory under `/tests/<your test name>/` (use `kebab-case`).

2. Add a `test.yaml` file describing the test and each stage's prompt. See the schema below, or use [`/tests/live-message-wall/test.yaml`](/tests/live-message-wall/test.yaml) as a reference.

   > Recommended: start with a simpler `stage-1-first-run`, then add complexity in consecutive stages to strain the model.

3. If you also want to contribute your own runs of this new test, follow the steps in the previous section.

### `test.yaml` schema

```yaml
name: live-message-wall         # matches the test's directory name
title: A live message wall      # short, human-readable title
description: |                  # one or two sentences describing what the test simulates
  A real-time, anonymous message wall web app with a TUI-inspired aesthetic.
  Later stages add lazy loading, rate limiting, fading by age, and replies.

domain: full-stack-web          # optional; one of: full-stack-web, backend, frontend, cli, mobile, data, library, other

stages:                         # ordered list, each stage built on top of the previous
  - id: stage-1-first-run       # kebab-case; matches the stage directory name contributed runs will use
    theme: bootstrap            # one of: bootstrap, features, refinements, refactor, extension, performance, security, other
    prompt: |                   # the prompt verbatim, as it will be fed to the LLM (use `|` to preserve newlines)
      Build a web application called "Wall" where visitors can leave a message
      that gets instantly published on the wall for others to see.
      ...

  - id: stage-2-advanced-features
    builds_on: stage-1-first-run    # optional, for stages 2+; the id of the stage this one continues from
    theme: features
    prompt: |
      Add a couple thousand random messages for testing.
      Make the wall lazy loading ...
```
