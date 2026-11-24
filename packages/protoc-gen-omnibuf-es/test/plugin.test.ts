import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Encoder,
  MaxNestingDepth,
  WireArray,
  WireString,
  WireSubMsg,
  WireUint,
  decodeBlind,
  marshal,
  readFloat32,
  type FileDescriptorSetJSON,
} from '@omnibuf/core';
import ts from 'typescript';
import { generateFromDescriptorSet } from '../src/index.js';

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      assert.strictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toContain(substr: string) {
      assert.ok(
        typeof actual === 'string' && actual.includes(substr),
        `Expected string to contain ${substr}`,
      );
    },
  };
}

function findSubsequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const SAMPLE_FDS: FileDescriptorSetJSON = {
  file: [
    {
      name: 'peer.proto',
      package: 'omnibuf.bench',
      syntax: 'proto3',
      messageType: [
        {
          name: 'Location',
          field: [
            { name: 'region', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'datacenter', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'city', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'rack', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'latitude', number: 5, label: 'LABEL_OPTIONAL', type: 'TYPE_FLOAT' },
            { name: 'longitude', number: 6, label: 'LABEL_OPTIONAL', type: 'TYPE_FLOAT' },
          ],
        },
        {
          name: 'Neighbor',
          field: [
            { name: 'peer_asn', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'router', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'latency_us', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'established', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
          ],
        },
        {
          name: 'PeerUpdate',
          field: [
            { name: 'asn', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'router_id', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'active', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
            { name: 'uptime_sec', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT64' },
            { name: 'rssi_dbm', number: 5, label: 'LABEL_OPTIONAL', type: 'TYPE_SINT32' },
            { name: 'cpu_load', number: 6, label: 'LABEL_OPTIONAL', type: 'TYPE_DOUBLE' },
            { name: 'tags', number: 7, label: 'LABEL_REPEATED', type: 'TYPE_STRING' },
            { name: 'prefixes', number: 8, label: 'LABEL_REPEATED', type: 'TYPE_UINT32' },
            {
              name: 'location',
              number: 9,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.bench.Location',
            },
            {
              name: 'neighbors',
              number: 10,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.bench.Neighbor',
            },
            { name: 'sequence', number: 11, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT64' },
          ],
        },
      ],
    },
    {
      name: 'conformance.proto',
      package: 'omnibuf.conformance',
      syntax: 'proto3',
      messageType: [
        {
          name: 'TestAllTypes',
          field: [
            { name: 'f1_uint32', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'f6_string', number: 6, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
          ],
        },
      ],
    },
  ],
};

describe('@omnibuf/protoc-gen-omnibuf-es - Code Generator', () => {
  it('generates TypeScript interfaces, single-pass encoders, decoders, and Opaque<T> classes from FileDescriptorSet', () => {
    const files = generateFromDescriptorSet(SAMPLE_FDS);
    expect(files.length).toBe(2);

    const peerFile = files.find((f) => f.name === 'peer_omnibuf.pb.ts');
    expect(peerFile).toBeDefined();
    expect(peerFile!.content).toContain('export interface PeerUpdate');
    expect(peerFile!.content).toContain('export function encodePeerUpdate');
    expect(peerFile!.content).toContain('export function marshalPeerUpdateOmniBuf');
    expect(peerFile!.content).toContain('export function decodePeerUpdate');
    expect(peerFile!.content).toContain('export class OpaquePeerUpdate');
    expect(peerFile!.content).toContain('spliceFields(this._raw, this._dirtyMask');

    const confFile = files.find((f) => f.name === 'conformance_omnibuf.pb.ts');
    expect(confFile).toBeDefined();
    expect(confFile!.content).toContain('export interface TestAllTypes');
    expect(confFile!.content).toContain('export class OpaqueTestAllTypes');

    const highFiles = generateFromDescriptorSet({
      file: [
        {
          name: 'high.proto',
          package: 'omnibuf.high',
          syntax: 'proto3',
          messageType: [
            {
              name: 'ExtremeFieldMsg',
              field: [
                { name: 'low', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
                {
                  name: 'extreme',
                  number: 536870911,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_STRING',
                },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(highFiles[0]!.content.includes('1n << 536870911n'), false);
    expect(highFiles[0]!.content).toContain('_dirtySet');
  });
});

it('executes generated encoders, decoders and opaque mutations for maps, bytes, bools and int64', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const ts = await import('typescript');
  const dir = await mkdtemp(fileURLToPath(new URL('./generated-', import.meta.url)));
  try {
    const files = generateFromDescriptorSet({
      file: [
        {
          name: 'test.proto',
          package: 'test',
          messageType: [
            { name: 'Item', field: [{ name: 'id', number: 1, type: 'TYPE_UINT32' }] },
            {
              name: 'Example',
              field: [
                { name: 'flags', number: 1, type: 'TYPE_BOOL', label: 'LABEL_REPEATED' },
                { name: 'blobs', number: 2, type: 'TYPE_BYTES', label: 'LABEL_REPEATED' },
                { name: 'signed', number: 3, type: 'TYPE_INT64' },
                {
                  name: 'names',
                  number: 4,
                  type: 'TYPE_MESSAGE',
                  label: 'LABEL_REPEATED',
                  typeName: '.test.Example.NamesEntry',
                },
                {
                  name: 'items',
                  number: 5,
                  type: 'TYPE_MESSAGE',
                  label: 'LABEL_REPEATED',
                  typeName: '.test.Example.ItemsEntry',
                },
              ],
              nestedType: [
                {
                  name: 'NamesEntry',
                  options: { mapEntry: true },
                  field: [
                    { name: 'key', number: 1, type: 'TYPE_SINT32' },
                    { name: 'value', number: 2, type: 'TYPE_STRING' },
                  ],
                },
                {
                  name: 'ItemsEntry',
                  options: { mapEntry: true },
                  field: [
                    { name: 'key', number: 1, type: 'TYPE_STRING' },
                    { name: 'value', number: 2, type: 'TYPE_MESSAGE', typeName: '.test.Item' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const path = `${dir}/generated.ts`;
    await writeFile(path, files[0]!.content);
    const program = ts.createProgram([path], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    });
    assert.deepEqual(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [],
    );
    const generated = await import(pathToFileURL(path).href);
    const value = {
      flags: [false, true],
      blobs: [Uint8Array.from([255, 0]), new Uint8Array()],
      signed: -9223372036854775808n,
      names: { '-2': 'two' },
      items: { first: { id: 42 } },
    };
    const packet = generated.marshalExampleOmniBuf(value);
    assert.deepEqual(packet, generated.ExampleSchema.encode(value));
    const decoded = generated.decodeExample(packet);
    for (const key of ['flags', 'blobs', 'signed', 'names'])
      assert.deepEqual(decoded[key], value[key as keyof typeof value]);
    assert.equal(decoded.items.first.id, 42);
    const opaque = new generated.OpaqueExample(packet);
    assert.equal(opaque.getSigned(), value.signed);
    const namesFirst = opaque.getNames();
    assert.deepEqual(namesFirst, { '-2': 'two' });
    assert.equal(opaque.getNames(), namesFirst);
    const flagsFirst = opaque.getFlags();
    assert.equal(opaque.getFlags(), flagsFirst);
    assert.equal(opaque.getItems().first.id, 42);
    const selfDescUnmodified = opaque.marshal({ selfDescribing: true });
    assert.equal(selfDescUnmodified[0], 0x19);
    opaque.setNames({ '7': 'seven' });
    opaque.setFlags([true]);
    const changed = generated.decodeExample(opaque.marshal({ selfDescribing: true }));
    assert.deepEqual(changed.names, { '7': 'seven' });
    assert.deepEqual(changed.flags, [true]);
    assert.deepEqual(changed.blobs, value.blobs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('resolves nested messages, colliding short names, cross-file imports, enums, oneofs, and proto3_optional', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const ts = await import('typescript');
  const dir = await mkdtemp(fileURLToPath(new URL('./generated-multi-', import.meta.url)));
  try {
    const files = generateFromDescriptorSet({
      file: [
        {
          name: 'common.proto',
          package: 'pkg.common',
          enumType: [
            {
              name: 'Status',
              value: [
                { name: 'STATUS_UNSPECIFIED', number: 0 },
                { name: 'STATUS_OK', number: 1 },
              ],
            },
          ],
          messageType: [
            {
              name: 'Inner',
              field: [{ name: 'tag', number: 1, type: 'TYPE_STRING' }],
            },
          ],
        },
        {
          name: 'service.proto',
          package: 'pkg.svc',
          dependency: ['common.proto'],
          messageType: [
            {
              name: 'FirstOuter',
              field: [
                {
                  name: 'inner',
                  number: 1,
                  type: 'TYPE_MESSAGE',
                  typeName: '.pkg.svc.FirstOuter.Inner',
                },
              ],
              nestedType: [
                {
                  name: 'Inner',
                  field: [{ name: 'code', number: 1, type: 'TYPE_UINT32' }],
                },
              ],
            },
            {
              name: 'SecondOuter',
              oneofDecl: [{ name: 'choice' }, { name: '_opt_score' }],
              field: [
                {
                  name: 'local_inner',
                  number: 1,
                  type: 'TYPE_MESSAGE',
                  typeName: '.pkg.svc.SecondOuter.Inner',
                },
                {
                  name: 'common_inner',
                  number: 2,
                  type: 'TYPE_MESSAGE',
                  typeName: '.pkg.common.Inner',
                },
                { name: 'status', number: 3, type: 'TYPE_ENUM', typeName: '.pkg.common.Status' },
                { name: 'str_choice', number: 4, type: 'TYPE_STRING', oneofIndex: 0 },
                { name: 'num_choice', number: 5, type: 'TYPE_INT32', oneofIndex: 0 },
                {
                  name: 'opt_score',
                  number: 6,
                  type: 'TYPE_INT32',
                  oneofIndex: 1,
                  proto3Optional: true,
                },
                {
                  name: 'extreme_tag',
                  number: 536870911,
                  type: 'TYPE_STRING',
                },
              ],
              nestedType: [
                {
                  name: 'Inner',
                  field: [{ name: 'label', number: 1, type: 'TYPE_STRING' }],
                },
              ],
            },
          ],
        },
      ],
    });

    const commonPath = `${dir}/common_omnibuf.pb.ts`;
    const servicePath = `${dir}/service_omnibuf.pb.ts`;
    await writeFile(commonPath, files[0]!.content);
    await writeFile(servicePath, files[1]!.content);

    const program = ts.createProgram([commonPath, servicePath], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    });
    assert.deepEqual(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [],
    );

    const svcMod = await import(pathToFileURL(servicePath).href);
    const commonMod = await import(pathToFileURL(commonPath).href);

    const msg = svcMod.createSecondOuter({
      localInner: { label: 'nested-second' },
      commonInner: { tag: 'from-common' },
      status: commonMod.Status.STATUS_OK,
      choice: { case: 'numChoice', value: -42 },
      optScore: 0,
    });

    const wire = svcMod.marshalSecondOuterOmniBuf(msg, {
      selfDescribing: true,
      deterministic: true,
    });
    const decoded = svcMod.decodeSecondOuter(wire);
    assert.equal(decoded.localInner.label, 'nested-second');
    assert.equal(decoded.commonInner.tag, 'from-common');
    assert.equal(decoded.status, commonMod.Status.STATUS_OK);
    assert.deepEqual(decoded.choice, { case: 'numChoice', value: -42 });
    assert.equal(decoded.optScore, 0);

    const opaque = new svcMod.OpaqueSecondOuter(wire);
    assert.equal(opaque.getLocalInner().label, 'nested-second');
    assert.equal(opaque.getCommonInner().tag, 'from-common');
    assert.equal(opaque.getNumChoice(), -42);
    assert.equal(opaque.getStrChoice(), undefined);
    assert.equal(opaque.getOptScore(), 0);
    opaque.setExtremeTag('max-field-536870911');
    const updatedExtreme = svcMod.decodeSecondOuter(opaque.marshal());
    assert.equal(updatedExtreme.extremeTag, 'max-field-536870911');
    assert.equal(updatedExtreme.localInner.label, 'nested-second');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('CLI executable handles cross-file references, colliding field names, negative enums, and multi-member oneof wire packets', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const {
    create: pbCreate,
    toBinary: pbToBinary,
    fromBinary: pbFromBinary,
  } = await import('@bufbuild/protobuf');
  const {
    CodeGeneratorRequestSchema,
    CodeGeneratorResponseSchema,
    FieldDescriptorProto_Label,
    FieldDescriptorProto_Type,
  } = await import('@bufbuild/protobuf/wkt');
  const ts = await import('typescript');

  const cliBinPath = fileURLToPath(
    new URL('../dist/bin/protoc-gen-omnibuf-es.js', import.meta.url),
  );

  const reqMsg = pbCreate(CodeGeneratorRequestSchema, {
    fileToGenerate: ['common.proto', 'service.proto'],
    protoFile: [
      {
        name: 'common.proto',
        package: 'common',
        syntax: 'proto3',
        enumType: [
          {
            name: 'ErrorCode',
            value: [
              { name: 'ERR_UNKNOWN', number: -1 },
              { name: 'ERR_NONE', number: 0 },
              { name: 'ERR_FATAL', number: -100 },
            ],
          },
        ],
        messageType: [
          {
            name: 'Item',
            field: [
              {
                name: 'id',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.STRING,
              },
              {
                name: 'code',
                number: 2,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.ENUM,
                typeName: '.common.ErrorCode',
              },
            ],
          },
        ],
      },
      {
        name: 'service.proto',
        package: 'service',
        syntax: 'proto3',
        dependency: ['common.proto'],
        messageType: [
          {
            name: 'Envelope',
            oneofDecl: [{ name: 'choice' }],
            field: [
              {
                name: 'item',
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: '.common.Item',
              },
              {
                name: 'raw',
                number: 2,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.STRING,
              },
              {
                name: 'marshal',
                number: 3,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.UINT32,
              },
              {
                name: 'dirty_mask',
                number: 4,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.INT32,
              },
              {
                name: 'a',
                number: 5,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.STRING,
                oneofIndex: 0,
              },
              {
                name: 'b',
                number: 6,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.STRING,
                oneofIndex: 0,
              },
              {
                name: 'codes',
                number: 7,
                label: FieldDescriptorProto_Label.REPEATED,
                type: FieldDescriptorProto_Type.ENUM,
                typeName: '.common.ErrorCode',
              },
            ],
          },
        ],
      },
    ],
  });

  const reqBytes = pbToBinary(CodeGeneratorRequestSchema, reqMsg);

  const stdoutBytes = await new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(process.execPath, [cliBinPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => outChunks.push(c));
    child.stderr.on('data', (c: Buffer) => errChunks.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`CLI exited with code ${code}: ${Buffer.concat(errChunks).toString('utf8')}`),
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(outChunks)));
    });
    child.stdin.end(Buffer.from(reqBytes));
  });

  const resp = pbFromBinary(CodeGeneratorResponseSchema, stdoutBytes);
  assert.equal(resp.error, '');
  assert.equal(resp.file.length, 2);

  const dir = await mkdtemp(fileURLToPath(new URL('./generated-cli-', import.meta.url)));
  try {
    const commonPath = `${dir}/common_omnibuf.pb.ts`;
    const servicePath = `${dir}/service_omnibuf.pb.ts`;
    const commonFile = resp.file.find((f) => f.name === 'common_omnibuf.pb.ts')!;
    const serviceFile = resp.file.find((f) => f.name === 'service_omnibuf.pb.ts')!;
    assert.ok(commonFile);
    assert.ok(serviceFile);
    assert.match(
      serviceFile.content,
      /import[\s\S]*ItemSchema[\s\S]*from ["']\.\/common_omnibuf\.pb\.js["']/,
    );

    await writeFile(commonPath, commonFile.content);
    await writeFile(servicePath, serviceFile.content);

    const program = ts.createProgram([commonPath, servicePath], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    });
    assert.deepEqual(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
      [],
    );

    const commonMod = await import(pathToFileURL(commonPath).href);
    const svcMod = await import(pathToFileURL(servicePath).href);

    // 1. Verify colliding field names (`raw`, `marshal`, `dirty_mask`) and negative enums
    const env = svcMod.createEnvelope({
      item: { id: 'item-1', code: commonMod.ErrorCode.ERR_UNKNOWN },
      raw: 'raw-field-payload',
      marshal: 777,
      dirtyMask: -99,
      choice: { case: 'a', value: 'initial-a' },
      codes: [
        commonMod.ErrorCode.ERR_UNKNOWN,
        commonMod.ErrorCode.ERR_NONE,
        commonMod.ErrorCode.ERR_FATAL,
      ],
    });
    const encoded = svcMod.marshalEnvelopeOmniBuf(env);
    const decoded = svcMod.decodeEnvelope(encoded);
    assert.equal(decoded.item.id, 'item-1');
    assert.equal(decoded.item.code, -1);
    assert.equal(decoded.raw, 'raw-field-payload');
    assert.equal(decoded.marshal, 777);
    assert.equal(decoded.dirtyMask, -99);
    assert.deepEqual(decoded.codes, [-1, 0, -100]);

    const opEnv = new svcMod.OpaqueEnvelope(encoded);
    assert.equal(opEnv.getRaw(), 'raw-field-payload');
    assert.equal(opEnv.getMarshal(), 777);
    assert.equal(opEnv.getDirtyMask(), -99);
    assert.deepEqual(opEnv.getCodes(), [-1, 0, -100]);
    assert.equal(opEnv.raw(), encoded);
    opEnv.setRaw('updated-raw');
    opEnv.setMarshal(888);
    const reEncoded = opEnv.marshal();
    const reDecoded = svcMod.decodeEnvelope(reEncoded);
    assert.equal(reDecoded.raw, 'updated-raw');
    assert.equal(reDecoded.marshal, 888);
    assert.equal(reDecoded.item.code, -1);

    // 2. Verify oneof wire packet containing member `a` followed by member `b`
    const pktA = svcMod.marshalEnvelopeOmniBuf({
      raw: 'keep-me',
      choice: { case: 'a', value: 'superseded-a' },
    });
    const pktB = svcMod.marshalEnvelopeOmniBuf({
      raw: 'keep-me',
      choice: { case: 'b', value: 'winner-b' },
    });
    const combinedOneofPkt = new Uint8Array(pktA.length + pktB.length);
    combinedOneofPkt.set(pktA, 0);
    combinedOneofPkt.set(pktB, pktA.length);

    // Full decoder selects b
    const fullDecoded = svcMod.decodeEnvelope(combinedOneofPkt);
    assert.deepEqual(fullDecoded.choice, { case: 'b', value: 'winner-b' });

    // Reflective schema decoder also selects b
    const schemaDecoded = svcMod.EnvelopeSchema.decode(combinedOneofPkt);
    assert.deepEqual(schemaDecoded.choice, { case: 'b', value: 'winner-b' });

    // Opaque getter exposes only winner b, not superseded a
    const opaqueCombined = new svcMod.OpaqueEnvelope(combinedOneofPkt);
    assert.equal(opaqueCombined.getA(), undefined);
    assert.equal(opaqueCombined.getB(), 'winner-b');

    // Calling setA("replacement") and marshaling clears b on the wire so decoding selects a = "replacement"
    opaqueCombined.setA('replacement');
    assert.equal(opaqueCombined.getA(), 'replacement');
    assert.equal(opaqueCombined.getB(), undefined);

    const marshaledAfterSetA = opaqueCombined.marshal();
    const afterSetADecoded = svcMod.decodeEnvelope(marshaledAfterSetA);
    assert.deepEqual(afterSetADecoded.choice, { case: 'a', value: 'replacement' });
    assert.equal(afterSetADecoded.raw, 'keep-me');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('generated codecs enforce Spec §10 container depth, empty map headers, 32-bit coercion, proto2 presence, Opaque clean validation/copying, and reserved checks', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const ts = await import('typescript');

  assert.throws(
    () =>
      generateFromDescriptorSet({
        file: [
          {
            name: 'bad_reserved.proto',
            syntax: 'proto3',
            messageType: [
              { name: 'Bad', field: [{ name: 'x', number: 19000, type: 'TYPE_UINT32' }] },
            ],
          },
        ],
      }),
    /reserved/i,
  );

  assert.throws(
    () =>
      generateFromDescriptorSet({
        file: [
          {
            name: 'bad_group.proto',
            syntax: 'proto2',
            messageType: [
              { name: 'BadGrp', field: [{ name: 'g', number: 1, type: 'TYPE_GROUP' }] },
            ],
          },
        ],
      }),
    /group/i,
  );

  const fds: FileDescriptorSetJSON = {
    file: [
      {
        name: 'p2_edge.proto\n*/ alert(1); /*',
        package: 'edge',
        syntax: 'proto2',
        messageType: [
          {
            name: 'Sub',
            field: [{ name: 'val', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' }],
          },
          {
            name: 'MapEntry',
            options: { mapEntry: true },
            field: [
              { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
              { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
            ],
          },
          {
            name: 'Holder',
            nestedType: [],
            field: [
              { name: 'opt_num', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
              {
                name: 'subs',
                number: 2,
                label: 'LABEL_REPEATED',
                type: 'TYPE_MESSAGE',
                typeName: '.edge.Sub',
              },
              {
                name: 'scores',
                number: 3,
                label: 'LABEL_REPEATED',
                type: 'TYPE_MESSAGE',
                typeName: '.edge.MapEntry',
              },
              { name: 'has_own_property', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            ],
          },
        ],
      },
    ],
  };

  const generated = generateFromDescriptorSet(fds);
  assert.equal(generated.length, 1);
  assert.ok(!generated[0]!.content.includes('\n*/ alert(1);'));

  const coreBase = fileURLToPath(new URL('../../omnibuf/dist', import.meta.url));
  const dir = await mkdtemp(join(coreBase, '.tmp-edge-test-'));
  try {
    const outPath = join(dir, 'edge_omnibuf.pb.mjs');
    const js = ts.transpileModule(generated[0]!.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText;
    await writeFile(outPath, js, 'utf8');
    const mod = await import(pathToFileURL(outPath).href);

    // 1. Proto2 explicit presence: unset optNum is undefined, explicit 0 round-trips as 0
    assert.equal(mod.createHolder().optNum, undefined);
    const zeroBytes = mod.marshalHolderOmniBuf({ optNum: 0 });
    assert.ok(zeroBytes.length > 0);
    assert.equal(mod.decodeHolder(new Uint8Array(0)).optNum, undefined);
    assert.equal(mod.decodeHolder(zeroBytes).optNum, 0);

    // 2. 32-bit wrap on encode for INT32 scalar and map value (0x1_0000_0005 -> 5)
    const wrappedBytes = mod.marshalHolderOmniBuf({
      optNum: 0x1_0000_0005,
      scores: { k: 0x1_0000_0007 },
      subs: [null as unknown, { val: 0x1_0000_0009 }],
    });
    const wrappedDec = mod.decodeHolder(wrappedBytes);
    assert.equal(wrappedDec.optNum, 5);
    assert.equal(wrappedDec.scores.k, 7);
    assert.equal(wrappedDec.subs.length, 2);
    assert.equal(wrappedDec.subs[1].val, 9);

    // 3. Empty map with wrong wire types (e.g. string->string 10/10 instead of string->sint 10/1) rejected
    const badEmptyMap = new Uint8Array([(((3 << 4) | 14) << 1) | 1, 0x07, 10, 10, 0x01]);
    assert.throws(() => mod.decodeHolder(badEmptyMap), /map/i);

    // 4. Container depth: recursionLimit = 0 rejects repeated/map at depth 1; recursionLimit = 1 rejects submsg element at depth 2
    assert.throws(
      () => mod.decodeHolder(wrappedBytes, undefined, 0, { recursionLimit: 0 }),
      /nesting depth/,
    );
    assert.throws(
      () => mod.decodeHolder(wrappedBytes, undefined, 0, { recursionLimit: 1 }),
      /nesting depth/,
    );

    // 5. Target reset deletes stale snake_case own property
    const plainTarget: Record<string, unknown> = { opt_num: 999 };
    mod.decodeHolder(new Uint8Array(0), plainTarget);
    assert.equal(Object.hasOwn(plainTarget, 'opt_num'), false);

    // 6. Clean Opaque.marshal() validates corrupt bytes and returns an independent copy on valid bytes
    const corruptOpaque = new mod.OpaqueHolder(new Uint8Array([0x55]));
    assert.throws(() => corruptOpaque.marshal());
    const cleanOpaque = new mod.OpaqueHolder(zeroBytes);
    const cleanOut = cleanOpaque.marshal();
    assert.deepEqual(cleanOut, zeroBytes);
    assert.notEqual(cleanOut, zeroBytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('generated codecs support zeroCopy decode, Opaque view helpers, lazy nested Opaque caching, and tryMarshal', async () => {
  const fds: FileDescriptorSetJSON = {
    file: [
      {
        name: 'zerocopy.proto',
        package: 'test.zc',
        syntax: 'proto3',
        messageType: [
          {
            name: 'Leaf',
            field: [
              { name: 'id', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
              { name: 'blob', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
            ],
          },
          {
            name: 'Container',
            field: [
              { name: 'payload', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
              { name: 'chunks', number: 2, label: 'LABEL_REPEATED', type: 'TYPE_BYTES' },
              {
                name: 'leaf',
                number: 3,
                label: 'LABEL_OPTIONAL',
                type: 'TYPE_MESSAGE',
                typeName: '.test.zc.Leaf',
              },
              {
                name: 'dict',
                number: 4,
                label: 'LABEL_REPEATED',
                type: 'TYPE_MESSAGE',
                typeName: '.test.zc.Container.DictEntry',
              },
            ],
            nestedType: [
              {
                name: 'DictEntry',
                options: { mapEntry: true },
                field: [
                  { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                  { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const files = generateFromDescriptorSet(fds);
  const dir = await mkdtemp(fileURLToPath(new URL('./tmp-zc-', import.meta.url)));
  try {
    const outPath = `${dir}/${files[0]!.name}`;
    await writeFile(outPath, files[0]!.content);
    const mod = await import(pathToFileURL(outPath).href);

    const wire: Uint8Array = mod.marshalContainerOmniBuf({
      payload: new Uint8Array([1, 2, 3]),
      chunks: [new Uint8Array([4, 5]), new Uint8Array([6, 7])],
      leaf: { id: 42, blob: new Uint8Array([8, 9]) },
      dict: { a: new Uint8Array([10, 11]) },
    });

    // Default decode copies bytes
    const copied = mod.decodeContainer(wire);
    assert.notEqual(copied.payload.buffer, wire.buffer);
    assert.notEqual(copied.chunks[0].buffer, wire.buffer);
    assert.notEqual(copied.dict.a.buffer, wire.buffer);

    // zeroCopy: true returns subarray views into input buffer
    const viewed = mod.decodeContainer(wire, undefined, 0, { zeroCopy: true });
    assert.equal(viewed.payload.buffer, wire.buffer);
    assert.equal(viewed.chunks[0].buffer, wire.buffer);
    assert.equal(viewed.dict.a.buffer, wire.buffer);
    assert.equal(viewed.leaf.blob.buffer, wire.buffer);

    // Opaque zero-copy view helpers, lazy nested Opaque caching, and tryMarshal
    const op = new mod.OpaqueContainer(wire);
    const pView: Uint8Array = op.getPayloadView();
    assert.equal(pView.buffer, wire.buffer);
    assert.deepEqual(Array.from(pView), [1, 2, 3]);

    const cViews: Uint8Array[] = op.getChunksView();
    assert.equal(cViews.length, 2);
    assert.equal(cViews[0]!.buffer, wire.buffer);

    const leafOp1 = op.getLeafOpaque();
    const leafOp2 = op.getLeafOpaque();
    assert.ok(leafOp1);
    assert.equal(leafOp1, leafOp2, 'Expected lazy nested Opaque to be cached');
    assert.equal(leafOp1.getId(), 42);
    assert.equal(leafOp1.getBlobView().buffer, wire.buffer);

    const okRes = op.tryMarshal();
    assert.equal(okRes.ok, true);
    assert.deepEqual(okRes.value, wire);

    const badOp = new mod.OpaqueContainer(new Uint8Array([0x55]));
    const errRes = badOp.tryMarshal();
    assert.equal(errRes.ok, false);
    assert.ok(errRes.error instanceof Error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function compileAndImportGenerated(fds: FileDescriptorSetJSON): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mod: Record<string, any>;
  content: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(fileURLToPath(new URL('./tmp-gen-', import.meta.url)));
  const files = generateFromDescriptorSet(fds);
  const filePath = `${dir}/${files[0]!.name}`;
  await writeFile(filePath, files[0]!.content);
  const mod = await import(pathToFileURL(filePath).href);
  return {
    mod,
    content: files[0]!.content,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const EDGE_CASES_FDS: FileDescriptorSetJSON = {
  file: [
    {
      name: 'edge_types.proto',
      package: 'omnibuf.edge',
      syntax: 'proto3',
      messageType: [
        {
          name: 'PeerUpdate',
          field: [
            { name: 'asn', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'router_id', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
          ],
        },
        {
          name: 'TestAllTypes',
          field: [
            { name: 'f13_float32', number: 13, label: 'LABEL_OPTIONAL', type: 'TYPE_FLOAT' },
            {
              name: 'f12_map',
              number: 12,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.edge.TestAllTypes.F12MapEntry',
            },
          ],
          nestedType: [
            {
              name: 'F12MapEntry',
              options: { mapEntry: true },
              field: [
                { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT64' },
              ],
            },
          ],
        },
        {
          name: 'SubBranch',
          field: [{ name: 'code', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' }],
        },
        {
          name: 'OneofHolder',
          oneofDecl: [{ name: 'choice' }],
          field: [
            {
              name: 'sub',
              number: 1,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.edge.SubBranch',
              oneofIndex: 0,
            },
            {
              name: 'name',
              number: 2,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_STRING',
              oneofIndex: 0,
            },
          ],
        },
        {
          name: 'Node',
          field: [
            {
              name: 'child',
              number: 1,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.edge.Node',
            },
            { name: 'leaf', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            {
              name: 'children',
              number: 3,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.edge.Node',
            },
            {
              name: 'child_map',
              number: 4,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.edge.Node.ChildMapEntry',
            },
          ],
          nestedType: [
            {
              name: 'ChildMapEntry',
              options: { mapEntry: true },
              field: [
                { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                {
                  name: 'value',
                  number: 2,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_MESSAGE',
                  typeName: '.omnibuf.edge.Node',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('@omnibuf/protoc-gen-omnibuf-es - Generated Codec & Opaque Invariants', () => {
  it('avoids identifier collisions with @omnibuf/core imports and JS globals', async () => {
    const dir = await mkdtemp(fileURLToPath(new URL('./tmp-collisions-', import.meta.url)));
    try {
      const files = generateFromDescriptorSet({
        file: [
          {
            name: 'collisions.proto',
            package: 'test.collisions',
            syntax: 'proto3',
            enumType: [
              { name: 'Error', value: [{ name: 'ERR_NONE', number: 0 }] },
              { name: 'Number', value: [{ name: 'NUM_ZERO', number: 0 }] },
            ],
            messageType: [
              {
                name: 'Message',
                field: [{ name: 'id', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' }],
              },
            ],
          },
        ],
      });

      const content = files[0]!.content;
      const filePath = `${dir}/${files[0]!.name}`;
      await writeFile(filePath, content);

      if (content.includes('export interface Message ')) {
        assert.equal(
          /import\s*\{[^}]*\btype\s+Message\b(?!\s+as\s+)/s.test(content),
          false,
          'Generated file must not import unqualified `type Message` alongside `export interface Message`',
        );
      }
      if (content.includes('export enum Error ')) {
        assert.equal(
          /(?<!\.)\bnew Error\(/.test(content),
          false,
          'Generated file must not call unqualified `new Error(...)` shadowed by `export enum Error`',
        );
      }
      if (content.includes('export enum Number ')) {
        assert.equal(
          /(?<!\.)\bNumber\(/.test(content),
          false,
          'Generated file must not call unqualified `Number(...)` shadowed by `export enum Number`',
        );
      }

      const program = ts.createProgram([filePath], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      });
      const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      assert.deepEqual(diagnostics, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sorts deterministic map<string, uint64> keys by UTF-8 bytes in generated encoders', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const kPua = '\uE000_pua';
      const kFullwidth = '！_fullwidth';
      const kAstral = '🚀_astral';

      const wire: Uint8Array = mod.marshalTestAllTypesOmniBuf(
        {
          f12Map: {
            [kAstral]: 3n,
            [kFullwidth]: 2n,
            [kPua]: 1n,
          },
        },
        { deterministic: true },
      );

      const utf8 = new TextEncoder();
      const posPua = findSubsequence(wire, utf8.encode(kPua));
      const posFullwidth = findSubsequence(wire, utf8.encode(kFullwidth));
      const posAstral = findSubsequence(wire, utf8.encode(kAstral));

      assert.ok(
        posPua >= 0 && posFullwidth > posPua && posAstral > posFullwidth,
        `Expected generated deterministic map wire order PUA < Fullwidth < Astral, got offsets ${posPua}, ${posFullwidth}, ${posAstral}`,
      );
    } finally {
      await cleanup();
    }
  });

  it('rejects unknown WireString fields containing invalid UTF-8 in Opaque.marshal()', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const valid: Uint8Array = mod.marshalPeerUpdateOmniBuf({ asn: 65001, routerId: 'edge-1' });
      const extraEnc = new Encoder();
      extraEnc.writeTag(99, WireString);
      extraEnc.writeRawVarint(2);
      extraEnc.writeRaw(Uint8Array.from([0xff, 0xfe]));
      const extra = extraEnc.finish();

      const combined = new Uint8Array(valid.length + extra.length);
      combined.set(valid, 0);
      combined.set(extra, valid.length);

      const op = new mod.OpaquePeerUpdate(combined);
      assert.throws(
        () => op.marshal(),
        /UTF-8|utf-8|utf8/i,
        'Expected OpaquePeerUpdate.marshal() to reject invalid UTF-8 in unknown WireString field',
      );
    } finally {
      await cleanup();
    }
  });

  it('propagates depth + 1 in generated Opaque sub-message getters', async () => {
    const { mod, content, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      // Build a packet nested to MaxNestingDepth + 1 (33 nested child sub-messages)
      let nested: Record<string, unknown> = { leaf: 7 };
      for (let i = 0; i < MaxNestingDepth + 1; i++) {
        nested = { child: nested };
      }
      const deepBytes: Uint8Array = mod.marshalNodeOmniBuf(nested);

      // Direct decode rejects depth > MaxNestingDepth
      assert.throws(() => mod.decodeNode(deepBytes), /MaxNestingDepth|nesting depth/i);

      // Opaque sub-message getter must also enforce depth + 1 rather than resetting depth to 0
      const opaqueRoot = new mod.OpaqueNode(deepBytes);
      assert.throws(
        () => opaqueRoot.getChild(),
        /MaxNestingDepth|nesting depth/i,
        'Expected OpaqueNode.getChild() not to bypass MaxNestingDepth via depth = 0',
      );
      assert.equal(
        content.includes('decodeNode(sub, target, 0,'),
        false,
        'Generated Opaque sub-message getter should not hardcode depth 0',
      );
    } finally {
      await cleanup();
    }
  });

  it('preserves active sibling oneof branch when clearing an inactive sub-message branch on Opaque', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const src: Uint8Array = mod.marshalOneofHolderOmniBuf({ name: 'active' });
      assert.equal(mod.decodeOneofHolder(src).name, 'active');

      const op = new mod.OpaqueOneofHolder(src);
      op.setSub(null);
      const out: Uint8Array = op.marshal();
      const decoded = mod.decodeOneofHolder(out);
      assert.equal(decoded.name, 'active');
    } finally {
      await cleanup();
    }
  });

  it('returns an independent buffer from clean Opaque.marshal() instead of aliasing _raw', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const src: Uint8Array = mod.marshalPeerUpdateOmniBuf({ asn: 64512, routerId: 'rtr-01' });
      const originalFirstByte = src[0]!;

      const op = new mod.OpaquePeerUpdate(src);
      const out: Uint8Array = op.marshal();
      out[0]! ^= 0xff;

      assert.equal(
        src[0],
        originalFirstByte,
        'Mutating OpaquePeerUpdate.marshal() output must not mutate source buffer',
      );
    } finally {
      await cleanup();
    }
  });

  it('preserves exact IEEE-754 binary32 float values in generated decoders and Opaque getters', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const expected = Math.fround(0.1);
      const bytes: Uint8Array = mod.marshalTestAllTypesOmniBuf({ f13Float32: expected });

      assert.equal(readFloat32(bytes, 13)[0], expected);
      assert.equal(mod.decodeTestAllTypes(bytes).f13Float32, expected);
      assert.equal(new mod.OpaqueTestAllTypes(bytes).getF13Float32(), expected);
    } finally {
      await cleanup();
    }
  });

  it('marshals generated message instances via top-level marshal()', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const msg = mod.createPeerUpdate({ asn: 100 });
      const bytes = marshal(msg);
      const decoded = mod.decodePeerUpdate(bytes);
      assert.equal(decoded.asn, 100);
    } finally {
      await cleanup();
    }
  });

  it('returns defaults on repeated Opaque getter calls for corrupt Field #0 or truncated packets', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      const valid: Uint8Array = mod.marshalPeerUpdateOmniBuf({ asn: 64512, routerId: 'rtr-1' });
      // Prepend invalid Field #0 (field 0, WireUint = 0x01, val = 0x03)
      const badF0 = new Uint8Array(2 + valid.length);
      badF0.set([0x01, 0x03], 0);
      badF0.set(valid, 2);

      const opBadF0 = new mod.OpaquePeerUpdate(badF0);
      // 1st, 2nd, 3rd, and 4th calls (crossing _readCount >= 2 index build) must all return default 0 / ''
      for (let i = 0; i < 4; i++) {
        assert.equal(opBadF0.getAsn(), 0, `call ${i + 1} getAsn should be 0 on invalid Field #0`);
        assert.equal(
          opBadF0.getRouterId(),
          '',
          `call ${i + 1} getRouterId should be '' on invalid Field #0`,
        );
      }

      // Append trailing truncated tag
      const truncated = new Uint8Array(valid.length + 1);
      truncated.set(valid, 0);
      truncated[valid.length] = 0x61; // field #3 WireUint tag with missing value
      const opTrunc = new mod.OpaquePeerUpdate(truncated);
      for (let i = 0; i < 4; i++) {
        assert.equal(opTrunc.getAsn(), 0, `call ${i + 1} getAsn should be 0 on truncated packet`);
      }
    } finally {
      await cleanup();
    }
  });

  it('enforces MaxNestingDepth in Opaque map/repeated submessage getters and spliceFields', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      // Build a chain of depth 31: inside repeated children or childMap (depth + 2), total depth is 33 > 32
      let chain: Record<string, unknown> = { leaf: 1 };
      for (let i = 0; i < MaxNestingDepth - 1; i++) {
        chain = { child: chain };
      }

      const arrBytes: Uint8Array = mod.marshalNodeOmniBuf({ children: [chain] });
      assert.throws(() => mod.decodeNode(arrBytes), /MaxNestingDepth|nesting depth/i);
      const opArr = new mod.OpaqueNode(arrBytes);
      assert.throws(
        () => opArr.getChildren(),
        /MaxNestingDepth|nesting depth/i,
        'OpaqueNode.getChildren() must pass depth + 2',
      );

      const mapBytes: Uint8Array = mod.marshalNodeOmniBuf({ childMap: { a: chain } });
      assert.throws(() => mod.decodeNode(mapBytes), /MaxNestingDepth|nesting depth/i);
      const opMap = new mod.OpaqueNode(mapBytes);
      assert.throws(
        () => opMap.getChildMap(),
        /MaxNestingDepth|nesting depth/i,
        'OpaqueNode.getChildMap() must pass depth + 2 and rethrow depth errors',
      );

      // OpaqueNode at depth = MaxNestingDepth with a child submessage must reject dirty marshal via spliceFields
      const oneChildBytes: Uint8Array = mod.marshalNodeOmniBuf({ child: { leaf: 5 } });
      const opDeep = new mod.OpaqueNode(oneChildBytes, MaxNestingDepth);
      opDeep.setLeaf(9);
      assert.throws(
        () => opDeep.marshal(),
        /nesting depth/i,
        'OpaqueNode.marshal() must thread this._depth into spliceFields',
      );
    } finally {
      await cleanup();
    }
  });

  it('preserves Field #0 names past depth 15 on cyclic messages in generated marshalers', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(EDGE_CASES_FDS);
    try {
      let nested: Record<string, unknown> = { leaf: 77 };
      for (let i = 0; i < 20; i++) {
        nested = { child: nested };
      }
      const bytes: Uint8Array = mod.marshalNodeOmniBuf(nested, { selfDescribing: true });
      let cur: Record<string, unknown> = decodeBlind(bytes);
      for (let i = 0; i < 20; i++) {
        assert.ok(
          cur && typeof cur === 'object' && 'child' in cur,
          `Expected named 'child' field at depth ${i}, got keys [${Object.keys(cur ?? {}).join(', ')}]`,
        );
        cur = cur.child as Record<string, unknown>;
      }
      assert.equal(cur.leaf, 77);
    } finally {
      await cleanup();
    }
  });

  it('enforces Opaque bytes copying, depth propagation, merge array rollback, and dirty nested Opaque views', async () => {
    const fds: FileDescriptorSetJSON = {
      file: [
        {
          name: 'edge_extra.proto',
          package: 'omnibuf.edge2',
          syntax: 'proto3',
          messageType: [
            {
              name: 'Item',
              field: [{ name: 'code', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' }],
            },
            {
              name: 'Holder',
              oneofDecl: [{ name: 'choice' }],
              field: [
                { name: 'payload', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
                { name: 'tags', number: 2, label: 'LABEL_REPEATED', type: 'TYPE_STRING' },
                { name: 'ids', number: 3, label: 'LABEL_REPEATED', type: 'TYPE_UINT32' },
                {
                  name: 'items',
                  number: 4,
                  label: 'LABEL_REPEATED',
                  type: 'TYPE_MESSAGE',
                  typeName: '.omnibuf.edge2.Item',
                },
                {
                  name: 'sub',
                  number: 5,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_MESSAGE',
                  typeName: '.omnibuf.edge2.Item',
                },
                {
                  name: 'oneof_sub',
                  number: 6,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_MESSAGE',
                  typeName: '.omnibuf.edge2.Item',
                  oneofIndex: 0,
                },
                {
                  name: 'oneof_name',
                  number: 7,
                  label: 'LABEL_OPTIONAL',
                  type: 'TYPE_STRING',
                  oneofIndex: 0,
                },
                {
                  name: 'scores',
                  number: 8,
                  label: 'LABEL_REPEATED',
                  type: 'TYPE_MESSAGE',
                  typeName: '.omnibuf.edge2.Holder.ScoresEntry',
                },
              ],
              nestedType: [
                {
                  name: 'ScoresEntry',
                  options: { mapEntry: true },
                  field: [
                    { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                    { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_FLOAT' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const { mod, cleanup } = await compileAndImportGenerated(fds);
    try {
      // 1. Opaque.getPayload() returns a copy detached from _raw; getPayloadView() stays zero-copy
      const payloadWire: Uint8Array = mod.marshalHolderOmniBuf({
        payload: Uint8Array.from([1, 2, 3, 4]),
      });
      const opPayload = new mod.OpaqueHolder(payloadWire);
      const got = opPayload.getPayload();
      assert.notEqual(got.buffer, opPayload.raw().buffer);
      got[0] = 0xff;
      assert.equal(opPayload.getPayload()[0], 1);
      const view = opPayload.getPayloadView();
      assert.equal(view.buffer, opPayload.raw().buffer);

      // 2. Opaque array/map getters enforce this._depth + 1 <= MaxNestingDepth
      const deepOp = new mod.OpaqueHolder(
        mod.marshalHolderOmniBuf({ tags: ['x'], scores: { a: Math.fround(0.1) } }),
        MaxNestingDepth,
      );
      assert.throws(() => deepOp.getTags(), /MaxNestingDepth|nesting depth/i);
      assert.throws(() => deepOp.getScores(), /MaxNestingDepth|nesting depth/i);

      // 3. Opaque float32 map preserves exact Math.fround(0.1)
      const mapWire: Uint8Array = mod.marshalHolderOmniBuf({
        scores: { pi: Math.fround(0.1) },
      });
      const opMap = new mod.OpaqueHolder(mapWire);
      assert.equal(opMap.getScores()['pi'], Math.fround(0.1));

      // 4. Merge-mode fast array decoders roll back dst.length on error (no sparse holes)
      const target = mod.createHolder({
        tags: ['orig'],
        ids: [10],
        items: [mod.createItem({ code: 1 })],
      });

      // Corrupt STRING[] (field 2, WireArray): count=2, elem0='ok', elem1=invalid UTF-8 [0xff, 0xfe]
      const badStrEnc = new Encoder();
      badStrEnc.writeTag(2, WireArray);
      badStrEnc.beginContainer();
      badStrEnc.writeByte(WireString);
      badStrEnc.writeRawVarint(2);
      badStrEnc.writeRawStringPayload('ok');
      badStrEnc.writeRawVarint(2);
      badStrEnc.writeRaw(Uint8Array.from([0xff, 0xfe]));
      badStrEnc.endContainer();
      assert.throws(() => mod.decodeHolder(badStrEnc.finish(), target, 0, { merge: true }));
      assert.deepEqual(target.tags, ['orig']);

      // Corrupt UINT32[] (field 3, WireArray): count=2, elem0=20, elem1=truncated 2-byte varint (0x02)
      const badU32Enc = new Encoder();
      badU32Enc.writeTag(3, WireArray);
      badU32Enc.beginContainer();
      badU32Enc.writeByte(WireUint);
      badU32Enc.writeRawVarint(2);
      badU32Enc.writeRawVarint(20);
      badU32Enc.writeByte(0x02);
      badU32Enc.endContainer();
      assert.throws(() => mod.decodeHolder(badU32Enc.finish(), target, 0, { merge: true }));
      assert.deepEqual(target.ids, [10]);

      // Corrupt MESSAGE[] (field 4, WireArray): count=2, elem0=valid Item, elem1=truncated submsg
      const badMsgEnc = new Encoder();
      badMsgEnc.writeTag(4, WireArray);
      badMsgEnc.beginContainer();
      badMsgEnc.writeByte(WireSubMsg);
      badMsgEnc.writeRawVarint(2);
      const validItem = mod.marshalItemOmniBuf({ code: 2 });
      badMsgEnc.writeRawVarint(validItem.length);
      badMsgEnc.writeRaw(validItem);
      badMsgEnc.writeRawVarint(1);
      badMsgEnc.writeByte(0x21); // field 1 WireUint tag with missing value
      badMsgEnc.endContainer();
      assert.throws(() => mod.decodeHolder(badMsgEnc.finish(), target, 0, { merge: true }));
      assert.equal(target.items.length, 1);
      assert.equal(target.items[0].code, 1);

      // 5. Opaque.get<SubMsg>Opaque() reflects dirty set<SubMsg>() and oneof switches
      const subWire: Uint8Array = mod.marshalHolderOmniBuf({
        sub: { code: 10 },
        oneofSub: { code: 20 },
      });
      const opSub = new mod.OpaqueHolder(subWire);
      assert.equal(opSub.getSubOpaque()?.getCode(), 10);
      assert.equal(opSub.getOneofSubOpaque()?.getCode(), 20);

      opSub.setSub(mod.createItem({ code: 99 }));
      const dirtyOpaque = opSub.getSubOpaque();
      assert.equal(dirtyOpaque?.getCode(), 99);
      assert.strictEqual(opSub.getSubOpaque(), dirtyOpaque);

      opSub.setSub(null);
      assert.equal(opSub.getSubOpaque(), undefined);

      opSub.setOneofName('switched');
      assert.equal(opSub.getOneofSubOpaque(), undefined);
    } finally {
      await cleanup();
    }
  });
});
