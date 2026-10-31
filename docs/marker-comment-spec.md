# Marker Comment Specification & Parsing Engine

## 1. Syntax Definition

Components are recognized inside source code files via explicit marker comments.

### 1.1 Structural Markers
- **Start Marker**: `<{<< <Component-Name> >>}>`
- **End Marker**: `</{<< <Component-Name> >>}>`

Where `<Component-Name>` is an alphanumeric identifier (which may include hyphens, underscores, or spaces), for example:
- `Component-1`
- `AuthMiddleware`
- `DataProcessor_V2`
- `Fetch User Profile`

---

## 2. Language-Agnostic Comment Adaptations

Because programming languages have different comment syntaxes, developers will wrap the markers in standard comments. The parser must detect the markers regardless of the surrounding comment tokens.

### 2.1 Common Language Comment Variants

| Language Family | Start Marker Example in Code | End Marker Example in Code |
| :--- | :--- | :--- |
| **JavaScript / TypeScript / C / C++ / C# / Java / Go / Rust** | `// <{<< Component-1 >>}>` | `// </{<< Component-1 >>}>` |
| **Python / Ruby / Bash / Shell / Perl / YAML** | `# <{<< Component-1 >>}>` | `# </{<< Component-1 >>}>` |
| **HTML / XML / Markdown / Vue / Svelte** | `<!-- <{<< Component-1 >>}> -->` | `<!-- </{<< Component-1 >>}> -->` |
| **CSS / SCSS / Less** | `/* <{<< Component-1 >>}> */` | `/* </{<< Component-1 >>}> */` |
| **SQL** | `-- <{<< Component-1 >>}>` | `-- </{<< Component-1 >>}>` |
| **Plain Text / Pseudo-code** | `<{<< Component-1 >>}>` | `</{<< Component-1 >>}>` |

---

## 3. Regular Expression & Extraction Rules

### 3.1 Regular Expression Patterns

The parser uses the following regexes to detect start and end markers on a per-line basis:

```javascript
// Matches opening marker comment: captures component name in Group 1
const START_MARKER_REGEX = /<\{\<<\s*([^>]+?)\s*\>>\}>/;

// Matches closing marker comment: captures component name in Group 1
const END_MARKER_REGEX = /<\/\{\<<\s*([^>]+?)\s*\>>\}>/;
```

### 3.2 Parsing Algorithm

When a file's text is analyzed:
```javascript
function parseComponentsFromSource(documentText) {
  const lines = documentText.split(/\r?\n/);
  const components = [];
  const openStack = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    const startMatch = line.match(START_MARKER_REGEX);
    if (startMatch) {
      const componentName = startMatch[1].trim();
      openStack.push({
        id: `comp_${lineIndex}_${componentName.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
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

  // Handle any unclosed components gracefully
  while (openStack.length > 0) {
    const unclosed = openStack.pop();
    unclosed.contentEndLine = lines.length - 1;
    unclosed.endMarkerLine = lines.length - 1;
    unclosed.lineCount = Math.max(0, unclosed.contentEndLine - unclosed.contentStartLine + 1);
    unclosed.rawLines = lines.slice(unclosed.contentStartLine);
    unclosed.isUnclosed = true;
    components.push(unclosed);
  }

  return components;
}
```

---

## 4. Code Range & Coordinate Calculations

1. **Inner Code Range (Content)**:
   - `startLine`: `component.contentStartLine`
   - `endLine`: `component.contentEndLine`
   - All tags inside `Visualizer/<filename>.json` that fall within `startLine <= tag.range.startLine && tag.range.endLine <= endLine` belong to this component.
2. **Outer Code Range (with Markers)**:
   - `startMarkerLine`: The line containing `<{<< Component >>}>`.
   - `endMarkerLine`: The line containing `</{<< Component >>}>`.

---

## 5. Code Insertion Format When Appending from Palette

When dragging a component from the palette onto the canvas, the extension formats the inserted code according to the target file's comment convention:

### 5.1 Format Template by File Extension

```javascript
function wrapComponentInComment(componentName, codeLines, fileExtension) {
  let startMarker = `<{<< ${componentName} >>}>`;
  let endMarker = `</{<< ${componentName} >>}>`;

  switch (fileExtension.toLowerCase()) {
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
      startMarker = `/* ${startMarker} */`;
      endMarker = `/* ${endMarker} */`;
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
```

---

## 6. Edge Cases & Resilience Rules

1. **Unclosed Markers**: If a developer forgets the closing marker `</{<< ... >>}>`, the parser sets the component boundary to the end of the file or the next opening marker without throwing an error.
2. **Duplicate Component Names**: If two components share the same name in a file, generate unique IDs using line numbers (e.g. `comp_line12_Auth` and `comp_line45_Auth`).
3. **Empty Components**: If `<{<< Comp >>}>` is immediately followed by `</{<< Comp >>}>`, lineCount is 0; the node renders at minimum size with a placeholder message: *"Empty Component"*.
4. **Code Outside Components**: Any code located before the first component, after the last component, or between components remains untouched.

