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
  applyDefaultValue,
  deleteComponentFromFile
} = require('../src/wiringCoordinator');
const { saveVisualizerJson, loadVisualizerJson, saveWorkspaceLayout, loadWorkspaceLayout } = require('../src/persistenceBridge');

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

  // Check tag updates: in Auzy-Components-View, only text value changes, subtype stays Input, title/description stay same
  const updatedDoc = loadVisualizerJson(tmpDir, targetFile);
  const updatedTag = updatedDoc.tags.find(t => t.id === 'tag_in');
  assert.equal(updatedTag.word, 'outputVar');
  assert.equal(updatedTag.variableSubType, 'Input');
  assert.equal(updatedTag.title, 'Input Value');
  assert.equal(updatedDoc.wires.length, 1);
  assert.equal(updatedDoc.wires[0].sourceTagId, 'tag_out');
  assert.equal(updatedDoc.wires[0].targetTagId, 'tag_in');

  // Verify wire was also synced to workspace-layout.json
  const layoutWithWire = loadWorkspaceLayout(tmpDir);
  assert.ok(layoutWithWire.wires);
  assert.equal(layoutWithWire.wires.length, 1);
  assert.equal(layoutWithWire.wires[0].targetTagId, 'tag_in');

  // Test disconnect wire
  await disconnectWire(tmpDir, targetFile, updatedDoc.wires[0].id);
  const disconnectedDoc = loadVisualizerJson(tmpDir, targetFile);
  assert.equal(disconnectedDoc.wires.length, 0);

  // Verify wire was removed from workspace-layout.json as well
  const layoutAfterDisconnect = loadWorkspaceLayout(tmpDir);
  assert.equal(layoutAfterDisconnect.wires.length, 0);

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

test('Wiring Coordinator - Deletes component from code file and shifts remaining tags', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-delete-comp-test-'));
  const testFile = path.join(tmpDir, 'module.js');

  const initialCode = [
    '// line 0',
    '// <{<< TargetComp >>}>',
    'const a = 1;',
    'const b = 2;',
    '// </{<< TargetComp >>}>',
    '// line 5 after',
    '// <{<< SecondComp >>}>',
    'const c = 3;',
    '// </{<< SecondComp >>}>'
  ].join('\n') + '\n';

  fs.writeFileSync(testFile, initialCode);

  saveVisualizerJson(tmpDir, testFile, {
    tags: [
      {
        id: 'tag_inside',
        word: 'a',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 2, startCharacter: 6, endLine: 2, endCharacter: 7 }
      },
      {
        id: 'tag_second',
        word: 'c',
        category: 'variable',
        variableSubType: 'Output',
        range: { startLine: 7, startCharacter: 6, endLine: 7, endCharacter: 7 }
      }
    ],
    wires: [
      { id: 'w1', sourceTagId: 'tag_second', targetTagId: 'tag_inside' }
    ]
  });

  const ok = await deleteComponentFromFile(tmpDir, 'module.js', 'TargetComp');
  assert.equal(ok, true);

  const newCode = fs.readFileSync(testFile, 'utf8');
  assert.ok(!newCode.includes('TargetComp'));
  assert.ok(!newCode.includes('const a = 1;'));
  assert.ok(newCode.includes('SecondComp'));
  assert.ok(newCode.includes('const c = 3;'));

  const doc = loadVisualizerJson(tmpDir, testFile);
  // tag_inside should be deleted
  assert.equal(doc.tags.length, 1);
  assert.equal(doc.tags[0].id, 'tag_second');
  // Second tag's line range should be shifted up by 4 lines (lines 1 to 4 deleted)
  assert.equal(doc.tags[0].range.startLine, 3);
  // Wire connected to deleted tag should be removed
  assert.equal(doc.wires.length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});



