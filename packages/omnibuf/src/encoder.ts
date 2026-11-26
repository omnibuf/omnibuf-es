// ============================================================================
// Single-Pass OmniBuf Forward Encoder with 2-Byte Length Backpatching
// ============================================================================

import {
  MaxNestingDepth,
  WireArray,
  WireBoolFalse,
  WireBoolTrue,
  WireBytes,
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
  allocBytes,
  compareUTF8Strings,
  encodeZigZag,
  encodeZigZagNumber,
  getStringCodec,
  mapHeaderByte,
  toBigInt64Input,
  writeVarintAt,
} from './wire.js';

export { mapHeaderByte };

const MAX_RETAINED_SLAB = 256 * 1024;

/**
 * Encoder encodes OmniBuf messages into a reusable contiguous byte buffer in a single forward pass.
 */
export class Encoder {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;
  private lenStack = new Int32Array(MaxNestingDepth * 2 + 8);
  private lenWidthStack = new Uint8Array(MaxNestingDepth * 2 + 8);
  private elemCountStack = new Int32Array(MaxNestingDepth * 2 + 8);
  private depth = 0;

  constructor(initialCapacityOrBuffer: number | Uint8Array = 512, initialPos = 0) {
    if (initialCapacityOrBuffer instanceof Uint8Array) {
      this.buf = initialCapacityOrBuffer;
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      this.pos = Math.max(0, Math.min(initialPos, this.buf.byteLength));
    } else {
      const cap = Math.max(64, initialCapacityOrBuffer);
      this.buf = new Uint8Array(cap);
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    }
  }

  /**
   * If `raw` shares the same backing `ArrayBuffer` and overlaps this encoder's buffer capacity,
   * allocates a fresh backing buffer preserving the existing `[0, this.pos)` prefix so subsequent
   * writes do not clobber `raw`.
   */
  detachIfOverlaps(raw: Uint8Array, extraCapacity = 64): void {
    if (raw.byteLength === 0 || this.buf.byteLength === 0) return;
    if (raw.buffer !== this.buf.buffer) return;
    const dstStart = this.buf.byteOffset;
    const dstEnd = dstStart + this.buf.byteLength;
    const rawStart = raw.byteOffset;
    const rawEnd = rawStart + raw.byteLength;
    if (dstStart < rawEnd && rawStart < dstEnd) {
      const nextCap = Math.max(this.buf.byteLength, this.pos + raw.byteLength + extraCapacity);
      const nextBuf = new Uint8Array(nextCap);
      if (this.pos > 0) {
        nextBuf.set(this.buf.subarray(0, this.pos), 0);
      }
      this.buf = nextBuf;
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    }
  }

  /**
   * Clears the encoder buffer for zero-allocation reuse.
   */
  reset(): void {
    this.pos = 0;
    this.depth = 0;
  }

  /**
   * Begins a new message in the slab buffer, retaining grown slabs up to 256 KiB.
   */
  beginMessage(minRemaining = 1024): number {
    this.depth = 0;
    if (this.buf.length > MAX_RETAINED_SLAB) {
      const cap = Math.max(8192, minRemaining);
      this.buf = cap > 8192 ? allocBytes(cap) : new Uint8Array(cap);
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      this.pos = 0;
    } else if (this.buf.length - this.pos < minRemaining) {
      if (this.buf.length >= minRemaining) {
        this.pos = 0;
      } else {
        const cap = Math.max(8192, minRemaining);
        this.buf = cap > 8192 ? allocBytes(cap) : new Uint8Array(cap);
        this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
        this.pos = 0;
      }
    }
    return this.pos;
  }

  /**
   * Returns a standalone `Uint8Array` of `[startPos, this.pos)` from the slab.
   * For freshly grown oversized slabs (> 256 KiB) with >= 50% utilization, transfers ownership
   * of the slab directly instead of copying and discarding it.
   */
  endMessage(startPos: number): Uint8Array {
    const endPos = this.pos;
    const len = endPos - startPos;
    if (this.buf.length > MAX_RETAINED_SLAB && startPos === 0 && len * 2 >= this.buf.length) {
      const out = this.buf.subarray(0, endPos);
      this.buf = new Uint8Array(8192);
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
      this.pos = 0;
      return out;
    }
    const out = allocBytes(len);
    if (len > 0) {
      out.set(this.buf.subarray(startPos, endPos), 0);
    }
    this.pos = startPos;
    if (this.buf.length > MAX_RETAINED_SLAB && startPos === 0) {
      this.buf = new Uint8Array(8192);
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    }
    return out;
  }

  /**
   * Aborts an in-progress message on an error path, rewinding the cursor and
   * releasing oversized slabs (> 256 KiB) back to 8 KiB.
   */
  abortMessage(startPos: number): void {
    this.pos = startPos;
    this.depth = 0;
    if (this.buf.length > MAX_RETAINED_SLAB && startPos === 0) {
      this.buf = new Uint8Array(8192);
      this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    }
  }

  /**
   * Returns a zero-copy subarray view `[startPos, this.pos)` of the encoded message in the slab.
   * Only valid until the slab region is overwritten or reset.
   */
  endMessageView(startPos: number): Uint8Array {
    return this.buf.subarray(startPos, this.pos);
  }

  /**
   * Returns a subarray view of the encoded packet bytes (valid until the next write/reset).
   */
  bytesView(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }

  /**
   * Returns a standalone copy of the encoded packet bytes.
   */
  bytes(): Uint8Array {
    const len = this.pos;
    const out = allocBytes(len);
    if (len > 0) {
      out.set(this.buf.subarray(0, len), 0);
    }
    return out;
  }

