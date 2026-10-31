/**
 * @file markerParser.test.js
 * Unit tests for component marker comment parsing engine.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseComponentsFromSource, wrapComponentInComment } = require('../src/markerParser');

test('Marker Parser - Extracts JavaScript component blocks', () => {
  const code = `
function init() {
  console.log("start");
}

// <{<< AuthModule >>}>
function login(user, pass) {
  return true;
}
// </{<< AuthModule >>}>

console.log("end");
  `;

  const components = parseComponentsFromSource(code, 'src/auth.js');
  assert.equal(components.length, 1);

  const comp = components[0];
  assert.equal(comp.name, 'AuthModule');
  assert.equal(comp.startMarkerLine, 5);
  assert.equal(comp.endMarkerLine, 9);
  assert.equal(comp.lineCount, 3);
  assert.equal(comp.rawLines.length, 3);
  assert.match(comp.rawLines[0], /function login/);
});

test('Marker Parser - Extracts Python component blocks (# comments)', () => {
  const code = `
# <{<< DataPipeline >>}>
def process_data(records):
    cleaned = [r.strip() for r in records]
    return cleaned
# </{<< DataPipeline >>}>
  `;

  const components = parseComponentsFromSource(code, 'pipeline.py');
  assert.equal(components.length, 1);

  const comp = components[0];
  assert.equal(comp.name, 'DataPipeline');
  assert.equal(comp.lineCount, 3);
});

test('Marker Parser - Extracts HTML comment markers', () => {
  const html = `
<!DOCTYPE html>
<html>
<body>
<!-- <{<< NavbarComponent >>}> -->
<nav>
  <a href="/">Home</a>
</nav>
<!-- </{<< NavbarComponent >>}> -->
</body>
</html>
  `;

  const components = parseComponentsFromSource(html, 'index.html');
  assert.equal(components.length, 1);
  assert.equal(components[0].name, 'NavbarComponent');
  assert.equal(components[0].lineCount, 3);
});

test('Marker Parser - Gracefully recovers from unclosed marker comment', () => {
  const code = `
// <{<< UnfinishedComponent >>}>
const x = 10;
const y = 20;
  `;

  const components = parseComponentsFromSource(code, 'broken.js');
  assert.equal(components.length, 1);
  assert.equal(components[0].name, 'UnfinishedComponent');
  assert.equal(components[0].isUnclosed, true);
  assert.equal(components[0].lineCount, 2);
});

test('Marker Parser - wrapComponentInComment formats correctly per language', () => {
  const py = wrapComponentInComment('MyComp', ['a = 1'], '.py');
  assert.ok(py.startsWith('# <{<< MyComp >>}>'));
  assert.ok(py.endsWith('# </{<< MyComp >>}>'));

  const js = wrapComponentInComment('MyComp', ['const a = 1;'], '.js');
  assert.ok(js.startsWith('// <{<< MyComp >>}>'));
  assert.ok(js.endsWith('// </{<< MyComp >>}>'));

  const html = wrapComponentInComment('MyComp', ['<div></div>'], '.html');
  assert.ok(html.startsWith('<!-- <{<< MyComp >>}> -->'));
  assert.ok(html.endsWith('<!-- </{<< MyComp >>}> -->'));
});

