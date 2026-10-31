/**
 * @file extension.js
 * Entry point for Auzy-Components-View extension.
 * Activates status bar button, commands, file watchers, and Webview canvas.
 */

const vscode = require('vscode');
const { createStatusBarItem } = require('./src/statusBar');
const { createOrShowWebviewPanel, getCurrentPanel } = require('./src/webviewPanelManager');
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

  const refreshCmd = vscode.commands.registerCommand('auzyComponentsView.refreshCanvas', () => {
    const panel = getCurrentPanel();
    if (panel) {
      panel.webview.postMessage({ command: 'REFRESH_WORKSPACE' });
    }
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
      const panel = getCurrentPanel();
      if (panel) {
        panel.webview.postMessage({ command: 'REFRESH_WORKSPACE' });
      }
      vscode.window.showInformationMessage('Auzy: Canvas layout reset.');
    }
  });

  context.subscriptions.push(openCmd, refreshCmd, resetLayoutCmd);

  // 3. File System Watcher for tag changes (decoupled interop with Extension #1)
  const visualizerWatcher = vscode.workspace.createFileSystemWatcher(
    '**/external-vscode-extension/Visualizer/**/*.json'
  );

  const onVisualizerChange = () => {
    const panel = getCurrentPanel();
    if (panel) {
      panel.webview.postMessage({ command: 'REFRESH_WORKSPACE' });
    }
  };

  visualizerWatcher.onDidChange(onVisualizerChange);
  visualizerWatcher.onDidCreate(onVisualizerChange);
  visualizerWatcher.onDidDelete(onVisualizerChange);
  context.subscriptions.push(visualizerWatcher);

  // 4. Document Save Listener to sync modified marker comments in code
  const docSaveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!doc.fileName.includes('Visualizer')) {
      const panel = getCurrentPanel();
      if (panel) {
        panel.webview.postMessage({ command: 'REFRESH_WORKSPACE' });
      }
    }
  });
  context.subscriptions.push(docSaveListener);
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