  /**
   * Alias for `bytes()`.
   */
  finish(): Uint8Array {
    return this.bytes();
  }

  /**
   * Ensures at least `additional` bytes are available in the backing buffer.
   */
  ensureCapacity(additional: number): void {
    const needed = this.pos + additional;
    if (needed <= this.buf.length) return;
    let nextCap: number;
    if (needed > MAX_RETAINED_SLAB) {
      nextCap = Math.max(this.buf.length * 2, needed);
    } else {
      nextCap = Math.max(64, this.buf.length * 2);
      while (nextCap < needed) {
        nextCap *= 2;
      }
    }
    const nextBuf = allocBytes(nextCap);
    nextBuf.set(this.buf.subarray(0, this.pos), 0);
    this.buf = nextBuf;
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }

  /**
   * Exposes the internal backing buffer for generated tight-loop encoders.
   * Callers must call `ensureCapacity` before writing and `setPos` after advancing.
   */
  get rawBuf(): Uint8Array {
    return this.buf;
  }

  /**
   * Exposes the internal `DataView` aligned to `rawBuf` for generated tight-loop encoders.
   */
  get rawView(): DataView {
    return this.view;
  }

  /**
   * Current write offset in `rawBuf`.
   */
  get rawPos(): number {
    return this.pos;
  }

  /**
   * Updates the write offset after writing directly into `rawBuf`.
   */
  setPos(pos: number): void {
    this.pos = pos;
  }

  /**
   * Appends pre-encoded raw bytes (such as a pre-encoded Field #0 SchemaMeta block).
   */
  writeRaw(raw: Uint8Array): void {
    this.ensureCapacity(raw.length);
    this.buf.set(raw, this.pos);
    this.pos += raw.length;
  }

  /**
   * Appends a single byte.
   */
  writeByte(b: number): void {
    this.ensureCapacity(1);
    this.buf[this.pos++] = b & 0xff;
  }

  /**
   * Appends a Prefix-Varint (TZCNT) value without a tag.
   */
  writeRawVarint(v: number | bigint): void {
    if (this.pos + 9 > this.buf.length) {
      this.ensureCapacity(9);
    }
    if (typeof v === 'number' && v >= 0 && v <= 536870911) {
      const iv = Math.trunc(v);
      const buf = this.buf;
      const p = this.pos;
      if (iv <= 127) {
        buf[p] = (iv << 1) | 1;
        this.pos = p + 1;
        return;
      }
      if (iv <= 16383) {
        const u16 = (iv << 2) | 2;
        buf[p] = u16 & 0xff;
        buf[p + 1] = (u16 >>> 8) & 0xff;
        this.pos = p + 2;
        return;
      }
      const w32 = ((iv << 3) | 4) >>> 0;
      buf[p] = w32 & 0xff;
      buf[p + 1] = (w32 >>> 8) & 0xff;
      buf[p + 2] = (w32 >>> 16) & 0xff;
      buf[p + 3] = (w32 >>> 24) & 0xff;
      this.pos = p + 4;
      return;
    }
    this.pos = writeVarintAt(this.buf, this.pos, v);
  }

