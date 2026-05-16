# AI agentic coding test
The same coding prompts, fed into different AI models and their results.

### /prompts
The prompts used

### /results
The resulting code, organized by prompt, provider and model with the directory structure:

### /benchmarks
Code generation benchmarks for each prompt, provider and model combination.

```
/<prompt>/<provider>/<model>/<run>
```

- **prompt** Is one of the prompts in `/prompts`, like `live-message-wall`
- **provider** The provider used to run the model, for example: `claude-code`, `google-antigravity` or also local inference setups like `lmstudio-macbook-pro-m1-32gb`.
- **model** The full model name, like `qwen3.6-35b-a3b`
- **run** One of the following:
    - `first-run` What came out after the first run.
    - `advanced-features` What came out after asking for advanced features, in an entirely new session.
    - `manually-refined` What came out after further manual prompting for refinement and bug solving.
    - `complex-manual-refinements` What came out after complex manual prompting for refinement and bug solving.
