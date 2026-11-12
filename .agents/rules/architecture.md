# Architecture & Tech Stack Guidelines

- **Pure Vanilla Web Stack:** Build exclusively with standard HTML5, CSS3, and modern Vanilla ECMAScript (ES2022+).
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
- **Maintain Global Scope Integrity:** Attach all modules to existing top-level namespaces (e.g., `window.App`, `window.MM2Specs`, `window.SysExParser`, `window.MidiManager`).
