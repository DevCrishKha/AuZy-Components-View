/**
 * @file directoryScanner.js
 * Scans the workspace directory recursively to construct a complete
 * hierarchical tree of folders, files, marker-delimited components, tags, and wires.
 */

const fs = require('fs');
const path = require('path');
const { parseComponentsFromSource } = require('./markerParser');
const { calculateNodeDimensions, layoutTagsOnNode, computeContainerLayout } = require('./layoutEngine');
const { loadVisualizerJson, loadWorkspaceLayout } = require('./persistenceBridge');

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.vscode',
  '.gemini',
  'external-vscode-extension',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt'
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.html', '.htm', '.xhtml',
  '.css', '.scss', '.sass', '.less',
  '.c', '.cpp', '.cc', '.h', '.hpp',
  '.cs', '.java', '.go', '.rs', '.rb', '.php',
  '.sh', '.bash', '.zsh',
  '.sql', '.json', '.yaml', '.yml', '.xml',
  '.md', '.txt'
]);

/**
 * Scans the entire workspace directory and returns hierarchical graph data.
 * @param {string} workspaceRoot
 * @returns {Promise<Object>}
 */
async function scanWorkspaceHierarchy(workspaceRoot) {
  const savedLayout = loadWorkspaceLayout(workspaceRoot) || {
    viewport: { x: 0, y: 0, zoom: 1.0 },
    folders: {},
    files: {},
    components: {}
  };

  const tree = {
    rootPath: workspaceRoot,
    folders: new Map(), // relPath -> FolderNode
    files: new Map(),   // relPath -> FileNode
    components: new Map(), // compKey -> ComponentNode
    stats: {
      totalFolders: 0,
      totalFiles: 0,
      totalComponents: 0,
      totalTags: 0
    }
  };

  // Helper to recursively walk directories
  function walkDir(currentAbsDir, currentRelDir = '') {
    let entries;
    try {
      entries = fs.readdirSync(currentAbsDir, { withFileTypes: true });
    } catch (err) {
      console.warn(`[DirectoryScanner] Cannot read dir: ${currentAbsDir}`, err);
      return;
    }

    // Register folder if not root
    if (currentRelDir) {
      const normalizedFolderRel = currentRelDir.replace(/\\/g, '/');
      if (!tree.folders.has(normalizedFolderRel)) {
        tree.folders.set(normalizedFolderRel, {
          id: `folder_${normalizedFolderRel}`,
          relPath: normalizedFolderRel,
          name: path.basename(normalizedFolderRel),
          parentRelPath: path.dirname(normalizedFolderRel).replace(/\\/g, '/').replace(/^\.$/, ''),
          subfolders: [],
          files: [],
          isFolder: true,
          isCollapsed: savedLayout.folders?.[normalizedFolderRel]?.isCollapsed || false,
          x: savedLayout.folders?.[normalizedFolderRel]?.x,
          y: savedLayout.folders?.[normalizedFolderRel]?.y,
          width: savedLayout.folders?.[normalizedFolderRel]?.width || 600,
          height: savedLayout.folders?.[normalizedFolderRel]?.height || 450
        });
        tree.stats.totalFolders++;
      }
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const entryAbsPath = path.join(currentAbsDir, entry.name);
      const entryRelPath = currentRelDir ? path.join(currentRelDir, entry.name) : entry.name;
      const normalizedEntryRel = entryRelPath.replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walkDir(entryAbsPath, entryRelPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

        let content = '';
        try {
          content = fs.readFileSync(entryAbsPath, 'utf8');
        } catch (_) {
          continue;
        }

        const parsedComps = parseComponentsFromSource(content, entryRelPath);
        const visualizerDoc = loadVisualizerJson(workspaceRoot, entryAbsPath);
        const tags = visualizerDoc?.tags || [];
        const wires = visualizerDoc?.wires || [];

        // Build component objects with tagged coordinates and dimensions
        const fileComponents = parsedComps.map((comp, compIdx) => {
          const compKey = `${normalizedEntryRel}::${comp.name}`;
          const compTags = tags.filter(
            t => t.range && t.range.startLine >= comp.contentStartLine && t.range.endLine <= comp.contentEndLine
          );

          tree.stats.totalTags += compTags.length;

          const dimensions = calculateNodeDimensions(comp, compTags);
          const layoutedTags = layoutTagsOnNode(compTags, dimensions.height, dimensions.width);

          const savedCompPos = savedLayout.components?.[compKey];

          const compNode = {
            id: `comp_${comp.id}`,
            compKey,
            name: comp.name,
            fileRelPath: normalizedEntryRel,
            lineCount: comp.lineCount,
            startMarkerLine: comp.startMarkerLine,
            endMarkerLine: comp.endMarkerLine,
            contentStartLine: comp.contentStartLine,
            contentEndLine: comp.contentEndLine,
            rawLines: comp.rawLines || [],
            width: dimensions.width,
            height: dimensions.height,
            tags: layoutedTags,
            x: savedCompPos?.x,
            y: savedCompPos?.y
          };

          tree.components.set(compKey, compNode);
          return compNode;
        });

        const savedFilePos = savedLayout.files?.[normalizedEntryRel];
        const folderRel = currentRelDir.replace(/\\/g, '/');

        const fileNode = {
          id: `file_${normalizedEntryRel}`,
          relPath: normalizedEntryRel,
          name: entry.name,
          extension: ext,
          folderRelPath: folderRel,
          componentCount: fileComponents.length,
          components: fileComponents,
          wires: wires,
          isFile: true,
          isCollapsed: savedFilePos?.isCollapsed || false,
          x: savedFilePos?.x,
          y: savedFilePos?.y,
          width: savedFilePos?.width || 520,
          height: savedFilePos?.height || 400
        };

        tree.files.set(normalizedEntryRel, fileNode);
        tree.stats.totalFiles++;
        tree.stats.totalComponents += fileComponents.length;

        if (folderRel && tree.folders.has(folderRel)) {
          tree.folders.get(folderRel).files.push(normalizedEntryRel);
        }
      }
    }
  }

  walkDir(workspaceRoot, '');

  // Populate subfolders array on each folder
  for (const [folderRel, folder] of tree.folders) {
    if (folder.parentRelPath && tree.folders.has(folder.parentRelPath)) {
      tree.folders.get(folder.parentRelPath).subfolders.push(folderRel);
    }
  }

  // Auto-calculate positions for any elements that do not have saved positions
  autoLayoutUnpositionedItems(tree);

  return {
    rootPath: workspaceRoot,
    folders: Array.from(tree.folders.values()),
    files: Array.from(tree.files.values()),
    components: Array.from(tree.components.values()),
    stats: tree.stats,
    viewport: savedLayout.viewport || { x: 0, y: 0, zoom: 1.0 },
    savedScope: savedLayout.scope || { type: 'root', path: '' }
  };
}

