import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  Encoder,
  MaxNestingDepth,
  WireArray,
  WireBoolFalse,
  WireMap,
  WireString,
  WireSubMsg,
  WireUint,
  activeOneofSlice,
  concatMessages,
  countedArrLen,
  decodeBlind,
  decodeVarintBigInt,
  defineMessage,
  encodeField0SchemaMeta,
  getStringCodec,
  indexTopLevelFields,
  locateField,
  nextContainerField,
  readSubMsg,
  readSubMsgMerged,
  readTypedMap,
  spliceFields,
  stringifyBlindJSON,
  validateMessage,
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

it('matches the section 9 annotated packet', () => {
  const enc = new Encoder();
  enc.writeUint(1, 300);
  enc.writeBool(3, true);
  enc.beginSubMsg(9);
  enc.writeString(3, 'FRA');
  enc.writeUint(4, 42);
  enc.endSubMsg();
  assert.equal(Buffer.from(enc.finish()).toString('hex'), '21b2046772021e0075074652418155');
});

it('merges nested repeated fields and maps recursively across submessage occurrences', () => {
  const leaf = defineMessage('Leaf', {
    values: { fieldNum: 1, type: 'uint32[]' },
    labels: { fieldNum: 2, type: 'map' },
  });
  const child = defineMessage('Child', { leaf: { fieldNum: 1, type: 'submsg', subSchema: leaf } });
  const root = defineMessage('Root', { child: { fieldNum: 1, type: 'submsg', subSchema: child } });
  const a = root.encode(
    { child: { leaf: { values: [1], labels: { a: 10 } } } },
    { selfDescribing: true },
  );
  const b = root.encode(
    { child: { leaf: { values: [2], labels: { b: 20 } } } },
    { selfDescribing: true },
  );
  const packet = concatMessages(a, b);
  assert.deepEqual(decodeBlind(packet), {
    child: { leaf: { values: [1, 2], labels: { a: 10, b: 20 } } },
  });
  assert.deepEqual(root.decode(packet).child.leaf.values, [1, 2]);
  assert.deepEqual(root.decode(packet).child.leaf.labels, { a: 10, b: 20 });
});

it('rejects malformed metadata and unknown containers while skipping unknown extensions', () => {
  const empty = defineMessage('Empty', {});
  const invalid = [
    [0x19, 0x05, 0x21, 0x01], // metadata type_name with the wrong wire type
    [0x3d, 0x07, 0xff, 0x00, 0x01], // empty map with invalid KeyType
    [0x3b, 0x07, 0x00, 0x05, 0x01], // count 2 but only one array value
    [0x39, 0x03, 0x00], // unknown submessage with truncated tag
    [0x3b, 0x07, 0x0c, 0x03, 0x05], // submessage-array element exceeds container
    [0x3f, 0x01], // extension missing ExtType
  ];
  for (const bytes of invalid) {
    assert.throws(() => empty.decode(Uint8Array.from(bytes)), undefined, String(bytes));
    assert.throws(() => decodeBlind(Uint8Array.from(bytes)), undefined, String(bytes));
  }
  const ext = Uint8Array.from([0x3f, 0x03, 0xff]);
  assert.doesNotThrow(() => empty.decode(ext));
  assert.throws(() => decodeBlind(ext), /unrecognized/);
});

it('enforces depth 32 even in unknown fields', () => {
  let packet = new Uint8Array();
  const wrap = () => {
    const e = new Encoder();
    e.beginSubMsg(1);
    e.writeRaw(packet);
    e.endSubMsg();
    packet = e.finish();
  };
  const empty = defineMessage('Empty', {});
  for (let i = 0; i < 32; i++) wrap();
  assert.doesNotThrow(() => empty.decode(packet));
  assert.doesNotThrow(() => decodeBlind(packet));
  wrap();
  assert.throws(() => empty.decode(packet), /depth/);
  assert.throws(() => decodeBlind(packet), /depth/);
});

it('uses 1-byte boolean map payloads and preserves fixed scalar meanings', () => {
  const schema = defineMessage('Maps', {
    bools: { fieldNum: 1, type: 'map', mapKey: 'bool', mapVal: 'bool' },
    floats: { fieldNum: 2, type: 'map', mapVal: 'float64' },
    signed: { fieldNum: 3, type: 'map', mapVal: 'sfixed64' },
  });
  const value = { bools: { true: false, false: true }, floats: { x: 1.5 }, signed: { x: -4 } };
  const packet = schema.encode(value);
  const result = schema.decode(packet);
  assert.deepEqual(result.bools, value.bools);
  assert.deepEqual(result.floats, value.floats);
  assert.deepEqual(result.signed, value.signed);
  assert.deepEqual(decodeBlind(packet).field_1, { true: false, false: true });
});

it('preserves special map keys as own properties without mutating prototypes', () => {
  const schema = defineMessage('Maps', { entries: { fieldNum: 1, type: 'map', mapVal: 'string' } });
  const entries = JSON.parse('{"__proto__":"safe","constructor":"also safe"}');
  const packet = schema.encode({ entries });
  assert.deepEqual(schema.decode(packet).entries, entries);
  assert.deepEqual(decodeBlind(packet).field_1, entries);
  assert.equal(Object.getPrototypeOf(schema.decode(packet).entries), Object.prototype);
});

