/**
 * @file layoutEngine.test.js
 * Unit tests for node sizing, relative tag placement, and gap compression.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_COMPONENT_WIDTH,
  MIN_COMPONENT_HEIGHT,
  MAX_COMPONENT_WIDTH,
  MAX_COMPONENT_HEIGHT,
  calculateNodeDimensions,
  layoutTagsOnNode,
  computeContainerLayout
} = require('../src/layoutEngine');

test('Layout Engine - Enforces minimum node dimensions', () => {
  const comp = { lineCount: 1 };
  const tags = [];
  const dims = calculateNodeDimensions(comp, tags);

  assert.ok(dims.width >= MIN_COMPONENT_WIDTH);
  assert.ok(dims.height >= MIN_COMPONENT_HEIGHT);
});

test('Layout Engine - Scales up dimensions with line count and tags', () => {
  const smallComp = { lineCount: 5 };
  const largeComp = { lineCount: 40 };
  const tags = [
    { title: 'Tag 1', word: 'varOne' },
    { title: 'Tag 2', word: 'varTwo' },
    { title: 'Tag 3', word: 'varThree' }
  ];

  const smallDims = calculateNodeDimensions(smallComp, []);
  const largeDims = calculateNodeDimensions(largeComp, tags);

  assert.ok(largeDims.height > smallDims.height);
  assert.ok(largeDims.height <= MAX_COMPONENT_HEIGHT);
  assert.ok(largeDims.width <= MAX_COMPONENT_WIDTH);
});

test('Layout Engine - Tags on the same line have identical vertical Y coordinates', () => {
  const tags = [
    { id: 't1', range: { startLine: 10, startCharacter: 2, endLine: 10, endCharacter: 6 } },
    { id: 't2', range: { startLine: 10, startCharacter: 12, endLine: 10, endCharacter: 18 } }
  ];

  const layouted = layoutTagsOnNode(tags, 200, 300);
  assert.equal(layouted.length, 2);
  assert.equal(layouted[0].y, layouted[1].y);
  assert.ok(layouted[0].x < layouted[1].x); // Left-to-right distribution
});

test('Layout Engine - Line gap compression clamps large line gaps', () => {
  const tags = [
    { id: 't1', range: { startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 5 } },
    { id: 't2', range: { startLine: 100, startCharacter: 0, endLine: 100, endCharacter: 5 } }
  ];

  const layouted = layoutTagsOnNode(tags, 250, 300);
  assert.equal(layouted.length, 2);
  // Without compression, line 100 would overflow or require massive height.
  // With compression, both fit comfortably inside usable height (<= 250px)
  assert.ok(layouted[0].y < layouted[1].y);
  assert.ok(layouted[1].y <= 250);
});

test('Layout Engine - computeContainerLayout calculates bounding box for children', () => {
  const items = [
    { id: 'c1', width: 200, height: 150 },
    { id: 'c2', width: 200, height: 150 },
    { id: 'c3', width: 200, height: 150 }
  ];

  const layout = computeContainerLayout(items, 2, 30, 20, 50);
  assert.ok(layout.width > 400);
  assert.ok(layout.height > 300);
  assert.equal(layout.positions.size, 3);
  assert.ok(layout.positions.has('c1'));
  assert.ok(layout.positions.has('c2'));
  assert.ok(layout.positions.has('c3'));
});

test('Layout Engine - computeContainerLayout places items in a single vertical column in order', () => {
  const items = [
    { id: 'c1', width: 240, height: 150 },
    { id: 'c2', width: 240, height: 160 },
    { id: 'c3', width: 240, height: 140 }
  ];

  const layout = computeContainerLayout(items, 1, 35, 30, 65);
  const p1 = layout.positions.get('c1');
  const p2 = layout.positions.get('c2');
  const p3 = layout.positions.get('c3');

  // All X coordinates must be aligned to padding (35px)
  assert.equal(p1.x, 35);
  assert.equal(p2.x, 35);
  assert.equal(p3.x, 35);

  // Y coordinates must be stacked vertically in order
  assert.equal(p1.y, 65 + 35); // 100
  assert.equal(p2.y, p1.y + 150 + 30); // 280
  assert.equal(p3.y, p2.y + 160 + 30); // 470
  assert.ok(p1.y < p2.y);
  assert.ok(p2.y < p3.y);
});

