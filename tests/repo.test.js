'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('manifest is valid and every declared icon exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.ok(manifest.name);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^icons\/icon-\d+\.png$/);
    // The review workspace can be a text-only export. A real checkout, including
    // every CI checkout, must contain every icon declared by the manifest.
    if (fs.existsSync(path.join(root, 'icons')) || process.env.CI) {
      assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src);
    }
  }
});

test('HTML loads one shared core before a syntactically valid app script', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<html lang="en">/);
  assert.ok(html.indexOf('<script src="core.js"></script>') < html.indexOf("(function () {"));
  assert.doesNotMatch(
    html,
    /function\s+(?:gcd|fr|fAdd|fMul|fDiv|parseNum|parseLen|parseExpr|resultView)\s*\(/,
    'math/parser implementations belong only in core.js'
  );
  assert.doesNotMatch(
    html,
    /(?:ADA|IBC|IRC)[^\n]{0,120}\b(?:OK|PASS(?:ES|ED)?|COMPLIANT|APPROVED)\b/i,
    'rule references must not make affirmative compliance claims'
  );
  assert.doesNotMatch(html, /class="result"[^>]+role="status"/i);
  assert.doesNotMatch(html, /class="result"[^>]+aria-atomic="true"/i);

  const inlineScripts = [...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(inlineScripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(inlineScripts[0][1], { filename: 'index.inline.js' }));
});

test('small-text foreground colors meet the 4.5:1 contrast floor', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /color:#(?:9AA0AB|767A86)/i);
  assert.match(html, /\.keys-note\{[^}]*color:#5F6470/i);
  assert.match(html, /\.s-note\{[^}]*color:#7A4D08/i);
  assert.match(html, /\.badge\.same\{[^}]*color:#5F6470/i);
  assert.doesNotMatch(html, /border:1\.5px solid #EFD5E1/i);

  function luminance(hex) {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
    return channels.map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function contrast(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  }

  assert.ok(contrast('5F6470', 'FFFFFF') >= 4.5);
  assert.ok(contrast('5F6470', 'F7E9EF') >= 4.5);
  assert.ok(contrast('A61E4D', 'FFFFFF') >= 4.5);
  assert.ok(contrast('7A4D08', 'FDF3DD') >= 4.5);
  assert.ok(contrast('5F6470', 'F5E2EB') >= 4.5);
  assert.ok(contrast('B47A91', 'FAF4F7') >= 3);
});

test('service worker owns only its cache namespace and precaches the app shell', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /CACHE_PREFIX = 'sf-calc-'/);
  assert.match(sw, /\.\/core\.js/);
  assert.match(sw, /key\.indexOf\(CACHE_PREFIX\) === 0/);
  assert.match(sw, /response\.ok/);
  assert.match(sw, /fetch\(event\.request\)/);
  assert.match(sw, /event\.waitUntil\(cacheUpdatePromise/);
  assert.doesNotThrow(() => new vm.Script(sw, { filename: 'sw.js' }));
});

test('CI and dependency metadata are reproducible', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.ok(fs.existsSync(path.join(root, 'package-lock.json')));
  assert.equal(pkg.devDependencies.jsdom, '28.1.0');
  assert.equal(lock.packages[''].engines.node, pkg.engines.node);
  assert.match(gitignore, /^node_modules\/$/m);
  assert.match(pkg.scripts.check, /node --check core\.js/);
  assert.match(pkg.scripts.check, /node --check sw\.js/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run test:coverage/);
});
