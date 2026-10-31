# Wiring & Cord Connection Engine

## 1. Overview

The **Wiring Engine** powers the interactive Node-RED style cords connecting Output/Default ports to Input sockets. Connecting two ports performs visual wiring on the canvas and simultaneously rewrites the source code and synchronizes the tag metadata in the background.

```
[ Component A: Output Tag ] ───( Bezier Cord )───► [ Component B: Input Tag ]
       liveText: "dbClient"                              Replaced: "userInput" -> "dbClient"
       type: Output                                      type: Input (Stays Input, word updated)
```

---

## 2. SVG Bezier Curve Mathematics

Cords are rendered as `<path>` elements within a full-screen `<svg class="wires-layer">` positioned behind nodes or above sockets.

### 2.1 Cubic Bezier Formula
For a connection starting at Output socket `(x1, y1)` and ending at Input socket `(x2, y2)`:

```javascript
function computeBezierPath(x1, y1, x2, y2) {
  // Horizontal distance
  const dx = Math.abs(x2 - x1);
  // Curvature intensity scales with horizontal distance
  const curvature = Math.max(dx * 0.5, 40);

  const cp1x = x1 + curvature;
  const cp1y = y1;
  const cp2x = x2 - curvature;
  const cp2y = y2;

  return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
}
```

### 2.2 Wire Styling & Theme Variables
- **Idle / Connected Wire**:
  ```css
  .wire-path {
    fill: none;
    stroke: var(--vscode-charts-orange, #f39c12);
    stroke-width: 3px;
    stroke-linecap: round;
    cursor: pointer;
    transition: stroke 0.2s, stroke-width 0.2s;
  }
  .wire-path:hover {
    stroke: #e74c3c;
    stroke-width: 5px;
  }
  ```
- **Active Dragging Wire**:
  ```css
  .wire-dragging {
    fill: none;
    stroke: #3498db;
    stroke-width: 3px;
    stroke-dasharray: 6, 4;
    animation: dash 1s linear infinite;
  }
  @keyframes dash {
    to { stroke-dashoffset: -10; }
  }
  ```

---

## 3. Interactive Drag-to-Connect Workflow (Drawflow Events)

In Drawflow.js, connection creation is driven by mouse drag events on `.socket.output` and `.socket.input`:

```text
[Idle State]
     │
     │ MouseDown on Output/Default Socket ⭕
     ▼
[Dragging Cord (.wire-dragging)]
     │
     ├──> MouseMove: Drawflow updates live bezier SVG path to cursor
     │
     ├──> MouseEnter on valid Input Socket ⭕: Port highlights with snap outline
     │
     ├──> MouseUp on Input Socket: Fires `connectionCreated`
     │         │
     │         ▼
     │    [Connect Ports] ──> Mutate Source Code + Update JSON + Draw Permanent Wire
     │
     └──> MouseUp on empty canvas: Fires `connectionCancel`
               │
               ▼
          [Cancel Wire] ──> Remove temporary SVG curve, return to Idle
```

### 3.1 Validation Rules
- **Valid Connections**:
  - Source must be an **Output** or **Default** variable tag.
  - Target must be an **Input** variable tag.
  - Source and Target can belong to different components **or the same component**.
- **Invalid Connections**:
  - Connecting Input to Input (blocked).
  - Connecting Output to Output (blocked).
  - Connecting Tut-Tag or Function tag (they have no sockets).

---

## 4. Code & Data Mutation on Connection

When a valid connection is finalized:

### 4.1 Host Action Sequence
1. Webview sends IPC message:
   ```json
   {
     "command": "CONNECT_WIRE",
     "payload": {
       "fileUri": "file:///c:/path/to/main.js",
       "sourceTagId": "tag_out_123",
       "targetInputTagId": "tag_in_456"
     }
   }
   ```
2. Extension Host receives message and resolves both tags from `<filename>.json`.
3. Reads the latest live text of `sourceTag` from the document.
4. Performs an edit in the target document:
   ```javascript
   const targetRange = new vscode.Range(
     targetTag.range.startLine,
     targetTag.range.startCharacter,
     targetTag.range.endLine,
     targetTag.range.endCharacter
   );
   await editor.edit(editBuilder => {
     editBuilder.replace(targetRange, liveSourceText);
   });
   ```
5. Updates `targetTag` in `Visualizer/<filename>.json`:
   - `word`: `liveSourceText` (only the text value changes!)
   - `range.endCharacter`: `targetTag.range.startCharacter + liveSourceText.length`
   - `variableSubType`: remains `"Input"` (retains its Input socket and live input field)
   - `title` & `description`: preserved unchanged as originally authored
   *(Note: In Extension #1 Auzy-Keyword-Marker, wiring an input replaces the tag completely with the output tag. In Auzy-Components-View, only the text changes, keeping its Input tag appearance and metadata intact).*
6. Persists the JSON file to disk.
7. The visual cord remains visibly connected from the Output tag's port (`⭕` on the right) to the Input tag's socket (`⭕` on the left) across components.

---

## 5. Wire Persistence & Deletion

1. **Persistent Wire Tracking**:
   Wired connections are stored in the file's JSON or in a companion `wires.json` so that reopening the Node Editor reconstructs all active cords automatically.
2. **Deleting a Wire**:
   Clicking directly on an existing wire displays a small `(×)` delete badge. Clicking `(×)` severs the connection (leaving the current text intact or prompting to reset).

