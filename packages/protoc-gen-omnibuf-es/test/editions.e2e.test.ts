import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  create as pbCreate,
  createFileRegistry,
  fromBinary as pbFromBinary,
  toBinary as pbToBinary,
} from '@bufbuild/protobuf';
import {
  CodeGeneratorRequestSchema,
  CodeGeneratorResponseSchema,
  Edition,
  FeatureSet_EnumType,
  FeatureSet_FieldPresence,
  FeatureSet_Utf8Validation,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorSetSchema,
} from '@bufbuild/protobuf/wkt';
import {
  DescriptorRegistry,
  WireBoolFalse,
  create,
  fromBinary,
  parseBinaryFileDescriptorSet,
  schemaFromProtobufDesc,
  toBinary,
} from '@omnibuf/core';
import ts from 'typescript';
import { generateFromDescriptorSet } from '../src/index.js';

const execFileAsync = promisify(execFile);

const CLI_BIN_PATH = fileURLToPath(
  new URL('../dist/bin/protoc-gen-omnibuf-es.js', import.meta.url),
);

async function runProtocDescriptorSet(
  protoDir: string,
  protoFiles: string[],
  outPath: string,
  includeImports = true,
): Promise<Uint8Array> {
  const args = ['-I', protoDir];
  if (includeImports) args.push('--include_imports');
  args.push(`--descriptor_set_out=${outPath}`, ...protoFiles.map((f) => join(protoDir, f)));
  await execFileAsync('protoc', args);
  return new Uint8Array(await readFile(outPath));
}

async function runProtocWithPlugin(
  protoDir: string,
  outDir: string,
  protoFiles: string[],
): Promise<void> {
  await execFileAsync('protoc', [
    '-I',
    protoDir,
    `--plugin=protoc-gen-omnibuf-es=${CLI_BIN_PATH}`,
    `--omnibuf-es_out=${outDir}`,
    ...protoFiles.map((f) => join(protoDir, f)),
  ]);
}

async function runPluginCli(reqBytes: Uint8Array): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN_PATH], {
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
}

