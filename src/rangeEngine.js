/**
 * Range Engine for Auzy-Components-View
 * (Adopted from Auzy-Keyword-Marker Range Engine)
 * 
 * Handles real-time range offset calculations when document edits occur.
 * Guarantees:
 * 1. Edits before a tag shift its start/end offsets accurately.
 * 2. Typing space or characters at the trailing edge does NOT expand the tag (Boundary Invariance).
 * 3. Editing text inside a tag (including first and last character) updates its boundary.
 * 4. Deleting text collapses the tag and flags it for automatic removal.
 * 5. Replaced tag text maintains strictly single-line boundaries without bleeding to adjacent lines.
 */

class RangeEngine {
  /**
   * Updates an array of tags given a set of content changes from VS Code onDidChangeTextDocument or manual edits.
   * 
   * @param {Array<object>} tags - Existing tags
   * @param {Array<object>} contentChanges - Changes from event.contentChanges or synthetic edit
   * @returns {{ updatedTags: Array<object>, removedTagIds: Array<string> }}
   */
  static applyContentChanges(tags, contentChanges) {
    if (!tags || tags.length === 0 || !contentChanges || contentChanges.length === 0) {
      return { updatedTags: tags || [], removedTagIds: [] };
    }

    let currentTags = tags.map(t => ({
      ...t,
      range: { ...t.range }
    }));

    const removedTagIds = new Set();

    // Process each content change sequentially
    for (const change of contentChanges) {
      const { range: changeRange, text } = change;
      const changeStartLine = changeRange.start.line;
      const changeStartChar = changeRange.start.character;
      const changeEndLine = changeRange.end.line;
      const changeEndChar = changeRange.end.character;

      const linesRemoved = changeEndLine - changeStartLine;
      const newLines = text.split(/\r?\n/);
      const linesAdded = newLines.length - 1;
      const deltaLines = linesAdded - linesRemoved;
      const lastLineLength = newLines[newLines.length - 1].length;

      for (let i = 0; i < currentTags.length; i++) {
        const tag = currentTags[i];
        if (removedTagIds.has(tag.id)) continue;

        let { startLine, startCharacter, endLine, endCharacter } = tag.range;

        // CASE 1: Change is strictly AFTER the tag (or at trailing edge)
        // Boundary invariance: typing at endCharacter (e.g. space) is considered AFTER
        if (
          changeStartLine > endLine ||
          (changeStartLine === endLine && changeStartChar >= endCharacter)
        ) {
          continue;
        }

        // CASE 2: Change is strictly BEFORE the tag (preceding startCharacter)
        if (
          changeEndLine < startLine ||
          (changeEndLine === startLine && changeEndChar <= startCharacter)
        ) {
          // Adjust start position
          if (changeEndLine === startLine) {
            const charOffset = (linesAdded > 0)
              ? (startCharacter - changeEndChar + lastLineLength)
              : (startCharacter + (text.length - (changeEndChar - changeStartChar)));
            startCharacter = charOffset;
          }
          startLine += deltaLines;

          // Adjust end position
          if (changeEndLine === endLine) {
            const charOffset = (linesAdded > 0)
              ? (endCharacter - changeEndChar + lastLineLength)
              : (endCharacter + (text.length - (changeEndChar - changeStartChar)));
            endCharacter = charOffset;
          }
          endLine += deltaLines;

          tag.range = { startLine, startCharacter, endLine, endCharacter };
          continue;
        }

        // CASE 3: Change completely encloses the tag
        if (
          (changeStartLine < startLine || (changeStartLine === startLine && changeStartChar <= startCharacter)) &&
          (changeEndLine > endLine || (changeEndLine === endLine && changeEndChar >= endCharacter))
        ) {
          if (!text || text.length === 0) {
            // Deleted
            removedTagIds.add(tag.id);
            continue;
          } else {
            // Replaced by new text (e.g. variable wiring replacement!)
            // Keep tag alive and set new endCharacter strictly
            endCharacter = startCharacter + text.length;
            endLine = startLine + linesAdded;
            tag.range = { startLine, startCharacter, endLine, endCharacter };
            continue;
          }
        }

        // CASE 4: Change is INSIDE the tag (including editing first or last characters)
        if (
          changeStartLine >= startLine &&
          changeEndLine <= endLine &&
          changeStartChar >= startCharacter &&
          changeEndChar <= endCharacter
        ) {
          const charsDelta = text.length - (changeEndChar - changeStartChar);
          endCharacter += charsDelta;
          endLine += deltaLines;

          // If the tag collapsed to 0 length (or negative), remove it
          if (startLine === endLine && endCharacter <= startCharacter) {
            removedTagIds.add(tag.id);
            continue;
          }

          tag.range = { startLine, startCharacter, endLine, endCharacter };
          continue;
        }

        // CASE 5: Partial overlap spanning beyond boundaries
        const charsDelta = text.length - (changeEndChar - changeStartChar);
        endCharacter += charsDelta;
        endLine += deltaLines;

        if (startLine === endLine && endCharacter <= startCharacter) {
          removedTagIds.add(tag.id);
        } else {
          tag.range = { startLine, startCharacter, endLine, endCharacter };
        }
      }
    }

    const survivingTags = currentTags.filter(t => !removedTagIds.has(t.id));

    return {
      updatedTags: survivingTags,
      removedTagIds: Array.from(removedTagIds)
    };
  }
}

module.exports = {
  RangeEngine
};

