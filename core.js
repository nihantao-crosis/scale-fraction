(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ScaleFractionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_MAGNITUDE = Number.MAX_SAFE_INTEGER;
  var MAX_MAGNITUDE_BIG = BigInt(MAX_MAGNITUDE);

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { var t = a % b; a = b; b = t; }
    return a || 1;
  }

  function gcdBig(a, b) {
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { var t = a % b; a = b; b = t; }
    return a || 1n;
  }

  function packBig(n, d) {
    if (d === 0n) return null;
    if (d < 0n) { n = -n; d = -d; }
    var g = gcdBig(n, d);
    n /= g; d /= g;
    var absN = n < 0n ? -n : n;
    if (absN > MAX_MAGNITUDE_BIG || d > MAX_MAGNITUDE_BIG) return null;
    return { n: Number(n), d: Number(d) };
  }

  function fr(n, d) {
    d = d === undefined ? 1 : d;
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || d === 0) return null;
    return packBig(BigInt(n), BigInt(d));
  }

  // BigInt intermediates keep exact arithmetic even when cross-products exceed
  // Number.MAX_SAFE_INTEGER. Results are converted back only after reduction.
  function fMul(x, y) {
    if (!x || !y) return null;
    return packBig(BigInt(x.n) * BigInt(y.n), BigInt(x.d) * BigInt(y.d));
  }

  function fDiv(x, y) {
    if (!x || !y || y.n === 0) return null;
    return packBig(BigInt(x.n) * BigInt(y.d), BigInt(x.d) * BigInt(y.n));
  }

  function fAdd(x, y) {
    if (!x || !y) return null;
    return packBig(
      BigInt(x.n) * BigInt(y.d) + BigInt(y.n) * BigInt(x.d),
      BigInt(x.d) * BigInt(y.d)
    );
  }

  function compareFractions(x, y) {
    if (!x || !y) return null;
    var left = BigInt(x.n) * BigInt(y.d);
    var right = BigInt(y.n) * BigInt(x.d);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function floorDivFraction(x, y) {
    if (!x || !y || x.n < 0 || y.n <= 0) return null;
    var n = BigInt(x.n) * BigInt(y.d);
    var d = BigInt(x.d) * BigInt(y.n);
    var q = n / d;
    return q <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(q) : null;
  }

  function ceilDivFraction(x, y) {
    if (!x || !y || x.n < 0 || y.n <= 0) return null;
    var n = BigInt(x.n) * BigInt(y.d);
    var d = BigInt(x.d) * BigInt(y.n);
    var q = (n + d - 1n) / d;
    return q <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(q) : null;
  }

  function parseNum(s) {
    s = (s || '').trim();
    if (!s || s.length > 12) return null;
    var m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      var d1 = parseInt(m[3], 10);
      if (!d1) return null;
      return fr(parseInt(m[1], 10) * d1 + parseInt(m[2], 10), d1);
    }
    m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m) {
      var d2 = parseInt(m[2], 10);
      if (!d2) return null;
      return fr(parseInt(m[1], 10), d2);
    }
    m = s.match(/^(\d*)\.(\d+)$/);
    if (m && m[2].length <= 6) {
      var k = Math.pow(10, m[2].length);
      return fr(parseInt(m[1] || '0', 10) * k + parseInt(m[2], 10), k);
    }
    if (/^\d+$/.test(s)) return fr(parseInt(s, 10));
    return null;
  }

  function parseLen(s) {
    s = (s || '').replace(/[’′]/g, "'").replace(/[”″]/g, '"').trim();
    if (!s || s.length > 24) return null;
    var ft = 0, rest = s;
    var qi = s.indexOf("'");
    if (qi >= 0) {
      var fs = s.slice(0, qi).trim();
      if (fs) {
        if (!/^\d+$/.test(fs) || fs.length > 7) return null;
        ft = parseInt(fs, 10);
      }
      rest = s.slice(qi + 1);
    }
    rest = rest.trim();
    if (rest.indexOf('-') === 0) rest = rest.slice(1).trim();
    if (rest.charAt(rest.length - 1) === '"') rest = rest.slice(0, -1).trim();
    if (rest.indexOf('"') >= 0 || rest.indexOf("'") >= 0) return null;
    var inches = fr(0);
    if (rest) {
      var p = parseNum(rest);
      if (!p) return null;
      inches = p;
    }
    return fAdd(fr(ft * 12), inches);
  }

  function decimalFromBig(n, d, dp) {
    dp = dp === undefined ? 3 : dp;
    if (!Number.isInteger(dp) || dp < 0 || dp > 20 || d === 0n) return 'OUT OF RANGE';
    var negative = n < 0n;
    if (negative) n = -n;
    if (d < 0n) { d = -d; negative = !negative; }
    var scale = 10n ** BigInt(dp);
    var scaled = n * scale;
    var rounded = scaled / d;
    if ((scaled % d) * 2n >= d) rounded += 1n;

    var digits = rounded.toString();
    while (digits.length <= dp) digits = '0' + digits;
    var whole = dp ? digits.slice(0, -dp) : digits;
    var fraction = dp ? digits.slice(-dp).replace(/0+$/, '') : '';
    var out = whole + (fraction ? '.' + fraction : '');
    return negative && rounded !== 0n ? '-' + out : out;
  }

  // Decimal formatting stays in integer space so values such as 1.005 round
  // predictably. Ties are rounded away from zero and trailing zeros are removed.
  function decStr(f, dp) {
    if (!f) return 'OUT OF RANGE';
    return decimalFromBig(BigInt(f.n), BigInt(f.d), dp);
  }

  // Format a scaled fraction without first packing the scaled numerator back
  // into the public safe-integer fraction representation.
  function scaledDecStr(f, multiplier, dp) {
    if (!f || !Number.isSafeInteger(multiplier)) return 'OUT OF RANGE';
    return decimalFromBig(BigInt(f.n) * BigInt(multiplier), BigInt(f.d), dp);
  }

  function fmtFtIn(f) {
    if (!f) return { main: 'OUT OF RANGE', totalIn: 'OUT OF RANGE', dec: 'OUT OF RANGE' };
    var n = f.n, d = f.d;
    var neg = n < 0; if (neg) n = -n;
    var whole = Math.floor(n / d), rem = n - whole * d;
    var ft = Math.floor(whole / 12), inch = whole % 12;
    var fx = rem > 0 ? fr(rem, d) : null;
    var sign = neg ? '−' : '';
    var main;
    if (ft > 0) main = sign + ft + '′-' + inch + (fx ? ' ' + fx.n + '/' + fx.d : '') + '″';
    else if (fx) main = sign + (inch > 0 ? inch + ' ' : '') + fx.n + '/' + fx.d + '″';
    else main = sign + inch + '″';
    var totalIn = sign + (d === 1 ? n + '″' : n + '/' + d + '″');
    return { main: main, totalIn: totalIn, dec: sign + decStr(fr(n, d), 3) + '″' };
  }

  function fmtMixed(f) {
    if (!f) return 'OUT OF RANGE';
    var n = f.n, d = f.d;
    var neg = n < 0; if (neg) n = -n;
    var whole = Math.floor(n / d), rem = n - whole * d;
    var sign = neg ? '−' : '';
    if (rem === 0) return sign + whole;
    var fx = fr(rem, d);
    return sign + (whole > 0 ? whole + ' ' : '') + fx.n + '/' + fx.d;
  }

  function operatorMatch(s) {
    return s.match(/(÷|×|\*|[xX]|\+|−|\s-\s|\s\/\s)/);
  }

  // Deliberately supports one operation at a time. A spaced slash is division;
  // an unspaced slash remains available for fractions such as 1/2".
  function parseExpr(raw) {
    var s = (raw || '').replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/⁄/g, '/').trim();
    if (!s) return { err: 'Enter a length — e.g. 3\'-10 1/2" ÷ 3' };
    var standalone = parseLen(s);
    if (standalone) return { res: { type: 'len', f: standalone } };
    var m = operatorMatch(s);
    if (!m) {
      return { err: 'Could not read “' + s + '” — try 3\'-10 1/2", 46" or 3.5"' };
    }
    var token = m[1].trim();
    var op = token === '÷' || token === '/' ? 'div' :
      (token === '×' || token === '*' || token.toLowerCase() === 'x') ? 'mul' :
        token === '+' ? 'add' : 'sub';
    var leftS = s.slice(0, m.index).trim();
    var rightS = s.slice(m.index + m[1].length).trim();
    var A = parseLen(leftS);
    if (!A) return { err: 'Could not read the length before the operator — “' + leftS + '”' };
    if (!rightS) return { err: 'Finish the expression after the operator' };
    if (operatorMatch(rightS)) return { err: 'Use one operation at a time.' };

    if (op === 'add' || op === 'sub') {
      var B = parseLen(rightS);
      if (!B) return { err: 'Could not read the second length — “' + rightS + '”' };
      var out = fAdd(A, op === 'sub' ? fr(-B.n, B.d) : B);
      if (!out) return { err: 'Numbers got too large — try smaller values.' };
      return { res: { type: 'len', f: out } };
    }

    if (/['"]/.test(rightS)) {
      var B2 = parseLen(rightS);
      if (!B2) return { err: 'Could not read the second length — “' + rightS + '”' };
      if (op === 'div' && B2.n === 0) return { err: "Can't divide by a zero length." };
      var out2 = op === 'div' ? fDiv(A, B2) : fMul(A, B2);
      if (!out2) return { err: 'Numbers got too large — try smaller values.' };
      return { res: { type: op === 'div' ? 'ratio' : 'area', f: out2 } };
    }

    var by = parseNum(rightS);
    var invalid = !by || (op === 'div' ? by.n <= 0 : by.n < 0);
    if (invalid) {
      return { err: (op === 'div' ? 'Divisor must be greater than 0' : 'Multiplier must be 0 or greater') + ' — or add ′/″ to make it a length.' };
    }
    var out3 = op === 'div' ? fDiv(A, by) : fMul(A, by);
    if (!out3) return { err: 'Numbers got too large — try smaller values.' };
    return { res: { type: 'len', f: out3 } };
  }

  function roundToDenominator(f, denominator) {
    if (!f || !Number.isSafeInteger(denominator) || denominator <= 0) return null;
    var scaled = BigInt(f.n) * BigInt(denominator);
    var negative = scaled < 0n;
    if (negative) scaled = -scaled;
    var d = BigInt(f.d);
    var rounded = scaled / d;
    if ((scaled % d) * 2n >= d) rounded += 1n;
    if (negative) rounded = -rounded;
    return packBig(rounded, BigInt(denominator));
  }

  function snapRow16(f) {
    if (!f) return null;
    var rounded = roundToDenominator(f, 16);
    if (!rounded) return null;
    var delta = fAdd(rounded, fr(-f.n, f.d));
    if (!delta || delta.n === 0) return null;
    var absDelta = fr(Math.abs(delta.n), delta.d);
    var error = decStr(absDelta, 3);
    if (error === '0') error = '<0.001';
    return {
      k: 'Nearest 1/16″',
      v: fmtFtIn(rounded).main + ' (' + (delta.n > 0 ? '+' : '−') + error + '″)'
    };
  }

  function mainOf(result) {
    if (result.type === 'len') return fmtFtIn(result.f).main;
    if (result.type === 'area') {
      var sqin = result.f, sqft = fDiv(sqin, fr(144));
      if (!sqft) return fmtMixed(sqin) + ' in²';
      return compareFractions(sqin, fr(144)) < 0 ? fmtMixed(sqin) + ' in²' : fmtMixed(sqft) + ' ft²';
    }
    return result.f.d === 1 ? result.f.n + ' : 1' : result.f.n + ' : ' + result.f.d;
  }

  function resultView(result) {
    if (result.type === 'len') {
      var m = fmtFtIn(result.f);
      var rows = [{ k: 'Total Inches', v: m.totalIn }, { k: 'Decimal', v: '≈ ' + m.dec }];
      var snap = snapRow16(result.f);
      if (snap) rows.push(snap);
      return { kind: 'RESULT · LENGTH', main: m.main, rows: rows };
    }
    if (result.type === 'area') {
      var sqin = result.f, sqft = fDiv(sqin, fr(144));
      if (!sqft) {
        var approximateSqFt = sqin.n / sqin.d / 144;
        return { kind: 'RESULT · AREA', main: fmtMixed(sqin) + ' in²', rows: [
          { k: 'Square Feet', v: '≈ ' + formatApproxNumber(approximateSqFt, 4) + ' ft²' },
          { k: 'Exact Square Inches', v: fmtMixed(sqin) + ' in²' }
        ] };
      }
      if (compareFractions(sqin, fr(144)) < 0) {
        return { kind: 'RESULT · AREA', main: fmtMixed(sqin) + ' in²', rows: [
          { k: 'Square Feet', v: fmtMixed(sqft) + ' ft²' },
          { k: 'Decimal', v: '≈ ' + decStr(sqft, 4) + ' ft²' }
        ] };
      }
      return { kind: 'RESULT · AREA', main: fmtMixed(sqft) + ' ft²', rows: [
        { k: 'Square Inches', v: fmtMixed(sqin) + ' in²' },
        { k: 'Decimal', v: '≈ ' + decStr(sqft, 3) + ' ft²' }
      ] };
    }
    return {
      kind: 'RESULT · RATIO',
      main: result.f.d === 1 ? result.f.n + ' : 1' : result.f.n + ' : ' + result.f.d,
      rows: [
        { k: 'Decimal', v: '≈ ' + decStr(result.f, 4) },
        { k: 'Percent', v: scaledDecStr(result.f, 100, 2) + '%' }
      ]
    };
  }

  function trimNumber(x, dp) {
    if (!Number.isFinite(x)) return 'OUT OF RANGE';
    var s = x.toFixed(dp);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  function formatApproxNumber(x, dp) {
    if (!Number.isFinite(x)) return 'OUT OF RANGE';
    if (x !== 0 && Math.abs(x) < Math.pow(10, -dp)) {
      return x.toExponential(Math.min(dp, 6)).replace(/\.0+(?=e)/, '');
    }
    return trimNumber(x, dp);
  }

  var STAIR_CODES = {
    IRC_2024: {
      id: 'IRC_2024', label: '2024 IRC Model · Straight Stair',
      minRiser: null, maxRiser: 7.75, minTread: 10,
      maxFlightRise: 151,
      minRiserFraction: null, maxRiserFraction: fr(31, 4),
      maxFlightRiseFraction: fr(151),
      source: '2024 IRC R318.7.3 & R318.7.5',
      scope: 'Model-code dimensional reference; local amendments may differ.'
    },
    IBC_2024: {
      id: 'IBC_2024', label: '2024 IBC General · Straight Stair',
      minRiser: 4, maxRiser: 7, minTread: 11,
      maxFlightRise: 144,
      minRiserFraction: fr(4), maxRiserFraction: fr(7),
      maxFlightRiseFraction: fr(144),
      source: '2024 IBC 1011.5.2 & 1011.8',
      scope: 'General model-code profile; occupancy exceptions and local amendments are not evaluated.'
    }
  };

  function calculateStairs(rise, codeId) {
    var code = STAIR_CODES[codeId];
    if (!rise || rise.n <= 0 || !code) return { err: 'Rise and code selection are required.' };
    var riseDec = rise.n / rise.d;
    var exactCount = ceilDivFraction(rise, code.maxRiserFraction);
    if (exactCount === null) return { err: 'Riser count is outside the supported range.' };
    var count = Math.max(2, exactCount);
    var riser = fDiv(rise, fr(count));
    if (!riser) return { err: 'Numbers got too large — try a smaller rise.' };
    var riserDec = riser.n / riser.d;
    if (code.minRiserFraction && compareFractions(riser, code.minRiserFraction) < 0) {
      return { err: 'No layout within the selected dimensional reference for at least 2 equal risers: ' +
        code.source + ' uses a minimum riser of ' + code.minRiser + '″. Single-riser and special elevation changes are not evaluated.' };
    }
    var comfortTarget = fAdd(fr(25), fMul(riser, fr(-2)));
    var suggestedTread = roundToDenominator(comfortTarget, 4);
    var minimumTread = fr(code.minTread);
    if (!suggestedTread) return { err: 'Tread suggestion is outside the supported range.' };
    var treadFraction = compareFractions(suggestedTread, minimumTread) < 0 ? minimumTread : suggestedTread;
    var tread = treadFraction.n / treadFraction.d;
    var runFraction = fMul(treadFraction, fr(count - 1));
    if (!runFraction) return { err: 'Aggregate tread run is outside the supported range.' };
    var run = runFraction.n / runFraction.d;
    var altRiser = fDiv(rise, fr(count + 1));
    var altWithinRange = !!altRiser && compareFractions(altRiser, code.maxRiserFraction) <= 0 &&
      (!code.minRiserFraction || compareFractions(altRiser, code.minRiserFraction) >= 0);
    var comfortFraction = fAdd(fMul(riser, fr(2)), treadFraction);
    if (!comfortFraction) return { err: 'Comfort heuristic is outside the supported range.' };
    var withinDimensionalReference = compareFractions(riser, code.maxRiserFraction) <= 0 &&
      (!code.minRiserFraction || compareFractions(riser, code.minRiserFraction) >= 0) &&
      compareFractions(treadFraction, minimumTread) >= 0;
    return {
      code: code,
      count: count,
      riser: riser,
      riserDec: riserDec,
      tread: tread,
      treadFraction: treadFraction,
      treads: count - 1,
      run: run,
      runFraction: runFraction,
      comfort: comfortFraction.n / comfortFraction.d,
      comfortFraction: comfortFraction,
      alternativeCount: altWithinRange ? count + 1 : null,
      alternativeRiser: altWithinRange ? altRiser : null,
      flightWarning: compareFractions(rise, code.maxFlightRiseFraction) > 0 ?
        'Total rise exceeds the ' + code.maxFlightRise + '″ single-flight reference; evaluate multiple flights and landings.' : null,
      withinDimensionalReference: withinDimensionalReference
    };
  }

  function slopeAtOrBelowOneInTwelve(rise, run) {
    if (!rise || !run || rise.n < 0 || run.n <= 0) return null;
    var left = 12n * BigInt(rise.n) * BigInt(run.d);
    var right = BigInt(rise.d) * BigInt(run.n);
    return left <= right;
  }

  function analyzeSlope(mode, value, run) {
    if (!value || value.n < 0) return { err: 'Slope must be 0 or more.' };
    var slope;
    var atOrBelow;
    if (mode === 'riseRun') {
      if (!run || run.n <= 0) return { err: 'Run must be greater than 0.' };
      slope = (value.n / value.d) / (run.n / run.d);
      atOrBelow = slopeAtOrBelowOneInTwelve(value, run);
    } else if (mode === 'pitch') {
      slope = (value.n / value.d) / 12;
      atOrBelow = compareFractions(value, fr(1)) <= 0;
    } else if (mode === 'percent') {
      slope = (value.n / value.d) / 100;
      atOrBelow = compareFractions(value, fr(25, 3)) <= 0;
    } else if (mode === 'degrees') {
      var degrees = value.n / value.d;
      if (degrees >= 90) return { err: 'Degrees must be from 0 up to, but not including, 90°.' };
      slope = Math.tan(degrees * Math.PI / 180);
      atOrBelow = degrees <= Math.atan(1 / 12) * 180 / Math.PI;
    } else {
      return { err: 'Unknown slope input mode.' };
    }
    if (!Number.isFinite(slope) || slope < 0) return { err: 'Slope must be 0 or more.' };
    return { slope: slope, atOrBelowOneInTwelve: atOrBelow };
  }

  function calculateConcrete(length, width, thickness) {
    if (!length || !width || !thickness || length.n <= 0 || width.n <= 0 || thickness.n <= 0) {
      return { err: 'Enter three positive lengths.' };
    }
    var area = fMul(length, width);
    if (!area) return { err: 'Numbers got too large — try smaller dimensions.' };
    var volume = fMul(area, thickness);
    if (!volume) return { err: 'Numbers got too large — try smaller dimensions.' };
    var ft3 = volume.n / volume.d / 1728;
    return { in3: volume, ft3: ft3, yd3: ft3 / 27 };
  }

  return {
    MAX_MAGNITUDE: MAX_MAGNITUDE,
    gcd: gcd,
    fr: fr,
    fAdd: fAdd,
    fMul: fMul,
    fDiv: fDiv,
    compareFractions: compareFractions,
    floorDivFraction: floorDivFraction,
    ceilDivFraction: ceilDivFraction,
    parseNum: parseNum,
    parseLen: parseLen,
    parseExpr: parseExpr,
    decStr: decStr,
    scaledDecStr: scaledDecStr,
    fmtFtIn: fmtFtIn,
    fmtMixed: fmtMixed,
    snapRow16: snapRow16,
    mainOf: mainOf,
    resultView: resultView,
    trimNumber: trimNumber,
    formatApproxNumber: formatApproxNumber,
    roundToDenominator: roundToDenominator,
    STAIR_CODES: STAIR_CODES,
    calculateStairs: calculateStairs,
    slopeAtOrBelowOneInTwelve: slopeAtOrBelowOneInTwelve,
    analyzeSlope: analyzeSlope,
    calculateConcrete: calculateConcrete
  };
});
