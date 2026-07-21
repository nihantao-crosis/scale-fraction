'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function createApp(options = {}) {
  const copied = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const html = pageSource.replace(
    '<script src="core.js"></script>',
    '<script>' + coreSource.replace(/<\/script/gi, '<\\/script') + '</script>'
  );
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.test/app/index.html',
    virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value) => {
          if (options.rejectClipboard) throw new Error('clipboard denied');
          copied.push(value);
        } }
      });
      window.URL.createObjectURL = () => 'blob:test';
      window.URL.revokeObjectURL = () => {};
    }
  });
  dom.window.addEventListener('error', (event) => errors.push(event.error || new Error(event.message)));
  dom.window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));
  return { dom, copied, errors };
}

function setInput(dom, id, value) {
  const input = dom.window.document.getElementById(id);
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  return input;
}

function pressKey(dom, element, key) {
  element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
}

function openTool(document, id) {
  document.querySelector('[data-tool="' + id + '"]').click();
}

function closeTool(document) {
  document.getElementById('tool-back').click();
}

function assertFieldError(document, id, invalid, errorId) {
  const field = document.getElementById(id);
  assert.equal(field.getAttribute('aria-invalid'), String(invalid), id);
  assert.equal(field.getAttribute('aria-describedby'), invalid ? errorId : null, id);
}

function finish(app) {
  assert.deepEqual(app.errors.map(String), []);
  app.dom.window.close();
}

test('tabs, labels, groups, keypad names and tool focus are accessible', async () => {
  const app = createApp();
  const { document } = app.dom.window;

  for (const label of document.querySelectorAll('label')) {
    assert.ok(label.htmlFor, 'visible label must have a for attribute');
    assert.ok(document.getElementById(label.htmlFor), label.htmlFor);
  }
  assert.ok(document.querySelectorAll('.chips[role="group"]').length >= 12);
  for (const button of document.querySelectorAll('#keypad button')) {
    assert.ok(button.getAttribute('aria-label'), button.textContent);
    assert.equal(button.type, 'button');
  }
  for (const result of document.querySelectorAll('.result')) {
    assert.notEqual(result.getAttribute('role'), 'status');
    assert.notEqual(result.getAttribute('aria-atomic'), 'true');
  }

  const firstTab = document.getElementById('tab-len');
  firstTab.focus();
  pressKey(app.dom, document.getElementById('tabs'), 'ArrowRight');
  assert.equal(document.activeElement, document.getElementById('tab-scale'));
  assert.equal(document.getElementById('tab-scale').getAttribute('aria-selected'), 'true');
  pressKey(app.dom, document.getElementById('tabs'), 'End');
  assert.equal(document.activeElement, document.getElementById('tab-tools'));

  const cards = Array.from(document.querySelectorAll('#tools-home .tcard'));
  assert.equal(cards.length, 14);
  for (const card of cards) {
    card.focus();
    card.click();
    await new Promise((resolve) => app.dom.window.setTimeout(resolve, 0));
    const tool = document.getElementById('tv-' + card.dataset.tool);
    const title = tool.querySelector('[data-tool-title]');
    assert.equal(tool.hidden, false, card.dataset.tool);
    assert.equal(tool.getAttribute('role'), 'region');
    assert.equal(document.activeElement, title);
    assert.ok(document.activeElement.textContent.trim());
    assert.equal(title.classList.contains('sr-only'), false);
    assert.equal(app.dom.window.getComputedStyle(title).display, 'block');
    assert.match(app.dom.window.getComputedStyle(title).outline, /3px solid/);
    closeTool(document);
    assert.equal(document.activeElement, card);
  }

  finish(app);
});

test('editing, keypad input and backspace invalidate stale results and copy state', async () => {
  const app = createApp();
  const { document } = app.dom.window;
  const input = setInput(app.dom, 'i-expr', "1' + 1'");
  pressKey(app.dom, input, 'Enter');
  assert.equal(document.getElementById('res-main').textContent, '2′-0″');
  assert.equal(document.getElementById('len-res').hidden, false);

  setInput(app.dom, 'i-expr', "3'");
  assert.equal(document.getElementById('len-res').hidden, true);
  assert.equal(document.getElementById('copy-res').textContent, 'Copy');
  document.getElementById('copy-res').click();
  await Promise.resolve();
  assert.deepEqual(app.copied, []);

  pressKey(app.dom, input, 'Enter');
  assert.equal(document.getElementById('res-main').textContent, '3′-0″');
  document.querySelector('#keypad [data-k="1"]').click();
  assert.equal(document.getElementById('len-res').hidden, true);

  setInput(app.dom, 'i-expr', "2'");
  pressKey(app.dom, input, 'Enter');
  document.querySelector('#keypad [data-k="bs"]').click();
  assert.equal(document.getElementById('len-res').hidden, true);
  finish(app);
});

