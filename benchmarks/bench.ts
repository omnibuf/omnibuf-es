import { writeFileSync } from 'node:fs';
import { cpus, platform, arch as osArch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  create as createBufMsg,
  createFileRegistry,
  fromBinary as bufFromBinary,
  toBinary as bufToBinary,
} from '@bufbuild/protobuf';
import { FileDescriptorProtoSchema } from '@bufbuild/protobuf/wkt';
import { encode as msgpackEncode, decode as msgpackDecode } from '@msgpack/msgpack';
import googleProtobuf from 'google-protobuf';
import protobufjs from 'protobufjs';
import {
  OpaquePeerUpdate,
  PeerUpdateSchema,
  createPeerUpdate,
  fromBinary,
  toBinary,
  type PeerUpdate,
} from '../packages/omnibuf-node/src/index.js';

// ============================================================================
// 1. Canonical SamplePeerUpdate Workload (matching Go omnibuf_bench_test.go)
// ============================================================================

function createSamplePeerUpdate(): PeerUpdate {
  return createPeerUpdate({
    asn: 64512,
    routerId: 'edge-rtr-fra01.core.backbone.net',
    active: true,
    uptimeSec: 1849203,
    rssiDbm: -62,
    cpuLoad: 0.42875,
    tags: ['tier1', 'ebgp', 'eu-central', 'ixp-de-cix'],
    prefixes: [167772160, 172032000, 3232235520, 2886729728, 134744072, 134743040],
    location: {
      region: 'eu-central-1',
      datacenter: 'FRA-Equinix-FR5',
      city: 'Frankfurt',
      rack: 42,
      latitude: 50.1109,
      longitude: 8.6821,
    },
    neighbors: [
      {
        peerAsn: 3356,
        router: 'ae0.fra1.level3.net',
        latencyUs: 850,
        established: true,
      },
      {
        peerAsn: 1299,
        router: 'ffm-b5-link.telia.net',
        latencyUs: 920,
        established: true,
      },
      {
        peerAsn: 174,
        router: 'be2040.ccr41.fra03.atlas.cogentco.com',
        latencyUs: 1120,
        established: true,
      },
      {
        peerAsn: 2914,
        router: 'ae-12.r24.frnkge08.de.bb.gin.ntt.net',
        latencyUs: 980,
        established: false,
      },
    ],
    sequence: 9876543210,
  });
}

function createLargeNestedPeerUpdate(): PeerUpdate {
  const p = createSamplePeerUpdate();
  p.location!.datacenter = 'd'.repeat(20480);
  p.neighbors[0]!.router = 'n'.repeat(18432);
  return p;
}

function createManyNeighborsPeerUpdate(): PeerUpdate {
  const p = createSamplePeerUpdate();
  const base = p.neighbors;
  const expanded = [];
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < base.length; i++) {
      const nb = base[i]!;
      expanded.push({
        $typeName: 'omnibuf.bench.Neighbor' as const,
        peerAsn: nb.peerAsn,
        router: nb.router,
        latencyUs: nb.latencyUs,
        established: nb.established,
      });
    }
  }
  p.neighbors = expanded;
  return p;
}

// ============================================================================
// 2. Setup @bufbuild/protobuf v2 (protobuf-es), protobufjs, google-protobuf
// ============================================================================

