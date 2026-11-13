# Git Commit Hygiene & Version Control Guidelines

You MUST follow strict Git commit hygiene on every task in this repository:

## 1. Atomic, Single-Purpose Commits
- **One Logical Change Per Commit**: Never bundle unrelated features, bug fixes, refactors, layout redesigns, and build/test updates into a single "catch-all" commit.
- **Minimal Diffs**: Make surgical, minimal edits directly relevant to the issue; avoid unrelated refactorings or unnecessary whitespace adjustments.
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
- `release`: General release tools, or version bumps (`js/version.js`)

### Subject Line Rules
1. Use the **imperative, present tense** ("add", "fix", "refactor", not "added", "fixed", "changes").
2. Keep the subject line **72 characters or fewer**.
3. Do **not** end the subject line with a period.
4. Never use vague subjects like `"First round of changes"`, `"Updates"`, `"WIP"`, or `"Fix bugs"`.

## 3. Versioning and Pre-Push Policy
- **Semantic Versioning**: The application follows Semantic Versioning (`MAJOR.MINOR.PATCH`).
- **Single Source of Truth**: The canonical application version is specified in `js/version.js` (`APP_VERSION`).
  - To change or bump the version, edit the `APP_VERSION` string in `js/version.js` and nowhere else.
  - The UI (Settings panel and header badge) loads `App.VERSION` dynamically from `js/version.js`.
  - The `.githooks/pre-commit` hook automatically keeps `package.json` synchronized with `js/version.js`.
- **Pre-Commit & Pre-Push Gates**:
  - `.githooks/pre-commit` blocks direct non-merge commits to `release`, keeps `package.json` synced with `js/version.js`, and runs `node tests/cli-runner.js`.
  - `.githooks/pre-push` verifies `package.json` and `js/version.js` are in sync when pushing `main`, and on `release` requires both a version bump relative to `origin/release` and a matching annotated tag `v<APP_VERSION>` pointing to the pushed commit.

## 4. Branching & Release Workflow
- **Branching Strategy**:
  - `main`: Continuous development branch.
  - `release`: Deploy/publish branch.
  - Feature & fix branches: Always create separate branches for fixes and features before merging into `main`.
- **Cutting a Release**: When the user requests a release (e.g., `"bump version and release"`, `"cut release"`, `"prep release"`, `"release new version"`):
  1. Bump `APP_VERSION` in `js/version.js` (`.githooks/pre-commit` syncs `package.json` automatically).
  2. Add entries to `CHANGELOG.md` listing all changes since the last version as individual, concise item bullets (not long multi-item summaries), moving any items out of `[Unreleased]` into the new version heading with the release date.
  3. Commit the release changes on `main` (ensuring `node tests/cli-runner.js` passes).
  4. Merge the `main` branch into the `release` branch.
  5. Create an annotated git tag matching the new version (`git tag -a v<APP_VERSION> -m "Release v<APP_VERSION>"`) on the release commit, push `main`, `release`, and the tag (`git push origin v<APP_VERSION>`), and switch back to `main`.
