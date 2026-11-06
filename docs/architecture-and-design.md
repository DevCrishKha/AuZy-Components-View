# Architecture & Technical Design: Auzy-Components-View

## 1. System Architecture Diagram (Drawflow-Powered)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 VS Code Extension Host (Node.js Process)                    │
│                                                                             │
│  [Extension Activator]                                                      │
│         │                                                                   │
│         ├──> [Status Bar Item]  --> "$(circuit-board) Auzy: Components View"│
│         │                                                                   │
│         ├──> [Webview Panel Manager] <──(postMessage JSON RPC)──┐           │
│         │                                                       │           │
│         ├──> [Component Parser] <──> Reads active code file     │           │
│         │                                                       │           │
│         ├──> [Wiring Coordinator] <─> Mutates code & JSON file  │           │
│         │                                                       │           │
│         └──> [File System Watcher] <─> Visualizer/*.json        │           │
└─────────────────────────────────┬───────────────────────────────┼───────────┘
                                  │ IPC Channel                   │
┌─────────────────────────────────▼───────────────────────────────┴───────────┐
│               Webview Process: Drawflow.js Engine & DOM                     │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │               Drawflow Instance (id="drawflow")                     │   │
│   │                                                                     │   │
│   │   • Viewport Pan & Zoom Controller                                  │   │
│   │   • Draggable Component Nodes (.drawflow-node)                      │   │
│   │   • Custom HTML Node Templates (Tags, Live Inputs, Dropdowns)       │   │
│   │   • SVG Bezier Connection Layer (.drawflow_connection)              │   │
│   │   • Sockets & Port Dispatcher (.input / .output)                    │   │
│   └─────────────────────────────────▲───────────────────────────────────┘   │
│                                     │ Drag & Drop Events                    │
│   ┌─────────────────────────────────┴───────────────────────────────────┐   │
│   │   Component Palette Sidebar (.palette-container)                    │   │
│   │   • Language Tabs (JavaScript, Python, etc.)                        │   │
│   │   • Scaffolding Component Chips (draggable="true")                  │   │
│   │   • Refresh & Manage Libraries UI                                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │ File I/O
┌─────────────────────────────────▼───────────────────────────────────────────┐
│                        Workspace Disk Storage                               │
│                                                                             │
│   ├── Source Code: app.js, script.py, etc.                                  │
│   └── external-vscode-extension/Visualizer/                                 │
│       ├── <source-filename>.json   (Tag annotations & metadata)             │
│       └── sources.json             (Configured library folder paths)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Subsystems

### 2.1 Extension Host vs. Webview Process Separation
1. **Extension Host (Node.js)**:
   - Full access to the VS Code API (`vscode.workspace`, `vscode.window`, `vscode.commands`).
   - Responsible for file I/O: reading source files, reading/writing `Visualizer/<filename>.json` and `sources.json`.
   - Listens to document save events (`vscode.workspace.onDidSaveTextDocument`) and file watch notifications to push live updates to the Webview.
   - Executes workspace edits (`vscode.workspace.applyEdit`) to modify source code when nodes are wired or input values are edited.
2. **Webview Process (Drawflow / HTML / CSS / JS)**:
   - Powered by **Drawflow.js** (lightweight, zero-dependency, pure JavaScript node-graph engine).
   - Renders the interactive 2D node-graph canvas with native node dragging, panning, zooming, and bezier wire drawing.
   - Hosts custom HTML inside each node container (`.drawflow_content_node`) to render live editable `<input>` fields, dropdowns, and relative-positioned tag rows.
   - Manages DOM nodes, SVG wire overlay, and the component palette.
   - Communicates with the Extension Host exclusively via `vscode.postMessage()` and `window.addEventListener('message', ...)`.

---

## 3. Bi-Directional Message Protocol (IPC Bridge)

The Extension Host and Webview communicate in pure JavaScript using a JSON-RPC message envelope:

```javascript
/**
 * @typedef {Object} WebviewMessage
 * @property {string} command - The action command name
 * @property {Object} payload - The message parameters
 */