const peerFileProto = createBufMsg(FileDescriptorProtoSchema, {
  name: 'peer.proto',
  package: 'omnibuf.bench',
  syntax: 'proto3',
  messageType: [
    {
      name: 'Location',
      field: [
        { name: 'region', number: 1, label: 1, type: 9, jsonName: 'region' },
        { name: 'datacenter', number: 2, label: 1, type: 9, jsonName: 'datacenter' },
        { name: 'city', number: 3, label: 1, type: 9, jsonName: 'city' },
        { name: 'rack', number: 4, label: 1, type: 13, jsonName: 'rack' },
        { name: 'latitude', number: 5, label: 1, type: 2, jsonName: 'latitude' },
        { name: 'longitude', number: 6, label: 1, type: 2, jsonName: 'longitude' },
      ],
    },
    {
      name: 'Neighbor',
      field: [
        { name: 'peer_asn', number: 1, label: 1, type: 13, jsonName: 'peerAsn' },
        { name: 'router', number: 2, label: 1, type: 9, jsonName: 'router' },
        { name: 'latency_us', number: 3, label: 1, type: 13, jsonName: 'latencyUs' },
        { name: 'established', number: 4, label: 1, type: 8, jsonName: 'established' },
      ],
    },
    {
      name: 'PeerUpdate',
      field: [
        { name: 'asn', number: 1, label: 1, type: 13, jsonName: 'asn' },
        { name: 'router_id', number: 2, label: 1, type: 9, jsonName: 'routerId' },
        { name: 'active', number: 3, label: 1, type: 8, jsonName: 'active' },
        { name: 'uptime_sec', number: 4, label: 1, type: 4, jsonName: 'uptimeSec' },
        { name: 'rssi_dbm', number: 5, label: 1, type: 17, jsonName: 'rssiDbm' },
        { name: 'cpu_load', number: 6, label: 1, type: 1, jsonName: 'cpuLoad' },
        { name: 'tags', number: 7, label: 3, type: 9, jsonName: 'tags' },
        { name: 'prefixes', number: 8, label: 3, type: 13, jsonName: 'prefixes' },
        {
          name: 'location',
          number: 9,
          label: 1,
          type: 11,
          typeName: '.omnibuf.bench.Location',
          jsonName: 'location',
        },
        {
          name: 'neighbors',
          number: 10,
          label: 3,
          type: 11,
          typeName: '.omnibuf.bench.Neighbor',
          jsonName: 'neighbors',
        },
        { name: 'sequence', number: 11, label: 1, type: 4, jsonName: 'sequence' },
      ],
    },
  ],
});

const peerRegistry = createFileRegistry(peerFileProto);
const BufPeerUpdateDesc = peerRegistry.getMessage('omnibuf.bench.PeerUpdate')!;

// protobufjs schema
const pbjsRoot = protobufjs.Root.fromJSON({
  nested: {
    omnibuf: {
      nested: {
        bench: {
          nested: {
            Location: {
              fields: {
                region: { type: 'string', id: 1 },
                datacenter: { type: 'string', id: 2 },
                city: { type: 'string', id: 3 },
                rack: { type: 'uint32', id: 4 },
                latitude: { type: 'float', id: 5 },
                longitude: { type: 'float', id: 6 },
              },
            },
            Neighbor: {
              fields: {
                peerAsn: { type: 'uint32', id: 1 },
                router: { type: 'string', id: 2 },
                latencyUs: { type: 'uint32', id: 3 },
                established: { type: 'bool', id: 4 },
              },
            },
            PeerUpdate: {
              fields: {
                asn: { type: 'uint32', id: 1 },
                routerId: { type: 'string', id: 2 },
                active: { type: 'bool', id: 3 },
                uptimeSec: { type: 'uint64', id: 4 },
                rssiDbm: { type: 'sint32', id: 5 },
                cpuLoad: { type: 'double', id: 6 },
                tags: { rule: 'repeated', type: 'string', id: 7 },
                prefixes: { rule: 'repeated', type: 'uint32', id: 8, options: { packed: true } },
                location: { type: 'Location', id: 9 },
                neighbors: { rule: 'repeated', type: 'Neighbor', id: 10 },
                sequence: { type: 'uint64', id: 11 },
              },
            },
          },
        },
      },
    },
  },
});
const PbjsPeerUpdate = pbjsRoot.lookupType('omnibuf.bench.PeerUpdate');

