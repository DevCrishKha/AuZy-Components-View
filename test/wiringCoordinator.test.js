/**
 * @file wiringCoordinator.test.js
 * Unit tests for port wiring, code mutation, tag conversions, and inline editing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  connectWire,
  disconnectWire,
  updateInputTagText,
  applyDefaultValue
} = require('../src/wiringCoordinator');
const { saveVisualizerJson, loadVisualizerJson } = require('../src/persistenceBridge');

test('Wiring Coordinator - Connects Output socket to Input socket and mutates code', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-wiring-test-'));

  const sourceFile = path.join(tmpDir, 'source.py');
  const targetFile = path.join(tmpDir, 'target.py');

  fs.writeFileSync(sourceFile, 'outputVar = 100\n');
  fs.writeFileSync(targetFile, 'userInput = 0\n');

  // Source tag: Output
  saveVisualizerJson(tmpDir, sourceFile, {
    tags: [
      {
        id: 'tag_out',
        word: 'outputVar',
        category: 'variable',
        variableSubType: 'Output',
        title: 'Output Variable',
        description: 'Result of calculation',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 }
      }
    ]
  });

  // Target tag: Input
  saveVisualizerJson(tmpDir, targetFile, {
    tags: [
      {
        id: 'tag_in',
        word: 'userInput',
        category: 'variable',
        variableSubType: 'Input',
        title: 'Input Value',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 }
      }
    ]
  });

  const res = await connectWire(tmpDir, sourceFile, targetFile, 'tag_out', 'tag_in');
  assert.equal(res.success, true);

  // Check code mutation
  const mutatedCode = fs.readFileSync(targetFile, 'utf8');
  assert.equal(mutatedCode, 'outputVar = 0\n');

  // Check tag conversion
  const updatedDoc = loadVisualizerJson(tmpDir, targetFile);
  const updatedTag = updatedDoc.tags.find(t => t.id === 'tag_in');
  assert.equal(updatedTag.word, 'outputVar');
  assert.equal(updatedTag.variableSubType, 'Output');
  assert.equal(updatedTag.title, 'Output Variable');
  assert.equal(updatedDoc.wires.length, 1);
  assert.equal(updatedDoc.wires[0].sourceTagId, 'tag_out');
  assert.equal(updatedDoc.wires[0].targetTagId, 'tag_in');

  // Test disconnect wire
  await disconnectWire(tmpDir, targetFile, updatedDoc.wires[0].id);
  const disconnectedDoc = loadVisualizerJson(tmpDir, targetFile);
  assert.equal(disconnectedDoc.wires.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Wiring Coordinator - In-node live text edit updates code and tag', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-edit-test-'));
  const testFile = path.join(tmpDir, 'script.js');

  fs.writeFileSync(testFile, 'let port = 3000;\n');
  saveVisualizerJson(tmpDir, testFile, {
    tags: [
      {
        id: 'tag_port',
        word: '3000',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 0, startCharacter: 11, endLine: 0, endCharacter: 15 }
      }
    ]
  });

  const ok = await updateInputTagText(tmpDir, testFile, 'tag_port', '8080');
  assert.equal(ok, true);

  const newCode = fs.readFileSync(testFile, 'utf8');
  assert.equal(newCode, 'let port = 8080;\n');

  const doc = loadVisualizerJson(tmpDir, testFile);
  assert.equal(doc.tags[0].word, '8080');
  assert.equal(doc.tags[0].range.endCharacter, 15);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