it('counts isolated UTF-16 surrogates like TextEncoder', () => {
  for (const str of ['\ud800', '\ud800a', '\ud800\ud800', '\udc00', '😀']) {
    assert.equal(getStringCodec().byteLength(str), new TextEncoder().encode(str).length);
    const e = new Encoder();
    e.writeString(1, str);
    assert.equal(
      decodeBlind(e.finish()).field_1,
      new TextDecoder().decode(new TextEncoder().encode(str)),
    );
  }
});

it('rejects malformed UTF-8 and preserves a leading BOM in wire strings', () => {
  const codec = getStringCodec();
  for (const bytes of [
    [0xff],
    [0xc0, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xe2, 0x82],
  ]) {
    assert.throws(() => codec.decode(Uint8Array.from(bytes)));
  }
  const text = '\ufeffUnicode 😀';
  assert.equal(codec.decode(codec.encode(text)), text);
});

it('merges repeated scalar and boolean fields with matching wire shapes', () => {
  const schema = defineMessage('RepeatedScalars', {
    value: { fieldNum: 1, type: 'uint32' },
    enabled: { fieldNum: 2, type: 'bool' },
  });
  const packet = concatMessages(
    schema.encode({ value: 1, enabled: false }),
    schema.encode({ value: 2, enabled: true }),
  );
  assert.deepEqual(decodeBlind(packet), { field_1: 2, field_2: true });
});

it('accepts all valid prefix widths and rejects reserved nonzero 9-byte markers', () => {
  assert.deepEqual(decodeVarintBigInt(Uint8Array.from([2, 0])), [0n, 2]);
  assert.deepEqual(decodeVarintBigInt(Uint8Array.from([4, 0, 0, 0])), [0n, 4]);
  assert.deepEqual(decodeVarintBigInt(Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0])), [1n, 9]);
  assert.deepEqual(decodeVarintBigInt(Uint8Array.from([8, 1, 0, 0, 0, 0, 0, 0, 0])), [0n, 0]);
});

it('preserves field numbers beyond uint16 and 32-bit tag arithmetic', () => {
  for (const fieldNum of [65536, 268435456, 536870911]) {
    const schema = defineMessage('LargeField', { value: { fieldNum, type: 'uint32' } });
    const packet = schema.encode({ value: 42 });
    assert.equal(schema.decode(packet).value, 42);
    assert.equal(decodeBlind(packet)[`field_${fieldNum}`], 42);
  }
});

it('splices duplicate repeated occurrences once and supports four-byte tags', async () => {
  const { spliceFields } = await import('../src/index.js');
  const schema = defineMessage('List', { values: { fieldNum: 1024, type: 'uint32[]' } });
  const raw = concatMessages(schema.encode({ values: [1] }), schema.encode({ values: [2] }));
  const changed = spliceFields(raw, 1n << 1024n, 1024, (enc, field) =>
    enc.writeUint32Arr(field, [3]),
  );
  assert.deepEqual(schema.decode(changed).values, [3]);
  assert.throws(() => spliceFields(Uint8Array.from([0x21]), 2n, 1, () => {}));
});

it('preserves declared field names in Field #0 up to depth 32 for recursive schemas without exponential blowup', () => {
  interface TreeNode {
    label: string;
    left?: TreeNode | null;
    right?: TreeNode | null;
  }
  const TreeSchema: ReturnType<typeof defineMessage<TreeNode>> = defineMessage<TreeNode>('Tree', {
    label: { fieldNum: 1, name: 'node_label', type: 'string' },
    left: { fieldNum: 2, name: 'left_branch', type: 'submsg', subSchema: () => TreeSchema },
    right: { fieldNum: 3, name: 'right_branch', type: 'submsg', subSchema: () => TreeSchema },
  });

  // Build a 16-level deep tree alternating left and right branches
  let current: TreeNode = { label: 'leaf_16', left: null, right: null };
  for (let d = 15; d >= 0; d--) {
    current =
      d % 2 === 0
        ? { label: `depth_${d}`, left: current, right: null }
        : { label: `depth_${d}`, left: null, right: current };
  }

  interface BlindTreeNode {
    node_label?: string;
    left_branch?: BlindTreeNode;
    right_branch?: BlindTreeNode;
  }
  const packet = TreeSchema.encode(current, { selfDescribing: true, deterministic: true });
  const blind = decodeBlind(packet) as BlindTreeNode;

  let cursor: BlindTreeNode | undefined = blind;
  for (let d = 0; d < 16; d++) {
    assert.equal(cursor?.node_label, `depth_${d}`);
    cursor = d % 2 === 0 ? cursor?.left_branch : cursor?.right_branch;
    assert.ok(cursor, `missing branch at depth ${d}`);
  }
  assert.equal(cursor?.node_label, 'leaf_16');
});

