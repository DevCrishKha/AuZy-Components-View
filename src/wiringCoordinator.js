/**
 * @file wiringCoordinator.js
 * Handles port connections (Output/Default -> Input), code token replacements,
 * tag schema mutations, live input text editing, and default value applications.
 */

const fs = require('fs');
const path = require('path');
const { loadVisualizerJson, saveVisualizerJson } = require('./persistenceBridge');

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

  // 2. Mutate target tag in Visualizer JSON
  targetTag.word = liveText;
  targetTag.category = sourceTag.category || 'variable';
  targetTag.variableSubType = sourceTag.variableSubType; // Converted to Output or Default
  targetTag.title = sourceTag.title || '';
  targetTag.description = sourceTag.description || '';
  if (sourceTag.defaultValues) {
    targetTag.defaultValues = [...sourceTag.defaultValues];
  }
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

module.exports = {
  toLocalPath,
  replaceTextInRange,
  connectWire,
  disconnectWire,
  updateInputTagText,
  applyDefaultValue
};