test('drawing-scale percentages, copy state and invalid fields stay exact', async () => {
  const app = createApp();
  const { document } = app.dom.window;
  document.getElementById('tab-scale').click();
  document.querySelector('#chips-from [data-idx="-1"]').click();
  document.querySelector('#chips-to [data-idx="-1"]').click();
  setInput(app.dom, 'i-cuF', '1');
  setInput(app.dom, 'i-cuT', '1.005');

  assert.equal(document.getElementById('s-mult').textContent, '1.01×');
  assert.equal(document.getElementById('s-printer').textContent, '+0.5%');
  assert.equal(document.getElementById('s-ind').textContent, '100.5%');

  document.getElementById('copy-pr').click();
  await Promise.resolve();
  assert.equal(document.getElementById('copy-pr').textContent, 'Copied ✓');
  setInput(app.dom, 'i-cuT', '3');
  assert.equal(document.getElementById('s-printer').textContent, '+200%');
  assert.equal(document.getElementById('copy-pr').textContent, 'Copy');
  assert.equal(document.getElementById('copy-status').textContent, '');

  document.getElementById('copy-pr').click();
  setInput(app.dom, 'i-cuT', '4');
  await Promise.resolve();
  assert.equal(document.getElementById('copy-pr').textContent, 'Copy', 'late clipboard completion must be ignored');

  setInput(app.dom, 'i-cuF', 'bad');
  assert.equal(document.getElementById('i-cuF').getAttribute('aria-invalid'), 'true');
  assert.equal(document.getElementById('i-cuF').getAttribute('aria-describedby'), 's-err');
  assert.equal(document.getElementById('i-cuT').getAttribute('aria-invalid'), 'false');

  setInput(app.dom, 'i-cuF', '1/9999999');
  setInput(app.dom, 'i-cuT', '9999999');
  assert.equal(document.getElementById('s-res').hidden, false);
  assert.equal(document.getElementById('s-ind').textContent, '9999998000000100%');

  setInput(app.dom, 'i-cuF', '1/9999999999');
  assert.equal(document.getElementById('s-res').hidden, true);
  assert.match(document.getElementById('s-err').textContent, /outside the supported numeric range/i);
  assertFieldError(document, 'i-cuF', false, 's-err');
  assertFieldError(document, 'i-cuT', false, 's-err');
  finish(app);
});

test('tool errors only identify the visible fields that are actually invalid', () => {
  const app = createApp();
  const { document } = app.dom.window;
  document.getElementById('tab-tools').click();

  openTool(document, 'cv');
  setInput(app.dom, 'cv-l', 'bad');
  setInput(app.dom, 'cv-w', "12'");
  setInput(app.dom, 'cv-t', '4"');
  assertFieldError(document, 'cv-l', true, 'cv-err');
  assertFieldError(document, 'cv-w', false, 'cv-err');
  assertFieldError(document, 'cv-t', false, 'cv-err');
  setInput(app.dom, 'cv-l', "20'");
  assert.equal(document.getElementById('cv-res').hidden, false);
  for (const id of ['cv-l', 'cv-w', 'cv-t']) assertFieldError(document, id, false, 'cv-err');
  closeTool(document);

  openTool(document, 'sl');
  document.querySelectorAll('#sl-mode .chip')[3].click();
  setInput(app.dom, 'sl-a', 'bad');
  setInput(app.dom, 'sl-b', "12'");
  assertFieldError(document, 'sl-a', true, 'sl-err');
  assertFieldError(document, 'sl-b', false, 'sl-err');
  setInput(app.dom, 'sl-a', '4"');
  assert.equal(document.getElementById('sl-res').hidden, false);
  assertFieldError(document, 'sl-a', false, 'sl-err');
  assertFieldError(document, 'sl-b', false, 'sl-err');
  closeTool(document);

  openTool(document, 'sp');
  setInput(app.dom, 'sp-len', 'bad');
  setInput(app.dom, 'sp-n', '5');
  assertFieldError(document, 'sp-len', true, 'sp-err');
  assertFieldError(document, 'sp-n', false, 'sp-err');
  assertFieldError(document, 'sp-cu', false, 'sp-err');
  setInput(app.dom, 'sp-len', "12'");
  setInput(app.dom, 'sp-n', 'bad');
  assertFieldError(document, 'sp-len', false, 'sp-err');
  assertFieldError(document, 'sp-n', true, 'sp-err');
  document.querySelectorAll('#sp-mode .chip')[1].click();
  assert.equal(document.getElementById('sp-n').closest('[hidden]').id, 'sp-eq-row');
  assertFieldError(document, 'sp-n', false, 'sp-err');
  document.querySelectorAll('#sp-oc .chip')[4].click();
  setInput(app.dom, 'sp-cu', 'bad');
  assertFieldError(document, 'sp-len', false, 'sp-err');
  assertFieldError(document, 'sp-n', false, 'sp-err');
  assertFieldError(document, 'sp-cu', true, 'sp-err');

  finish(app);
});