it('emits exact 64-bit bigints and -0 in stringifyBlindJSON even when JSON.rawJSON is unavailable', async () => {
  const jsonObj = JSON as JSON & { rawJSON?: unknown };
  const origRawJSON = jsonObj.rawJSON;
  try {
    jsonObj.rawJSON = undefined;
    const json = stringifyBlindJSON({
      max_int64: 9223372036854775807n,
      min_int64: -9223372036854775808n,
      neg_zero: -0,
      nested: [18446744073709551615n],
    });
    assert.equal(
      json,
      '{"max_int64":9223372036854775807,"min_int64":-9223372036854775808,"neg_zero":-0,"nested":[18446744073709551615]}',
    );
  } finally {
    jsonObj.rawJSON = origRawJSON;
  }
});

it('supports real @bufbuild/protobuf v2 descriptors with oneofs, proto3_optional presence, and recursive messages', async () => {
  const { createFileRegistry, create: pbCreate } = await import('@bufbuild/protobuf');
  const { FileDescriptorProtoSchema, FieldDescriptorProto_Label, FieldDescriptorProto_Type } =
    await import('@bufbuild/protobuf/wkt');
  const { create, toBinary, fromBinary, mergeFromBinary, clone, equals, clearField } =
    await import('../src/index.js');

  const fileProto = pbCreate(FileDescriptorProtoSchema, {
    name: 'tree.proto',
    package: 'omnibuf.test',
    syntax: 'proto3',
    oneofDecl: [],
    messageType: [
      {
        name: 'TreeNode',
        oneofDecl: [{ name: 'payload' }, { name: '_opt_weight' }],
        field: [
          {
            name: 'id',
            number: 1,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.UINT32,
          },
          {
            name: 'text_val',
            number: 2,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.STRING,
            oneofIndex: 0,
          },
          {
            name: 'int_val',
            number: 3,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.INT64,
            oneofIndex: 0,
          },
          {
            name: 'opt_weight',
            number: 4,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.INT32,
            oneofIndex: 1,
            proto3Optional: true,
          },
          {
            name: 'parent',
            number: 5,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: '.omnibuf.test.TreeNode',
          },
          {
            name: 'children',
            number: 6,
            label: FieldDescriptorProto_Label.REPEATED,
            type: FieldDescriptorProto_Type.MESSAGE,
            typeName: '.omnibuf.test.TreeNode',
          },
        ],
      },
    ],
  });

  const registry = createFileRegistry(fileProto);
  const TreeNodeDesc = registry.getMessage('omnibuf.test.TreeNode')!;
  assert.ok(TreeNodeDesc);

  interface TreeNodeMsg {
    $typeName?: string;
    id?: number;
    optWeight?: number;
    payload?: { case: string | undefined; value?: unknown };
    parent?: TreeNodeMsg | null;
  }

  // 1. Recursive create() does not infinite-loop; oneof defaults to { case: undefined }; optWeight is undefined
  const emptyNode = create(TreeNodeDesc) as TreeNodeMsg;
  assert.equal(emptyNode.$typeName, 'omnibuf.test.TreeNode');
  assert.deepEqual(emptyNode.payload, { case: undefined });
  assert.equal(emptyNode.optWeight, undefined);
  assert.equal(emptyNode.parent, null);

  // 2. Explicit presence: optWeight = 0 is preserved on wire vs undefined when unset
  const zeroWeightNode = create(TreeNodeDesc, {
    id: 1,
    optWeight: 0,
    payload: { case: 'intVal', value: 9007199254740993n },
    parent: {
      id: 2,
      payload: { case: 'textVal', value: 'root-payload' },
    },
  }) as TreeNodeMsg;

  const bytes = toBinary(TreeNodeDesc, zeroWeightNode, {
    deterministic: true,
    selfDescribing: true,
  });
  const decoded = fromBinary<TreeNodeMsg>(TreeNodeDesc, bytes);

  assert.equal(decoded.id, 1);
  assert.equal(decoded.optWeight, 0);
  assert.deepEqual(decoded.payload, { case: 'intVal', value: 9007199254740993n });
  assert.equal(decoded.parent?.id, 2);
  assert.deepEqual(decoded.parent?.payload, { case: 'textVal', value: 'root-payload' });
  assert.equal(decoded.parent?.optWeight, undefined);
  assert.equal(equals(TreeNodeDesc, zeroWeightNode, decoded), true);

  // 3. Cloning & clearing oneof and explicit presence fields
  const cloned = clone(TreeNodeDesc, decoded);
  assert.equal(equals(TreeNodeDesc, decoded, cloned), true);

  const optWeightField = TreeNodeDesc.fields.find((f) => f.localName === 'optWeight')!;
  clearField(cloned, optWeightField);
  assert.equal(cloned.optWeight, undefined);
  assert.equal(equals(TreeNodeDesc, decoded, cloned), false);

  // 4. Switching oneof case via mergeFromBinary replaces previous case
  const patch = toBinary(TreeNodeDesc, {
    payload: { case: 'textVal', value: 'overridden' },
  });
  mergeFromBinary(TreeNodeDesc, cloned, patch);
  assert.deepEqual(cloned.payload, { case: 'textVal', value: 'overridden' });
});

