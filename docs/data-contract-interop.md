# Data Contract & Inter-Extension Interoperability

## 1. Storage Location & File Hierarchy (Mirrored Relative Paths)

Both Extension #1 (Auzy-Keyword-Marker) and Extension #2 (Auzy-Components-View) read and write to the same standardized directory structure inside the workspace root. **Each source code file has its own individual JSON file mirroring its relative directory path** from the workspace root.

```text
<workspace-root>/
├── external-vscode-extension/
│   └── Visualizer/
│       ├── sources.json          # Language folder libraries configuration
│       ├── src/
│       │   └── main.js.json      # Mirrored path for src/main.js
│       ├── backend/
│       │   └── app.py.json       # Mirrored path for backend/app.py (Zero collision with root app.py!)
│       ├── app.py.json           # Mirrored path for root app.py
│       └── notes.txt.json        # Mirrored path for root notes.txt
```

---

## 2. JSON Schema: `<relative-path-to-source-file>.json`

Every source file has its own individual JSON file located at:
`path.join(workspaceRoot, 'external-vscode-extension', 'Visualizer', path.relative(workspaceRoot, filePath) + '.json')`.

### 2.1 Complete Schema Specification (Pure JavaScript / JSDoc)

```javascript
/**
 * @typedef {Object} VisualizerDocument
 * @property {"Auzy-Keyword-Marker"} name - Fixed identifier constant
 * @property {string} fileUri - Full file URI, e.g. "file:///c:/project/main.js"
 * @property {string} fileName - Basename, e.g. "main.js"
 * @property {string} savedAt - ISO-8601 UTC timestamp, e.g. "2026-11-01T01:00:00.000Z"
 * @property {TagObject[]} tags - Array of marked keyword tags
 * @property {WireRecord[]} [wires] - Optional array of established port connections
 */

/**
 * @typedef {Object} TagObject
 * @property {string} id - Unique ID: e.g. "tag_1730419200000_abc12"
 * @property {string} word - Current text of the token in code
 * @property {string} [title] - Optional human-readable title
 * @property {RangeObject} range - 0-indexed code coordinates
 * @property {"variable"|"function"|"tut-tag"|"keyword"} category
 * @property {"Input"|"Output"|"Default"|"Pin Value"} [variableSubType]
 * @property {string[]} [defaultValues] - Array of defaults when variableSubType is "Default"
 * @property {string} [description] - User documentation note
 * @property {Object} [tutData] - Tutorial canvas payload when category is "tut-tag"
 */

/**
 * @typedef {Object} RangeObject
 * @property {number} startLine - 0-indexed line number
 * @property {number} startCharacter - 0-indexed character offset
 * @property {number} endLine - 0-indexed line number
 * @property {number} endCharacter - 0-indexed character offset
 */

/**
 * @typedef {Object} WireRecord
 * @property {string} id - Wire unique identifier
 * @property {string} sourceTagId - Tag ID of Output or Default tag (the propagation source)
 * @property {string} targetTagId - Tag ID of wired Input tag (the propagation target)
 * @property {string} [sourceFile] - Relative path (forward slashes) of the file containing the source tag
 * @property {string} [targetFile] - Relative path (forward slashes) of the file containing the target tag
 */
```

---

## 3. Schema: `sources.json` (Language Component Libraries)

Stored in `<workspace-root>/external-vscode-extension/Visualizer/sources.json`:

```json
{
  "version": "1.0.0",
  "updatedAt": "2026-11-01T01:30:00.000Z",
  "libraries": {
    "javascript": [
      "c:/my-libraries/js-components"
    ],
    "python": [
      "c:/my-libraries/py-components"
    ],
    "typescript": [
      "c:/my-libraries/ts-components"
    ]
  }
}
```

---

## 4. Dual Wire Storage & Integrity Contract

Wires are persisted in **two places simultaneously** and both must be kept consistent:

| Location | Key | Notes |
| :--- | :--- | :--- |
| `workspace-layout.json` → `wires[]` | Root-level array | Contains the authoritative list of all active wires across the entire workspace. Each entry has the full `WireRecord` shape including `sourceFile` and `targetFile`. |
| `external-vscode-extension/Visualizer/<targetFile>.json` → `wires[]` | Per-file array | The target file's Visualizer JSON also stores the wire so Extension #1 can detect the connection. `sourceFile`/`targetFile` may be omitted here (legacy entries). |

### 4.1 Wire Deduplication Rule

When reading all wires for the integrity check or propagation scan, **deduplicate by `wire.id`**. Load from both sources, then combine into a `Map<id, WireRecord>`. This prevents double-processing a wire that appears in both locations.

### 4.2 Wire Integrity Check (Canvas Refresh)

Every time the canvas refreshes (`src/directoryScanner.js`), connected wires are validated:

1. Collect all wires from `workspace-layout.json` + all Visualizer JSONs (deduped by `id`).
2. For each wire, look up `sourceTag.word` and `targetTag.word`.
3. If `sourceTag.word !== targetTag.word`, the wire is **stale** and is removed from both storage locations.
4. Unconnected tags (not referenced in any wire) are **never** inspected.

### 4.3 Default-to-Input Propagation IPC Contract

| IPC Message Type | Direction | Behavior |
| :--- | :--- | :--- |
| `APPLY_DEFAULT_VALUE` | Webview → Host | Updates Default tag `word` in source + JSON. Then scans all workspace wires for wires where `sourceTagId === defaultTagId`. Calls `updateInputTagText` on each connected Input tag. Finally calls `refreshWebview`. |
| `UPDATE_INPUT_TEXT` | Webview → Host | Updates Input tag `word` in source + JSON with `propagateDefault = false` (no secondary propagation). Then calls `refreshWebview`. |

> **Propagation Guard**: When `updateInputTagText` is called recursively for a connected Input tag, the `propagateDefault` flag is `false`. This prevents infinite loops if an Input tag were ever wired back to a Default tag.

---

## 5. Strict Interoperability Rules Between Both Extensions

1. **Strict Decoupling (No Shared In-Memory State)**:
   - Extension #1 and Extension #2 do **not** use `vscode.extensions.getExtension()` to invoke each other's in-memory methods.
   - All state transfer is strictly through the filesystem.
2. **Preserve Unrecognized Fields**:
   - When reading and modifying a JSON file, never delete fields that your extension does not directly modify (e.g. `tutData`, `title`, or custom metadata).
3. **Immutable Tag Identifiers**:
   - Never mutate an existing tag's `id`. The `id` is the primary key used to track wires and synchronize state.
4. **Range Coordinate Invariance**:
   - All ranges must be zero-indexed integers (`startLine`, `startCharacter`, `endLine`, `endCharacter`).
5. **Exact Case Sensitivity**:
   - Tag categories must strictly match: `"variable"`, `"function"`, `"tut-tag"`, `"keyword"`.
   - Variable subtypes must strictly match: `"Input"`, `"Output"`, `"Default"`, `"Pin Value"`.
6. **File Encoding & Formatting**:
   - Write files with UTF-8 encoding.
   - Format JSON with 2 spaces indentation (`JSON.stringify(data, null, 2)`).

