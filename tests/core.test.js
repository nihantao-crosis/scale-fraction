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
  assert.equal(Core.gcd(-24, 18), 6);
  assert.equal(Core.gcd(0, 0), 1);
  const a = Core.fr(3999999999999999, 2);
  const b = Core.fr(-3999999999999998, 3);
  assert.deepEqual(Core.fAdd(a, b), { n: 4000000000000001, d: 6 });
  assert.deepEqual(Core.fDiv(a, a), { n: 1, d: 1 });
});

test('exact decimal formatting rounds half values away from zero', () => {
  assert.equal(Core.decStr(Core.fr(3, 40), 2), '0.08');
  assert.equal(Core.decStr(Core.fr(7, 40), 2), '0.18');
  assert.equal(Core.decStr(Core.fr(201, 200), 2), '1.01');
  assert.equal(Core.decStr(Core.fr(-3, 40), 2), '-0.08');
  assert.equal(Core.decStr(Core.fr(2), 3), '2');

  const fine = Core.parseLen('1.0005"');
  assert.equal(Core.fmtFtIn(fine).dec, '1.001″');
  assert.equal(Core.snapRow16(fine).v, '1″ (−0.001″)');
  assert.doesNotMatch(Core.snapRow16(fine).v, /[+−-]0″/);
  assert.deepEqual(
    Core.roundToDenominator(Core.fr(Number.MAX_SAFE_INTEGER), 16),
    { n: Number.MAX_SAFE_INTEGER, d: 1 }
  );
});

test('length calculator handles standard operations', () => {
  assert.equal(Core.fmtFtIn(expression("3'-10\" ÷ 3").f).main, '1′-3 1/3″');
  assert.equal(Core.fmtFtIn(expression("3'-10 1/2\" + 1'-1 1/2\"").f).main, '5′-0″');
  assert.equal(Core.resultView(expression("2' × 3'")).main, '6 ft²');
  assert.equal(Core.resultView(expression("6' ÷ 2'")).main, '3 : 1');
  assert.equal(Core.resultView(expression("1' / 2")).kind, 'RESULT · LENGTH');
  assert.equal(Core.resultView(expression('6" × 6"')).main, '36 in²');
  assert.match(Core.parseExpr('not a length').err, /could not read/i);
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
  assert.equal(view.rows[1].v, '11999986800001200%');
  assert.equal(Core.scaledDecStr(ratio.f, 100, 2), '11999986800001200');
});

test('tiny exact areas remain visible instead of becoming zero', () => {
  const tiny = expression('1/9999999" × 1/9999999"');
  assert.deepEqual(tiny.f, { n: 1, d: 99999980000001 });
  assert.equal(Core.mainOf(tiny), '1/99999980000001 in²');
  assert.equal(Core.resultView(tiny).main, '1/99999980000001 in²');
  assert.doesNotMatch(JSON.stringify(Core.resultView(tiny)), /undefined|null/);
});

test('concrete overflow is an error, never a zero volume', () => {
  const huge = Core.parseLen("9999999'");
  const result = Core.calculateConcrete(huge, huge, Core.parseLen('1"'));
  assert.match(result.err, /too large/i);
  assert.equal(result.yd3, undefined);

  const normal = Core.calculateConcrete(
    Core.parseLen("20'"), Core.parseLen("12'"), Core.parseLen('4"')
  );
  assert.equal(normal.ft3, 80);
  assert.equal(normal.yd3, 80 / 27);
});

test('IBC profile enforces the 4 inch minimum riser', () => {
  const invalid = Core.calculateStairs(Core.parseLen('5"'), 'IBC_2024');
  assert.match(invalid.err, /minimum riser of 4/i);
  assert.match(invalid.err, /single-riser/i);

  const valid = Core.calculateStairs(Core.parseLen('8"'), 'IBC_2024');
  assert.equal(valid.count, 2);
  assert.equal(valid.riserDec, 4);
  assert.equal(valid.alternativeCount, null);
  assert.equal(valid.withinDimensionalReference, true);
});