it('negative enum values round-trip across scalar, repeated, and map fields', async () => {
  const { defineMessage, readEnum, readEnumArr, readTypedMap } = await import('../src/index.js');

  const EnumHolder = defineMessage<{
    status: number;
    history: number[];
    byKey: Record<string, number>;
  }>('EnumHolder', {
    status: { fieldNum: 1, type: 'enum' },
    history: { fieldNum: 2, type: 'enum[]' },
    byKey: { fieldNum: 3, type: 'map', mapKey: 'string', mapVal: 'enum' },
  });

  const input = {
    status: -1,
    history: [-1, 0, 1, -2147483648, 2147483647],
    byKey: { negOne: -1, minInt: -2147483648, pos: 42 },
  };

  const wire = EnumHolder.encode(input, { deterministic: true });
  const decoded = EnumHolder.decode(wire);

  assert.equal(decoded.status, -1);
  assert.deepEqual(decoded.history, [-1, 0, 1, -2147483648, 2147483647]);
  assert.deepEqual(decoded.byKey, { negOne: -1, minInt: -2147483648, pos: 42 });

  // Verify Opaque reader helpers match reflective decode
  assert.deepEqual(readEnum(wire, 1), [-1, true]);
  assert.deepEqual(readEnumArr(wire, 2), [[-1, 0, 1, -2147483648, 2147483647], true]);
  assert.deepEqual(readTypedMap(wire, 3, 'string', 'enum'), [
    { negOne: -1, minInt: -2147483648, pos: 42 },
    true,
  ]);
});