// google-protobuf BinaryWriter / BinaryReader codec (exact protoc-gen-js style)
function encodeGoogleProtobuf(
  msg: PeerUpdate,
  writer = new googleProtobuf.BinaryWriter(),
): Uint8Array {
  writer.reset();
  if (msg.asn !== 0) writer.writeUint32(1, msg.asn);
  if (msg.routerId.length > 0) writer.writeString(2, msg.routerId);
  if (msg.active) writer.writeBool(3, msg.active);
  if (msg.uptimeSec !== 0) writer.writeUint64(4, Number(msg.uptimeSec));
  if (msg.rssiDbm !== 0) writer.writeSint32(5, msg.rssiDbm);
  if (msg.cpuLoad !== 0) writer.writeDouble(6, msg.cpuLoad);
  if (msg.tags.length > 0) writer.writeRepeatedString(7, msg.tags);
  if (msg.prefixes.length > 0) writer.writePackedUint32(8, msg.prefixes);
  if (msg.location) {
    writer.writeMessage(9, msg.location, (loc, w) => {
      if (loc.region.length > 0) w.writeString(1, loc.region);
      if (loc.datacenter.length > 0) w.writeString(2, loc.datacenter);
      if (loc.city.length > 0) w.writeString(3, loc.city);
      if (loc.rack !== 0) w.writeUint32(4, loc.rack);
      if (loc.latitude !== 0) w.writeFloat(5, loc.latitude);
      if (loc.longitude !== 0) w.writeFloat(6, loc.longitude);
    });
  }
  for (let i = 0; i < msg.neighbors.length; i++) {
    writer.writeMessage(10, msg.neighbors[i]!, (nb, w) => {
      if (nb.peerAsn !== 0) w.writeUint32(1, nb.peerAsn);
      if (nb.router.length > 0) w.writeString(2, nb.router);
      if (nb.latencyUs !== 0) w.writeUint32(3, nb.latencyUs);
      if (nb.established) w.writeBool(4, nb.established);
    });
  }
  if (msg.sequence !== 0) writer.writeUint64(11, Number(msg.sequence));
  return writer.getResultBuffer();
}

function decodeGoogleProtobuf(bytes: Uint8Array): PeerUpdate {
  const reader = new googleProtobuf.BinaryReader(bytes);
  const out: PeerUpdate = {
    $typeName: 'omnibuf.bench.PeerUpdate',
    asn: 0,
    routerId: '',
    active: false,
    uptimeSec: 0,
    rssiDbm: 0,
    cpuLoad: 0,
    tags: [],
    prefixes: [],
    location: null,
    neighbors: [],
    sequence: 0,
  };
  while (reader.nextField()) {
    if (reader.isEndGroup()) break;
    switch (reader.getFieldNumber()) {
      case 1:
        out.asn = reader.readUint32();
        break;
      case 2:
        out.routerId = reader.readString();
        break;
      case 3:
        out.active = reader.readBool();
        break;
      case 4:
        out.uptimeSec = reader.readUint64();
        break;
      case 5:
        out.rssiDbm = reader.readSint32();
        break;
      case 6:
        out.cpuLoad = reader.readDouble();
        break;
      case 7:
        out.tags.push(reader.readString());
        break;
      case 8: {
        reader.readPackableUint32Into(out.prefixes);
        break;
      }
      case 9: {
        const loc = {
          $typeName: 'omnibuf.bench.Location' as const,
          region: '',
          datacenter: '',
          city: '',
          rack: 0,
          latitude: 0,
          longitude: 0,
        };
        reader.readMessage(loc, (m, r) => {
          while (r.nextField()) {
            if (r.isEndGroup()) break;
            switch (r.getFieldNumber()) {
              case 1:
                m.region = r.readString();
                break;
              case 2:
                m.datacenter = r.readString();
                break;
              case 3:
                m.city = r.readString();
                break;
              case 4:
                m.rack = r.readUint32();
                break;
              case 5:
                m.latitude = r.readFloat();
                break;
              case 6:
                m.longitude = r.readFloat();
                break;
              default:
                r.skipField();
                break;
            }
          }
        });
        out.location = loc;
        break;
      }
      case 10: {
        const nb = {
          $typeName: 'omnibuf.bench.Neighbor' as const,
          peerAsn: 0,
          router: '',
          latencyUs: 0,
          established: false,
        };
        reader.readMessage(nb, (m, r) => {
          while (r.nextField()) {
            if (r.isEndGroup()) break;
            switch (r.getFieldNumber()) {
              case 1:
                m.peerAsn = r.readUint32();
                break;
              case 2:
                m.router = r.readString();
                break;
              case 3:
                m.latencyUs = r.readUint32();
                break;
              case 4:
                m.established = r.readBool();
                break;
              default:
                r.skipField();
                break;
            }
          }
        });
        out.neighbors.push(nb);
        break;
      }
      case 11:
        out.sequence = reader.readUint64();
        break;
      default:
        reader.skipField();
        break;
    }
  }
  return out;
}

// ============================================================================
// 3. Benchmark Runner Utility
// ============================================================================

interface BenchResult {
  name: string;
  opsPerSec: number;
  nsPerOp: number;
  bytes?: number;
}

