/**
 * @file paletteScanner.js
 * Discovers scaffolding components from configured language library directories
 * and injects dropped components into target source files.
 */

const fs = require('fs');
const path = require('path');
const { parseComponentsFromSource, wrapComponentInComment } = require('./markerParser');
const { loadSourcesConfig, loadVisualizerJson, saveVisualizerJson } = require('./persistenceBridge');
const { SUPPORTED_EXTENSIONS } = require('./directoryScanner');

/**
 * Scans library folders configured in sources.json and returns categorized components.
 * @param {string} workspaceRoot
 * @returns {Promise<Array<{ language: string, components: Array }>>}
 */
async function scanPaletteLibraries(workspaceRoot) {
  const sourcesConfig = loadSourcesConfig(workspaceRoot);
  const libraries = sourcesConfig.libraries || {};
  const results = [];

  for (const [language, folderPaths] of Object.entries(libraries)) {
    const langComponents = [];

    for (const folderPath of folderPaths) {
      if (!fs.existsSync(folderPath)) continue;

      try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
          const fullPath = path.join(folderPath, file);
          const ext = path.extname(file).toLowerCase();
          if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

          let content = '';
          try {
            content = fs.readFileSync(fullPath, 'utf8');
          } catch (_) {
            continue;
          }

          const parsed = parseComponentsFromSource(content, fullPath);
          const visualizerDoc = loadVisualizerJson(workspaceRoot, fullPath);
          const allTags = visualizerDoc?.tags || [];

          for (const comp of parsed) {
            // Find tags inside this component and normalize ranges to 0-offset
            const compTags = allTags
              .filter(t => t.range && t.range.startLine >= comp.contentStartLine && t.range.endLine <= comp.contentEndLine)
              .map(t => ({
                ...t,
                id: `lib_${t.id}`,
                range: {
                  startLine: t.range.startLine - comp.contentStartLine,
                  startCharacter: t.range.startCharacter,
                  endLine: t.range.endLine - comp.contentStartLine,
                  endCharacter: t.range.endCharacter
                }
              }));

            langComponents.push({
              id: `scaffold_${file}_${comp.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
              name: comp.name,
              language,
              sourceFilePath: fullPath,
              lineCount: comp.lineCount,
              codeLines: comp.rawLines || [],
              tags: compTags
            });
          }
        }
      } catch (err) {
        console.warn(`[PaletteScanner] Error scanning library folder ${folderPath}:`, err);
      }
    }

    results.push({
      language,
      components: langComponents
    });
  }

  return results;
}

/**
 * Appends a scaffolding component to a target file and imports its tags.
 * @param {string} workspaceRoot
 * @param {string} targetFilePath
 * @param {Object} scaffoldingComp
 * @returns {Promise<{ success: boolean, insertionLine: number }>}
 */
async function dropComponentIntoFile(workspaceRoot, targetFilePath, scaffoldingComp) {
  if (!fs.existsSync(targetFilePath)) {
    return { success: false, message: 'Target file does not exist.' };
  }

  const ext = path.extname(targetFilePath).toLowerCase();
  const fileContent = fs.readFileSync(targetFilePath, 'utf8');
  const lines = fileContent.split(/\r?\n/);
  const insertionLine = lines.length;

  const wrappedCode = wrapComponentInComment(scaffoldingComp.name, scaffoldingComp.codeLines, ext);
  const updatedContent = fileContent.trimEnd() + '\n\n' + wrappedCode + '\n';
  fs.writeFileSync(targetFilePath, updatedContent, 'utf8');

  // Import tags shifted by insertionLine + 1 (for start marker comment)
  const visualizerDoc = loadVisualizerJson(workspaceRoot, targetFilePath) || { tags: [] };
  const lineOffset = insertionLine + 1;

  for (const tag of scaffoldingComp.tags || []) {
    const newTag = {
      ...tag,
      id: `tag_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      range: {
        startLine: tag.range.startLine + lineOffset,
        startCharacter: tag.range.startCharacter,
        endLine: tag.range.endLine + lineOffset,
        endCharacter: tag.range.endCharacter
      }
    };
    visualizerDoc.tags.push(newTag);
  }

  saveVisualizerJson(workspaceRoot, targetFilePath, visualizerDoc);

  return { success: true, insertionLine };
}

module.exports = {
  scanPaletteLibraries,
  dropComponentIntoFile
};

