import {
  MaxNestingDepth,
  WireArray,
  WireBoolFalse,
  WireBoolTrue,
  WireBytes,
  WireExtended,
  WireFixed32,
  WireFixed64,
  WireFloat32,
  WireFloat64,
  WireMap,
  WireSfixed32,
  WireSfixed64,
  WireSint,
  WireString,
  WireSubMsg,
  WireUint,
  assertValidUTF8,
  decodeVarintBigInt,
  skipValue,
  validateField0At,
} from './wire.js';

/** Validate headers even when an empty map has no entries to inspect. */
export function validateMapTypes(key: number, value: number): void {
  const validKey =
    key === WireUint ||
    key === WireSint ||
    key === WireBoolFalse ||
    key === WireFixed32 ||
    key === WireFixed64 ||
    key === WireSfixed32 ||
    key === WireSfixed64 ||
    key === WireString;
  const validVal = value <= WireExtended && value !== WireBoolTrue;
  if (!validKey || !validVal) {
    throw new Error(`omnibuf: invalid WireMap types ${key}/${value}`);
  }
}

function readLenBounds(
  data: Uint8Array,
  pos: number,
  end: number,
  minLen: number,
): [bodyStart: number, bodyEnd: number] {
  if (pos >= end) throw new Error(`omnibuf: truncated length varint at ${pos}`);
  const b0 = data[pos]!;
  if ((b0 & 1) !== 0) {
    const len = b0 >>> 1;
    const bodyStart = pos + 1;
    const bodyEnd = bodyStart + len;
    if (len < minLen || bodyEnd > end) {
      throw new Error(`omnibuf: invalid byteLen ${len} at ${bodyStart}`);
    }
    return [bodyStart, bodyEnd];
  }
  if ((b0 & 2) !== 0) {
    if (pos + 2 > end) throw new Error(`omnibuf: truncated length varint at ${pos}`);
    const len = (b0 | (data[pos + 1]! << 8)) >>> 2;
    const bodyStart = pos + 2;
    const bodyEnd = bodyStart + len;
    if (len < minLen || bodyEnd > end) {
      throw new Error(`omnibuf: invalid byteLen ${len} at ${bodyStart}`);
    }
    return [bodyStart, bodyEnd];
  }
  const [bLen, bn] = decodeVarintBigInt(data, pos, end);
  if (bn === 0) throw new Error(`omnibuf: truncated length varint at ${pos}`);
  const bodyStart = pos + bn;
  const rem = BigInt(end - bodyStart);
  if (bLen < BigInt(minLen) || bLen > rem) {
    throw new Error(`omnibuf: invalid byteLen ${bLen} at ${bodyStart}`);
  }
  return [bodyStart, bodyStart + Number(bLen)];
}

function skipSimpleValueInRange(data: Uint8Array, pos: number, end: number, wt: number): number {
  switch (wt) {
    case WireUint:
    case WireSint: {
      if (pos >= end) throw new Error(`omnibuf: truncated varint at ${pos}`);
      const b0 = data[pos]!;
      let nextPos: number;
      if ((b0 & 1) !== 0) nextPos = pos + 1;
      else if ((b0 & 2) !== 0) nextPos = pos + 2;
      else if ((b0 & 4) !== 0) nextPos = pos + 4;
      else if (b0 === 0) nextPos = pos + 9;
      else throw new Error(`omnibuf: invalid varint prefix at ${pos}`);
      if (nextPos > end) throw new Error(`omnibuf: truncated varint at ${pos}`);
      return nextPos;
    }
    case WireBoolFalse:
    case WireBoolTrue:
      if (pos > end) throw new Error(`omnibuf: position ${pos} out of bounds`);
      return pos;
    case WireFixed32:
    case WireSfixed32:
    case WireFloat32:
      if (pos + 4 > end) throw new Error(`omnibuf: truncated 32-bit value at ${pos}`);
      return pos + 4;
    case WireFixed64:
    case WireSfixed64:
    case WireFloat64:
      if (pos + 8 > end) throw new Error(`omnibuf: truncated 64-bit value at ${pos}`);
      return pos + 8;
    case WireBytes: {
      if (pos >= end) throw new Error(`omnibuf: truncated bytes at ${pos}`);
      const lb = data[pos]!;
      if ((lb & 1) !== 0) {
        const nextPos = pos + 1 + (lb >>> 1);
        if (nextPos > end) throw new Error(`omnibuf: truncated bytes at ${pos}`);
        return nextPos;
      }
      if ((lb & 2) !== 0) {
        if (pos + 2 > end) throw new Error(`omnibuf: truncated bytes at ${pos}`);
        const nextPos = pos + 2 + ((lb | (data[pos + 1]! << 8)) >>> 2);
        if (nextPos > end) throw new Error(`omnibuf: truncated bytes at ${pos}`);
        return nextPos;
      }
      const [, bodyEnd] = readLenBounds(data, pos, end, 0);
      return bodyEnd;
    }
    case WireExtended: {
      if (pos >= end) throw new Error(`omnibuf: invalid container length`);
      const lb = data[pos]!;
      if ((lb & 1) !== 0) {
        const len = lb >>> 1;
        const nextPos = pos + 1 + len;
        if (len < 1 || nextPos > end) throw new Error(`omnibuf: invalid container length`);
        return nextPos;
      }
      if ((lb & 2) !== 0) {
        if (pos + 2 > end) throw new Error(`omnibuf: invalid container length`);
        const len = (lb | (data[pos + 1]! << 8)) >>> 2;
        const nextPos = pos + 2 + len;
        if (len < 1 || nextPos > end) throw new Error(`omnibuf: invalid container length`);
        return nextPos;
      }
      const [, bodyEnd] = readLenBounds(data, pos, end, 1);
      return bodyEnd;
    }
    default:
      return skipValue(end === data.length ? data : data.subarray(0, end), pos, wt);
  }
}

