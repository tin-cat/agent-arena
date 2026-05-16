# Contributing
Please feel free to contribute your tests to this repository. You can either contribute entire new tests, or your runs of existing tests.

## Contribute your run of an existing test

1. Pick a test under `/tests/<test name>/`. Open its `test.yaml` to see the test description and each stage's prompt.

2. For each stage, feed the prompt to the LLM **exactly as written**, in order. Each stage continues from the previous stage's output — don't start from a fresh codebase.

3. Create a run directory at `/tests/<test name>/results/<run-id>/`. The run ID is a short, unique slug that makes your run easy to identify — typically `<your-github-username>-<agent>-<model>-<settings>`, e.g. `tin-cat-claude-code-sonnet-4.6-high-effort`. If you have multiple runs with the same configuration, append a suffix such as `-2` or a date.

4. Inside the run directory, place one subdirectory per stage you ran, named exactly like the stage `id` from `test.yaml` (e.g. `stage-1-first-run`). Put the complete source code the LLM produced for that stage inside — even if most of it is duplicated from earlier stages.

5. Add a `run.yaml` manifest at the root of your run directory. See the schema below.

### `run.yaml` schema

```yaml
contributor: your-github-username

agent:
  name: claude-code           # the coding agent / client (e.g. claude-code, cursor, aider, opencode)
  plan: pro                   # optional; the agent's plan or tier

provider: anthropic           # the inference endpoint (e.g. anthropic, openrouter, ollama, lm-studio)
model: sonnet-4.6             # the model identifier
settings:                     # any agent or model settings that affect behavior
  effort: high

# Only for local inference; omit otherwise.
hardware:
  device: m3-max
  ram_gb: 64
  quantization: q4_K_M

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

2. Add a `test.yaml` file. Use [`/tests/live-message-wall/test.yaml`](/tests/live-message-wall/test.yaml) as a reference. Required fields:

   - `name` — the test's directory name.
   - `title` — a short, human-readable title.
   - `description` — a short description of what the test simulates.
   - `stages` — an ordered list, each with:
     - `id` — matches the stage directory name in contributed runs (use `stage-N-<short-theme>`).
     - `theme` — a one-word label for the stage's focus.
     - `prompt` — the prompt verbatim, as it will be fed into the LLM (use a `|` block scalar to preserve formatting).
     - `evaluation` — a checklist of features the stage should produce.
     - `builds_on` (optional, for stages 2+) — the `id` of the stage this one continues from.

   > Recommended: start with a simpler `stage-1-first-run`, then add complexity in consecutive stages to strain the model.

3. If you also want to contribute your own runs of this new test, follow the steps in the previous section.
