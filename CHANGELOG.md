# Changelog

All notable changes to the **MicroMonsta 2 Editor & Patch Librarian** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **MIDI:** Added MIDI Panic button (All Notes Off CC 123) beside Mod wheel.
- **Filter:** Made filter graph peak dot draggable for cutoff and resonance.

### Changed
- **Editor:** Made patch rewrite on Fetch an atomic undoable step.
- **UI:** Brightened Panic button on click instead of hover.
- **Filter:** Moved Cutoff and Resonance knobs beside a taller response curve.
- **UI:** Redesigned rotary knobs with centered readouts and ring dots.

### Fixed
- **Oscillators:** Cancelled opposite solo/mute state when toggling a single oscillator.
- **UI:** Moved Keys legend next to the left side of the keyboard.
- **Editor:** Disabled Compare mode while Live Sync is active.
- **Editor:** Shortened Live Sync disabled notification text.
- **LFO:** Placed LFO speed knob next to the mode selector.

### Documentation & Maintenance
- Documented `CHANGELOG.md` commit requirement in `AGENTS.md`.

---

## [0.2.1] - 2026-11-13

### Changed
- **Editor:** Replaced browser push confirmation with an in-app dialog and toast notifications.
- **MIDI:** Prompted to fetch, push, or ignore on every hardware connection.
- **UI:** Unified connection sync dialogs into a shared `#sync-action-dialog`.
- **Editor:** Simplified hardware load popup to omit Part A/B and patch name.

### Fixed
- **MIDI:** Probed hardware when selecting a new MIDI Input port.
- **UI:** Removed port names from the connection status indicator.
- **MIDI:** Probed hardware after Ignore or Push to exit `Standby`.
- **Editor:** Activated Live Sync only after Fetch or Push succeeds.
- **Editor:** Cleared `Sync Failed` status when MIDI connection is restored.
- **Editor:** Showed fetch notifications on outcome rather than attempt.
- **Editor:** Updated `Synced` status to `Sync Failed` on connection loss.
- **MIDI:** Reset responsiveness before port changes and probed Output port selection.
- **MIDI:** Showed port-change notifications on probe outcome rather than attempt.
- **MIDI:** Automatically probe MicroMonsta 2 hardware on initial app load, reconnect, and sync dialog dismissal so connection status exits `Standby` without waiting for manual interaction.
- **Sync:** Prevented patch sync state and `#editor-sync-badge` indicator from showing `Synced` when MIDI connection mode is not `Connected`, introducing the `offline` (`Not Synced (Offline)`) state.
- **MIDI:** Gated Fetch/Push in `#sync-action-dialog` until hardware responds and retried reconnect probes so USB-powered MM2 units can finish booting.

### Documentation & Maintenance
- Restored standard `## [Unreleased]` workflow in `CHANGELOG.md` and `.agents/rules/git-hygiene.md`.
- Required short, single-line `CHANGELOG.md` bullets in `.agents/rules/git-hygiene.md`.

---

## [0.2.0] - 2026-11-13

### Added
- **Firmware v2.x Compatibility:** Automatic 176-byte SysEx parsing/serialization and NRPN/CC parameter translation for firmware v2.x hardware.
- **Firmware v2.x Warnings:** Incompatibility detection for v3-only features (Chorder & Scaler, Matrix 11–12, etc.) and a clickable `FW v2.x` badge linking to the official updater.
- **Editor:** `M1`–`M4` multi-memory slots for quick patch recall and comparison.
- **Editor:** Drag-and-drop patch copying between `Part A`, `Part B`, memory slots, and the editor workspace.

### Fixed
- **UI:** Improved contrast and discernibility of Undo/Redo buttons.
- **UI:** Removed redundant static FW badge next to the app title.

### CI & Maintenance
- Added a minimal test suite runner for general use.
- Skipped automatic PR reviews for `main` to `release` PRs.
- Removed redundant CI workflow.
- Aligned git hooks with the `main`/`release` branch workflow.
- Updated release rules to require annotated tags and individual item bullets in `CHANGELOG.md`.
- Added `.gitignore` pattern for git worktrees.

---

## [0.1.6] - 2026-11-13