function runBench(
  name: string,
  fn: () => unknown,
  options?: { warmupMs?: number; sampleMs?: number; bytes?: number },
): BenchResult {
  const warmupMs = options?.warmupMs ?? 200;
  const sampleMs = options?.sampleMs ?? 600;

  // Warmup
  const warmStart = performance.now();
  while (performance.now() - warmStart < warmupMs) {
    for (let i = 0; i < 200; i++) fn();
  }

  // Timed run
  let iterations = 0;
  const batch = 500;
  const start = performance.now();
  let elapsedMs = 0;
  while (elapsedMs < sampleMs) {
    for (let i = 0; i < batch; i++) {
      fn();
    }
    iterations += batch;
    elapsedMs = performance.now() - start;
  }

  const totalNs = elapsedMs * 1e6;
  const nsPerOp = totalNs / iterations;
  const opsPerSec = (iterations / elapsedMs) * 1000;
  return { name, opsPerSec, nsPerOp, bytes: options?.bytes };
}

const outputLines: string[] = [];
function logLine(line = ''): void {
  console.log(line);
  outputLines.push(line);
}

function printTable(title: string, results: BenchResult[], baselineIdx = 0): void {
  logLine(`\n### ${title}\n`);
  const showBytes = results.some((r) => r.bytes !== undefined);
  const baselineNs = results[baselineIdx]?.nsPerOp ?? 1;

  if (showBytes) {
    logLine(
      '| Codec / Operation | Latency (ns/op) | Throughput (ops/sec) | Wire Size (B) | vs Baseline |',
    );
    logLine('|---|---:|---:|---:|---:|');
  } else {
    logLine('| Codec / Operation | Latency (ns/op) | Throughput (ops/sec) | vs Baseline |');
    logLine('|---|---:|---:|---:|');
  }

  for (const r of results) {
    const nsStr = r.nsPerOp.toFixed(0).padStart(6);
    const opsStr = Math.round(r.opsPerSec).toLocaleString('en-US');
    const ratio = r.nsPerOp / baselineNs;
    const relStr =
      Math.abs(ratio - 1) < 0.03
        ? '1.00x (baseline)'
        : ratio > 1
          ? `${ratio.toFixed(2)}x slower`
          : `${(1 / ratio).toFixed(2)}x faster`;
    if (showBytes) {
      logLine(`| ${r.name} | ${nsStr} ns | ${opsStr} | ${r.bytes ?? '-'} | ${relStr} |`);
    } else {
      logLine(`| ${r.name} | ${nsStr} ns | ${opsStr} | ${relStr} |`);
    }
  }
}

// ============================================================================
// 4. Execute Benchmarks
// ============================================================================

export let benchSink = 0;

function consumeBytes(out: Uint8Array): void {
  const len = out.byteLength;
  benchSink = (benchSink + len + (len > 0 ? out[0]! + out[len - 1]! : 0)) | 0;
}

function u64Low(v: unknown): number {
  if (typeof v === 'number') return v | 0;
  if (typeof v === 'bigint') return Number(v & 0x7fffffffn) | 0;
  return Number(v) | 0;
}

interface DecodedPeerLike {
  asn: number;
  routerId: string;
  active: boolean;
  uptimeSec: number | bigint;
  rssiDbm: number;
  cpuLoad: number;
  tags: string[];
  prefixes: number[];
  location?: {
    region: string;
    datacenter: string;
    city: string;
    rack: number;
    latitude: number;
    longitude: number;
  } | null;
  neighbors: Array<{
    peerAsn: number;
    router: string;
    latencyUs: number;
    established: boolean;
  }>;
  sequence: number | bigint;
}

