# Auzy-Components-View (Extension #2)
## Master Agent Documentation & Specification Index

Welcome to the specification repository for the **Auzy-Components-View** VS Code Extension (Extension #2). This folder contains the comprehensive architectural, algorithmic, visual, and behavioral specifications necessary for an autonomous AI agent or engineer to build this extension from the ground up in pure JavaScript (ES6/ES2020) and Drawflow.js in complete isolation.

---

## 1. Executive Summary & Vision

The **Auzy-Components-View** extension transforms standard, text-based source code into an interactive, visual, node-based flow canvas powered by Drawflow.js, embedded directly inside a VS Code editor tab.

- **Modular Components in Code**: Pieces of source code delimited by marker comments (`<{<< Component-Name >>}> ... </{<< Component-Name >>}>`) appear on a virtual 2D canvas as visual **Component Nodes**.
- **Visual Plug & Play Development**: Developers—from professional engineers creating clean architecture to children and coding students—can drag pre-packaged components from a language palette directly onto the canvas. Dropping a node automatically generates the underlying code in the active editor!
- **Interactive Wirable Ports (Input, Output, Default)**: Tags marked by the companion **Auzy-Keyword-Marker Extension** appear on the node with real-time sockets. Pulling a visual wire/cord from an Output or Default tag's port and dropping it into an Input tag's socket instantly rewrites the underlying code and syncs the tag definitions.
- **Direct In-Node Value Editing**: Input tag values can be edited directly on the canvas without opening the source code editor.
- **Default Tag Inline Editing & Propagation**: Default tags also render an inline editable input on the canvas. When the user changes a Default tag's value, the new value automatically propagates to every connected Input tag — updating the source code and JSON across all files instantly.
- **Wire Integrity Auto-Check**: Every canvas refresh automatically validates all connected wire pairs. If the `word` text of a source tag and its target tag have diverged (e.g. edited independently), the wire is silently removed to prevent stale connections from persisting on the canvas.
- **Drawflow.js Canvas Architecture**: Pure JavaScript node editor utilizing Drawflow.js for native node dragging, bezier curve rendering, port events, and custom HTML templates.
- **Filesystem-Only Decoupled Architecture**: Extension #1 (Auzy-Keyword-Marker) and Extension #2 (Auzy-Components-View) communicate strictly via files on disk (`external-vscode-extension/Visualizer/<filename>.json` and the source code files). They do not share memory or process state.

---

## 2. Documentation Map

Every document in this directory serves a dedicated role in guiding the development of Extension #2:

| Document | Purpose & Key Topics |
| :--- | :--- |
| [**`requirements.md`**](./requirements.md) | Full functional requirements, user journeys, status bar activation, editor tab webview, palette interaction, wiring behavior, Default tag inline editing + propagation, wire integrity auto-check, and UI controls. |
| [**`architecture-and-design.md`**](./architecture-and-design.md) | High-level Drawflow system architecture, VS Code Webview panel mechanics, two-way messaging protocol, state management, Default tag propagation subsystem, wire integrity subsystem, and file watcher sync. |
| [**`marker-comment-spec.md`**](./marker-comment-spec.md) | Exact syntax, regex parsing, language comment syntax adaptation (Python `#`, JS `//`, HTML `<!-- -->`), code range calculation, and code injection rules. |
| [**`component-palette-and-scaffolding.md`**](./component-palette-and-scaffolding.md) | Language palette UI, folder library configuration, storage of source folders in `sources.json`, live folder scanning, and drag-and-drop code generation. |
| [**`node-editor-and-canvas.md`**](./node-editor-and-canvas.md) | 2D canvas specs, node sizing formula (min/max bounds based on code length & tag count), relative tag positioning algorithm, space compaction, and tag rendering in Drawflow. Includes Default tag inline input spec. |
| [**`wiring-and-cord-engine.md`**](./wiring-and-cord-engine.md) | Bezier cord rendering, drag-to-connect physics, port collision detection, code mutation on connect, Default-to-Input propagation flow, wire integrity verification subsystem, and undo/rewire mechanics. |
| [**`data-contract-interop.md`**](./data-contract-interop.md) | Complete JSON schema contract for `external-vscode-extension/Visualizer/<filename>.json`, dual wire storage contract, wire integrity rules, Default propagation IPC contract, and compatibility rules for co-existing with Auzy-Keyword-Marker. |
| [**`implementation-roadmap-and-testing.md`**](./implementation-roadmap-and-testing.md) | Phased implementation roadmap (Phases 1–7), project directory layout, unit test suites (Node test runner in pure JavaScript), mock fixtures, and common pitfalls. |

---

## 3. Guiding Principles for Implementing Agents

1. **Zero Memory Couplings**: Never attempt to communicate with Extension #1 via VS Code extension exports, global variables, or IPC channels. Read and write purely to the source file and `<workspace>/external-vscode-extension/Visualizer/<filename>.json`.
2. **Pure JavaScript (No TypeScript)**: Use ES6/ES2020 JavaScript with JSDoc typing across all host modules and webview scripts.
3. **Preserve Surrounding Code**: When inserting a component or wiring variables, never corrupt non-component code or unrelated comment tags.
4. **Drawflow.js Integration**: Rely on Drawflow.js for canvas panning, zooming, node dragging, and bezier wire rendering. Inject custom HTML inside node containers to render interactive tags.
5. **Resilient Offset Syncing**: When code is edited or dropped, update tag ranges proportionally so both extensions remain synchronized on disk.