### Added
- Consistent HTML5 drag-and-drop parameter copying across **Oscillators** (tabs and active `.synth-card-body`), **Envelopes** (tabs, ADSR graph cards, and active `.env-pane`), **LFOs**, **Mod Matrix slots**, and **Multipliers**.
- Drag-and-drop copying for **16-Step Pattern Sequencer** steps (`.step-col`) in both **1-to-1** mode and **1-to-all** mode via an orange `"Copy to all"` drop target button.

### Changed
- Standardized multiplier and building block button styling.

### Documentation & Maintenance
- Specified live site URL and updated contribution guidelines.
- Added backup file patterns to `.gitignore`.
- Added changelog and release workflow rules.

---

## [0.1.5] - 2026-11-12

### Added
- Support Ko-fi username in `.github/FUNDING.yml`.

### Documentation & CI
- Extracted agent-agnostic project rules into `.agents/rules/` and `AGENTS.md`.
- Updated Gemini GitHub Actions workflows to use `gemini-4-hydrogen` and push/PR instructions.

---

## [0.1.4] - 2026-11-12

### Added
- **Librarian:** Bank renaming via toolbar button and double-clicking bank tabs.
- **Librarian:** Inline patch category editing directly in the librarian table.
- **Librarian:** Bank deletion support via toolbar and bank tabs.

### Fixed
- **Sync:** Synchronized Live Sync control state across app windows.
- **Sync:** Inherited hardware connection status, suppressed hardware poll dump notifications, and synced state from leader on open without running a redundant hardware fetch.
- **Timbral Mode:** Prevented spurious bitimbral mode switch when probing Part B on monotimbral hardware.
- **Librarian:** Prevented hardware poll dumps from populating the librarian, removed the default `INIT` patch, and aligned default bank names (`1`, `2`, `3`) with the new bank dialog.

### CI / Maintenance
- Configured official Gemini GitHub Actions, defined ESM module type for CI scripts, and added PR revision commands (`/revise`, `/fix`) and retry/sanitization hardening.

---

## [0.1.3] - 2026-11-12

### Added
- **Cross-Tab Sync:** Real-time `BroadcastChannel` synchronization and single-leader hardware polling across multiple browser tabs.
- **UI:** Moved Undo and Redo controls to the top `app-header`.

### Fixed
- **UI:** Streamlined Part A/B selection controls into `.program-name-group` and removed redundant header badges.
- **MIDI:** Included hardware state in Live Sync mode when initializing a program, and clarified the Init dialog prompt.

### CI / Maintenance
- Added automated Gemini issue-to-PR workflows and retry backoff.

---

## [0.1.2] - 2026-11-11

### Performance
- Memoized SysEx sound fingerprints and reused `TextEncoder`/`TextDecoder` instances.
- Cached parameter DOM controls and deduplicated visualizer refreshes.

### Fixed
- **MIDI:** Guarded SysEx buffer against interrupted streams and prevented false-positive connected status when hardware is absent.
- **UI:** Disabled Live Sync toggle unless hardware connection is verified, deactivated Fetch/Push controls when hardware is offline, and prevented reconnect sync dialog from repeating.

### Tests
- Added regression tests for fingerprint caching and interrupted SysEx streams.

---

## [0.1.1] - 2026-11-10

### Added
- Displayed application version in Settings backed by `js/version.js` as the single source of truth.

---

## [0.1.0] - 2026-11-10

### Added
- Initial release of the browser-based **MicroMonsta 2 Editor & Patch Librarian**.
- Full 216-byte single-layer SysEx parser/serializer, v2-to-v3 converter, and 7-bit/14-bit NRPN Web MIDI engine.
- 4-row synthesis rack with unified Oscillator and Envelope cards, bipolar sliders, vector SVG action icons, LFO/Matrix group actions, and Chorder 25-key keyboard visualizer.
- Functional Undo/Redo history with release-deferred knob updates.
- Live Sync dialog, hardware responsiveness health checks, reconnect handling, and synchronized Fetch/Push/Part Copy controls.
- Multi-bank Patch Librarian with duplicate detection, condensation, and bulk clear.
- Automated CLI/browser test suite (`tests/cli-runner.js`, `tests/test-suite.js`), Conventional Commits git hooks, README, and MIT license.
