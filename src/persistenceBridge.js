/**
 * @file persistenceBridge.js
 * Filesystem bridge for persisting and loading workspace layout coordinates,
 * component library sources, and tag annotation files.
 */

const fs = require('fs');
const path = require('path');

const VISUALIZER_DIR_NAME = path.join('external-vscode-extension', 'Visualizer');
const LAYOUT_FILE_NAME = 'workspace-layout.json';
const SOURCES_FILE_NAME = 'sources.json';

/**
 * Returns the absolute path to the workspace's Visualizer directory.
 * @param {string} workspaceRoot
 * @returns {string}
 */
function getVisualizerDir(workspaceRoot) {
  return path.join(workspaceRoot, VISUALIZER_DIR_NAME);
}

/**
 * Ensures a directory exists synchronously.
 * @param {string} dirPath
 */
function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Loads the workspace-layout.json file if it exists.
 * @param {string} workspaceRoot
 * @returns {Object|null}
 */
function loadWorkspaceLayout(workspaceRoot) {
  try {
    const layoutPath = path.join(getVisualizerDir(workspaceRoot), LAYOUT_FILE_NAME);
    if (fs.existsSync(layoutPath)) {
      const content = fs.readFileSync(layoutPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('[PersistenceBridge] Error reading workspace layout:', err);
  }
  return null;
}

/**
 * Saves the workspace-layout.json file atomically to disk.
 * @param {string} workspaceRoot
 * @param {Object} layoutData
 */
function saveWorkspaceLayout(workspaceRoot, layoutData) {
  try {
    const dir = getVisualizerDir(workspaceRoot);
    ensureDirSync(dir);
    const layoutPath = path.join(dir, LAYOUT_FILE_NAME);

    let existingLayout = {};
    if (fs.existsSync(layoutPath)) {
      try {
        existingLayout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
      } catch (_) {}
    }

    const payload = {
      version: '1.0.0',
      ...existingLayout,
      ...layoutData,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(layoutPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[PersistenceBridge] Error saving workspace layout:', err);
    return false;
  }
}

/**
 * Loads sources.json containing language library folders.
 * @param {string} workspaceRoot
 * @returns {Object}
 */
function loadSourcesConfig(workspaceRoot) {
  try {
    const sourcesPath = path.join(getVisualizerDir(workspaceRoot), SOURCES_FILE_NAME);
    if (fs.existsSync(sourcesPath)) {
      const content = fs.readFileSync(sourcesPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('[PersistenceBridge] Error reading sources.json:', err);
  }
  return {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    libraries: {
      javascript: [],
      python: [],
      typescript: []
    }
  };
}

/**
 * Saves sources.json with updated library folders.
 * @param {string} workspaceRoot
 * @param {Object} sourcesConfig
 */
function saveSourcesConfig(workspaceRoot, sourcesConfig) {
  try {
    const dir = getVisualizerDir(workspaceRoot);
    ensureDirSync(dir);
    const sourcesPath = path.join(dir, SOURCES_FILE_NAME);
    const payload = {
      ...sourcesConfig,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(sourcesPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('[PersistenceBridge] Error saving sources.json:', err);
    return false;
  }
}

/**
 * Computes the mirrored JSON path for a source code file.
 * e.g., <workspace>/backend/app.py -> <workspace>/external-vscode-extension/Visualizer/backend/app.py.json
 * @param {string} workspaceRoot
 * @param {string} sourceFilePath
 * @returns {string}
 */
function getMirroredJsonPath(workspaceRoot, sourceFilePath) {
  const relativePath = path.relative(workspaceRoot, sourceFilePath);
  return path.join(getVisualizerDir(workspaceRoot), relativePath + '.json');
}

/**
 * Loads the companion JSON tag file for a source file.
 * @param {string} workspaceRoot
 * @param {string} sourceFilePath
 * @returns {Object|null}
 */
function loadVisualizerJson(workspaceRoot, sourceFilePath) {
  try {
    const jsonPath = getMirroredJsonPath(workspaceRoot, sourceFilePath);
    if (fs.existsSync(jsonPath)) {
      const content = fs.readFileSync(jsonPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`[PersistenceBridge] Error reading ${sourceFilePath} metadata:`, err);
  }
  return null;
}

/**
 * Saves the companion JSON tag file for a source file, preserving extra metadata fields.
 * @param {string} workspaceRoot
 * @param {string} sourceFilePath
 * @param {Object} documentData
 */
function saveVisualizerJson(workspaceRoot, sourceFilePath, documentData) {
  try {
    const jsonPath = getMirroredJsonPath(workspaceRoot, sourceFilePath);
    ensureDirSync(path.dirname(jsonPath));

    let existingData = {};
    if (fs.existsSync(jsonPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (_) {}
    }

    const payload = {
      name: 'Auzy-Keyword-Marker',
      fileName: path.basename(sourceFilePath),
      fileUri: `file:///${sourceFilePath.replace(/\\/g, '/')}`,
      ...existingData,
      ...documentData,
      savedAt: new Date().toISOString()
    };

    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`[PersistenceBridge] Error saving ${sourceFilePath} metadata:`, err);
    return false;
  }
}

module.exports = {
  getVisualizerDir,
  ensureDirSync,
  loadWorkspaceLayout,
  saveWorkspaceLayout,
  loadSourcesConfig,
  saveSourcesConfig,
  getMirroredJsonPath,
  loadVisualizerJson,
  saveVisualizerJson
};

