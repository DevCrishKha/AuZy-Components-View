/**
 * @file directoryScanner.js
 * Scans the workspace directory recursively to construct a complete
 * hierarchical tree of folders, files, marker-delimited components, tags, and wires.
 */

const fs = require('fs');
const path = require('path');
const { parseComponentsFromSource } = require('./markerParser');
const { calculateNodeDimensions, layoutTagsOnNode, computeContainerLayout } = require('./layoutEngine');
const { loadVisualizerJson, loadWorkspaceLayout, saveVisualizerJson, saveWorkspaceLayout } = require('./persistenceBridge');

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

  const allTagsMap = new Map(); // (fileRel + '::' + tagId) and tagId -> Tag
  const fileDocsMap = new Map(); // fileRel -> { absPath, doc }

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
        let wires = visualizerDoc?.wires || [];

        fileDocsMap.set(normalizedEntryRel, { absPath: entryAbsPath, doc: visualizerDoc });
        for (const t of tags) {
          if (t && t.id) {
            allTagsMap.set(`${normalizedEntryRel}::${t.id}`, t);
            if (!allTagsMap.has(t.id)) {
              allTagsMap.set(t.id, t);
            }
          }
        }

        // Dual-persistence fallback: If visualizerDoc.wires is missing/empty, recover from savedLayout.wires
        if (savedLayout.wires && Array.isArray(savedLayout.wires)) {
          const layoutWires = savedLayout.wires.filter(w => w.targetFile === normalizedEntryRel);
          if (wires.length === 0 && layoutWires.length > 0) {
            wires = layoutWires;
            if (visualizerDoc) {
              visualizerDoc.wires = wires;
              saveVisualizerJson(workspaceRoot, entryAbsPath, visualizerDoc);
            }
          } else if (wires.length > 0) {
            for (const w of wires) {
              if (!savedLayout.wires.some(lw => lw.id === w.id || (lw.targetTagId === w.targetTagId && lw.sourceTagId === w.sourceTagId))) {
                savedLayout.wires.push(w);
              }
            }
          }
        } else if (wires.length > 0) {
          if (!savedLayout.wires) savedLayout.wires = [];
          for (const w of wires) {
            if (!savedLayout.wires.some(lw => lw.id === w.id)) {
              savedLayout.wires.push(w);
            }
          }
        }

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
          width: savedFilePos?.width || 340,
          height: savedFilePos?.height || 260
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

  // Validate all connected tags across the workspace:
  // Every time the canvas refreshes, check if the text inside the wired tags
  // (such as input-to-output tag or input-to-default tag) are the same.
  // If the text inside connected tags are not the same, remove the connection.
  const removedWireKeys = new Set();
  const allWorkspaceWires = [];

  if (savedLayout.wires && Array.isArray(savedLayout.wires)) {
    for (const w of savedLayout.wires) {
      const wireKey = w.id || `${w.sourceTagId}->${w.targetTagId}`;
      if (!allWorkspaceWires.some(existing => (existing.id || `${existing.sourceTagId}->${existing.targetTagId}`) === wireKey)) {
        allWorkspaceWires.push(w);
      }
    }
  }
  for (const fileNode of tree.files.values()) {
    for (const w of fileNode.wires || []) {
      const wireKey = w.id || `${w.sourceTagId}->${w.targetTagId}`;
      if (!allWorkspaceWires.some(existing => (existing.id || `${existing.sourceTagId}->${existing.targetTagId}`) === wireKey)) {
        allWorkspaceWires.push(w);
      }
    }
  }

  for (const wire of allWorkspaceWires) {
    const srcFileRel = (wire.sourceFile || '').replace(/\\/g, '/');
    const tgtFileRel = (wire.targetFile || '').replace(/\\/g, '/');

    const sourceTag = allTagsMap.get(`${srcFileRel}::${wire.sourceTagId}`) || allTagsMap.get(wire.sourceTagId);
    const targetTag = allTagsMap.get(`${tgtFileRel}::${wire.targetTagId}`) || allTagsMap.get(wire.targetTagId);

    // Check only connected tags where both endpoints exist
    if (sourceTag && targetTag) {
      const sourceText = (sourceTag.word || '').replace(/[\r\n]+$/, '');
      const targetText = (targetTag.word || '').replace(/[\r\n]+$/, '');

      if (sourceText !== targetText) {
        const wireKey = wire.id || `${wire.sourceTagId}->${wire.targetTagId}`;
        removedWireKeys.add(wireKey);
        if (wire.id) removedWireKeys.add(wire.id);
      }
    }
  }

  // Remove disconnected wires from savedLayout
  if (savedLayout.wires && Array.isArray(savedLayout.wires) && removedWireKeys.size > 0) {
    savedLayout.wires = savedLayout.wires.filter(w => {
      const key = w.id || `${w.sourceTagId}->${w.targetTagId}`;
      return !removedWireKeys.has(key) && !removedWireKeys.has(w.id);
    });
  }

  // Remove disconnected wires from each file node and persist removal to file JSON
  for (const [fileRel, fileNode] of tree.files) {
    if (fileNode.wires && Array.isArray(fileNode.wires) && removedWireKeys.size > 0) {
      const prevLen = fileNode.wires.length;
      fileNode.wires = fileNode.wires.filter(w => {
        const key = w.id || `${w.sourceTagId}->${w.targetTagId}`;
        return !removedWireKeys.has(key) && !removedWireKeys.has(w.id);
      });
      if (fileNode.wires.length !== prevLen) {
        const fileEntry = fileDocsMap.get(fileRel);
        if (fileEntry && fileEntry.doc) {
          fileEntry.doc.wires = fileNode.wires;
          saveVisualizerJson(workspaceRoot, fileEntry.absPath, fileEntry.doc);
        }
      }
    }
  }

  // Populate subfolders array on each folder
  for (const [folderRel, folder] of tree.folders) {
    if (folder.parentRelPath && tree.folders.has(folder.parentRelPath)) {
      tree.folders.get(folder.parentRelPath).subfolders.push(folderRel);
    }
  }

  // Auto-calculate positions for any elements that do not have saved positions
  autoLayoutUnpositionedItems(tree);

  if (savedLayout.wires) {
    saveWorkspaceLayout(workspaceRoot, savedLayout);
  }

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
 * Computes single-column layout for components inside files and grid layout for files/folders
 * that do not have explicitly saved coordinates.
 * @param {Object} tree
 */
function autoLayoutUnpositionedItems(tree) {
  // 1. Position components inside each file in a single column ordered by code file appearance
  for (const file of tree.files.values()) {
    const unpositionedComps = file.components.filter(c => c.x === undefined || c.y === undefined);
    if (unpositionedComps.length > 0) {
      const compLayout = computeContainerLayout(
        file.components,
        1,
        35,
        30,
        65
      );
      for (const comp of file.components) {
        if (comp.x === undefined || comp.y === undefined) {
          const pos = compLayout.positions.get(comp.id);
          comp.x = pos ? pos.x : 35;
          comp.y = pos ? pos.y : 100;
        }
      }
      file.width = Math.max(file.width || 340, compLayout.width);
      file.height = Math.max(file.height || 220, compLayout.height);
    }
  }

  // 2. Position files inside each folder or at root
  let rootFileOffset = { x: 60, y: 60 };
  for (const file of tree.files.values()) {
    if (file.x === undefined || file.y === undefined) {
      file.x = rootFileOffset.x;
      file.y = rootFileOffset.y;
      rootFileOffset.x += (file.width || 340) + 80;
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

