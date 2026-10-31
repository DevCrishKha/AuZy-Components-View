/**
 * @file webviewPanelManager.js
 * Manages the lifecycle of the Auzy Components View Webview Panel,
 * renders HTML with local media resources, and coordinates the IPC message bridge.
 */

const vscode = require('vscode');
const path = require('path');
const { scanWorkspaceHierarchy } = require('./directoryScanner');
const { scanPaletteLibraries, dropComponentIntoFile } = require('./paletteScanner');
const { saveWorkspaceLayout } = require('./persistenceBridge');
const {
  connectWire,
  disconnectWire,
  updateInputTagText,
  applyDefaultValue
} = require('./wiringCoordinator');

let currentPanel = null;

/**
 * Creates or reveals the Components View Webview panel.
 * @param {vscode.ExtensionContext} context
 */
function createOrShowWebviewPanel(context) {
  const column = vscode.window.activeTextEditor
    ? vscode.ViewColumn.Beside
    : vscode.ViewColumn.One;

  if (currentPanel) {
    currentPanel.reveal(column);
    return currentPanel;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('Please open a project workspace folder to use Auzy Components View.');
    return null;
  }

  currentPanel = vscode.window.createWebviewPanel(
    'auzyComponentsView',
    'Auzy: Components View',
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(context.extensionPath, 'media'))
      ]
    }
  );

  currentPanel.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'media', 'icons', 'circuit.svg'));
  currentPanel.webview.html = getWebviewContent(currentPanel.webview, context.extensionPath);

  // Message dispatcher
  currentPanel.webview.onDidReceiveMessage(async (message) => {
    try {
      await handleWebviewMessage(message, workspaceRoot, context);
    } catch (err) {
      console.error('[WebviewPanelManager] Error handling message:', err);
      currentPanel?.webview.postMessage({
        command: 'SHOW_ERROR',
        payload: { message: err.message || 'An error occurred in extension host.' }
      });
    }
  }, null, context.subscriptions);

  currentPanel.onDidDispose(() => {
    currentPanel = null;
  }, null, context.subscriptions);

  return currentPanel;
}

/**
 * Handles incoming JSON-RPC IPC messages from the Webview.
 * @param {Object} message
 * @param {string} workspaceRoot
 * @param {vscode.ExtensionContext} context
 */
