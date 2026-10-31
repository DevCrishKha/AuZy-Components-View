/**
 * @file directoryScanner.test.js
 * Unit tests for hierarchical scanning of workspace folders, files, and components.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { scanWorkspaceHierarchy } = require('../src/directoryScanner');
const { saveVisualizerJson } = require('../src/persistenceBridge');

test('Directory Scanner - Builds recursive tree of folders, files, and components', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-scan-test-'));

  // Create structure:
  // tmpDir/
  //   rootFile.js
  //   services/
  //     authService.py
  const servicesDir = path.join(tmpDir, 'services');
  fs.mkdirSync(servicesDir, { recursive: true });

  const rootFile = path.join(tmpDir, 'rootFile.js');
  const authFile = path.join(servicesDir, 'authService.py');

  fs.writeFileSync(rootFile, `
// <{<< RootComp >>}>
const a = 1;
// </{<< RootComp >>}>
  `);

  fs.writeFileSync(authFile, `
# <{<< AuthComp >>}>
def authenticate():
    return True
# </{<< AuthComp >>}>
  `);

  // Add tag to AuthComp
  saveVisualizerJson(tmpDir, authFile, {
    tags: [
      {
        id: 't_auth',
        word: 'authenticate',
        category: 'function',
        range: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 16 }
      }
    ]
  });

  const hierarchy = await scanWorkspaceHierarchy(tmpDir);

  assert.equal(hierarchy.folders.length, 1);
  assert.equal(hierarchy.folders[0].relPath, 'services');

  assert.equal(hierarchy.files.length, 2);
  const authFileNode = hierarchy.files.find(f => f.name === 'authService.py');
  assert.ok(authFileNode);
  assert.equal(authFileNode.components.length, 1);
  assert.equal(authFileNode.components[0].name, 'AuthComp');
  assert.equal(authFileNode.components[0].tags.length, 1);

  assert.equal(hierarchy.stats.totalComponents, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

