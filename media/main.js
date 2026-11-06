/**
 * @file main.js
 * Frontend controller for Auzy-Components-View Webview canvas.
 * Handles infinite zoom/pan, hierarchical Folder/File/Component nodes,
 * persistent layout state, interactive bezier wires, in-node tag editing,
 * and scope drill-down navigation.
 */

(function () {
  // Obtain VS Code API
  const vscode =
    typeof acquireVsCodeApi === "function"
      ? acquireVsCodeApi()
      : {
          postMessage: (msg) => console.log("[VSCode IPC]", msg),
          getState: () => null,
          setState: () => {},
        };

  // State
  let workspaceData = null;
  let paletteLibraries = [];
  let viewTransform = { x: 40, y: 40, zoom: 1.0 };
  let activeScope = { type: "root", path: "" }; // 'root', 'folder', or 'file'
  let activeWireDrag = null; // { sourceTagId, sourceNodeId, startX, startY, sourceFile }
  let activeDropdown = null;
  let selectedComp = null; // { comp, file, element }
  let saveLayoutDebounceTimer = null;
  let isDraggingAnyNode = false; // Global flag to suppress re-renders during drag

  // File Explorer state
  let explorerCollapsed = false; // whether the whole panel is collapsed
  let explorerFolderOpenState = {}; // relPath -> boolean (open/closed in tree)
  let explorerFocusedNode = { type: "root", path: "" }; // currently highlighted node

  // DOM Elements
  const container = document.getElementById("canvas-container");
  const world = document.getElementById("world");
  const wiresLayer = document.getElementById("wires-layer");
  const nodesContainer = document.getElementById("nodes-container") || world;
  const topNav = document.getElementById("top-nav");
  const paletteDrawer = document.getElementById("palette-drawer");
  const paletteTabs = document.getElementById("palette-tabs");
  const paletteContent = document.getElementById("palette-content");
  const modalContainer = document.getElementById("modal-container");
  const floatingContainer = document.getElementById("floating-container");

  // File Explorer DOM refs (resolved after DOMContentLoaded)
  let explorerPanel = null;
  let explorerToggleBtn = null;
  let explorerCollapseAllBtn = null;
  let explorerChevron = null;
  let explorerBody = null;
  let explorerTree = null;
  let explorerPathText = null;
  let explorerFocusedPathEl = null;

  // ==========================================================================
  // Initialization & IPC Bridge
  // ==========================================================================

  window.addEventListener("DOMContentLoaded", () => {
    // Resolve file-explorer DOM refs
    explorerPanel = document.getElementById("file-explorer");
    explorerToggleBtn = document.getElementById("explorer-toggle");
    explorerCollapseAllBtn = document.getElementById("explorer-collapse-all");
    explorerChevron = document.getElementById("explorer-chevron");
    explorerBody = document.getElementById("explorer-body");
    explorerTree = document.getElementById("explorer-tree");
    explorerPathText = document.getElementById("explorer-path-text");
    explorerFocusedPathEl = document.getElementById("explorer-focused-path");

    initCanvasNavigation();
    initToolbarControls();
    initKeyboardShortcuts();
    initFileExplorerControls();
    vscode.postMessage({ command: "REQUEST_INIT" });
  });

  function initKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedComp) {
        // Do not trigger deletion if user is typing in an input field
        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (tagName === "input" || tagName === "textarea") return;

        deleteSelectedComponent();
      }
    });
  }

  function deleteSelectedComponent() {
    if (!selectedComp) return;
    const { comp, file } = selectedComp;
    vscode.postMessage({
      command: "DELETE_COMPONENT",
      payload: {
        fileRelPath: file.relPath,
        compName: comp.name,
        layout: buildLayoutData(),
      },
    });
    selectedComp = null;
  }

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.command) {
      case "LOAD_WORKSPACE_DATA":
        // Suppress re-renders while dragging a node to prevent snap-back
        if (isDraggingAnyNode) break;
        workspaceData = message.payload;
        if (workspaceData.viewport) {
          viewTransform = { ...workspaceData.viewport };
        }
        if (workspaceData.savedScope) {
          activeScope = { ...workspaceData.savedScope };
        }
        setExplorerFocus(activeScope.type, activeScope.path);
        renderCanvas();
        updateTransform();
        renderBreadcrumbs();
        renderFileExplorer();
        break;

      case "UPDATE_PALETTE":
        paletteLibraries = message.payload.libraries || [];
        renderPalette();
        break;

      case "REFRESH_WORKSPACE":
      case "WIRE_CONNECTED":
      case "TAG_UPDATED":
        // Suppress refresh while dragging to prevent snap-back
        if (isDraggingAnyNode) break;
        vscode.postMessage({ command: "REFRESH_WORKSPACE" });
        break;

      case "SHOW_ERROR":
        showToast(message.payload.message || "An error occurred", "error");
        break;
    }
  });

  // ==========================================================================
  // Canvas Viewport Pan & Zoom Engine
  // ==========================================================================

  function initCanvasNavigation() {
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    container.addEventListener("mousedown", (e) => {
      // Middle click or (Left click with Spacebar or clicking empty canvas)
      if (
        e.button === 1 ||
        (e.button === 0 &&
          (e.spaceKey ||
            e.target === container ||
            e.target === world ||
            e.target === wiresLayer))
      ) {
        isPanning = true;
        startX = e.clientX - viewTransform.x;
        startY = e.clientY - viewTransform.y;
        container.classList.add("panning");
        e.preventDefault();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (isPanning) {
        viewTransform.x = e.clientX - startX;
        viewTransform.y = e.clientY - startY;
        updateTransform();
        scheduleSaveLayout();
      } else if (activeWireDrag) {
        updateActiveWirePath(e.clientX, e.clientY);
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (isPanning) {
        isPanning = false;
        container.classList.remove("panning");
      }
      if (activeWireDrag && e.target.classList.contains("socket-input")) {
        // Socket connection handled in socket mouseup listener
      } else if (activeWireDrag) {
        cancelActiveWire();
      }
    });

    // Zoom on wheel
    container.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoomFactor = 1.12;
        const oldZoom = viewTransform.zoom;
        let newZoom =
          e.deltaY < 0 ? oldZoom * zoomFactor : oldZoom / zoomFactor;

        // Clamp zoom between 0.15x and 2.5x
        newZoom = Math.max(0.15, Math.min(2.5, newZoom));

        // Zoom toward cursor
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        viewTransform.x =
          mouseX - (mouseX - viewTransform.x) * (newZoom / oldZoom);
        viewTransform.y =
          mouseY - (mouseY - viewTransform.y) * (newZoom / oldZoom);
        viewTransform.zoom = newZoom;

        updateTransform();
        scheduleSaveLayout();
      },
      { passive: false },
    );
  }

  function updateTransform() {
    world.style.transform = `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.zoom})`;
  }

  function screenToWorld(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewTransform.x) / viewTransform.zoom,
      y: (clientY - rect.top - viewTransform.y) / viewTransform.zoom,
    };
  }

  // ==========================================================================
  // Layout Persistence Bridge
  // ==========================================================================

  /**
   * Builds the current layout data snapshot from in-memory state and DOM.
   * @returns {Object|null}
   */
  function buildLayoutData() {
    if (!workspaceData) return null;

    const allWires = [];
    for (const file of workspaceData.files || []) {
      for (const w of file.wires || []) {
        allWires.push(w);
      }
    }

    const layoutData = {
      viewport: { ...viewTransform },
      scope: { ...activeScope },
      folders: {},
      files: {},
      components: {},
      wires: allWires,
    };

    for (const folder of workspaceData.folders || []) {
      const folderEl = document.getElementById(folder.id);
      const domX = folderEl ? parseFloat(folderEl.style.left) : NaN;
      const domY = folderEl ? parseFloat(folderEl.style.top) : NaN;
      layoutData.folders[folder.relPath] = {
        x: !isNaN(domX) ? domX : folder.x || 60,
        y: !isNaN(domY) ? domY : folder.y || 60,
        width: folder.width,
        height: folder.height,
        isCollapsed: !!folder.isCollapsed,
      };
    }

    for (const file of workspaceData.files || []) {
      const fileEl = document.getElementById(file.id);
      const domX = fileEl ? parseFloat(fileEl.style.left) : NaN;
      const domY = fileEl ? parseFloat(fileEl.style.top) : NaN;
      layoutData.files[file.relPath] = {
        x: !isNaN(domX) ? domX : file.x || 80,
        y: !isNaN(domY) ? domY : file.y || 80,
        width: file.width,
        height: file.height,
        isCollapsed: !!file.isCollapsed,
      };

      // Extract components directly from file.components (where live drag updates occur)
      for (const comp of file.components || []) {
        if (comp.compKey) {
          const compEl = document.getElementById(comp.id);
          const compDomX = compEl ? parseFloat(compEl.style.left) : NaN;
          const compDomY = compEl ? parseFloat(compEl.style.top) : NaN;
          layoutData.components[comp.compKey] = {
            x: !isNaN(compDomX) ? compDomX : comp.x || 30,
            y: !isNaN(compDomY) ? compDomY : comp.y || 60,
          };
        }
      }
    }

    // Fallback: also include any components from workspaceData.components if not in files
    for (const comp of workspaceData.components || []) {
      if (comp.compKey && !layoutData.components[comp.compKey]) {
        layoutData.components[comp.compKey] = {
          x: comp.x || 30,
          y: comp.y || 60,
        };
      }
    }

    return layoutData;
  }

  /**
   * Debounced layout save — used during continuous operations like dragging and panning.
   */
  function scheduleSaveLayout() {
    if (saveLayoutDebounceTimer) clearTimeout(saveLayoutDebounceTimer);
    saveLayoutDebounceTimer = setTimeout(() => {
      const layoutData = buildLayoutData();
      if (layoutData) {
        vscode.postMessage({ command: "SAVE_LAYOUT", payload: layoutData });
      }
    }, 400);
  }

  /**
   * Immediately flushes the current layout to disk (cancels any pending debounce).
   * Call this BEFORE sending any command that will trigger a full canvas refresh
   * (CONNECT_WIRE, DISCONNECT_WIRE, DELETE_COMPONENT, etc.) so that the refreshed
   * workspace re-reads the latest positions from disk.
   */
  function flushLayoutSave() {
    if (saveLayoutDebounceTimer) {
      clearTimeout(saveLayoutDebounceTimer);
      saveLayoutDebounceTimer = null;
    }
    const layoutData = buildLayoutData();
    if (layoutData) {
      vscode.postMessage({ command: "SAVE_LAYOUT", payload: layoutData });
    }
  }

  // ==========================================================================
  // Canvas Rendering (FolderNodes, FileNodes, ComponentNodes)
  // ==========================================================================

  function renderCanvas() {
    if (!workspaceData) return;
    nodesContainer.innerHTML = "";
    wiresLayer.querySelectorAll(".wire-path").forEach((p) => p.remove());

    // Determine what to display based on activeScope
    if (activeScope.type === "file") {
      renderFileScope(activeScope.path);
    } else if (activeScope.type === "folder") {
      renderFolderScope(activeScope.path);
    } else {
      renderRootScope();
    }

    renderAllWires();
    updateCanvasSelection();
  }

  /**
   * Renders the complete workspace root view.
   */
  function renderRootScope() {
    // 1. Render all top-level folders
    const rootFolders = (workspaceData.folders || []).filter(
      (f) => !f.parentRelPath,
    );
    for (const folder of rootFolders) {
      renderFolderNode(folder);
    }

    // 2. Render all root-level files (files not belonging to any folder)
    const rootFiles = (workspaceData.files || []).filter(
      (f) => !f.folderRelPath,
    );
    for (const file of rootFiles) {
      renderFileNode(file, nodesContainer);
    }
  }

  /**
   * Renders a focused folder as the entire canvas.
   */
  function renderFolderScope(folderRelPath) {
    const folder = (workspaceData.folders || []).find(
      (f) => f.relPath === folderRelPath,
    );
    if (!folder) {
      activeScope = { type: "root", path: "" };
      renderRootScope();
      return;
    }

    // Render subfolders of this folder
    const subfolders = (workspaceData.folders || []).filter(
      (f) => f.parentRelPath === folderRelPath,
    );
    for (const sub of subfolders) {
      renderFolderNode(sub);
    }

    // Render files inside this folder
    const files = (workspaceData.files || []).filter(
      (f) => f.folderRelPath === folderRelPath,
    );
    for (const file of files) {
      renderFileNode(file, nodesContainer);
    }
  }

  /**
   * Renders a single focused file as the entire canvas.
   */
  function renderFileScope(fileRelPath) {
    const file = (workspaceData.files || []).find(
      (f) => f.relPath === fileRelPath,
    );
    if (!file) {
      activeScope = { type: "root", path: "" };
      renderRootScope();
      return;
    }

    // Render this file node expanded at (60, 60)
    renderFileNode(file, nodesContainer, true);
  }

  // ==========================================================================
  // FolderNode Rendering
  // ==========================================================================

  function renderFolderNode(folder) {
    const el = document.createElement("div");
    el.className = `folder-node ${folder.isCollapsed ? "collapsed" : ""}`;
    el.id = folder.id;
    el.dataset.folderRel = folder.relPath;
    el.style.left = `${folder.x || 60}px`;
    el.style.top = `${folder.y || 60}px`;
    el.style.width = `${folder.width || 640}px`;
    el.style.height = folder.isCollapsed ? "48px" : `${folder.height || 480}px`;

    // Folder Header
    const header = document.createElement("div");
    header.className = "folder-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "folder-title-wrap";
    titleWrap.innerHTML = `
      <span class="folder-icon">📁</span>
      <span class="folder-name">${escapeHtml(folder.name)}</span>
      <span class="folder-badge">${folder.files.length} files</span>
    `;

    const actions = document.createElement("div");
    actions.className = "folder-actions";

    // Open as Canvas Button (Focus Mode)
    const btnFocus = document.createElement("button");
    btnFocus.className = "btn-node-action";
    btnFocus.title = "Open folder as the whole canvas";
    btnFocus.innerHTML = "⛶ Focus";
    btnFocus.onclick = (e) => {
      e.stopPropagation();
      setScope("folder", folder.relPath);
    };

    // Expand / Collapse Toggle
    const btnToggle = document.createElement("button");
    btnToggle.className = "btn-node-action";
    btnToggle.title = folder.isCollapsed ? "Expand folder" : "Collapse folder";
    btnToggle.innerHTML = folder.isCollapsed ? "＋" : "—";
    btnToggle.onclick = (e) => {
      e.stopPropagation();
      folder.isCollapsed = !folder.isCollapsed;
      renderCanvas();
      scheduleSaveLayout();
    };

    actions.appendChild(btnFocus);
    actions.appendChild(btnToggle);

    header.appendChild(titleWrap);
    header.appendChild(actions);
    el.appendChild(header);

    // Make FolderNode draggable
    makeDraggable(el, header, (dx, dy) => {
      folder.x = (folder.x || 60) + dx;
      folder.y = (folder.y || 60) + dy;
      el.style.left = `${folder.x}px`;
      el.style.top = `${folder.y}px`;
      renderAllWires();
      scheduleSaveLayout();
    });

    // Click on folder body/header (not on buttons) to focus in File Explorer
    el.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      setExplorerFocus("folder", folder.relPath);
    });

    // Folder Body (Nested Files & Subfolders)
    if (!folder.isCollapsed) {
      const body = document.createElement("div");
      body.className = "folder-body";

      // Render nested files inside folder
      const folderFiles = (workspaceData.files || []).filter(
        (f) => f.folderRelPath === folder.relPath,
      );
      for (const file of folderFiles) {
        renderFileNode(file, body);
      }

      // Render nested subfolders
      const subfolders = (workspaceData.folders || []).filter(
        (f) => f.parentRelPath === folder.relPath,
      );
      for (const sub of subfolders) {
        renderFolderNode(sub);
      }

      el.appendChild(body);
    }

    nodesContainer.appendChild(el);
  }

  // ==========================================================================
  // FileNode Rendering (Glassmorphic Container for Components)
  // ==========================================================================

  function renderFileNode(file, parentEl, isFullScreenScope = false) {
    const el = document.createElement("div");
    el.className = `file-node ${file.isCollapsed ? "collapsed" : ""}`;
    el.id = file.id;
    el.dataset.fileRel = file.relPath;

    const posX = isFullScreenScope ? 60 : file.x || 80;
    const posY = isFullScreenScope ? 60 : file.y || 80;
    const width = isFullScreenScope
      ? Math.max(900, file.width || 600)
      : file.width || 340;
    const height = isFullScreenScope
      ? Math.max(700, file.height || 450)
      : file.isCollapsed
        ? 34
        : file.height || 300;

    el.style.left = `${posX}px`;
    el.style.top = `${posY}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;

    // File Header
    const header = document.createElement("div");
    header.className = "file-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "file-title-wrap";
    titleWrap.innerHTML = `
      <span class="file-icon">📄</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-badge">${file.components.length} components</span>
    `;

    const actions = document.createElement("div");
    actions.className = "file-actions";

    // Open in Editor Button
    const btnOpenEditor = document.createElement("button");
    btnOpenEditor.className = "btn-node-action";
    btnOpenEditor.title = "Open in VS Code text editor";
    btnOpenEditor.innerHTML = "✎ Edit";
    btnOpenEditor.onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({
        command: "OPEN_FILE_IN_EDITOR",
        payload: { fileRelPath: file.relPath },
      });
    };

    // Open as Canvas Button (Focus Mode)
    const btnFocus = document.createElement("button");
    btnFocus.className = "btn-node-action";
    btnFocus.title = "Open file as the whole canvas";
    btnFocus.innerHTML = "⛶ Focus";
    btnFocus.onclick = (e) => {
      e.stopPropagation();
      setScope("file", file.relPath);
    };

    // Expand / Collapse Toggle
    const btnToggle = document.createElement("button");
    btnToggle.className = "btn-node-action";
    btnToggle.title = file.isCollapsed ? "Expand file" : "Collapse file";
    btnToggle.innerHTML = file.isCollapsed ? "＋" : "—";
    btnToggle.onclick = (e) => {
      e.stopPropagation();
      file.isCollapsed = !file.isCollapsed;
      renderCanvas();
      scheduleSaveLayout();
    };

    actions.appendChild(btnOpenEditor);
    if (!isFullScreenScope) {
      actions.appendChild(btnFocus);
    }
    actions.appendChild(btnToggle);

    header.appendChild(titleWrap);
    header.appendChild(actions);
    el.appendChild(header);

    // Make FileNode draggable
    makeDraggable(el, header, (dx, dy) => {
      file.x = (file.x || 80) + dx;
      file.y = (file.y || 80) + dy;
      el.style.left = `${file.x}px`;
      el.style.top = `${file.y}px`;
      renderAllWires();
      scheduleSaveLayout();
    });

    // Click on file node (not on buttons/inputs) to focus in File Explorer
    el.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      setExplorerFocus("file", file.relPath);
    });

    // File Body (Components)
    if (!file.isCollapsed) {
      const body = document.createElement("div");
      body.className = "file-body";

      if (file.components.length === 0) {
        body.innerHTML = `
          <div class="comp-empty-msg">
            No &lt;{&lt;&lt; Component &gt;&gt;}&gt; marker blocks in this file yet.<br/>
            Drag pre-built components from the Palette sidebar to insert!
          </div>
        `;
      } else {
        for (const comp of file.components) {
          renderComponentNode(comp, body, file);
        }
      }

      el.appendChild(body);
    }

    parentEl.appendChild(el);
  }

  // ==========================================================================
  // ComponentNode Rendering & Tag Layout
  // ==========================================================================

  function renderComponentNode(comp, parentEl, file) {
    const el = document.createElement("div");
    el.className = "comp-node";
    el.id = comp.id;
    el.style.left = `${comp.x || 30}px`;
    el.style.top = `${comp.y || 60}px`;
    el.style.width = `${comp.width || 240}px`;
    el.style.height = `${comp.height || 160}px`;

    // Header
    const header = document.createElement("div");
    header.className = "comp-header";
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
        <span class="comp-title" title="${escapeHtml(comp.name)}">${escapeHtml(comp.name)}</span>
        <span class="comp-meta">${comp.lineCount} lines</span>
      </div>
      <button class="comp-delete-btn" title="Delete component and code from file">🗑️</button>
    `;

    // Click trash button to delete component
    header.querySelector(".comp-delete-btn").onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({
        command: "DELETE_COMPONENT",
        payload: {
          fileRelPath: file.relPath,
          compName: comp.name,
          layout: buildLayoutData(),
        },
      });
    };

    el.appendChild(header);

    // Click to select node
    el.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      document
        .querySelectorAll(".comp-node.selected")
        .forEach((n) => n.classList.remove("selected"));
      selectedComp = { comp, file, element: el };
      el.classList.add("selected");
      setExplorerFocus("file", file.relPath);
    });

    // Make ComponentNode draggable
    makeDraggable(el, header, (dx, dy) => {
      comp.x = (comp.x || 30) + dx;
      comp.y = (comp.y || 60) + dy;
      el.style.left = `${comp.x}px`;
      el.style.top = `${comp.y}px`;
      if (workspaceData && workspaceData.components) {
        const globalComp = workspaceData.components.find(
          (c) => c.compKey === comp.compKey,
        );
        if (globalComp) {
          globalComp.x = comp.x;
          globalComp.y = comp.y;
        }
      }
      renderAllWires();
      scheduleSaveLayout();
    });

    // Content container for tags
    const content = document.createElement("div");
    content.className = "comp-content";

    if (!comp.tags || comp.tags.length === 0) {
      content.innerHTML = `<div class="comp-empty-msg">No keyword tags marked</div>`;
    } else {
      for (const layoutItem of comp.tags) {
        renderTagRow(layoutItem, content, comp, file);
      }
    }

    el.appendChild(content);
    parentEl.appendChild(el);
  }

  // ==========================================================================
  // Tag Row Rendering (Input, Output, Default, Tut-Tag)
  // ==========================================================================

  function renderTagRow(layoutItem, parentEl, comp, file) {
    const { tag, x, y } = layoutItem;
    const row = document.createElement("div");
    row.id = `tag_row_${tag.id}`;
    row.style.left = `${x}px`;
    row.style.top = `${y}px`;

    const subType = tag.variableSubType || "Input";
    const category = tag.category || "variable";

    if (category === "tut-tag") {
      // Tut-Tag: <Text> ?
      row.className = "tag-row tag-tuttag";
      row.innerHTML = `
        <span class="tut-link" title="Open tutorial">${escapeHtml(tag.word)}</span>
        <span class="icon-info" title="View details">?</span>
      `;
      row.querySelector(".tut-link").onclick = () => showTutorialModal(tag);
      row.querySelector(".icon-info").onclick = (e) => showInfoCard(e, tag);
    } else if (subType === "Input") {
      // Input Tag: ⭕ <Text> ?
      row.className = "tag-row tag-input";

      const socket = document.createElement("div");
      socket.className = "socket socket-input";
      socket.title = "Input socket: connect wires here";
      socket.dataset.tagId = tag.id;
      socket.dataset.fileRel = file.relPath;
      socket.innerHTML = "⭕";
      initInputSocket(socket, tag, file);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "tag-live-input";
      input.value = tag.word || "";
      input.title = "Edit token directly in code";

      // Inline text editing updates source code
      input.onchange = () => {
        vscode.postMessage({
          command: "UPDATE_INPUT_TEXT",
          payload: {
            filePath: file.relPath,
            tagId: tag.id,
            newText: input.value,
          },
        });
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        e.stopPropagation();
      };

      const infoIcon = document.createElement("span");
      infoIcon.className = "icon-info";
      infoIcon.title = "View details";
      infoIcon.innerHTML = "?";
      infoIcon.onclick = (e) => showInfoCard(e, tag);

      row.appendChild(socket);
      row.appendChild(input);
      row.appendChild(infoIcon);
    } else if (subType === "Default") {
      // Default Tag: <Text> ↓ ? ⭕
      row.className = "tag-row tag-default";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "tag-live-input";
      input.value = tag.word || "";
      input.title = "Edit default token in code or select from dropdown";

      input.onchange = () => {
        syncConnectedInputsInDom(tag.id, input.value);
        vscode.postMessage({
          command: "APPLY_DEFAULT_VALUE",
          payload: {
            filePath: file.relPath,
            tagId: tag.id,
            selectedValue: input.value,
          },
        });
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        e.stopPropagation();
      };

      const btnDropdown = document.createElement("button");
      btnDropdown.className = "btn-dropdown-arrow";
      btnDropdown.title = "Select preset value";
      btnDropdown.innerHTML = "↓";
      btnDropdown.onclick = (e) => {
        e.stopPropagation();
        showDefaultDropdown(e, tag, file, input);
      };

      const infoIcon = document.createElement("span");
      infoIcon.className = "icon-info";
      infoIcon.title = "View details";
      infoIcon.innerHTML = "?";
      infoIcon.onclick = (e) => showInfoCard(e, tag);

      const socket = document.createElement("div");
      socket.className = "socket socket-output";
      socket.title = "Output socket: drag wire to an Input socket";
      socket.dataset.tagId = tag.id;
      socket.dataset.fileRel = file.relPath;
      socket.innerHTML = "⭕";
      initOutputSocket(socket, tag, file);

      row.appendChild(input);
      row.appendChild(btnDropdown);
      row.appendChild(infoIcon);
      row.appendChild(socket);
    } else {
      // Output Tag: <Text> ? ⭕ (TITLE REMOVED AS REQUESTED)
      row.className = "tag-row tag-output";

      const wordSpan = document.createElement("span");
      wordSpan.className = "tag-word";
      wordSpan.textContent = tag.word || "";

      const infoIcon = document.createElement("span");
      infoIcon.className = "icon-info";
      infoIcon.title = "View details";
      infoIcon.innerHTML = "?";
      infoIcon.onclick = (e) => showInfoCard(e, tag);

      const socket = document.createElement("div");
      socket.className = "socket socket-output";
      socket.title = "Output socket: drag wire to an Input socket";
      socket.dataset.tagId = tag.id;
      socket.dataset.fileRel = file.relPath;
      socket.innerHTML = "⭕";
      initOutputSocket(socket, tag, file);

      row.appendChild(wordSpan);
      row.appendChild(infoIcon);
      row.appendChild(socket);
    }

    parentEl.appendChild(row);
  }

  // ==========================================================================
  // Socket Wiring & Bezier Cord Engine
  // ==========================================================================

  function initOutputSocket(socketEl, tag, file) {
    socketEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();

      const rect = socketEl.getBoundingClientRect();
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2;

      activeWireDrag = {
        sourceTagId: tag.id,
        sourceFile: file.relPath,
        startX,
        startY,
        currentX: e.clientX,
        currentY: e.clientY,
      };

      createActiveWirePath();
    });
  }

  function initInputSocket(socketEl, tag, file) {
    socketEl.addEventListener("mouseenter", () => {
      if (activeWireDrag) {
        socketEl.classList.add("snap-highlight");
      }
    });

    socketEl.addEventListener("mouseleave", () => {
      socketEl.classList.remove("snap-highlight");
    });

    socketEl.addEventListener("mouseup", (e) => {
      if (!activeWireDrag) return;
      e.stopPropagation();

      const sourceTagId = activeWireDrag.sourceTagId;
      const sourceFile = activeWireDrag.sourceFile;
      const targetInputTagId = tag.id;
      const targetFile = file.relPath;

      cancelActiveWire();

      // Flush layout to disk before the refresh triggered by CONNECT_WIRE
      flushLayoutSave();

      // Trigger wire connection IPC
      vscode.postMessage({
        command: "CONNECT_WIRE",
        payload: {
          sourceFile,
          targetFile,
          sourceTagId,
          targetInputTagId,
          layout: buildLayoutData(),
        },
      });
    });
  }

  function createActiveWirePath() {
    let path = document.getElementById("active-drag-wire");
    if (!path) {
      path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.id = "active-drag-wire";
      path.setAttribute("class", "wire-active");
      wiresLayer.appendChild(path);
    }
  }

  function updateActiveWirePath(cursorX, cursorY) {
    const path = document.getElementById("active-drag-wire");
    if (!path || !activeWireDrag) return;

    const p1 = screenToWorld(activeWireDrag.startX, activeWireDrag.startY);
    const p2 = screenToWorld(cursorX, cursorY);
    path.setAttribute("d", computeBezier(p1.x, p1.y, p2.x, p2.y));
  }

  function cancelActiveWire() {
    activeWireDrag = null;
    const path = document.getElementById("active-drag-wire");
    if (path) path.remove();
    document
      .querySelectorAll(".socket.snap-highlight")
      .forEach((s) => s.classList.remove("snap-highlight"));
  }

  function computeBezier(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);
    const curvature = Math.max(dx * 0.5, 45);
    const cp1x = x1 + curvature;
    const cp1y = y1;
    const cp2x = x2 - curvature;
    const cp2y = y2;
    return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  }

  function renderAllWires() {
    requestAnimationFrame(() => {
      _doRenderWires();
    });
  }

  function _doRenderWires() {
    // Clear existing permanent wires
    wiresLayer.querySelectorAll(".wire-path").forEach((p) => p.remove());

    if (!workspaceData) return;

    for (const file of workspaceData.files || []) {
      for (const wire of file.wires || []) {
        const sourceSocket = document.querySelector(
          `.socket-output[data-tag-id="${wire.sourceTagId}"]`,
        );
        const targetSocket = document.querySelector(
          `.socket-input[data-tag-id="${wire.targetTagId}"]`,
        );

        if (sourceSocket && targetSocket) {
          // Verify connected tags have the same text
          const sourceRow = sourceSocket.closest(".tag-row");
          const targetRow = targetSocket.closest(".tag-row");
          const sourceInput = sourceRow?.querySelector("input.tag-live-input");
          const targetInput = targetRow?.querySelector("input.tag-live-input");
          const sourceText = (
            sourceInput
              ? sourceInput.value
              : sourceRow?.querySelector(".tag-word")?.textContent || ""
          ).replace(/[\r\n]+$/, "");
          const targetText = (
            targetInput
              ? targetInput.value
              : targetRow?.querySelector(".tag-word")?.textContent || ""
          ).replace(/[\r\n]+$/, "");

          if (sourceText !== targetText) {
            file.wires = (file.wires || []).filter((w) => w.id !== wire.id);
            vscode.postMessage({
              command: "DISCONNECT_WIRE",
              payload: {
                targetFile: file.relPath,
                wireId: wire.id,
                layout: buildLayoutData(),
              },
            });
            continue;
          }

          const rect1 = sourceSocket.getBoundingClientRect();
          const rect2 = targetSocket.getBoundingClientRect();

          if (rect1.width === 0 || rect2.width === 0) continue;

          const p1 = screenToWorld(
            rect1.left + rect1.width / 2,
            rect1.top + rect1.height / 2,
          );
          const p2 = screenToWorld(
            rect2.left + rect2.width / 2,
            rect2.top + rect2.height / 2,
          );

          const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          );
          path.setAttribute("class", "wire-path");
          path.setAttribute("d", computeBezier(p1.x, p1.y, p2.x, p2.y));
          path.setAttribute("title", "Click to disconnect wire");

          path.onclick = (e) => {
            e.stopPropagation();
            flushLayoutSave();
            vscode.postMessage({
              command: "DISCONNECT_WIRE",
              payload: {
                targetFile: file.relPath,
                wireId: wire.id,
                layout: buildLayoutData(),
              },
            });
          };

          wiresLayer.appendChild(path);
        }
      }
    }
  }

  // ==========================================================================
  // Draggable Node Helper
  // ==========================================================================

  function makeDraggable(element, handle, onDrag) {
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;

    handle.addEventListener("mousedown", (e) => {
      if (
        e.button !== 0 ||
        e.target.closest("button") ||
        e.target.closest("input")
      )
        return;
      isDragging = true;
      isDraggingAnyNode = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      element.classList.add("dragging");
      e.stopPropagation();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - prevMouseX) / viewTransform.zoom;
      const dy = (e.clientY - prevMouseY) / viewTransform.zoom;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      onDrag(dx, dy);
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        isDraggingAnyNode = false;
        element.classList.remove("dragging");
        // Force a deferred save + refresh now that drag ended
        scheduleSaveLayout();
      }
    });
  }

  // ==========================================================================
  // Breadcrumb Navigation & Scope Drill-Down
  // ==========================================================================

  function setScope(type, path) {
    activeScope = { type, path };
    renderCanvas();
    renderBreadcrumbs();
    setExplorerFocus(type, path);
    // Center view
    viewTransform.x = 40;
    viewTransform.y = 40;
    viewTransform.zoom = 1.0;
    updateTransform();
    scheduleSaveLayout();
  }

  function renderBreadcrumbs() {
    topNav.innerHTML = "";

    // Root workspace item
    const rootItem = document.createElement("div");
    rootItem.className = `breadcrumb-item ${activeScope.type === "root" ? "active" : ""}`;
    rootItem.innerHTML = "🏠 Workspace";
    rootItem.onclick = () => setScope("root", "");
    topNav.appendChild(rootItem);

    if (activeScope.type === "folder" || activeScope.type === "file") {
      const parts = activeScope.path.split("/");
      let currentPath = "";

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        const sep = document.createElement("span");
        sep.className = "breadcrumb-separator";
        sep.textContent = ">";
        topNav.appendChild(sep);

        const item = document.createElement("div");
        item.className = `breadcrumb-item ${isLast ? "active" : ""}`;
        const isFile = activeScope.type === "file" && isLast;
        item.innerHTML = `${isFile ? "📄" : "📁"} ${escapeHtml(part)}`;

        if (!isLast) {
          const targetPath = currentPath;
          item.onclick = () => setScope("folder", targetPath);
        }

        topNav.appendChild(item);
      }
    }

    if (workspaceData && workspaceData.stats) {
      const stats = document.createElement("span");
      stats.className = "workspace-stats";
      stats.textContent = `${workspaceData.stats.totalFiles} files • ${workspaceData.stats.totalComponents} components`;
      topNav.appendChild(stats);
    }
  }

  // ==========================================================================
  // Floating Toolbars, Dropdowns & Modals
  // ==========================================================================

  function initToolbarControls() {
    document.getElementById("btn-zoom-in").onclick = () => {
      viewTransform.zoom = Math.min(2.5, viewTransform.zoom * 1.2);
      updateTransform();
      scheduleSaveLayout();
    };

    document.getElementById("btn-zoom-out").onclick = () => {
      viewTransform.zoom = Math.max(0.15, viewTransform.zoom / 1.2);
      updateTransform();
      scheduleSaveLayout();
    };

    document.getElementById("btn-zoom-reset").onclick = () => {
      viewTransform = { x: 40, y: 40, zoom: 1.0 };
      updateTransform();
      scheduleSaveLayout();
    };

    document.getElementById("btn-refresh").onclick = () => {
      vscode.postMessage({ command: "REFRESH_WORKSPACE" });
    };

    document.getElementById("btn-palette-toggle").onclick = () => {
      paletteDrawer.classList.toggle("hidden");
    };
  }

  function syncConnectedInputsInDom(sourceTagId, newText) {
    if (!workspaceData) return;
    for (const file of workspaceData.files || []) {
      for (const wire of file.wires || []) {
        if (wire.sourceTagId === sourceTagId) {
          const targetRow = document.getElementById(`tag_row_${wire.targetTagId}`);
          if (targetRow) {
            const inputEl = targetRow.querySelector("input.tag-live-input");
            if (inputEl) {
              inputEl.value = newText;
            }
          }
        }
      }
    }
  }

  function showDefaultDropdown(e, tag, file, inputEl) {
    closeDropdown();

    const menu = document.createElement("div");
    menu.className = "floating-dropdown-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY + 12}px`;

    const defaults = tag.defaultValues || ["true", "false", "0", "1", '""'];

    defaults.forEach((val) => {
      const item = document.createElement("div");
      item.className = "floating-dropdown-item";
      item.textContent = val;
      item.onclick = () => {
        if (inputEl) inputEl.value = val;
        syncConnectedInputsInDom(tag.id, val);
        closeDropdown();
        vscode.postMessage({
          command: "APPLY_DEFAULT_VALUE",
          payload: {
            filePath: file.relPath,
            tagId: tag.id,
            selectedValue: val,
          },
        });
      };
      menu.appendChild(item);
    });

    floatingContainer.appendChild(menu);
    activeDropdown = menu;

    window.addEventListener("click", closeDropdown, { once: true });
  }

  function closeDropdown() {
    if (activeDropdown) {
      activeDropdown.remove();
      activeDropdown = null;
    }
  }

  function showTutorialModal(tag) {
    modalContainer.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-dialog">
          <div class="modal-header">
            <span class="modal-title">📖 Tutorial: ${escapeHtml(tag.title || tag.word)}</span>
            <button class="modal-close-btn">&times;</button>
          </div>
          <div class="modal-body">
            <p>${escapeHtml(tag.description || "No description provided for this tutorial tag.")}</p>
            ${tag.tutData?.code ? `<pre><code>${escapeHtml(tag.tutData.code)}</code></pre>` : ""}
          </div>
        </div>
      </div>
    `;

    modalContainer.querySelector(".modal-close-btn").onclick = () => {
      modalContainer.innerHTML = "";
    };
    modalContainer.querySelector(".modal-overlay").onclick = (e) => {
      if (e.target === e.currentTarget) modalContainer.innerHTML = "";
    };
  }

  function showInfoCard(e, tag) {
    document.querySelectorAll(".info-card").forEach((c) => c.remove());

    const card = document.createElement("div");
    card.className = "info-card";
    card.style.left = `${e.clientX + 10}px`;
    card.style.top = `${e.clientY + 10}px`;
    card.innerHTML = `
      <div class="info-card-title">${escapeHtml(tag.title || tag.word)}</div>
      <div class="info-card-desc">${escapeHtml(tag.description || "No additional note.")}</div>
    `;
    floatingContainer.appendChild(card);

    setTimeout(() => {
      window.addEventListener("click", () => card.remove(), { once: true });
    }, 100);
  }

  // ==========================================================================
  // Component Palette Sidebar
  // ==========================================================================

  function renderPalette() {
    paletteTabs.innerHTML = "";
    paletteContent.innerHTML = "";

    if (!paletteLibraries || paletteLibraries.length === 0) {
      paletteContent.innerHTML = `<div class="comp-empty-msg">No libraries configured in sources.json</div>`;
      return;
    }

    paletteLibraries.forEach((lib, index) => {
      const tab = document.createElement("button");
      tab.className = `palette-tab ${index === 0 ? "active" : ""}`;
      tab.textContent = lib.language;
      tab.onclick = () => {
        document
          .querySelectorAll(".palette-tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        populatePaletteItems(lib.components);
      };
      paletteTabs.appendChild(tab);
    });

    populatePaletteItems(paletteLibraries[0].components);
  }

  function populatePaletteItems(components = []) {
    paletteContent.innerHTML = "";
    if (components.length === 0) {
      paletteContent.innerHTML = `<div class="comp-empty-msg">No components found</div>`;
      return;
    }

    components.forEach((comp) => {
      const chip = document.createElement("div");
      chip.className = "palette-chip";
      chip.draggable = true;
      chip.innerHTML = `
        <div class="palette-chip-name">${escapeHtml(comp.name)}</div>
        <div class="palette-chip-meta">${comp.lineCount} lines • ${comp.tags?.length || 0} tags</div>
      `;

      chip.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify(comp));
        e.dataTransfer.setData("application/json", JSON.stringify(comp));
        e.dataTransfer.effectAllowed = "copy";
        window.__draggedPaletteComponent = comp;
      };

      chip.ondragend = () => {
        window.__draggedPaletteComponent = null;
      };

      paletteContent.appendChild(chip);
    });
  }

  // Drag and drop onto canvas or directly into FileNodes
  window.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";

    const fileNode = e.target.closest ? e.target.closest(".file-node") : null;
    document.querySelectorAll(".file-node.drag-target-active").forEach((f) => {
      if (f !== fileNode) f.classList.remove("drag-target-active");
    });
    if (fileNode) {
      fileNode.classList.add("drag-target-active");
    }
  });

  window.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) {
      document
        .querySelectorAll(".file-node.drag-target-active")
        .forEach((f) => f.classList.remove("drag-target-active"));
    }
  });

  window.addEventListener("drop", (e) => {
    e.preventDefault();
    document
      .querySelectorAll(".file-node.drag-target-active")
      .forEach((f) => f.classList.remove("drag-target-active"));

    let comp = window.__draggedPaletteComponent;
    if (!comp) {
      try {
        const rawData =
          e.dataTransfer.getData("application/json") ||
          e.dataTransfer.getData("text/plain");
        if (rawData) comp = JSON.parse(rawData);
      } catch (_) {}
    }

    if (!comp) return;

    // Detect if dropped on or inside a FileNode
    const fileNodeEl = e.target.closest ? e.target.closest(".file-node") : null;
    let targetFileRel = fileNodeEl ? fileNodeEl.dataset.fileRel : "";

    if (!targetFileRel && activeScope.type === "file") {
      targetFileRel = activeScope.path;
    }

    if (!targetFileRel && workspaceData?.files?.length > 0) {
      targetFileRel = workspaceData.files[0].relPath;
    }

    const worldPos = screenToWorld(e.clientX, e.clientY);

    vscode.postMessage({
      command: "DROP_COMPONENT",
      payload: {
        component: comp,
        targetFileRelPath: targetFileRel,
        dropX: worldPos.x,
        dropY: worldPos.y,
        activeScope,
        layout: buildLayoutData(),
      },
    });

    window.__draggedPaletteComponent = null;
  });

  // Helper
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    console.log("[Auzy Toast]", msg);
  }

  // ==========================================================================
  // File Explorer Panel
  // ==========================================================================

  /**
   * Initialises the toggle / collapse-all buttons for the File Explorer header.
   */
  function initFileExplorerControls() {
    if (!explorerPanel) return;

    // Toggle collapse of whole panel (via the — button or clicking header)
    if (explorerToggleBtn) {
      explorerToggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleExplorerCollapse();
      });
    }

    const header = document.getElementById("explorer-header");
    if (header) {
      header.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        toggleExplorerCollapse();
      });
    }

    // Collapse all folder branches in the tree
    if (explorerCollapseAllBtn) {
      explorerCollapseAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        explorerFolderOpenState = {};
        renderFileExplorer();
      });
    }
  }

  function toggleExplorerCollapse() {
    explorerCollapsed = !explorerCollapsed;
    explorerPanel.classList.toggle("collapsed", explorerCollapsed);
    if (explorerToggleBtn) {
      explorerToggleBtn.textContent = explorerCollapsed ? "＋" : "—";
      explorerToggleBtn.title = explorerCollapsed ? "Expand" : "Collapse";
    }
    if (explorerChevron) {
      explorerChevron.textContent = explorerCollapsed ? "▶" : "▼";
    }
  }

  /**
   * Updates canvas nodes (.folder-node, .file-node) to reflect the currently focused node.
   */
  function updateCanvasSelection() {
    nodesContainer.querySelectorAll(".folder-node.selected, .file-node.selected").forEach((el) => {
      el.classList.remove("selected");
    });
    if (explorerFocusedNode.type === "file" && explorerFocusedNode.path) {
      const fileEl = Array.from(nodesContainer.querySelectorAll(".file-node")).find(
        (el) => el.dataset.fileRel === explorerFocusedNode.path
      );
      if (fileEl) fileEl.classList.add("selected");
    } else if (explorerFocusedNode.type === "folder" && explorerFocusedNode.path) {
      const folderEl = Array.from(nodesContainer.querySelectorAll(".folder-node")).find(
        (el) => el.dataset.folderRel === explorerFocusedNode.path
      );
      if (folderEl) folderEl.classList.add("selected");
    }
  }

  /**
   * Sets the focused node in the File Explorer and updates path display.
   * Auto-expands ancestor folders in the tree.
   * @param {"root"|"folder"|"file"} type
   * @param {string} path - relPath of the focused node (empty string for root)
   */
  function setExplorerFocus(type, path) {
    explorerFocusedNode = { type, path };

    // Auto-expand ancestor folders
    if (path) {
      const parts = path.split("/");
      let cumPath = "";
      for (let i = 0; i < parts.length - 1; i++) {
        cumPath = cumPath ? `${cumPath}/${parts[i]}` : parts[i];
        explorerFolderOpenState[cumPath] = true;
      }
      // If focused node is itself a folder, open it too
      if (type === "folder") {
        explorerFolderOpenState[path] = true;
      }
    }

    // Update path indicator
    if (explorerPathText) {
      explorerPathText.textContent = path ? path : "/ (Workspace Root)";
    }
    if (explorerFocusedPathEl) {
      explorerFocusedPathEl.textContent = path ? path.split("/").pop() : "";
    }

    // Re-render only the active states without rebuilding the whole tree
    refreshExplorerActiveStates();
    updateCanvasSelection();
  }

  /**
   * Full render of the File Explorer tree from workspaceData.
   */
  function renderFileExplorer() {
    if (!explorerTree || !workspaceData) return;
    explorerTree.innerHTML = "";

    // Workspace Root row
    const rootRow = document.createElement("div");
    rootRow.className = `tree-row-root ${explorerFocusedNode.type === "root" ? "active" : ""}`;
    rootRow.dataset.explorerType = "root";
    rootRow.dataset.explorerPath = "";
    rootRow.innerHTML = `<span class="tree-row-icon">🏠</span><span class="tree-row-name">Workspace Root</span>`;
    rootRow.addEventListener("click", () => {
      setExplorerFocus("root", "");
      setScope("root", "");
    });
    explorerTree.appendChild(rootRow);

    // Build top-level folders
    const rootFolders = (workspaceData.folders || []).filter((f) => !f.parentRelPath);
    for (const folder of rootFolders) {
      explorerTree.appendChild(buildFolderTreeRow(folder));
    }

    // Root-level files
    const rootFiles = (workspaceData.files || []).filter((f) => !f.folderRelPath);
    for (const file of rootFiles) {
      explorerTree.appendChild(buildFileTreeRow(file));
    }

    // Update path bar text
    if (explorerPathText) {
      explorerPathText.textContent =
        explorerFocusedNode.path || "/ (Workspace Root)";
    }
    if (explorerFocusedPathEl) {
      explorerFocusedPathEl.textContent = explorerFocusedNode.path
        ? explorerFocusedNode.path.split("/").pop()
        : "";
    }
  }

  /**
   * Recursively builds a folder row element with its children subtree.
   */
  function buildFolderTreeRow(folder) {
    const isOpen = !!explorerFolderOpenState[folder.relPath];

    const wrapper = document.createElement("div");
    wrapper.className = "tree-folder";
    wrapper.dataset.explorerFolderPath = folder.relPath;

    const header = document.createElement("div");
    const isActive =
      explorerFocusedNode.type === "folder" &&
      explorerFocusedNode.path === folder.relPath;
    header.className = `tree-folder-header ${isActive ? "active" : ""}`;
    header.dataset.explorerType = "folder";
    header.dataset.explorerPath = folder.relPath;

    const chevron = document.createElement("span");
    chevron.className = `tree-folder-chevron ${isOpen ? "open" : ""}`;
    chevron.textContent = "▶";

    // Clicking chevron toggles branch without navigating canvas
    chevron.addEventListener("click", (e) => {
      e.stopPropagation();
      explorerFolderOpenState[folder.relPath] = !explorerFolderOpenState[folder.relPath];
      renderFileExplorer();
    });

    const countText =
      folder.files.length > 0 ? `${folder.files.length}f` : "";

    header.innerHTML = "";
    header.appendChild(chevron);
    header.insertAdjacentHTML(
      "beforeend",
      `<span class="tree-row-icon">📁</span>
       <span class="tree-row-name">${escapeHtml(folder.name)}</span>
       ${countText ? `<span class="tree-row-count">${countText}</span>` : ""}`
    );

    // Clicking folder header selects & opens FolderNode in canvas
    header.addEventListener("click", (e) => {
      e.stopPropagation();
      explorerFolderOpenState[folder.relPath] = true;
      setExplorerFocus("folder", folder.relPath);
      setScope("folder", folder.relPath);
      renderFileExplorer();
    });

    wrapper.appendChild(header);

    // Children subtree
    const children = document.createElement("div");
    children.className = `tree-folder-children ${isOpen ? "open" : ""}`;

    // Subfolders
    const subfolders = (workspaceData.folders || []).filter(
      (f) => f.parentRelPath === folder.relPath
    );
    for (const sub of subfolders) {
      children.appendChild(buildFolderTreeRow(sub));
    }

    // Files inside this folder
    const folderFiles = (workspaceData.files || []).filter(
      (f) => f.folderRelPath === folder.relPath
    );
    for (const file of folderFiles) {
      children.appendChild(buildFileTreeRow(file));
    }

    wrapper.appendChild(children);
    return wrapper;
  }

  /**
   * Builds a single file row element.
   */
  function buildFileTreeRow(file) {
    const row = document.createElement("div");
    const isActive =
      explorerFocusedNode.type === "file" &&
      explorerFocusedNode.path === file.relPath;
    row.className = `tree-file-row ${isActive ? "active" : ""}`;
    row.dataset.explorerType = "file";
    row.dataset.explorerPath = file.relPath;
    row.innerHTML = `
      <span class="tree-row-icon">📄</span>
      <span class="tree-row-name">${escapeHtml(file.name)}</span>
      ${file.components.length > 0 ? `<span class="tree-row-count">${file.components.length}c</span>` : ""}
    `;
    row.addEventListener("click", () => {
      setExplorerFocus("file", file.relPath);
      setScope("file", file.relPath);
    });
    return row;
  }

  /**
   * Updates only .active classes on tree rows without rebuilding the DOM tree.
   * Also re-opens any ancestor folder children containers.
   */
  function refreshExplorerActiveStates() {
    if (!explorerTree) return;

    // Update active state on all rows
    explorerTree.querySelectorAll("[data-explorer-type]").forEach((el) => {
      const type = el.dataset.explorerType;
      const path = el.dataset.explorerPath;
      const isActive =
        explorerFocusedNode.type === type &&
        explorerFocusedNode.path === path;
      el.classList.toggle("active", isActive);
    });

    // Open/close folder children containers
    explorerTree.querySelectorAll(".tree-folder").forEach((folderEl) => {
      const folderPath = folderEl.dataset.explorerFolderPath;
      const isOpen = !!explorerFolderOpenState[folderPath];
      const children = folderEl.querySelector(".tree-folder-children");
      const chevron = folderEl.querySelector(".tree-folder-chevron");
      if (children) children.classList.toggle("open", isOpen);
      if (chevron) chevron.classList.toggle("open", isOpen);
    });

    // Scroll active element into view within tree
    const activeRow = explorerTree.querySelector("[data-explorer-type].active");
    if (activeRow) {
      activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // Update path bar
    if (explorerPathText) {
      explorerPathText.textContent =
        explorerFocusedNode.path || "/ (Workspace Root)";
    }
    if (explorerFocusedPathEl) {
      explorerFocusedPathEl.textContent = explorerFocusedNode.path
        ? explorerFocusedNode.path.split("/").pop()
        : "";
    }
  }
})();
