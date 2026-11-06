/**
 * @file wiringCoordinator.js
 * Handles port connections (Output/Default -> Input), code token replacements,
 * tag schema mutations, live input text editing, and default value applications.
 */

const fs = require('fs');
const path = require('path');
let vscode;
try {
  vscode = require('vscode');
} catch (_) {
  // Pure Node environment (e.g. unit tests)
}
const { RangeEngine } = require('./rangeEngine');
const { parseComponentsFromSource } = require('./markerParser');
const { loadVisualizerJson, saveVisualizerJson, loadWorkspaceLayout, saveWorkspaceLayout } = require('./persistenceBridge');

/**
 * Normalizes a file path or URI to an absolute filesystem path.
 * @param {string} fileUriOrPath
 * @returns {string}
 */
function toLocalPath(fileUriOrPath) {
  if (fileUriOrPath.startsWith('file:///')) {
    let clean = fileUriOrPath.replace(/^file:\/\/\//, '');
    clean = decodeURIComponent(clean);
    // On Windows, fix c:/ to C:/
    if (/^[a-zA-Z]:/.test(clean)) {
      clean = clean[0].toUpperCase() + clean.slice(1);
    }
    return path.normalize(clean);
  }
  return path.resolve(fileUriOrPath);
}

/**
 * Sanitizes a tag's range so that single-line keyword tokens never swallow trailing
 * newlines (\r\n or \n) or bleed into the next line.
 * @param {Object} range - { startLine, startCharacter, endLine, endCharacter }
 * @param {string} word - Token text
 * @returns {{ startLine: number, startCharacter: number, endLine: number, endCharacter: number }}
 */
function sanitizeTagRange(range, word = '') {
  const startLine = range.startLine;
  const startCharacter = range.startCharacter;
  let endLine = typeof range.endLine === 'number' ? range.endLine : startLine;
  let endCharacter = range.endCharacter;

  // If the stored selection spanned across a newline (e.g. endLine > startLine with endCharacter: 0)
  // clamp it strictly to startLine and the word length so newlines are never deleted or corrupted.
  if (endLine > startLine) {
    endLine = startLine;
    endCharacter = startCharacter + (word ? word.length : 0);
  }

  return {
    startLine,
    startCharacter,
    endLine,
    endCharacter
  };
}

/**
 * Replaces text in a file on disk, strictly preserving original CRLF/LF line endings
 * and properly handling multi-line ranges.
 * @param {string} filePath
 * @param {Object} range - { startLine, startCharacter, endLine, endCharacter }
 * @param {string} replacementText
 * @returns {boolean}
 */
function replaceTextInRange(filePath, range, replacementText) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf8');
  const isCrlf = content.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);

  if (range.startLine >= lines.length) return false;

  const startLine = range.startLine;
  const endLine = typeof range.endLine === 'number' ? range.endLine : startLine;
  const startChar = range.startCharacter;
  const endChar = range.endCharacter;

  if (startLine === endLine) {
    const line = lines[startLine];
    const before = line.slice(0, startChar);
    const after = line.slice(endChar);
    lines[startLine] = before + replacementText + after;
  } else {
    const firstLineBefore = lines[startLine].slice(0, startChar);
    const lastLineAfter = (endLine < lines.length) ? lines[endLine].slice(endChar) : '';
    const replacementLines = replacementText.split(/\r?\n/);
    replacementLines[0] = firstLineBefore + replacementLines[0];
    replacementLines[replacementLines.length - 1] = replacementLines[replacementLines.length - 1] + lastLineAfter;
    lines.splice(startLine, endLine - startLine + 1, ...replacementLines);
  }

  const updatedContent = lines.join(eol);
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  return true;
}

/**
 * Replaces text in a source file at the exact range.
 * If running inside VS Code extension host, uses vscode.workspace.applyEdit
 * to preserve CRLF/LF line endings, update open editor buffers cleanly,
 * and emit targeted document change events.
 * Falls back to disk-based replacement when running outside VS Code (e.g. tests).
 * 
 * @param {string} filePath
 * @param {Object} range - { startLine, startCharacter, endLine, endCharacter }
 * @param {string} replacementText
 * @returns {Promise<boolean>}
 */
async function replaceTextInFile(filePath, range, replacementText) {
  const normPath = toLocalPath(filePath);

  if (vscode && vscode.workspace) {
    try {
      const uri = vscode.Uri.file(normPath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const startLine = range.startLine;
      const startChar = range.startCharacter;
      const endLine = typeof range.endLine === 'number' ? range.endLine : startLine;
      const endChar = range.endCharacter;

      const targetRange = new vscode.Range(startLine, startChar, endLine, endChar);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, targetRange, replacementText);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        await doc.save();
        return true;
      }
    } catch (err) {
      console.warn('[WiringCoordinator] vscode.workspace.applyEdit fallback to disk write:', err);
    }
  }

  return replaceTextInRange(normPath, range, replacementText);
}