test('stair thresholds use exact rational comparisons', () => {
  const ibcAtMax = Core.calculateStairs(Core.parseLen("7'"), 'IBC_2024');
  assert.equal(ibcAtMax.count, 12);
  assert.deepEqual(ibcAtMax.riser, { n: 7, d: 1 });

  const ibcOverMax = Core.calculateStairs(Core.parseLen("7' 1/9999999999\""), 'IBC_2024');
  assert.equal(ibcOverMax.count, 13);
  assert.equal(ibcOverMax.withinDimensionalReference, true);
  assert.ok(Core.compareFractions(ibcOverMax.riser, Core.fr(7)) <= 0);

  assert.equal(Core.calculateStairs(Core.parseLen('14"'), 'IBC_2024').count, 2);
  assert.equal(Core.calculateStairs(Core.parseLen('14.000001"'), 'IBC_2024').count, 3);
  assert.equal(Core.calculateStairs(Core.parseLen('15.5"'), 'IRC_2024').count, 2);
  assert.equal(Core.calculateStairs(Core.parseLen('15.500001"'), 'IRC_2024').count, 3);

  const belowMin = Core.calculateStairs(Core.fr(79999999999, 10000000000), 'IBC_2024');
  assert.match(belowMin.err, /minimum riser of 4/i);
});

test('stair alternatives and single-flight warnings are constrained', () => {
  const normal = Core.calculateStairs(Core.parseLen("9'-1 1/2\""), 'IBC_2024');
  assert.equal(normal.count, 16);
  assert.deepEqual(normal.riser, { n: 219, d: 32 });
  assert.deepEqual(normal.runFraction, { n: 675, d: 4 });
  assert.deepEqual(normal.comfortFraction, { n: 399, d: 16 });
  assert.ok(normal.riserDec >= 4 && normal.riserDec <= 7);

  assert.equal(Core.calculateStairs(Core.parseLen("12'"), 'IBC_2024').flightWarning, null);
  assert.match(Core.calculateStairs(Core.parseLen("12'-0.000001\""), 'IBC_2024').flightWarning, /multiple flights/i);
  assert.equal(Core.calculateStairs(Core.parseLen("12'-7\""), 'IRC_2024').flightWarning, null);
  assert.match(Core.calculateStairs(Core.parseLen("12'-7.000001\""), 'IRC_2024').flightWarning, /multiple flights/i);

  const tall = Core.calculateStairs(Core.parseLen("13'"), 'IBC_2024');
  assert.match(tall.flightWarning, /multiple flights/i);
});

test('ADA running-slope references use exact input comparisons', () => {
  assert.equal(Core.analyzeSlope('pitch', Core.fr(1)).atOrBelowOneInTwelve, true);
  assert.equal(Core.analyzeSlope('pitch', Core.fr(1000001, 1000000)).atOrBelowOneInTwelve, false);
  assert.equal(Core.analyzeSlope('percent', Core.fr(25, 3)).atOrBelowOneInTwelve, true);
  assert.equal(Core.analyzeSlope('percent', Core.fr(4166667, 500000)).atOrBelowOneInTwelve, false);
  assert.equal(Core.analyzeSlope('riseRun', Core.fr(1), Core.fr(12)).atOrBelowOneInTwelve, true);
  assert.equal(Core.analyzeSlope('riseRun', Core.fr(1000001, 1000000), Core.fr(12)).atOrBelowOneInTwelve, false);

  const largeRise = Core.parseLen("833333'-0 1/16\"");
  const largeRun = Core.parseLen("9999996'");
  assert.equal(Core.analyzeSlope('riseRun', largeRise, largeRun).atOrBelowOneInTwelve, false);
  assert.match(Core.analyzeSlope('riseRun', Core.fr(1), Core.fr(0)).err, /greater than 0/i);
  assert.match(Core.analyzeSlope('degrees', Core.fr(90)).err, /not including/i);
  assert.equal(Core.analyzeSlope('degrees', Core.fr(4)).atOrBelowOneInTwelve, true);
  assert.match(Core.analyzeSlope('unknown', Core.fr(1)).err, /unknown/i);
});

test('exact floor and ceiling helpers avoid epsilon rounding errors', () => {
  assert.equal(Core.floorDivFraction(Core.fr(120), Core.fr(16)), 7);
  assert.equal(Core.ceilDivFraction(Core.fr(4609), Core.fr(4608)), 2);
  assert.equal(Core.ceilDivFraction(Core.fr(4608), Core.fr(4608)), 1);
  assert.equal(Core.trimNumber(Infinity, 2), 'OUT OF RANGE');
  assert.equal(Core.trimNumber(1.2, 3), '1.2');
  assert.equal(Core.formatApproxNumber(1.25, 2), '1.25');
  assert.match(Core.calculateConcrete(null, Core.fr(1), Core.fr(1)).err, /positive/i);
});
