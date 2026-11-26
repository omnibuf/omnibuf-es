import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  create as pbCreate,
  createFileRegistry,
  fromBinary as pbFromBinary,
  toBinary as pbToBinary,
} from '@bufbuild/protobuf';
import {
  Edition,
  FeatureSet_EnumType,
  FeatureSet_FieldPresence,
  FeatureSet_JsonFormat,
  FeatureSet_MessageEncoding,
  FeatureSet_RepeatedFieldEncoding,
  FeatureSet_Utf8Validation,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorSetSchema,
} from '@bufbuild/protobuf/wkt';
import {
  DescriptorRegistry,
  clearField,
  create,
  equals,
  fromBinary,
  parseBinaryFileDescriptorSet,
  resolveEditionFile,
  schemaFromProtobufDesc,
  toBinary,
  type FileDescriptorSetJSON,
  type ProtobufDescMessage,
} from '../src/index.js';

function buildFullEditionFds(edition: Edition) {
  return pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'edition_full.proto',
        package: 'ed',
        syntax: 'editions',
        edition,
        options: {
          features: {
            fieldPresence: FeatureSet_FieldPresence.IMPLICIT,
            jsonFormat: FeatureSet_JsonFormat.LEGACY_BEST_EFFORT,
          },
        },
        enumType: [
          {
            name: 'Color',
            value: [
              { name: 'COLOR_UNSPECIFIED', number: 0 },
              { name: 'COLOR_RED', number: 1 },
              { name: 'COLOR_NEG', number: -2 },
            ],
          },
        ],
        messageType: [
          {
            name: 'Child',
            options: { features: { fieldPresence: FeatureSet_FieldPresence.EXPLICIT } },
            field: [
              {
                name: 'id',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
              },
              {
                name: 'tag',
                number: 2,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.STRING,
              },
            ],
          },
          {
            name: 'Envelope',
            options: { features: { fieldPresence: FeatureSet_FieldPresence.EXPLICIT } },
            oneofDecl: [{ name: 'choice' }],
            field: [
              {
                name: 'exp_int',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
                defaultValue: '0',
              },
              {
                name: 'imp_int',
                number: 2,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
                options: { features: { fieldPresence: FeatureSet_FieldPresence.IMPLICIT } },
              },
              {
                name: 'exp_bool',
                number: 3,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.BOOL,
                defaultValue: 'false',
              },
              {
                name: 'exp_str',
                number: 4,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.STRING,
                defaultValue: '',
              },
              {
                name: 'exp_bytes',
                number: 5,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.BYTES,
                defaultValue: '',
              },
              {
                name: 'exp_double',
                number: 6,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.DOUBLE,
                defaultValue: '0.0',
              },
              {
                name: 'exp_color',
                number: 7,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.ENUM,
                typeName: '.ed.Color',
                defaultValue: 'COLOR_UNSPECIFIED',
              },
              {
                name: 'delim_child',
                number: 8,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: '.ed.Child',
                options: { features: { messageEncoding: FeatureSet_MessageEncoding.DELIMITED } },
              },
              {
                name: 'delim_list',
                number: 9,
                label: FieldDescriptorProto_Label.REPEATED,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: '.ed.Child',
                options: { features: { messageEncoding: FeatureSet_MessageEncoding.DELIMITED } },
              },
              {
                name: 'packed_nums',
                number: 10,
                label: FieldDescriptorProto_Label.REPEATED,
                type: FieldDescriptorProto_Type.INT32,
                options: {
                  features: { repeatedFieldEncoding: FeatureSet_RepeatedFieldEncoding.PACKED },
                },
              },
              {
                name: 'expanded_nums',
                number: 11,
                label: FieldDescriptorProto_Label.REPEATED,
                type: FieldDescriptorProto_Type.INT32,
                options: {
                  features: { repeatedFieldEncoding: FeatureSet_RepeatedFieldEncoding.EXPANDED },
                },
              },
              {
                name: 'scores',
                number: 12,
                label: FieldDescriptorProto_Label.REPEATED,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: '.ed.Envelope.ScoresEntry',
              },
              {
                name: 'children_by_name',
                number: 13,
                label: FieldDescriptorProto_Label.REPEATED,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: '.ed.Envelope.ChildrenByNameEntry',
              },
              {
                name: 'choice_int',
                number: 14,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
                oneofIndex: 0,
              },
              {
                name: 'choice_bool',
                number: 15,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.BOOL,
                oneofIndex: 0,
              },
            ],
            nestedType: [
              {
                name: 'ScoresEntry',
                options: { mapEntry: true },
                field: [
                  {
                    name: 'key',
                    number: 1,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.STRING,
                  },
                  {
                    name: 'value',
                    number: 2,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.INT32,
                  },
                ],
              },
              {
                name: 'ChildrenByNameEntry',
                options: { mapEntry: true },
                field: [
                  {
                    name: 'key',
                    number: 1,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.STRING,
                  },
                  {
                    name: 'value',
                    number: 2,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.MESSAGE,
                    typeName: '.ed.Child',
                  },
                ],
              },
              {
                name: 'NestedImplicit',
                options: { features: { fieldPresence: FeatureSet_FieldPresence.IMPLICIT } },
                field: [
                  {
                    name: 'imp_val',
                    number: 1,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.INT32,
                  },
                  {
                    name: 'exp_val',
                    number: 2,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.INT32,
                    options: { features: { fieldPresence: FeatureSet_FieldPresence.EXPLICIT } },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
}

test('editions 2023, 2024, and 2026 round-trip with byte-for-byte equivalence across DescriptorRegistry and DescMessage', () => {
  for (const edition of [Edition.EDITION_2023, Edition.EDITION_2024, Edition.EDITION_2026]) {
    const fdsMsg = buildFullEditionFds(edition);
    const fdsBytes = pbToBinary(FileDescriptorSetSchema, fdsMsg);
    const parsed = parseBinaryFileDescriptorSet(fdsBytes);
    assert.equal(parsed.file?.[0]?.syntax, 'editions');
    assert.equal(parsed.file?.[0]?.edition, edition);

    const reg = new DescriptorRegistry(parsed);
    const pbReg = createFileRegistry(pbFromBinary(FileDescriptorSetSchema, fdsBytes));
    const envelopeDesc = pbReg.getMessage('ed.Envelope')!;
    const nestedDesc = pbReg.getMessage('ed.Envelope.NestedImplicit')!;
    assert.ok(envelopeDesc);
    assert.ok(nestedDesc);

    // 1. Absent explicit fields decode as undefined; implicit field decodes as 0
    const emptyRegWire = reg.encode('ed.Envelope', {}, { deterministic: true });
    const emptyDescWire = toBinary(envelopeDesc, create(envelopeDesc), { deterministic: true });
    assert.deepEqual(emptyRegWire, emptyDescWire);

    const emptyDecodedReg = reg.decode('ed.Envelope', emptyRegWire);
    const emptyDecodedDesc = fromBinary<Record<string, unknown>>(envelopeDesc, emptyDescWire);
    for (const key of ['exp_int', 'exp_bool', 'exp_str', 'exp_bytes', 'exp_double', 'exp_color']) {
      assert.equal(emptyDecodedReg[key], undefined);
    }
    for (const key of ['expInt', 'expBool', 'expStr', 'expBytes', 'expDouble', 'expColor']) {
      assert.equal(emptyDecodedDesc[key], undefined);
    }
    assert.equal(emptyDecodedReg.imp_int, 0);
    assert.equal(emptyDecodedDesc.impInt, 0);
    assert.equal(emptyDecodedReg.delim_child, null);
    assert.equal(emptyDecodedDesc.delimChild, null);

    // 2. Explicit zeros / false / "" / empty bytes / enum 0 differ on wire from absent and round-trip
    const explicitZerosInput = {
      expInt: 0,
      impInt: 0,
      expBool: false,
      expStr: '',
      expBytes: new Uint8Array(0),
      expDouble: 0.0,
      expColor: 0,
      delimChild: { id: 0, tag: '' },
      delimList: [{ id: 1, tag: 'first' }, { id: 2 }],
      packedNums: [1, -2, 3],
      expandedNums: [4, -5, 6],
      scores: { beta: 2, alpha: 1 },
      childrenByName: { one: { id: 10, tag: 'ten' } },
      choice: { case: 'choiceBool', value: false },
    };
    const zeroRegWire = reg.encode('ed.Envelope', explicitZerosInput, {
      deterministic: true,
      selfDescribing: true,
    });
    const zeroDescWire = toBinary(envelopeDesc, create(envelopeDesc, explicitZerosInput), {
      deterministic: true,
      selfDescribing: true,
    });
    assert.deepEqual(zeroRegWire, zeroDescWire);
    assert.notDeepEqual(reg.encode('ed.Envelope', {}), reg.encode('ed.Envelope', { expInt: 0 }));
    assert.notDeepEqual(
      reg.encode('ed.Envelope', {}),
      reg.encode('ed.Envelope', { expBool: false }),
    );
    assert.notDeepEqual(reg.encode('ed.Envelope', {}), reg.encode('ed.Envelope', { expStr: '' }));
    assert.notDeepEqual(
      reg.encode('ed.Envelope', {}),
      reg.encode('ed.Envelope', { expBytes: new Uint8Array(0) }),
    );

    const decodedReg = reg.decode('ed.Envelope', zeroRegWire);
    const decodedDesc = fromBinary<Record<string, unknown>>(envelopeDesc, zeroDescWire);
    assert.equal(decodedReg.exp_int, 0);
    assert.equal(decodedReg.exp_bool, false);
    assert.equal(decodedReg.exp_str, '');
    assert.deepEqual(decodedReg.exp_bytes, new Uint8Array(0));
    assert.equal(decodedReg.exp_double, 0);
    assert.equal(decodedReg.exp_color, 0);
    assert.equal((decodedReg.delim_child as Record<string, unknown>).id, 0);
    assert.equal((decodedReg.delim_child as Record<string, unknown>).tag, '');
    assert.deepEqual(decodedReg.packed_nums, [1, -2, 3]);
    assert.deepEqual(decodedReg.expanded_nums, [4, -5, 6]);
    assert.deepEqual(decodedReg.scores, { alpha: 1, beta: 2 });
    assert.deepEqual(decodedReg.choice, { case: 'choiceBool', value: false });

    assert.equal(decodedDesc.expInt, 0);
    assert.equal(decodedDesc.expBool, false);
    assert.equal(decodedDesc.expStr, '');
    assert.deepEqual(decodedDesc.expBytes, new Uint8Array(0));
    assert.equal(decodedDesc.expDouble, 0);
    assert.equal(decodedDesc.expColor, 0);
    assert.deepEqual(decodedDesc.choice, { case: 'choiceBool', value: false });

    // Open enum preserves unknown integer values
    const unknownEnumWire = reg.encode('ed.Envelope', { expColor: 777 });
    assert.equal(reg.decode('ed.Envelope', unknownEnumWire).exp_color, 777);
    assert.equal(fromBinary<Record<string, unknown>>(envelopeDesc, unknownEnumWire).expColor, 777);

    // clearField resets explicit presence back to undefined
    clearField(envelopeDesc, decodedDesc, 'expInt');
    assert.equal(decodedDesc.expInt, undefined);
    assert.equal(equals(envelopeDesc, decodedDesc, fromBinary(envelopeDesc, zeroDescWire)), false);

    // Nested message override: implicit vs explicit
    const nestedWire = reg.encode('ed.Envelope.NestedImplicit', {});
    assert.deepEqual(nestedWire, toBinary(nestedDesc, create(nestedDesc)));
    assert.equal(reg.decode('ed.Envelope.NestedImplicit', nestedWire).imp_val, 0);
    assert.equal(reg.decode('ed.Envelope.NestedImplicit', nestedWire).exp_val, undefined);
    assert.equal(fromBinary<Record<string, unknown>>(nestedDesc, nestedWire).impVal, 0);
    assert.equal(fromBinary<Record<string, unknown>>(nestedDesc, nestedWire).expVal, undefined);
  }
});

test('editions ignore unset (0 / *_UNKNOWN) child features and allow descriptor option extensions', () => {
  const fds: FileDescriptorSetJSON = {
    file: [
      {
        name: 'custom_opts.proto',
        package: 'opts',
        syntax: 'editions',
        edition: 'EDITION_2026',
        options: {
          features: {
            fieldPresence: 'IMPLICIT',
            defaultSymbolVisibility: 'STRICT',
            enforceNamingStyle: 'STYLE2026',
            enforceProtoLimits: 'PROTO_LIMITS2026',
          },
        },
        extension: [
          {
            name: 'my_msg_opt',
            extendee: '.google.protobuf.MessageOptions',
            number: 50001,
            label: 1,
            type: 9,
          },
          {
            name: 'my_field_opt',
            extendee: '.google.protobuf.FieldOptions',
            number: 50002,
            label: 1,
            type: 5,
          },
        ],
        messageType: [
          {
            name: 'Item',
            options: {
              features: {
                fieldPresence: 0,
                enumType: 'ENUM_TYPE_UNKNOWN',
              },
            },
            field: [
              {
                name: 'inherited_implicit',
                number: 1,
                type: 5,
                label: 1,
                options: { features: { fieldPresence: 0 } },
              },
              {
                name: 'overridden_explicit',
                number: 2,
                type: 5,
                label: 1,
                options: { features: { fieldPresence: 'EXPLICIT' } },
              },
            ],
          },
        ],
      },
    ],
  };
  const reg = new DescriptorRegistry(fds);
  const decoded = reg.decode('opts.Item', reg.encode('opts.Item', {}));
  assert.equal(decoded.inherited_implicit, 0);
  assert.equal(decoded.overridden_explicit, undefined);
});

test('editions consistently reject unsupported versions, CLOSED enums, LEGACY_REQUIRED, UTF-8 NONE, non-zero defaults, and extensions', () => {
  // 1. Unsupported editions across resolveEditionFile, DescriptorRegistry, and DescMessage
  for (const badEdition of [0, 900, 1003, 9999, 'EDITION_UNSTABLE']) {
    assert.throws(
      () => resolveEditionFile({ name: 'bad.proto', syntax: 'editions', edition: badEdition }),
      /unsupported protobuf edition/,
    );
    assert.throws(
      () =>
        new DescriptorRegistry({
          file: [{ name: 'bad.proto', syntax: 'editions', edition: badEdition, messageType: [] }],
        }),
      /unsupported protobuf edition/,
    );
    const syntheticDesc: ProtobufDescMessage = {
      typeName: 'bad.Msg',
      file: {
        name: 'bad.proto',
        edition: badEdition,
        proto: { syntax: 'editions', edition: badEdition },
      },
      fields: [],
    };
    assert.throws(() => schemaFromProtobufDesc(syntheticDesc), /unsupported protobuf edition/);
  }

  // EDITION_UNSTABLE via real createFileRegistry (which collapses file.edition to 1002 while keeping proto.edition = 9999)
  const unstableFds = pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'unstable.proto',
        package: 'u',
        syntax: 'editions',
        edition: Edition.EDITION_UNSTABLE,
        messageType: [{ name: 'M', field: [] }],
      },
    ],
  });
  const unstableReg = createFileRegistry(unstableFds);
  assert.throws(
    () => schemaFromProtobufDesc(unstableReg.getMessage('u.M')!),
    /unsupported protobuf edition/,
  );

  // 2. CLOSED enums: declared and cross-file references (including proto2 enum referenced by Editions)
  assert.throws(
    () =>
      resolveEditionFile({
        syntax: 'editions',
        edition: 1000,
        enumType: [{ name: 'Closed', options: { features: { enumType: 2 } } }],
      }),
    /CLOSED/,
  );

  const crossFileClosedFds = pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'legacy_p2.proto',
        package: 'legacy',
        syntax: 'proto2',
        enumType: [{ name: 'OldEnum', value: [{ name: 'OLD_ZERO', number: 0 }] }],
      },
      {
        name: 'modern.proto',
        package: 'modern',
        syntax: 'editions',
        edition: Edition.EDITION_2026,
        dependency: ['legacy_p2.proto'],
        messageType: [
          {
            name: 'Holder',
            field: [
              {
                name: 'old',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.ENUM,
                typeName: '.legacy.OldEnum',
              },
            ],
          },
        ],
      },
    ],
  });
  const crossFileClosedBytes = pbToBinary(FileDescriptorSetSchema, crossFileClosedFds);
  assert.throws(
    () => new DescriptorRegistry(parseBinaryFileDescriptorSet(crossFileClosedBytes)),
    /CLOSED/,
  );
  const crossPbReg = createFileRegistry(
    pbFromBinary(FileDescriptorSetSchema, crossFileClosedBytes),
  );
  assert.throws(() => schemaFromProtobufDesc(crossPbReg.getMessage('modern.Holder')!), /CLOSED/);

  // 3. LEGACY_REQUIRED
  const reqFds = pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'req.proto',
        package: 'req',
        syntax: 'editions',
        edition: Edition.EDITION_2024,
        messageType: [
          {
            name: 'RequiredMsg',
            field: [
              {
                name: 'id',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
                options: { features: { fieldPresence: FeatureSet_FieldPresence.LEGACY_REQUIRED } },
              },
            ],
          },
        ],
      },
    ],
  });
  const reqBytes = pbToBinary(FileDescriptorSetSchema, reqFds);
  assert.throws(
    () => new DescriptorRegistry(parseBinaryFileDescriptorSet(reqBytes)),
    /LEGACY_REQUIRED/,
  );
  assert.throws(
    () => schemaFromProtobufDesc(createFileRegistry(reqFds).getMessage('req.RequiredMsg')!),
    /LEGACY_REQUIRED/,
  );

  // 4. utf8_validation = NONE on singular string, repeated string, map<string, int32>, map<int32, string>, and oneof string
  const utf8Cases: Array<{
    name: string;
    build: () => ReturnType<typeof pbCreate<typeof FileDescriptorSetSchema>>;
  }> = [
    {
      name: 'singular string',
      build: () =>
        pbCreate(FileDescriptorSetSchema, {
          file: [
            {
              name: 'u1.proto',
              package: 'u',
              syntax: 'editions',
              edition: Edition.EDITION_2023,
              messageType: [
                {
                  name: 'M',
                  field: [
                    {
                      name: 's',
                      number: 1,
                      label: FieldDescriptorProto_Label.OPTIONAL,
                      type: FieldDescriptorProto_Type.STRING,
                      options: { features: { utf8Validation: FeatureSet_Utf8Validation.NONE } },
                    },
                  ],
                },
              ],
            },
          ],
        }),
    },
    {
      name: 'repeated string',
      build: () =>
        pbCreate(FileDescriptorSetSchema, {
          file: [
            {
              name: 'u2.proto',
              package: 'u',
              syntax: 'editions',
              edition: Edition.EDITION_2024,
              messageType: [
                {
                  name: 'M',
                  field: [
                    {
                      name: 'tags',
                      number: 1,
                      label: FieldDescriptorProto_Label.REPEATED,
                      type: FieldDescriptorProto_Type.STRING,
                      options: { features: { utf8Validation: FeatureSet_Utf8Validation.NONE } },
                    },
                  ],
                },
              ],
            },
          ],
        }),
    },
    {
      name: 'map<string, int32>',
      build: () =>
        pbCreate(FileDescriptorSetSchema, {
          file: [
            {
              name: 'u3.proto',
              package: 'u',
              syntax: 'editions',
              edition: Edition.EDITION_2026,
              options: { features: { utf8Validation: FeatureSet_Utf8Validation.NONE } },
              messageType: [
                {
                  name: 'M',
                  field: [
                    {
                      name: 'm',
                      number: 1,
                      label: FieldDescriptorProto_Label.REPEATED,
                      type: FieldDescriptorProto_Type.MESSAGE,
                      typeName: '.u.M.MEntry',
                    },
                  ],
                  nestedType: [
                    {
                      name: 'MEntry',
                      options: { mapEntry: true },
                      field: [
                        {
                          name: 'key',
                          number: 1,
                          label: FieldDescriptorProto_Label.OPTIONAL,
                          type: FieldDescriptorProto_Type.STRING,
                        },
                        {
                          name: 'value',
                          number: 2,
                          label: FieldDescriptorProto_Label.OPTIONAL,
                          type: FieldDescriptorProto_Type.INT32,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
    },
    {
      name: 'map<int32, string> field-level override',
      build: () =>
        pbCreate(FileDescriptorSetSchema, {
          file: [
            {
              name: 'u4.proto',
              package: 'u',
              syntax: 'editions',
              edition: Edition.EDITION_2026,
              messageType: [
                {
                  name: 'M',
                  field: [
                    {
                      name: 'm',
                      number: 1,
                      label: FieldDescriptorProto_Label.REPEATED,
                      type: FieldDescriptorProto_Type.MESSAGE,
                      typeName: '.u.M.MEntry',
                      options: { features: { utf8Validation: FeatureSet_Utf8Validation.NONE } },
                    },
                  ],
                  nestedType: [
                    {
                      name: 'MEntry',
                      options: { mapEntry: true },
                      field: [
                        {
                          name: 'key',
                          number: 1,
                          label: FieldDescriptorProto_Label.OPTIONAL,
                          type: FieldDescriptorProto_Type.INT32,
                        },
                        {
                          name: 'value',
                          number: 2,
                          label: FieldDescriptorProto_Label.OPTIONAL,
                          type: FieldDescriptorProto_Type.STRING,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
    },
    {
      name: 'oneof string override',
      build: () =>
        pbCreate(FileDescriptorSetSchema, {
          file: [
            {
              name: 'u5.proto',
              package: 'u',
              syntax: 'editions',
              edition: Edition.EDITION_2023,
              messageType: [
                {
                  name: 'M',
                  oneofDecl: [
                    {
                      name: 'choice',
                      options: { features: { utf8Validation: FeatureSet_Utf8Validation.NONE } },
                    },
                  ],
                  field: [
                    {
                      name: 's',
                      number: 1,
                      label: FieldDescriptorProto_Label.OPTIONAL,
                      type: FieldDescriptorProto_Type.STRING,
                      oneofIndex: 0,
                    },
                  ],
                },
              ],
            },
          ],
        }),
    },
  ];
  for (const tc of utf8Cases) {
    const fdsMsg = tc.build();
    const bytes = pbToBinary(FileDescriptorSetSchema, fdsMsg);
    assert.throws(
      () => new DescriptorRegistry(parseBinaryFileDescriptorSet(bytes)),
      /UTF-8 NONE/,
      `DescriptorRegistry should reject UTF-8 NONE for ${tc.name}`,
    );
    assert.throws(
      () => schemaFromProtobufDesc(createFileRegistry(fdsMsg).getMessage('u.M')!),
      /UTF-8 NONE/,
      `schemaFromProtobufDesc should reject UTF-8 NONE for ${tc.name}`,
    );
  }

  // 5. Custom non-zero [default = ...] (binary FDS + DescMessage)
  const nonZeroDefaults: Array<{
    label: string;
    type: FieldDescriptorProto_Type;
    defaultValue: string;
    typeName?: string;
  }> = [
    { label: 'int32=42', type: FieldDescriptorProto_Type.INT32, defaultValue: '42' },
    { label: 'bool=true', type: FieldDescriptorProto_Type.BOOL, defaultValue: 'true' },
    { label: 'string=abc', type: FieldDescriptorProto_Type.STRING, defaultValue: 'abc' },
    { label: 'bytes=abc', type: FieldDescriptorProto_Type.BYTES, defaultValue: 'abc' },
    { label: 'double=1.5', type: FieldDescriptorProto_Type.DOUBLE, defaultValue: '1.5' },
    { label: 'float=-0.0', type: FieldDescriptorProto_Type.FLOAT, defaultValue: '-0' },
    {
      label: 'enum=COLOR_RED',
      type: FieldDescriptorProto_Type.ENUM,
      typeName: '.def.Color',
      defaultValue: 'COLOR_RED',
    },
  ];
  for (const tc of nonZeroDefaults) {
    const defFds = pbCreate(FileDescriptorSetSchema, {
      file: [
        {
          name: 'def.proto',
          package: 'def',
          syntax: 'editions',
          edition: Edition.EDITION_2026,
          enumType: [
            {
              name: 'Color',
              value: [
                { name: 'COLOR_ZERO', number: 0 },
                { name: 'COLOR_RED', number: 1 },
              ],
            },
          ],
          messageType: [
            {
              name: 'M',
              field: [
                {
                  name: 'val',
                  number: 1,
                  label: FieldDescriptorProto_Label.OPTIONAL,
                  type: tc.type,
                  typeName: tc.typeName,
                  defaultValue: tc.defaultValue,
                },
              ],
            },
          ],
        },
      ],
    });
    const bytes = pbToBinary(FileDescriptorSetSchema, defFds);
    assert.throws(
      () => new DescriptorRegistry(parseBinaryFileDescriptorSet(bytes)),
      /non-zero default/,
      `DescriptorRegistry should reject ${tc.label}`,
    );
    assert.throws(
      () => schemaFromProtobufDesc(createFileRegistry(defFds).getMessage('def.M')!),
      /non-zero default/,
      `schemaFromProtobufDesc should reject ${tc.label}`,
    );
  }

  // 6. Non-option extensions rejected in Editions (file-level and message-level)
  const extFds = pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'ext.proto',
        package: 'ext',
        syntax: 'editions',
        edition: Edition.EDITION_2023,
        messageType: [
          {
            name: 'Base',
            extensionRange: [{ start: 100, end: 200 }],
            field: [
              {
                name: 'id',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
              },
            ],
          },
        ],
        extension: [
          {
            name: 'extra',
            extendee: '.ext.Base',
            number: 100,
            label: FieldDescriptorProto_Label.OPTIONAL,
            type: FieldDescriptorProto_Type.STRING,
          },
        ],
      },
    ],
  });
  const extBytes = pbToBinary(FileDescriptorSetSchema, extFds);
  assert.throws(() => new DescriptorRegistry(parseBinaryFileDescriptorSet(extBytes)), /extension/i);
  assert.throws(
    () => schemaFromProtobufDesc(createFileRegistry(extFds).getMessage('ext.Base')!),
    /extension/i,
  );

  // 7. Legacy proto2 TYPE_GROUP remains rejected across DescriptorRegistry and DescMessage
  const p2GroupFds = pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'p2grp.proto',
        package: 'p2grp',
        syntax: 'proto2',
        messageType: [
          {
            name: 'Holder',
            field: [
              {
                name: 'grp',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.GROUP,
                typeName: '.p2grp.Holder.Grp',
              },
            ],
            nestedType: [
              {
                name: 'Grp',
                field: [
                  {
                    name: 'x',
                    number: 1,
                    label: FieldDescriptorProto_Label.OPTIONAL,
                    type: FieldDescriptorProto_Type.INT32,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  const p2GroupBytes = pbToBinary(FileDescriptorSetSchema, p2GroupFds);
  assert.throws(
    () => new DescriptorRegistry(parseBinaryFileDescriptorSet(p2GroupBytes)),
    /TYPE_GROUP/,
  );
  assert.throws(
    () => schemaFromProtobufDesc(createFileRegistry(p2GroupFds).getMessage('p2grp.Holder')!),
    /TYPE_GROUP/,
  );

  // 8. Editions CLOSED enum via FeatureSet on message level
  const closedMsgFds = pbCreate(FileDescriptorSetSchema, {
    file: [
      {
        name: 'closed_nested.proto',
        package: 'cn',
        syntax: 'editions',
        edition: Edition.EDITION_2024,
        messageType: [
          {
            name: 'Outer',
            options: { features: { enumType: FeatureSet_EnumType.CLOSED } },
            enumType: [{ name: 'InnerEnum', value: [{ name: 'ZERO', number: 0 }] }],
          },
        ],
      },
    ],
  });
  assert.throws(
    () =>
      new DescriptorRegistry(
        parseBinaryFileDescriptorSet(pbToBinary(FileDescriptorSetSchema, closedMsgFds)),
      ),
    /CLOSED/,
  );
  assert.throws(
    () => schemaFromProtobufDesc(createFileRegistry(closedMsgFds).getMessage('cn.Outer')!),
    /CLOSED/,
  );
});