test('Wiring Coordinator - Wiring at end of line does not bleed into next line', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-eol-test-'));
  const sourceFile = path.join(tmpDir, 'source.py');
  const targetFile = path.join(tmpDir, 'target.py');

  fs.writeFileSync(sourceFile, 'outputValue = "new_database_host"\n');
  fs.writeFileSync(targetFile, 'dbHost = "localhost"\nnext_line = 123\n');

  saveVisualizerJson(tmpDir, sourceFile, {
    tags: [
      {
        id: 'tag_source',
        word: '"new_database_host"',
        category: 'variable',
        variableSubType: 'Output',
        range: { startLine: 0, startCharacter: 14, endLine: 0, endCharacter: 35 }
      }
    ]
  });

  saveVisualizerJson(tmpDir, targetFile, {
    tags: [
      {
        id: 'tag_target_eol',
        word: '"localhost"',
        category: 'variable',
        variableSubType: 'Input',
        title: 'DB Host Input',
        range: { startLine: 0, startCharacter: 9, endLine: 1, endCharacter: 0 }
      },
      {
        id: 'tag_next_line',
        word: '123',
        category: 'variable',
        variableSubType: 'Default',
        range: { startLine: 1, startCharacter: 12, endLine: 1, endCharacter: 15 }
      }
    ]
  });

  const res = await connectWire(tmpDir, sourceFile, targetFile, 'tag_source', 'tag_target_eol');
  assert.equal(res.success, true);

  const updatedDoc = loadVisualizerJson(tmpDir, targetFile);
  const wiredTag = updatedDoc.tags.find(t => t.id === 'tag_target_eol');
  const nextLineTag = updatedDoc.tags.find(t => t.id === 'tag_next_line');

  assert.equal(wiredTag.word, '"new_database_host"');
  assert.equal(wiredTag.range.startLine, 0);
  assert.equal(wiredTag.range.startCharacter, 9);
  assert.equal(wiredTag.range.endLine, 0);
  assert.equal(wiredTag.range.endCharacter, 9 + '"new_database_host"'.length);

  assert.equal(nextLineTag.range.startLine, 1);
  assert.equal(nextLineTag.range.startCharacter, 12);
  assert.equal(nextLineTag.range.endLine, 1);
  assert.equal(nextLineTag.range.endCharacter, 15);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Wiring Coordinator - Shifts adjacent tags on same line without corruption', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-shift-test-'));
  const sourceFile = path.join(tmpDir, 'source.py');
  const targetFile = path.join(tmpDir, 'target.py');

  fs.writeFileSync(sourceFile, 'longToken = "super_long_replacement_text"\n');
  fs.writeFileSync(targetFile, 'a = "short"; b = "next"\n');

  saveVisualizerJson(tmpDir, sourceFile, {
    tags: [
      {
        id: 'tag_long',
        word: '"super_long_replacement_text"',
        category: 'variable',
        variableSubType: 'Output',
        range: { startLine: 0, startCharacter: 12, endLine: 0, endCharacter: 41 }
      }
    ]
  });

  saveVisualizerJson(tmpDir, targetFile, {
    tags: [
      {
        id: 'tag_a',
        word: '"short"',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 11 }
      },
      {
        id: 'tag_b',
        word: '"next"',
        category: 'variable',
        variableSubType: 'Default',
        range: { startLine: 0, startCharacter: 17, endLine: 0, endCharacter: 23 }
      }
    ]
  });

  const res = await connectWire(tmpDir, sourceFile, targetFile, 'tag_long', 'tag_a');
  assert.equal(res.success, true);

  const updatedDoc = loadVisualizerJson(tmpDir, targetFile);
  const tagA = updatedDoc.tags.find(t => t.id === 'tag_a');
  const tagB = updatedDoc.tags.find(t => t.id === 'tag_b');

  assert.equal(tagA.word, '"super_long_replacement_text"');
  assert.equal(tagA.range.startLine, 0);
  assert.equal(tagA.range.startCharacter, 4);
  assert.equal(tagA.range.endLine, 0);
  assert.equal(tagA.range.endCharacter, 4 + 29);

  assert.equal(tagB.range.startLine, 0);
  assert.equal(tagB.range.startCharacter, 17 + 22);
  assert.equal(tagB.range.endLine, 0);
  assert.equal(tagB.range.endCharacter, 23 + 22);

  const code = fs.readFileSync(targetFile, 'utf8');
  assert.equal(code, 'a = "super_long_replacement_text"; b = "next"\n');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});


