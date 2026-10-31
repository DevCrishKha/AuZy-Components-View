/**
 * @file markerParser.js
 * Parses component marker comments (<{<< Name >>}> ... </{<< Name >>}>)
 * across any programming language in pure JavaScript.
 */

// Matches opening marker comment: captures component name in Group 1
const START_MARKER_REGEX = /<\{\<<\s*([^>]+?)\s*\>>\}>/;

// Matches closing marker comment: captures component name in Group 1
const END_MARKER_REGEX = /<\/\{\<<\s*([^>]+?)\s*\>>\}>/;

/**
 * @typedef {Object} ParsedComponent
 * @property {string} id - Unique component identifier
 * @property {string} name - Component display name
 * @property {number} startMarkerLine - 0-indexed line of opening marker
 * @property {number} endMarkerLine - 0-indexed line of closing marker
 * @property {number} contentStartLine - 0-indexed line where inner code begins
 * @property {number} contentEndLine - 0-indexed line where inner code ends
 * @property {number} lineCount - Total lines of inner code
 * @property {string[]} rawLines - Array of inner code lines
 * @property {boolean} [isUnclosed] - Whether closing marker was missing
 */

/**
 * Parses component blocks from source document text.
 * @param {string} documentText - Full text of the source file
 * @param {string} [filePath] - Optional file path for unique ID generation
 * @returns {ParsedComponent[]}
 */
function parseComponentsFromSource(documentText, filePath = '') {
  if (typeof documentText !== 'string' || !documentText.trim()) {
    return [];
  }

  const lines = documentText.split(/\r?\n/);
  const components = [];
  const openStack = [];

  const filePrefix = filePath
    ? filePath.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-20)
    : 'comp';

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    const startMatch = line.match(START_MARKER_REGEX);
    if (startMatch) {
      const componentName = startMatch[1].trim();
      const sanitizedName = componentName.replace(/[^a-zA-Z0-9_-]/g, '_');
      openStack.push({
        id: `${filePrefix}_line${lineIndex}_${sanitizedName}`,
        name: componentName,
        startMarkerLine: lineIndex,
        contentStartLine: lineIndex + 1,
      });
      continue;
    }

    const endMatch = line.match(END_MARKER_REGEX);
    if (endMatch) {
      const componentName = endMatch[1].trim();
      // Find matching opening marker from the top of the stack
      const openIdx = openStack.findLastIndex(c => c.name === componentName);
      if (openIdx !== -1) {
        const comp = openStack.splice(openIdx, 1)[0];
        comp.contentEndLine = lineIndex - 1;
        comp.endMarkerLine = lineIndex;
        comp.lineCount = Math.max(0, comp.contentEndLine - comp.contentStartLine + 1);
        comp.rawLines = lines.slice(comp.contentStartLine, lineIndex);
        components.push(comp);
      }
    }
  }

  // Handle any unclosed components gracefully without crashing
  while (openStack.length > 0) {
    const unclosed = openStack.pop();
    let lastLine = lines.length - 1;
    while (lastLine > unclosed.contentStartLine && !lines[lastLine].trim()) {
      lastLine--;
    }
    unclosed.contentEndLine = lastLine;
    unclosed.endMarkerLine = lastLine;
    unclosed.lineCount = Math.max(0, unclosed.contentEndLine - unclosed.contentStartLine + 1);
    unclosed.rawLines = lines.slice(unclosed.contentStartLine, lastLine + 1);
    unclosed.isUnclosed = true;
    components.push(unclosed);
  }

  // Sort components by start marker line ascending
  components.sort((a, b) => a.startMarkerLine - b.startMarkerLine);
  return components;
}

/**
 * Wraps code lines inside language-specific marker comments.
 * @param {string} componentName
 * @param {string[]} codeLines
 * @param {string} fileExtension - e.g. ".py", ".js", ".html"
 * @returns {string}
 */
function wrapComponentInComment(componentName, codeLines = [], fileExtension = '') {
  let startMarker = `<{<< ${componentName} >>}>`;
  let endMarker = `</{<< ${componentName} >>}>`;

  switch ((fileExtension || '').toLowerCase()) {
    case '.py':
    case '.sh':
    case '.rb':
    case '.yaml':
    case '.yml':
      startMarker = `# ${startMarker}`;
      endMarker = `# ${endMarker}`;
      break;

    case '.html':
    case '.xml':
    case '.md':
      startMarker = `<!-- ${startMarker} -->`;
      endMarker = `<!-- ${endMarker} -->`;
      break;

    case '.css':
    case '.scss':
    case '.less':
      startMarker = `/* ${startMarker} */`;
      endMarker = `/* ${endMarker} */`;
      break;

    case '.sql':
      startMarker = `-- ${startMarker}`;
      endMarker = `-- ${endMarker}`;
      break;

    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
    case '.c':
    case '.cpp':
    case '.cs':
    case '.java':
    case '.go':
    case '.rs':
    default:
      startMarker = `// ${startMarker}`;
      endMarker = `// ${endMarker}`;
      break;
  }

  return [startMarker, ...codeLines, endMarker].join('\n');
}

module.exports = {
  START_MARKER_REGEX,
  END_MARKER_REGEX,
  parseComponentsFromSource,
  wrapComponentInComment
};
