# Components View Canvas Specification (Powered by Drawflow.js)

## 1. Canvas Engine: Why Drawflow.js

The Webview canvas is built using **Drawflow.js** (pure JavaScript node editor library). 
- **Native Draggable Nodes**: Smooth mouse dragging, viewport panning, and multi-level zoom.
- **Custom HTML Nodes**: Drawflow allows complete arbitrary HTML templates inside each node, enabling live `<input>` fields, buttons, dropdowns, and custom styling.
- **Dynamic Port Connections**: Built-in SVG bezier curve wires, snap-to-port mechanics, connection creation hooks (`connectionCreated`, `connectionRemoved`), and multi-port support.

---

## 2. Canvas Specifications & Controls

The Components View canvas is rendered inside a VS Code Webview as an infinite 2D pannable and zoomable workspace.

### 2.1 Canvas Viewport & Navigation
- **Background**: Subtle grid pattern (dots or crosshatch) styled via VS Code theme variables (`var(--vscode-editor-background)` and `rgba(255, 255, 255, 0.05)` or `rgba(0, 0, 0, 0.05)`).
- **Panning**:
  - Click and drag with mouse middle button.
  - Hold `Spacebar` + left-click and drag.
- **Zooming**:
  - Mouse scroll wheel zooms in and out (`minZoom: 0.25`, `maxZoom: 2.5`).
  - Zoom centers around mouse cursor position.
- **Minimap / Reset View**:
  - Top-right floating controls: `Zoom In (+)`, `Zoom Out (-)`, `Reset View (1:1)`, `Fit to All Nodes`.

---

## 2. Dynamic Component Node Sizing Algorithm

A node represents a block of code. Its visual dimensions inform the developer at a glance about the complexity and line count of the underlying implementation.

### 2.1 Sizing Constraints

```text
MIN_WIDTH:  220px      MAX_WIDTH:  500px
MIN_HEIGHT: 140px      MAX_HEIGHT: 650px
```

### 2.2 Dimensions Calculation Formula

```javascript
function calculateNodeDimensions(component, tags) {
  const lineCount = component.lineCount; // Lines of code inside markers
  const tagCount = tags.length;

  // Base sizing
  let width = 240;
  let height = 150;

  // Scale height based on lines of code (approx 12px per line)
  const lineContribution = lineCount * 12;
  // Scale height based on tag count (approx 36px per tag row)
  const tagContribution = tagCount * 36;

  height = Math.max(140, Math.min(650, 80 + Math.max(lineContribution, tagContribution)));

  // If node has tags with long titles or texts, widen the node
  let maxTagCharLength = 0;
  for (const t of tags) {
    const len = (t.title ? t.title.length : 0) + (t.word ? t.word.length : 0);
    if (len > maxTagCharLength) maxTagCharLength = len;
  }

  if (maxTagCharLength > 20) {
    width = Math.min(500, 240 + (maxTagCharLength - 20) * 8);
  }

  return { width, height };
}
```

---

## 3. Relative Tag Layout & Line Compaction Algorithm

Tags must appear on the node according to their **relative positions in the code**:
- If Tag A is on Line 5 and Tag B is on Line 25, Tag B appears lower than Tag A.
- If Tag A and Tag B are on the **same line** (e.g. Line 5), they appear on the **same horizontal line** on the node.
- **Line Compaction**: If there are many empty lines or lines with no tags (e.g. 50 lines between tags), an algorithm compresses empty gaps so tags do not overflow the node height or require vertical scrolling.

### 3.1 Relative Placement & Gap Compression Algorithm

```javascript
function layoutTagsOnNode(tags, nodeHeight, nodeWidth) {
  if (tags.length === 0) return [];

  // 1. Group tags by their starting line
  const lineGroups = new Map();
  for (const tag of tags) {
    const line = tag.range.startLine;
    if (!lineGroups.has(line)) lineGroups.set(line, []);
    lineGroups.get(line).push(tag);
  }

  // 2. Sort lines ascending
  const sortedLines = Array.from(lineGroups.keys()).sort((a, b) => a - b);

  // 3. Compress line gaps: if distance between consecutive tag lines > 3, clamp it
  const compressedSteps = [];
  let currentStep = 0;
  let prevLine = sortedLines[0];

  for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i];
    const lineGap = line - prevLine;
    // Compress gaps: maximum gap jump is 2 steps
    const stepIncrement = i === 0 ? 0 : Math.min(2, Math.max(1, lineGap));
    currentStep += stepIncrement;
    compressedSteps.push({ line, step: currentStep });
    prevLine = line;
  }

  const totalSteps = currentStep === 0 ? 1 : currentStep;
  const usableHeight = nodeHeight - 70; // Reserve 50px for header, 20px padding
  const verticalStepSize = usableHeight / (totalSteps + 1);

  // 4. Assign pixel coordinates to each tag
  const layoutedTags = [];
  for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i];
    const tagsOnLine = lineGroups.get(line);
    // Sort tags on the same line by character column
    tagsOnLine.sort((a, b) => a.range.startCharacter - b.range.startCharacter);

    const y = 50 + (compressedSteps[i].step + 0.5) * verticalStepSize;

    // Distribute tags horizontally across nodeWidth
    const count = tagsOnLine.length;
    tagsOnLine.forEach((tag, idx) => {
      const xPercent = (idx + 1) / (count + 1);
      const x = nodeWidth * xPercent;
      layoutedTags.push({
        tag,
        x,
        y,
        isSameLineGroup: count > 1
      });
    });
  }

  return layoutedTags;
}
```

