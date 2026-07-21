'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

function expression(input) {
  const parsed = Core.parseExpr(input);
  assert.equal(parsed.err, undefined, parsed.err);
  return parsed.res;
}

test('exact fraction arithmetic uses safe BigInt intermediates', () => {
  const a = Core.fr(3999999999999999, 2);
  const b = Core.fr(-3999999999999998, 3);
  assert.deepEqual(Core.fAdd(a, b), { n: 4000000000000001, d: 6 });
  assert.deepEqual(Core.fDiv(a, a), { n: 1, d: 1 });
});

test('length calculator handles standard operations', () => {
  assert.equal(Core.fmtFtIn(expression("3'-10\" ÷ 3").f).main, '1′-3 1/3″');
  assert.equal(Core.fmtFtIn(expression("3'-10 1/2\" + 1'-1 1/2\"").f).main, '5′-0″');
  assert.equal(Core.resultView(expression("2' × 3'")).main, '6 ft²');
  assert.equal(Core.resultView(expression("6' ÷ 2'")).main, '3 : 1');
});

test('keyboard operator aliases are accepted without confusing fractions', () => {
  assert.equal(Core.fmtFtIn(expression("1' / 2").f).main, '6″');
  assert.deepEqual(expression('12" x 14"').f, { n: 168, d: 1 });
  assert.equal(Core.fmtFtIn(expression('1 / 2"').f).main, '1/2″');
  assert.match(Core.parseExpr("1' × 2 × 3").err, /one operation/i);
});

test('zero multiplication is valid and zero division is rejected', () => {
  assert.equal(Core.fmtFtIn(expression("1' × 0").f).main, '0″');
  assert.match(Core.parseExpr("1' / 0").err, /greater than 0/i);
});

test('large display conversions never throw', () => {
  const ratio = expression("9999999' ÷ 1/999999\"");
  const view = Core.resultView(ratio);
  assert.equal(view.kind, 'RESULT · RATIO');
  assert.doesNotMatch(view.rows[1].v, /undefined|null/);
});

test('concrete overflow is an error, never a zero volume', () => {
  const huge = Core.parseLen("9999999'");
  const result = Core.calculateConcrete(huge, huge, Core.parseLen('1"'));
  assert.match(result.err, /too large/i);
  assert.equal(result.yd3, undefined);
});

test('IBC profile enforces the 4 inch minimum riser', () => {
  const invalid = Core.calculateStairs(Core.parseLen('5"'), 'IBC_2024');
  assert.match(invalid.err, /at least 4/i);

  const valid = Core.calculateStairs(Core.parseLen('8"'), 'IBC_2024');
  assert.equal(valid.count, 2);
  assert.equal(valid.riserDec, 4);
  assert.equal(valid.alternativeCount, null);
  assert.equal(valid.passesDimensionalCheck, true);
});

test('stair alternatives and single-flight warnings are constrained', () => {
  const normal = Core.calculateStairs(Core.parseLen("9'-1 1/2\""), 'IBC_2024');
  assert.equal(normal.count, 16);
  assert.ok(normal.riserDec >= 4 && normal.riserDec <= 7);

  const tall = Core.calculateStairs(Core.parseLen("13'"), 'IBC_2024');
  assert.match(tall.flightWarning, /multiple flights/i);
});

test('exact floor and ceiling helpers avoid epsilon rounding errors', () => {
  assert.equal(Core.floorDivFraction(Core.fr(120), Core.fr(16)), 7);
  assert.equal(Core.ceilDivFraction(Core.fr(4609), Core.fr(4608)), 2);
  assert.equal(Core.ceilDivFraction(Core.fr(4608), Core.fr(4608)), 1);
});
