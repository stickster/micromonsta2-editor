# Agent Guidelines: MicroMonsta 2 Editor & Patch Librarian

This repository contains a browser-based hardware editor, patch librarian, and duplicate manager for the [Audiothingies MicroMonsta 2](https://audiothingies.com/) synthesizer (firmware v3.x).

## Canonical Project Rules

All agents working in this repository MUST follow the shared, agent-agnostic rules in `.agents/rules/`:

- **Architecture & Tech Stack:** [`.agents/rules/architecture.md`](.agents/rules/architecture.md) — Pure Vanilla HTML5/CSS3/ES2022+, zero build step, zero external dependencies, strict script load order in `index.html`, and global namespace integrity.
- **Hardware & MIDI Protocol:** [`.agents/rules/mm2-protocol.md`](.agents/rules/mm2-protocol.md) — 216-byte single-layer SysEx dumps, 7-bit/14-bit NRPN control, display-only timbral mode detection, and hardware-only combi/system limitations.
- **Testing & Verification:** [`.agents/rules/testing.md`](.agents/rules/testing.md) — Run `node tests/cli-runner.js` (0 failures required) and add regression tests to `tests/test-suite.js`.
- **Git & Versioning Hygiene:** [`.agents/rules/git-hygiene.md`](.agents/rules/git-hygiene.md) — Atomic commits, Conventional Commits format, minimal diffs, a short `CHANGELOG.md` (`[Unreleased]`) entry on every commit, and `js/version.js` as the single source of truth for Semantic Versioning.

## Essential Quick Reference

- **Verify changes:** `node tests/cli-runner.js` (or `npm test`)
- **Changelog:** Add a short, single-line bullet to `## [Unreleased]` in `CHANGELOG.md` for every commit.
- **Versioning:** Only bump `APP_VERSION` in `js/version.js`; `.githooks/pre-commit` syncs `package.json` automatically.
- **Model-specific instructions:** See `GEMINI.md` when running as Google Gemini / Gemini CLI.
