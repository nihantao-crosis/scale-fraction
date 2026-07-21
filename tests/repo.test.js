'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('manifest is valid and every declared icon exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.name);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^icons\/icon-\d+\.png$/);
    if (process.env.CI) assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
  }
});

test('HTML loads the shared core before the app script', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.ok(html.indexOf('<script src="core.js"></script>') < html.indexOf("(function () {"));
  assert.doesNotMatch(html, /ADA Ramp[^<]*OK/i);
});

test('service worker owns only its cache namespace and precaches the core', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /CACHE_PREFIX = 'sf-calc-'/);
  assert.match(sw, /\.\/core\.js/);
  assert.match(sw, /k\.indexOf\(CACHE_PREFIX\) === 0/);
  assert.match(sw, /resp\.ok/);
});
