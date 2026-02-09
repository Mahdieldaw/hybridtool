/**
 *`src/providers/grok-signature.js`
 * HTOS Grok Signature Module
 * - Generates x-statsig-id header for Grok API requests
 * - Port of Python xctid.py (cubic bezier, SVG parsing, matrix math)
 * 
 * Build-phase safe: runs in Service Worker
 */

import { sha256 } from '@noble/hashes/sha256';
import { base64ToBytes, bytesToBase64 } from './grok-crypto.js';

// ═══════════════════════════════════════════════════════════════════════════
// MATH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map value from byte range to target range
 */
function _h(x, _param, c, isInteger) {
  const f = ((x * (c - _param)) / 255.0) + _param;
  if (isInteger) {
    return Math.floor(f);
  }
  const rounded = Math.round(f * 100) / 100;
  return rounded === 0.0 ? 0.0 : rounded;
}

/**
 * Cubic bezier easing with binary search for t
 */
function cubicBezierEased(t, x1, y1, x2, y2) {
  const bezier = (u) => {
    const omu = 1.0 - u;
    const b1 = 3.0 * omu * omu * u;
    const b2 = 3.0 * omu * u * u;
    const b3 = u * u * u;
    const x = b1 * x1 + b2 * x2 + b3;
    const y = b1 * y1 + b2 * y2 + b3;
    return [x, y];
  };

  // Binary search to find u where bezier(u)[0] ≈ t
  let lo = 0.0;
  let hi = 1.0;
  const targetPrecision = 0.0001;
  const maxIterations = 80;
  for (let i = 0; i < maxIterations; i++) {
    const mid = 0.5 * (lo + hi);
    const [x, _y] = bezier(mid);
    if (Math.abs(x - t) < targetPrecision) {
      break;
    }
    if (x < t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const u = 0.5 * (lo + hi);
  return bezier(u)[1];
}

/**
 * Parse SVG path 'd' attribute into numeric arrays
 */
function parseSvgPath(svg) {
  const text = String(svg || '');
  const parts = text.split('C').slice(1);
  if (parts.length === 0) return [[0]];
  return parts.map((part) => {
    const matches = part.match(/-?\d+/g) || [];
    if (matches.length === 0) return [0];
    return matches.map((m) => parseInt(m, 10));
  });
}

/**
 * Convert number to hex string (matching Python tohex)
 */
function toHex(num) {
  const rounded = Math.round(num * 100) / 100;
  if (rounded === 0.0) {
    return '0';
  }

  const sign = Math.sign(rounded) < 0 ? '-' : '';
  const absval = Math.abs(rounded);
  const intpart = Math.floor(absval);
  let frac = absval - intpart;

  if (frac === 0.0) {
    return sign + intpart.toString(16);
  }

  const fracDigits = [];
  for (let i = 0; i < 20; i++) {
    frac *= 16;
    const digit = Math.floor(frac + 1e-12);
    fracDigits.push(digit.toString(16));
    frac -= digit;
    if (Math.abs(frac) < 1e-12) {
      break;
    }
  }

  let fracStr = fracDigits.join('').replace(/0+$/, '');
  if (fracStr === '') {
    return sign + intpart.toString(16);
  }
  return sign + intpart.toString(16) + '.' + fracStr;
}

/**
 * Simulate CSS animation style at given time
 */
function simulateStyle(values, c) {
  if (!Array.isArray(values) || values.length < 8) {
    throw new Error('Invalid Grok SVG signature values');
  }
  const duration = 4096;
  const frameJitter = (Math.random() - 0.5) * 3.5;
  let currentTime = Math.round((c + frameJitter) / 10.0) * 10;
  if (Math.random() < 0.03) {
    currentTime += 16.67;
  }
  currentTime = Math.max(0, Math.min(currentTime, duration));
  const t = currentTime / duration;

  // Control points from values[7:], alternating between param=0 and param=-1
  const cp = values.slice(7).map((v, i) => 
    _h(v, i % 2 ? -1 : 0, 1, false)
  );

  const easedY = cubicBezierEased(t, cp[0], cp[1], cp[2], cp[3]);

  // RGB interpolation
  const start = values.slice(0, 3).map(Number);
  const end = values.slice(3, 6).map(Number);
  const r = Math.round(start[0] + (end[0] - start[0]) * easedY);
  const g = Math.round(start[1] + (end[1] - start[1]) * easedY);
  const b = Math.round(start[2] + (end[2] - start[2]) * easedY);
  const color = `rgb(${r}, ${g}, ${b})`;

  // Rotation matrix
  const endAngle = _h(values[6], 60, 360, true);
  const angle = endAngle * easedY;
  const rad = (angle * Math.PI) / 180.0;

  const isZero = (val) => Math.abs(val) < 1e-7;
  const isInt = (val) => Math.abs(val - Math.round(val)) < 1e-7;

  const cosv = Math.cos(rad);
  const sinv = Math.sin(rad);

  let a, d;
  if (isZero(cosv)) {
    a = 0;
    d = 0;
  } else if (isInt(cosv)) {
    a = Math.round(cosv);
    d = Math.round(cosv);
  } else {
    a = cosv.toFixed(6);
    d = cosv.toFixed(6);
  }

  let bval, cval;
  if (isZero(sinv)) {
    bval = 0;
    cval = 0;
  } else if (isInt(sinv)) {
    bval = Math.round(sinv);
    cval = Math.round(-sinv);
  } else {
    bval = sinv.toFixed(7);
    cval = (-sinv).toFixed(7);
  }

  const transform = `matrix(${a}, ${bval}, ${cval}, ${d}, 0, 0)`;
  return { color, transform };
}

function _isValidByte(n) {
  return Number.isFinite(n) && n >= 0 && n <= 255 && Math.floor(n) === n;
}

function _summarizeNumbers(arr, limit = 16) {
  if (!Array.isArray(arr)) return null;
  const nums = arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (nums.length === 0) return { count: 0, min: null, max: null, sample: [] };
  let min = nums[0];
  let max = nums[0];
  for (const n of nums) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return { count: nums.length, min, max, sample: nums.slice(0, limit) };
}

function _validateSignatureValues(values) {
  if (!Array.isArray(values) || values.length < 11) {
    return { ok: false, reason: 'values_missing_or_too_short' };
  }
  for (let i = 0; i <= 10; i++) {
    const v = values[i];
    if (!_isValidByte(v)) {
      return { ok: false, reason: `invalid_byte_at_${i}`, value: v };
    }
  }
  return { ok: true };
}

/**
 * Extract signature data from verification token and SVG
 */
function extractSignatureData(verificationBytes, svg, xValues) {
  const arr = Array.from(verificationBytes);
  if (
    !Array.isArray(xValues) ||
    xValues.length < 4 ||
    xValues.some((i) => !Number.isFinite(i) || i < 0 || Math.floor(i) !== i || i >= arr.length)
  ) {
    console.warn('[GrokSignature] Invalid xValues for verification token', {
      xValues,
      tokenLen: arr.length,
    });
    throw new Error('Invalid Grok xsid indices');
  }
  const idx = arr[xValues[0]] % 16;
  const c =
    (arr[xValues[1]] % 16) *
    (arr[xValues[2]] % 16) *
    (arr[xValues[3]] % 16);

  const svgParts = parseSvgPath(svg);
  if (idx < 0 || idx >= svgParts.length) {
    throw new Error(`Grok animation index out of bounds: idx=${idx}, parts=${svgParts.length}`);
  }
  const vals = svgParts[idx];
  const validation = _validateSignatureValues(vals);
  if (!validation.ok) {
    console.warn('[GrokSignature] SVG signature value format changed or invalid', {
      reason: validation.reason,
      idx,
      valsLen: Array.isArray(vals) ? vals.length : 0,
      valsSummary: _summarizeNumbers(vals),
      svgLen: typeof svg === 'string' ? svg.length : 0,
      svgHasC: typeof svg === 'string' ? svg.includes('C') : false,
    });
    throw new Error('Invalid Grok SVG signature values');
  }
  const style = simulateStyle(vals, c);

  // Concatenate color and transform, extract numbers, convert to hex
  const concat = style.color + style.transform;
  const matches = concat.match(/[\d.\-]+/g) || [];
  const converted = matches.map((m) => {
    const num = parseFloat(m);
    return toHex(num);
  });
  const joined = converted.join('');
  return joined.replace(/\./g, '').replace(/-/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SIGNATURE GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate x-statsig-id signature for Grok API requests
 * 
 * @param {string} path - API endpoint path (e.g., '/rest/app-chat/conversations/new')
 * @param {string} method - HTTP method (e.g., 'POST')
 * @param {string} verificationToken - Base64-encoded verification token from c_request
 * @param {string} svg - SVG path 'd' attribute from page
 * @param {number[]} xValues - Array of 4 indices parsed from xsid script
 * @param {number} [timeN] - Optional timestamp override (for testing)
 * @param {number} [randomFloat] - Optional random override (for testing)
 * @returns {string} Base64-encoded signature (without padding)
 */
export function generateSign(
  path,
  method,
  verificationToken,
  svg,
  xValues,
  timeN,
  randomFloat
) {
  // Timestamp: seconds since epoch offset
  const n = typeof timeN === 'number' ? timeN : Math.floor(Date.now() / 1000) - 1682924400;

  // Pack as little-endian 32-bit unsigned integer
  const t = new Uint8Array(4);
  const view = new DataView(t.buffer);
  view.setUint32(0, n, true); // little-endian

  // Decode verification token
  const r = base64ToBytes(verificationToken);

  // Extract signature data from SVG
  const o = extractSignatureData(r, svg, xValues);

  // Build message and hash
  const msg = [method, path, n.toString()].join('!') + 'obfiowerehiring' + o;
  const encoder = new TextEncoder();
  const digest = sha256(encoder.encode(msg)).slice(0, 16);

  // Generate prefix byte (Python uses floor(random() * 256) which is always 0-255)
  const prefixByte = Math.floor((typeof randomFloat === 'number' ? randomFloat : Math.random()) * 256);

  // Assemble final array: [prefix, verification, timestamp, digest, 3]
  const assembled = new Uint8Array(1 + r.length + 4 + 16 + 1);
  assembled[0] = prefixByte;
  assembled.set(r, 1);
  assembled.set(t, 1 + r.length);
  assembled.set(digest, 1 + r.length + 4);
  assembled[assembled.length - 1] = 3;

  // XOR transformation: each byte XORed with first byte
  if (assembled.length > 0) {
    const first = assembled[0];
    for (let i = 1; i < assembled.length; i++) {
      assembled[i] = assembled[i] ^ first;
    }
  }

  // Return base64 without padding
  return bytesToBase64(assembled).replace(/=/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract substring between two delimiters
 */
export function between(haystack, start, end) {
  const s = haystack.indexOf(start);
  if (s === -1) return '';
  const from = s + start.length;
  const e = haystack.indexOf(end, from);
  if (e === -1) return '';
  return haystack.slice(from, e);
}

/**
 * Parse verification token and animation index from HTML
 */
export function parseVerificationToken(html, metaName = 'grok-site-verification') {
  let token = between(html, `"name":"${metaName}","content":"`, '"');
  if (!token) {
    token = between(html, `<meta name="${metaName}" content="`, '"');
  }
  if (!token) {
    const re = new RegExp(`<meta[^>]+name=["']${metaName}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    if (m && m[1]) token = m[1];
  }
  if (!token) {
    const re = new RegExp(`"name":"${metaName}".{0,120}?"content":"([^"]+)"`);
    const m = html.match(re);
    if (m && m[1]) token = m[1];
  }
  if (!token) {
    const re = new RegExp(`${metaName}.{0,180}?(?:content["']\\s*[:=]\\s*["'])([^"']+)`, 'i');
    const m = html.match(re);
    if (m && m[1]) token = m[1];
  }
  if (!token) return [null, null];
  
  const decoded = base64ToBytes(token);
  const animIndex = decoded[5] % 4;
  const anim = `loading-x-anim-${animIndex}`;
  
  return [token, anim];
}

/**
 * Extract SVG path data from HTML
 */
export function parseSvgData(html, anim = 'loading-x-anim-0') {
  const idxPart = typeof anim === 'string' ? anim.split('loading-x-anim-')[1] : undefined;
  const animIndex = Number.isFinite(Number(idxPart)) ? parseInt(idxPart, 10) : 0;
  const curvesSvg = _parseSvgFromCurves(html, animIndex);
  if (curvesSvg) return curvesSvg;

  const allDValues = [];
  const patterns = [
    /\"d\":\"(M[^"]{50,})\"/g,
    /d="(M[^"]{50,})"/g,
    /d:"(M[^"]{50,})"/g,
    /d='(M[^']{50,})'/g,
    /d:'(M[^']{50,})'/g,
    /\\\"d\\\":\\\"(M[^\\\"]{50,})\\\"/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(html)) !== null) {
      allDValues.push(match[1]);
    }
  }

  const candidates = allDValues
    .filter((d) => typeof d === 'string' && d.includes('C'))
    .filter((d) => (d.match(/-?\d+/g) || []).length >= 40);

  return candidates[animIndex] || candidates[0] || null;
}

