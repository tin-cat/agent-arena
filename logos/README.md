# Logos

Optional logo assets referenced by `/agents.json` and `/providers.json` via their `logo` fields (e.g. `/logos/agents/claude-code.svg`).

## How to contribute a logo

1. Add an SVG file named after the entry's `id`:
   - For an agent with `id: claude-code`, drop the file at `/logos/agents/claude-code.svg`.
   - For a provider with `id: anthropic`, drop the file at `/logos/providers/anthropic.svg`.
2. Make sure you have the right to redistribute it, most vendors publish brand assets under specific terms. Prefer the official SVG from a brand kit page.
3. Keep the file small (ideally under 10 KB) and use a square or roughly-square viewBox so the site can render it at any size.

PRs adding logos are welcome.