function consumeDecodedPeer(m: DecodedPeerLike): void {
  let acc = ((m.asn | 0) + m.routerId.length + (m.active ? 1 : 0)) | 0;
  acc = (acc + u64Low(m.uptimeSec) + (m.rssiDbm | 0) + ((m.cpuLoad * 1000) | 0)) | 0;
  const tags = m.tags;
  for (let i = 0; i < tags.length; i++) {
    acc = (acc + tags[i].length) | 0;
  }
  const prefixes = m.prefixes;
  for (let i = 0; i < prefixes.length; i++) {
    acc = (acc + (prefixes[i] | 0)) | 0;
  }
  const loc = m.location;
  if (loc) {
    acc =
      (acc +
        loc.region.length +
        loc.datacenter.length +
        loc.city.length +
        (loc.rack | 0) +
        ((loc.latitude * 100) | 0) +
        ((loc.longitude * 100) | 0)) |
      0;
  }
  const neighbors = m.neighbors;
  for (let i = 0; i < neighbors.length; i++) {
    const nb = neighbors[i];
    acc =
      (acc + (nb.peerAsn | 0) + nb.router.length + (nb.latencyUs | 0) + (nb.established ? 1 : 0)) |
      0;
  }
  acc = (acc + u64Low(m.sequence)) | 0;
  benchSink = (benchSink + acc) | 0;
}

function toBufPeerUpdate(p: PeerUpdate) {
  return createBufMsg(BufPeerUpdateDesc, {
    asn: p.asn,
    routerId: p.routerId,
    active: p.active,
    uptimeSec: BigInt(p.uptimeSec),
    rssiDbm: p.rssiDbm,
    cpuLoad: p.cpuLoad,
    tags: [...p.tags],
    prefixes: [...p.prefixes],
    location: {
      region: p.location!.region,
      datacenter: p.location!.datacenter,
      city: p.location!.city,
      rack: p.location!.rack,
      latitude: p.location!.latitude,
      longitude: p.location!.longitude,
    },
    neighbors: p.neighbors.map((n) => ({
      peerAsn: n.peerAsn,
      router: n.router,
      latencyUs: n.latencyUs,
      established: n.established,
    })),
    sequence: BigInt(p.sequence),
  });
}

const sample = createSamplePeerUpdate();
const bufSample = toBufPeerUpdate(sample);

const largeSample = createLargeNestedPeerUpdate();
const bufLargeSample = toBufPeerUpdate(largeSample);

const manyNeighborsSample = createManyNeighborsPeerUpdate();
const bufManyNeighborsSample = toBufPeerUpdate(manyNeighborsSample);
const grownDC = 'd'.repeat(20480);

const gpbWriter = new googleProtobuf.BinaryWriter();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const omnibufBytes = toBinary(PeerUpdateSchema, sample);
const protobufEsBytes = bufToBinary(BufPeerUpdateDesc, bufSample);
const pbjsBytes = PbjsPeerUpdate.encode(sample).finish();
const gpbBytes = encodeGoogleProtobuf(sample);
const msgpackBytes = msgpackEncode(sample);
const jsonBytes = textEncoder.encode(JSON.stringify(sample));

const largeOmnibufBytes = toBinary(PeerUpdateSchema, largeSample);
const largeProtobufEsBytes = bufToBinary(BufPeerUpdateDesc, bufLargeSample);
const largePbjsBytes = PbjsPeerUpdate.encode(largeSample).finish();
const largeGpbBytes = encodeGoogleProtobuf(largeSample);
const largeMsgpackBytes = msgpackEncode(largeSample);
const largeJsonBytes = textEncoder.encode(JSON.stringify(largeSample));

const manyOmnibufBytes = toBinary(PeerUpdateSchema, manyNeighborsSample);
const manyProtobufEsBytes = bufToBinary(BufPeerUpdateDesc, bufManyNeighborsSample);
const manyPbjsBytes = PbjsPeerUpdate.encode(manyNeighborsSample).finish();
const manyGpbBytes = encodeGoogleProtobuf(manyNeighborsSample);
const manyMsgpackBytes = msgpackEncode(manyNeighborsSample);
const manyJsonBytes = textEncoder.encode(JSON.stringify(manyNeighborsSample));

// Verify every decoder materializes the exact same 11-field checksum before timing
{
  const decodedSamples = [
    fromBinary(PeerUpdateSchema, omnibufBytes, { readUnknownFields: false }),
    PbjsPeerUpdate.decode(pbjsBytes),
    bufFromBinary(BufPeerUpdateDesc, protobufEsBytes),
    decodeGoogleProtobuf(gpbBytes),
    msgpackDecode(msgpackBytes),
    JSON.parse(textDecoder.decode(jsonBytes)),
  ];
  benchSink = 0;
  consumeDecodedPeer(decodedSamples[0]);
  const expectedChecksum = benchSink;
  for (let i = 1; i < decodedSamples.length; i++) {
    benchSink = 0;
    consumeDecodedPeer(decodedSamples[i]);
    if (benchSink !== expectedChecksum) {
      throw new Error(
        `Decoded PeerUpdate checksum mismatch at codec ${i}: got ${benchSink}, expected ${expectedChecksum}`,
      );
    }
  }
}

