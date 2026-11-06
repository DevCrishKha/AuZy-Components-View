# Requirements Specification: Auzy-Components-View

## 1. Project Background & Objective

The goal of this extension is to provide a visual, node-based programming and code navigation environment directly within Visual Studio Code using **Drawflow.js**. Rather than editing code solely as textual script, users can view functional blocks as visual components (nodes) on a canvas, wire inputs to outputs using interactive cords, inspect tutorials, select default values from dropdowns, and drag-and-drop reusable pre-built components from a language library palette.

The extension works hand-in-hand with the **Auzy-Keyword-Marker Extension (Extension #1)**. Both extensions share data through the filesystem via:
1. The raw source code files in the workspace.
2. The tag metadata files in `<workspace>/external-vscode-extension/Visualizer/<filename>.json`.

---

## 2. User Journey & Core Workflows

### 2.1 Launching the Components View
1. The user opens a project folder in VS Code.
2. On VS Code's bottom Status Bar, an icon appears: `$(circuit-board) Auzy: Components View`.
3. Clicking this icon opens the Components View as a full editor tab (custom Webview powered by Drawflow.js) adjacent to or replacing the current editor.
4. The canvas displays the visual components detected in the currently active source file.

### 2.2 Viewing Components in Code
1. Any code enclosed within marker comments:
   ```text
   <{<< Component-Name >>}>
   ... code ...
   </{<< Component-Name >>}>
   ```
   is rendered on the canvas as a **Component Node**.
2. If multiple components exist in the file, each is rendered as an independent node on the 2D canvas.
3. The node displays a title header with `Component-Name`.
4. The size of the component node dynamically reflects the amount of code inside it (lines and tag density), bounded between a minimum and maximum size.

### 2.3 Visual Tag Representation on Nodes
Tags marked in the source file (stored in the companion Visualizer JSON) are placed inside the component:
- **Input Tags**:
  - Rendered as: `⭕ <Text> ?`
  - Sockets (`⭕`) appear on the left border.
  - The text `<Text>` is editable directly in the node. Typing a new value updates the source code!
  - Clicking `?` opens a tooltip/card with Title and Description.
- **Output Tags**:
  - Rendered as: `<Text> ? ⭕`
  - Sockets (`⭕`) appear on the right border.
  - Clicking and dragging from `⭕` pulls out an interactive connecting cord.
  - Clicking `?` opens a tooltip/card with Title and Description.
- **Default Tags**:
  - Rendered as: `<Text> ↓ ? ⭕`
  - Clicking `↓` opens a floating dropdown with configured default values. Selecting a value replaces `<Text>` in the code immediately.
  - Clicking and dragging from `⭕` pulls out a connecting cord that can be plugged into an Input tag.
- **Tut-Tags (Tutorials)**:
  - Rendered as: `<Text> ?`
  - Clicking the highlighted text opens the interactive tutorial viewer modal on the canvas.
  - Clicking `?` shows the tutorial Title and Description.

### 2.4 Drag-and-Drop Scaffolding from the Component Palette
1. The canvas includes a collapsible sidebar **Component Palette**.
2. The palette lists available components categorized by programming language (JavaScript, Python, TypeScript, etc.).
3. The user configures one or more source folder paths per language (via an Add/Remove folder UI). The paths are saved in `external-vscode-extension/Visualizer/sources.json`.
4. Clicking a **Refresh** button rescans the folders and populates the palette with all components found in those files.
5. The user drags a component from the palette and drops it onto the canvas.
6. The extension automatically:
   - Appends the component's underlying source code (with marker comments) into the active file.
   - Imports all associated tags into `external-vscode-extension/Visualizer/<filename>.json` with recalculated line offsets.
   - Instantly renders the new node on the canvas.

### 2.5 Visual Wiring via Connecting Cords
1. The user clicks on the `⭕` output port of an Output or Default tag.
2. A curved bezier wire (cord) extends from the socket and follows the mouse cursor.
3. Hovering over an `⭕` input port highlights it.
4. Releasing or clicking on the input socket connects the wire.
5. Upon connection:
   - The Input tag's text in the source code is replaced with the Output/Default tag's live text.
   - **In Auzy-Components-View**: The Input tag remains an Input tag (its Title, description, and visual styling remain intact), and only its text value (`word`) and end coordinate change in the JSON file. (Note: In Extension #1 Auzy-Keyword-Marker, wiring an input replaces it completely with the output tag).
   - The visual cord remains visibly connected between the Output tag's port and the Input tag's port across components.

---

## 3. Detailed Functional Requirements

| ID | Requirement Area | Specification Description |
| :--- | :--- | :--- |
| **REQ-1** | Status Bar Activation | A Status Bar item `$(circuit-board) Auzy: Components View` must always be visible when a supported workspace is open. Clicking it opens or focuses the Components View Webview panel. |
| **REQ-2** | Active File Sync | The Node-Editor displays components for the currently active code file. Switching active editor tabs or opening a file switches or prompts the canvas to load that file's components. |
| **REQ-3** | Marker Comment Detection | The parser must identify `<{<< ID >>}>` start tags and `</{<< ID >>}>` end tags across all languages, tolerating language-specific comment characters (`//`, `#`, `/* */`, `<!-- -->`). |
| **REQ-4** | Dynamic Node Sizing | Sizing algorithm with minimum bounds (e.g. 180x120px) and maximum bounds (e.g. 500x600px). Height scales with lines of code and tag count. |
| **REQ-5** | Relative Tag Layout | Tags inside the node are placed vertically and horizontally relative to their actual line numbers and character positions in the code, with an empty-space compression algorithm to avoid excess spacing. |
| **REQ-6** | In-Node Input Text Edit | Input tags render an inline text input. Modifying this text updates the underlying source code file and the tag's `word` entry in the Visualizer JSON. |
| **REQ-7** | Default Tag Selector & Propagation | Default tags render an inline text input and a dropdown button `↓`. Modifying the text via typing or selecting from `defaultValues` applies the new token to source code and metadata. If the Default tag is connected to an Input tag via a wire, the connected Input tag's text is automatically updated in code and metadata. |
| **REQ-8** | Interactive Tutorial Viewer | Clicking a Tut-Tag on a node displays an overlay dialog rendering the embedded tutorial elements (text cards, code snippets with syntax styling, links, images). |
| **REQ-9** | Wiring Engine | Output and Default tags feature draggable cord sockets (`⭕`). Connecting to an Input socket updates the code token, preserves the Input tag's identity and metadata, and draws a permanent SVG bezier curve connecting the ports. |
| **REQ-10**| Palette Scaffolding | Sidebar palette organized by language. Scans configured folders for `<{<< Component >>}>` blocks and renders preview chips. |
| **REQ-11**| Folder Configuration UI | Modal or panel to add/remove folder directories per language. Persists settings in `external-vscode-extension/Visualizer/sources.json`. |
| **REQ-12**| Drag & Drop Insertion | Dragging a palette component onto the canvas appends the code to the document, shifts tags, writes to Visualizer JSON, and spawns the node. |
| **REQ-13**| File-Based State Decoupling| All state exchanges must occur via disk files and standard VS Code document events. No in-memory coupling with other extensions. |
| **REQ-14**| Wire Integrity Check on Canvas Refresh | Every time the canvas refreshes, the system checks whether the text inside connected tags (Input-to-Output or Input-to-Default) are identical. If the connected tags' text differs, the connection is automatically severed and removed from workspace and file metadata. Unconnected tags are not affected. |

---

## 4. Non-Functional Requirements

1. **Performance**: Parsing files and rendering up to 50 nodes and 200 tags must occur in under 300ms.
2. **Theme Adaptability**: Canvas background, nodes, fonts, and borders must strictly leverage VS Code CSS variables (`var(--vscode-editor-background)`, `var(--vscode-editor-foreground)`, `var(--vscode-button-background)`, etc.).
3. **Data Integrity**: Writing to source code files and JSON files must be atomic and safe against concurrent edits.
4. **Boundary Robustness**: Marker comments nested within strings or invalidly unclosed marker comments must be handled gracefully without crashing.