```

### 3.1 Host to Webview (Inbound to Webview)

| Command | Payload | Description |
| :--- | :--- | :--- |
| `LOAD_FILE_DATA` | `{ fileUri, fileName, languageId, components: [], tags: [], wires: [] }` | Sent when the view opens or the active document changes. Delivers parsed components and their tags. |
| `UPDATE_PALETTE` | `{ libraries: [{ language, components: [] }] }` | Delivers the scanned component palette items for each configured language library. |
| `TAG_UPDATED` | `{ tag }` | Notifies that a tag's text, category, or default value has changed on disk. |
| `SHOW_ERROR` | `{ message }` | Displays an error notification or toast in the Webview. |

### 3.2 Webview to Host (Outbound from Webview)

| Command | Payload | Description |
| :--- | :--- | :--- |
| `REQUEST_INIT` | `{}` | Sent by the Webview once its DOM is loaded to request initial file data and palette. |
| `UPDATE_INPUT_TEXT` | `{ fileUri, tagId, oldText, newText, range }` | Sent when the user types a new value into an Input **or Default** tag's inline textbox. Host updates the source code and JSON. For Default tags, all connected Input tags are also automatically updated in code. |
| `APPLY_DEFAULT_VALUE`| `{ fileUri, tagId, selectedValue, range }` | Sent when the user picks a value from a Default tag's dropdown `↓`. Host updates source code. All Input tags connected to this Default tag via a wire are also automatically updated. |
| `CONNECT_WIRE` | `{ fileUri, sourceTagId, targetInputTagId }` | Sent when user drops an Output/Default cord into an Input port. Host updates code text and tag word (preserving Input tag type and metadata) and stores wire. |
| `DISCONNECT_WIRE` | `{ fileUri, wireId }` | Sent if user deletes a wire or unplugs a connection. |
| `DROP_COMPONENT` | `{ fileUri, componentId, dropX, dropY }` | Sent when user drags a palette component onto canvas. Host appends code to file and inserts tags. |
| `CONFIGURE_FOLDERS`| `{ action: 'add' | 'remove', language, folderPath }` | Updates language library source directories in `sources.json`. |
| `REFRESH_PALETTE` | `{}` | Re-triggers directory scanning and updates the palette. |

---

## 4. State Management & Lifecycle

### 4.1 In-Memory Graph State (Webview)
The Webview holds a reactive local state in pure JavaScript:
```javascript
const graphState = {
  activeFile: { uri: '', name: '', language: '' },
  components: new Map(), // componentId -> { name, range, lineCount, tags: [] }
  wires: new Map(),      // wireId -> { sourceTagId, targetTagId, connectionData }
  palette: [],           // array of available scaffolding components
  viewTransform: { x: 0, y: 0, zoom: 1.0 }
};
```

### 4.2 File System Watcher & Co-Existence
Because Extension #1 (Auzy-Keyword-Marker) and Extension #2 (Auzy-Components-View) run independently without in-memory coupling:
1. Extension #2 creates a `vscode.workspace.createFileSystemWatcher` for `**/external-vscode-extension/Visualizer/*.json`.
2. When Extension #1 saves a modified JSON file, the watcher triggers in Extension #2, causing the Drawflow editor to re-read the JSON and refresh node tags without losing current canvas pan/zoom coordinates.
3. Similarly, when the user edits code in the text editor and presses `Ctrl+S`, the document watcher notifies the Webview to re-parse component boundaries and update node heights.

---

## 5. Webview Panel Lifecycle & Restoration

1. The Components View uses `vscode.window.createWebviewPanel('auzyComponentsView', 'Auzy: Components View', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true })`.
2. Setting `retainContextWhenHidden: true` prevents the Webview from losing its canvas coordinates, zoom scale, and active inputs when the user toggles back and forth between the code editor and node canvas.
3. On extension deactivation, all file watchers and panel listeners are disposed cleanly.

---

## 6. Default Tag Propagation Subsystem

When a Default tag's text is modified by the user (either by typing into its inline live input or selecting from the preset dropdown `↓`):

```text
[User Edits Default Tag Text]
         │
         ▼
[updateInputTagText / applyDefaultValue in wiringCoordinator.js]
         │
         ├─► Mutates Default tag's own source file at its code range
         │
         ├─► Saves updated word + range in companion Visualizer JSON
         │
         └─► propagateDefaultTagChange(workspaceRoot, defaultTagId, newText)
                   │
                   ├─► Reads all wires from workspace-layout.json + Visualizer JSON files
                   │
                   └─► For each wire where sourceTagId === defaultTagId:
                             │
                             ├─► Resolves target file path (same file or different file)
                             │
                             └─► updateInputTagText(workspaceRoot, targetPath, targetTagId, newText, false)
                                       │
                                       ├─► Mutates Input tag's source code range
                                       └─► Saves updated word + range in target Visualizer JSON
```

**Key implementation detail**: The recursive call to `updateInputTagText` for connected Input tags passes `propagateDefault = false` to prevent infinite propagation loops.

**DOM Live Update**: On the Webview side, `syncConnectedInputsInDom(sourceTagId, newText)` immediately updates the displayed value inside any connected Input tag's DOM `<input>` element before the full canvas refresh arrives.

---

## 7. Wire Integrity Verification Subsystem

Every call to `scanWorkspaceHierarchy()` — which fires on every canvas refresh — performs a wire integrity pass:

```text
[scanWorkspaceHierarchy called]
         │
         ├─► walkDir collects allTagsMap (tagId + fileRel → tag) and fileDocsMap
         │
         ├─► Collects allWorkspaceWires from:
         │       • savedLayout.wires (workspace-layout.json)
         │       • Each file node's wires array (Visualizer JSON)
         │
         └─► For each wire in allWorkspaceWires (only connected tags are checked):
                   │
                   ├─► Resolve sourceTag.word and targetTag.word
                   │
                   ├─► If sourceTag AND targetTag both exist AND their words differ:
                   │       → Add wire to removedWireKeys set
                   │
                   └─► After all wires checked:
                           ├─► Remove all removedWireKeys from savedLayout.wires
                           ├─► Remove all removedWireKeys from each file node's wires array
                           └─► Persist updated Visualizer JSON for affected files
```

**Scope**: Only connected tag pairs are checked. Tags with no wires are ignored entirely, preventing false positives from unrelated tag edits.