const cpuModel = cpus()[0]?.model ?? 'unknown';
logLine('============================================================================');
logLine(
  `OmniBuf-ES Benchmark Suite (Node.js ${process.version} / ${platform()}-${osArch()} / ${cpuModel})`,
);
logLine('Workload: Canonical PeerUpdate (nested submessage, 4 neighbors, arrays, scalars)');
logLine('============================================================================');

// 1. Full Message Encode Speed
const marshalResults: BenchResult[] = [
  runBench('OmniBuf', () => consumeBytes(toBinary(PeerUpdateSchema, sample)), {
    bytes: omnibufBytes.byteLength,
  }),
  runBench('protobufjs', () => consumeBytes(PbjsPeerUpdate.encode(sample).finish()), {
    bytes: pbjsBytes.byteLength,
  }),
  runBench(
    '@bufbuild/protobuf (protobuf-es)',
    () => consumeBytes(bufToBinary(BufPeerUpdateDesc, bufSample)),
    { bytes: protobufEsBytes.byteLength },
  ),
  runBench('google-protobuf', () => consumeBytes(encodeGoogleProtobuf(sample, gpbWriter)), {
    bytes: gpbBytes.byteLength,
  }),
  runBench('@msgpack/msgpack', () => consumeBytes(msgpackEncode(sample)), {
    bytes: msgpackBytes.byteLength,
  }),
  runBench('JSON', () => consumeBytes(textEncoder.encode(JSON.stringify(sample))), {
    bytes: jsonBytes.byteLength,
  }),
];
printTable('1. Full Message Encode Speed', marshalResults, 0);

// 2. Full Message Decode Speed
const unmarshalResults: BenchResult[] = [
  runBench('OmniBuf', () =>
    consumeDecodedPeer(fromBinary(PeerUpdateSchema, omnibufBytes, { readUnknownFields: false })),
  ),
  runBench('protobufjs', () => consumeDecodedPeer(PbjsPeerUpdate.decode(pbjsBytes))),
  runBench('@bufbuild/protobuf (protobuf-es)', () =>
    consumeDecodedPeer(bufFromBinary(BufPeerUpdateDesc, protobufEsBytes)),
  ),
  runBench('google-protobuf', () => consumeDecodedPeer(decodeGoogleProtobuf(gpbBytes))),
  runBench('@msgpack/msgpack', () => consumeDecodedPeer(msgpackDecode(msgpackBytes))),
  runBench('JSON', () => consumeDecodedPeer(JSON.parse(textDecoder.decode(jsonBytes)))),
];
printTable('2. Full Message Decode Speed', unmarshalResults, 0);

// 3. Read a Single Nested Field
const lookupCityResults: BenchResult[] = [
  runBench('OmniBuf', () => {
    const view = new OpaquePeerUpdate(omnibufBytes);
    const city = view.location()?.city;
    if (!city || city.length !== 9) throw new Error('lookup failed');
    benchSink = (benchSink + city.length) | 0;
  }),
  runBench('protobufjs', () => {
    const m = PbjsPeerUpdate.decode(pbjsBytes) as unknown as DecodedPeerLike;
    const city = m.location?.city;
    if (!city || city.length !== 9) throw new Error('lookup failed');
    benchSink = (benchSink + city.length) | 0;
  }),
  runBench('@bufbuild/protobuf (protobuf-es)', () => {
    const m = bufFromBinary(BufPeerUpdateDesc, protobufEsBytes) as unknown as DecodedPeerLike;
    const city = m.location?.city;
    if (!city || city.length !== 9) throw new Error('lookup failed');
    benchSink = (benchSink + city.length) | 0;
  }),
  runBench('google-protobuf', () => {
    const m = decodeGoogleProtobuf(gpbBytes);
    const city = m.location?.city;
    if (!city || city.length !== 9) throw new Error('lookup failed');
    benchSink = (benchSink + city.length) | 0;
  }),
  runBench('@msgpack/msgpack', () => {
    const m = msgpackDecode(msgpackBytes) as DecodedPeerLike;
    const city = m.location?.city;
    if (!city || city.length !== 9) throw new Error('lookup failed');
    benchSink = (benchSink + city.length) | 0;
  }),
  runBench('JSON', () => {
    const m = JSON.parse(textDecoder.decode(jsonBytes));
    const city = m.location?.city as string | undefined;
    if (!city || city.length !== 9) throw new Error('lookup failed');
    benchSink = (benchSink + city.length) | 0;
  }),
];
printTable('3. Read a Single Nested Field', lookupCityResults, 0);

