/**
 * @file layoutEngine.js
 * Dynamic node sizing, relative tag placement, gap compression,
 * and hierarchical bounding box calculations for FolderNodes and FileNodes.
 */

const MIN_COMPONENT_WIDTH = 220;
const MAX_COMPONENT_WIDTH = 500;
const MIN_COMPONENT_HEIGHT = 140;
const MAX_COMPONENT_HEIGHT = 650;

/**
 * Calculates dynamic pixel dimensions for a component node based on lines and tags.
 * @param {Object} component - Parsed component object
 * @param {Array} tags - Array of tags inside this component
 * @returns {{ width: number, height: number }}
 */
function calculateNodeDimensions(component, tags = []) {
  const lineCount = component.lineCount || 0;
  const tagCount = tags.length;

  let width = 240;
  let height = 150;

  // Scale height based on code lines (approx 12px per line)
  const lineContribution = lineCount * 12;
  // Scale height based on tag density (approx 36px per tag row)
  const tagContribution = tagCount * 36;

  height = Math.max(
    MIN_COMPONENT_HEIGHT,
    Math.min(MAX_COMPONENT_HEIGHT, 80 + Math.max(lineContribution, tagContribution))
  );

  // If node has tags with long text, widen the node
  let maxTagCharLength = 0;
  for (const t of tags) {
    const len = (t.title ? t.title.length : 0) + (t.word ? t.word.length : 0);
    if (len > maxTagCharLength) maxTagCharLength = len;
  }

  if (maxTagCharLength > 20) {
    width = Math.min(MAX_COMPONENT_WIDTH, 240 + (maxTagCharLength - 20) * 8);
  }

  return { width, height };
}

/**
 * Calculates relative (x, y) coordinates for tags on a node with empty-space compression.
 * @param {Array} tags
 * @param {number} nodeHeight
 * @param {number} nodeWidth
 * @returns {Array<{ tag: Object, x: number, y: number, isSameLineGroup: boolean }>}
 */
function layoutTagsOnNode(tags = [], nodeHeight = 150, nodeWidth = 240) {
  if (!tags || tags.length === 0) return [];

  // 1. Group tags by their startLine
  const lineGroups = new Map();
  for (const tag of tags) {
    const line = tag.range ? tag.range.startLine : 0;
    if (!lineGroups.has(line)) lineGroups.set(line, []);
    lineGroups.get(line).push(tag);
  }

  // 2. Sort lines ascending
  const sortedLines = Array.from(lineGroups.keys()).sort((a, b) => a - b);

  // 3. Compress line gaps: if distance between consecutive tag lines > 3, clamp it
  const compressedSteps = [];
  let currentStep = 0;
  let prevLine = sortedLines[0];

  for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i];
    const lineGap = line - prevLine;
    const stepIncrement = i === 0 ? 0 : Math.min(2, Math.max(1, lineGap));
    currentStep += stepIncrement;
    compressedSteps.push({ line, step: currentStep });
    prevLine = line;
  }

  const totalSteps = currentStep === 0 ? 1 : currentStep;
  const usableHeight = Math.max(60, nodeHeight - 70); // Reserve 50px for header, 20px padding
  const verticalStepSize = usableHeight / (totalSteps + 1);

  // 4. Assign pixel coordinates to each tag
  const layoutedTags = [];
  for (let i = 0; i < sortedLines.length; i++) {
    const line = sortedLines[i];
    const tagsOnLine = lineGroups.get(line);
    // Sort tags on the same line by character column
    tagsOnLine.sort((a, b) => (a.range?.startCharacter || 0) - (b.range?.startCharacter || 0));

    const y = 48 + (compressedSteps[i].step + 0.5) * verticalStepSize;

    // Distribute tags horizontally across nodeWidth
    const count = tagsOnLine.length;
    tagsOnLine.forEach((tag, idx) => {
      const xPercent = (idx + 1) / (count + 1);
      const x = nodeWidth * xPercent;
      layoutedTags.push({
        tag,
        x,
        y,
        isSameLineGroup: count > 1
      });
    });
  }

  return layoutedTags;
}

/**
 * Calculates bounding box and auto-grid layout for children in a container (FileNode or FolderNode).
 * @param {Array<{ id: string, width?: number, height?: number }>} items
 * @param {number} [columns=1]
 * @param {number} [padding=35]
 * @param {number} [gap=30]
 * @param {number} [headerOffset=60]
 * @returns {{ width: number, height: number, positions: Map<string, {x: number, y: number}> }}
 */
function computeContainerLayout(items = [], columns = 1, padding = 35, gap = 30, headerOffset = 60) {
  if (items.length === 0) {
    return { width: 320, height: 180, positions: new Map() };
  }

  const cols = Math.min(items.length, Math.max(1, columns));
  const positions = new Map();

  let maxRowHeight = 0;
  let currentX = padding;
  let currentY = headerOffset + padding;
  let maxRight = 0;
  let maxBottom = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const w = item.width || 260;
    const h = item.height || 180;

    const colIndex = i % cols;
    if (colIndex === 0 && i !== 0) {
      currentX = padding;
      currentY += maxRowHeight + gap;
      maxRowHeight = 0;
    }

    positions.set(item.id, { x: currentX, y: currentY });

    if (h > maxRowHeight) maxRowHeight = h;
    const itemRight = currentX + w;
    const itemBottom = currentY + h;
    if (itemRight > maxRight) maxRight = itemRight;
    if (itemBottom > maxBottom) maxBottom = itemBottom;

    currentX += w + gap;
  }

  return {
    width: Math.max(340, maxRight + padding),
    height: Math.max(200, maxBottom + padding),
    positions
  };
}

module.exports = {
  MIN_COMPONENT_WIDTH,
  MAX_COMPONENT_WIDTH,
  MIN_COMPONENT_HEIGHT,
  MAX_COMPONENT_HEIGHT,
  calculateNodeDimensions,
  layoutTagsOnNode,
  computeContainerLayout
};

