# Implementation Roadmap, Testing Suite & Project Blueprint

## 1. Extension Project Directory Blueprint

When creating the 2nd project in an isolated workspace, follow this modular pure JavaScript structure:

```text
Auzy-Components-View/
├── .vscode/
│   ├── launch.json                   # F5 extension debugging profile
│   └── tasks.json
├── docs/                             # Project documentation (copy from docs2/)
├── example/                          # Isolated mock test files
│   ├── script.py                     # Python test code with marker comments
│   ├── notes.txt                     # Plain text test with marker comments
│   └── external-vscode-extension/
│       └── Visualizer/
│           ├── script.py.json        # Pre-annotated tags for script.py
│           ├── notes.txt.json        # Pre-annotated tags for notes.txt
│           └── sources.json          # Pre-configured library directories
├── media/                            # Webview frontend assets (Drawflow.js)
│   ├── drawflow.min.js               # Drawflow.js core library
│   ├── drawflow.min.css              # Drawflow base styles
│   ├── main.css                      # Custom theme, node, port, and wire styles
│   ├── main.js                       # Drawflow initialization, IPC bridge, custom nodes
│   └── icons/                        # Sockets, refresh, gear, delete icons
├── src/                              # Node.js backend subsystems (Pure JavaScript)
│   ├── markerParser.js               # Extracts <{<< Comp >>}> blocks from source
│   ├── paletteScanner.js             # Scans folders and derives scaffolding components
│   ├── layoutEngine.js               # Sizing formula & relative tag placement
│   ├── wiringCoordinator.js          # Code replacement and tag mutation logic
│   ├── persistenceBridge.js          # Reads/writes Visualizer JSON & sources.json
│   ├── webviewPanelManager.js        # Webview lifecycle & IPC message router
│   └── statusBar.js                  # Status bar item $(circuit-board)
├── test/                             # Automated test suite (node --test)
│   ├── markerParser.test.js          # Tests marker comment extraction
│   ├── layoutEngine.test.js          # Tests node sizing and line gap compression
│   ├── wiringCoordinator.test.js     # Tests code and tag mutation
│   └── paletteScanner.test.js        # Tests folder scanning and code wrapping
├── extension.js                      # Main entrypoint (activate / deactivate)
├── package.json                      # VS Code extension manifest
└── README.md                         # Extension overview & quickstart
```

---

## 2. Phased Implementation Roadmap

```text
[Phase 1: Manifest & Marker Parser Engine]
                 │
                 ▼
[Phase 2: Drawflow Webview Panel & Canvas Shell]
                 │
                 ▼
[Phase 3: Dynamic Node Sizing & Relative Tag Layout]
                 │
                 ▼
[Phase 4: Component Palette & Folder Scaffolding]
                 │
                 ▼
[Phase 5: Interactive Wiring Cords & Code Mutation]
                 │
                 ▼
[Phase 6: In-Node Input Editing, Default Dropdowns & Tutorial Viewer]
```

### Phase 1: Extension Shell & Marker Parser Engine
- Set up `package.json` with command `auzyComponentsView.openView` and status bar item `$(circuit-board) Auzy: Components View`.
- Implement `src/markerParser.js` in pure JavaScript to extract `<{<< Name >>}> ... </{<< Name >>}>` blocks.
- Write unit tests in `test/markerParser.test.js` validating JavaScript, Python, and plain text comments.

### Phase 2: Webview Panel & Drawflow Canvas Shell
- Implement `src/webviewPanelManager.js` to create and restore the Webview panel.
- Embed `drawflow.min.js` and `drawflow.min.css` in the Webview HTML.
- Initialize `new Drawflow(container)` with native pan, zoom, and node dragging.
- Establish typed `postMessage` IPC communication bridge between Host and Webview.

### Phase 3: Dynamic Node Sizing & Relative Tag Layout
- Implement `src/layoutEngine.js` calculating node width/height based on line count and tag count.
- Implement the line compaction algorithm to compress empty line gaps.
- Render component nodes with headers and tag rows.

### Phase 4: Component Palette & Folder Scaffolding
- Implement `src/persistenceBridge.js` to read and write `sources.json`.
- Implement `src/paletteScanner.js` to scan directories and discover reusable components.
- Implement HTML5 Drag and Drop from palette to canvas, injecting code into the document and tags into `Visualizer/<filename>.json`.

### Phase 5: Interactive Wiring Cords & Code Mutation
- Implement SVG layer with cubic bezier curve calculation.
- Support mouse-drag from Output/Default socket to Input socket.
- On wire release, invoke `src/wiringCoordinator.js` to replace the Input tag's token in code and convert the tag schema.

