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
const { saveVisualizerJson, loadVisualizerJson, saveWorkspaceLayout, loadWorkspaceLayout } = require('../src/persistenceBridge');

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

test('Directory Scanner - Recovers wires from workspace-layout.json if file JSON was overwritten on save', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-wire-recovery-test-'));
  const testFile = path.join(tmpDir, 'service.py');
  fs.writeFileSync(testFile, '# <{<< ServiceComp >>}>\nx = 1\n# </{<< ServiceComp >>}>\n');

  // 1. File JSON has tag but NO wires (simulating external Ctrl+S save)
  const { saveVisualizerJson, saveWorkspaceLayout, loadVisualizerJson } = require('../src/persistenceBridge');
  saveVisualizerJson(tmpDir, testFile, {
    tags: [
      { id: 'tag_1', word: 'x', category: 'variable', variableSubType: 'Input', range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 1 } }
    ],
    wires: []
  });

  // 2. workspace-layout.json has the persistent wire connection
  saveWorkspaceLayout(tmpDir, {
    viewport: { x: 0, y: 0, zoom: 1 },
    wires: [
      { id: 'wire_persisted', sourceTagId: 'tag_out', targetTagId: 'tag_1', sourceFile: 'app.py', targetFile: 'service.py' }
    ]
  });

  // 3. Scan workspace
  const hierarchy = await scanWorkspaceHierarchy(tmpDir);
  const fileNode = hierarchy.files.find(f => f.name === 'service.py');
  assert.ok(fileNode);
  assert.equal(fileNode.wires.length, 1);
  assert.equal(fileNode.wires[0].id, 'wire_persisted');

  // 4. File JSON should also have been resynchronized
  const fileJson = loadVisualizerJson(tmpDir, testFile);
  assert.ok(fileJson.wires);
  assert.equal(fileJson.wires.length, 1);
  assert.equal(fileJson.wires[0].id, 'wire_persisted');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});