function validateContainerEntryInRange(
  data: Uint8Array,
  p: number,
  end: number,
  wt: number,
  depth: number,
  limit: number,
): number {
  if (wt === WireBoolFalse) {
    if (p >= end || (data[p]! !== 0 && data[p]! !== 1)) {
      throw new Error(`omnibuf: invalid bool byte in container at ${p}`);
    }
    return p + 1;
  }
  if (wt === WireString) {
    if (p >= end) throw new Error(`omnibuf: truncated string at ${p}`);
    const sb = data[p]!;
    let sStart: number;
    let sEnd: number;
    if ((sb & 1) !== 0) {
      sStart = p + 1;
      sEnd = sStart + (sb >>> 1);
      if (sEnd > end) throw new Error(`omnibuf: truncated string at ${p}`);
    } else if ((sb & 2) !== 0) {
      if (p + 2 > end) throw new Error(`omnibuf: truncated string at ${p}`);
      sStart = p + 2;
      sEnd = sStart + ((sb | (data[p + 1]! << 8)) >>> 2);
      if (sEnd > end) throw new Error(`omnibuf: truncated string at ${p}`);
    } else {
      [sStart, sEnd] = readLenBounds(data, p, end, 0);
    }
    assertValidUTF8(data, sStart, sEnd);
    return sEnd;
  }
  if (wt === WireSubMsg) {
    if (p >= end) throw new Error(`omnibuf: truncated submsg at ${p}`);
    const lb = data[p]!;
    let subStart: number;
    let subEnd: number;
    if ((lb & 1) !== 0) {
      subStart = p + 1;
      subEnd = subStart + (lb >>> 1);
      if (subEnd > end) throw new Error(`omnibuf: truncated submsg at ${p}`);
    } else if ((lb & 2) !== 0) {
      if (p + 2 > end) throw new Error(`omnibuf: truncated submsg at ${p}`);
      subStart = p + 2;
      subEnd = subStart + ((lb | (data[p + 1]! << 8)) >>> 2);
      if (subEnd > end) throw new Error(`omnibuf: truncated submsg at ${p}`);
    } else {
      [subStart, subEnd] = readLenBounds(data, p, end, 0);
    }
    validateMessageRange(data, subStart, subEnd, depth + 1, limit);
    return subEnd;
  }
  if (wt === WireArray || wt === WireMap) {
    return validateValueRange(data, p, end, wt, depth, limit);
  }
  return skipSimpleValueInRange(data, p, end, wt);
}

