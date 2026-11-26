import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeCloseTo(expected: number, precision = 5) {
      assert.ok(Math.abs((actual as number) - expected) < Math.pow(10, -precision));
    },
    toBeInstanceOf(cls: new (...args: never[]) => unknown) {
      assert.ok(actual instanceof cls);
    },
    not: {
      toBeNull() {
        assert.notStrictEqual(actual, null);
      },
    },
  };
}
import {
  DescriptorRegistry,
  Encoder,
  base64ToUint8Array,
  clearField,
  clone,
  concatMessages,
  create,
  decodeBlind,
  decodeBlindJSON,
  decodeVarint,
  decodeVarintBigInt,
  decodeZigZag,
  decodeZigZagBigInt,
  defineMessage,
  encodeField0SchemaMeta,
  encodeZigZag,
  encodeZigZagNumber,
  equals,
  fromBinary,
  isMessage,
  locateField,
  marshalDeterministic,
  marshalProto,
  mergeFromBinary,
  mergeSchemaMeta,
  omnibufField,
  omnibufMessage,
  parseBinaryFileDescriptorSet,
  readBool,
  readBytes,
  readField0SchemaMeta,
  readFixed32,
  readFixed64,
  readFloat32,
  readFloat32Arr,
  readFloat64,
  readFloat64Arr,
  readInt,
  readInt32,
  readIntBigInt,
  readSint32Arr,
  readSintArr,
  readString,
  readStringArr,
  readStringBytes,
  readSubMsg,
  readSubMsgArrElem,
  readSubMsgMerged,
  readUint,
  readUint32,
  readUint32Arr,
  readUintBigInt,
  activeOneofSlice,
  appendBoolArrBody,
  appendBytesArrBody,
  appendEnumArrBody,
  appendSintArrAutoBody,
  appendUint32ArrBody,
  appendUintArrAutoBody,
  countedArrLen,
  getClassSchema,
  lookupMapStringUint,
  nextContainerField,
  parseArrayHeader,
  parseMapHeader,
  readBytesView,
  readElem,
  readSubMsgArrDecoded,
  readTypedMap,
  spliceFields,
  subMsgArrLen,
  WireArray,
  WireBoolFalse,
  WireBytes,
  WireFloat32,
  WireMap,
  WireSint,
  WireString,
  WireSubMsg,
  WireUint,
  toBinary,
  unmarshal,
  unmarshalProto,
  writeField0SchemaMeta,
  writeVarintAt,
  type FileDescriptorSetJSON,
  type Message,
  type ProtobufDescMessage,
  type SchemaMeta,
} from '../src/index.js';

function findSubsequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe('@omnibuf/core - Prefix-Varint & ZigZag primitives', () => {
  it('encodes and decodes Prefix-Varint across 1B, 2B, 4B, and 9B boundaries', () => {
    const vectors: Array<{ val: bigint; expectedLen: number }> = [
      { val: 0n, expectedLen: 1 },
      { val: 1n, expectedLen: 1 },
      { val: 127n, expectedLen: 1 },
      { val: 128n, expectedLen: 2 },
      { val: 16383n, expectedLen: 2 },
      { val: 16384n, expectedLen: 4 },
      { val: 536870911n, expectedLen: 4 },
      { val: 536870912n, expectedLen: 9 },
      { val: 0xffffffffn, expectedLen: 9 },
      { val: 0xffffffffffffffffn, expectedLen: 9 },
    ];

    for (const { val, expectedLen } of vectors) {
      const buf = new Uint8Array(16);
      const written = writeVarintAt(buf, 0, val);
      expect(written).toBe(expectedLen);
      const [decoded, bytesRead] = decodeVarintBigInt(buf, 0);
      expect(bytesRead).toBe(expectedLen);
      expect(decoded).toBe(val);

      if (val <= 0xffffffffn) {
        const buf32 = new Uint8Array(16);
        const w32 = writeVarintAt(buf32, 0, Number(val));
        expect(w32).toBe(expectedLen);
        const [d32, np32] = decodeVarint(buf32, 0);
        expect(np32).toBe(expectedLen);
        expect(d32).toBe(Number(val));
      }
    }
  });

  it('encodes and decodes 32-bit and 64-bit ZigZag integers', () => {
    const cases32: Array<[number, number]> = [
      [0, 0],
      [-1, 1],
      [1, 2],
      [-2, 3],
      [2, 4],
      [2147483647, 4294967294],
      [-2147483648, 4294967295],
    ];
    for (const [signed, unsigned] of cases32) {
      expect(Number(encodeZigZagNumber(signed))).toBe(unsigned);
      expect(decodeZigZag(unsigned)).toBe(signed);
    }

    const cases64: Array<[bigint, bigint]> = [
      [0n, 0n],
      [-1n, 1n],
      [1n, 2n],
      [-2n, 3n],
      [9223372036854775807n, 18446744073709551614n],
      [-9223372036854775808n, 18446744073709551615n],
    ];
    for (const [signed, unsigned] of cases64) {
      expect(encodeZigZag(signed)).toBe(unsigned);
      expect(decodeZigZagBigInt(unsigned)).toBe(signed);
    }
  });
});

