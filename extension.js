/**
 * @file extension.js
 * Entry point for Auzy-Components-View extension.
 * Activates status bar button, commands, file watchers, and Webview canvas.
 */

const vscode = require('vscode');
const { createStatusBarItem } = require('./src/statusBar');
const { createOrShowWebviewPanel, getCurrentPanel, refreshWebview } = require('./src/webviewPanelManager');
const { saveWorkspaceLayout } = require('./src/persistenceBridge');

/**
 * Extension activation callback.
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  console.log('[Auzy-Components-View] Extension activated.');

  // 1. Initialize Status Bar Item: $(circuit-board) Auzy: Components View
  createStatusBarItem(context);

  // 2. Register Commands
  const openCmd = vscode.commands.registerCommand('auzyComponentsView.openView', () => {
    createOrShowWebviewPanel(context);
  });

  const refreshCmd = vscode.commands.registerCommand('auzyComponentsView.refreshCanvas', async () => {
    await refreshWebview();
  });

  const resetLayoutCmd = vscode.commands.registerCommand('auzyComponentsView.resetLayout', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      saveWorkspaceLayout(workspaceRoot, {
        viewport: { x: 40, y: 40, zoom: 1.0 },
        folders: {},
        files: {},
        components: {}
      });
      await refreshWebview();
      vscode.window.showInformationMessage('Auzy: Canvas layout reset.');
    }
  });

  context.subscriptions.push(openCmd, refreshCmd, resetLayoutCmd);

  // 3. File System Watcher for tag changes (decoupled interop with Extension #1)
  const visualizerWatcher = vscode.workspace.createFileSystemWatcher(
    '**/external-vscode-extension/Visualizer/**/*.json'
  );

  const onVisualizerChange = (uri) => {
    // Ignore layout file changes to prevent re-render loops during drag
    if (uri && uri.fsPath && uri.fsPath.endsWith('workspace-layout.json')) return;
    refreshWebview();
  };

  visualizerWatcher.onDidChange(onVisualizerChange);
  visualizerWatcher.onDidCreate(onVisualizerChange);
  visualizerWatcher.onDidDelete(onVisualizerChange);
  context.subscriptions.push(visualizerWatcher);

  // 4. Document Save Listener to sync modified marker comments in code
  const docSaveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!doc.fileName.includes('Visualizer')) {
      refreshWebview();
    }
  });
  context.subscriptions.push(docSaveListener);

  // 5. Document Change Listener (live debounced sync when typing or deleting components in editor)
  let docChangeTimer = null;
  const docChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
    if (!e.document.fileName.includes('Visualizer')) {
      if (docChangeTimer) clearTimeout(docChangeTimer);
      docChangeTimer = setTimeout(() => {
        refreshWebview();
      }, 400);
    }
  });
  context.subscriptions.push(docChangeListener);
}

/**
 * Extension deactivation callback.
 */
function deactivate() {
  console.log('[Auzy-Components-View] Extension deactivated.');
}

module.exports = {
  activate,
  deactivate
};