test('Directory Scanner - Canvas refresh preserves connections when wired tags have matching text', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-refresh-matching-wire-'));
  const file1 = path.join(tmpDir, 'source.py');
  const file2 = path.join(tmpDir, 'target.py');

  fs.writeFileSync(file1, '# <{<< SourceComp >>}>\nout_val = "synchronized"\n# </{<< SourceComp >>}>\n');
  fs.writeFileSync(file2, '# <{<< TargetComp >>}>\nin_val = "synchronized"\n# </{<< TargetComp >>}>\n');

  saveVisualizerJson(tmpDir, file1, {
    tags: [
      { id: 'tag_out_match', word: '"synchronized"', category: 'variable', variableSubType: 'Output', range: { startLine: 1, startCharacter: 10, endLine: 1, endCharacter: 24 } }
    ]
  });

  saveVisualizerJson(tmpDir, file2, {
    tags: [
      { id: 'tag_in_match', word: '"synchronized"', category: 'variable', variableSubType: 'Input', range: { startLine: 1, startCharacter: 9, endLine: 1, endCharacter: 23 } }
    ],
    wires: [
      { id: 'wire_matching', sourceTagId: 'tag_out_match', targetTagId: 'tag_in_match', sourceFile: 'source.py', targetFile: 'target.py' }
    ]
  });

  saveWorkspaceLayout(tmpDir, {
    wires: [
      { id: 'wire_matching', sourceTagId: 'tag_out_match', targetTagId: 'tag_in_match', sourceFile: 'source.py', targetFile: 'target.py' }
    ]
  });

  const hierarchy = await scanWorkspaceHierarchy(tmpDir);
  const targetNode = hierarchy.files.find(f => f.name === 'target.py');
  assert.ok(targetNode);
  assert.equal(targetNode.wires.length, 1);
  assert.equal(targetNode.wires[0].id, 'wire_matching');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Directory Scanner - Canvas refresh removes connection when wired tags have mismatched text', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-refresh-mismatch-wire-'));
  const file1 = path.join(tmpDir, 'source.py');
  const file2 = path.join(tmpDir, 'target.py');

  fs.writeFileSync(file1, '# <{<< SourceComp >>}>\nout_val = "source_text"\n# </{<< SourceComp >>}>\n');
  fs.writeFileSync(file2, '# <{<< TargetComp >>}>\nin_val = "different_text"\n# </{<< TargetComp >>}>\n');

  saveVisualizerJson(tmpDir, file1, {
    tags: [
      { id: 'tag_out_diff', word: '"source_text"', category: 'variable', variableSubType: 'Output', range: { startLine: 1, startCharacter: 10, endLine: 1, endCharacter: 23 } }
    ]
  });

  saveVisualizerJson(tmpDir, file2, {
    tags: [
      { id: 'tag_in_diff', word: '"different_text"', category: 'variable', variableSubType: 'Input', range: { startLine: 1, startCharacter: 9, endLine: 1, endCharacter: 25 } },
      { id: 'tag_unconnected', word: 'unrelated', category: 'variable', variableSubType: 'Input', range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 6 } }
    ],
    wires: [
      { id: 'wire_mismatched', sourceTagId: 'tag_out_diff', targetTagId: 'tag_in_diff', sourceFile: 'source.py', targetFile: 'target.py' }
    ]
  });

  saveWorkspaceLayout(tmpDir, {
    wires: [
      { id: 'wire_mismatched', sourceTagId: 'tag_out_diff', targetTagId: 'tag_in_diff', sourceFile: 'source.py', targetFile: 'target.py' }
    ]
  });

  // Canvas refreshes -> triggers scanWorkspaceHierarchy
  const hierarchy = await scanWorkspaceHierarchy(tmpDir);
  const targetNode = hierarchy.files.find(f => f.name === 'target.py');
  assert.ok(targetNode);

  // 1. Connection must be removed because text inside connected tags is not the same
  assert.equal(targetNode.wires.length, 0);

  // 2. Wire must be removed from target file's Visualizer JSON on disk
  const targetJson = loadVisualizerJson(tmpDir, file2);
  assert.equal(targetJson.wires.length, 0);

  // 3. Unconnected tag is unaffected
  assert.equal(targetJson.tags.length, 2);

  // 4. Wire must be removed from workspace-layout.json on disk
  const layout = loadWorkspaceLayout(tmpDir);
  assert.equal((layout.wires || []).length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});


test('Directory Scanner - Canvas refresh removes input-to-default wire when text diverges', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-diverge-def-test-'));
  const testFile = path.join(tmpDir, 'app.py');

  fs.writeFileSync(testFile, '# <{<< MainComp >>}>\na = 1\nb = 2\n# </{<< MainComp >>}>\n');

  saveVisualizerJson(tmpDir, testFile, {
    tags: [
      { id: 'tag_def_diverge', word: '1', category: 'variable', variableSubType: 'Default', range: { startLine: 1, startCharacter: 4, endLine: 1, endCharacter: 5 } },
      { id: 'tag_in_diverge', word: '99', category: 'variable', variableSubType: 'Input', range: { startLine: 2, startCharacter: 4, endLine: 2, endCharacter: 6 } }
    ],
    wires: [
      { id: 'wire_diverged', sourceTagId: 'tag_def_diverge', targetTagId: 'tag_in_diverge', sourceFile: 'app.py', targetFile: 'app.py' }
    ]
  });

  saveWorkspaceLayout(tmpDir, {
    wires: [
      { id: 'wire_diverged', sourceTagId: 'tag_def_diverge', targetTagId: 'tag_in_diverge', sourceFile: 'app.py', targetFile: 'app.py' }
    ]
  });

  const hierarchy = await scanWorkspaceHierarchy(tmpDir);
  const fileNode = hierarchy.files.find(f => f.name === 'app.py');
  assert.ok(fileNode);

  // Wire should be removed since 1 !== 99
  assert.equal(fileNode.wires.length, 0);

  const updatedJson = loadVisualizerJson(tmpDir, testFile);
  assert.equal(updatedJson.wires.length, 0);

  const updatedLayout = loadWorkspaceLayout(tmpDir);
  assert.equal((updatedLayout.wires || []).length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