### Phase 6: In-Node Editing, Default Dropdowns & Tutorial Viewer
- Inline `<input>` on Input tags enabling direct code editing from the node.
- Floating dropdown `↓` on Default tags to pick values.
- Modal overlay for Tut-Tags rendering tutorial cards and code blocks.
- End-to-end testing with the mock files in `example/`.

### Phase 7: Default-to-Input Propagation & Wire Integrity Auto-Check
- **Default Tag Inline Editing**: Replaced the static Default tag word `<span>` with a live `<input type="text">` element. The Default tag now behaves identically to an Input tag visually — the user can type a new value directly on the canvas node.
- **Propagation on Change**: When the Default tag's inline input is committed (`onchange`), the extension host:
  1. Updates the Default tag's `word` in its source file and Visualizer JSON (`APPLY_DEFAULT_VALUE`).
  2. Scans all workspace wires (from `workspace-layout.json` + all Visualizer JSONs) for connections where `sourceTagId === <changedDefaultTagId>`.
  3. Calls `updateInputTagText` on each connected Input tag with the new text, propagating the value across files.
- **Immediate DOM Sync**: `syncConnectedInputsInDom(sourceTagId, newText)` in `media/main.js` updates connected Input `<input>` elements in the DOM instantly, before the full canvas refresh arrives from the host.
- **Wire Integrity Check on Canvas Refresh**: Inside `src/directoryScanner.js`, every time the workspace is scanned (canvas refresh):
  1. All wired tag pairs (from both `workspace-layout.json` and Visualizer JSONs) are collected and deduplicated.
  2. For each wire, the `word` of the source tag and target tag are compared.
  3. If the words differ, the wire is automatically removed from `workspace-layout.json` and the affected Visualizer JSON files.
  4. Only connected tags are checked — unconnected tags are never evaluated for integrity.

---

## 3. Unit Test Specifications

Run tests with Node's native runner: `node --test test/**/*.test.js`.

### 3.1 Marker Parser Tests (`test/markerParser.test.js`)
1. Detects `// <{<< Auth >>}>` and `// </{<< Auth >>}>` in JavaScript.
2. Detects `# <{<< Database >>}>` and `# </{<< Database >>}>` in Python.
3. Detects `<!-- <{<< Header >>}> -->` in HTML.
4. Correctly extracts inner code lines, startMarkerLine, and endMarkerLine.
5. Handles unclosed marker comments gracefully without throwing exceptions.

### 3.2 Layout & Sizing Tests (`test/layoutEngine.test.js`)
1. Verifies minimum node dimensions (220x140px) for empty or small components.
2. Verifies scaling up for 100 lines of code up to max bounds (500x650px).
3. Verifies tags on the same line receive identical vertical Y coordinates.
4. Verifies line gap compression clamps gaps larger than 3 lines.

### 3.3 Wiring & Mutation Tests (`test/wiringCoordinator.test.js`)
1. Verifies wiring an Output tag replaces the Input tag's text in source code.
2. Verifies Input tag `variableSubType` is converted to `"Output"`.
3. Verifies metadata (`title`, `description`) is cloned correctly.
4. Verifies wiring a Default tag converts Input tag to `"Default"` and copies `defaultValues`.
5. Verifies changing a Default tag's text propagates to a connected Input tag in another file (cross-file propagation).
6. Verifies changing a Default tag's text propagates to multiple connected Input tags simultaneously.
7. Verifies same-file propagation: Default tag and Input tag in the same Visualizer JSON are both updated.

### 3.4 Directory Scanner Tests (`test/directoryScanner.test.js`)
1. Verifies that a wire between two tags with matching `word` text is preserved on canvas refresh.
2. Verifies that a wire between two tags with mismatched `word` text is automatically removed from `workspace-layout.json` and both Visualizer JSONs on canvas refresh.
3. Verifies that an input-to-default wire with diverged text is also removed during canvas refresh.
4. Verifies that unconnected tags are never evaluated or removed during the integrity check.

---

## 4. Common Pitfalls & Agent Guidance

1. **Chromium Sandboxing in Webview**:
   - `window.prompt()` and `window.confirm()` are blocked in VS Code Webviews. Always use HTML-based in-canvas modals.
2. **Asynchronous File Saves**:
   - When modifying source code and JSON, apply the workspace edit first, then update and write the JSON to ensure synchronized coordinates.
3. **Canvas Zoom Coordinate Offsets**:
   - When dragging or placing nodes, always translate screen coordinates `(clientX, clientY)` using the current canvas pan offset and zoom scale: `(clientX - panX) / zoom`.
4. **Theme Color Neutrality**:
   - Never hardcode light or dark background colors. Always use VS Code CSS variables (`var(--vscode-editor-background)`, `var(--vscode-editor-foreground)`, `var(--vscode-button-background)`).
