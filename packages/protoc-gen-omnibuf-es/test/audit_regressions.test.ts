import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Encoder,
  MaxNestingDepth,
  WireString,
  marshal,
  readFloat32,
  type FileDescriptorSetJSON,
} from '@omnibuf/core';
import ts from 'typescript';
import { generateFromDescriptorSet } from '../src/index.js';

function findSubsequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function compileAndImportGenerated(fds: FileDescriptorSetJSON): Promise<{
  mod: Record<string, any>;
  content: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(fileURLToPath(new URL('./audit-gen-', import.meta.url)));
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

const PEER_AND_CONFORMANCE_FDS: FileDescriptorSetJSON = {
  file: [
    {
      name: 'audit_types.proto',
      package: 'omnibuf.audit',
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
              typeName: '.omnibuf.audit.TestAllTypes.F12MapEntry',
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
              typeName: '.omnibuf.audit.SubBranch',
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
              typeName: '.omnibuf.audit.Node',
            },
            { name: 'leaf', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
          ],
        },
      ],
    },
  ],
};

describe('Audit Regressions - @omnibuf/protoc-gen-omnibuf-es', () => {
  it('ES-3: generator avoids identifier collisions with @omnibuf/core imports (Message) and JS globals (Error, Number)', async () => {
    const dir = await mkdtemp(fileURLToPath(new URL('./audit-es3-', import.meta.url)));
    try {
      const files = generateFromDescriptorSet({
        file: [
          {
            name: 'collisions.proto',
            package: 'audit.es3',
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

  it('ES-4: generated deterministic map<string, uint64> encoder sorts keys by UTF-8 bytes rather than UTF-16 code units', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
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

  it('ES-7a: OpaquePeerUpdate.marshal() rejects unknown WireString fields containing invalid UTF-8', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
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

  it('ES-7b: generated Opaque sub-message getter propagates depth + 1 rather than resetting recursion depth to 0', async () => {
    const { mod, content, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
    try {
      // Build a packet nested to MaxNestingDepth + 1 (33 nested child sub-messages)
      let nested: Record<string, any> = { leaf: 7 };
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

  it('ES-8a: Opaque oneof setSub(null) on inactive sub-message branch does not erase active sibling branch', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
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

  it('ES-8b: clean OpaquePeerUpdate.marshal() returns an independent buffer instead of aliasing _raw', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
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

  it('ES-10b: generated decodeTestAllTypes and OpaqueTestAllTypes preserve exact IEEE-754 binary32 Math.fround(0.1)', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
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

  it('ES-11: marshal(createPeerUpdate({ asn: 100 })) succeeds on generated message instances', async () => {
    const { mod, cleanup } = await compileAndImportGenerated(PEER_AND_CONFORMANCE_FDS);
    try {
      const msg = mod.createPeerUpdate({ asn: 100 });
      const bytes = marshal(msg);
      const decoded = mod.decodePeerUpdate(bytes);
      assert.equal(decoded.asn, 100);
    } finally {
      await cleanup();
    }
  });
});
