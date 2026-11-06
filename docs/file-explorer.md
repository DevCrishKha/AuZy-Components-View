# File Explorer Section Specification & Implementation

## Overview
The **File Explorer** is an interactive navigation component situated directly below the `'🏠 Workspace'` breadcrumb section in the Auzy Components View canvas. It provides quick access to all workspace files, folders, and component counts, maintaining synchronized two-way focus with the canvas.

## Features

1. **Collapsible & Expandable**
   - Click the header or the `—`/`＋` toggle button to expand or collapse the explorer.
   - When collapsed, it forms a sleek pill display showing the current focused file or folder path without obstructing canvas navigation.
   - Click the `⇲` button in the header to collapse all expanded folder branches at once.

2. **Hierarchical Workspace Tree**
   - Interactive tree view displaying the `Workspace Root`, nested folders, and code files.
   - Folder branches expand and collapse independently using the `▶`/`▼` chevrons.
   - Badges indicate the number of child files per folder and component blocks per file.

3. **Two-Way Synchronization with Canvas**
   - **Canvas to Explorer**: Focusing or clicking any `FileNode`, `FolderNode`, or `ComponentNode` on the canvas:
     - Automatically updates the path display bar (`📍 <relPath>`).
     - Auto-expands ancestor folders in the tree.
     - Highlights the active file or folder row with `.active`.
     - Smoothly scrolls the active row into view.
     - Adds `.selected` border and glow to the canvas node.
   - **Explorer to Canvas**:
     - Selecting any file row opens that `FileNode` in full focus mode on the canvas (`setScope("file", file.relPath)`).
     - Selecting any folder row opens that `FolderNode` in folder view on the canvas (`setScope("folder", folder.relPath)`).
     - Selecting `Workspace Root` returns to the workspace overview (`setScope("root", "")`).

## Files Modified
- [`src/webviewPanelManager.js`](file:///c:/Users/User/Desktop/VSCode_Extension/Auzy-Components-View/src/webviewPanelManager.js): Added `#file-explorer` DOM markup beneath `#top-nav`.
- [`media/main.css`](file:///c:/Users/User/Desktop/VSCode_Extension/Auzy-Components-View/media/main.css): Implemented Blender Blueprint dark theme styles for `#file-explorer`, headers, toggle controls, path bar, tree rows, and custom scrollbars.
- [`media/main.js`](file:///c:/Users/User/Desktop/VSCode_Extension/Auzy-Components-View/media/main.js): Implemented tree construction, folder branch toggle, focus tracking, two-way canvas scope synchronization, and selection highlights.

