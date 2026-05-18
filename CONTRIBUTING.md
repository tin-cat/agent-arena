# Contributing
Please feel free to contribute your own tests and runs of existing tests to this repository.

Contributions should be submitted as a GitHub Pull Request against `main`: Fork the repo, add your run or test on a branch, push it to your fork, and open a PR.

> [!IMPORTANT]
> **⚔ The contributor's code ⚔**
>
> There is no referee in this arena. No anti-cheat watches your terminal. No tribunal reviews the tape. The leaderboard rests entirely on **your honor**.
>
> Run the stages exactly as written. Report the time, the costs, and the rating you actually got. Be honest. *Especially* when your favorite stack stumbles. Your data is what helps the community.
>
> If you fake your way to the top, you might fool the board for a week. But the silicon knows. Your PR will be discarded in shame and preserved in the git log for history to know.
>
> We trust you. ⚔ *For honor. For science. For the leaderboard.* ⚔

# The easiest way to contribute

Fork this repo and clone it:

```sh
git clone https://github.com/tin-cat/agent-arena.git
```

Then use the provided CLI _(Needs Python 3.11+; the script bootstraps its own venv on first run)_:

```sh
# Browse current tests and runs
./agent-arena-cli.py browse

# Add your run of an existing test
./agent-arena-cli.py run add

# Add a new test for others to run (or add your own runs also)
./agent-arena-cli.py test add
```

Once you're finished, create a push request. Your contributions will be reviewed, and you'll get into the leaderboards as soon as they get accepted.

You can also contribute tests and runs by adding the YAML files and directories manually, and run `./agent-arena-cli.py validate` after any manual edit to check for errors before submitting. Here's how to do it:

## Manually contribute your run of an existing test

1. Pick a test under `/tests/<test name>/`. Open its `test.yaml` to see the test description and each stage's prompt.

2. For each stage, feed the prompt to the LLM **exactly as written**, in order. Each stage continues from the previous stage's output, don't start from a fresh codebase.

3. Create a run directory at `/tests/<test name>/results/<run-id>/`. The run ID is a short, unique slug that makes your run easy to identify, typically `<your-github-username>-<agent>-<model>-<settings>`, e.g. `tin-cat-claude-code-sonnet-4.6-high-effort`. If you have multiple runs with the same configuration, append a suffix such as `-2` or a date.

4. Inside the run directory, place one subdirectory per stage you ran, named exactly like the stage `id` from `test.yaml` (e.g. `stage-1-first-run`). Put the complete source code the LLM produced for that stage inside, even if most of it is duplicated from earlier stages.

5. Add a `run.yaml` manifest at the root of your run directory. See the schema below.

### `run.yaml` schema

> [!IMPORTANT]
> **contributor_url is your unique ID**. Always use the exact same URL so the leaderboard can group your runs and accumulate your ranking. If you use your GitHub profile URL, your GitHub profile image will automatically display on the leaderboard.

```yaml
contributor_url: https://github.com/your-username   # see the note above — must match across all your contributions
date: 2026-05-16              # the day the run was performed (YYYY-MM-DD)

agent:
  name: claude-code           # must match an `id` from /agents.json (see that file for the full list, descriptions, and homepages)
  plan: pro                   # optional; the agent's plan or tier

provider: anthropic           # must match an `id` from /providers.json (see that file for the full list, descriptions, and homepages)
model: sonnet-4.6             # the official model identifier — see the note below
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

### Model identifier

Please use the **official** identifier so runs of the same model can be grouped on the leaderboard:

- **Closed / hosted models:** use the canonical name from the provider's docs (e.g. `sonnet-4.6`, `gpt-5-mini`, `gemini-2.5-pro`).
- **Open-weight models:** use the Hugging Face repo path in `org/repo` form (e.g. `meta-llama/Llama-3.3-70B-Instruct`, `Qwen/Qwen2.5-Coder-32B-Instruct`). Browse [huggingface.co/models](https://huggingface.co/models) to find it.
- For a cross-provider catalog of model IDs, [openrouter.ai/models](https://openrouter.ai/models) is a convenient reference.

### Adding a new agent or provider

If your coding agent or inference provider isn't listed in [`/agents.json`](/agents.json) or [`/providers.json`](/providers.json) yet, open a PR adding it. Each entry needs an `id` (kebab-case, used in `run.yaml`), `name`, `description`, `homepage`, and `category`. Optionally drop an SVG at `/logos/agents/<id>.svg` or `/logos/providers/<id>.svg` — see [`/logos/README.md`](/logos/README.md). Until then, use `other` and add a note in the `settings:` block.

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

## Manually contribute a new test

1. Create a directory under `/tests/<your test name>/` (use `kebab-case`).

2. Add a `test.yaml` file describing the test and each stage's prompt. See the schema below, or use [`/tests/live-message-wall/test.yaml`](/tests/live-message-wall/test.yaml) as a reference.

   > Recommended: start with a simpler `stage-1-first-run`, then add complexity in consecutive stages to strain the model.

3. If you also want to contribute your own runs of this new test, follow the steps in the previous section.

### `test.yaml` schema

> [!IMPORTANT]
**contributor_url is your unique ID**. Always use the exact same URL so the leaderboard can group your runs and accumulate your ranking. If you use your GitHub profile URL, your GitHub profile image will automatically display on the leaderboard.

```yaml
contributor_url: https://github.com/your-username   # see the note above — must match across all your contributions

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
