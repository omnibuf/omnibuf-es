import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DescriptorRegistry,
  Encoder,
  MaxNestingDepth,
  WireArray,
  WireBoolFalse,
  WireBytes,
  WireMap,
  WireSint,
  WireString,
  WireSubMsg,
  WireUint,
  appendBoolArrBody,
  appendBytesArrBody,
  appendEnumArrBody,
  appendSintArrAutoBody,
  appendUint32ArrBody,
  appendUintArrAutoBody,
  countedArrLen,
  decodeBlind,
  decodeVarintBigInt,
  defineMessage,
  getClassSchema,
  indexTopLevelFields,
  omnibufField,
  readFloat32,
  readTypedMap,
  spliceFields,
  stringifyBlindJSON,
  validateMessage,
  writeVarintAt,
  type FileDescriptorSetJSON,
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

describe('Audit Regressions - @omnibuf/core', () => {
  it('ES-1a: DescriptorRegistry non-optional proto3 sub-message decodes absent as null and omits null on encode', () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'outer.proto',
          package: 'audit.es1',
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
                  typeName: '.audit.es1.Inner',
                },
              ],
            },
          ],
        },
      ],
    };

    const registry = new DescriptorRegistry(fds);
    const decoded = registry.decode('audit.es1.Outer', new Uint8Array(0));
    assert.equal(
      decoded.sub ?? null,
      null,
      `Expected absent proto3 sub-message to decode as null/undefined, got ${JSON.stringify(decoded.sub)}`,
    );

    const encoded = registry.encode('audit.es1.Outer', { sub: null });
    assert.equal(
      encoded.byteLength,
      0,
      `Expected encoding { sub: null } to produce 0 bytes, got ${encoded.byteLength} bytes`,
    );
  });

  it('ES-1b: DescriptorRegistry resolves package-relative sub-message typeName without leading dot', () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'relative.proto',
          package: 'audit.es1.rel',
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
    const encoded = registry.encode('audit.es1.rel.Outer', { sub: { val: 42 } });
    assert.ok(encoded.byteLength > 0, 'Expected relative typeName sub-message to be encoded');
    const decoded = registry.decode('audit.es1.rel.Outer', encoded);
    assert.equal(decoded.sub?.val, 42);
  });

  it('ES-2a: decimal string "18446744073709551615" (UINT64_MAX) preserves exact 64-bit value instead of wrapping to 0n', () => {
    const U64Msg = defineMessage<{ u: bigint | string; f: bigint | string }>('audit.es2.U64Msg', {
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

  it('ES-2b: decimal string "-9223372036854775807" (INT64_MIN + 1) preserves exact precision without IEEE-754 rounding', () => {
    const I64Msg = defineMessage<{
      i: bigint | string;
      s: bigint | string;
      sf: bigint | string;
    }>('audit.es2.I64Msg', {
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

  it('ES-4: deterministic map<string, uint64> and stringifyBlindJSON sort keys by UTF-8 bytes rather than UTF-16 code units', () => {
    const kPua = '\uE000_pua'; // UTF-8: EE 80 80 ...
    const kFullwidth = '！_fullwidth'; // U+FF01, UTF-8: EF BC 81 ...
    const kAstral = '🚀_astral'; // U+1F680, UTF-8: F0 9F 9A 80 ... (UTF-16: D83D DE80 < E000!)

    const mapInput: Record<string, bigint> = {
      [kAstral]: 3n,
      [kFullwidth]: 2n,
      [kPua]: 1n,
    };

    const utf8 = new TextEncoder();
    const bPua = utf8.encode(kPua);
    const bFullwidth = utf8.encode(kFullwidth);
    const bAstral = utf8.encode(kAstral);

    // 1. Encoder.writeMapStringUintDeterministic
    const enc = new Encoder();
    enc.writeMapStringUintDeterministic(1, mapInput);
    const encBytes = enc.finish();
    const encPosPua = findSubsequence(encBytes, bPua);
    const encPosFullwidth = findSubsequence(encBytes, bFullwidth);
    const encPosAstral = findSubsequence(encBytes, bAstral);
    assert.ok(
      encPosPua >= 0 && encPosFullwidth > encPosPua && encPosAstral > encPosFullwidth,
      `Encoder deterministic order wrong: pua@${encPosPua}, fullwidth@${encPosFullwidth}, astral@${encPosAstral}`,
    );

    // 2. MessageSchema deterministic map encoding
    const MapSchema = defineMessage<{ m: Record<string, bigint> }>('audit.es4.MapMsg', {
      m: { fieldNum: 1, type: 'map', mapKey: 'string', mapVal: 'uint64', useBigInt: true },
    });
    const schemaBytes = MapSchema.encode({ m: mapInput }, { deterministic: true });
    const schemaPosPua = findSubsequence(schemaBytes, bPua);
    const schemaPosFullwidth = findSubsequence(schemaBytes, bFullwidth);
    const schemaPosAstral = findSubsequence(schemaBytes, bAstral);
    assert.ok(
      schemaPosPua >= 0 &&
        schemaPosFullwidth > schemaPosPua &&
        schemaPosAstral > schemaPosFullwidth,
      `MessageSchema deterministic order wrong: pua@${schemaPosPua}, fullwidth@${schemaPosFullwidth}, astral@${schemaPosAstral}`,
    );

    // 3. stringifyBlindJSON deterministic object key order
    const json = stringifyBlindJSON(mapInput);
    const jsonPosPua = json.indexOf(kPua);
    const jsonPosFullwidth = json.indexOf(kFullwidth);
    const jsonPosAstral = json.indexOf(kAstral);
    assert.ok(
      jsonPosPua >= 0 && jsonPosFullwidth > jsonPosPua && jsonPosAstral > jsonPosFullwidth,
      `stringifyBlindJSON key order wrong: ${json}`,
    );
  });

  it('ES-4b: decodeBlind decodes WireMap<bool, WireArray(WireUint)> without throwing invalid byteLen', () => {
    const arrFalseEnc = new Encoder();
    arrFalseEnc.writeUint32Arr(1, [10, 20]);
    const arrFalsePayload = arrFalseEnc.finish().subarray(1); // strip 1-byte field tag

    const arrTrueEnc = new Encoder();
    arrTrueEnc.writeUint32Arr(1, [30]);
    const arrTruePayload = arrTrueEnc.finish().subarray(1);

    const pktEnc = new Encoder();
    pktEnc.writeTag(1, WireMap);
    pktEnc.beginContainer();
    pktEnc.writeByte(WireBoolFalse);
    pktEnc.writeByte(WireArray);
    pktEnc.writeRawVarint(2);
    pktEnc.writeByte(0); // false
    pktEnc.writeRaw(arrFalsePayload);
    pktEnc.writeByte(1); // true
    pktEnc.writeRaw(arrTruePayload);
    pktEnc.endContainer();
    const pkt = pktEnc.finish();

    // Packet is 100% spec-valid
    validateMessage(pkt);

    const blind = decodeBlind(pkt);
    assert.deepEqual(blind, {
      field_1: {
        false: [10, 20],
        true: [30],
      },
    });
  });

  it('ES-5: Encoder.beginMessage retains <=64 KiB grown slab instead of resetting above 16 KiB', () => {
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

  it('ES-7a: validateMessage rejects unknown WireString fields containing invalid UTF-8', () => {
    const enc = new Encoder();
    enc.writeTag(99, WireString);
    enc.writeRawVarint(2);
    enc.writeRaw(Uint8Array.from([0xff, 0xfe]));
    const pkt = enc.finish();

    assert.throws(
      () => validateMessage(pkt),
      /UTF-8|utf-8|utf8/i,
      'Expected validateMessage to reject invalid UTF-8 in unknown WireString field #99',
    );
  });

  it('ES-10a: MessageSchema float32 decode preserves exact IEEE-754 binary32 value Math.fround(0.1)', () => {
    const FloatSchema = defineMessage<{ f13Float32: number }>('audit.es10.FloatMsg', {
      f13Float32: { fieldNum: 13, type: 'float32' },
    });
    const expected = Math.fround(0.1);
    const bytes = FloatSchema.encode({ f13Float32: expected });

    assert.equal(readFloat32(bytes, 13)[0], expected);
    const decoded = FloatSchema.decode(bytes);
    assert.equal(decoded.f13Float32, expected);
  });

  it('ES-12: @omnibufField Stage 3 decorator on subclass does not pollute superclass schema with subclass fields', () => {
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

  it('ES-Audit-1: indexTopLevelFields validates Field #0 and invalidates index on corrupt/truncated packets', () => {
    // 1. Invalid Field #0 wire type (field 0, WireUint) followed by valid field #1
    const badF0 = Uint8Array.from([0x01, 0x03, 0x21, 0x05]);
    assert.equal(indexTopLevelFields(badF0).size, 0);

    // 2. Corrupt Field #0 SchemaMeta payload followed by valid field #1
    const corruptF0 = new Encoder();
    corruptF0.writeTag(0, WireSubMsg);
    corruptF0.writeRawVarint(2);
    corruptF0.writeRaw(Uint8Array.from([0x21, 0x00])); // truncated varint inside Field #0
    corruptF0.writeUint(1, 42);
    assert.equal(indexTopLevelFields(corruptF0.finish()).size, 0);

    // 3. Valid field #1 followed by truncated trailing field #2
    const validEnc = new Encoder();
    validEnc.writeUint(1, 7);
    const valid = validEnc.finish();
    const truncated = new Uint8Array(valid.length + 1);
    truncated.set(valid, 0);
    truncated[valid.length] = 0x41; // field #2 WireUint tag with missing value
    assert.equal(indexTopLevelFields(truncated).size, 0);
  });

  it('ES-Audit-2: countedArrLen, readTypedMap, and spliceFields enforce MaxNestingDepth', () => {
    // Build a chain of nested submessages of depth 31: inside a WireArray (depth 1 -> elem depth 2),
    // total depth reaches 33 > MaxNestingDepth (32).
    let inner: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < MaxNestingDepth - 1; i++) {
      const e = new Encoder();
      e.beginSubMsg(1);
      e.writeRaw(inner);
      e.endSubMsg();
      inner = e.finish();
    }
    const arrEnc = new Encoder();
    arrEnc.writeTag(1, WireArray);
    arrEnc.beginContainer();
    arrEnc.writeByte(WireSubMsg);
    arrEnc.writeRawVarint(1);
    arrEnc.writeRawVarint(inner.length);
    arrEnc.writeRaw(inner);
    arrEnc.endContainer();
    const arrPkt = arrEnc.finish();
    assert.equal(countedArrLen(arrPkt, 1, WireSubMsg), 0);

    // readTypedMap must rethrow depth errors instead of swallowing them
    const mapEnc = new Encoder();
    mapEnc.writeTag(1, WireMap);
    mapEnc.beginContainer();
    mapEnc.writeByte(WireString);
    mapEnc.writeByte(WireSubMsg);
    mapEnc.writeRawVarint(1);
    mapEnc.writeRawStringPayload('k');
    mapEnc.writeRawVarint(0);
    mapEnc.endContainer();
    const mapPkt = mapEnc.finish();
    assert.throws(
      () =>
        readTypedMap(mapPkt, 1, 'string', 'submsg', () => {
          throw new Error('omnibuf: nesting depth 33 exceeds MaxNestingDepth (32)');
        }),
      /MaxNestingDepth|nesting depth/i,
    );

    // spliceFields respects depth parameter
    const oneLevelEnc = new Encoder();
    oneLevelEnc.beginSubMsg(1);
    oneLevelEnc.writeUint(1, 5);
    oneLevelEnc.endSubMsg();
    const oneLevelPkt = oneLevelEnc.finish();
    assert.throws(
      () =>
        spliceFields(
          oneLevelPkt,
          1 << 2,
          2,
          (enc) => enc.writeUint(2, 9),
          undefined,
          MaxNestingDepth,
        ),
      /nesting depth/i,
    );
  });

  it('ES-Audit-4: decodeBlind validates split submessage boundaries without redundant subtree validation', () => {
    // Deeply nested message (depth 30) decodes cleanly
    let cur = new Uint8Array(0);
    for (let i = 0; i < 30; i++) {
      const e = new Encoder();
      if (i === 0) e.writeUint(2, 99);
      else {
        e.beginSubMsg(1);
        e.writeRaw(cur);
        e.endSubMsg();
      }
      cur = e.finish();
    }
    const decoded = decodeBlind(cur);
    assert.ok(decoded && typeof decoded === 'object');

    // Split mid-varint submessage across two occurrences must still be rejected
    const full = new Encoder();
    full.writeUint(1, 300); // 2-byte varint value
    const rawSub = full.finish();
    const splitEnc = new Encoder();
    splitEnc.writeTag(1, WireSubMsg);
    splitEnc.writeRawVarint(rawSub.length - 1);
    splitEnc.writeRaw(rawSub.subarray(0, rawSub.length - 1));
    splitEnc.writeTag(1, WireSubMsg);
    splitEnc.writeRawVarint(1);
    splitEnc.writeRaw(rawSub.subarray(rawSub.length - 1));
    assert.throws(() => decodeBlind(splitEnc.finish()));
  });

  it('ES-Audit-6a: DescriptorRegistry preserves useBigInt on message-valued maps', () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'map_bigint.proto',
          package: 'audit.mapbi',
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
                  typeName: '.audit.mapbi.Holder.ItemsEntry',
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
                      typeName: '.audit.mapbi.Val',
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
    const schema = reg.getSchema('audit.mapbi.Holder')!;
    const itemsField = schema.fields.find((f) => f.fieldNum === 1)!;
    assert.equal(itemsField.useBigInt, true);
  });

  it('ES-Audit-6b: bool map key sort order matches bool map key encoding for numeric 1', () => {
    const BoolMapSchema = defineMessage<{ m: Map<any, number> }>('audit.BoolMap', {
      m: { fieldNum: 1, type: 'map', mapKey: 'bool', mapVal: 'uint32' },
    });
    const m = new Map<any, number>([
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

  it('ES-Audit-6c: append*ArrBody restores dst.length on mid-array error', () => {
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

  it('ES-Audit-6d: Encoder fast paths reject fractional field numbers', () => {
    const enc = new Encoder();
    assert.throws(() => enc.writeUint(1.5, 42), /invalid field number/);
    assert.throws(() => enc.writeInt(1.5, -5), /invalid field number/);
    assert.throws(() => enc.writeBool(1.5, true), /invalid field number/);
    assert.throws(() => enc.writeFloat32(1.5, 1.0), /invalid field number/);
    assert.throws(() => enc.writeFloat64(1.5, 1.0), /invalid field number/);
  });
});