// 4. Selective Single-Field Mutation
const mutateResults: BenchResult[] = [
  runBench('OmniBuf', () => {
    const view = new OpaquePeerUpdate(omnibufBytes);
    if (view.getLocation()?.city === 'Frankfurt') {
      view.setSequence(Number(view.getSequence()) + 1);
    }
    consumeBytes(view.marshal());
  }),
  runBench('protobufjs', () => {
    const m = PbjsPeerUpdate.decode(pbjsBytes) as unknown as DecodedPeerLike;
    if (m.location?.city === 'Frankfurt') {
      m.sequence = Number(m.sequence) + 1;
    }
    consumeBytes(PbjsPeerUpdate.encode(m).finish());
  }),
  runBench('@bufbuild/protobuf (protobuf-es)', () => {
    const m = bufFromBinary(BufPeerUpdateDesc, protobufEsBytes);
    const rec = m as unknown as DecodedPeerLike;
    if (rec.location?.city === 'Frankfurt') {
      rec.sequence = BigInt(rec.sequence) + 1n;
    }
    consumeBytes(bufToBinary(BufPeerUpdateDesc, m));
  }),
  runBench('google-protobuf', () => {
    const m = decodeGoogleProtobuf(gpbBytes);
    if (m.location?.city === 'Frankfurt') {
      m.sequence = Number(m.sequence) + 1;
    }
    consumeBytes(encodeGoogleProtobuf(m, gpbWriter));
  }),
  runBench('@msgpack/msgpack', () => {
    const m = msgpackDecode(msgpackBytes) as DecodedPeerLike;
    if (m.location?.city === 'Frankfurt') {
      m.sequence = Number(m.sequence) + 1;
    }
    consumeBytes(msgpackEncode(m));
  }),
  runBench('JSON', () => {
    const m = JSON.parse(textDecoder.decode(jsonBytes));
    if (m.location?.city === 'Frankfurt') {
      m.sequence = Number(m.sequence) + 1;
    }
    consumeBytes(textEncoder.encode(JSON.stringify(m)));
  }),
];
printTable('4. Selective Single-Field Mutation', mutateResults, 0);

// 5. Large Embedded Message Encode
const largeEncodeResults: BenchResult[] = [
  runBench('OmniBuf', () => consumeBytes(toBinary(PeerUpdateSchema, largeSample)), {
    bytes: largeOmnibufBytes.byteLength,
  }),
  runBench('protobufjs', () => consumeBytes(PbjsPeerUpdate.encode(largeSample).finish()), {
    bytes: largePbjsBytes.byteLength,
  }),
  runBench(
    '@bufbuild/protobuf (protobuf-es)',
    () => consumeBytes(bufToBinary(BufPeerUpdateDesc, bufLargeSample)),
    { bytes: largeProtobufEsBytes.byteLength },
  ),
  runBench('google-protobuf', () => consumeBytes(encodeGoogleProtobuf(largeSample, gpbWriter)), {
    bytes: largeGpbBytes.byteLength,
  }),
  runBench('@msgpack/msgpack', () => consumeBytes(msgpackEncode(largeSample)), {
    bytes: largeMsgpackBytes.byteLength,
  }),
  runBench('JSON', () => consumeBytes(textEncoder.encode(JSON.stringify(largeSample))), {
    bytes: largeJsonBytes.byteLength,
  }),
];
printTable('5. Large Embedded Message Encode', largeEncodeResults, 0);