function validateValueRange(
  data: Uint8Array,
  pos: number,
  end: number,
  wt: number,
  depth: number,
  limit: number,
): number {
  if (depth > limit) throw new Error(`omnibuf: nesting depth exceeds ${limit}`);
  if (wt === WireString) {
    if (pos >= end) throw new Error(`omnibuf: truncated string at ${pos}`);
    const sb = data[pos]!;
    let sStart: number;
    let sEnd: number;
    if ((sb & 1) !== 0) {
      sStart = pos + 1;
      sEnd = sStart + (sb >>> 1);
      if (sEnd > end) throw new Error(`omnibuf: truncated string at ${pos}`);
    } else if ((sb & 2) !== 0) {
      if (pos + 2 > end) throw new Error(`omnibuf: truncated string at ${pos}`);
      sStart = pos + 2;
      sEnd = sStart + ((sb | (data[pos + 1]! << 8)) >>> 2);
      if (sEnd > end) throw new Error(`omnibuf: truncated string at ${pos}`);
    } else {
      [sStart, sEnd] = readLenBounds(data, pos, end, 0);
    }
    assertValidUTF8(data, sStart, sEnd);
    return sEnd;
  }
  if (wt === WireSubMsg) {
    if (pos >= end) throw new Error(`omnibuf: truncated submsg at ${pos}`);
    const lb = data[pos]!;
    let subStart: number;
    let subEnd: number;
    if ((lb & 1) !== 0) {
      subStart = pos + 1;
      subEnd = subStart + (lb >>> 1);
      if (subEnd > end) throw new Error(`omnibuf: truncated submsg at ${pos}`);
    } else if ((lb & 2) !== 0) {
      if (pos + 2 > end) throw new Error(`omnibuf: truncated submsg at ${pos}`);
      subStart = pos + 2;
      subEnd = subStart + ((lb | (data[pos + 1]! << 8)) >>> 2);
      if (subEnd > end) throw new Error(`omnibuf: truncated submsg at ${pos}`);
    } else {
      [subStart, subEnd] = readLenBounds(data, pos, end, 0);
    }
    validateMessageRange(data, subStart, subEnd, depth + 1, limit);
    return subEnd;
  }
  if (wt === WireArray) {
    if (depth + 1 > limit) throw new Error(`omnibuf: nesting depth exceeds ${limit}`);
    if (pos >= end) throw new Error('omnibuf: invalid array header');
    const lb = data[pos]!;
    let bodyStart: number;
    let bodyEnd: number;
    if ((lb & 1) !== 0) {
      const len = lb >>> 1;
      bodyStart = pos + 1;
      bodyEnd = bodyStart + len;
      if (len < 2 || bodyEnd > end) throw new Error('omnibuf: invalid array header');
    } else if ((lb & 2) !== 0) {
      if (pos + 2 > end) throw new Error('omnibuf: invalid array header');
      const len = (lb | (data[pos + 1]! << 8)) >>> 2;
      bodyStart = pos + 2;
      bodyEnd = bodyStart + len;
      if (len < 2 || bodyEnd > end) throw new Error('omnibuf: invalid array header');
    } else {
      [bodyStart, bodyEnd] = readLenBounds(data, pos, end, 2);
    }
    const elemType = data[bodyStart]!;
    if (elemType > WireExtended || elemType === WireBoolTrue) {
      throw new Error('omnibuf: invalid array header');
    }
    let count: number;
    let p: number;
    const cb = data[bodyStart + 1]!;
    if ((cb & 1) !== 0) {
      count = cb >>> 1;
      p = bodyStart + 2;
    } else if ((cb & 2) !== 0) {
      if (bodyStart + 3 > bodyEnd) throw new Error('omnibuf: invalid array header');
      count = (cb | (data[bodyStart + 2]! << 8)) >>> 2;
      p = bodyStart + 3;
    } else {
      const [c64, cn] = decodeVarintBigInt(data, bodyStart + 1, bodyEnd);
      if (cn === 0 || c64 > BigInt(bodyEnd - (bodyStart + 1 + cn))) {
        throw new Error('omnibuf: invalid array header');
      }
      count = Number(c64);
      p = bodyStart + 1 + cn;
    }
    const remaining = bodyEnd - p;
    if (elemType === WireBoolFalse) {
      if (remaining !== count) throw new Error('omnibuf: invalid WireArray bool length');
      for (let i = 0; i < count; i++) {
        const b = data[p + i]!;
        if (b !== 0 && b !== 1) throw new Error('omnibuf: invalid WireArray bool byte');
      }
      return bodyEnd;
    }
    if (elemType === WireFixed32 || elemType === WireSfixed32 || elemType === WireFloat32) {
      if (remaining !== count * 4) {
        throw new Error('omnibuf: invalid WireArray 32-bit element byte length');
      }
      return bodyEnd;
    }
    if (elemType === WireFixed64 || elemType === WireSfixed64 || elemType === WireFloat64) {
      if (remaining !== count * 8) {
        throw new Error('omnibuf: invalid WireArray 64-bit element byte length');
      }
      return bodyEnd;
    }
    if (count === 0 ? remaining !== 0 : count > remaining) {
      throw new Error('omnibuf: invalid array header');
    }
    for (let i = 0; i < count; i++) {
      p = validateContainerEntryInRange(data, p, bodyEnd, elemType, depth + 1, limit);
    }
    if (p !== bodyEnd) throw new Error('omnibuf: trailing WireArray bytes');
    return bodyEnd;
  }
  if (wt === WireMap) {
    if (depth + 1 > limit) throw new Error(`omnibuf: nesting depth exceeds ${limit}`);
    const [bodyStart, bodyEnd] = readLenBounds(data, pos, end, 3);
    const key = data[bodyStart]!;
    const value = data[bodyStart + 1]!;
    validateMapTypes(key, value);
    let count: number;
    let p: number;
    const cb = data[bodyStart + 2]!;
    if ((cb & 1) !== 0) {
      count = cb >>> 1;
      p = bodyStart + 3;
    } else if ((cb & 2) !== 0) {
      if (bodyStart + 4 > bodyEnd) throw new Error('omnibuf: invalid map header');
      count = (cb | (data[bodyStart + 3]! << 8)) >>> 2;
      p = bodyStart + 4;
    } else {
      const [c64, cn] = decodeVarintBigInt(data, bodyStart + 2, bodyEnd);
      if (cn === 0 || c64 > BigInt(Math.floor((bodyEnd - (bodyStart + 2 + cn)) / 2))) {
        throw new Error('omnibuf: invalid map header');
      }
      count = Number(c64);
      p = bodyStart + 2 + cn;
    }
    if (p > bodyEnd || (count === 0 ? bodyEnd !== p : count > (bodyEnd - p) >>> 1)) {
      throw new Error('omnibuf: invalid map header');
    }
    for (let i = 0; i < count; i++) {
      p = validateContainerEntryInRange(data, p, bodyEnd, key, depth + 1, limit);
      p = validateContainerEntryInRange(data, p, bodyEnd, value, depth + 1, limit);
    }
    if (p !== bodyEnd) throw new Error('omnibuf: trailing WireMap bytes');
    return bodyEnd;
  }
  // Unknown extensions remain skippable without interpreting their subtype.
  return skipSimpleValueInRange(data, pos, end, wt);
}

