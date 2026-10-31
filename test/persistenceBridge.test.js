/**
 * @file persistenceBridge.test.js
 * Unit tests for layout persistence, sources config, and metadata contracts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  saveWorkspaceLayout,
  loadWorkspaceLayout,
  saveSourcesConfig,
  loadSourcesConfig,
  saveVisualizerJson,
  loadVisualizerJson,
  getMirroredJsonPath
} = require('../src/persistenceBridge');

test('Persistence Bridge - Persists and reloads workspace layout across sessions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-layout-test-'));

  const layout = {
    viewport: { x: 100, y: 150, zoom: 0.8 },
    scope: { type: 'folder', path: 'backend' },
    folders: {
      backend: { x: 50, y: 50, width: 800, height: 600, isCollapsed: false }
    },
    files: {
      'backend/app.py': { x: 80, y: 100, width: 500, height: 400, isCollapsed: false }
    },
    components: {
      'backend/app.py::Server': { x: 90, y: 140 }
    }
  };

  const ok = saveWorkspaceLayout(tmpDir, layout);
  assert.equal(ok, true);

  const loaded = loadWorkspaceLayout(tmpDir);
  assert.equal(loaded.viewport.zoom, 0.8);
  assert.equal(loaded.scope.type, 'folder');
  assert.equal(loaded.folders.backend.width, 800);
  assert.equal(loaded.components['backend/app.py::Server'].x, 90);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Persistence Bridge - Computes mirrored relative path without collision', () => {
  const workspaceRoot = 'C:/Projects/MyWorkspace';
  const filePath = 'C:/Projects/MyWorkspace/src/sub/app.js';
  const mirrored = getMirroredJsonPath(workspaceRoot, filePath);

  const normalized = mirrored.replace(/\\/g, '/');
  assert.ok(normalized.endsWith('external-vscode-extension/Visualizer/src/sub/app.js.json'));
});