// 6. Embedded Message Growth
const embeddedGrowResults: BenchResult[] = [
  runBench('OmniBuf', () => {
    const view = new OpaquePeerUpdate(manyOmnibufBytes);
    const loc = view.getLocation();
    if (loc && loc.city === 'Frankfurt') {
      view.setLocation({
        $typeName: 'omnibuf.bench.Location',
        region: loc.region,
        datacenter: grownDC,
        city: loc.city,
        rack: loc.rack,
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
    }
    consumeBytes(view.marshal());
  }),
  runBench('protobufjs', () => {
    const m = PbjsPeerUpdate.decode(manyPbjsBytes) as unknown as DecodedPeerLike;
    if (m.location?.city === 'Frankfurt') {
      m.location.datacenter = grownDC;
    }
    consumeBytes(PbjsPeerUpdate.encode(m).finish());
  }),
  runBench('@bufbuild/protobuf (protobuf-es)', () => {
    const m = bufFromBinary(BufPeerUpdateDesc, manyProtobufEsBytes);
    const rec = m as unknown as DecodedPeerLike;
    if (rec.location?.city === 'Frankfurt') {
      rec.location.datacenter = grownDC;
    }
    consumeBytes(bufToBinary(BufPeerUpdateDesc, m));
  }),
  runBench('google-protobuf', () => {
    const m = decodeGoogleProtobuf(manyGpbBytes);
    if (m.location?.city === 'Frankfurt') {
      m.location.datacenter = grownDC;
    }
    consumeBytes(encodeGoogleProtobuf(m, gpbWriter));
  }),
  runBench('@msgpack/msgpack', () => {
    const m = msgpackDecode(manyMsgpackBytes) as DecodedPeerLike;
    if (m.location?.city === 'Frankfurt') {
      m.location.datacenter = grownDC;
    }
    consumeBytes(msgpackEncode(m));
  }),
  runBench('JSON', () => {
    const m = JSON.parse(textDecoder.decode(manyJsonBytes));
    if (m.location?.city === 'Frankfurt') {
      m.location.datacenter = grownDC;
    }
    consumeBytes(textEncoder.encode(JSON.stringify(m)));
  }),
];
printTable('6. Embedded Message Growth', embeddedGrowResults, 0);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawTxtPath = resolve(repoRoot, 'testdata/benchmarks.txt');
const rawJsonPath = resolve(repoRoot, 'testdata/benchmarks.json');

writeFileSync(rawTxtPath, `${outputLines.join('\n')}\n`, 'utf8');
writeFileSync(
  rawJsonPath,
  `${JSON.stringify(
    {
      runtime: `Node.js ${process.version}`,
      platform: platform(),
      arch: osArch(),
      cpu: cpuModel,
      workload: 'PeerUpdate',
      categories: [
        {
          id: 'encode',
          title: 'Full Message Encode Speed',
          results: marshalResults.map((r) => ({
            name: r.name,
            nsPerOp: Math.round(r.nsPerOp),
            opsPerSec: Math.round(r.opsPerSec),
            wireBytes: r.bytes,
          })),
        },
        {
          id: 'decode',
          title: 'Full Message Decode Speed',
          results: unmarshalResults.map((r) => ({
            name: r.name,
            nsPerOp: Math.round(r.nsPerOp),
            opsPerSec: Math.round(r.opsPerSec),
          })),
        },
        {
          id: 'lookup_city',
          title: 'Read a Single Nested Field',
          results: lookupCityResults.map((r) => ({
            name: r.name,
            nsPerOp: Math.round(r.nsPerOp),
            opsPerSec: Math.round(r.opsPerSec),
          })),
        },
        {
          id: 'mutate_sequence',
          title: 'Selective Single-Field Mutation',
          results: mutateResults.map((r) => ({
            name: r.name,
            nsPerOp: Math.round(r.nsPerOp),
            opsPerSec: Math.round(r.opsPerSec),
          })),
        },
        {
          id: 'encode_nested_shift',
          title: 'Large Embedded Message Encode',
          results: largeEncodeResults.map((r) => ({
            name: r.name,
            nsPerOp: Math.round(r.nsPerOp),
            opsPerSec: Math.round(r.opsPerSec),
            wireBytes: r.bytes,
          })),
        },
        {
          id: 'mutate_embedded_grow',
          title: 'Embedded Message Growth',
          results: embeddedGrowResults.map((r) => ({
            name: r.name,
            nsPerOp: Math.round(r.nsPerOp),
            opsPerSec: Math.round(r.opsPerSec),
          })),
        },
      ],
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`\nSaved raw benchmark data to ${rawTxtPath} and ${rawJsonPath}`);