test('area tally preserves a valid total while a pending room is corrected', () => {
  const app = createApp();
  const { document } = app.dom.window;
  document.getElementById('tab-tools').click();
  openTool(document, 'at');
  setInput(app.dom, 'at-in', "12' × 14'");
  document.getElementById('at-add').click();
  assert.match(document.getElementById('at-res').textContent, /168 ft²/);

  setInput(app.dom, 'at-in', 'bad');
  document.getElementById('at-add').click();
  assert.equal(document.getElementById('at-res').hidden, false);
  assert.match(document.getElementById('at-res').textContent, /168 ft²/);
  assert.equal(document.getElementById('at-in').getAttribute('aria-invalid'), 'true');

  setInput(app.dom, 'at-in', "10' × 10'");
  assert.equal(document.getElementById('at-err').hidden, true);
  assert.equal(document.getElementById('at-in').getAttribute('aria-invalid'), 'false');
  assert.equal(document.getElementById('at-res').hidden, false);
  finish(app);
});

test('successful results use one concise live announcement and copy failures are exposed', async () => {
  const app = createApp({ rejectClipboard: true });
  const { document } = app.dom.window;
  const input = setInput(app.dom, 'i-expr', "1' + 1'");
  pressKey(app.dom, input, 'Enter');
  await new Promise((resolve) => app.dom.window.setTimeout(resolve, 275));
  assert.equal(document.getElementById('result-status').textContent, 'RESULT · LENGTH: 2′-0″');
  assert.doesNotMatch(document.getElementById('result-status').textContent, /Total Inches|Decimal/);

  document.getElementById('copy-res').click();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(document.getElementById('copy-res').textContent, 'Copy Failed');
  assert.equal(document.getElementById('copy-status').textContent, 'Copy failed.');
  finish(app);
});

test('tab changes cancel stale announcements and hidden tools ignore Escape', async () => {
  const app = createApp();
  const { document } = app.dom.window;
  const expression = setInput(app.dom, 'i-expr', "1' + 1'");
  pressKey(app.dom, expression, 'Enter');

  const toolsTab = document.getElementById('tab-tools');
  toolsTab.focus();
  toolsTab.click();
  await new Promise((resolve) => app.dom.window.setTimeout(resolve, 275));
  assert.equal(document.getElementById('result-status').textContent, '');

  const card = document.querySelector('[data-tool="mc"]');
  card.focus();
  card.click();
  await new Promise((resolve) => app.dom.window.setTimeout(resolve, 0));
  setInput(app.dom, 'mc-in', '2440mm');

  const lengthTab = document.getElementById('tab-len');
  lengthTab.focus();
  lengthTab.click();
  pressKey(app.dom, document, 'Escape');
  assert.equal(document.activeElement, lengthTab);
  assert.equal(document.getElementById('tool-view').hidden, false, 'hidden tool state must not handle Escape');
  assert.equal(document.getElementById('tools-home').hidden, true);
  await new Promise((resolve) => app.dom.window.setTimeout(resolve, 275));
  assert.equal(document.getElementById('result-status').textContent, '');

  toolsTab.focus();
  toolsTab.click();
  pressKey(app.dom, document, 'Escape');
  assert.equal(document.getElementById('tool-view').hidden, true);
  assert.equal(document.getElementById('tools-home').hidden, false);
  assert.equal(document.activeElement, card);
  finish(app);
});

