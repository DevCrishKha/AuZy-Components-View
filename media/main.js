/**
 * @file main.js
 * Frontend controller for Auzy-Components-View Webview canvas.
 * Handles infinite zoom/pan, hierarchical Folder/File/Component nodes,
 * persistent layout state, interactive bezier wires, in-node tag editing,
 * and scope drill-down navigation.
 */

(function () {
  // Obtain VS Code API
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : {
    postMessage: (msg) => console.log('[VSCode IPC]', msg),
    getState: () => null,
    setState: () => {}
  };

  // State
  let workspaceData = null;
  let paletteLibraries = [];
  let viewTransform = { x: 40, y: 40, zoom: 1.0 };
  let activeScope = { type: 'root', path: '' }; // 'root', 'folder', or 'file'
  let activeWireDrag = null; // { sourceTagId, sourceNodeId, startX, startY, sourceFile }
  let activeDropdown = null;
  let selectedComp = null; // { comp, file, element }
  let saveLayoutDebounceTimer = null;

  // DOM Elements
  const container = document.getElementById('canvas-container');
  const world = document.getElementById('world');
  const wiresLayer = document.getElementById('wires-layer');
  const nodesContainer = document.getElementById('nodes-container') || world;
  const topNav = document.getElementById('top-nav');
  const paletteDrawer = document.getElementById('palette-drawer');
  const paletteTabs = document.getElementById('palette-tabs');
  const paletteContent = document.getElementById('palette-content');
  const modalContainer = document.getElementById('modal-container');
  const floatingContainer = document.getElementById('floating-container');

  // ==========================================================================
  // Initialization & IPC Bridge
  // ==========================================================================

  window.addEventListener('DOMContentLoaded', () => {
    initCanvasNavigation();
    initToolbarControls();
    initKeyboardShortcuts();
    vscode.postMessage({ command: 'REQUEST_INIT' });
  });

  function initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedComp) {
        // Do not trigger deletion if user is typing in an input field
        const tagName = document.activeElement?.tagName?.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea') return;

        deleteSelectedComponent();
      }
    });
  }

  function deleteSelectedComponent() {
    if (!selectedComp) return;
    const { comp, file } = selectedComp;
    vscode.postMessage({
      command: 'DELETE_COMPONENT',
      payload: {
        fileRelPath: file.relPath,
        compName: comp.name
      }
    });
    selectedComp = null;
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.command) {
      case 'LOAD_WORKSPACE_DATA':
        workspaceData = message.payload;
        if (workspaceData.viewport) {
          viewTransform = { ...workspaceData.viewport };
        }
        if (workspaceData.savedScope) {
          activeScope = { ...workspaceData.savedScope };
        }
        renderCanvas();
        updateTransform();
        renderBreadcrumbs();
        break;

      case 'UPDATE_PALETTE':
        paletteLibraries = message.payload.libraries || [];
        renderPalette();
        break;

      case 'REFRESH_WORKSPACE':
      case 'WIRE_CONNECTED':
      case 'TAG_UPDATED':
        vscode.postMessage({ command: 'REFRESH_WORKSPACE' });
        break;

      case 'SHOW_ERROR':
        showToast(message.payload.message || 'An error occurred', 'error');
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

    container.addEventListener('mousedown', (e) => {
      // Middle click or (Left click with Spacebar or clicking empty canvas)
      if (e.button === 1 || (e.button === 0 && (e.spaceKey || e.target === container || e.target === world || e.target === wiresLayer))) {
        isPanning = true;
        startX = e.clientX - viewTransform.x;
        startY = e.clientY - viewTransform.y;
        container.classList.add('panning');
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanning) {
        viewTransform.x = e.clientX - startX;
        viewTransform.y = e.clientY - startY;
        updateTransform();
        scheduleSaveLayout();
      } else if (activeWireDrag) {
        updateActiveWirePath(e.clientX, e.clientY);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (isPanning) {
        isPanning = false;
        container.classList.remove('panning');
      }
      if (activeWireDrag && e.target.classList.contains('socket-input')) {
        // Socket connection handled in socket mouseup listener
      } else if (activeWireDrag) {
        cancelActiveWire();
      }
    });

    // Zoom on wheel
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = 1.12;
      const oldZoom = viewTransform.zoom;
      let newZoom = e.deltaY < 0 ? oldZoom * zoomFactor : oldZoom / zoomFactor;

      // Clamp zoom between 0.15x and 2.5x
      newZoom = Math.max(0.15, Math.min(2.5, newZoom));

      // Zoom toward cursor
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      viewTransform.x = mouseX - ((mouseX - viewTransform.x) * (newZoom / oldZoom));
      viewTransform.y = mouseY - ((mouseY - viewTransform.y) * (newZoom / oldZoom));
      viewTransform.zoom = newZoom;

      updateTransform();
      scheduleSaveLayout();
    }, { passive: false });
  }

  function updateTransform() {
    world.style.transform = `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.zoom})`;
  }

  function screenToWorld(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
      x: (clientX - rect.left - viewTransform.x) / viewTransform.zoom,
      y: (clientY - rect.top - viewTransform.y) / viewTransform.zoom
    };
  }

  // ==========================================================================
  // Layout Persistence Bridge
  // ==========================================================================

  function scheduleSaveLayout() {
    if (saveLayoutDebounceTimer) clearTimeout(saveLayoutDebounceTimer);
    saveLayoutDebounceTimer = setTimeout(() => {
      if (!workspaceData) return;

      const layoutData = {
        viewport: { ...viewTransform },
        scope: { ...activeScope },
        folders: {},
        files: {},
        components: {}
      };

      for (const folder of workspaceData.folders || []) {
        layoutData.folders[folder.relPath] = {
          x: folder.x,
          y: folder.y,
          width: folder.width,
          height: folder.height,
          isCollapsed: !!folder.isCollapsed
        };
      }

      for (const file of workspaceData.files || []) {
        layoutData.files[file.relPath] = {
          x: file.x,
          y: file.y,
          width: file.width,
          height: file.height,
          isCollapsed: !!file.isCollapsed
        };
      }

      for (const comp of workspaceData.components || []) {
        layoutData.components[comp.compKey] = {
          x: comp.x,
          y: comp.y
        };
      }

      vscode.postMessage({
        command: 'SAVE_LAYOUT',
        payload: layoutData
      });
    }, 400);
  }

  // ==========================================================================
  // Canvas Rendering (FolderNodes, FileNodes, ComponentNodes)
  // ==========================================================================

  function renderCanvas() {
    if (!workspaceData) return;
    nodesContainer.innerHTML = '';
    wiresLayer.querySelectorAll('.wire-path').forEach(p => p.remove());

    // Determine what to display based on activeScope
    if (activeScope.type === 'file') {
      renderFileScope(activeScope.path);
    } else if (activeScope.type === 'folder') {
      renderFolderScope(activeScope.path);
    } else {
      renderRootScope();
    }

    renderAllWires();
  }

  /**
   * Renders the complete workspace root view.
   */
  function renderRootScope() {
    // 1. Render all top-level folders
    const rootFolders = (workspaceData.folders || []).filter(f => !f.parentRelPath);
    for (const folder of rootFolders) {
      renderFolderNode(folder);
    }

    // 2. Render all root-level files (files not belonging to any folder)
    const rootFiles = (workspaceData.files || []).filter(f => !f.folderRelPath);
    for (const file of rootFiles) {
      renderFileNode(file, nodesContainer);
    }
  }

  /**
   * Renders a focused folder as the entire canvas.
   */
  function renderFolderScope(folderRelPath) {
    const folder = (workspaceData.folders || []).find(f => f.relPath === folderRelPath);
    if (!folder) {
      activeScope = { type: 'root', path: '' };
      renderRootScope();
      return;
    }

    // Render subfolders of this folder
    const subfolders = (workspaceData.folders || []).filter(f => f.parentRelPath === folderRelPath);
    for (const sub of subfolders) {
      renderFolderNode(sub);
    }

    // Render files inside this folder
    const files = (workspaceData.files || []).filter(f => f.folderRelPath === folderRelPath);
    for (const file of files) {
      renderFileNode(file, nodesContainer);
    }
  }

  /**
   * Renders a single focused file as the entire canvas.
   */
  function renderFileScope(fileRelPath) {
    const file = (workspaceData.files || []).find(f => f.relPath === fileRelPath);
    if (!file) {
      activeScope = { type: 'root', path: '' };
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
    const el = document.createElement('div');
    el.className = `folder-node ${folder.isCollapsed ? 'collapsed' : ''}`;
    el.id = folder.id;
    el.style.left = `${folder.x || 60}px`;
    el.style.top = `${folder.y || 60}px`;
    el.style.width = `${folder.width || 640}px`;
    el.style.height = folder.isCollapsed ? '48px' : `${folder.height || 480}px`;

    // Folder Header
    const header = document.createElement('div');
    header.className = 'folder-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'folder-title-wrap';
    titleWrap.innerHTML = `
      <span class="folder-icon">📁</span>
      <span class="folder-name">${escapeHtml(folder.name)}</span>
      <span class="folder-badge">${folder.files.length} files</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    // Open as Canvas Button (Focus Mode)
    const btnFocus = document.createElement('button');
    btnFocus.className = 'btn-node-action';
    btnFocus.title = 'Open folder as the whole canvas';
    btnFocus.innerHTML = '⛶ Focus';
    btnFocus.onclick = (e) => {
      e.stopPropagation();
      setScope('folder', folder.relPath);
    };

    // Expand / Collapse Toggle
    const btnToggle = document.createElement('button');
    btnToggle.className = 'btn-node-action';
    btnToggle.title = folder.isCollapsed ? 'Expand folder' : 'Collapse folder';
    btnToggle.innerHTML = folder.isCollapsed ? '＋' : '—';
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

    // Folder Body (Nested Files & Subfolders)
    if (!folder.isCollapsed) {
      const body = document.createElement('div');
      body.className = 'folder-body';

      // Render nested files inside folder
      const folderFiles = (workspaceData.files || []).filter(f => f.folderRelPath === folder.relPath);
      for (const file of folderFiles) {
        renderFileNode(file, body);
      }

      // Render nested subfolders
      const subfolders = (workspaceData.folders || []).filter(f => f.parentRelPath === folder.relPath);
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
    const el = document.createElement('div');
    el.className = `file-node ${file.isCollapsed ? 'collapsed' : ''}`;
    el.id = file.id;
    el.dataset.fileRel = file.relPath;

    const posX = isFullScreenScope ? 60 : (file.x || 80);
    const posY = isFullScreenScope ? 60 : (file.y || 80);
    const width = isFullScreenScope ? Math.max(900, (file.width || 600)) : (file.width || 560);
    const height = isFullScreenScope ? Math.max(700, (file.height || 450)) : (file.isCollapsed ? 42 : (file.height || 420));

    el.style.left = `${posX}px`;
    el.style.top = `${posY}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;

    // File Header
    const header = document.createElement('div');
    header.className = 'file-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'file-title-wrap';
    titleWrap.innerHTML = `
      <span class="file-icon">📄</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-badge">${file.components.length} components</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    // Open in Editor Button
    const btnOpenEditor = document.createElement('button');
    btnOpenEditor.className = 'btn-node-action';
    btnOpenEditor.title = 'Open in VS Code text editor';
    btnOpenEditor.innerHTML = '✎ Edit';
    btnOpenEditor.onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({
        command: 'OPEN_FILE_IN_EDITOR',
        payload: { fileRelPath: file.relPath }
      });
    };

    // Open as Canvas Button (Focus Mode)
    const btnFocus = document.createElement('button');
    btnFocus.className = 'btn-node-action';
    btnFocus.title = 'Open file as the whole canvas';
    btnFocus.innerHTML = '⛶ Focus';
    btnFocus.onclick = (e) => {
      e.stopPropagation();
      setScope('file', file.relPath);
    };

    // Expand / Collapse Toggle
    const btnToggle = document.createElement('button');
    btnToggle.className = 'btn-node-action';
    btnToggle.title = file.isCollapsed ? 'Expand file' : 'Collapse file';
    btnToggle.innerHTML = file.isCollapsed ? '＋' : '—';
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

    // File Body (Components)
    if (!file.isCollapsed) {
      const body = document.createElement('div');
      body.className = 'file-body';

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
    const el = document.createElement('div');
    el.className = 'comp-node';
    el.id = comp.id;
    el.style.left = `${comp.x || 30}px`;
    el.style.top = `${comp.y || 60}px`;
    el.style.width = `${comp.width || 240}px`;
    el.style.height = `${comp.height || 160}px`;

    // Header
    const header = document.createElement('div');
    header.className = 'comp-header';
    header.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;overflow:hidden;">
        <span class="comp-title" title="${escapeHtml(comp.name)}">${escapeHtml(comp.name)}</span>
        <span class="comp-meta">${comp.lineCount} lines</span>
      </div>
      <button class="comp-delete-btn" title="Delete component and code from file">🗑️</button>
    `;

    // Click trash button to delete component
    header.querySelector('.comp-delete-btn').onclick = (e) => {
      e.stopPropagation();
      vscode.postMessage({
        command: 'DELETE_COMPONENT',
        payload: {
          fileRelPath: file.relPath,
          compName: comp.name
        }
      });
    };

    el.appendChild(header);

    // Click to select node
    el.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      document.querySelectorAll('.comp-node.selected').forEach(n => n.classList.remove('selected'));
      selectedComp = { comp, file, element: el };
      el.classList.add('selected');
    });

    // Make ComponentNode draggable
    makeDraggable(el, header, (dx, dy) => {
      comp.x = (comp.x || 30) + dx;
      comp.y = (comp.y || 60) + dy;
      el.style.left = `${comp.x}px`;
      el.style.top = `${comp.y}px`;
      renderAllWires();
      scheduleSaveLayout();
    });

    // Content container for tags
    const content = document.createElement('div');
    content.className = 'comp-content';

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
    const row = document.createElement('div');
    row.id = `tag_row_${tag.id}`;
    row.style.left = `${x}px`;
    row.style.top = `${y}px`;

    const subType = tag.variableSubType || 'Input';
    const category = tag.category || 'variable';

    if (category === 'tut-tag') {
      // Tut-Tag: <Text> ?
      row.className = 'tag-row tag-tuttag';
      row.innerHTML = `
        <span class="tut-link" title="Open tutorial">${escapeHtml(tag.word)}</span>
        <span class="icon-info" title="View details">?</span>
      `;
      row.querySelector('.tut-link').onclick = () => showTutorialModal(tag);
      row.querySelector('.icon-info').onclick = (e) => showInfoCard(e, tag);

    } else if (subType === 'Input') {
      // Input Tag: ⭕ <Text> ?
      row.className = 'tag-row tag-input';

      const socket = document.createElement('div');
      socket.className = 'socket socket-input';
      socket.title = 'Input socket: connect wires here';
      socket.dataset.tagId = tag.id;
      socket.dataset.fileRel = file.relPath;
      socket.innerHTML = '⭕';
      initInputSocket(socket, tag, file);

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tag-live-input';
      input.value = tag.word || '';
      input.title = 'Edit token directly in code';

      // Inline text editing updates source code
      input.onchange = () => {
        vscode.postMessage({
          command: 'UPDATE_INPUT_TEXT',
          payload: {
            filePath: file.relPath,
            tagId: tag.id,
            newText: input.value
          }
        });
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') input.blur();
        e.stopPropagation();
      };

      const infoIcon = document.createElement('span');
      infoIcon.className = 'icon-info';
      infoIcon.title = 'View details';
      infoIcon.innerHTML = '?';
      infoIcon.onclick = (e) => showInfoCard(e, tag);

      row.appendChild(socket);
      row.appendChild(input);
      row.appendChild(infoIcon);

    } else if (subType === 'Default') {
      // Default Tag: <Text> ↓ ? ⭕
      row.className = 'tag-row tag-default';

      const wordSpan = document.createElement('span');
      wordSpan.className = 'tag-word';
      wordSpan.textContent = tag.word || '';

      const btnDropdown = document.createElement('button');
      btnDropdown.className = 'btn-dropdown-arrow';
      btnDropdown.title = 'Select preset value';
      btnDropdown.innerHTML = '↓';
      btnDropdown.onclick = (e) => {
        e.stopPropagation();
        showDefaultDropdown(e, tag, file);
      };

      const infoIcon = document.createElement('span');
      infoIcon.className = 'icon-info';
      infoIcon.title = 'View details';
      infoIcon.innerHTML = '?';
      infoIcon.onclick = (e) => showInfoCard(e, tag);

      const socket = document.createElement('div');
      socket.className = 'socket socket-output';
      socket.title = 'Output socket: drag wire to an Input socket';
      socket.dataset.tagId = tag.id;
      socket.dataset.fileRel = file.relPath;
      socket.innerHTML = '⭕';
      initOutputSocket(socket, tag, file);

      row.appendChild(wordSpan);
      row.appendChild(btnDropdown);
      row.appendChild(infoIcon);
      row.appendChild(socket);

    } else {
      // Output Tag: <Text> ? ⭕ (TITLE REMOVED AS REQUESTED)
      row.className = 'tag-row tag-output';

      const wordSpan = document.createElement('span');
      wordSpan.className = 'tag-word';
      wordSpan.textContent = tag.word || '';

      const infoIcon = document.createElement('span');
      infoIcon.className = 'icon-info';
      infoIcon.title = 'View details';
      infoIcon.innerHTML = '?';
      infoIcon.onclick = (e) => showInfoCard(e, tag);

      const socket = document.createElement('div');
      socket.className = 'socket socket-output';
      socket.title = 'Output socket: drag wire to an Input socket';
      socket.dataset.tagId = tag.id;
      socket.dataset.fileRel = file.relPath;
      socket.innerHTML = '⭕';
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
    socketEl.addEventListener('mousedown', (e) => {
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
        currentY: e.clientY
      };

      createActiveWirePath();
    });
  }

  function initInputSocket(socketEl, tag, file) {
    socketEl.addEventListener('mouseenter', () => {
      if (activeWireDrag) {
        socketEl.classList.add('snap-highlight');
      }
    });

    socketEl.addEventListener('mouseleave', () => {
      socketEl.classList.remove('snap-highlight');
    });

    socketEl.addEventListener('mouseup', (e) => {
      if (!activeWireDrag) return;
      e.stopPropagation();

      const sourceTagId = activeWireDrag.sourceTagId;
      const sourceFile = activeWireDrag.sourceFile;
      const targetInputTagId = tag.id;
      const targetFile = file.relPath;

      cancelActiveWire();

      // Trigger wire connection IPC
      vscode.postMessage({
        command: 'CONNECT_WIRE',
        payload: {
          sourceFile,
          targetFile,
          sourceTagId,
          targetInputTagId
        }
      });
    });
  }

  function createActiveWirePath() {
    let path = document.getElementById('active-drag-wire');
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.id = 'active-drag-wire';
      path.setAttribute('class', 'wire-active');
      wiresLayer.appendChild(path);
    }
  }

  function updateActiveWirePath(cursorX, cursorY) {
    const path = document.getElementById('active-drag-wire');
    if (!path || !activeWireDrag) return;

    const p1 = screenToWorld(activeWireDrag.startX, activeWireDrag.startY);
    const p2 = screenToWorld(cursorX, cursorY);
    path.setAttribute('d', computeBezier(p1.x, p1.y, p2.x, p2.y));
  }

  function cancelActiveWire() {
    activeWireDrag = null;
    const path = document.getElementById('active-drag-wire');
    if (path) path.remove();
    document.querySelectorAll('.socket.snap-highlight').forEach(s => s.classList.remove('snap-highlight'));
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
    wiresLayer.querySelectorAll('.wire-path').forEach(p => p.remove());

    if (!workspaceData) return;

    for (const file of workspaceData.files || []) {
      for (const wire of file.wires || []) {
        const sourceSocket = document.querySelector(`.socket-output[data-tag-id="${wire.sourceTagId}"]`);
        const targetSocket = document.querySelector(`.socket-input[data-tag-id="${wire.targetTagId}"]`);

        if (sourceSocket && targetSocket) {
          const rect1 = sourceSocket.getBoundingClientRect();
          const rect2 = targetSocket.getBoundingClientRect();

          if (rect1.width === 0 || rect2.width === 0) continue;

          const p1 = screenToWorld(rect1.left + rect1.width / 2, rect1.top + rect1.height / 2);
          const p2 = screenToWorld(rect2.left + rect2.width / 2, rect2.top + rect2.height / 2);

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('class', 'wire-path');
          path.setAttribute('d', computeBezier(p1.x, p1.y, p2.x, p2.y));
          path.setAttribute('title', 'Click to disconnect wire');

          path.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({
              command: 'DISCONNECT_WIRE',
              payload: {
                targetFile: file.relPath,
                wireId: wire.id
              }
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

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('button') || e.target.closest('input')) return;
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      element.classList.add('dragging');
      e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = (e.clientX - prevMouseX) / viewTransform.zoom;
      const dy = (e.clientY - prevMouseY) / viewTransform.zoom;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      onDrag(dx, dy);
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        element.classList.remove('dragging');
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
    // Center view
    viewTransform.x = 40;
    viewTransform.y = 40;
    viewTransform.zoom = 1.0;
    updateTransform();
    scheduleSaveLayout();
  }

  function renderBreadcrumbs() {
    topNav.innerHTML = '';

    // Root workspace item
    const rootItem = document.createElement('div');
    rootItem.className = `breadcrumb-item ${activeScope.type === 'root' ? 'active' : ''}`;
    rootItem.innerHTML = '🏠 Workspace';
    rootItem.onclick = () => setScope('root', '');
    topNav.appendChild(rootItem);

    if (activeScope.type === 'folder' || activeScope.type === 'file') {
      const parts = activeScope.path.split('/');
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.textContent = '>';
        topNav.appendChild(sep);

        const item = document.createElement('div');
        item.className = `breadcrumb-item ${isLast ? 'active' : ''}`;
        const isFile = activeScope.type === 'file' && isLast;
        item.innerHTML = `${isFile ? '📄' : '📁'} ${escapeHtml(part)}`;

        if (!isLast) {
          const targetPath = currentPath;
          item.onclick = () => setScope('folder', targetPath);
        }

        topNav.appendChild(item);
      }
    }

    if (workspaceData && workspaceData.stats) {
      const stats = document.createElement('span');
      stats.className = 'workspace-stats';
      stats.textContent = `${workspaceData.stats.totalFiles} files • ${workspaceData.stats.totalComponents} components`;
      topNav.appendChild(stats);
    }
  }

  // ==========================================================================
  // Floating Toolbars, Dropdowns & Modals
  // ==========================================================================

  function initToolbarControls() {
    document.getElementById('btn-zoom-in').onclick = () => {
      viewTransform.zoom = Math.min(2.5, viewTransform.zoom * 1.2);
      updateTransform();
      scheduleSaveLayout();
    };

    document.getElementById('btn-zoom-out').onclick = () => {
      viewTransform.zoom = Math.max(0.15, viewTransform.zoom / 1.2);
      updateTransform();
      scheduleSaveLayout();
    };

    document.getElementById('btn-zoom-reset').onclick = () => {
      viewTransform = { x: 40, y: 40, zoom: 1.0 };
      updateTransform();
      scheduleSaveLayout();
    };

    document.getElementById('btn-refresh').onclick = () => {
      vscode.postMessage({ command: 'REFRESH_WORKSPACE' });
    };

    document.getElementById('btn-palette-toggle').onclick = () => {
      paletteDrawer.classList.toggle('hidden');
    };
  }

  function showDefaultDropdown(e, tag, file) {
    closeDropdown();

    const menu = document.createElement('div');
    menu.className = 'floating-dropdown-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY + 12}px`;

    const defaults = tag.defaultValues || ['true', 'false', '0', '1', '""'];

    defaults.forEach((val) => {
      const item = document.createElement('div');
      item.className = 'floating-dropdown-item';
      item.textContent = val;
      item.onclick = () => {
        closeDropdown();
        vscode.postMessage({
          command: 'APPLY_DEFAULT_VALUE',
          payload: {
            filePath: file.relPath,
            tagId: tag.id,
            selectedValue: val
          }
        });
      };
      menu.appendChild(item);
    });

    floatingContainer.appendChild(menu);
    activeDropdown = menu;

    window.addEventListener('click', closeDropdown, { once: true });
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
            <p>${escapeHtml(tag.description || 'No description provided for this tutorial tag.')}</p>
            ${tag.tutData?.code ? `<pre><code>${escapeHtml(tag.tutData.code)}</code></pre>` : ''}
          </div>
        </div>
      </div>
    `;

    modalContainer.querySelector('.modal-close-btn').onclick = () => {
      modalContainer.innerHTML = '';
    };
    modalContainer.querySelector('.modal-overlay').onclick = (e) => {
      if (e.target === e.currentTarget) modalContainer.innerHTML = '';
    };
  }

  function showInfoCard(e, tag) {
    document.querySelectorAll('.info-card').forEach(c => c.remove());

    const card = document.createElement('div');
    card.className = 'info-card';
    card.style.left = `${e.clientX + 10}px`;
    card.style.top = `${e.clientY + 10}px`;
    card.innerHTML = `
      <div class="info-card-title">${escapeHtml(tag.title || tag.word)}</div>
      <div class="info-card-desc">${escapeHtml(tag.description || 'No additional note.')}</div>
    `;
    floatingContainer.appendChild(card);

    setTimeout(() => {
      window.addEventListener('click', () => card.remove(), { once: true });
    }, 100);
  }

  // ==========================================================================
  // Component Palette Sidebar
  // ==========================================================================

  function renderPalette() {
    paletteTabs.innerHTML = '';
    paletteContent.innerHTML = '';

    if (!paletteLibraries || paletteLibraries.length === 0) {
      paletteContent.innerHTML = `<div class="comp-empty-msg">No libraries configured in sources.json</div>`;
      return;
    }

    paletteLibraries.forEach((lib, index) => {
      const tab = document.createElement('button');
      tab.className = `palette-tab ${index === 0 ? 'active' : ''}`;
      tab.textContent = lib.language;
      tab.onclick = () => {
        document.querySelectorAll('.palette-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        populatePaletteItems(lib.components);
      };
      paletteTabs.appendChild(tab);
    });

    populatePaletteItems(paletteLibraries[0].components);
  }

  function populatePaletteItems(components = []) {
    paletteContent.innerHTML = '';
    if (components.length === 0) {
      paletteContent.innerHTML = `<div class="comp-empty-msg">No components found</div>`;
      return;
    }

    components.forEach((comp) => {
      const chip = document.createElement('div');
      chip.className = 'palette-chip';
      chip.draggable = true;
      chip.innerHTML = `
        <div class="palette-chip-name">${escapeHtml(comp.name)}</div>
        <div class="palette-chip-meta">${comp.lineCount} lines • ${comp.tags?.length || 0} tags</div>
      `;

      chip.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify(comp));
        e.dataTransfer.setData('application/json', JSON.stringify(comp));
        e.dataTransfer.effectAllowed = 'copy';
        window.__draggedPaletteComponent = comp;
      };

      chip.ondragend = () => {
        window.__draggedPaletteComponent = null;
      };

      paletteContent.appendChild(chip);
    });
  }

  // Drag and drop onto canvas or directly into FileNodes
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    const fileNode = e.target.closest ? e.target.closest('.file-node') : null;
    document.querySelectorAll('.file-node.drag-target-active').forEach(f => {
      if (f !== fileNode) f.classList.remove('drag-target-active');
    });
    if (fileNode) {
      fileNode.classList.add('drag-target-active');
    }
  });

  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) {
      document.querySelectorAll('.file-node.drag-target-active').forEach(f => f.classList.remove('drag-target-active'));
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.querySelectorAll('.file-node.drag-target-active').forEach(f => f.classList.remove('drag-target-active'));

    let comp = window.__draggedPaletteComponent;
    if (!comp) {
      try {
        const rawData = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
        if (rawData) comp = JSON.parse(rawData);
      } catch (_) {}
    }

    if (!comp) return;

    // Detect if dropped on or inside a FileNode
    const fileNodeEl = e.target.closest ? e.target.closest('.file-node') : null;
    let targetFileRel = fileNodeEl ? fileNodeEl.dataset.fileRel : '';

    if (!targetFileRel && activeScope.type === 'file') {
      targetFileRel = activeScope.path;
    }

    if (!targetFileRel && workspaceData?.files?.length > 0) {
      targetFileRel = workspaceData.files[0].relPath;
    }

    const worldPos = screenToWorld(e.clientX, e.clientY);

    vscode.postMessage({
      command: 'DROP_COMPONENT',
      payload: {
        component: comp,
        targetFileRelPath: targetFileRel,
        dropX: worldPos.x,
        dropY: worldPos.y,
        activeScope
      }
    });

    window.__draggedPaletteComponent = null;
  });

  // Helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg) {
    console.log('[Auzy Toast]', msg);
  }
})();