test('Wiring Coordinator - Changing text in a Default tag propagates to connected Input tag', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-default-propagate-test-'));
  const sourceFile = path.join(tmpDir, 'source.py');
  const targetFile = path.join(tmpDir, 'target.py');

  fs.writeFileSync(sourceFile, 'defaultVar = "initial_val"\n');
  fs.writeFileSync(targetFile, 'inputVar = "initial_val"\n');

  saveVisualizerJson(tmpDir, sourceFile, {
    tags: [
      {
        id: 'tag_def_1',
        word: '"initial_val"',
        category: 'variable',
        variableSubType: 'Default',
        defaultValues: ['"initial_val"', '"updated_val"', '"alt_val"'],
        range: { startLine: 0, startCharacter: 13, endLine: 0, endCharacter: 26 }
      }
    ]
  });

  saveVisualizerJson(tmpDir, targetFile, {
    tags: [
      {
        id: 'tag_in_1',
        word: '"initial_val"',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 0, startCharacter: 11, endLine: 0, endCharacter: 24 }
      }
    ],
    wires: [
      {
        id: 'wire_def_to_in',
        sourceTagId: 'tag_def_1',
        targetTagId: 'tag_in_1',
        sourceFile: 'source.py',
        targetFile: 'target.py'
      }
    ]
  });

  saveWorkspaceLayout(tmpDir, {
    wires: [
      {
        id: 'wire_def_to_in',
        sourceTagId: 'tag_def_1',
        targetTagId: 'tag_in_1',
        sourceFile: 'source.py',
        targetFile: 'target.py'
      }
    ]
  });

  // Change default tag's value to '"updated_val"'
  const success = await applyDefaultValue(tmpDir, sourceFile, 'tag_def_1', '"updated_val"');
  assert.equal(success, true);

  // 1. Verify Default tag in source file and source JSON
  const updatedSourceDoc = loadVisualizerJson(tmpDir, sourceFile);
  const defTag = updatedSourceDoc.tags.find(t => t.id === 'tag_def_1');
  assert.equal(defTag.word, '"updated_val"');
  const sourceCode = fs.readFileSync(sourceFile, 'utf8');
  assert.equal(sourceCode, 'defaultVar = "updated_val"\n');

  // 2. Verify connected Input tag in target file and target JSON also changed
  const updatedTargetDoc = loadVisualizerJson(tmpDir, targetFile);
  const inTag = updatedTargetDoc.tags.find(t => t.id === 'tag_in_1');
  assert.equal(inTag.word, '"updated_val"');
  const targetCode = fs.readFileSync(targetFile, 'utf8');
  assert.equal(targetCode, 'inputVar = "updated_val"\n');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Wiring Coordinator - Changing Default tag text propagates to multiple connected Input tags', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-default-multi-propagate-'));
  const sourceFile = path.join(tmpDir, 'service.py');
  const targetFile1 = path.join(tmpDir, 'consumer1.py');
  const targetFile2 = path.join(tmpDir, 'consumer2.py');

  fs.writeFileSync(sourceFile, 'cfg = 8080\n');
  fs.writeFileSync(targetFile1, 'port1 = 8080\n');
  fs.writeFileSync(targetFile2, 'port2 = 8080\n');

  saveVisualizerJson(tmpDir, sourceFile, {
    tags: [
      {
        id: 'tag_cfg',
        word: '8080',
        category: 'variable',
        variableSubType: 'Default',
        range: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 10 }
      }
    ]
  });

  saveVisualizerJson(tmpDir, targetFile1, {
    tags: [
      {
        id: 'tag_c1',
        word: '8080',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 0, startCharacter: 8, endLine: 0, endCharacter: 12 }
      }
    ],
    wires: [
      { id: 'w1', sourceTagId: 'tag_cfg', targetTagId: 'tag_c1', sourceFile: 'service.py', targetFile: 'consumer1.py' }
    ]
  });

  saveVisualizerJson(tmpDir, targetFile2, {
    tags: [
      {
        id: 'tag_c2',
        word: '8080',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 0, startCharacter: 8, endLine: 0, endCharacter: 12 }
      }
    ],
    wires: [
      { id: 'w2', sourceTagId: 'tag_cfg', targetTagId: 'tag_c2', sourceFile: 'service.py', targetFile: 'consumer2.py' }
    ]
  });

  saveWorkspaceLayout(tmpDir, {
    wires: [
      { id: 'w1', sourceTagId: 'tag_cfg', targetTagId: 'tag_c1', sourceFile: 'service.py', targetFile: 'consumer1.py' },
      { id: 'w2', sourceTagId: 'tag_cfg', targetTagId: 'tag_c2', sourceFile: 'service.py', targetFile: 'consumer2.py' }
    ]
  });

  // Update default tag
  await updateInputTagText(tmpDir, sourceFile, 'tag_cfg', '9090');

  // Assert consumer 1
  const doc1 = loadVisualizerJson(tmpDir, targetFile1);
  assert.equal(doc1.tags[0].word, '9090');
  assert.equal(fs.readFileSync(targetFile1, 'utf8'), 'port1 = 9090\n');

  // Assert consumer 2
  const doc2 = loadVisualizerJson(tmpDir, targetFile2);
  assert.equal(doc2.tags[0].word, '9090');
  assert.equal(fs.readFileSync(targetFile2, 'utf8'), 'port2 = 9090\n');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});


