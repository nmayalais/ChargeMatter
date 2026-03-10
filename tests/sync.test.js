'use strict';

/**
 * CI drift check: verifies that exported function names in engine.js
 * match the top-level function declarations in Code.gs.
 *
 * This catches cases where a function is added/renamed in one file
 * but not the other.
 */

const fs = require('fs');
const path = require('path');

const ENGINE_PATH = path.join(__dirname, '../cli/engine.js');
const CODEJS_PATH = path.join(__dirname, '../apps-script/Code.gs');

// Extract `function <name>(` declarations from a source string at any depth.
// Excludes anonymous functions and arrow functions.
function extractFunctionNames(src) {
  const names = new Set();
  const re = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

// Functions that intentionally exist only in engine.js (test/CLI helpers)
const ENGINE_ONLY = new Set([
  'createEngine',
]);

// Functions that intentionally exist only in Code.gs (GAS-specific entry points)
const GAS_ONLY = new Set([
  'doGet',
  'doPost',
]);

describe('Code.gs / engine.js function sync', () => {
  let engineSrc, gasSrc;

  beforeAll(() => {
    engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
    gasSrc = fs.readFileSync(CODEJS_PATH, 'utf8');
  });

  test('engine.js has no public functions missing from Code.gs', () => {
    const engineFns = extractFunctionNames(engineSrc);
    const gasFns = extractFunctionNames(gasSrc);

    const missingInGas = [...engineFns].filter(
      (fn) => !gasFns.has(fn) && !ENGINE_ONLY.has(fn)
    );

    expect(missingInGas).toEqual([]);
  });

  test('Code.gs has no public functions missing from engine.js', () => {
    const engineFns = extractFunctionNames(engineSrc);
    const gasFns = extractFunctionNames(gasSrc);

    const missingInEngine = [...gasFns].filter(
      (fn) => !engineFns.has(fn) && !GAS_ONLY.has(fn)
    );

    expect(missingInEngine).toEqual([]);
  });
});