it('differential equivalence across MessageSchema, DescriptorRegistry, Opaque readers, and decodeBlind', async () => {
  const {
    DescriptorRegistry,
    WireString,
    WireSubMsg,
    WireUint,
    activeOneofSlice,
    decodeBlind,
    readEnum,
    readEnumArr,
    readString,
    readSubMsgMerged,
    readTypedMap,
  } = await import('../src/index.js');

  const fds = {
    file: [
      {
        name: 'diff.proto',
        package: 'diff',
        syntax: 'proto3',
        enumType: [
          {
            name: 'Kind',
            value: [
              { name: 'KIND_NEG', number: -5 },
              { name: 'KIND_ZERO', number: 0 },
              { name: 'KIND_POS', number: 7 },
            ],
          },
        ],
        messageType: [
          {
            name: 'Sub',
            field: [
              { name: 'a', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
              { name: 'tags', number: 2, label: 'LABEL_REPEATED', type: 'TYPE_STRING' },
            ],
          },
          {
            name: 'Record',
            oneofDecl: [{ name: 'pick' }],
            field: [
              {
                name: 'kind',
                number: 1,
                label: 'LABEL_OPTIONAL',
                type: 'TYPE_ENUM',
                typeName: '.diff.Kind',
              },
              {
                name: 'kinds',
                number: 2,
                label: 'LABEL_REPEATED',
                type: 'TYPE_ENUM',
                typeName: '.diff.Kind',
              },
              {
                name: 'pick_str',
                number: 3,
                label: 'LABEL_OPTIONAL',
                type: 'TYPE_STRING',
                oneofIndex: 0,
              },
              {
                name: 'pick_uint',
                number: 4,
                label: 'LABEL_OPTIONAL',
                type: 'TYPE_UINT32',
                oneofIndex: 0,
              },
              {
                name: 'pick_sub',
                number: 5,
                label: 'LABEL_OPTIONAL',
                type: 'TYPE_MESSAGE',
                typeName: '.diff.Sub',
                oneofIndex: 0,
              },
              {
                name: 'kind_map',
                number: 6,
                label: 'LABEL_REPEATED',
                type: 'TYPE_MESSAGE',
                typeName: '.diff.Record.KindMapEntry',
              },
            ],
            nestedType: [
              {
                name: 'KindMapEntry',
                options: { mapEntry: true },
                field: [
                  { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                  {
                    name: 'value',
                    number: 2,
                    label: 'LABEL_OPTIONAL',
                    type: 'TYPE_ENUM',
                    typeName: '.diff.Kind',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const reg = new DescriptorRegistry(fds);
  const RecordSchema = reg.getSchema('diff.Record')!;
  const SubSchema = reg.getSchema('diff.Sub')!;

  // Construct a multi-part wire packet where:
  // - part 1 sets kind = -5, kinds = [-5], pick_sub = { a: 10, tags: ['x'] }, kind_map = { k1: -5 }
  // - part 2 switches oneof to pick_str = 'middle'
  // - part 3 switches oneof back to pick_sub = { tags: ['y'] } (must NOT merge with part 1's pick_sub because part 2 cleared it!), and appends kinds = [7], kind_map = { k2: 7 }
  const p1 = RecordSchema.encode(
    {
      kind: -5,
      kinds: [-5],
      pick: { case: 'pickSub', value: { a: 10, tags: ['x'] } },
      kindMap: { k1: -5 },
    },
    { selfDescribing: true },
  );
  const p2 = RecordSchema.encode({
    kind: -5,
    pick: { case: 'pickStr', value: 'middle' },
  });
  const p3 = RecordSchema.encode(
    {
      kind: -5,
      kinds: [7],
      pick: { case: 'pickSub', value: { a: 99, tags: ['y'] } },
      kindMap: { k2: 7 },
    },
    { selfDescribing: true },
  );

  const combined = new Uint8Array(p1.length + p2.length + p3.length);
  combined.set(p1, 0);
  combined.set(p2, p1.length);
  combined.set(p3, p1.length + p2.length);

  interface DiffRecordShape {
    kind: number;
    kinds: number[];
    kindMap: Record<string, number>;
    pick: { case: string; value: { a: number; tags: string[] } };
  }

  // Path 1: MessageSchema.decode
  const decodedSchema = RecordSchema.decode(combined) as unknown as DiffRecordShape;
  // Path 2: DescriptorRegistry.decode
  const decodedReg = reg.decode('diff.Record', combined) as unknown as DiffRecordShape;

  assert.equal(decodedSchema.kind, -5);
  assert.deepEqual(decodedSchema.kinds, [-5, 7]);
  assert.deepEqual(decodedSchema.kindMap, { k1: -5, k2: 7 });
  assert.equal(decodedSchema.pick.case, 'pickSub');
  assert.equal(decodedSchema.pick.value.a, 99);
  assert.deepEqual(decodedSchema.pick.value.tags, ['y']);
  assert.deepEqual(decodedReg, decodedSchema);

  // Path 3: Opaque readers + activeOneofSlice
  const oneofSpecs: ReadonlyArray<readonly [number, number]> = [
    [3, 1 << WireString],
    [4, 1 << WireUint],
    [5, 1 << WireSubMsg],
  ];
  assert.deepEqual(readEnum(combined, 1), [-5, true]);
  assert.deepEqual(readEnumArr(combined, 2), [[-5, 7], true]);
  assert.deepEqual(readTypedMap(combined, 6, 'string', 'enum'), [{ k1: -5, k2: 7 }, true]);
  assert.equal(activeOneofSlice(combined, 3, oneofSpecs), null);
  assert.equal(activeOneofSlice(combined, 4, oneofSpecs), null);
  const subSlice = activeOneofSlice(combined, 5, oneofSpecs);
  assert.ok(subSlice);
  const [opaqueSub, okSub] = readSubMsgMerged(subSlice, 5, (sub, target, merge) =>
    SubSchema.decode(sub, target, 0, { merge }),
  );
  assert.equal(okSub, true);
  assert.equal((opaqueSub as { a?: number }).a, 99);
  assert.deepEqual((opaqueSub as { tags?: string[] }).tags, ['y']);
  assert.equal(readString(combined, 3)[0], 'middle'); // raw locateField sees superseded field 3, which is why activeOneofSlice is required

  // Path 4: Blind decoder (sees signed ZigZag varint on wire and merges repeated/maps)
  const blind = decodeBlind(combined) as { kind?: number; kinds?: number[] };
  assert.equal(blind.kind, -5);
  assert.deepEqual(blind.kinds, [-5, 7]);
});

it('decodes 1-byte Prefix-Varint odd lengths on submsg and array containers without confusing bit 1 with 2-byte varint', async () => {
  const {
    WireArray,
    WireString,
    WireSubMsg,
    WireUint,
    countSubMsgArrElems,
    decodeBlind,
    defineMessage,
    readElem,
    readSubMsgArrDecoded,
    readSubMsgArrElem,
    readSubMsgMerged,
    subMsgArrLen,
    writeVarintAt,
  } = await import('../src/index.js');

  const SubSchema = defineMessage<{ id: number }>('OddSub', {
    id: { fieldNum: 1, type: 'uint32' },
  });
  const ParentSchema = defineMessage<{
    sub: { id: number } | null;
    strs: string[];
    nums: number[];
    subs: Array<{ id: number }>;
  }>('OddParent', {
    sub: { fieldNum: 1, type: 'submsg', subSchema: () => SubSchema },
    strs: { fieldNum: 2, type: 'string[]' },
    nums: { fieldNum: 3, type: 'uint32[]' },
    subs: { fieldNum: 4, type: 'submsg[]', subSchema: () => SubSchema },
  });

  // 3-byte submsg body: field #1 (WireUint = 0) -> tag = 16 -> 1B varint (16<<1)|1 = 0x21, value = 300 -> 2B varint ((300<<2)|2) = [0xb2, 0x04]
  // Total submsg byte length = 3 (odd! 1-byte prefix varint is (3<<1)|1 = 0x07, where both bit 0 and bit 1 are 1)
  const subBody3 = new Uint8Array([0x21, 0xb2, 0x04]);
  assert.equal(subBody3.length, 3);

  // Field #1: WireSubMsg (12), 1-byte odd length = 3 -> header byte 0x07
  // Field #2: WireArray (13) of strings, 1-byte odd length = 5 -> header byte 0x0b: [WireString(10), count=1 (0x03), strLen=2 (0x05), 'h', 'i']
  // Field #3: WireArray (13) of uint32, 1-byte odd length = 3 -> header byte 0x07: [WireUint(0), count=1 (0x03), val=42 (0x55)]
  // Field #4: WireArray (13) of submsg, 1-byte odd length = 6 -> header byte 0x0d, containing 1 element whose 1-byte length is 3 (odd! 0x07) followed by subBody3
  // Also append a second Field #4 WireArray with odd outer length = 5 -> header byte 0x0b, containing 1 element of odd length = 2?Wait: 2+1+2 = 5 (outer odd!) and first array has inner odd (3)!
  const subBody2 = new Uint8Array([0x21, (7 << 1) | 1]); // id = 7 (2 bytes)
  const arrSubs1Payload = new Uint8Array([WireSubMsg, (1 << 1) | 1, (3 << 1) | 1, ...subBody3]); // 6 bytes total, inner elem len = 3 (odd 1B varint 0x07)
  const arrSubs2Payload = new Uint8Array([WireSubMsg, (1 << 1) | 1, (2 << 1) | 1, ...subBody2]); // 5 bytes total (odd outer 1B varint 0x0b)

  const varintBytes = (v: number): Uint8Array => {
    const tmp = new Uint8Array(9);
    return tmp.subarray(0, writeVarintAt(tmp, 0, v));
  };

  const packet = new Uint8Array([
    ...varintBytes((1 << 4) | WireSubMsg),
    (subBody3.length << 1) | 1, // 0x07 (odd 1B varint)
    ...subBody3,

    ...varintBytes((2 << 4) | WireArray),
    (5 << 1) | 1, // 0x0b (odd 1B varint, len=5)
    WireString,
    (1 << 1) | 1,
    (2 << 1) | 1,
    0x68,
    0x69,

    ...varintBytes((3 << 4) | WireArray),
    (3 << 1) | 1, // 0x07 (odd 1B varint, len=3)
    WireUint,
    (1 << 1) | 1,
    (42 << 1) | 1,

    ...varintBytes((4 << 4) | WireArray),
    (arrSubs1Payload.length << 1) | 1,
    ...arrSubs1Payload,

    ...varintBytes((4 << 4) | WireArray),
    (arrSubs2Payload.length << 1) | 1, // 0x0b (odd 1B varint, len=5)
    ...arrSubs2Payload,
  ]);

  // 1. Direct reader helpers on odd-length 1-byte Prefix-Varint submsg array
  assert.deepEqual(countSubMsgArrElems(arrSubs1Payload), [1, true]);
  assert.deepEqual(readElem(arrSubs1Payload, 0), [subBody3, true]);
  assert.equal(subMsgArrLen(packet, 4), 2);
  assert.deepEqual(readSubMsgArrElem(packet, 4, 0), [subBody3, true]);
  assert.deepEqual(readSubMsgArrElem(packet, 4, 1), [subBody2, true]);
  assert.deepEqual(
    readSubMsgArrDecoded(packet, 4, (b) => SubSchema.decode(b)),
    [[{ id: 300 }, { id: 7 }], true],
  );
  assert.deepEqual(
    readSubMsgMerged(packet, 1, (b, t, m) => SubSchema.decode(b, t, 0, { merge: m })),
    [{ id: 300 }, true],
  );

  // 2. Blind decoder
  const blind = decodeBlind(packet);
  assert.deepEqual(blind, {
    field_1: { field_1: 300 },
    field_2: ['hi'],
    field_3: [42],
    field_4: [{ field_1: 300 }, { field_1: 7 }],
  });

  // 3. MessageSchema.decode
  const decoded = ParentSchema.decode(packet);
  assert.deepEqual(decoded.sub, { id: 300 });
  assert.deepEqual(decoded.strs, ['hi']);
  assert.deepEqual(decoded.nums, [42]);
  assert.deepEqual(decoded.subs, [{ id: 300 }, { id: 7 }]);
});

it('enforces wire edge cases for SchemaMeta, decodeBlindJSON, nested arrays, and spliceFields', async () => {
  const {
    decodeBlindJSON,
    countedArrLen,
    readSubMsg,
    locateField,
    WireUint,
    WireString,
    WireSubMsg,
    WireArray,
    WireMap,
    WireBoolFalse,
  } = await import('../src/index.js');

  // 1. decodeBlindJSON throws on NaN/Infinity by default, while fallbackOnNonFinite returns "{}"
  const nanEnc = new Encoder(32);
  nanEnc.writeFloat64(1, Number.NaN);
  const nanPkt = nanEnc.finish();
  assert.throws(() => decodeBlindJSON(nanPkt), /non-finite float/);
  assert.equal(decodeBlindJSON(nanPkt, { fallbackOnNonFinite: true }), '{}');

  const infEnc = new Encoder(32);
  infEnc.writeFloat32(1, Number.POSITIVE_INFINITY);
  const infPkt = infEnc.finish();
  assert.throws(() => decodeBlindJSON(infPkt), /non-finite float/);
  assert.equal(decodeBlindJSON(infPkt, { fallbackOnNonFinite: true }), '{}');

  // 2. SchemaMeta.children duplicate key in single WireMap replaces, while two Field #0 blocks merge
  const childOld = new Encoder(64);
  childOld.writeTag(2, WireMap);
  childOld.beginContainer();
  childOld.writeByte(WireUint);
  childOld.writeByte(WireString);
  childOld.writeRawVarint(2);
  childOld.writeRawVarint(1);
  childOld.writeRawStringPayload('old_id');
  childOld.writeRawVarint(2);
  childOld.writeRawStringPayload('old_label');
  childOld.endContainer();
  const childOldBytes = childOld.finish();

  const childNew = new Encoder(64);
  childNew.writeTag(2, WireMap);
  childNew.beginContainer();
  childNew.writeByte(WireUint);
  childNew.writeByte(WireString);
  childNew.writeRawVarint(1);
  childNew.writeRawVarint(1);
  childNew.writeRawStringPayload('new_id');
  childNew.endContainer();
  const childNewBytes = childNew.finish();

  const singleMapF0 = new Encoder(128);
  singleMapF0.writeTag(0, WireSubMsg);
  singleMapF0.beginContainer();
  singleMapF0.writeTag(3, WireMap);
  singleMapF0.beginContainer();
  singleMapF0.writeByte(WireUint);
  singleMapF0.writeByte(WireSubMsg);
  singleMapF0.writeRawVarint(2);
  singleMapF0.writeRawVarint(8);
  singleMapF0.writeRawBytesPayload(childOldBytes);
  singleMapF0.writeRawVarint(8);
  singleMapF0.writeRawBytesPayload(childNewBytes);
  singleMapF0.endContainer();
  singleMapF0.endContainer();
  singleMapF0.beginSubMsg(8);
  singleMapF0.writeUint(1, 10);
  singleMapF0.writeString(2, 'hi');
  singleMapF0.endSubMsg();
  assert.deepEqual(decodeBlind(singleMapF0.finish()), {
    field_8: { new_id: 10, field_2: 'hi' },
  });

  const twoBlocksF0 = new Encoder(128);
  for (const cb of [childOldBytes, childNewBytes]) {
    twoBlocksF0.writeTag(0, WireSubMsg);
    twoBlocksF0.beginContainer();
    twoBlocksF0.writeTag(3, WireMap);
    twoBlocksF0.beginContainer();
    twoBlocksF0.writeByte(WireUint);
    twoBlocksF0.writeByte(WireSubMsg);
    twoBlocksF0.writeRawVarint(1);
    twoBlocksF0.writeRawVarint(8);
    twoBlocksF0.writeRawBytesPayload(cb);
    twoBlocksF0.endContainer();
    twoBlocksF0.endContainer();
  }
  twoBlocksF0.beginSubMsg(8);
  twoBlocksF0.writeUint(1, 10);
  twoBlocksF0.writeString(2, 'hi');
  twoBlocksF0.endSubMsg();
  assert.deepEqual(decodeBlind(twoBlocksF0.finish()), {
    field_8: { new_id: 10, old_label: 'hi' },
  });

  // 3. Split mid-varint submessages rejected by readSubMsg, decodeBlind, and spliceFields
  const splitSubPkt = new Uint8Array([
    ((8 << 4) | WireSubMsg) * 2 + 1,
    (2 << 1) | 1,
    0x21,
    0x02, // truncated 2B varint
    ((8 << 4) | WireSubMsg) * 2 + 1,
    (1 << 1) | 1,
    0x00,
  ]);
  assert.equal(readSubMsg(splitSubPkt, 8)[1], false);
  assert.throws(() => decodeBlind(splitSubPkt));
  assert.throws(() => spliceFields(splitSubPkt, 1 << 1, 8, () => {}));

  // 4. Corrupt Field #0 rejected by locateField and spliceFields
  const corruptF0Pkt = new Uint8Array([0x19, 0x03, 0x25, 0x21, 0x0b]); // Field #0 containing truncated tag/string + field #1=5
  assert.equal(locateField(corruptF0Pkt, 1).ok, false);
  assert.throws(() => spliceFields(corruptF0Pkt, 1 << 1, 2, () => {}));

  // 5. Invalid bool array byte 0x02 rejected by countedArrLen and spliceFields
  const badBoolArrPkt = new Uint8Array([
    (((1 << 4) | WireArray) << 1) | 1,
    (3 << 1) | 1,
    WireBoolFalse,
    (1 << 1) | 1,
    0x02,
  ]);
  assert.equal(countedArrLen(badBoolArrPkt, 1, WireBoolFalse), 0);
  assert.throws(() => spliceFields(badBoolArrPkt, 1 << 2, 2, () => {}));

  // 6. Nested WireArray(WireArray(...)) inner element wire-type conflict rejected by decodeBlind
  const nestedArrConflict = new Uint8Array([
    (((1 << 4) | WireArray) << 1) | 1,
    (6 << 1) | 1,
    WireArray,
    (1 << 1) | 1,
    (3 << 1) | 1,
    WireUint,
    (1 << 1) | 1,
    (7 << 1) | 1,
    (((1 << 4) | WireArray) << 1) | 1,
    (7 << 1) | 1,
    WireArray,
    (1 << 1) | 1,
    (4 << 1) | 1,
    WireString,
    (1 << 1) | 1,
    (1 << 1) | 1,
    0x61,
  ]);
  assert.throws(() => decodeBlind(nestedArrConflict), /changes wire shape/);
});

it('sorts deterministic string map keys and stringifyBlindJSON object keys by UTF-8 bytes', () => {
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
  const MapSchema = defineMessage<{ m: Record<string, bigint> }>('test.Utf8OrderMapMsg', {
    m: { fieldNum: 1, type: 'map', mapKey: 'string', mapVal: 'uint64', useBigInt: true },
  });
  const schemaBytes = MapSchema.encode({ m: mapInput }, { deterministic: true });
  const schemaPosPua = findSubsequence(schemaBytes, bPua);
  const schemaPosFullwidth = findSubsequence(schemaBytes, bFullwidth);
  const schemaPosAstral = findSubsequence(schemaBytes, bAstral);
  assert.ok(
    schemaPosPua >= 0 && schemaPosFullwidth > schemaPosPua && schemaPosAstral > schemaPosFullwidth,
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

it('decodes WireMap<bool, WireArray(WireUint)> in decodeBlind', () => {
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

  validateMessage(pkt);

  const blind = decodeBlind(pkt);
  assert.deepEqual(blind, {
    field_1: {
      false: [10, 20],
      true: [30],
    },
  });
});

it('rejects unknown WireString fields containing invalid UTF-8 in validateMessage', () => {
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

it('validates Field #0 and invalidates indexTopLevelFields on corrupt or truncated packets', () => {
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

it('enforces MaxNestingDepth in countedArrLen, readTypedMap, and spliceFields', () => {
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

it('validates split submessage boundaries in decodeBlind without rejecting deep valid trees', () => {
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

it('propagates nesting depth across locateField, nextContainerField, readSubMsg, readSubMsgMerged, activeOneofSlice, and readTypedMap', () => {
  const f0 = encodeField0SchemaMeta({ fields: { 1: 'x' } }, true);
  const bodyEnc = new Encoder();
  bodyEnc.writeUint(1, 7);
  const withF0 = new Uint8Array(f0.length + bodyEnc.bytesView().length);
  withF0.set(f0, 0);
  withF0.set(bodyEnc.bytesView(), f0.length);

  // At depth = 0, Field #0 is at depth 1 <= MaxNestingDepth -> valid
  assert.equal(locateField(withF0, 1, 1 << WireUint, 0).ok, true);
  assert.ok(activeOneofSlice(withF0, 1, [[1, 1 << WireUint]], 0) !== null);

  // At depth = MaxNestingDepth, Field #0 is at depth 33 > MaxNestingDepth -> rejected
  assert.equal(locateField(withF0, 1, 1 << WireUint, MaxNestingDepth).ok, false);
  assert.equal(activeOneofSlice(withF0, 1, [[1, 1 << WireUint]], MaxNestingDepth), null);
  assert.equal(nextContainerField(withF0, 0, 1, WireSubMsg, 0, MaxNestingDepth).valid, false);
  assert.equal(readSubMsg(withF0, 1, MaxNestingDepth)[1], false);
  assert.equal(readSubMsgMerged(withF0, 1, (s) => s, MaxNestingDepth)[1], false);

  // Multi-chunk readSubMsg validates merged chunks at depth + 1
  const nestedEnc = new Encoder();
  nestedEnc.beginSubMsg(1);
  nestedEnc.writeUint(1, 5);
  nestedEnc.endSubMsg();
  const nestedChild = nestedEnc.finish();
  const twoChunks = new Encoder();
  twoChunks.beginSubMsg(1);
  twoChunks.writeRaw(nestedChild);
  twoChunks.endSubMsg();
  twoChunks.beginSubMsg(1);
  twoChunks.writeRaw(nestedChild);
  twoChunks.endSubMsg();
  const twoChunkPkt = twoChunks.finish();
  assert.equal(readSubMsg(twoChunkPkt, 1, 0)[1], true);
  assert.equal(readSubMsg(twoChunkPkt, 1, MaxNestingDepth - 1)[1], false);

  // readTypedMap rejects depth + 1 > MaxNestingDepth
  const mapEnc = new Encoder();
  mapEnc.writeTag(1, WireMap);
  mapEnc.beginContainer();
  mapEnc.writeByte(WireString);
  mapEnc.writeByte(WireUint);
  mapEnc.writeRawVarint(1);
  mapEnc.writeRawStringPayload('a');
  mapEnc.writeRawVarint(1);
  mapEnc.endContainer();
  assert.throws(
    () => readTypedMap(mapEnc.finish(), 1, 'string', 'uint32', undefined, MaxNestingDepth),
    /MaxNestingDepth|nesting depth/i,
  );
});