test('all 14 tools execute their primary browser path without page errors', () => {
  const app = createApp();
  const { document } = app.dom.window;
  document.getElementById('tab-tools').click();

  openTool(document, 'mc');
  setInput(app.dom, 'mc-in', '2440mm');
  assert.equal(document.getElementById('mc-res').hidden, false);
  closeTool(document);

  openTool(document, 'sp');
  setInput(app.dom, 'sp-len', "12'-6\"");
  setInput(app.dom, 'sp-n', '5');
  assert.match(document.getElementById('sp-res').textContent, /5 × 2′-6″/);
  closeTool(document);

  openTool(document, 'st');
  document.querySelectorAll('#st-code .chip')[1].click();
  setInput(app.dom, 'st-rise', "9'-1 1/2\"");
  assert.match(document.getElementById('st-res').textContent, /16 RISERS/);
  assert.match(document.getElementById('st-res').textContent, /6 27\/32″/);
  assert.doesNotMatch(document.getElementById('st-res').textContent, /Nearest 1\/16/);
  closeTool(document);

  openTool(document, 'sm');
  setInput(app.dom, 'sm-in', '2 3/8"');
  assert.equal(document.getElementById('sm-res').hidden, false);
  closeTool(document);

  openTool(document, 'sc2');
  assert.equal(document.getElementById('sc2-res').hidden, false);
  closeTool(document);

  openTool(document, 'sl');
  setInput(app.dom, 'sl-a', '1');
  assert.match(document.getElementById('sl-res').textContent, /AT \/ BELOW 1:12/);
  assert.doesNotMatch(document.getElementById('sl-res').textContent, /\bOK\b|COMPLIANT/i);
  closeTool(document);

  openTool(document, 'br');
  setInput(app.dom, 'br-in', "8'-8\"");
  assert.equal(document.getElementById('br-res').hidden, false);
  closeTool(document);

  openTool(document, 'at');
  setInput(app.dom, 'at-in', "12' × 14'");
  document.getElementById('at-add').click();
  assert.match(document.getElementById('at-res').textContent, /168 ft²/);
  closeTool(document);

  openTool(document, 'cv');
  setInput(app.dom, 'cv-l', "20'");
  setInput(app.dom, 'cv-w', "12'");
  setInput(app.dom, 'cv-t', '4"');
  assert.match(document.getElementById('cv-res').textContent, /2.96 yd³/);
  closeTool(document);

  openTool(document, 'sg');
  setInput(app.dom, 'sg-l', "40'");
  setInput(app.dom, 'sg-w', "9'");
  assert.match(document.getElementById('sg-res').textContent, /12 SHEETS/);
  closeTool(document);

  openTool(document, 'dr');
  setInput(app.dom, 'dr-in', '3068');
  assert.match(document.getElementById('dr-res').textContent, /3′-0″ × 6′-8″/);
  closeTool(document);

  openTool(document, 'ps');
  assert.equal(document.getElementById('ps-res').hidden, false);
  closeTool(document);

  openTool(document, 'ms');
  assert.match(document.getElementById('ms-table').textContent, /1:100/);
  closeTool(document);

  openTool(document, 'sb');
  assert.match(document.getElementById('sb-prev').innerHTML, /<svg/);
  finish(app);
});

test('rounded tool displays identify approximations and preserve exact slope boundaries', () => {
  const app = createApp();
  const { document } = app.dom.window;
  document.getElementById('tab-tools').click();

  openTool(document, 'sl');
  setInput(app.dom, 'sl-a', '1.000001');
  assert.equal(document.querySelector('#sl-res .res-main').textContent, '1 1/1000000 : 12');
  assert.match(document.getElementById('sl-res').textContent, /STEEPER THAN 1:12/);

  document.querySelectorAll('#sl-mode .chip')[1].click();
  setInput(app.dom, 'sl-a', '8.333334');
  assert.equal(document.querySelector('#sl-res .res-main').textContent, '1 1/12500000 : 12');
  assert.match(document.getElementById('sl-res').textContent, /STEEPER THAN 1:12/);

  document.querySelectorAll('#sl-mode .chip')[3].click();
  setInput(app.dom, 'sl-a', '1.000001"');
  setInput(app.dom, 'sl-b', '12"');
  assert.equal(document.querySelector('#sl-res .res-main').textContent, '1 1/1000000 : 12');
  assert.match(document.getElementById('sl-res').textContent, /STEEPER THAN 1:12/);

  document.querySelectorAll('#sl-mode .chip')[2].click();
  setInput(app.dom, 'sl-a', '4.763642');
  assert.match(document.querySelector('#sl-res .res-main').textContent, /^≈ 1\.000000/);
  assert.match(document.getElementById('sl-res').textContent, /STEEPER THAN 1:12/);
  closeTool(document);

  openTool(document, 'mc');
  setInput(app.dom, 'mc-in', '2440mm');
  assert.match(document.getElementById('mc-res').textContent, /Converted Inches · Decimal≈/);
  assert.doesNotMatch(document.getElementById('mc-res').textContent, /Exact≈/);
  closeTool(document);

  openTool(document, 'ps');
  assert.match(document.getElementById('ps-res').textContent, /Exact Factor× 11\/24/);
  assert.match(document.getElementById('ps-res').textContent, /Decimal Factor≈ 0\.4583×/);
  finish(app);
});