async function handleWebviewMessage(message, workspaceRoot, context) {
  if (!currentPanel) return;

  switch (message.command) {
    case 'REQUEST_INIT':
    case 'REFRESH_WORKSPACE': {
      const hierarchy = await scanWorkspaceHierarchy(workspaceRoot);
      const palette = await scanPaletteLibraries(workspaceRoot);

      currentPanel.webview.postMessage({
        command: 'LOAD_WORKSPACE_DATA',
        payload: hierarchy
      });

      currentPanel.webview.postMessage({
        command: 'UPDATE_PALETTE',
        payload: { libraries: palette }
      });
      break;
    }

    case 'SAVE_LAYOUT': {
      saveWorkspaceLayout(workspaceRoot, message.payload);
      break;
    }

    case 'UPDATE_INPUT_TEXT': {
      const { filePath, tagId, newText } = message.payload;
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
      await updateInputTagText(workspaceRoot, absPath, tagId, newText);

      currentPanel.webview.postMessage({
        command: 'TAG_UPDATED',
        payload: { tagId, newText }
      });
      break;
    }

    case 'APPLY_DEFAULT_VALUE': {
      const { filePath, tagId, selectedValue } = message.payload;
      const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
      await applyDefaultValue(workspaceRoot, absPath, tagId, selectedValue);

      currentPanel.webview.postMessage({
        command: 'TAG_UPDATED',
        payload: { tagId, newText: selectedValue }
      });
      break;
    }

    case 'CONNECT_WIRE': {
      const { sourceFile, targetFile, sourceTagId, targetInputTagId } = message.payload;
      const absSource = path.isAbsolute(sourceFile) ? sourceFile : path.join(workspaceRoot, sourceFile);
      const absTarget = path.isAbsolute(targetFile) ? targetFile : path.join(workspaceRoot, targetFile);

      const res = await connectWire(workspaceRoot, absSource, absTarget, sourceTagId, targetInputTagId);
      if (res.success) {
        currentPanel.webview.postMessage({ command: 'WIRE_CONNECTED' });
      } else {
        vscode.window.showWarningMessage(res.message || 'Failed to connect wire.');
      }
      break;
    }

    case 'DISCONNECT_WIRE': {
      const { targetFile, wireId } = message.payload;
      const absTarget = path.isAbsolute(targetFile) ? targetFile : path.join(workspaceRoot, targetFile);
      await disconnectWire(workspaceRoot, absTarget, wireId);
      currentPanel.webview.postMessage({ command: 'WIRE_CONNECTED' });
      break;
    }

    case 'DROP_COMPONENT': {
      const { component, activeScope } = message.payload;
      let targetRelPath = '';

      if (activeScope?.type === 'file' && activeScope.path) {
        targetRelPath = activeScope.path;
      } else {
        // Fall back to active text editor if open
        const activeDoc = vscode.window.activeTextEditor?.document;
        if (activeDoc && !activeDoc.isUntitled) {
          targetRelPath = path.relative(workspaceRoot, activeDoc.fileName);
        } else {
          // Find first matching file by language or first file in workspace
          const hierarchy = await scanWorkspaceHierarchy(workspaceRoot);
          if (hierarchy.files.length > 0) {
            targetRelPath = hierarchy.files[0].relPath;
          }
        }
      }

      if (!targetRelPath) {
        vscode.window.showWarningMessage('Please focus a file or open a file before dropping a component.');
        return;
      }

      const absTarget = path.join(workspaceRoot, targetRelPath);
      await dropComponentIntoFile(workspaceRoot, absTarget, component);

      // Refresh workspace canvas to render newly dropped component
      const refreshedHierarchy = await scanWorkspaceHierarchy(workspaceRoot);
      currentPanel.webview.postMessage({
        command: 'LOAD_WORKSPACE_DATA',
        payload: refreshedHierarchy
      });
      break;
    }

    case 'OPEN_FILE_IN_EDITOR': {
      const { fileRelPath } = message.payload;
      const absPath = path.isAbsolute(fileRelPath) ? fileRelPath : path.join(workspaceRoot, fileRelPath);
      try {
        const doc = await vscode.workspace.openTextDocument(absPath);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Could not open file: ${err.message}`);
      }
      break;
    }
  }
}

/**
 * Returns current panel or null.
 */
function getCurrentPanel() {
  return currentPanel;
}

/**
 * Generates the full HTML markup for the Drawflow canvas Webview.
 * @param {vscode.Webview} webview
 * @param {string} extensionPath
 * @returns {string}
 */
function getWebviewContent(webview, extensionPath) {
  const mediaPath = path.join(extensionPath, 'media');

  const mainCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'main.css')));
  const drawflowCssUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'drawflow.min.css')));
  const drawflowJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'drawflow.min.js')));
  const mainJsUri = webview.asWebviewUri(vscode.Uri.file(path.join(mediaPath, 'main.js')));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Auzy: Components View</title>
  <link rel="stylesheet" href="${drawflowCssUri}">
  <link rel="stylesheet" href="${mainCssUri}">
</head>
<body>
  <!-- Top Breadcrumb Navigation Bar -->
  <div id="top-nav">
    <div class="breadcrumb-item active">🏠 Workspace</div>
  </div>

  <!-- Floating Action Toolbar -->
  <div id="controls-bar">
    <button class="btn-ctrl" id="btn-zoom-in" title="Zoom In (+)">➕</button>
    <button class="btn-ctrl" id="btn-zoom-out" title="Zoom Out (-)">➖</button>
    <button class="btn-ctrl" id="btn-zoom-reset" title="Reset 100% (1:1)">⊙</button>
    <div class="ctrl-divider"></div>
    <button class="btn-ctrl" id="btn-refresh" title="Refresh Directory & Canvas">🔄</button>
    <button class="btn-ctrl" id="btn-palette-toggle" title="Toggle Component Palette">☰ Palette</button>
  </div>

  <!-- Component Palette Sidebar -->
  <div id="palette-drawer" class="hidden">
    <div class="palette-header">
      <div class="palette-title">📦 Component Library</div>
    </div>
    <div class="palette-tabs" id="palette-tabs"></div>
    <div class="palette-content" id="palette-content"></div>
  </div>

  <!-- Interactive Infinite Canvas Viewport -->
  <div id="canvas-container">
    <div id="world">
      <!-- Full-screen SVG Bezier Wires Layer -->
      <svg id="wires-layer"></svg>
    </div>
  </div>

  <!-- Modal & Dropdown Overlays -->
  <div id="modal-container"></div>
  <div id="floating-container"></div>

  <!-- Scripts -->
  <script src="${drawflowJsUri}"></script>
  <script src="${mainJsUri}"></script>
</body>
</html>`;
}

module.exports = {
  createOrShowWebviewPanel,
  getCurrentPanel
};

