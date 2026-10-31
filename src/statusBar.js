/**
 * @file statusBar.js
 * Creates and updates the VS Code status bar item: $(circuit-board) Auzy: Components View
 */

const vscode = require('vscode');

let statusBarItem = null;

/**
 * Initializes the Auzy Components View status bar button.
 * @param {vscode.ExtensionContext} context
 */
function createStatusBarItem(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'auzyComponentsView.openView';
  statusBarItem.text = '$(circuit-board) Auzy: Components View';
  statusBarItem.tooltip = 'Click to open the Auzy Components View Canvas';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);
  return statusBarItem;
}

module.exports = {
  createStatusBarItem
};