function validateMessageRange(
  data: Uint8Array,
  start: number,
  end: number,
  depth: number,
  limit: number,
): void {
  if (depth > limit) throw new Error(`omnibuf: nesting depth exceeds ${limit}`);
  let pos = start;
  while (pos < end) {
    let fnum: number;
    let wt: number;
    const b0 = data[pos]!;
    if ((b0 & 1) !== 0) {
      fnum = b0 >>> 5;
      wt = (b0 >>> 1) & 0x0f;
      pos += 1;
    } else if ((b0 & 2) !== 0) {
      if (pos + 2 > end) throw new Error('omnibuf: invalid or truncated tag');
      const u16 = (b0 | (data[pos + 1]! << 8)) >>> 2;
      fnum = u16 >>> 4;
      wt = u16 & 0x0f;
      pos += 2;
    } else {
      const [tag, width] = decodeVarintBigInt(data, pos, end);
      if (!width || tag >> 4n > 536870911n) throw new Error('omnibuf: invalid or truncated tag');
      pos += width;
      fnum = Number(tag >> 4n);
      wt = Number(tag & 15n);
    }
    if (fnum === 0) {
      if (wt !== WireSubMsg) throw new Error('omnibuf: invalid Field #0 wire type');
      const nextPos = validateField0At(data, pos, wt, depth, limit, end);
      if (nextPos < 0) throw new Error('omnibuf: invalid Field #0');
      pos = nextPos;
    } else {
      pos = validateValueRange(data, pos, end, wt, depth, limit);
    }
  }
}

/** Validate unknown values without allocating decoded arrays or objects. */
export function validateValue(
  data: Uint8Array,
  pos: number,
  wt: number,
  depth = 0,
  limit = MaxNestingDepth,
): number {
  return validateValueRange(data, pos, data.length, wt, depth, limit);
}

export function validateMessage(data: Uint8Array, depth = 0, limit = MaxNestingDepth): void {
  validateMessageRange(data, 0, data.length, depth, limit);
}
