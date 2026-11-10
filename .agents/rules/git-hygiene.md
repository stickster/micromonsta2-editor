# Git Commit Hygiene & Version Control Guidelines

You MUST follow strict Git commit hygiene on every task in this repository:

## 1. Atomic, Single-Purpose Commits
- **One Logical Change Per Commit**: Never bundle unrelated features, bug fixes, refactors, layout redesigns, and build/test updates into a single "catch-all" commit.
- **Stage Selectively**: Stage only the files or hunks (`git add <file>` / `git add -p`) that belong to the specific logical change being committed.
- **Commit As You Go**: When completing a multi-part request, create a separate commit for each distinct feature or fix once its tests pass, rather than waiting to commit everything at the end.
- **Always Pass Tests**: Every commit must leave the repository in a working state where `node tests/cli-runner.js` passes with zero failures.

## 2. Conventional Commits Format
All commit messages MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<optional-scope>): <concise imperative summary>

<optional body explaining the "why" and key implementation details>

<optional footers, e.g. Co-authored-by>
```

### Allowed `<type>` Prefixes
- `feat`: A new user-facing feature, control, visualizer, or hardware capability
- `fix`: A bug fix (e.g., MIDI parsing, key offset mapping, state sync)
- `refactor`: Code restructuring without changing external behavior
- `style`: CSS/layout adjustments, visual polish, or formatting
- `test`: Adding or updating automated tests in `tests/`
- `docs`: Documentation or rule updates
- `chore`: Build scripts, tooling, `.gitignore`, or git hook maintenance

### Recommended `<scope>` Values
- `midi`: Web MIDI connection, SysEx, NRPN, CC, and port management (`js/midi-manager.js`)
- `sysex`: SysEx parser, v2-to-v3 conversion, and `MM2Program`/`MM2Bank` models (`js/sysex-parser.js`)
- `specs`: Parameter definitions and lookup tables (`js/mm2-specs.js`)
- `librarian`: IndexedDB storage and bank management (`js/patch-librarian.js`)
- `ui`: Controls, visualizers, SVG icons, and keyboard (`js/ui-controls.js`, `css/style.css`)
- `editor`: Main synth rack layout, section cards, and app controller (`js/app.js`, `index.html`)
- `chorder`: Firmware v3 Chorder & Scaler engine and audition keyboard integration
- `tests`: Automated test suite and CLI runner (`tests/`)

### Subject Line Rules
1. Use the **imperative, present tense** ("add", "fix", "refactor", not "added", "fixed", "changes").
2. Keep the subject line **72 characters or fewer**.
3. Do **not** end the subject line with a period.
4. Never use vague subjects like `"First round of changes"`, `"Updates"`, `"WIP"`, or `"Fix bugs"`.
