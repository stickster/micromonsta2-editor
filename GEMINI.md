# Google Gemini Agent Guidelines

All general project architecture, MicroMonsta 2 protocol specifications, testing requirements, and git hygiene rules live in [`AGENTS.md`](AGENTS.md) and [`.agents/rules/`](.agents/rules/). Follow those canonical rules for all work in this repository.

This file contains **Google Gemini-specific** conventions only:

- **Commit Attribution:** When committing Gemini-assisted changes, include the trailer:
  ```text
  Co-authored-by: Google Gemini <gemini@google.com>
  ```
- **GitHub Actions Integration:** Automated workflows in `.github/workflows/gemini-*.yml` invoke `google-github-actions/run-gemini-cli@v0` using `gemini_model: 'gemini-4-hydrogen'` with workflow-specific `thinkingLevel` overrides (`LOW` for issue triage, `MEDIUM` for PR review and assistant tasks).
- **Local Gemini Workspace State:** Local `.gemini/` configuration and temporary credential files (`gha-creds-*.json`) are excluded via `.gitignore`; never commit them.