  /**
   * Appends a raw string payload `[ByteLen (Prefix-Varint)][UTF-8 Bytes]` without a tag.
   */
  writeRawStringPayload(s: string): void {
    const n = s.length;
    if (n === 0) {
      this.ensureCapacity(1);
      this.buf[this.pos++] = 0x01; // Prefix-Varint(0)
      return;
    }
    if (n <= 42) {
      // Single-pass UTF-8 fast path: max byte length is 42 * 3 = 126 <= 127 (1-byte Prefix-Varint)
      if (this.pos + 1 + n * 3 > this.buf.length) {
        this.ensureCapacity(1 + n * 3);
      }
      const buf = this.buf;
      const lenPos = this.pos;
      let p = lenPos + 1;
      for (let i = 0; i < n; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) {
          buf[p++] = c;
        } else if (c < 0x800) {
          buf[p++] = 0xc0 | (c >> 6);
          buf[p++] = 0x80 | (c & 0x3f);
        } else if (
          c >= 0xd800 &&
          c <= 0xdbff &&
          i + 1 < n &&
          s.charCodeAt(i + 1) >= 0xdc00 &&
          s.charCodeAt(i + 1) <= 0xdfff
        ) {
          const cp = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(++i) & 0x3ff));
          buf[p++] = 0xf0 | (cp >> 18);
          buf[p++] = 0x80 | ((cp >> 12) & 0x3f);
          buf[p++] = 0x80 | ((cp >> 6) & 0x3f);
          buf[p++] = 0x80 | (cp & 0x3f);
        } else if (c >= 0xd800 && c <= 0xdfff) {
          buf[p++] = 0xef;
          buf[p++] = 0xbf;
          buf[p++] = 0xbd;
        } else {
          buf[p++] = 0xe0 | (c >> 12);
          buf[p++] = 0x80 | ((c >> 6) & 0x3f);
          buf[p++] = 0x80 | (c & 0x3f);
        }
      }
      const byteLen = p - (lenPos + 1);
      buf[lenPos] = (byteLen << 1) | 1;
      this.pos = p;
      return;
    }
    const codec = getStringCodec();
    if (codec.encodeInto) {
      if (n <= 178956970) {
        // Single-pass UTF-8 encode: reserve minimum Prefix-Varint width for s.length,
        // write UTF-8 directly into the slab without a separate byteLength scan, and
        // shift only if multi-byte expansion crosses a varint width threshold.
        const maxBytes = n * 3;
        const reserved = n <= 127 ? 1 : n <= 16383 ? 2 : 4;
        if (this.pos + 4 + maxBytes > this.buf.length) {
          this.ensureCapacity(4 + maxBytes);
        }
        const buf = this.buf;
        const lenPos = this.pos;
        const written = codec.encodeInto(s, buf, lenPos + reserved);
        if (reserved === 4) {
          const w32 = ((written << 3) | 4) >>> 0;
          buf[lenPos] = w32 & 0xff;
          buf[lenPos + 1] = (w32 >>> 8) & 0xff;
          buf[lenPos + 2] = (w32 >>> 16) & 0xff;
          buf[lenPos + 3] = (w32 >>> 24) & 0xff;
          this.pos = lenPos + 4 + written;
          return;
        }
        if (reserved === 2) {
          if (written <= 16383) {
            const u16 = ((written << 2) | 2) & 0xffff;
            buf[lenPos] = u16 & 0xff;
            buf[lenPos + 1] = (u16 >>> 8) & 0xff;
            this.pos = lenPos + 2 + written;
            return;
          }
          buf.copyWithin(lenPos + 4, lenPos + 2, lenPos + 2 + written);
          const w32 = ((written << 3) | 4) >>> 0;
          buf[lenPos] = w32 & 0xff;
          buf[lenPos + 1] = (w32 >>> 8) & 0xff;
          buf[lenPos + 2] = (w32 >>> 16) & 0xff;
          buf[lenPos + 3] = (w32 >>> 24) & 0xff;
          this.pos = lenPos + 4 + written;
          return;
        }
        // reserved === 1 (n in 43..127, so maxBytes <= 381 <= 16383)
        if (written <= 127) {
          buf[lenPos] = (written << 1) | 1;
          this.pos = lenPos + 1 + written;
          return;
        }
        buf.copyWithin(lenPos + 2, lenPos + 1, lenPos + 1 + written);
        const u16 = ((written << 2) | 2) & 0xffff;
        buf[lenPos] = u16 & 0xff;
        buf[lenPos + 1] = (u16 >>> 8) & 0xff;
        this.pos = lenPos + 2 + written;
        return;
      }
      const byteLen = codec.byteLength(s);
      this.ensureCapacity(9 + byteLen);
      this.pos = writeVarintAt(this.buf, this.pos, byteLen);
      const written = codec.encodeInto(s, this.buf, this.pos);
      this.pos += written;
      return;
    }
    const utf8 = codec.encode(s);
    this.ensureCapacity(9 + utf8.length);
    this.pos = writeVarintAt(this.buf, this.pos, utf8.length);
    this.buf.set(utf8, this.pos);
    this.pos += utf8.length;
  }

  /**
   * Appends a raw bytes payload `[ByteLen (Prefix-Varint)][Raw Bytes]` without a tag.
   */
  writeRawBytesPayload(b: Uint8Array): void {
    this.ensureCapacity(9 + b.length);
    this.pos = writeVarintAt(this.buf, this.pos, b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  /**
   * Appends a raw 4-byte little-endian uint32 without a tag.
   */
  writeRawFixed32(v: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  /**
   * Appends a raw 4-byte little-endian IEEE-754 float32 without a tag.
   */
  writeRawFloat32(v: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  /**
   * Appends a raw 8-byte little-endian uint64/int64 without a tag.
   */
  writeRawFixed64(v: number | bigint): void {
    this.ensureCapacity(8);
    const u = BigInt.asUintN(64, toBigInt64Input(v));
    this.view.setBigUint64(this.pos, u, true);
    this.pos += 8;
  }

  /**
   * Appends a raw 8-byte little-endian IEEE-754 float64 without a tag.
   */
  writeRawFloat64(v: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  /**
   * Writes a field tag `(fieldNum << 4) | wireType` as a Prefix-Varint.
   */
  writeTag(fieldNum: number, wireType: number): void {
    if (!Number.isInteger(fieldNum) || fieldNum < 0 || fieldNum > 536870911) {
      throw new Error(`omnibuf: invalid field number ${fieldNum}`);
    }
    if (!Number.isInteger(wireType) || wireType < 0 || wireType > 15) {
      throw new Error(`omnibuf: invalid wire type ${wireType}`);
    }
    if (fieldNum === 0 && wireType !== WireSubMsg) {
      throw new Error(`omnibuf: Field #0 requires WireSubMsg (12), got ${wireType}`);
    }
    const tag = fieldNum * 16 + wireType;
    if (tag <= 127) {
      this.ensureCapacity(1);
      this.buf[this.pos++] = ((tag << 1) | 1) & 0xff;
      return;
    }
    if (tag <= 16383) {
      this.ensureCapacity(2);
      const u16 = ((tag << 2) | 2) & 0xffff;
      this.buf[this.pos++] = u16 & 0xff;
      this.buf[this.pos++] = (u16 >>> 8) & 0xff;
      return;
    }
    this.writeRawVarint(tag);
  }

  private patchReservedVarint(pos: number, v: number): void {
    if (v <= 127) {
      this.buf[pos] = ((v << 1) | 1) & 0xff;
      return;
    }
    if (v <= 16383) {
      this.ensureCapacity(1);
      this.buf.copyWithin(pos + 2, pos + 1, this.pos);
      const u16 = ((v << 2) | 2) & 0xffff;
      this.buf[pos] = u16 & 0xff;
      this.buf[pos + 1] = (u16 >>> 8) & 0xff;
      this.pos += 1;
      return;
    }
    if (v <= 536870911) {
      this.ensureCapacity(3);
      this.buf.copyWithin(pos + 4, pos + 1, this.pos);
      const w32 = ((v << 3) | 4) >>> 0;
      this.buf[pos] = w32 & 0xff;
      this.buf[pos + 1] = (w32 >>> 8) & 0xff;
      this.buf[pos + 2] = (w32 >>> 16) & 0xff;
      this.buf[pos + 3] = (w32 >>> 24) & 0xff;
      this.pos += 3;
      return;
    }
    this.ensureCapacity(8);
    this.buf.copyWithin(pos + 9, pos + 1, this.pos);
    writeVarintAt(this.buf, pos, BigInt(v));
    this.pos += 8;
  }

  /**
   * Reserves a 2-byte or 4-byte Prefix-Varint container length slot on `lenStack`.
   * When `minBodyBytes > 16383`, reserves 4 bytes up front to avoid shifting large payloads in `endContainer`.
   */
  beginContainer(minBodyBytes = 0): void {
    if (this.depth >= this.lenStack.length) {
      const nextCap = this.lenStack.length * 2;
      const nextLen = new Int32Array(nextCap);
      nextLen.set(this.lenStack);
      this.lenStack = nextLen;
      const nextWidth = new Uint8Array(nextCap);
      nextWidth.set(this.lenWidthStack);
      this.lenWidthStack = nextWidth;
      const nextElem = new Int32Array(nextCap);
      nextElem.set(this.elemCountStack);
      this.elemCountStack = nextElem;
    }
    if (minBodyBytes > 16383) {
      this.ensureCapacity(4 + minBodyBytes + 64);
      this.lenStack[this.depth] = this.pos;
      this.lenWidthStack[this.depth++] = 4;
      this.buf[this.pos++] = 0;
      this.buf[this.pos++] = 0;
      this.buf[this.pos++] = 0;
      this.buf[this.pos++] = 0;
      return;
    }
    this.ensureCapacity(2);
    this.lenStack[this.depth] = this.pos;
    this.lenWidthStack[this.depth++] = 2;
    this.buf[this.pos++] = 0;
    this.buf[this.pos++] = 0;
  }

  /**
   * Backpatches the most recently opened container length slot.
   * Preserves canonical Prefix-Varint width (2B <= 16,383, 4B <= 536,870,911, 9B otherwise).
   */
  endContainer(): void {
    if (this.depth <= 0) {
      throw new Error('omnibuf: endContainer called without matching beginContainer');
    }
    this.depth--;
    const lenPos = this.lenStack[this.depth]!;
    const reserved = this.lenWidthStack[this.depth]!;
    const subLen = this.pos - (lenPos + reserved);
    if (reserved === 4) {
      if (subLen > 16383 && subLen <= 536870911) {
        const w32 = ((subLen << 3) | 4) >>> 0;
        this.buf[lenPos] = w32 & 0xff;
        this.buf[lenPos + 1] = (w32 >>> 8) & 0xff;
        this.buf[lenPos + 2] = (w32 >>> 16) & 0xff;
        this.buf[lenPos + 3] = (w32 >>> 24) & 0xff;
        return;
      }
      if (subLen <= 16383) {
        this.buf.copyWithin(lenPos + 2, lenPos + 4, this.pos);
        const u16 = ((subLen << 2) | 2) & 0xffff;
        this.buf[lenPos] = u16 & 0xff;
        this.buf[lenPos + 1] = (u16 >>> 8) & 0xff;
        this.pos -= 2;
        return;
      }
      this.ensureCapacity(5);
      this.buf.copyWithin(lenPos + 9, lenPos + 4, this.pos);
      writeVarintAt(this.buf, lenPos, BigInt(subLen));
      this.pos += 5;
      return;
    }
    if (subLen <= 16383) {
      const u16 = ((subLen << 2) | 2) & 0xffff;
      this.buf[lenPos] = u16 & 0xff;
      this.buf[lenPos + 1] = (u16 >>> 8) & 0xff;
      return;
    }
    if (subLen <= 536870911) {
      this.ensureCapacity(2);
      this.buf.copyWithin(lenPos + 4, lenPos + 2, this.pos);
      const w32 = ((subLen << 3) | 4) >>> 0;
      this.buf[lenPos] = w32 & 0xff;
      this.buf[lenPos + 1] = (w32 >>> 8) & 0xff;
      this.buf[lenPos + 2] = (w32 >>> 16) & 0xff;
      this.buf[lenPos + 3] = (w32 >>> 24) & 0xff;
      this.pos += 2;
      return;
    }
    this.ensureCapacity(7);
    this.buf.copyWithin(lenPos + 9, lenPos + 2, this.pos);
    writeVarintAt(this.buf, lenPos, BigInt(subLen));
    this.pos += 7;
  }

  // ==========================================================================
  // Scalar Writers
  // ==========================================================================

  /**
   * Writes an unsigned integer field (`WireUint = 0`).
   */
  writeUint(fieldNum: number, v: number | bigint): void {
    if (
      (fieldNum | 0) === fieldNum &&
      fieldNum >= 1 &&
      fieldNum <= 1023 &&
      typeof v === 'number' &&
      v >= 0 &&
      v <= 9007199254740991
    ) {
      if (this.pos + 11 > this.buf.length) {
        this.ensureCapacity(11);
      }
      const buf = this.buf;
      let p = this.pos;
      const tag = fieldNum << 4;
      if (tag <= 127) {
        buf[p++] = (tag << 1) | 1;
      } else {
        const t16 = (tag << 2) | 2;
        buf[p++] = t16 & 0xff;
        buf[p++] = (t16 >>> 8) & 0xff;
      }
      if (v <= 536870911) {
        const iv = v >>> 0;
        if (iv <= 127) {
          buf[p++] = (iv << 1) | 1;
        } else if (iv <= 16383) {
          const u16 = (iv << 2) | 2;
          buf[p++] = u16 & 0xff;
          buf[p++] = (u16 >>> 8) & 0xff;
        } else {
          const w32 = ((iv << 3) | 4) >>> 0;
          buf[p++] = w32 & 0xff;
          buf[p++] = (w32 >>> 8) & 0xff;
          buf[p++] = (w32 >>> 16) & 0xff;
          buf[p++] = (w32 >>> 24) & 0xff;
        }
      } else {
        const lo = v >>> 0;
        const hi = Math.floor(v / 0x100000000) >>> 0;
        buf[p++] = 0x00;
        buf[p++] = lo & 0xff;
        buf[p++] = (lo >>> 8) & 0xff;
        buf[p++] = (lo >>> 16) & 0xff;
        buf[p++] = (lo >>> 24) & 0xff;
        buf[p++] = hi & 0xff;
        buf[p++] = (hi >>> 8) & 0xff;
        buf[p++] = (hi >>> 16) & 0xff;
        buf[p++] = (hi >>> 24) & 0xff;
      }
      this.pos = p;
      return;
    }
    this.writeTag(fieldNum, WireUint);
    this.writeRawVarint(v);
  }

  /**
   * Writes a ZigZag-encoded signed integer field (`WireSint = 1`).
   */
  writeInt(fieldNum: number, v: number | bigint): void {
    if (
      (fieldNum | 0) === fieldNum &&
      fieldNum >= 1 &&
      fieldNum <= 1023 &&
      typeof v === 'number' &&
      v >= -268435456 &&
      v <= 268435455
    ) {
      if (this.pos + 6 > this.buf.length) {
        this.ensureCapacity(6);
      }
      const buf = this.buf;
      let p = this.pos;
      const tag = (fieldNum << 4) | WireSint;
      if (tag <= 127) {
        buf[p++] = (tag << 1) | 1;
      } else {
        const t16 = (tag << 2) | 2;
        buf[p++] = t16 & 0xff;
        buf[p++] = (t16 >>> 8) & 0xff;
      }
      const iv = ((v << 1) ^ (v >> 31)) >>> 0;
      if (iv <= 127) {
        buf[p++] = (iv << 1) | 1;
      } else if (iv <= 16383) {
        const u16 = (iv << 2) | 2;
        buf[p++] = u16 & 0xff;
        buf[p++] = (u16 >>> 8) & 0xff;
      } else {
        const w32 = ((iv << 3) | 4) >>> 0;
        buf[p++] = w32 & 0xff;
        buf[p++] = (w32 >>> 8) & 0xff;
        buf[p++] = (w32 >>> 16) & 0xff;
        buf[p++] = (w32 >>> 24) & 0xff;
      }
      this.pos = p;
      return;
    }
    this.writeTag(fieldNum, WireSint);
    this.writeRawVarint(encodeZigZagNumber(v));
  }

  /**
   * Writes a boolean field using 0 payload bytes (`WireBoolTrue = 3` or `WireBoolFalse = 2`).
   */
  writeBool(fieldNum: number, v: boolean): void {
    const wt = v ? WireBoolTrue : WireBoolFalse;
    if ((fieldNum | 0) === fieldNum && fieldNum >= 1 && fieldNum <= 7) {
      if (this.pos + 1 > this.buf.length) {
        this.ensureCapacity(1);
      }
      this.buf[this.pos++] = (((fieldNum << 4) | wt) << 1) | 1;
      return;
    }
    this.writeTag(fieldNum, wt);
  }

  /**
   * Writes a 4-byte little-endian uint32 field (`WireFixed32 = 4`).
   */
  writeFixed32(fieldNum: number, v: number): void {
    this.writeTag(fieldNum, WireFixed32);
    this.writeRawFixed32(v);
  }

  /**
   * Writes a 4-byte little-endian int32 field (`WireSfixed32 = 6`).
   */
  writeSfixed32(fieldNum: number, v: number): void {
    this.writeTag(fieldNum, WireSfixed32);
    this.writeRawFixed32(v);
  }

  /**
   * Writes a 4-byte IEEE-754 float32 field (`WireFloat32 = 8`).
   */
  writeFloat32(fieldNum: number, v: number): void {
    if ((fieldNum | 0) === fieldNum && fieldNum >= 1 && fieldNum <= 7) {
      if (this.pos + 5 > this.buf.length) {
        this.ensureCapacity(5);
      }
      this.buf[this.pos++] = (((fieldNum << 4) | WireFloat32) << 1) | 1;
      this.view.setFloat32(this.pos, v, true);
      this.pos += 4;
      return;
    }
    this.writeTag(fieldNum, WireFloat32);
    this.writeRawFloat32(v);
  }

  /**
   * Writes an 8-byte little-endian uint64 field (`WireFixed64 = 5`).
   */
  writeFixed64(fieldNum: number, v: number | bigint): void {
    this.writeTag(fieldNum, WireFixed64);
    this.writeRawFixed64(v);
  }

  /**
   * Writes an 8-byte little-endian int64 field (`WireSfixed64 = 7`).
   */
  writeSfixed64(fieldNum: number, v: number | bigint): void {
    this.writeTag(fieldNum, WireSfixed64);
    this.writeRawFixed64(v);
  }

  /**
   * Writes an 8-byte IEEE-754 float64 field (`WireFloat64 = 9`).
   */
  writeFloat64(fieldNum: number, v: number): void {
    if ((fieldNum | 0) === fieldNum && fieldNum >= 1 && fieldNum <= 7) {
      if (this.pos + 9 > this.buf.length) {
        this.ensureCapacity(9);
      }
      this.buf[this.pos++] = (((fieldNum << 4) | WireFloat64) << 1) | 1;
      this.view.setFloat64(this.pos, v, true);
      this.pos += 8;
      return;
    }
    this.writeTag(fieldNum, WireFloat64);
    this.writeRawFloat64(v);
  }

  /**
   * Writes a UTF-8 string field (`WireString = 10`).
   */
  writeString(fieldNum: number, s: string): void {
    const n = s.length;
    if ((fieldNum | 0) === fieldNum && fieldNum >= 1 && fieldNum <= 1023 && n <= 42) {
      const tag = (fieldNum << 4) | WireString;
      const tagBytes = tag <= 127 ? 1 : 2;
      if (n === 0) {
        if (this.pos + tagBytes + 1 > this.buf.length) {
          this.ensureCapacity(tagBytes + 1);
        }
        const buf = this.buf;
        let p = this.pos;
        if (tagBytes === 1) {
          buf[p++] = (tag << 1) | 1;
        } else {
          const t16 = (tag << 2) | 2;
          buf[p++] = t16 & 0xff;
          buf[p++] = (t16 >>> 8) & 0xff;
        }
        buf[p++] = 0x01;
        this.pos = p;
        return;
      }
      if (this.pos + tagBytes + 1 + n * 3 > this.buf.length) {
        this.ensureCapacity(tagBytes + 1 + n * 3);
      }
      const buf = this.buf;
      let p = this.pos;
      if (tagBytes === 1) {
        buf[p++] = (tag << 1) | 1;
      } else {
        const t16 = (tag << 2) | 2;
        buf[p++] = t16 & 0xff;
        buf[p++] = (t16 >>> 8) & 0xff;
      }
      const lenPos = p;
      p = lenPos + 1;
      for (let i = 0; i < n; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) {
          buf[p++] = c;
        } else if (c < 0x800) {
          buf[p++] = 0xc0 | (c >> 6);
          buf[p++] = 0x80 | (c & 0x3f);
        } else if (
          c >= 0xd800 &&
          c <= 0xdbff &&
          i + 1 < n &&
          s.charCodeAt(i + 1) >= 0xdc00 &&
          s.charCodeAt(i + 1) <= 0xdfff
        ) {
          const cp = 0x10000 + (((c & 0x3ff) << 10) | (s.charCodeAt(++i) & 0x3ff));
          buf[p++] = 0xf0 | (cp >> 18);
          buf[p++] = 0x80 | ((cp >> 12) & 0x3f);
          buf[p++] = 0x80 | ((cp >> 6) & 0x3f);
          buf[p++] = 0x80 | (cp & 0x3f);
        } else if (c >= 0xd800 && c <= 0xdfff) {
          buf[p++] = 0xef;
          buf[p++] = 0xbf;
          buf[p++] = 0xbd;
        } else {
          buf[p++] = 0xe0 | (c >> 12);
          buf[p++] = 0x80 | ((c >> 6) & 0x3f);
          buf[p++] = 0x80 | (c & 0x3f);
        }
      }
      buf[lenPos] = ((p - (lenPos + 1)) << 1) | 1;
      this.pos = p;
      return;
    }
    this.writeTag(fieldNum, WireString);
    this.writeRawStringPayload(s);
  }

  /**
   * Writes a raw byte slice field (`WireBytes = 11`).
   */
  writeBytes(fieldNum: number, b: Uint8Array): void {
    this.writeTag(fieldNum, WireBytes);
    this.writeRawBytesPayload(b);
  }

  // ==========================================================================
  // Composable Array Writers (WireArray = 13)
  // ==========================================================================

  /**
   * Writes a repeated string array (`WireArray = 13`, `ElementType = WireString = 10`) with an outer backpatched 2B length prefix.
   */
  writeStringArr(fieldNum: number, items: readonly string[]): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length);
    this.writeByte(WireString);
    this.writeRawVarint(items.length);
    for (let i = 0; i < items.length; i++) {
      this.writeRawStringPayload(items[i]!);
    }
    this.endContainer();
  }

  /**
   * Writes a repeated bytes array (`WireArray = 13`, `ElementType = WireBytes = 11`) with an outer backpatched length prefix.
   */
  writeBytesArr(fieldNum: number, items: readonly Uint8Array[]): void {
    this.writeTag(fieldNum, WireArray);
    let minBody = 2 + items.length;
    for (let i = 0; i < items.length; i++) {
      minBody += items[i]!.length;
      if (minBody > 16383) break;
    }
    this.beginContainer(minBody);
    this.writeByte(WireBytes);
    this.writeRawVarint(items.length);
    for (let i = 0; i < items.length; i++) {
      this.writeRawBytesPayload(items[i]!);
    }
    this.endContainer();
  }

  /**
   * Writes a packed unsigned integer array (`WireArray = 13`, `ElementType = WireUint = 0`) with an outer backpatched length prefix.
   */
  writeUint32Arr(fieldNum: number, items: ArrayLike<number>): void {
    const count = items.length;
    if ((fieldNum | 0) === fieldNum && fieldNum >= 1 && fieldNum <= 1023 && count <= 127) {
      const maxBytes = 2 + 2 + 1 + 1 + count * 9;
      if (this.pos + maxBytes > this.buf.length) {
        this.ensureCapacity(maxBytes);
      }
      const buf = this.buf;
      let p = this.pos;
      const tag = (fieldNum << 4) | WireArray;
      if (tag <= 127) {
        buf[p++] = (tag << 1) | 1;
      } else {
        const t16 = (tag << 2) | 2;
        buf[p++] = t16 & 0xff;
        buf[p++] = (t16 >>> 8) & 0xff;
      }
      const lenPos = p;
      p += 2;
      buf[p++] = WireUint;
      buf[p++] = (count << 1) | 1;
      for (let i = 0; i < count; i++) {
        const v = items[i]! >>> 0;
        if (v <= 127) {
          buf[p++] = (v << 1) | 1;
        } else if (v <= 16383) {
          const u16 = (v << 2) | 2;
          buf[p++] = u16 & 0xff;
          buf[p++] = (u16 >>> 8) & 0xff;
        } else if (v <= 536870911) {
          const w32 = ((v << 3) | 4) >>> 0;
          buf[p++] = w32 & 0xff;
          buf[p++] = (w32 >>> 8) & 0xff;
          buf[p++] = (w32 >>> 16) & 0xff;
          buf[p++] = (w32 >>> 24) & 0xff;
        } else {
          buf[p++] = 0x00;
          buf[p++] = v & 0xff;
          buf[p++] = (v >>> 8) & 0xff;
          buf[p++] = (v >>> 16) & 0xff;
          buf[p++] = (v >>> 24) & 0xff;
          buf[p++] = 0;
          buf[p++] = 0;
          buf[p++] = 0;
          buf[p++] = 0;
        }
      }
      const subLen = p - (lenPos + 2);
      const u16 = ((subLen << 2) | 2) & 0xffff;
      buf[lenPos] = u16 & 0xff;
      buf[lenPos + 1] = (u16 >>> 8) & 0xff;
      this.pos = p;
      return;
    }
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + count);
    this.writeByte(WireUint);
    this.writeRawVarint(count);
    for (let i = 0; i < count; i++) {
      this.writeRawVarint(items[i]! >>> 0);
    }
    this.endContainer();
  }

  /**
   * Writes a packed unsigned integer array (`WireArray = 13`, `ElementType = WireUint = 0`) supporting `number | bigint` elements.
   */
  writeUintArr(fieldNum: number, items: ArrayLike<number | bigint>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length);
    this.writeByte(WireUint);
    this.writeRawVarint(items.length);
    for (let i = 0; i < items.length; i++) {
      const v = items[i]!;
      this.writeRawVarint(typeof v === 'bigint' ? BigInt.asUintN(64, v) : v);
    }
    this.endContainer();
  }

  /**
   * Writes a packed boolean array (`WireArray = 13`, `ElementType = WireBoolFalse = 2`) with 1-byte `0x00`/`0x01` elements.
   */
  writeBoolArr(fieldNum: number, items: readonly boolean[]): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length);
    this.writeByte(WireBoolFalse);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length);
    for (let i = 0; i < items.length; i++) {
      this.buf[this.pos++] = items[i] ? 1 : 0;
    }
    this.endContainer();
  }

  /**
   * Writes a packed ZigZag signed integer array (`WireArray = 13`, `ElementType = WireSint = 1`) with an outer backpatched length prefix.
   */
  writeSintArr(fieldNum: number, items: ArrayLike<number | bigint>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length);
    this.writeByte(WireSint);
    this.writeRawVarint(items.length);
    for (let i = 0; i < items.length; i++) {
      const v = items[i]!;
      this.writeRawVarint(typeof v === 'bigint' ? encodeZigZag(v) : encodeZigZagNumber(v));
    }
    this.endContainer();
  }

  /**
   * Writes a packed float32 array (`WireArray = 13`, `ElementType = WireFloat32 = 8`).
   */
  writeFloat32Arr(fieldNum: number, items: ArrayLike<number>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length * 4);
    this.writeByte(WireFloat32);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length * 4);
    for (let i = 0; i < items.length; i++) {
      this.view.setFloat32(this.pos, items[i]!, true);
      this.pos += 4;
    }
    this.endContainer();
  }

  /**
   * Writes a packed fixed32 array (`WireArray = 13`, `ElementType = WireFixed32 = 4`).
   */
  writeFixed32Arr(fieldNum: number, items: ArrayLike<number>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length * 4);
    this.writeByte(WireFixed32);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length * 4);
    for (let i = 0; i < items.length; i++) {
      this.view.setUint32(this.pos, items[i]! >>> 0, true);
      this.pos += 4;
    }
    this.endContainer();
  }

  /**
   * Writes a packed sfixed32 array (`WireArray = 13`, `ElementType = WireSfixed32 = 6`).
   */
  writeSfixed32Arr(fieldNum: number, items: ArrayLike<number>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length * 4);
    this.writeByte(WireSfixed32);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length * 4);
    for (let i = 0; i < items.length; i++) {
      this.view.setUint32(this.pos, items[i]! >>> 0, true);
      this.pos += 4;
    }
    this.endContainer();
  }

  /**
   * Writes a packed float64 array (`WireArray = 13`, `ElementType = WireFloat64 = 9`).
   */
  writeFloat64Arr(fieldNum: number, items: ArrayLike<number>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length * 8);
    this.writeByte(WireFloat64);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length * 8);
    for (let i = 0; i < items.length; i++) {
      this.view.setFloat64(this.pos, items[i]!, true);
      this.pos += 8;
    }
    this.endContainer();
  }

  /**
   * Writes a packed fixed64 array (`WireArray = 13`, `ElementType = WireFixed64 = 5`).
   */
  writeFixed64Arr(fieldNum: number, items: ArrayLike<number | bigint>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length * 8);
    this.writeByte(WireFixed64);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length * 8);
    for (let i = 0; i < items.length; i++) {
      const u = BigInt.asUintN(64, toBigInt64Input(items[i]!));
      this.view.setBigUint64(this.pos, u, true);
      this.pos += 8;
    }
    this.endContainer();
  }

  /**
   * Writes a packed sfixed64 array (`WireArray = 13`, `ElementType = WireSfixed64 = 7`).
   */
  writeSfixed64Arr(fieldNum: number, items: ArrayLike<number | bigint>): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(2 + items.length * 8);
    this.writeByte(WireSfixed64);
    this.writeRawVarint(items.length);
    this.ensureCapacity(items.length * 8);
    for (let i = 0; i < items.length; i++) {
      const u = BigInt.asUintN(64, toBigInt64Input(items[i]!));
      this.view.setBigUint64(this.pos, u, true);
      this.pos += 8;
    }
    this.endContainer();
  }

  // ==========================================================================
  // Nested Sub-Message & Sub-Message Array Writers
  // ==========================================================================

  /**
   * Starts a nested sub-message (`WireSubMsg = 12`) in a single pass.
   */
  beginSubMsg(fieldNum: number, minBodyBytes = 0): void {
    this.writeTag(fieldNum, WireSubMsg);
    this.beginContainer(minBodyBytes);
  }

  /**
   * Finishes the current nested sub-message and backpatches its byte length.
   */
  endSubMsg(): void {
    this.endContainer();
  }

  /**
   * Starts a repeated sub-message array (`WireArray = 13`, `ElementType = WireSubMsg = 12`) in a single pass.
   * When `knownCount` is provided, writes the element count up front and avoids shifting the array body in `endSubMsgArr`.
   */
  beginSubMsgArr(fieldNum: number, minBodyBytes = 0, knownCount?: number): void {
    this.writeTag(fieldNum, WireArray);
    this.beginContainer(minBodyBytes);
    this.writeByte(WireSubMsg);
    if (knownCount !== undefined && knownCount >= 0) {
      this.elemCountStack[this.depth - 1] = -1;
      this.writeRawVarint(knownCount);
    } else {
      this.elemCountStack[this.depth - 1] = 0;
      this.writeByte(0x01); // 1-byte Prefix-Varint(0) count slot
    }
  }

  /**
   * Starts the next element inside an open `WireArray(WireSubMsg)` by reserving its length prefix.
   */
  beginSubMsgElem(minBodyBytes = 0): void {
    if (this.depth > 0 && this.elemCountStack[this.depth - 1]! >= 0) {
      this.elemCountStack[this.depth - 1]!++;
    }
    this.beginContainer(minBodyBytes);
  }

  /**
   * Finishes the current element inside an open `WireArray(WireSubMsg)` and backpatches its length.
   */
  endSubMsgElem(): void {
    this.endContainer();
  }

  /**
   * Starts a small sub-message element whose encoded body is statically expected to be <= 127 bytes.
   * Reserves a 1-byte Prefix-Varint length slot and returns its byte offset for `endSmallSubMsgElem`.
   */
  beginSmallSubMsgElem(maxBodyBytes = 127): number {
    if (this.depth > 0 && this.elemCountStack[this.depth - 1]! >= 0) {
      this.elemCountStack[this.depth - 1]!++;
    }
    if (this.pos + 1 + maxBodyBytes > this.buf.length) {
      this.ensureCapacity(1 + maxBodyBytes);
    }
    return this.pos++;
  }

  /**
   * Finishes a small sub-message element started by `beginSmallSubMsgElem` and writes its length prefix.
   * Falls back to expanding the varint if unexpected unknown fields pushed the body past 127 bytes.
   */
  endSmallSubMsgElem(lenPos: number): void {
    const subLen = this.pos - (lenPos + 1);
    if (subLen <= 127) {
      this.buf[lenPos] = ((subLen << 1) | 1) & 0xff;
      return;
    }
    this.patchReservedVarint(lenPos, subLen);
  }

  /**
   * Finishes the open `WireArray(WireSubMsg)` and backpatches its element count (if unknown up front) and total byte length.
   */
  endSubMsgArr(): void {
    if (this.depth <= 0) {
      throw new Error('omnibuf: endSubMsgArr called without matching beginSubMsgArr');
    }
    const count = this.elemCountStack[this.depth - 1]!;
    if (count >= 0) {
      const lenPos = this.lenStack[this.depth - 1]!;
      const reserved = this.lenWidthStack[this.depth - 1]!;
      this.patchReservedVarint(lenPos + reserved + 1, count);
    }
    this.endContainer();
  }

  // ==========================================================================
  // Map Writers (WireMap = 14)
  // ==========================================================================

  /**
   * Writes a `map<string, uint64>` (`WireMap = 14`) in a single pass.
   */
  writeMapStringUint(
    fieldNum: number,
    m: ReadonlyMap<string, number | bigint> | Readonly<Record<string, number | bigint>>,
    deterministic = false,
  ): void {
    const entries: [string, number | bigint][] =
      m instanceof Map ? Array.from(m.entries()) : Object.entries(m);
    this.writeTag(fieldNum, WireMap);
    this.beginContainer(3 + entries.length * 2);
    this.writeByte(WireString);
    this.writeByte(WireUint);

    this.writeRawVarint(entries.length);
    if (deterministic && entries.length > 1) {
      entries.sort((a, b) => compareUTF8Strings(a[0], b[0]));
    }
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i]!;
      this.writeRawStringPayload(k);
      this.writeRawVarint(typeof v === 'bigint' ? BigInt.asUintN(64, v) : v);
    }
    this.endContainer();
  }

  /**
   * Writes a `map<string, uint64>` (`WireMap = 14`) with keys sorted in lexicographical order.
   */
  writeMapStringUintDeterministic(
    fieldNum: number,
    m: ReadonlyMap<string, number | bigint> | Readonly<Record<string, number | bigint>>,
  ): void {
    this.writeMapStringUint(fieldNum, m, true);
  }
}
