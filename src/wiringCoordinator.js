/**
 * @file wiringCoordinator.js
 * Handles port connections (Output/Default -> Input), code token replacements,
 * tag schema mutations, live input text editing, and default value applications.
 */

const fs = require('fs');
const path = require('path');
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
 * Replaces text inside a source file at the exact 0-indexed line and character range.
 * @param {string} filePath
 * @param {Object} range - { startLine, startCharacter, endLine, endCharacter }
 * @param {string} replacementText
 */
function replaceTextInRange(filePath, range, replacementText) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  if (range.startLine >= lines.length) return false;

  const line = lines[range.startLine];
  const before = line.slice(0, range.startCharacter);
  const after = line.slice(range.endCharacter);
  lines[range.startLine] = before + replacementText + after;

  const updatedContent = lines.join('\n');
  fs.writeFileSync(filePath, updatedContent, 'utf8');
  return true;
}

/**
 * Connects an Output or Default tag's socket to an Input tag socket.
 * Mutates the target source code, converts the tag schema, and records the wire.
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

  const liveText = sourceTag.word;

  // 1. Mutate target source code file
  replaceTextInRange(absTarget, targetTag.range, liveText);

  // 2. Mutate target tag in Visualizer JSON:
  // In Auzy-Components-View: ONLY the text value (word) changes and endCharacter is updated!
  // Its Title, description, category, and appearance (variableSubType: "Input") stay the same.
  targetTag.word = liveText;
  targetTag.range.endCharacter = targetTag.range.startCharacter + liveText.length;

  // 3. Record wire in target file metadata
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
  if (!targetDoc || !targetDoc.wires) return false;

  targetDoc.wires = targetDoc.wires.filter(w => w.id !== wireId);
  saveVisualizerJson(workspaceRoot, absTarget, targetDoc);
  return true;
}

/**
 * Updates text typed directly into an inline Input tag box.
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @param {string} tagId
 * @param {string} newText
 */
async function updateInputTagText(workspaceRoot, filePath, tagId, newText) {
  const absPath = toLocalPath(filePath);
  const doc = loadVisualizerJson(workspaceRoot, absPath);
  if (!doc) return false;

  const tag = (doc.tags || []).find(t => t.id === tagId);
  if (!tag) return false;

  // Replace text in code
  replaceTextInRange(absPath, tag.range, newText);

  // Update tag definition
  tag.word = newText;
  tag.range.endCharacter = tag.range.startCharacter + newText.length;
  saveVisualizerJson(workspaceRoot, absPath, doc);
  return true;
}

/**
 * Swaps a Default tag's value when chosen from dropdown.
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @param {string} tagId
 * @param {string} selectedValue
 */
async function applyDefaultValue(workspaceRoot, filePath, tagId, selectedValue) {
  return updateInputTagText(workspaceRoot, filePath, tagId, selectedValue);
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
  fs.writeFileSync(absPath, lines.join('\n'), 'utf8');

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

  // Remove component from workspace-layout.json if present
  const layout = loadWorkspaceLayout(workspaceRoot);
  if (layout && layout.components) {
    const compKey = `${fileRelPath.replace(/\\/g, '/')}::${compName}`;
    delete layout.components[compKey];
    saveWorkspaceLayout(workspaceRoot, layout);
  }

  return true;
}

module.exports = {
  toLocalPath,
  replaceTextInRange,
  connectWire,
  disconnectWire,
  updateInputTagText,
  applyDefaultValue,
  deleteComponentFromFile
};