/**
 * Connects an Output or Default tag's socket to an Input tag socket.
 * Mutates the target source code, preserves the Input tag's identity and metadata,
 * shifts adjacent tags accurately using RangeEngine, and strictly enforces single-line boundaries.
 * 
 * @param {string} workspaceRoot
 * @param {string} sourceFilePath
 * @param {string} targetFilePath
 * @param {string} sourceTagId
 * @param {string} targetInputTagId
 * @returns {Promise<{ success: boolean, message?: string, wire?: Object }>}
 */
async function connectWire(workspaceRoot, sourceFilePath, targetFilePath, sourceTagId, targetInputTagId) {
  const absSource = toLocalPath(sourceFilePath);
  const absTarget = toLocalPath(targetFilePath);

  const sourceDoc = loadVisualizerJson(workspaceRoot, absSource);
  const targetDoc = loadVisualizerJson(workspaceRoot, absTarget);

  if (!sourceDoc || !targetDoc) {
    return { success: false, message: 'Could not load metadata for wiring files.' };
  }

  const sourceTag = (sourceDoc.tags || []).find(t => t.id === sourceTagId);
  const targetTag = (targetDoc.tags || []).find(t => t.id === targetInputTagId);

  if (!sourceTag) {
    return { success: false, message: `Source tag ${sourceTagId} not found.` };
  }
  if (!targetTag) {
    return { success: false, message: `Target tag ${targetInputTagId} not found.` };
  }

  // Validate port connection compatibility
  const isSourceValid = sourceTag.variableSubType === 'Output' || sourceTag.variableSubType === 'Default';
  const isTargetValid = targetTag.variableSubType === 'Input';

  if (!isSourceValid) {
    return { success: false, message: 'Wire source must be an Output or Default tag.' };
  }
  if (!isTargetValid) {
    return { success: false, message: 'Wire target must be an Input tag.' };
  }

  // Trim any trailing newline or carriage return so it never bleeds into adjacent lines
  const liveText = (sourceTag.word || '').replace(/[\r\n]+$/, '');
  const cleanRange = sanitizeTagRange(targetTag.range, targetTag.word);
  const targetStartLine = cleanRange.startLine;
  const targetStartChar = cleanRange.startCharacter;
  const targetEndLine = cleanRange.endLine;
  const targetEndChar = cleanRange.endCharacter;

  // 1. Mutate target source code file (in-editor buffer or disk)
  await replaceTextInFile(absTarget, cleanRange, liveText);

  // 2. Adjust all tags in target document using RangeEngine so adjacent tags shift accurately
  const contentChange = {
    range: {
      start: { line: targetStartLine, character: targetStartChar },
      end: { line: targetEndLine, character: targetEndChar }
    },
    text: liveText
  };
  const { updatedTags } = RangeEngine.applyContentChanges(targetDoc.tags || [], [contentChange]);
  targetDoc.tags = updatedTags;

  // 3. Mutate target tag in Visualizer JSON:
  // In Auzy-Components-View: ONLY the text value (word) changes and endCharacter is updated!
  // Its Title, description, category, and appearance (variableSubType: "Input") stay the same.
  // Crucially: normalize endLine to startLine so it strictly matches the token and NEVER bleeds to the next line.
  const updatedTargetTag = (targetDoc.tags || []).find(t => t.id === targetInputTagId);
  if (updatedTargetTag) {
    updatedTargetTag.word = liveText;
    updatedTargetTag.range.startLine = targetStartLine;
    updatedTargetTag.range.startCharacter = targetStartChar;
    updatedTargetTag.range.endLine = targetStartLine;
    updatedTargetTag.range.endCharacter = targetStartChar + liveText.length;
  }

  // 4. Record wire in target file metadata
  if (!targetDoc.wires) {
    targetDoc.wires = [];
  }

  // Remove any previous wire connected to this target input port
  targetDoc.wires = targetDoc.wires.filter(w => w.targetTagId !== targetInputTagId);

  const wireRecord = {
    id: `wire_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    sourceTagId,
    targetTagId: targetInputTagId,
    sourceFile: path.relative(workspaceRoot, absSource).replace(/\\/g, '/'),
    targetFile: path.relative(workspaceRoot, absTarget).replace(/\\/g, '/')
  };
  targetDoc.wires.push(wireRecord);

  // Save updated JSON
  saveVisualizerJson(workspaceRoot, absTarget, targetDoc);

  // Dual persistence: sync wire into workspace-layout.json
  const layout = loadWorkspaceLayout(workspaceRoot) || {};
  if (!layout.wires) layout.wires = [];
  layout.wires = layout.wires.filter(w => w.targetTagId !== targetInputTagId);
  layout.wires.push(wireRecord);
  saveWorkspaceLayout(workspaceRoot, layout);

  return { success: true, wire: wireRecord };
}

/**
 * Removes a wire connection.
 * @param {string} workspaceRoot
 * @param {string} targetFilePath
 * @param {string} wireId
 */
async function disconnectWire(workspaceRoot, targetFilePath, wireId) {
  const absTarget = toLocalPath(targetFilePath);
  const targetDoc = loadVisualizerJson(workspaceRoot, absTarget);
  if (targetDoc && targetDoc.wires) {
    targetDoc.wires = targetDoc.wires.filter(w => w.id !== wireId);
    saveVisualizerJson(workspaceRoot, absTarget, targetDoc);
  }

  const layout = loadWorkspaceLayout(workspaceRoot);
  if (layout && layout.wires) {
    layout.wires = layout.wires.filter(w => w.id !== wireId);
    saveWorkspaceLayout(workspaceRoot, layout);
  }
  return true;
}

/**
 * Retrieves all wire records defined in workspace-layout.json and mirrored Visualizer JSON files.
 * @param {string} workspaceRoot
 * @returns {Array<Object>}
 */
function getAllWorkspaceWires(workspaceRoot) {
  const wires = [];
  const seenIds = new Set();

  // 1. Read wires from workspace-layout.json
  const layout = loadWorkspaceLayout(workspaceRoot);
  if (layout && Array.isArray(layout.wires)) {
    for (const w of layout.wires) {
      const wireKey = w.id || `${w.sourceTagId}->${w.targetTagId}`;
      if (!seenIds.has(wireKey)) {
        seenIds.add(wireKey);
        wires.push(w);
      }
    }
  }

  // 2. Scan mirrored Visualizer JSON files for any wires not yet synced into layout
  const visDir = path.join(workspaceRoot, 'external-vscode-extension', 'Visualizer');
  if (fs.existsSync(visDir)) {
    function scanVisDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanVisDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'workspace-layout.json' && entry.name !== 'sources.json') {
            try {
              const fileDoc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
              if (fileDoc && Array.isArray(fileDoc.wires)) {
                for (const w of fileDoc.wires) {
                  const wireKey = w.id || `${w.sourceTagId}->${w.targetTagId}`;
                  if (!seenIds.has(wireKey)) {
                    seenIds.add(wireKey);
                    wires.push(w);
                  }
                }
              }
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    scanVisDir(visDir);
  }

  return wires;
}

/**
 * Propagates text changes from a Default tag to all connected Input tags in the workspace.
 * Mutates the target source files and synchronizes their tag metadata.
 * @param {string} workspaceRoot
 * @param {string} defaultTagId
 * @param {string} newText
 */
async function propagateDefaultTagChange(workspaceRoot, defaultTagId, newText) {
  const wires = getAllWorkspaceWires(workspaceRoot);
  const connectedWires = wires.filter(w => w.sourceTagId === defaultTagId);

  for (const wire of connectedWires) {
    if (!wire.targetFile || !wire.targetTagId) continue;
    const targetAbs = toLocalPath(
      path.isAbsolute(wire.targetFile)
        ? wire.targetFile
        : path.join(workspaceRoot, wire.targetFile)
    );
    const targetDoc = loadVisualizerJson(workspaceRoot, targetAbs);
    if (!targetDoc) continue;

    const targetTag = (targetDoc.tags || []).find(t => t.id === wire.targetTagId);
    // Only propagate to valid Input tags
    if (targetTag && targetTag.variableSubType === 'Input') {
      await updateInputTagText(workspaceRoot, targetAbs, wire.targetTagId, newText, false);
    }
  }
}

/**
 * Updates text typed directly into an inline Input or Default tag box.
 * If the tag is a Default tag, automatically propagates the new text to any connected Input tags.
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @param {string} tagId
 * @param {string} newText
 * @param {boolean} [propagateDefault=true] - Whether to propagate Default tag changes to connected Input tags
 */
async function updateInputTagText(workspaceRoot, filePath, tagId, newText, propagateDefault = true) {
  const absPath = toLocalPath(filePath);
  const doc = loadVisualizerJson(workspaceRoot, absPath);
  if (!doc) return false;

  const tag = (doc.tags || []).find(t => t.id === tagId);
  if (!tag) return false;

  const cleanText = (newText || '').replace(/[\r\n]+$/, '');
  const cleanRange = sanitizeTagRange(tag.range, tag.word);
  const targetStartLine = cleanRange.startLine;
  const targetStartChar = cleanRange.startCharacter;
  const targetEndLine = cleanRange.endLine;
  const targetEndChar = cleanRange.endCharacter;

  // 1. Replace text in code
  await replaceTextInFile(absPath, cleanRange, cleanText);

  // 2. Adjust all tags in document using RangeEngine
  const contentChange = {
    range: {
      start: { line: targetStartLine, character: targetStartChar },
      end: { line: targetEndLine, character: targetEndChar }
    },
    text: cleanText
  };
  const { updatedTags } = RangeEngine.applyContentChanges(doc.tags || [], [contentChange]);
  doc.tags = updatedTags;

  // 3. Strictly enforce single-line boundary on edited tag
  const updatedTag = (doc.tags || []).find(t => t.id === tagId);
  if (updatedTag) {
    updatedTag.word = cleanText;
    updatedTag.range.startLine = targetStartLine;
    updatedTag.range.startCharacter = targetStartChar;
    updatedTag.range.endLine = targetStartLine;
    updatedTag.range.endCharacter = targetStartChar + cleanText.length;
  }

  saveVisualizerJson(workspaceRoot, absPath, doc);

  // 4. If this is a Default tag and propagation is requested, update all connected Input tags
  if (propagateDefault && updatedTag && updatedTag.variableSubType === 'Default') {
    await propagateDefaultTagChange(workspaceRoot, tagId, cleanText);
  }

  return true;
}

/**
 * Swaps a Default tag's value when chosen from dropdown or edited.
 * Propagates the updated value to any connected Input tags.
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @param {string} tagId
 * @param {string} selectedValue
 */
async function applyDefaultValue(workspaceRoot, filePath, tagId, selectedValue) {
  return updateInputTagText(workspaceRoot, filePath, tagId, selectedValue, true);
}

/**
 * Deletes a component block from source code and synchronizes tag metadata and layout.
 * @param {string} workspaceRoot
 * @param {string} fileRelPath
 * @param {string} compName
 * @returns {Promise<boolean>}
 */
async function deleteComponentFromFile(workspaceRoot, fileRelPath, compName) {
  const absPath = toLocalPath(path.join(workspaceRoot, fileRelPath));
  if (!fs.existsSync(absPath)) return false;

  const content = fs.readFileSync(absPath, 'utf8');
  const isCrlf = content.includes('\r\n');
  const eol = isCrlf ? '\r\n' : '\n';

  const components = parseComponentsFromSource(content, fileRelPath);
  const comp = components.find(c => c.name === compName);
  if (!comp) return false;

  const lines = content.split(/\r?\n/);
  const startLine = comp.startMarkerLine;
  let endLine = comp.endMarkerLine;

  // If there is an empty line immediately following the closing marker, remove it too
  if (endLine + 1 < lines.length && lines[endLine + 1].trim() === '') {
    endLine++;
  }

  const deletedLineCount = endLine - startLine + 1;
  lines.splice(startLine, deletedLineCount);
  fs.writeFileSync(absPath, lines.join(eol), 'utf8');

  // Update Visualizer JSON: remove tags inside component and shift subsequent tag line ranges
  const doc = loadVisualizerJson(workspaceRoot, absPath);
  if (doc) {
    const deletedTagIds = new Set();
    const remainingTags = [];

    for (const tag of doc.tags || []) {
      if (tag.range && tag.range.startLine >= comp.contentStartLine && tag.range.endLine <= comp.contentEndLine) {
        deletedTagIds.add(tag.id);
      } else if (tag.range && tag.range.startLine > comp.endMarkerLine) {
        tag.range.startLine = Math.max(0, tag.range.startLine - deletedLineCount);
        tag.range.endLine = Math.max(0, tag.range.endLine - deletedLineCount);
        remainingTags.push(tag);
      } else {
        remainingTags.push(tag);
      }
    }

    doc.tags = remainingTags;

    if (doc.wires) {
      doc.wires = doc.wires.filter(w => !deletedTagIds.has(w.sourceTagId) && !deletedTagIds.has(w.targetTagId));
    }

    saveVisualizerJson(workspaceRoot, absPath, doc);
  }

  // Remove component and associated wires from workspace-layout.json if present
  const layout = loadWorkspaceLayout(workspaceRoot);
  if (layout) {
    if (layout.components) {
      const compKey = `${fileRelPath.replace(/\\/g, '/')}::${compName}`;
      delete layout.components[compKey];
    }
    if (layout.wires && deletedTagIds.size > 0) {
      layout.wires = layout.wires.filter(w => !deletedTagIds.has(w.sourceTagId) && !deletedTagIds.has(w.targetTagId));
    }
    saveWorkspaceLayout(workspaceRoot, layout);
  }

  return true;
}

module.exports = {
  toLocalPath,
  sanitizeTagRange,
  replaceTextInRange,
  replaceTextInFile,
  connectWire,
  disconnectWire,
  updateInputTagText,
  applyDefaultValue,
  deleteComponentFromFile,
  getAllWorkspaceWires,
  propagateDefaultTagChange
};