function assertTypechecks(tsPaths: string[]): void {
  const program = ts.createProgram(tsPaths, {
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
}

const COMMON_ED2023_PROTO = `
edition = "2023";
package ed.common;

enum SharedStatus {
  SHARED_STATUS_UNSPECIFIED = 0;
  SHARED_STATUS_ACTIVE = 1;
  SHARED_STATUS_ERROR = -5;
}

message SharedChild {
  int32 id = 1;
  string label = 2;
}
`;

const FEATURES_ED2023_PROTO = `
edition = "2023";
package ed.v2023;

import "google/protobuf/descriptor.proto";
import "common_ed2023.proto";

option features.json_format = LEGACY_BEST_EFFORT;

extend google.protobuf.MessageOptions {
  string custom_note = 50101;
}

message Record2023 {
  option (custom_note) = "ed2023-ok";

  int32 exp_int = 1 [default = 0];
  int32 imp_int = 2 [features.field_presence = IMPLICIT];
  double exp_double = 3 [default = 0.0];
  bool exp_bool = 4 [default = false];
  string exp_str = 5 [default = ""];
  bytes exp_bytes = 6 [default = ""];
  ed.common.SharedStatus exp_status = 7 [default = SHARED_STATUS_UNSPECIFIED];
  repeated int32 packed_nums = 8 [features.repeated_field_encoding = PACKED];
  repeated int32 expanded_nums = 9 [features.repeated_field_encoding = EXPANDED];
  map<string, int32> scores = 10;
  map<string, ed.common.SharedChild> child_map = 11;
  ed.common.SharedChild delim_child = 12 [features.message_encoding = DELIMITED];
  repeated ed.common.SharedChild delim_list = 13 [features.message_encoding = DELIMITED];
  NestedOverride nested = 14;

  oneof payload {
    int32 oneof_int = 15;
    bool oneof_bool = 16;
    string oneof_str = 17;
    bytes oneof_bytes = 18;
    ed.common.SharedChild oneof_child = 19 [features.message_encoding = DELIMITED];
  }

  message NestedOverride {
    int32 imp_nested = 1 [features.field_presence = IMPLICIT];
    int32 exp_nested = 2;
  }
}
`;

const IMPLICIT_ED2023_PROTO = `
edition = "2023";
package ed.v2023;

option features.field_presence = IMPLICIT;

message FileImplicit2023 {
  int32 inherited_imp = 1;
  int32 overridden_exp = 2 [features.field_presence = EXPLICIT];
  bool overridden_bool = 3 [features.field_presence = EXPLICIT];
  oneof pick {
    int32 pick_int = 4;
    string pick_str = 5;
  }
}
`;

const FEATURES_ED2024_PROTO = `
edition = "2024";
package ed.v2024;

import "common_ed2023.proto";

option features.enforce_naming_style = STYLE2024;
option features.default_symbol_visibility = EXPORT_TOP_LEVEL;

local message LocalDetail {
  string info = 1;
}

export message Record2024 {
  int32 exp_int = 1 [default = 0];
  int32 imp_int = 2 [features.field_presence = IMPLICIT];
  bool exp_bool = 3 [default = false];
  string exp_str = 4 [default = ""];
  bytes exp_bytes = 5 [default = ""];
  ed.common.SharedStatus status = 6 [default = SHARED_STATUS_UNSPECIFIED];
  repeated int32 expanded_nums = 7 [features.repeated_field_encoding = EXPANDED];
  map<string, int32> scores = 8;
  map<string, ed.common.SharedChild> child_map = 9;
  ed.common.SharedChild delim_child = 10 [features.message_encoding = DELIMITED];
  repeated ed.common.SharedChild delim_list = 11 [features.message_encoding = DELIMITED];
  LocalDetail detail = 12;

  oneof branch {
    int32 branch_int = 13;
    bool branch_bool = 14;
    string branch_str = 15;
  }
}
`;

const FEATURES_ED2026_PROTO = `
edition = "2026";
package ed.v2026;

import "common_ed2023.proto";

option features.default_symbol_visibility = STRICT;
option features.enforce_naming_style = STYLE2026;

export enum Mode {
  MODE_UNSPECIFIED = 0;
  MODE_FAST = 1;
  MODE_STRICT = 2;
}

local message Helper {
  int32 code = 1;
}

export message Record2026 {
  option features.enforce_proto_limits = PROTO_LIMITS2026;

  int32 exp_int = 1 [default = 0];
  int32 imp_int = 2 [features.field_presence = IMPLICIT];
  double exp_double = 3 [default = 0.0];
  bool exp_bool = 4 [default = false];
  string exp_str = 5 [default = ""];
  bytes exp_bytes = 6 [default = ""];
  Mode mode = 7 [default = MODE_UNSPECIFIED];
  repeated int32 packed_nums = 8 [features.repeated_field_encoding = PACKED];
  repeated int32 expanded_nums = 9 [features.repeated_field_encoding = EXPANDED];
  map<string, int32> scores = 10;
  map<string, ed.common.SharedChild> child_map = 11;
  ed.common.SharedChild delim_child = 12 [features.message_encoding = DELIMITED];
  repeated ed.common.SharedChild delim_list = 13 [features.message_encoding = DELIMITED];
  Helper helper = 14 [features.message_encoding = DELIMITED];

  oneof choice {
    int32 choice_int = 15;
    bool choice_bool = 16;
    string choice_str = 17;
    ed.common.SharedChild choice_child = 18 [features.message_encoding = DELIMITED];
  }
}
`;

describe('@omnibuf/protoc-gen-omnibuf-es - Protobuf Editions 2023/2024/2026 E2E (real protoc)', () => {
  it('compiles Editions 2023, 2024, and 2026 via real protoc + plugin, typechecks, and matches Tier 2 byte-for-byte', async () => {
    const workDir = await mkdtemp(fileURLToPath(new URL('./tmp-editions-e2e-', import.meta.url)));
    try {
      await writeFile(join(workDir, 'common_ed2023.proto'), COMMON_ED2023_PROTO);
      await writeFile(join(workDir, 'features_ed2023.proto'), FEATURES_ED2023_PROTO);
      await writeFile(join(workDir, 'implicit_ed2023.proto'), IMPLICIT_ED2023_PROTO);
      await writeFile(join(workDir, 'features_ed2024.proto'), FEATURES_ED2024_PROTO);
      await writeFile(join(workDir, 'features_ed2026.proto'), FEATURES_ED2026_PROTO);

      const protoFiles = [
        'common_ed2023.proto',
        'features_ed2023.proto',
        'implicit_ed2023.proto',
        'features_ed2024.proto',
        'features_ed2026.proto',
      ];

      // 1. Invoke real protoc with --plugin=protoc-gen-omnibuf-es=...
      await runProtocWithPlugin(workDir, workDir, protoFiles);

      // 2. Also produce binary FileDescriptorSet from real protoc for Tier 2 and programmatic codegen comparison
      const fdsPath = join(workDir, 'all.fds.pb');
      const fdsBytes = await runProtocDescriptorSet(workDir, protoFiles, fdsPath, true);
      const parsedFds = parseBinaryFileDescriptorSet(fdsBytes);

      // Verify programmatic generateFromDescriptorSet produces identical TS output for user files
      const progFiles = generateFromDescriptorSet(parsedFds);
      const emittedTsPaths = protoFiles.map((f) =>
        join(workDir, f.replace(/\.proto$/, '_omnibuf.pb.ts')),
      );
      for (const f of protoFiles) {
        const expectedName = f.replace(/\.proto$/, '_omnibuf.pb.ts');
        const pluginContent = await readFile(join(workDir, expectedName), 'utf8');
        const progContent = progFiles.find((g) => g.name === expectedName)?.content;
        assert.equal(pluginContent, progContent, `Plugin vs programmatic output mismatch for ${f}`);
      }

      // 3. Strict TypeScript typecheck across all emitted files
      assertTypechecks(emittedTsPaths);

      // 4. Import emitted modules and build Tier 2 DescriptorRegistry + @bufbuild/protobuf DescMessage registry
      const mod23 = await import(
        pathToFileURL(join(workDir, 'features_ed2023_omnibuf.pb.ts')).href
      );
      const modImp23 = await import(
        pathToFileURL(join(workDir, 'implicit_ed2023_omnibuf.pb.ts')).href
      );
      const mod24 = await import(
        pathToFileURL(join(workDir, 'features_ed2024_omnibuf.pb.ts')).href
      );
      const mod26 = await import(
        pathToFileURL(join(workDir, 'features_ed2026_omnibuf.pb.ts')).href
      );

      const registry = new DescriptorRegistry(parsedFds);
      const pbReg = createFileRegistry(pbFromBinary(FileDescriptorSetSchema, fdsBytes));

      // Verify file-level IMPLICIT with field-level EXPLICIT override
      {
        const descImp = pbReg.getMessage('ed.v2023.FileImplicit2023')!;
        const emptyImp = modImp23.createFileImplicit2023();
        assert.equal(emptyImp.inheritedImp, 0);
        assert.equal(emptyImp.overriddenExp, undefined);
        assert.equal(emptyImp.overriddenBool, undefined);
        const w1 = modImp23.marshalFileImplicit2023OmniBuf(emptyImp, { deterministic: true });
        const w2 = registry.encode('ed.v2023.FileImplicit2023', {}, { deterministic: true });
        const w3 = toBinary(descImp, create(descImp), { deterministic: true });
        assert.deepEqual(w1, w2);
        assert.deepEqual(w1, w3);

        const opImp = new modImp23.OpaqueFileImplicit2023(w1);
        assert.equal(opImp.getInheritedImp(), 0);
        assert.equal(opImp.hasOverriddenExp(), false);
        assert.equal(opImp.hasOverriddenBool(), false);
        opImp.setOverriddenExp(0);
        opImp.setOverriddenBool(false);
        const wSet = opImp.marshal();
        assert.notDeepEqual(wSet, w1);
        const decSet = modImp23.decodeFileImplicit2023(wSet);
        assert.equal(decSet.overriddenExp, 0);
        assert.equal(decSet.overriddenBool, false);
      }

      // --- Exercise Edition 2023 (eager, Opaque, DescriptorRegistry, DescMessage) ---
      {
        const desc23 = pbReg.getMessage('ed.v2023.Record2023')!;
        const emptyMsg = mod23.createRecord2023();
        assert.equal(emptyMsg.expInt, undefined);
        assert.equal(emptyMsg.impInt, 0);
        assert.equal(emptyMsg.expDouble, undefined);
        assert.equal(emptyMsg.expBool, undefined);
        assert.equal(emptyMsg.expStr, undefined);
        assert.equal(emptyMsg.expBytes, undefined);
        assert.equal(emptyMsg.expStatus, undefined);
        assert.equal(emptyMsg.delimChild, null);
        assert.deepEqual(emptyMsg.payload, { case: undefined });

        const emptyWire = mod23.marshalRecord2023OmniBuf(emptyMsg, { deterministic: true });
        assert.deepEqual(
          emptyWire,
          registry.encode('ed.v2023.Record2023', {}, { deterministic: true }),
        );
        assert.deepEqual(emptyWire, toBinary(desc23, create(desc23), { deterministic: true }));

        // Verify explicit zero / false / "" / empty bytes / enum 0 wire bytes differ from absent
        const zeroMsg = mod23.createRecord2023({
          expInt: 0,
          impInt: 0,
          expDouble: 0.0,
          expBool: false,
          expStr: '',
          expBytes: new Uint8Array(0),
          expStatus: 0,
          packedNums: [1, -2, 3],
          expandedNums: [10, -20, 30],
          scores: { z: 9, a: 1 },
          childMap: { alpha: { id: 7, label: 'a' } },
          delimChild: { id: 0, label: '' },
          delimList: [
            { id: 1, label: 'x' },
            { id: 2, label: 'y' },
          ],
          nested: { impNested: 0, expNested: 0 },
          payload: { case: 'oneofBool', value: false },
        });

        const wireTier1 = mod23.marshalRecord2023OmniBuf(zeroMsg, {
          deterministic: true,
          selfDescribing: true,
        });
        const wireReg = registry.encode('ed.v2023.Record2023', zeroMsg, {
          deterministic: true,
          selfDescribing: true,
        });
        const wirePbDesc = toBinary(desc23, create(desc23, zeroMsg), {
          deterministic: true,
          selfDescribing: true,
        });
        assert.deepEqual(wireTier1, wireReg);
        assert.deepEqual(wireTier1, wirePbDesc);

        const onlyBoolFalse = mod23.marshalRecord2023OmniBuf({ expBool: false });
        assert.notDeepEqual(onlyBoolFalse, emptyWire);
        // Field #4 with WireBoolFalse (2): tag = (4 << 4) | 2 = 66 -> 1B prefix varint = (66 << 1) | 1 = 0x85
        const expectedBoolFalseTag = (((4 << 4) | WireBoolFalse) << 1) | 1;
        assert.ok(onlyBoolFalse.includes(expectedBoolFalseTag));

        // Decode round-trip across Tier 1, DescriptorRegistry, and DescMessage
        const dec1 = mod23.decodeRecord2023(wireTier1);
        assert.equal(dec1.expInt, 0);
        assert.equal(dec1.impInt, 0);
        assert.equal(dec1.expDouble, 0);
        assert.equal(dec1.expBool, false);
        assert.equal(dec1.expStr, '');
        assert.deepEqual(dec1.expBytes, new Uint8Array(0));
        assert.equal(dec1.expStatus, 0);
        assert.deepEqual(dec1.packedNums, [1, -2, 3]);
        assert.deepEqual(dec1.expandedNums, [10, -20, 30]);
        assert.deepEqual(dec1.scores, { a: 1, z: 9 });
        assert.equal(dec1.childMap.alpha.id, 7);
        assert.equal(dec1.delimChild.id, 0);
        assert.equal(dec1.delimChild.label, '');
        assert.equal(dec1.delimList.length, 2);
        assert.equal(dec1.delimList[1].label, 'y');
        assert.equal(dec1.nested.impNested, 0);
        assert.equal(dec1.nested.expNested, 0);
        assert.deepEqual(dec1.payload, { case: 'oneofBool', value: false });

        const decDesc = fromBinary<Record<string, unknown>>(desc23, wireTier1);
        assert.equal(decDesc.expBool, false);
        assert.equal(decDesc.expStr, '');
        assert.deepEqual(decDesc.expBytes, new Uint8Array(0));
        assert.deepEqual(decDesc.payload, { case: 'oneofBool', value: false });

        // Open enum unknown integer preserved
        const unknownEnumWire = mod23.marshalRecord2023OmniBuf({ expStatus: 9999 });
        assert.equal(mod23.decodeRecord2023(unknownEnumWire).expStatus, 9999);
        assert.equal(registry.decode('ed.v2023.Record2023', unknownEnumWire).exp_status, 9999);
        assert.equal(fromBinary<Record<string, unknown>>(desc23, unknownEnumWire).expStatus, 9999);

        // Opaque* view: absent vs present-zero, has*, mutations, clearing, splicing
        const opAbsent = new mod23.OpaqueRecord2023(emptyWire);
        assert.equal(opAbsent.hasExpInt(), false);
        assert.equal(opAbsent.getExpInt(), undefined);
        assert.equal(opAbsent.hasExpBool(), false);
        assert.equal(opAbsent.getExpBool(), undefined);
        assert.equal(opAbsent.hasExpStr(), false);
        assert.equal(opAbsent.getExpStr(), undefined);
        assert.equal(opAbsent.hasExpBytes(), false);
        assert.equal(opAbsent.getExpBytes(), undefined);
        assert.equal(opAbsent.hasDelimChild(), false);
        assert.equal(opAbsent.getDelimChild(), null);
        assert.equal(opAbsent.hasOneofBool(), false);
        assert.equal(opAbsent.getImpInt(), 0);

        const opZero = new mod23.OpaqueRecord2023(wireTier1);
        assert.equal(opZero.hasExpInt(), true);
        assert.equal(opZero.getExpInt(), 0);
        assert.equal(opZero.hasExpDouble(), true);
        assert.equal(opZero.getExpDouble(), 0);
        assert.equal(opZero.hasExpBool(), true);
        assert.equal(opZero.getExpBool(), false);
        assert.equal(opZero.hasExpStr(), true);
        assert.equal(opZero.getExpStr(), '');
        assert.equal(opZero.hasExpBytes(), true);
        assert.deepEqual(opZero.getExpBytes(), new Uint8Array(0));
        assert.equal(opZero.hasExpStatus(), true);
        assert.equal(opZero.getExpStatus(), 0);
        assert.equal(opZero.hasDelimChild(), true);
        assert.equal(opZero.getDelimChild().id, 0);
        assert.equal(opZero.hasOneofBool(), true);
        assert.equal(opZero.getOneofBool(), false);
        assert.equal(opZero.hasOneofInt(), false);
        assert.equal(opZero.getOneofInt(), undefined);

        // Mutate absent -> explicit zero/false/empty, then marshal & verify presence
        opAbsent.setExpInt(0);
        opAbsent.setExpBool(false);
        opAbsent.setExpStr('');
        opAbsent.setExpBytes(new Uint8Array(0));
        opAbsent.setOneofStr('');
        assert.equal(opAbsent.hasExpInt(), true);
        assert.equal(opAbsent.getExpInt(), 0);
        assert.equal(opAbsent.hasExpBool(), true);
        assert.equal(opAbsent.getExpBool(), false);
        assert.equal(opAbsent.hasExpStr(), true);
        assert.equal(opAbsent.getExpStr(), '');
        assert.equal(opAbsent.hasExpBytes(), true);
        assert.equal(opAbsent.hasOneofStr(), true);
        assert.equal(opAbsent.getOneofStr(), '');
        const splicedPresent = mod23.decodeRecord2023(opAbsent.marshal());
        assert.equal(splicedPresent.expInt, 0);
        assert.equal(splicedPresent.expBool, false);
        assert.equal(splicedPresent.expStr, '');
        assert.deepEqual(splicedPresent.expBytes, new Uint8Array(0));
        assert.deepEqual(splicedPresent.payload, { case: 'oneofStr', value: '' });

        // Clear present-zero fields via set*(undefined) and switch oneof branch, then marshal
        opZero.setExpInt(undefined);
        opZero.setExpBool(undefined);
        opZero.setExpStr(undefined);
        opZero.setExpBytes(undefined);
        opZero.setOneofInt(0);
        assert.equal(opZero.hasExpInt(), false);
        assert.equal(opZero.getExpInt(), undefined);
        assert.equal(opZero.hasExpBool(), false);
        assert.equal(opZero.hasExpStr(), false);
        assert.equal(opZero.hasExpBytes(), false);
        assert.equal(opZero.hasOneofBool(), false);
        assert.equal(opZero.hasOneofInt(), true);
        assert.equal(opZero.getOneofInt(), 0);
        const splicedCleared = mod23.decodeRecord2023(opZero.marshal());
        assert.equal(splicedCleared.expInt, undefined);
        assert.equal(splicedCleared.expBool, undefined);
        assert.equal(splicedCleared.expStr, undefined);
        assert.equal(splicedCleared.expBytes, undefined);
        assert.equal(splicedCleared.expStatus, 0);
        assert.deepEqual(splicedCleared.payload, { case: 'oneofInt', value: 0 });
        assert.equal(splicedCleared.delimList.length, 2);
        assert.deepEqual(splicedCleared.scores, { a: 1, z: 9 });
      }

      // --- Exercise Edition 2024 ---
      {
        const desc24 = pbReg.getMessage('ed.v2024.Record2024')!;
        const val24 = mod24.createRecord2024({
          expInt: 0,
          impInt: 5,
          expBool: false,
          expStr: '',
          expBytes: new Uint8Array(0),
          status: -5,
          expandedNums: [7, 8],
          scores: { k: 12 },
          childMap: { c: { id: 3, label: 'three' } },
          delimChild: { id: 4, label: 'four' },
          delimList: [{ id: 5, label: 'five' }],
          detail: { info: 'local-ok' },
          branch: { case: 'branchInt', value: 0 },
        });
        const w1 = mod24.marshalRecord2024OmniBuf(val24, { deterministic: true });
        const w2 = registry.encode('ed.v2024.Record2024', val24, { deterministic: true });
        const w3 = toBinary(desc24, create(desc24, val24), { deterministic: true });
        assert.deepEqual(w1, w2);
        assert.deepEqual(w1, w3);

        const op24 = new mod24.OpaqueRecord2024(w1);
        assert.equal(op24.hasExpBool(), true);
        assert.equal(op24.getExpBool(), false);
        assert.equal(op24.hasBranchInt(), true);
        assert.equal(op24.getBranchInt(), 0);
        assert.equal(op24.getDetail().info, 'local-ok');
        assert.equal(op24.getDelimChild().label, 'four');
      }

      // --- Exercise Edition 2026 (STRICT visibility, export/local, PROTO_LIMITS2026) ---
      {
        const desc26 = pbReg.getMessage('ed.v2026.Record2026')!;
        const absent26 = mod26.decodeRecord2026(new Uint8Array(0));
        assert.equal(absent26.expInt, undefined);
        assert.equal(absent26.impInt, 0);
        assert.equal(absent26.mode, undefined);

        const val26 = mod26.createRecord2026({
          expInt: 0,
          impInt: 42,
          expDouble: 0.0,
          expBool: false,
          expStr: '',
          expBytes: new Uint8Array(0),
          mode: 0,
          packedNums: [1, 2],
          expandedNums: [3, 4],
          scores: { b: 2, a: 1 },
          childMap: { m: { id: 9, label: 'nine' } },
          delimChild: { id: 11, label: 'eleven' },
          delimList: [{ id: 12, label: 'twelve' }],
          helper: { code: 0 },
          choice: { case: 'choiceChild', value: { id: 99, label: 'in-oneof-delim' } },
        });
        const w1 = mod26.marshalRecord2026OmniBuf(val26, {
          deterministic: true,
          selfDescribing: true,
        });
        const w2 = registry.encode('ed.v2026.Record2026', val26, {
          deterministic: true,
          selfDescribing: true,
        });
        const w3 = toBinary(desc26, create(desc26, val26), {
          deterministic: true,
          selfDescribing: true,
        });
        assert.deepEqual(w1, w2);
        assert.deepEqual(w1, w3);

        const dec26 = mod26.decodeRecord2026(w1);
        assert.equal(dec26.expInt, 0);
        assert.equal(dec26.impInt, 42);
        assert.equal(dec26.expBool, false);
        assert.equal(dec26.mode, 0);
        assert.equal(dec26.helper.code, 0);
        assert.equal(dec26.choice.case, 'choiceChild');
        assert.equal(dec26.choice.value.id, 99);
        assert.equal(dec26.choice.value.label, 'in-oneof-delim');

        const op26 = new mod26.OpaqueRecord2026(w1);
        assert.equal(op26.hasMode(), true);
        assert.equal(op26.getMode(), 0);
        assert.equal(op26.hasHelper(), true);
        assert.equal(op26.getHelper().code, 0);
        assert.equal(op26.hasChoiceChild(), true);
        assert.equal(op26.getChoiceChild().id, 99);
        op26.setMode(undefined);
        op26.setChoiceBool(false);
        const res26 = mod26.decodeRecord2026(op26.marshal());
        assert.equal(res26.mode, undefined);
        assert.deepEqual(res26.choice, { case: 'choiceBool', value: false });
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported editions and disallowed features via real protoc, CLI CodeGeneratorResponse, and Tier 2', async () => {
    const workDir = await mkdtemp(fileURLToPath(new URL('./tmp-editions-neg-', import.meta.url)));
    try {
      // 1. CLI advertises supported_features = 3, minimum_edition = 1000, maximum_edition = 1002
      //    and returns structured CodeGeneratorResponse.error on unsupported editions (0, 1003, 9999)
      for (const badEdition of [0, 1003, 9999]) {
        const reqBytes = pbToBinary(
          CodeGeneratorRequestSchema,
          pbCreate(CodeGeneratorRequestSchema, {
            fileToGenerate: ['bad_ed.proto'],
            protoFile: [
              {
                name: 'bad_ed.proto',
                package: 'bad',
                syntax: 'editions',
                edition: badEdition as Edition,
                messageType: [{ name: 'M', field: [] }],
              },
            ],
          }),
        );
        const respBytes = await runPluginCli(reqBytes);
        const resp = pbFromBinary(CodeGeneratorResponseSchema, respBytes);
        assert.match(resp.error, /unsupported protobuf edition/);
        assert.equal(resp.supportedFeatures, 3n);
        assert.equal(resp.minimumEdition, 1000);
        assert.equal(resp.maximumEdition, 1002);
        assert.equal(resp.file.length, 0);
      }

      // 2. Real protoc-compiled negative .proto cases checked through protoc --plugin, generateFromDescriptorSet,
      //    DescriptorRegistry, and @bufbuild/protobuf DescMessage!
      await writeFile(
        join(workDir, 'legacy_closed.proto'),
        `syntax = "proto2";\npackage legacy;\nenum OldClosed { OLD_ZERO = 0; OLD_ONE = 1; }\n`,
      );

      const negProtos: Array<{ file: string; content: string; pattern: RegExp; msgType: string }> =
        [
          {
            file: 'neg_closed_decl.proto',
            content: `edition = "2023";\npackage neg;\nenum ClosedE { option features.enum_type = CLOSED; ZERO = 0; }\nmessage M { ClosedE e = 1; }\n`,
            pattern: /CLOSED/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_closed_cross.proto',
            content: `edition = "2026";\npackage neg;\nimport "legacy_closed.proto";\nexport message M { legacy.OldClosed e = 1; }\n`,
            pattern: /CLOSED/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_required.proto',
            content: `edition = "2024";\npackage neg;\nmessage M { int32 id = 1 [features.field_presence = LEGACY_REQUIRED]; }\n`,
            pattern: /LEGACY_REQUIRED/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_utf8_scalar.proto',
            content: `edition = "2023";\npackage neg;\nmessage M { string s = 1 [features.utf8_validation = NONE]; }\n`,
            pattern: /UTF-8 NONE/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_utf8_map.proto',
            content: `edition = "2026";\npackage neg;\nexport message M { map<string, int32> scores = 1 [features.utf8_validation = NONE]; }\n`,
            pattern: /UTF-8 NONE/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_default_int.proto',
            content: `edition = "2023";\npackage neg;\nmessage M { int32 count = 1 [default = 42]; }\n`,
            pattern: /non-zero default/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_default_str.proto',
            content: `edition = "2026";\npackage neg;\nexport message M { string name = 1 [default = "alice"]; }\n`,
            pattern: /non-zero default/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_default_enum.proto',
            content: `edition = "2024";\npackage neg;\nenum Kind { KIND_ZERO = 0; KIND_ONE = 1; }\nmessage M { Kind kind = 1 [default = KIND_ONE]; }\n`,
            pattern: /non-zero default/,
            msgType: 'neg.M',
          },
          {
            file: 'neg_extension.proto',
            content: `edition = "2023";\npackage neg;\nmessage M { int32 id = 1; extensions 100 to 199; }\nextend M { string extra = 100; }\n`,
            pattern: /extension/i,
            msgType: 'neg.M',
          },
        ];

      for (const tc of negProtos) {
        await writeFile(join(workDir, tc.file), tc.content);

        // (a) Real protoc + plugin fails cleanly with CodeGeneratorResponse.error reported on stderr
        await assert.rejects(
          () => runProtocWithPlugin(workDir, workDir, [tc.file]),
          (err: unknown) => {
            const stderr = String((err as { stderr?: unknown }).stderr ?? err);
            assert.match(
              stderr,
              tc.pattern,
              `protoc plugin stderr mismatch for ${tc.file}: ${stderr}`,
            );
            return true;
          },
        );

        // (b) Binary FileDescriptorSet via real protoc fails identically in generateFromDescriptorSet,
        //     DescriptorRegistry, and @bufbuild/protobuf DescMessage!
        const fdsPath = join(workDir, `${tc.file}.pb`);
        const fdsBytes = await runProtocDescriptorSet(workDir, [tc.file], fdsPath, true);
        const parsedFds = parseBinaryFileDescriptorSet(fdsBytes);

        assert.throws(
          () => generateFromDescriptorSet(parsedFds),
          tc.pattern,
          `generateFromDescriptorSet should reject ${tc.file}`,
        );
        assert.throws(
          () => new DescriptorRegistry(parsedFds),
          tc.pattern,
          `DescriptorRegistry should reject ${tc.file}`,
        );
        const pbReg = createFileRegistry(pbFromBinary(FileDescriptorSetSchema, fdsBytes));
        assert.throws(
          () => schemaFromProtobufDesc(pbReg.getMessage(tc.msgType)!),
          tc.pattern,
          `DescMessage should reject ${tc.file}`,
        );
      }

      // 3. Direct CLI CodeGeneratorRequest for rejected feature returns clean CodeGeneratorResponse.error (exit 0)
      const closedReq = pbToBinary(
        CodeGeneratorRequestSchema,
        pbCreate(CodeGeneratorRequestSchema, {
          fileToGenerate: ['c.proto'],
          protoFile: [
            {
              name: 'c.proto',
              package: 'c',
              syntax: 'editions',
              edition: Edition.EDITION_2026,
              enumType: [
                {
                  name: 'Closed',
                  options: { features: { enumType: FeatureSet_EnumType.CLOSED } },
                  value: [{ name: 'ZERO', number: 0 }],
                },
              ],
            },
          ],
        }),
      );
      const closedResp = pbFromBinary(CodeGeneratorResponseSchema, await runPluginCli(closedReq));
      assert.match(closedResp.error, /CLOSED/);
      assert.equal(closedResp.supportedFeatures, 3n);
      assert.equal(closedResp.minimumEdition, 1000);
      assert.equal(closedResp.maximumEdition, 1002);

      // Verify utf8_validation = NONE and LEGACY_REQUIRED via CLI also return clean CodeGeneratorResponse.error
      const reqErrResp = pbFromBinary(
        CodeGeneratorResponseSchema,
        await runPluginCli(
          pbToBinary(
            CodeGeneratorRequestSchema,
            pbCreate(CodeGeneratorRequestSchema, {
              fileToGenerate: ['r.proto'],
              protoFile: [
                {
                  name: 'r.proto',
                  package: 'r',
                  syntax: 'editions',
                  edition: Edition.EDITION_2026,
                  messageType: [
                    {
                      name: 'M',
                      field: [
                        {
                          name: 'x',
                          number: 1,
                          label: FieldDescriptorProto_Label.OPTIONAL,
                          type: FieldDescriptorProto_Type.INT32,
                          options: {
                            features: { fieldPresence: FeatureSet_FieldPresence.LEGACY_REQUIRED },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          ),
        ),
      );
      assert.match(reqErrResp.error, /LEGACY_REQUIRED/);

      const utf8ErrResp = pbFromBinary(
        CodeGeneratorResponseSchema,
        await runPluginCli(
          pbToBinary(
            CodeGeneratorRequestSchema,
            pbCreate(CodeGeneratorRequestSchema, {
              fileToGenerate: ['u.proto'],
              protoFile: [
                {
                  name: 'u.proto',
                  package: 'u',
                  syntax: 'editions',
                  edition: Edition.EDITION_2026,
                  messageType: [
                    {
                      name: 'M',
                      field: [
                        {
                          name: 's',
                          number: 1,
                          label: FieldDescriptorProto_Label.OPTIONAL,
                          type: FieldDescriptorProto_Type.STRING,
                          options: {
                            features: { utf8Validation: FeatureSet_Utf8Validation.NONE },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          ),
        ),
      );
      assert.match(utf8ErrResp.error, /UTF-8 NONE/);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
