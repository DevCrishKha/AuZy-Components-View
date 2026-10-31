# Component Palette & Library Scaffolding System

## 1. Overview & Purpose

The **Component Palette** provides a visual library of reusable code building blocks categorized by programming language. It empowers developers to build complete programs modularly by dragging and dropping pre-tested components onto the 2D canvas.

Under the hood, a "component" is simply a block of code delimited by marker comments (`<{<< Component-Name >>}>`) located in any designated project or library folder.

---

## 2. Library Folder Configuration & Persistence

The palette is **not static or hardcoded**. The user configures one or more source directories for each programming language from which components are discovered.

### 2.1 Storage Location & Schema
Configured directory paths are persisted in a JSON file at the workspace root:
```text
<workspace-root>/external-vscode-extension/Visualizer/sources.json
```

### 2.2 `sources.json` Schema
```json
{
  "version": "1.0.0",
  "updatedAt": "2026-11-01T01:30:00.000Z",
  "libraries": {
    "javascript": [
      "c:/Projects/common-components/js",
      "c:/Projects/my-project/src/modules"
    ],
    "python": [
      "c:/Projects/ai-components/python",
      "c:/Projects/my-project/lib"
    ],
    "typescript": [
      "c:/Projects/ts-shared"
    ]
  }
}
```

### 2.3 Folder Configuration UI
In the Webview's palette header, a **Manage Libraries (⚙️)** button opens a modal allowing the user to:
1. Select a language (e.g. JavaScript, Python, TypeScript).
2. Click **"+ Add Folder"** (invokes native VS Code folder selection dialog via Host IPC).
3. View existing configured folders with a **Delete (🗑️)** icon beside each path.
4. Save updates to `sources.json`.

---

## 3. Scaffolding & Folder Scanning Algorithm

Whenever the palette is initialized or the user clicks the **Refresh (🔄)** button on the palette header:

```text
[User Clicks Refresh or Palette Loads]
                 │
                 ▼
[Read external-vscode-extension/Visualizer/sources.json]
                 │
                 ▼
[Iterate Each Configured Language (e.g. JavaScript, Python)]
                 │
                 ▼
[Scan Configured Directories for Matching Source Files]
                 │
                 ▼
[Parse Files for Start/End Marker Comments <{<< ... >>}>]
                 │
                 ▼
[Check Target File's Visualizer JSON & Extract Contained Tags]
                 │
                 ▼
[Build Scaffolding Component JavaScript Objects]
                 │
                 ▼
[Render Component Chips in Palette Sidebar Tray]
```

### 3.1 `ScaffoldingComponent` Specification (Pure JavaScript / JSDoc)
```javascript
/**
 * @typedef {Object} ScaffoldingComponent
 * @property {string} id - Unique ID: hash of file path + component name
 * @property {string} name - Display name (from <{<< Name >>}>)
 * @property {string} language - e.g. "javascript", "python"
 * @property {string} sourceFilePath - Absolute path to source file
 * @property {string} [description] - Extracted from adjacent comment or Tut-Tag
 * @property {number} lineCount - Number of lines of code
 * @property {string[]} codeLines - Raw source code lines (excluding outer markers)
 * @property {Object[]} tags - Tags located inside this component (normalized to offset 0)
 */
```

---

## 4. Drag-and-Drop Workflow & Code Generation

When a user drags a component chip from the palette and drops it onto the canvas:

```
[ Palette Chip ] ===(Drag & Drop)===> [ Canvas (X, Y) ]
                                              │
         ┌────────────────────────────────────┴────────────────────────────────────┐
         ▼                                                                         ▼
1. Source Code Injection                                                2. Tag Import & Offset Shift
   Append wrapped code to target file:                                     Read component's tags:
   `// <{<< New-Component >>}>`                                            `startLine = insertionLine + tag.startLine`
   `...codeLines...`                                                       `endLine = insertionLine + tag.endLine`
   `// </{<< New-Component >>}>`                                           Append shifted tags to target's JSON file!
```

### 4.1 Detailed Step-by-Step Execution on Drop

1. **Calculate Canvas Coordinates**:
   - The Webview computes the drop position in virtual canvas coordinates:
     ```javascript
     const canvasX = (event.clientX - viewTransform.x) / viewTransform.zoom;
     const canvasY = (event.clientY - viewTransform.y) / viewTransform.zoom;
     ```
2. **Send Drop IPC Message to Extension Host**:
   - Webview sends `DROP_COMPONENT` with `{ fileUri, componentId, dropX: canvasX, dropY: canvasY }`.
3. **Append Code to Active Document (Extension Host)**:
   - Read the target source code document.
   - Determine `insertionLine = document.lineCount`.
   - Wrap the component's `codeLines` in language-appropriate comments using `wrapComponentInComment()`.
   - Apply workspace edit via `vscode.workspace.applyEdit()`:
     ```javascript
     const edit = new vscode.WorkspaceEdit();
     const insertPos = new vscode.Position(insertionLine, 0);
     edit.insert(document.uri, insertPos, '\n\n' + wrappedCode);
     await vscode.workspace.applyEdit(edit);
     ```
4. **Import & Offset Tags in Visualizer JSON**:
   - Read `<workspace>/external-vscode-extension/Visualizer/<target-filename>.json`.
   - For every tag inside `scaffoldingComponent.tags`:
     - Clone the tag with a new unique ID (`tag_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`).
     - Calculate new range:
       ```javascript
       const lineOffset = insertionLine + 1; // +1 to account for opening marker comment line
       newTag.range = {
         startLine: tag.range.startLine + lineOffset,
         startCharacter: tag.range.startCharacter,
         endLine: tag.range.endLine + lineOffset,
         endCharacter: tag.range.endCharacter
       };
       ```
     - Add to target file's `tags` array.
   - Save the updated JSON file to disk.
5. **Instant Canvas Update**:
   - Webview creates a new component node placed at `(canvasX, canvasY)` and re-renders smoothly.