describe('@omnibuf/core - All 16 wire types & single-pass Encoder / O(1) Readers', () => {
  it('round-trips all scalar, array, submsg, and map wire types', () => {
    const enc = new Encoder();
    enc.writeUint(1, 42);
    enc.writeUint(2, 18446744073709551615n);
    enc.writeInt(3, -123);
    enc.writeInt(4, -9223372036854775808n);
    enc.writeFixed32(5, 0xdeadbeef);
    enc.writeFixed64(6, 0xcafebabe12345678n);
    enc.writeFloat32(7, 3.5);
    enc.writeFloat64(8, Math.PI);
    enc.writeBool(9, false);
    enc.writeBool(10, true);
    enc.writeString(11, 'hello omnibuf 🚀');
    enc.writeBytes(12, new Uint8Array([1, 2, 3, 4, 255]));
    enc.writeStringArr(13, ['alpha', 'beta', 'gamma']);
    enc.writeUint32Arr(14, [10, 200, 30000]);
    enc.writeSintArr(15, [-100, 0, 100]);
    enc.writeFloat32Arr(16, [1.5, -2.5]);
    enc.writeFloat64Arr(17, [1.25, -3.75]);
    enc.writeMapStringUint(18, { alpha: 100, beta: 200 }, true);

    enc.beginSubMsg(19);
    enc.writeString(1, 'nested');
    enc.writeUint(2, 99);
    enc.endSubMsg();

    enc.beginSubMsgArr(20);
    for (let i = 0; i < 2; i++) {
      enc.beginSubMsgElem();
      enc.writeUint(1, i + 1);
      enc.endSubMsgElem();
    }
    enc.endSubMsgArr();

    const packet = enc.finish();

    expect(readUint(packet, 1)).toEqual([42, true]);
    expect(readUintBigInt(packet, 2)).toEqual([18446744073709551615n, true]);
    expect(readInt(packet, 3)).toEqual([-123, true]);
    expect(readIntBigInt(packet, 4)).toEqual([-9223372036854775808n, true]);
    expect(readFixed32(packet, 5)).toEqual([0xdeadbeef, true]);
    expect(readFixed64(packet, 6)).toEqual([0xcafebabe12345678n, true]);
    expect(readFloat32(packet, 7)[0]).toBeCloseTo(3.5);
    expect(readFloat64(packet, 8)[0]).toBeCloseTo(Math.PI);
    expect(readBool(packet, 9)).toEqual([false, true]);
    expect(readBool(packet, 10)).toEqual([true, true]);
    expect(readString(packet, 11)).toEqual(['hello omnibuf 🚀', true]);
    expect(Array.from(readBytes(packet, 12)[0])).toEqual([1, 2, 3, 4, 255]);
    expect(readStringArr(packet, 13)).toEqual([['alpha', 'beta', 'gamma'], true]);
    expect(readUint32Arr(packet, 14)).toEqual([[10, 200, 30000], true]);
    expect(readSintArr(packet, 15)).toEqual([[-100, 0, 100], true]);
    expect(readFloat32Arr(packet, 16)).toEqual([[1.5, -2.5], true]);
    expect(readFloat64Arr(packet, 17)).toEqual([[1.25, -3.75], true]);

    const [sub, subOk] = readSubMsg(packet, 19);
    expect(subOk).toBe(true);
    expect(readString(sub, 1)).toEqual(['nested', true]);
    expect(readUint(sub, 2)).toEqual([99, true]);

    expect(subMsgArrLen(packet, 20)).toBe(2);
    expect(readUint(readSubMsgArrElem(packet, 20, 0)[0], 1)).toEqual([1, true]);
    expect(readUint(readSubMsgArrElem(packet, 20, 1)[0], 1)).toEqual([2, true]);
  });

  it('expands 2-byte reserved length header to 4-byte header when submessage exceeds 16,383 bytes', () => {
    const enc = new Encoder();
    enc.beginSubMsg(1);
    const bigStr = 'x'.repeat(20000);
    enc.writeString(1, bigStr);
    enc.endSubMsg();
    const packet = enc.finish();

    const [sub, ok] = readSubMsg(packet, 1);
    expect(ok).toBe(true);
    expect(readString(sub, 1)).toEqual([bigStr, true]);
  });

  it('supports spliceFields and concatMessages raw merge semantics (including Field #0 merge)', () => {
    const SchemaA = defineMessage<{ id: number; name: string }>('test.Msg', {
      id: { fieldNum: 1, type: 'uint32', omitEmpty: true },
      name: { fieldNum: 2, type: 'string', omitEmpty: true },
    });
    const SchemaB = defineMessage<{ id: number; extra: string }>('test.Msg', {
      id: { fieldNum: 1, type: 'uint32', omitEmpty: true },
      extra: { fieldNum: 3, type: 'string', omitEmpty: true },
    });

    const pktA = SchemaA.encode({ id: 10, name: 'initial' }, { selfDescribing: true });
    const pktB = SchemaB.encode({ id: 99, extra: 'merged' }, { selfDescribing: true });

    const merged = concatMessages(pktA, pktB);
    // Last write wins for Field #1
    expect(readUint(merged, 1)).toEqual([99, true]);
    expect(readString(merged, 2)).toEqual(['initial', true]);
    expect(readString(merged, 3)).toEqual(['merged', true]);

    // Field #0 SchemaMeta is merged across both packets
    const [meta, ok] = readField0SchemaMeta(merged);
    expect(ok).toBe(true);
    expect(meta?.fields).toEqual({
      1: 'id',
      2: 'name',
      3: 'extra',
    });

    const blind = decodeBlind(merged);
    expect(blind).toEqual({
      id: 99,
      name: 'initial',
      extra: 'merged',
    });

    // Zero-decode spliceFields replacing field 2
    const spliced = spliceFields(merged, 1n << 2n, 3, (enc, fnum) => {
      if (fnum === 2) enc.writeString(2, 'spliced-name');
    });
    expect(locateField(spliced, 2).ok).toBe(true);
    expect(readUint(spliced, 1)).toEqual([99, true]);
    expect(readString(spliced, 2)).toEqual(['spliced-name', true]);
    expect(readString(spliced, 3)).toEqual(['merged', true]);
  });

  it('retains grown Encoder slabs up to 64 KiB across beginMessage() calls', () => {
    const enc = new Encoder(8192);
    const start1 = enc.beginMessage();
    enc.writeBytes(1, new Uint8Array(40 * 1024));
    const out1 = enc.endMessage(start1);
    assert.ok(out1.byteLength > 40 * 1024);

    const grownCap = (enc as unknown as { buf: Uint8Array }).buf.length;
    assert.ok(grownCap >= 65536, `Expected slab to grow to >=65536, got ${grownCap}`);

    enc.beginMessage();
    const afterBeginCap = (enc as unknown as { buf: Uint8Array }).buf.length;
    assert.ok(
      afterBeginCap >= 65536,
      `Expected beginMessage() to retain >=65536 slab, got ${afterBeginCap}`,
    );
  });

  it('restores destination array length when append*ArrBody encounters a mid-array error', () => {
    // Bytes array: count=2, elem 0 valid (1B), elem 1 truncated
    const dstBytes: Uint8Array[] = [Uint8Array.from([9])];
    const badBytesBody = Uint8Array.from([WireBytes, 0x05, 0x03, 0xaa, 0x05, 0xbb]);
    assert.equal(appendBytesArrBody(dstBytes, badBytesBody)[1], false);
    assert.equal(dstBytes.length, 1);

    // Bool array: count=2, elem 0 valid (1), elem 1 invalid (2)
    const dstBool: boolean[] = [true];
    const badBoolBody = Uint8Array.from([WireBoolFalse, 0x05, 1, 2]);
    assert.equal(appendBoolArrBody(dstBool, badBoolBody)[1], false);
    assert.equal(dstBool.length, 1);

    // Uint32 array: count=2, elem 0 valid, elem 1 truncated 2-byte varint
    const dstU32: number[] = [7];
    const badU32Body = Uint8Array.from([WireUint, 0x05, 0x03, 0x02]);
    assert.equal(appendUint32ArrBody(dstU32, badU32Body)[1], false);
    assert.equal(dstU32.length, 1);

    // Enum/sint32 array: count=2, elem 0 valid, elem 1 truncated
    const dstEnum: number[] = [3];
    const badSintBody = Uint8Array.from([WireSint, 0x05, 0x03, 0x02]);
    assert.equal(appendEnumArrBody(dstEnum, badSintBody)[1], false);
    assert.equal(dstEnum.length, 1);

    // UintAuto array
    const dstUAuto: (number | bigint)[] = [1];
    assert.equal(appendUintArrAutoBody(dstUAuto, badU32Body)[1], false);
    assert.equal(dstUAuto.length, 1);

    // SintAuto array
    const dstSAuto: (number | bigint)[] = [-1];
    assert.equal(appendSintArrAutoBody(dstSAuto, badSintBody)[1], false);
    assert.equal(dstSAuto.length, 1);
  });

  it('rejects fractional field numbers in Encoder fast-path write methods', () => {
    const enc = new Encoder();
    assert.throws(() => enc.writeUint(1.5, 42), /invalid field number/);
    assert.throws(() => enc.writeInt(1.5, -5), /invalid field number/);
    assert.throws(() => enc.writeBool(1.5, true), /invalid field number/);
    assert.throws(() => enc.writeFloat32(1.5, 1.0), /invalid field number/);
    assert.throws(() => enc.writeFloat64(1.5, 1.0), /invalid field number/);
  });

  it('returns an independent copy from readBytes() while keeping readBytesView() zero-copy', () => {
    const enc = new Encoder();
    enc.writeBytes(1, Uint8Array.from([10, 20, 30, 40]));
    const pkt = enc.finish();

    const [copied, okCopy] = readBytes(pkt, 1);
    assert.equal(okCopy, true);
    assert.notEqual(copied.buffer, pkt.buffer);
    copied[0] = 0xff;
    assert.equal(readBytes(pkt, 1)[0][0], 10);

    const [view, okView] = readBytesView(pkt, 1);
    assert.equal(okView, true);
    assert.equal(view.buffer, pkt.buffer);
    assert.deepEqual(Array.from(view), [10, 20, 30, 40]);
  });

  it('shrinks oversized Encoder slabs via abortMessage() on errors in MessageSchema.encode and spliceFields', () => {
    const enc = new Encoder(8192);
    const start = enc.beginMessage();
    enc.writeBytes(1, new Uint8Array(300 * 1024));
    assert.ok((enc as unknown as { buf: Uint8Array }).buf.length > 256 * 1024);
    enc.abortMessage(start);
    assert.equal(enc.bytesView().length, 0);
    assert.equal((enc as unknown as { buf: Uint8Array }).buf.length, 8192);

    const LargeSchema = defineMessage<{ big: Uint8Array; fail: string }>('test.LargeFail', {
      big: { fieldNum: 1, type: 'bytes' },
      fail: { fieldNum: 2, type: 'string' },
    });
    const throwingMsg = {
      big: new Uint8Array(300 * 1024),
      get fail(): string {
        throw new Error('boom');
      },
    };
    assert.throws(() => LargeSchema.encode(throwingMsg), /boom/);
    const okEncoded = LargeSchema.encode({ big: Uint8Array.from([1, 2]), fail: 'ok' });
    const decoded = LargeSchema.decode(okEncoded);
    assert.equal(decoded.fail, 'ok');
    assert.deepEqual(Array.from(decoded.big), [1, 2]);

    const bigEnc = new Encoder();
    bigEnc.writeBytes(1, new Uint8Array(300 * 1024));
    const bigRaw = bigEnc.finish();
    assert.throws(
      () =>
        spliceFields(bigRaw, 1 << 1, 2, () => {
          throw new Error('splice boom');
        }),
      /splice boom/,
    );
    const smallEnc = new Encoder();
    smallEnc.writeUint(1, 42);
    const spliced = spliceFields(smallEnc.finish(), 1 << 1, 2, (e, fn) => {
      if (fn === 1) e.writeUint(1, 99);
    });
    assert.equal(decodeBlind(spliced).field_1, 99);
  });

  it('preserves exact IEEE-754 binary32 float values in readTypedMap', () => {
    const expected = Math.fround(0.1);
    const enc = new Encoder();
    enc.writeTag(1, WireMap);
    enc.beginContainer();
    enc.writeByte(WireString);
    enc.writeByte(WireFloat32);
    enc.writeRawVarint(1);
    enc.writeRawStringPayload('f');
    const fbuf = new Uint8Array(4);
    new DataView(fbuf.buffer).setFloat32(0, expected, true);
    enc.writeRaw(fbuf);
    enc.endContainer();

    const [m, ok] = readTypedMap<number>(enc.finish(), 1, 'string', 'float32');
    assert.equal(ok, true);
    assert.equal(m['f'], expected);
    assert.notEqual(m['f'], 0.1);
  });
});