function _parseSvgFromCurves(text, animIndex) {
  const raw = String(text || '');
  const startToken = raw.includes('\\"curves\\":') ? '\\"curves\\":' : '"curves":';
  const startAt = raw.indexOf(startToken);
  if (startAt === -1) return null;

  const openIdx = raw.indexOf('[[', startAt);
  if (openIdx === -1) return null;

  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (depth === 0) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  const bracketed = raw.slice(openIdx, endIdx + 1);
  const jsonText = bracketed.replace(/\\"/g, '"');

  let curves;
  try {
    curves = JSON.parse(jsonText);
  } catch (_) {
    return null;
  }

  const curveSet = Array.isArray(curves) ? curves[animIndex] : null;
  if (!Array.isArray(curveSet) || curveSet.length === 0) return null;

  const segments = curveSet
    .map((seg) => {
      const color = Array.isArray(seg?.color) ? seg.color : null;
      const bezier = Array.isArray(seg?.bezier) ? seg.bezier : null;
      if (!color || color.length < 6 || !bezier || bezier.length < 4) return null;
      const deg = Number.isFinite(Number(seg?.deg)) ? Number(seg.deg) : 0;
      return ` ${color[0]},${color[1]} ${color[2]},${color[3]} ${color[4]},${color[5]} h ${deg} s ${bezier[0]},${bezier[1]} ${bezier[2]},${bezier[3]}`;
    })
    .filter(Boolean);

  if (segments.length === 0) return null;
  return `M 10,30 C${segments.join(' C')}`;
}

/**
 * Parse x-values from script content
 */
export function parseXValues(scriptContent) {
  const matches = scriptContent.match(/x\[(\d+)\]\s*,\s*16/g) || [];
  return matches.map((m) => {
    const numMatch = m.match(/x\[(\d+)\]/);
    return numMatch ? parseInt(numMatch[1], 10) : 0;
  });
}