test('Wiring Coordinator - Changing Default tag propagates to connected Input tag in the same file', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzy-same-file-def-test-'));
  const testFile = path.join(tmpDir, 'module.py');

  fs.writeFileSync(testFile, 'defaultSetting = "old"\nconsumerSetting = "old"\n');

  saveVisualizerJson(tmpDir, testFile, {
    tags: [
      {
        id: 'tag_d_same',
        word: '"old"',
        category: 'variable',
        variableSubType: 'Default',
        range: { startLine: 0, startCharacter: 17, endLine: 0, endCharacter: 22 }
      },
      {
        id: 'tag_i_same',
        word: '"old"',
        category: 'variable',
        variableSubType: 'Input',
        range: { startLine: 1, startCharacter: 18, endLine: 1, endCharacter: 23 }
      }
    ],
    wires: [
      {
        id: 'w_same',
        sourceTagId: 'tag_d_same',
        targetTagId: 'tag_i_same',
        sourceFile: 'module.py',
        targetFile: 'module.py'
      }
    ]
  });

  saveWorkspaceLayout(tmpDir, {
    wires: [
      {
        id: 'w_same',
        sourceTagId: 'tag_d_same',
        targetTagId: 'tag_i_same',
        sourceFile: 'module.py',
        targetFile: 'module.py'
      }
    ]
  });

  // Apply new default value
  await applyDefaultValue(tmpDir, testFile, 'tag_d_same', '"super_new_value"');

  const doc = loadVisualizerJson(tmpDir, testFile);
  const tagD = doc.tags.find(t => t.id === 'tag_d_same');
  const tagI = doc.tags.find(t => t.id === 'tag_i_same');

  assert.equal(tagD.word, '"super_new_value"');
  assert.equal(tagI.word, '"super_new_value"');

  const fileContent = fs.readFileSync(testFile, 'utf8');
  assert.equal(fileContent, 'defaultSetting = "super_new_value"\nconsumerSetting = "super_new_value"\n');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