describe('@omnibuf/core - Tier 2 (@bufbuild/protobuf DescMessage) & Tier 3 (Decorators / defineMessage)', () => {
  it('marshals and unmarshals via @bufbuild/protobuf DescMessage (Tier 2)', () => {
    const desc: ProtobufDescMessage = {
      typeName: 'omnibuf.test.User',
      fields: [
        { number: 1, name: 'userId', protoName: 'user_id', fieldKind: 'scalar', scalar: 13 }, // UINT32
        { number: 2, name: 'email', protoName: 'email', fieldKind: 'scalar', scalar: 9 }, // STRING
        { number: 3, name: 'verified', protoName: 'verified', fieldKind: 'scalar', scalar: 8 }, // BOOL
        {
          number: 4,
          name: 'roles',
          protoName: 'roles',
          fieldKind: 'list',
          listKind: 'scalar',
          scalar: 9,
        }, // STRING[]
      ],
    };

    const input = {
      userId: 777,
      email: 'alice@example.com',
      verified: true,
      roles: ['admin', 'editor'],
    };

    const wire = marshalProto(desc, input, { selfDescribing: true });
    const decoded = unmarshalProto<typeof input>(desc, wire);
    expect(decoded).toEqual(input);

    const blind = decodeBlind(wire);
    expect(blind).toEqual({
      user_id: 777,
      email: 'alice@example.com',
      verified: true,
      roles: ['admin', 'editor'],
    });
  });

  it('marshals and unmarshals TypeScript classes with @omnibufMessage and @omnibufField decorators (Tier 3)', () => {
    class MetricPoint {
      metric = '';
      delta = 0;
      tags: Record<string, string> = {};
    }

    omnibufField(1, { type: 'string' })(MetricPoint.prototype, 'metric');
    omnibufField(2, { type: 'sint32' })(MetricPoint.prototype, 'delta');
    omnibufField(3, { type: 'map', mapKey: 'string', mapVal: 'string' })(
      MetricPoint.prototype,
      'tags',
    );
    omnibufMessage('MetricPoint')(MetricPoint);

    const pt = new MetricPoint();
    pt.metric = 'cpu.temp';
    pt.delta = -15;
    pt.tags = { host: 'srv-01', dc: 'fra1' };

    const bytes = marshalDeterministic(pt, { selfDescribing: true });
    const roundTripped = unmarshal(bytes, MetricPoint);
    expect(roundTripped).toBeInstanceOf(MetricPoint);
    expect(roundTripped.metric).toBe('cpu.temp');
    expect(roundTripped.delta).toBe(-15);
    expect(roundTripped.tags).toEqual({ dc: 'fra1', host: 'srv-01' });

    const json = decodeBlindJSON(bytes);
    expect(JSON.parse(json)).toEqual({
      metric: 'cpu.temp',
      delta: -15,
      tags: { dc: 'fra1', host: 'srv-01' },
    });
  });

  it('implements protobuf-es v2 Message<TypeName> structure ($typeName, $unknown, create, toBinary, fromBinary, mergeFromBinary, isMessage, clone, equals, clearField)', () => {
    interface Hop extends Message<'omnibuf.test.Hop'> {
      hopAsn: number;
      hop_asn?: number;
      routerName: string;
      router_name?: string;
    }
    const HopSchema = defineMessage<Hop, 'omnibuf.test.Hop'>('omnibuf.test.Hop', {
      hopAsn: { fieldNum: 1, name: 'hop_asn', type: 'uint32' },
      routerName: { fieldNum: 2, name: 'router_name', type: 'string' },
    });

    interface RouteAnnouncement extends Message<'omnibuf.test.RouteAnnouncement'> {
      prefix: string;
      originAsn: number;
      origin_asn?: number;
      med: bigint;
      communities: string[];
      attributes: Record<string, number>;
      nextHop: Hop | null;
      next_hop?: Hop | null;
      hops: Hop[];
    }
    const RouteAnnouncementSchema = defineMessage<
      RouteAnnouncement,
      'omnibuf.test.RouteAnnouncement'
    >('omnibuf.test.RouteAnnouncement', {
      prefix: { fieldNum: 1, type: 'string' },
      originAsn: { fieldNum: 2, name: 'origin_asn', type: 'uint32' },
      med: { fieldNum: 3, type: 'uint64', useBigInt: true },
      communities: { fieldNum: 4, type: 'string[]' },
      attributes: { fieldNum: 5, type: 'map', mapKey: 'string', mapVal: 'uint32' },
      nextHop: {
        fieldNum: 6,
        name: 'next_hop',
        type: 'submsg',
        optional: true,
        subSchema: () => HopSchema,
      },
      hops: { fieldNum: 7, type: 'submsg[]', subSchema: () => HopSchema },
    });

    // 1. create() sets $typeName, initializes defaults, and recursively creates sub-messages
    const msg = create(RouteAnnouncementSchema, {
      prefix: '10.128.0.0/16',
      originAsn: 64512,
      med: 100n,
      communities: ['64512:100'],
      attributes: { local_pref: 200 },
      nextHop: { hopAsn: 3356, routerName: 'edge-01' },
      hops: [{ hop_asn: 1299, router_name: 'core-02' }],
    });

    expect(msg.$typeName).toBe('omnibuf.test.RouteAnnouncement');
    expect(isMessage(msg)).toBe(true);
    expect(isMessage(msg, RouteAnnouncementSchema)).toBe(true);
    expect(isMessage(msg, HopSchema)).toBe(false);
    // create() returns an existing message instance directly without cloning (protobuf-es v2 behavior)
    expect(create(RouteAnnouncementSchema, msg)).toBe(msg);
    // Both camelCase (localName) and snake_case (.proto name) properties work seamlessly
    expect(msg.originAsn).toBe(64512);
    expect(msg.origin_asn).toBe(64512);
    expect(msg.nextHop?.$typeName).toBe('omnibuf.test.Hop');
    expect(msg.nextHop?.hopAsn).toBe(3356);
    expect(msg.nextHop?.hop_asn).toBe(3356);
    expect(msg.hops[0]?.hopAsn).toBe(1299);
    expect(msg.hops[0]?.routerName).toBe('core-02');

    // 2. toBinary() / fromBinary() round-trip with $unknown field retention
    const knownBytes = toBinary(RouteAnnouncementSchema, msg, { deterministic: true });
    const extraEnc = new Encoder();
    extraEnc.writeRaw(knownBytes);
    extraEnc.writeString(99, 'future-extension-field');
    extraEnc.writeUint(100, 424242);
    const packetWithUnknown = extraEnc.finish();

    const parsed = fromBinary(RouteAnnouncementSchema, packetWithUnknown);
    expect(parsed.$typeName).toBe('omnibuf.test.RouteAnnouncement');
    expect(parsed.med).toBe(100n);
    expect(parsed.$unknown?.length).toBe(2);
    expect(parsed.$unknown?.[0]?.no).toBe(99);
    expect(parsed.$unknown?.[1]?.no).toBe(100);

    // Re-serializing with toBinary() writes $unknown fields back by default
    const reserializedWithUnknown = toBinary(RouteAnnouncementSchema, parsed, {
      deterministic: true,
    });
    expect(readString(reserializedWithUnknown, 99)).toEqual(['future-extension-field', true]);
    expect(readUint(reserializedWithUnknown, 100)).toEqual([424242, true]);

    // writeUnknownFields: false omits $unknown fields
    const reserializedWithoutUnknown = toBinary(RouteAnnouncementSchema, parsed, {
      deterministic: true,
      writeUnknownFields: false,
    });
    expect(readString(reserializedWithoutUnknown, 99)).toEqual(['', false]);

    // 3. clone() and equals()
    const cloned = clone(RouteAnnouncementSchema, parsed);
    expect(equals(RouteAnnouncementSchema, parsed, cloned)).toBe(true);
    expect(equals(RouteAnnouncementSchema, parsed, cloned, { unknown: true })).toBe(true);
    cloned.communities.push('64512:200');
    expect(parsed.communities.length).toBe(1);
    expect(equals(RouteAnnouncementSchema, parsed, cloned)).toBe(false);

    // 4. mergeFromBinary() and clearField()
    const deltaEnc = new Encoder();
    deltaEnc.writeUint(2, 65001);
    deltaEnc.writeStringArr(4, ['65001:999']);
    const mergedTarget = clone(RouteAnnouncementSchema, msg);
    mergeFromBinary(RouteAnnouncementSchema, mergedTarget, deltaEnc.finish());
    expect(mergedTarget.originAsn).toBe(65001);
    expect(mergedTarget.communities).toEqual(['64512:100', '65001:999']);

    clearField(RouteAnnouncementSchema, mergedTarget, 'originAsn');
    expect(mergedTarget.originAsn).toBe(0);
  });

  it('returns independent Uint8Array buffers from Schema.encode and spliceFields without shared slab aliasing', () => {
    const ItemSchema = defineMessage<{ id: number; name: string }>('omnibuf.test.Item', {
      id: { fieldNum: 1, type: 'uint32' },
      name: { fieldNum: 2, type: 'string' },
    });

    const pkt1 = ItemSchema.encode({ id: 1, name: 'alpha' });
    const snapshot1 = Uint8Array.from(pkt1);
    const pkt2 = ItemSchema.encode({ id: 2, name: 'bravo-longer-payload' });
    expect(pkt1.buffer !== pkt2.buffer).toBe(true);
    pkt2.fill(0xff);
    expect(pkt1).toEqual(snapshot1);

    const spliced1 = spliceFields(pkt1, 1 << 2, 2, (enc) => {
      enc.writeString(2, 'alpha-v2');
    });
    const splicedSnapshot = Uint8Array.from(spliced1);
    const spliced2 = spliceFields(pkt1, 1 << 2, 2, (enc) => {
      enc.writeString(2, 'alpha-v3-extra-bytes');
    });
    expect(spliced1.buffer !== spliced2.buffer).toBe(true);
    spliced2.fill(0);
    expect(spliced1).toEqual(splicedSnapshot);
  });

  it('preserves aliased prefixes in spliceFields without modifying the source packet', () => {
    const pktEnc = new Encoder(64);
    pktEnc.writeUint(1, 42);
    pktEnc.writeUint(2, 99);
    const packet = pktEnc.finish();

    const appendDirty = (enc: Encoder, fnum: number): void => {
      enc.writeUint(fnum, 1n << 40n);
    };

    for (const maxField of [2, 40]) {
      for (const prefixLen of [0, 3, 32]) {
        const prefix = new Uint8Array(prefixLen).fill(0xa5);
        const storage = new Uint8Array(prefixLen + packet.byteLength + 512);
        storage.set(prefix, 0);
        storage.set(packet, prefixLen);

        const wantEnc = new Encoder(prefixLen + packet.byteLength + 64);
        wantEnc.writeRaw(prefix);
        const want = spliceFields(packet, 1 << 1, maxField, appendDirty, wantEnc);

        const aliasedEnc = new Encoder(storage, prefixLen);
        const rawSlice = storage.subarray(prefixLen, prefixLen + packet.byteLength);
        const got = spliceFields(rawSlice, 1 << 1, maxField, appendDirty, aliasedEnc);

        expect(got).toEqual(want);
        expect(rawSlice).toEqual(packet);
      }
    }
  });

  it('validates base64 input in base64ToUint8Array and rejects malformed strings', () => {
    expect(base64ToUint8Array('AQID')).toEqual(new Uint8Array([1, 2, 3]));
    assert.throws(() => base64ToUint8Array('ABC'), /invalid base64 string length/);
    assert.throws(() => base64ToUint8Array('AB$D'), /invalid base64 character/);
    assert.throws(() => base64ToUint8Array('A=CD'), /invalid base64/);
  });

  it('prevents DescriptorRegistry shortName collisions from overwriting earlier schemas', () => {
    const reg = new DescriptorRegistry({
      file: [
        {
          name: 'a.proto',
          package: 'pkg.a',
          messageType: [
            { name: 'Item', field: [{ name: 'a_val', number: 1, type: 'TYPE_UINT32' }] },
          ],
        },
        {
          name: 'b.proto',
          package: 'pkg.b',
          messageType: [
            { name: 'Item', field: [{ name: 'b_val', number: 1, type: 'TYPE_STRING' }] },
          ],
        },
      ],
    });
    expect(reg.getSchema('pkg.a.Item')?.typeName).toBe('pkg.a.Item');
    expect(reg.getSchema('pkg.b.Item')?.typeName).toBe('pkg.b.Item');
    expect(reg.getSchema('Item')?.typeName).toBe('pkg.a.Item');
  });

  it('overlays Field #0 schemas in decodeBlind without quadratic copying and supports empty-string field name masking', () => {
    // 1. Nested overlay merges (matching upstream TestBlindSchemaOverlayNestedMerges)
    const rootMeta: SchemaMeta = {
      typeName: 'test.Parent',
      fields: { 1: 'child' },
      children: {
        1: {
          typeName: 'test.ChildFromRoot',
          fields: {
            1: 'from_root',
            2: 'override_me',
            3: 'clear_me',
            4: 'nested',
          },
          children: {
            4: {
              typeName: 'test.GrandFromRoot',
              fields: { 1: 'grand_root', 2: 'grand_override' },
            },
          },
        },
      },
    };
    const childLocalMeta1: SchemaMeta = {
      fields: { 2: 'from_child_1', 3: '' },
      children: {
        4: { fields: { 2: 'grand_child_1', 3: 'grand_extra' } },
      },
    };
    const childLocalMeta2: SchemaMeta = {
      fields: { 2: 'from_child_2', 5: 'tail_only' },
    };

    const grandEnc = new Encoder(32);
    grandEnc.writeUint(1, 10);
    grandEnc.writeUint(2, 20);
    grandEnc.writeUint(3, 30);
    const grandBytes = grandEnc.finish();

    const childEnc = new Encoder(128);
    writeField0SchemaMeta(childEnc, childLocalMeta1, true);
    childEnc.writeUint(1, 1);
    childEnc.writeUint(2, 2);
    childEnc.writeUint(3, 3);
    childEnc.beginSubMsg(4);
    childEnc.writeRaw(grandBytes);
    childEnc.endSubMsg();
    childEnc.writeUint(5, 5);
    writeField0SchemaMeta(childEnc, childLocalMeta2, true);
    const childBytes = childEnc.finish();

    const pktEnc = new Encoder(256);
    writeField0SchemaMeta(pktEnc, rootMeta, true);
    pktEnc.beginSubMsg(1);
    pktEnc.writeRaw(childBytes);
    pktEnc.endSubMsg();

    const got = decodeBlind(pktEnc.finish());
    expect(got).toEqual({
      child: {
        from_root: 1,
        from_child_2: 2,
        field_3: 3,
        tail_only: 5,
        nested: {
          grand_root: 10,
          grand_child_1: 20,
          grand_extra: 30,
        },
      },
    });

    // 2. Shared 1,000-field schema across 2,000 submessages (with and without local Field #0 overrides)
    const childFields: Record<number, string> = {};
    for (let i = 1; i <= 1000; i++) {
      childFields[i] = `field_name_${i}`;
    }
    const largeRootMeta: SchemaMeta = {
      typeName: 'bench.Root',
      fields: { 2: 'items' },
      children: {
        2: {
          typeName: 'bench.Item',
          fields: childFields,
        },
      },
    };
    const localOverrideMeta: SchemaMeta = {
      fields: { 1001: 'local_extra' },
    };

    for (const withLocalOverride of [false, true]) {
      const enc = new Encoder(32768);
      writeField0SchemaMeta(enc, largeRootMeta, true);
      enc.beginSubMsgArr(2);
      for (let i = 0; i < 2000; i++) {
        enc.beginSubMsgElem();
        enc.writeUint(1, i);
        if (withLocalOverride) {
          writeField0SchemaMeta(enc, localOverrideMeta, true);
        }
        enc.endSubMsgElem();
      }
      enc.endSubMsgArr();
      const decoded = decodeBlind(enc.finish());
      const items = decoded.items as Array<Record<string, unknown>>;
      expect(items.length).toBe(2000);
      expect(items[0]?.field_name_1).toBe(0);
      expect(items[1999]?.field_name_1).toBe(1999);
    }
  });

  it('decodes heavily fragmented repeated fields in linear time without quadratic array reallocation', () => {
    const FragSchema = defineMessage<{
      floats: number[];
      u64s: bigint[];
      s64s: bigint[];
      strs: string[];
    }>('omnibuf.test.Frag', {
      floats: { fieldNum: 1, type: 'float32[]' },
      u64s: { fieldNum: 2, type: 'uint64[]', useBigInt: true },
      s64s: { fieldNum: 3, type: 'sint64[]', useBigInt: true },
      strs: { fieldNum: 4, type: 'string[]' },
    });

    const count = 2000;
    const enc = new Encoder(count * 32);
    for (let i = 0; i < count; i++) {
      enc.writeFloat32Arr(1, [1.5]);
      enc.writeUintArr(2, [i]);
      enc.writeSintArr(3, [-i]);
      enc.writeStringArr(4, ['x']);
    }
    const packet = enc.finish();

    const msg = FragSchema.decode(packet);
    expect(msg.floats.length).toBe(count);
    expect(msg.floats[0]).toBe(1.5);
    expect(msg.u64s.length).toBe(count);
    expect(msg.u64s[count - 1]).toBe(BigInt(count - 1));
    expect(msg.s64s.length).toBe(count);
    expect(msg.s64s[count - 1]).toBe(BigInt(-(count - 1)));
    expect(msg.strs.length).toBe(count);
  });

  it('sorts large deterministic maps with long common prefixes identically across Encoder and MessageSchema', () => {
    const MapHolderSchema = defineMessage<{ entries: Record<string, number> }>(
      'omnibuf.test.MapHolder',
      {
        entries: { fieldNum: 12, type: 'map', mapKey: 'string', mapVal: 'uint64' },
      },
    );
    const prefix = 'p'.repeat(2048);

    for (const n of [16, 17, 512]) {
      const entries: Record<string, number> = {};
      for (let i = n - 1; i >= 0; i--) {
        const key = `${prefix}:${String((i * 73) % n).padStart(6, '0')}`;
        entries[key] = i + 1;
      }

      const rawEnc = new Encoder(4096);
      rawEnc.writeMapStringUintDeterministic(12, entries);
      const rawBytes = rawEnc.finish();

      const schemaBytes = MapHolderSchema.encode({ entries }, { deterministic: true });
      expect(schemaBytes).toEqual(rawBytes);
    }
  });

  it('preserves __proto__ map keys as own properties across create(), clone(), encode(), and decode()', () => {
    const SubSchema = defineMessage<{ label: string }>('omnibuf.test.Sub', {
      label: { fieldNum: 1, type: 'string' },
    });
    const HolderSchema = defineMessage<{
      scalars: Record<string, number>;
      subs: Record<string, { label: string }>;
    }>('omnibuf.test.Holder', {
      scalars: { fieldNum: 1, type: 'map', mapKey: 'string', mapVal: 'uint32' },
      subs: {
        fieldNum: 2,
        type: 'map',
        mapKey: 'string',
        mapVal: 'submsg',
        subSchema: () => SubSchema,
      },
    });

    const rawScalars: Record<string, number> = {};
    Object.defineProperty(rawScalars, '__proto__', {
      value: 77,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const rawSubs: Record<string, { label: string }> = {};
    Object.defineProperty(rawSubs, '__proto__', {
      value: { label: 'safe-sub' },
      writable: true,
      enumerable: true,
      configurable: true,
    });

    const created = HolderSchema.create({ scalars: rawScalars, subs: rawSubs });
    expect(Object.getPrototypeOf(created.scalars)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(created.subs)).toBe(Object.prototype);
    expect(Object.hasOwn(created.scalars, '__proto__')).toBe(true);
    expect(Object.hasOwn(created.subs, '__proto__')).toBe(true);

    const cloned = HolderSchema.clone(created);
    expect(Object.getPrototypeOf(cloned.scalars)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(cloned.subs)).toBe(Object.prototype);
    expect(Object.hasOwn(cloned.scalars, '__proto__')).toBe(true);
    expect(Object.hasOwn(cloned.subs, '__proto__')).toBe(true);
    expect(
      (Object.getOwnPropertyDescriptor(cloned.subs, '__proto__')?.value as { label: string }).label,
    ).toBe('safe-sub');

    const decoded = HolderSchema.decode(HolderSchema.encode(cloned));
    expect(Object.getPrototypeOf(decoded.scalars)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(decoded.subs)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded.scalars, '__proto__')).toBe(true);
    expect(Object.hasOwn(decoded.subs, '__proto__')).toBe(true);
  });

  it('grows zero-length initial Encoder buffers safely and rejects malformed binary FileDescriptorSets', () => {
    const zeroEnc = new Encoder(new Uint8Array(0));
    zeroEnc.writeUint(1, 12345);
    zeroEnc.writeString(2, 'grown');
    const pkt = zeroEnc.finish();
    expect(readUint(pkt, 1)).toEqual([12345, true]);
    expect(readString(pkt, 2)).toEqual(['grown', true]);

    // Truncated length-delimited field in FileDescriptorSet
    assert.throws(
      () => parseBinaryFileDescriptorSet(new Uint8Array([0x0a, 0x50, 0x01, 0x02])),
      /truncated protobuf length-delimited field/,
    );
    // Varint overflow (>10 continuation bytes) in FileDescriptorSet
    assert.throws(
      () =>
        parseBinaryFileDescriptorSet(
          new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]),
        ),
      /protobuf varint overflow/,
    );
    // Truncated 64-bit wire type 1 field in FileDescriptorSet
    assert.throws(
      () => parseBinaryFileDescriptorSet(new Uint8Array([0x09, 0x01, 0x02, 0x03])),
      /truncated protobuf 64-bit field/,
    );
  });

  it('enforces Field #0 wire type, UTF-8 in readStringBytes, 32-bit int32[] coercion, bigint map keys, and custom string codecs', () => {
    // 1. Invalid Field #0 wire type (field 0, wireType 0) rejected by locateField, nextContainerField, readSubMsgMerged, activeOneofSlice, spliceFields
    const badField0 = new Uint8Array([0x01, 0x03, 0x21, 0x05]);
    expect(locateField(badField0, 1).ok).toBe(false);
    expect(nextContainerField(badField0, 0, 1, 12, 0).valid).toBe(false);
    expect(readSubMsgMerged(badField0, 1, () => ({}))[1]).toBe(false);
    expect(activeOneofSlice(badField0, 1, [[1, 1]])).toBe(null);
    assert.throws(() => spliceFields(badField0, 2, 2, () => {}), /invalid Field #0 wire type/);

    // 2. Invalid UTF-8 rejected by readStringBytes and readString
    const invalidUtf8Pkt = new Uint8Array([0x35, 0x03, 0xff]); // field #1 WireString (10), len=1, byte=0xff
    expect(readStringBytes(invalidUtf8Pkt, 1)[1]).toBe(false);
    expect(readString(invalidUtf8Pkt, 1)[1]).toBe(false);

    // 3. 32-bit coercion on int32[]/sint32[] and readUint32/readInt32
    const Int32ArrSchema = defineMessage<{ vals: number[] }>('test.Int32Arr', {
      vals: { fieldNum: 1, type: 'int32[]' },
    });
    const enc = new Encoder();
    enc.writeSintArr(1, [0x1_0000_0005n, -0x1_0000_0000n]);
    enc.writeUint(2, 0x1_0000_0007n);
    enc.writeInt(3, 0x1_0000_0009n);
    const coercePkt = enc.finish();
    const decodedArr = Int32ArrSchema.decode(coercePkt);
    expect(decodedArr.vals).toEqual([5, 0]);
    expect(readSint32Arr(coercePkt, 1)).toEqual([[5, 0], true]);
    expect(readUint32(coercePkt, 2)).toEqual([7, true]);
    expect(readInt32(coercePkt, 3)).toEqual([9, true]);

    // 4. useBigInt: true map keys decoded into ES Map as bigint
    const BigKeyMapSchema = defineMessage<{ m: Map<bigint, bigint> }>(
      'test.BigKeyMap',
      {
        m: { fieldNum: 1, type: 'map', mapKey: 'uint64', mapVal: 'uint64', useBigInt: true },
      },
      () => ({ m: new Map<bigint, bigint>() }),
    );
    const mapBytes = BigKeyMapSchema.encode({ m: new Map([[42n, 99n]]) });
    const decodedMap = BigKeyMapSchema.decode(mapBytes);
    expect(decodedMap.m.get(42n)).toBe(99n);
  });

  it('validates remaining container/packet bytes, concatenated counts, wrong-wire-type skips, and typed map headers in readers', () => {
    // 1. readElem must reject trailing bytes or truncated trailing elements after index
    const validArrBody = new Uint8Array([WireSubMsg, 0x05, 0x05, 0x21, 0x03, 0x05, 0x21, 0x05]); // count=2, two 2B submsgs
    expect(readElem(validArrBody, 0)).toEqual([new Uint8Array([0x21, 0x03]), true]);
    const trailingArrBody = new Uint8Array([
      WireSubMsg,
      0x05,
      0x05,
      0x21,
      0x03,
      0x05,
      0x21,
      0x05,
      0x99,
    ]);
    expect(readElem(trailingArrBody, 0)[1]).toBe(false);
    const truncatedSecondElem = new Uint8Array([WireSubMsg, 0x05, 0x05, 0x21, 0x03, 0x09, 0x21]);
    expect(readElem(truncatedSecondElem, 0)[1]).toBe(false);

    // 2. readSubMsgArrElem must reject corrupt trailing packet bytes and corrupt second concatenated segments
    const seg1Enc = new Encoder();
    seg1Enc.beginSubMsgArr(11);
    seg1Enc.beginSubMsgElem();
    seg1Enc.writeUint(1, 10);
    seg1Enc.endSubMsgElem();
    seg1Enc.endSubMsgArr();
    const seg1 = seg1Enc.finish();
    expect(readSubMsgArrElem(seg1, 11, 0)[1]).toBe(true);
    const corruptTailPkt = concatMessages(seg1, new Uint8Array([0x55])); // truncated WireString
    expect(readSubMsgArrElem(corruptTailPkt, 11, 0)[1]).toBe(false);
    const badSeg2 = new Uint8Array([0xba, 0x02, 0x09, WireSubMsg, 0x03, 0x13, 0x21]); // field 11 WireArray(WireSubMsg), count=1, elem ByteLen=9 > remaining
    // Fix tag to field 11 ((11<<4)|13 = 189 -> 2-byte prefix varint: (189<<2)|2 = 758 = 0xf6, 0x02)
    badSeg2[0] = 0xf6;
    badSeg2[1] = 0x02;
    expect(readSubMsgArrElem(concatMessages(seg1, badSeg2), 11, 0)[1]).toBe(false);

    // 3. countedArrLen must sum across concatenated WireArray occurrences and check WireArray elemType
    const arrA = new Encoder();
    arrA.writeUintArr(10, [1, 2]);
    const arrB = new Encoder();
    arrB.writeUintArr(10, [3, 4, 5]);
    const concatArr = concatMessages(arrA.finish(), arrB.finish());
    expect(countedArrLen(concatArr, 10, WireUint)).toBe(5);
    expect(countedArrLen(concatArr, 10, WireArray)).toBe(0);

    // 4. Scalar, container, and merged submsg readers must skip known field numbers with mismatched wire types
    const baseEnc = new Encoder();
    baseEnc.writeUint(1, 11);
    baseEnc.writeBool(5, true);
    baseEnc.writeString(6, 'keep');
    baseEnc.beginSubMsg(8);
    baseEnc.writeUint(1, 77);
    baseEnc.endSubMsg();
    baseEnc.writeStringArr(9, ['a']);
    const basePkt = baseEnc.finish();

    const wrongWtEnc = new Encoder();
    wrongWtEnc.writeString(1, 'wrong');
    wrongWtEnc.writeUint(5, 0);
    wrongWtEnc.writeBytes(6, new Uint8Array([0xff]));
    wrongWtEnc.writeBytes(8, new Uint8Array(0));
    wrongWtEnc.writeString(9, 'wrong-arr');
    const mixedPkt = concatMessages(basePkt, wrongWtEnc.finish());

    expect(readUint32(mixedPkt, 1)).toEqual([11, true]);
    expect(readBool(mixedPkt, 5)).toEqual([true, true]);
    expect(readString(mixedPkt, 6)).toEqual(['keep', true]);
    expect(readSubMsg(mixedPkt, 8)[1]).toBe(true);
    expect(readSubMsgMerged(mixedPkt, 8, (sub) => ({ id: readUint32(sub, 1)[0] }))).toEqual([
      { id: 77 },
      true,
    ]);
    expect(readStringArr(mixedPkt, 9)).toEqual([['a'], true]);

    const oneofSlice = activeOneofSlice(mixedPkt, 1, [
      [1, 1 << WireUint],
      [2, 1 << WireString],
    ]);
    expect(oneofSlice !== null && readUint32(oneofSlice, 1)[0]).toBe(11);

    // 5. readTypedMap must enforce keyWT/valWT, preserve low 32 bits of >2^53 sint values, and return [{}, false] on corrupt bytes
    const uintStrMapEnc = new Encoder();
    uintStrMapEnc.writeTag(12, WireMap);
    uintStrMapEnc.beginContainer();
    uintStrMapEnc.writeByte(WireUint);
    uintStrMapEnc.writeByte(WireString);
    uintStrMapEnc.writeRawVarint(1);
    uintStrMapEnc.writeRawVarint(1);
    uintStrMapEnc.writeRawStringPayload('wrong-types');
    uintStrMapEnc.endContainer();
    expect(readTypedMap(uintStrMapEnc.finish(), 12, 'string', 'uint64')).toEqual([{}, false]);

    const bigInt32MapEnc = new Encoder();
    bigInt32MapEnc.writeTag(12, WireMap);
    bigInt32MapEnc.beginContainer();
    bigInt32MapEnc.writeByte(WireString);
    bigInt32MapEnc.writeByte(WireSint);
    bigInt32MapEnc.writeRawVarint(1);
    bigInt32MapEnc.writeRawStringPayload('k');
    bigInt32MapEnc.writeRawVarint(encodeZigZag((1n << 54n) + 7n));
    bigInt32MapEnc.endContainer();
    expect(readTypedMap(bigInt32MapEnc.finish(), 12, 'string', 'int32')).toEqual([{ k: 7 }, true]);

    // 6. Invalid UTF-8 or corrupt inner submessages must return [default, false] without throwing
    const badStrArrPkt = new Uint8Array([0xba, 0x02, 0x09, WireString, 0x03, 0x03, 0xff]); // field 9 WireArray(WireString), count=1, [0xff]
    expect(readStringArr(badStrArrPkt, 9)).toEqual([[], false]);
    const badMapUtf8Pkt = new Uint8Array([
      0xc5,
      0x03,
      0x0d,
      WireString,
      WireUint,
      0x03,
      0x03,
      0xff,
      0x03,
    ]); // field 12 WireMap(str,uint), key=[0xff]
    expect(lookupMapStringUint(badMapUtf8Pkt, 12, 'a')).toEqual([0, false]);
    expect(readTypedMap(badMapUtf8Pkt, 12, 'string', 'uint64')).toEqual([{}, false]);
    expect(
      readSubMsgMerged(basePkt, 8, () => {
        throw new Error('corrupt inner');
      }),
    ).toEqual([null, false]);
    expect(
      readSubMsgArrDecoded(seg1, 11, () => {
        throw new Error('corrupt elem');
      }),
    ).toEqual([[], false]);

    // 7. parseArrayHeader and parseMapHeader must honor explicit end < body.length on 4B count varints
    const paddedArrHeader = new Uint8Array([WireUint, 0x04, 0x00, 0x00, 0x00]); // 4B count=0 (5 bytes total)
    expect(parseArrayHeader(paddedArrHeader, 0, 3)[3]).toBe(false);
    const paddedMapHeader = new Uint8Array([WireString, WireUint, 0x04, 0x00, 0x00, 0x00]); // 4B count=0 (6 bytes total)
    expect(parseMapHeader(paddedMapHeader, 0, 4)[4]).toBe(false);

    // 8. Empty variable-width WireArray and WireMap (count=0) must reject trailing bytes across headers and scanners
    const emptyArrWithTrailing = new Uint8Array([WireString, 0x01, 0xaa]); // count=0 + 1 trailing byte
    expect(parseArrayHeader(emptyArrWithTrailing)[3]).toBe(false);
    const emptyMapWithTrailing = new Uint8Array([WireString, WireUint, 0x01, 0xaa]); // count=0 + 1 trailing byte
    expect(parseMapHeader(emptyMapWithTrailing)[4]).toBe(false);
    // Unknown WireArray/WireMap with count=0 + trailing byte followed by field #1 uint=5 must be rejected by locateField / spliceFields
    const badEmptyArrPkt = new Uint8Array([0x9b, 0x07, WireString, 0x01, 0xaa, 0x21, 0x0b]);
    expect(locateField(badEmptyArrPkt, 1).ok).toBe(false);
    assert.throws(() => spliceFields(badEmptyArrPkt, 2, 2, () => {}), /invalid array header/);
    const badEmptyMapPkt = new Uint8Array([
      0x9d,
      0x09,
      WireString,
      WireUint,
      0x01,
      0xaa,
      0x21,
      0x0b,
    ]);
    expect(locateField(badEmptyMapPkt, 1).ok).toBe(false);
    assert.throws(() => spliceFields(badEmptyMapPkt, 2, 2, () => {}), /invalid map header/);
  });

  it('prevents __proto__ prototype pollution and field loss in MessageSchema and DescriptorRegistry', () => {
    const ChildSchema = defineMessage<{ polluted: string }>('omnibuf.test.PolluteChild', {
      polluted: { fieldNum: 1, type: 'string' },
    });

    // JSON-parsed field spec map where '__proto__' is an own enumerable key
    const jsonSpecs = JSON.parse('{"__proto__": {"fieldNum": 1, "type": "submsg"}}');
    Object.getOwnPropertyDescriptor(jsonSpecs, '__proto__')!.value.subSchema = () => ChildSchema;
    const DangerousSubSchema = defineMessage<Record<string, unknown>>(
      'omnibuf.test.DangerousSub',
      jsonSpecs,
    );

    const enc = new Encoder();
    enc.beginSubMsg(1);
    enc.writeString(1, 'pwned');
    enc.endSubMsg();
    const subPkt = enc.finish();

    try {
      const decoded = DangerousSubSchema.decode(subPkt);
      expect(({} as Record<string, unknown>).polluted).toBe(undefined);
      expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
      expect(Object.hasOwn(decoded, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(decoded, '__proto__')?.value.polluted).toBe('pwned');

      const cloned = DangerousSubSchema.clone(decoded);
      expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(cloned, '__proto__')?.value.polluted).toBe('pwned');

      const reEncoded = DangerousSubSchema.encode(cloned);
      const decodedAgain = DangerousSubSchema.decode(reEncoded);
      expect(Object.getOwnPropertyDescriptor(decodedAgain, '__proto__')?.value.polluted).toBe(
        'pwned',
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }

    // Also test WireMap field named '__proto__' with merge: true (cannot pollute Object.prototype)
    const jsonMapSpecs = JSON.parse(
      '{"__proto__": {"fieldNum": 1, "type": "map", "mapKey": "string", "mapVal": "string"}}',
    );
    const DangerousMapSchema = defineMessage<Record<string, unknown>>(
      'omnibuf.test.DangerousMap',
      jsonMapSpecs,
    );
    const mapEnc = new Encoder();
    mapEnc.writeTag(1, WireMap);
    mapEnc.beginContainer();
    mapEnc.writeByte(WireString);
    mapEnc.writeByte(WireString);
    mapEnc.writeRawVarint(1);
    mapEnc.writeRawStringPayload('pollutedMapKey');
    mapEnc.writeRawStringPayload('bad');
    mapEnc.endContainer();
    const mapPkt = mapEnc.finish();
    try {
      const mergedMap = DangerousMapSchema.decode(mapPkt, undefined, 0, { merge: true });
      expect(({} as Record<string, unknown>).pollutedMapKey).toBe(undefined);
      expect(Object.getPrototypeOf(mergedMap)).toBe(Object.prototype);
      expect(Object.hasOwn(mergedMap, '__proto__')).toBe(true);
      expect(Object.getOwnPropertyDescriptor(mergedMap, '__proto__')?.value.pollutedMapKey).toBe(
        'bad',
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).pollutedMapKey;
    }

    // DescriptorRegistry with a .proto field named '__proto__' must preserve it instead of dropping it
    const reg = new DescriptorRegistry({
      file: [
        {
          name: 'proto_field.proto',
          package: 'omnibuf.test',
          syntax: 'proto3',
          messageType: [
            {
              name: 'ProtoFieldMsg',
              field: [
                { name: '__proto__', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                { name: 'constructor', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
              ],
            },
          ],
        },
      ],
    });
    const regSchema = reg.getSchemaOrThrow('omnibuf.test.ProtoFieldMsg');
    expect(regSchema.getField(1)?.name).toBe('__proto__');
    expect(regSchema.getField(2)?.name).toBe('constructor');
    const regCreated = regSchema.create({});
    expect(Object.getPrototypeOf(regCreated)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(regCreated, '__proto__')?.value).toBe('');
    expect(Object.getOwnPropertyDescriptor(regCreated, 'constructor')?.value).toBe('');
  });

  it('grows Encoder container stacks, rejects invalid Field #0 tags/keys, short-circuits empty mergeSchemaMeta, and splices max field numbers in O(1)', () => {
    // 1. Deep container nesting (>80 levels) dynamically grows lenStack and elemCountStack
    const deepEnc = new Encoder();
    const levels = 90;
    for (let i = 0; i < levels; i++) {
      deepEnc.beginSubMsg(1);
    }
    deepEnc.writeUint(1, 42);
    for (let i = 0; i < levels; i++) {
      deepEnc.endSubMsg();
    }
    const deepPkt = deepEnc.finish();
    expect(deepPkt.length > levels * 3).toBe(true);

    // 2. Encoder.writeTag rejects non-WireSubMsg on Field #0 and out-of-range wire types
    const tagEnc = new Encoder();
    assert.throws(() => tagEnc.writeTag(0, WireUint), /Field #0/);
    assert.throws(() => tagEnc.writeTag(1, 16), /wire type/);
    assert.throws(() => tagEnc.writeTag(1, -1), /wire type/);

    // 3. encodeField0SchemaMeta rejects invalid field numbers in fields/children maps
    assert.throws(() => encodeField0SchemaMeta({ fields: { 0: 'bad' } }), /field number/);
    assert.throws(
      () => encodeField0SchemaMeta({ children: { 0: { typeName: 'Bad' } } }),
      /field number/,
    );

    // 4. mergeSchemaMeta short-circuits empty SchemaMeta overlays without cloning base maps
    const baseFields: Record<number, string> = {};
    for (let i = 1; i <= 500; i++) baseFields[i] = `f_${i}`;
    const baseMeta = { typeName: 'Big', fields: baseFields };
    expect(mergeSchemaMeta(baseMeta, {})).toBe(baseMeta);

    // 10,000 empty Field #0 blocks after a 500-field Field #0 block must decodeBlind in < 150ms
    const f0Initial = encodeField0SchemaMeta(baseMeta);
    const emptyCount = 10000;
    const spamPkt = new Uint8Array(f0Initial.length + emptyCount * 2 + 2);
    spamPkt.set(f0Initial, 0);
    for (let i = 0; i < emptyCount; i++) {
      spamPkt[f0Initial.length + i * 2] = 0x19;
      spamPkt[f0Initial.length + i * 2 + 1] = 0x01;
    }
    spamPkt[spamPkt.length - 2] = 0x21; // field #1 WireUint
    spamPkt[spamPkt.length - 1] = 0x0f; // value 7
    const t0 = performance.now();
    const blindOut = decodeBlind(spamPkt);
    expect(performance.now() - t0 < 250).toBe(true);
    expect(blindOut.f_1).toBe(7);

    // 5. spliceFields supports Set<number> dirty sets at max field number 536870911 and sparse bigint masks in O(1)
    const highEnc = new Encoder();
    highEnc.writeUint(1, 10);
    highEnc.writeString(536870911, 'old-max');
    const highRaw = highEnc.finish();
    const splicedMax = spliceFields(highRaw, new Set([536870911]), 536870911, (e, fn) => {
      if (fn === 536870911) e.writeString(536870911, 'new-max');
    });
    expect(readUint(splicedMax, 1)).toEqual([10, true]);
    expect(readString(splicedMax, 536870911)).toEqual(['new-max', true]);

    const splicedBigInt = spliceFields(highRaw, 1n << 50000n, 50000, (e, fn) => {
      if (fn === 50000) e.writeUint(50000, 999);
    });
    expect(readUint(splicedBigInt, 50000)).toEqual([999, true]);
  });

  it('enforces Spec §10 container nesting depth, 64-bit vs 32-bit ZigZag semantics, reserved field numbers, proto2 rules, and defensive copies', () => {
    // 1. Spec §10 nesting depth: array/map containers at depth+1, submsg elements at depth+2
    const LeafSchema = defineMessage<{ vals: number[]; labels: Record<string, number> }>(
      'test.Leaf',
      {
        vals: { fieldNum: 1, type: 'uint32[]' },
        labels: { fieldNum: 2, type: 'map', mapKey: 'string', mapVal: 'uint32' },
      },
    );
    const NodeSchema: ReturnType<typeof defineMessage<Record<string, unknown>>> = defineMessage(
      'test.Node',
      {
        id: { fieldNum: 1, type: 'uint32' },
        next: { fieldNum: 2, type: 'submsg', optional: true, subSchema: () => NodeSchema },
        leaf: { fieldNum: 3, type: 'submsg', optional: true, subSchema: () => LeafSchema },
        children: { fieldNum: 4, type: 'submsg[]', subSchema: () => NodeSchema },
      },
    );

    // Build chain of depth 32 with a scalar array at leaf (container depth 33 > 32)
    let deepArrNode: Record<string, unknown> = {
      id: 99,
      next: null,
      leaf: { vals: [1], labels: {} },
      children: [],
    };
    for (let i = 0; i < 31; i++) {
      deepArrNode = { id: i + 1, next: deepArrNode, leaf: null, children: [] };
    }
    // Root (0) -> 31 next hops (31) -> leaf submsg (32) -> vals WireArray (33 > 32)
    const deepArrPkt = NodeSchema.encode(deepArrNode);
    assert.throws(() => NodeSchema.decode(deepArrPkt), /nesting depth/);
    assert.throws(() => decodeBlind(deepArrPkt), /nesting depth/);

    // Unknown field validation at depth 32 containing WireArray (container depth 33 > 32)
    const EmptyRoot = defineMessage<Record<string, never>>('test.EmptyRoot', {});
    assert.throws(() => EmptyRoot.decode(deepArrPkt), /nesting depth/);

    // Submsg inside WireArray increments by +2 (array at d+1, elem at d+2)
    // At recursionLimit = 1: root (0) -> children WireArray (1) -> child Node submsg (2 > 1) must reject!
    const oneChildPkt = NodeSchema.encode({
      id: 1,
      next: null,
      leaf: null,
      children: [{ id: 2, next: null, leaf: null, children: [] }],
    });
    assert.throws(
      () => NodeSchema.decode(oneChildPkt, undefined, 0, { recursionLimit: 1 }),
      /nesting depth/,
    );

    // SchemaMeta children map enforces MaxNestingDepth across nested schemas and maps
    let deepMeta: SchemaMeta = { typeName: 'Leaf', fields: { 1: 'x' } };
    for (let i = 0; i < 33; i++) {
      deepMeta = { typeName: `M${i}`, children: { 1: deepMeta } };
    }
    assert.throws(() => encodeField0SchemaMeta(deepMeta), /nesting depth/);

    // Manually craft a raw >MaxNestingDepth Field #0 packet to verify decodeBlind & readField0SchemaMeta reject it
    const rawDeepEnc = new Encoder();
    rawDeepEnc.writeByte(0x19); // Field #0, WireSubMsg
    rawDeepEnc.beginContainer();
    for (let i = 0; i < 17; i++) {
      rawDeepEnc.writeByte(0x7d); // Field #3 (children), WireMap
      rawDeepEnc.beginContainer();
      rawDeepEnc.writeByte(WireUint);
      rawDeepEnc.writeByte(WireSubMsg);
      rawDeepEnc.writeRawVarint(1);
      rawDeepEnc.writeRawVarint(1);
      rawDeepEnc.beginContainer();
    }
    rawDeepEnc.writeByte(0x35); // Field #1 (type_name), WireString
    rawDeepEnc.writeRawStringPayload('Leaf');
    for (let i = 0; i < 17; i++) {
      rawDeepEnc.endContainer(); // child SchemaMeta
      rawDeepEnc.endContainer(); // children WireMap
    }
    rawDeepEnc.endContainer(); // Field #0
    const deepField0 = rawDeepEnc.finish();
    assert.throws(() => decodeBlind(deepField0), /nesting depth/);
    expect(readField0SchemaMeta(deepField0)[1]).toBe(false);

    // 2. decodeZigZag preserves full float64 range (> 2^53) while readInt32 / int32 schema wraps low 32 bits accurately
    const bigSigned = (1n << 54n) + 5n; // > MAX_SAFE_INTEGER; low 32 bits = 5
    const zzBig = encodeZigZag(bigSigned);
    expect(decodeZigZag(zzBig)).toBe(Number(bigSigned));
    const zzEnc = new Encoder();
    zzEnc.writeTag(1, WireSint);
    zzEnc.writeRawVarint(zzBig);
    const zzPkt = zzEnc.finish();
    expect(readInt32(zzPkt, 1)).toEqual([5, true]);
    const Int32Single = defineMessage<{ v: number }>('test.Int32Single', {
      v: { fieldNum: 1, type: 'int32' },
    });
    expect(Int32Single.decode(zzPkt).v).toBe(5);

    // 3. Reserved Protobuf field numbers 19000..19999 rejected
    assert.throws(
      () => defineMessage('test.Reserved', { bad: { fieldNum: 19000, type: 'uint32' } }),
      /reserved/,
    );
    assert.throws(
      () => defineMessage('test.ReservedEnd', { bad: { fieldNum: 19999, type: 'uint32' } }),
      /reserved/,
    );

    // 4. Proto2 explicit presence, TYPE_GROUP rejection, and extension rejection in DescriptorRegistry
    const proto2Reg = new DescriptorRegistry({
      file: [
        {
          name: 'p2.proto',
          package: 'p2',
          syntax: 'proto2',
          messageType: [
            {
              name: 'Config',
              field: [{ name: 'port', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' }],
            },
          ],
        },
      ],
    });
    const p2Schema = proto2Reg.getSchemaOrThrow('p2.Config');
    expect(p2Schema.create().port).toBe(undefined);
    const p2ZeroBytes = p2Schema.encode({ port: 0 });
    expect(p2ZeroBytes.length > 0).toBe(true);
    expect(p2Schema.decode(new Uint8Array(0)).port).toBe(undefined);
    expect(p2Schema.decode(p2ZeroBytes).port).toBe(0);

    assert.throws(
      () =>
        new DescriptorRegistry({
          file: [
            {
              name: 'grp.proto',
              syntax: 'proto2',
              messageType: [
                {
                  name: 'WithGroup',
                  field: [{ name: 'g', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_GROUP' }],
                },
              ],
            },
          ],
        }),
      /TYPE_GROUP|group/i,
    );

    assert.throws(
      () =>
        new DescriptorRegistry({
          file: [
            {
              name: 'ext.proto',
              syntax: 'proto2',
              extension: [
                { name: 'ext_f', number: 100, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
              ],
              messageType: [{ name: 'Base', field: [] }],
            },
          ],
        }),
      /extension/i,
    );

    // 5. NaN equals NaN, getField0Bytes returns defensive copy, target decode clears stale altKey, decodeBlindJSON empty pretty object
    const FloatSchema = defineMessage<{ f: number; userName: string }>('test.FloatMsg', {
      f: { fieldNum: 1, type: 'float64' },
      userName: { fieldNum: 2, name: 'user_name', type: 'string' },
    });
    expect(
      FloatSchema.equals(
        FloatSchema.create({ f: Number.NaN, userName: 'a' }),
        FloatSchema.create({ f: Number.NaN, userName: 'a' }),
      ),
    ).toBe(true);

    const f0Copy = FloatSchema.getField0Bytes(true);
    const origByte0 = f0Copy[0]!;
    f0Copy[0] = 0xff;
    expect(FloatSchema.getField0Bytes(true)[0]).toBe(origByte0);

    const dirtyTarget = { f: 1, userName: 'old', user_name: 'stale-snake' } as {
      f: number;
      userName: string;
      user_name?: string;
    };
    FloatSchema.decode(FloatSchema.encode({ f: 2, userName: 'fresh' }), dirtyTarget);
    expect(Object.hasOwn(dirtyTarget, 'user_name')).toBe(false);

    expect(decodeBlindJSON(new Uint8Array(0), { indent: 2 })).toBe('{}');
  });

  it('supports >16 KiB container backpatch heuristic with bit-for-bit wire equivalence and zeroCopy bytes decode', () => {
    // 1. >16 KiB container backpatch heuristic matches 2B-reserved expansion bit-for-bit
    const bigPayload = new Uint8Array(20_000);
    for (let i = 0; i < bigPayload.length; i++) bigPayload[i] = i & 0xff;

    const encHeuristic = new Encoder(24_000);
    encHeuristic.beginSubMsg(1, 20_000);
    encHeuristic.writeBytes(1, bigPayload);
    encHeuristic.endSubMsg();
    const heuristicBytes = encHeuristic.finish();

    const encDefault = new Encoder(24_000);
    encDefault.beginSubMsg(1);
    encDefault.writeBytes(1, bigPayload);
    encDefault.endSubMsg();
    const defaultBytes = encDefault.finish();

    expect(heuristicBytes).toEqual(defaultBytes);

    // Defensive shrink when caller overestimates minBodyBytes > 16383 for a small payload
    const encOver = new Encoder(256);
    encOver.beginSubMsg(1, 20_000);
    encOver.writeString(1, 'small');
    encOver.endSubMsg();
    const encSmall = new Encoder(256);
    encSmall.beginSubMsg(1);
    encSmall.writeString(1, 'small');
    encSmall.endSubMsg();
    expect(encOver.finish()).toEqual(encSmall.finish());

    // Large fixed32 array (>16 KiB) uses 4B container slot and round-trips cleanly
    const fixed32Items = new Array<number>(5000);
    for (let i = 0; i < fixed32Items.length; i++) fixed32Items[i] = (i * 2654435761) >>> 0;
    const arrEnc = new Encoder();
    arrEnc.writeFixed32Arr(2, fixed32Items);
    const arrWire = arrEnc.finish();
    const ArrSchema = defineMessage<{ vals: number[] }>('test.LargeFixed32Arr', {
      vals: { fieldNum: 2, type: 'fixed32[]' },
    });
    expect(ArrSchema.decode(arrWire).vals).toEqual(fixed32Items);

    // 2. Zero-copy { zeroCopy: true } decode returns Uint8Array.subarray views into the input buffer
    const BytesSchema = defineMessage<{
      single: Uint8Array;
      list: Uint8Array[];
      dict: Record<string, Uint8Array>;
    }>('test.ZeroCopyBytes', {
      single: { fieldNum: 1, type: 'bytes' },
      list: { fieldNum: 2, type: 'bytes[]' },
      dict: { fieldNum: 3, type: 'map', mapKey: 'string', mapVal: 'bytes' },
    });
    const wire = BytesSchema.encode({
      single: new Uint8Array([1, 2, 3, 4]),
      list: [new Uint8Array([10, 20]), new Uint8Array([30, 40])],
      dict: { k: new Uint8Array([99, 100]) },
    });

    const copied = BytesSchema.decode(wire);
    assert.notEqual(copied.single.buffer, wire.buffer);
    assert.notEqual(copied.list[0]!.buffer, wire.buffer);
    assert.notEqual(copied.dict['k']!.buffer, wire.buffer);

    const viewed = BytesSchema.decode(wire, undefined, 0, { zeroCopy: true });
    expect(viewed.single.buffer).toBe(wire.buffer);
    expect(viewed.list[0]!.buffer).toBe(wire.buffer);
    expect(viewed.dict['k']!.buffer).toBe(wire.buffer);
    expect(Array.from(viewed.single)).toEqual([1, 2, 3, 4]);
    expect(Array.from(viewed.list[1]!)).toEqual([30, 40]);
    expect(Array.from(viewed.dict['k']!)).toEqual([99, 100]);
  });

  it('decodes absent proto3 sub-messages as null and omits null on encode in DescriptorRegistry', () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'outer.proto',
          package: 'test.proto3sub',
          syntax: 'proto3',
          messageType: [
            {
              name: 'Inner',
              field: [{ name: 'val', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' }],
            },
            {
              name: 'Outer',
              field: [
                {
                  name: 'sub',
                  number: 1,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_MESSAGE',
                  typeName: '.test.proto3sub.Inner',
                },
              ],
            },
          ],
        },
      ],
    };

    const registry = new DescriptorRegistry(fds);
    const decoded = registry.decode('test.proto3sub.Outer', new Uint8Array(0));
    assert.equal(
      decoded.sub ?? null,
      null,
      `Expected absent proto3 sub-message to decode as null/undefined, got ${JSON.stringify(decoded.sub)}`,
    );

    const encoded = registry.encode('test.proto3sub.Outer', { sub: null });
    assert.equal(
      encoded.byteLength,
      0,
      `Expected encoding { sub: null } to produce 0 bytes, got ${encoded.byteLength} bytes`,
    );
  });

  it('resolves package-relative sub-message typeName without a leading dot in DescriptorRegistry', () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'relative.proto',
          package: 'test.proto3sub.rel',
          syntax: 'proto3',
          messageType: [
            {
              name: 'Inner',
              field: [{ name: 'val', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' }],
            },
            {
              name: 'Outer',
              field: [
                {
                  name: 'sub',
                  number: 1,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_MESSAGE',
                  typeName: 'Inner',
                },
              ],
            },
          ],
        },
      ],
    };

    const registry = new DescriptorRegistry(fds);
    const encoded = registry.encode('test.proto3sub.rel.Outer', { sub: { val: 42 } });
    assert.ok(encoded.byteLength > 0, 'Expected relative typeName sub-message to be encoded');
    const decoded = registry.decode('test.proto3sub.rel.Outer', encoded);
    assert.equal((decoded.sub as { val?: number } | undefined)?.val, 42);
  });

  it('preserves exact UINT64_MAX decimal strings without wrapping to 0n', () => {
    const U64Msg = defineMessage<{ u: bigint | string; f: bigint | string }>('test.U64Msg', {
      u: { fieldNum: 1, type: 'uint64', useBigInt: true },
      f: { fieldNum: 2, type: 'fixed64', useBigInt: true },
    });

    const wire = U64Msg.encode({
      u: '18446744073709551615',
      f: '18446744073709551615',
    });
    const decoded = U64Msg.decode(wire);
    assert.equal(decoded.u, 18446744073709551615n);
    assert.equal(decoded.f, 18446744073709551615n);

    const varintBuf = new Uint8Array(16);
    writeVarintAt(varintBuf, 0, '18446744073709551615' as unknown as bigint);
    const [v] = decodeVarintBigInt(varintBuf, 0);
    assert.equal(v, 18446744073709551615n);
  });

  it('preserves exact INT64_MIN + 1 decimal strings without IEEE-754 rounding', () => {
    const I64Msg = defineMessage<{
      i: bigint | string;
      s: bigint | string;
      sf: bigint | string;
    }>('test.I64Msg', {
      i: { fieldNum: 1, type: 'int64', useBigInt: true },
      s: { fieldNum: 2, type: 'sint64', useBigInt: true },
      sf: { fieldNum: 3, type: 'sfixed64', useBigInt: true },
    });

    const wire = I64Msg.encode({
      i: '-9223372036854775807',
      s: '-9223372036854775807',
      sf: '-9223372036854775807',
    });
    const decoded = I64Msg.decode(wire);
    assert.equal(decoded.i, -9223372036854775807n);
    assert.equal(decoded.s, -9223372036854775807n);
    assert.equal(decoded.sf, -9223372036854775807n);
  });

  it('preserves exact IEEE-754 binary32 float32 values in MessageSchema decode', () => {
    const FloatSchema = defineMessage<{ f13Float32: number }>('test.Float32ExactMsg', {
      f13Float32: { fieldNum: 13, type: 'float32' },
    });
    const expected = Math.fround(0.1);
    const bytes = FloatSchema.encode({ f13Float32: expected });

    assert.equal(readFloat32(bytes, 13)[0], expected);
    const decoded = FloatSchema.decode(bytes);
    assert.equal(decoded.f13Float32, expected);
  });

  it('isolates subclass @omnibufField Stage 3 decorators from superclass schemas', () => {
    abstract class AbstractGuard {
      constructor() {
        if (new.target === Base) {
          throw new Error('Base cannot be instantiated without arguments');
        }
      }
    }

    class Base extends AbstractGuard {
      @omnibufField(1, { type: 'uint32' })
      baseId = 0;
    }

    class Sub extends Base {
      @omnibufField(2, { type: 'string' })
      subLabel = '';
    }

    const baseSchema = getClassSchema(Base);
    const subSchema = getClassSchema(Sub);
    assert.ok(baseSchema, 'Expected Base schema to be resolved');
    assert.ok(subSchema, 'Expected Sub schema to be resolved');

    const baseFieldNums = baseSchema.fields.map((f) => f.fieldNum);
    assert.deepEqual(
      baseFieldNums,
      [1],
      `Expected Base schema not to acquire Sub field #2, got fields [${baseFieldNums.join(', ')}]`,
    );
  });

  it('preserves useBigInt on message-valued maps in DescriptorRegistry', () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'map_bigint.proto',
          package: 'test.mapbi',
          syntax: 'proto3',
          messageType: [
            {
              name: 'Val',
              field: [{ name: 'n', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' }],
            },
            {
              name: 'Holder',
              field: [
                {
                  name: 'items',
                  number: 1,
                  label: 'LABEL_REPEATED',
                  type: 'TYPE_MESSAGE',
                  typeName: '.test.mapbi.Holder.ItemsEntry',
                },
              ],
              nestedType: [
                {
                  name: 'ItemsEntry',
                  options: { mapEntry: true },
                  field: [
                    { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT64' },
                    {
                      name: 'value',
                      number: 2,
                      label: 'LABEL_OPTIONAL',
                      type: 'TYPE_MESSAGE',
                      typeName: '.test.mapbi.Val',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const reg = new DescriptorRegistry(fds, { useBigInt: true });
    const schema = reg.getSchema('test.mapbi.Holder')!;
    const itemsField = schema.fields.find((f) => f.fieldNum === 1)!;
    assert.equal(itemsField.useBigInt, true);
  });

  it('sorts numeric bool map keys consistently with bool wire encoding', () => {
    const BoolMapSchema = defineMessage<{ m: Map<boolean | number, number> }>('test.BoolMap', {
      m: { fieldNum: 1, type: 'map', mapKey: 'bool', mapVal: 'uint32' },
    });
    const m = new Map<boolean | number, number>([
      [1, 100],
      [false, 200],
    ]);
    const wire = BoolMapSchema.encode({ m }, { deterministic: true });
    // After tag + container len + keyWT + valWT + count(2), first key byte must be 0 (false), then 1 (true)
    const idxFalse = findSubsequence(wire, Uint8Array.from([0x00]));
    assert.ok(idxFalse >= 0);
    const decoded = decodeBlind(wire) as { field_1: Record<string, number> };
    assert.deepEqual(Object.keys(decoded.field_1), ['false', 'true']);
    assert.equal(decoded.field_1['false'], 200);
    assert.equal(decoded.field_1['true'], 100);
  });

  it('supports known-count beginSubMsgArr, 1-byte beginSmallSubMsgElem with overflow fallback, and oversized slab handoff', () => {
    // 1. Known-count beginSubMsgArr + beginSmallSubMsgElem (small + >127B overflow fallback)
    const enc = new Encoder(128);
    enc.beginSubMsgArr(1, 0, 2);
    const lp0 = enc.beginSmallSubMsgElem(32);
    enc.writeInt(1, -42);
    enc.writeFloat64(2, 3.25);
    enc.endSmallSubMsgElem(lp0);

    // Second element overflows 127 bytes to test patchReservedVarint fallback
    const lp1 = enc.beginSmallSubMsgElem(32);
    enc.writeInt(1, 7);
    enc.writeString(3, 'x'.repeat(200));
    enc.endSmallSubMsgElem(lp1);
    enc.endSubMsgArr();

    const wire = enc.finish();
    const blind = decodeBlind(wire) as { field_1: Array<Record<string, unknown>> };
    assert.equal(blind.field_1.length, 2);
    assert.equal(blind.field_1[0]!.field_1, -42);
    assert.equal(blind.field_1[0]!.field_2, 3.25);
    assert.equal(blind.field_1[1]!.field_1, 7);
    assert.equal(blind.field_1[1]!.field_3, 'x'.repeat(200));

    // 2. Oversized slab (>256 KiB) zero-copy handoff in endMessage resets slab safely without aliasing
    const slabEnc = new Encoder(8192);
    const start1 = slabEnc.beginMessage();
    const payload = new Uint8Array(300 * 1024);
    payload.fill(0x5a);
    slabEnc.writeBytes(1, payload);
    const out1 = slabEnc.endMessage(start1);
    assert.ok(out1.byteLength > 300 * 1024);
    assert.equal((slabEnc as unknown as { buf: Uint8Array }).buf.length, 8192);

    // Subsequent encode must not mutate out1
    const start2 = slabEnc.beginMessage();
    slabEnc.writeBytes(1, new Uint8Array(16).fill(0x11));
    const out2 = slabEnc.endMessage(start2);
    assert.notEqual(out1.buffer, out2.buffer);
    assert.equal(out1[out1.length - 1], 0x5a);
  });
});