/**
 * Computes nice grid-based layout offsets for components, files, and folders
 * that do not have explicitly saved coordinates.
 * @param {Object} tree
 */
function autoLayoutUnpositionedItems(tree) {
  // 1. Position components inside each file
  for (const file of tree.files.values()) {
    const unpositionedComps = file.components.filter(c => c.x === undefined || c.y === undefined);
    if (unpositionedComps.length > 0) {
      const compLayout = computeContainerLayout(
        file.components,
        file.components.length > 4 ? 3 : 2,
        35,
        30,
        65
      );
      for (const comp of file.components) {
        if (comp.x === undefined || comp.y === undefined) {
          const pos = compLayout.positions.get(comp.id);
          comp.x = pos ? pos.x : 40;
          comp.y = pos ? pos.y : 80;
        }
      }
      file.width = Math.max(file.width || 520, compLayout.width);
      file.height = Math.max(file.height || 400, compLayout.height);
    }
  }

  // 2. Position files inside each folder or at root
  let rootFileOffset = { x: 60, y: 60 };
  for (const file of tree.files.values()) {
    if (file.x === undefined || file.y === undefined) {
      file.x = rootFileOffset.x;
      file.y = rootFileOffset.y;
      rootFileOffset.x += (file.width || 520) + 80;
      if (rootFileOffset.x > 3200) {
        rootFileOffset.x = 60;
        rootFileOffset.y += 650;
      }
    }
  }

  // 3. Position folders
  let rootFolderOffset = { x: 60, y: rootFileOffset.y + 550 };
  for (const folder of tree.folders.values()) {
    if (folder.x === undefined || folder.y === undefined) {
      folder.x = rootFolderOffset.x;
      folder.y = rootFolderOffset.y;
      rootFolderOffset.x += (folder.width || 600) + 100;
      if (rootFolderOffset.x > 3400) {
        rootFolderOffset.x = 60;
        rootFolderOffset.y += 700;
      }
    }
  }
}

module.exports = {
  scanWorkspaceHierarchy,
  SUPPORTED_EXTENSIONS
};