---

## 4. Visual Tag Rendering Specification

Every tag inside a component is color-coded to match the code editor's decorations:

| Category / Subtype | Visual Background Color | Border / Accent Style | Sockets / Controls |
| :--- | :--- | :--- | :--- |
| **`variable:Input`** | `rgba(180, 190, 205, 0.15)` | `1px dashed rgba(160, 175, 195, 0.7)` | Left socket: `⭕` (Input Port) |
| **`variable:Output`** | `rgba(46, 204, 113, 0.35)` | `1px solid rgba(46, 204, 113, 0.85)` | Right socket: `⭕` (Output Port) |
| **`variable:Default`**| `rgba(243, 156, 18, 0.38)` | `1px solid rgba(230, 126, 34, 0.95)` | Dropdown: `↓`, Right socket: `⭕` |
| **`tut-tag`** | `rgba(233, 30, 99, 0.35)` | `1px solid rgba(233, 30, 99, 0.85)` | Clickable link text + `?` info |
| **`function`** | `rgba(155, 89, 182, 0.35)` | `1px solid rgba(155, 89, 182, 0.85)` | Info badge |

---

## 5. Interactive Tag Elements

### 5.1 Input Tag: `⭕ <Text> ?`
```html
<div class="tag-row tag-input" data-tag-id="tag_123">
  <!-- Left port socket for incoming wires -->
  <div class="socket socket-input" title="Connect wire here">⭕</div>
  <!-- Editable text field -->
  <input type="text" class="tag-live-input" value="userInput" />
  <!-- Tooltip/details icon -->
  <span class="icon-info" title="Click to view Title & Description">?</span>
</div>
```
- **Live Text Editing**: When the user edits the `<input>` text and presses `Enter` or blurs the input:
  1. The Webview sends `UPDATE_INPUT_TEXT` to the Extension Host.
  2. The Host replaces the token in the source code.
  3. The Host updates `tag.word` in `Visualizer/<filename>.json`.

### 5.2 Output Tag: `<Title> <Text> ? ⭕`
```html
<div class="tag-row tag-output" data-tag-id="tag_456">
  <span class="tag-title">Cleaned Data</span>
  <span class="tag-word">sanitizedResponse</span>
  <span class="icon-info" title="Click to view Title & Description">?</span>
  <!-- Right port socket to pull a wire from -->
  <div class="socket socket-output" title="Drag wire to an Input port">⭕</div>
</div>
```

### 5.3 Default Tag: `<Text> ↓ ? ⭕`
```html
<div class="tag-row tag-default" data-tag-id="tag_789">
  <span class="tag-word">maxRetries</span>
  <button class="btn-dropdown" title="Select default value">↓</button>
  <span class="icon-info" title="Click to view Title & Description">?</span>
  <div class="socket socket-output" title="Drag wire to an Input port">⭕</div>
</div>
```
- Clicking `↓` reveals a floating menu with `defaultValues` (e.g. `['3', '5', '10']`).
- Selecting a value replaces the word in code and updates the tag.

### 5.4 Tut-Tag: `<Text> ?`
```html
<div class="tag-row tag-tuttag" data-tag-id="tag_999">
  <span class="tag-word tut-link" title="Click to open interactive tutorial">setupDatabase</span>
  <span class="icon-info" title="Click to view Title & Description">?</span>
</div>
```
- Clicking the `.tut-link` text opens the **Tutorial Viewer Modal** on the canvas, rendering the tutorial's note cards, code blocks (syntax-styled), images, and links.
- Clicking `?` displays the tag's Title and Description note.
