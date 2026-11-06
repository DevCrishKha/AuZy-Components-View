```C
© Copyright [2026] [Dev Crish Kha]
```
# Auzy: Components View (VS Code Extension #2 in AuZy Toolkit)

An interactive, visual, node-based programming and multi-file code navigation environment powered by Drawflow.js and embedded directly inside Visual Studio Code.

---

## 🌟 Key Features

1. **Multi-File & Recursive Folder Hierarchy on One Infinite Canvas**:
   - **`FolderNode`**: Elegant frosted glass container (`📁`) representing directories. Nested subfolders and files appear inside. Can be expanded/collapsed or opened in full canvas mode.
   - **`FileNode`**: Sleek glassmorphic container (`📄`) grouping all component blocks inside that file.
   - **`ComponentNode`**: Visual block representing source code enclosed by `<{<< Component-Name >>}> ... </{<< Component-Name >>}>`.
2. **Interactive Zoomable World & Scope Drill-Down ("Open as Canvas")**:
   - Infinite 2D pannable and zoomable workspace (`0.15x` to `2.5x`).
   - Click **`⛶ Focus`** on any `FolderNode` or `FileNode` to open it as the whole canvas!
   - Sleek breadcrumb bar at the top (`🏠 Workspace > 📁 Backend > 📄 app.py`) allows instant 1-click navigation between scope levels.
3. **Draggable Nodes with Cross-Session Persistence**:
   - Drag FolderNodes, FileNodes, and ComponentNodes freely on the canvas.
   - All positions, dimensions, and viewport zoom/pan coordinates are automatically saved to `<workspace>/external-vscode-extension/Visualizer/workspace-layout.json` and persist across VS Code restarts!
4. **Interactive Wirable Ports & Live Tokens**:
   - **Input Tags**: Rendered as `⭕ <Text> ?`. Editable in real time inside the node; modifying text updates the source code file and tag metadata.
   - **Output Tags**: Rendered as `<Text> ? ⭕` (*No Title*). Sockets pull interactive cubic bezier cords.
   - **Default Tags**: Rendered as `<Text> ↓ ? ⭕`. Clicking `↓` reveals a floating menu with preset values.
   - **Tut-Tags**: Rendered as `<Text> ?`. Clicking link text opens a tutorial dialog on canvas.
   - **Component Wiring Mechanics**: In Auzy-Components-View, wiring an Output/Default tag to an Input tag updates *only* the Input tag's text value (in code and JSON). The tag remains an Input tag, preserving its Title, description, and visual socket. The connecting wire remains visibly attached between both ports across components. (Note: Extension #1 Auzy-Keyword-Marker replaces the tag entirely).
5. **Component Palette Scaffolding**:
   - Palette sidebar categorized by language, populated dynamically by scanning paths in `sources.json`.
   - Dragging a component chip into a file injects wrapped code and imports tags with adjusted line offsets.
6. **Strictly Decoupled Filesystem Architecture**:
   - Zero in-memory coupling with Extension #1 (Auzy-Keyword-Marker). All data is exchanged via the filesystem (`external-vscode-extension/Visualizer/<relative-path>.json`).

---

## 🚀 Getting Started

### 1. Running the Extension in VS Code
1. Open this repository in VS Code.
2. Press `F5` to start debugging with the Extension Development Host.
3. In the new VS Code window, open any workspace folder (e.g. `example/`).
4. Click the **`$(circuit-board) Auzy: Components View`** button on the bottom status bar, or open the Command Palette (`Ctrl+Shift+P`) and run:
   ```text
   Auzy: Open Components View
   ```

### 2. Available Commands
- `Auzy: Open Components View` (`auzyComponentsView.openView`)
- `Auzy: Refresh Components Canvas` (`auzyComponentsView.refreshCanvas`)
- `Auzy: Reset Canvas Layout` (`auzyComponentsView.resetLayout`)

### 3. Running Unit Tests
Tests are implemented in pure JavaScript using Node's native test runner:
```bash
npm test
```

---
