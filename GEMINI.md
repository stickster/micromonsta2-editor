# Gemini Agent Guidelines: MicroMonsta 2 Editor & Patch Librarian

This repository contains a browser-based hardware editor, patch librarian, and duplicate manager for the [Audiothingies MicroMonsta 2](https://audiothingies.com/) synthesizer (firmware v3.x).

---

## 1. Tech Stack & Architectural Principles

- **Pure Vanilla Web Stack:** The codebase is built with standard HTML5, CSS3, and modern Vanilla ECMAScript (ES2022+).
- **Zero Build Step & Zero Dependencies:** Do not add bundlers (Webpack, Vite, Rollup), transpilers (Babel, TypeScript), CSS frameworks (Tailwind, Bootstrap), or external runtime libraries.
- **Global Script Loading:** Scripts are loaded in the browser as plain globals in the explicit sequence defined in `index.html`:
  1. `js/version.js` — Semantic application version definition.
  2. `js/tab-sync.js` — Cross-tab state synchronization via `BroadcastChannel`.
  3. `js/mm2-specs.js` — Hardware parameter definitions, value ranges, and MM2 sound program model.
  4. `js/sysex-parser.js` — SysEx binary encoder/decoder (v3 spec and v2-to-v3 converter).
  5. `js/patch-librarian.js` — Patch storage, bank management, search, and duplicate detection.
  6. `js/midi-manager.js` — Web MIDI API abstraction layer and hardware I/O.
  7. `js/ui-controls.js` — Custom UI controls (rotary knobs, sliders, value displays).
  8. `js/app.js` — Top-level application controller and state orchestrator.
- **Maintain Global Scope Integrity:** All modules attach to existing top-level namespaces (e.g. `window.App`, `window.MM2Specs`, `window.SysExParser`, `window.MidiManager`).

---

## 2. MicroMonsta 2 Hardware & Protocol Specifications

- **SysEx Preset Size:** Official MM2 sound program dumps are strictly **216 bytes** long.
- **Single-Layer Scope:** SysEx dumps represent a single sound layer (Layer A or Layer B). Command byte `0x01` is Layer A; `0x02` is Layer B.
- **Hardware Limitations (Do Not Attempt Over MIDI):**
  - **Combination Settings:** Combination definitions (Split vs. Stack mode, split point note, layer mix/balance, transpose, performance controller assignments) cannot be read, edited, or backed up over MIDI. While MIDI Program Change (0–99) selects stored combi presets, combi configuration is hardware-only via the synth screen and encoders.
  - **System Settings:** Master tuning, base MIDI channel, screen timeout, and hardware button timings are inaccessible over SysEx or MIDI.
- **Timbral Modes:** The synth operates in Monotimbral, Bitimbral, or Combi mode. The editor detects the active mode by probing Layer B, but switching modes is hardware-only; the UI mode indicator is display-only.
- **NRPN Control:** High-resolution parameters use 14-bit NRPN (MSB CC 99, LSB CC 98, Data MSB CC 6, Data LSB CC 38); 7-bit parameters use CC 6 only.

---

## 3. Testing & Verification

- **Command-Line Test Suite:** Always run the test suite before submitting any changes:
  ```sh
  node tests/cli-runner.js
  ```
- **Zero Failures Required:** All tests must pass with 0 errors.
- **Regression Testing:** Whenever fixing a bug or adding a feature, add corresponding test cases to `tests/test-suite.js`.

---

## 4. Git & Contribution Conventions

- **Conventional Commits:** Write commit messages strictly formatted as:
  `<type>(<scope>): <summary>`
  Allowed types: `feat`, `fix`, `refactor`, `style`, `test`, `docs`, `chore`, `perf`, `ci`, `build`.
  Summary must be under 72 characters, lowercase, imperative, and with no trailing period.
- **Attribution:** When committing AI-assisted changes, include the trailer:
  `Co-authored-by: Google Gemini <gemini@google.com>`
- **Minimal Diffs:** Make surgical, minimal edits directly relevant to the issue. Avoid unrelated refactorings or unnecessary whitespace adjustments.
