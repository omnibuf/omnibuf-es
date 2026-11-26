import {
  DescriptorRegistry,
  Encoder,
  ProtoScalarType,
  decodeBlind,
  decodeBlindJSON,
  defineMessage,
  fromBinary,
  spliceFields,
  toBinary,
  type FileDescriptorSetJSON,
  type MessageSchema,
  type ProtobufDescMessage,
} from '@omnibuf/core';
import {
  OpaquePeerUpdate,
  PeerUpdateSchema,
  createLocation,
  createNeighbor,
  createPeerUpdate,
  decodePeerUpdate,
  marshalPeerUpdateOmniBuf,
} from './gen/peer_omnibuf.pb.js';
import {
  OpaqueTestAllTypes,
  createAllTypesSubMsg,
  createTestAllTypes,
  decodeTestAllTypes,
  marshalTestAllTypesOmniBuf,
} from './gen/conformance_omnibuf.pb.js';
import {
  Editions2023Status,
  OpaqueTestEditions2023,
  createEditions2023Child,
  createTestEditions2023,
  decodeTestEditions2023,
  marshalTestEditions2023OmniBuf,
} from './gen/editions_2023_omnibuf.pb.js';
import {
  Editions2024Status,
  OpaqueTestEditions2024,
  createEditions2024Child,
  createTestEditions2024,
  decodeTestEditions2024,
  marshalTestEditions2024OmniBuf,
} from './gen/editions_2024_omnibuf.pb.js';
import {
  Editions2026Status,
  OpaqueTestEditions2026,
  createEditions2026Child,
  createTestEditions2026,
  decodeTestEditions2026,
  marshalTestEditions2026OmniBuf,
} from './gen/editions_2026_omnibuf.pb.js';

export const WireFormatUnspecified = 0;
export const WireFormatOmniBuf = 1;
export const WireFormatJSON = 2;

export const TestTierUnspecified = 0;
export const TestTierPlugin = 1;
export const TestTierProtobufTypes = 2;
export const TestTierAnnotatedStruct = 3;
export const TestTierBlind = 4;

export interface ConformanceRequest {
  test_name: string;
  message_type: string;
  tier: number;
  requested_output_format: number;
  omnibuf_payload: Uint8Array;
  json_payload: string;
  self_describing: boolean;
  test_opaque_splice: boolean;
  test_opaque_splice_shrink: boolean;
}

export interface ConformanceResponse {
  parse_error: string;
  serialize_error: string;
  runtime_error: string;
  skipped: string;
  omnibuf_payload: Uint8Array;
  json_payload: string;
}

export const ConformanceRequestSchema: MessageSchema<ConformanceRequest> =
  defineMessage<ConformanceRequest>('ConformanceRequest', {
    test_name: { fieldNum: 1, type: 'string' },
    message_type: { fieldNum: 2, type: 'string' },
    // Upstream conformance-runner (omnibuf-go/internal/conformance/protocol.go) encodes
    // tier and requested_output_format as uint32 (WireUint) on the IPC wire.
    tier: { fieldNum: 3, type: 'uint32' },
    requested_output_format: { fieldNum: 4, type: 'uint32' },
    omnibuf_payload: { fieldNum: 5, type: 'bytes' },
    json_payload: { fieldNum: 6, type: 'string' },
    self_describing: { fieldNum: 7, type: 'bool' },
    test_opaque_splice: { fieldNum: 8, type: 'bool' },
    test_opaque_splice_shrink: { fieldNum: 9, type: 'bool' },
  });

export const ConformanceResponseSchema: MessageSchema<ConformanceResponse> =
  defineMessage<ConformanceResponse>('ConformanceResponse', {
    parse_error: { fieldNum: 1, type: 'string' },
    serialize_error: { fieldNum: 2, type: 'string' },
    runtime_error: { fieldNum: 3, type: 'string' },
    skipped: { fieldNum: 4, type: 'string' },
    omnibuf_payload: { fieldNum: 5, type: 'bytes' },
    json_payload: { fieldNum: 6, type: 'string' },
  });

export const AllTypesSubMsgSchema: MessageSchema<Record<string, unknown>> = defineMessage(
  'AllTypesSubMsg',
  {
    id: { fieldNum: 1, type: 'uint32' },
    label: { fieldNum: 2, type: 'string' },
    flag: { fieldNum: 3, type: 'bool' },
    score: { fieldNum: 4, type: 'sint64', wire: 'sint' },
  },
);

export const TestAllTypesSchema: MessageSchema<Record<string, unknown>> = defineMessage(
  'TestAllTypes',
  {
    f1_uint32: { fieldNum: 1, type: 'uint32' },
    f2_uint64: { fieldNum: 2, type: 'uint64' },
    f3_sint32: { fieldNum: 3, type: 'sint32', wire: 'sint' },
    f4_sint64: { fieldNum: 4, type: 'sint64', wire: 'sint' },
    f5_bool: { fieldNum: 5, type: 'bool' },
    f6_string: { fieldNum: 6, type: 'string' },
    f7_bytes: { fieldNum: 7, type: 'bytes' },
    f8_sub_msg: {
      fieldNum: 8,
      type: 'submsg',
      optional: true,
      subSchema: () => AllTypesSubMsgSchema,
    },
    f9_string_arr: { fieldNum: 9, type: 'string[]' },
    f10_uint32_arr: { fieldNum: 10, type: 'uint32[]' },
    f11_sub_msg_arr: { fieldNum: 11, type: 'submsg[]', subSchema: () => AllTypesSubMsgSchema },
    f12_map_str_uint: { fieldNum: 12, type: 'map', mapKey: 'string', mapVal: 'uint64' },
    f13_float32: { fieldNum: 13, type: 'float32' },
    f14_float64: { fieldNum: 14, type: 'float64' },
    f15_fixed32: { fieldNum: 15, type: 'fixed32', wire: 'fixed32' },
    f16_fixed64: { fieldNum: 16, type: 'fixed64', wire: 'fixed64' },
    f20_overflow_str: { fieldNum: 20, type: 'string' },
  },
);

export const TreeNodeSchema: MessageSchema<Record<string, unknown>> = defineMessage('TreeNode', {
  id: { fieldNum: 1, type: 'uint32' },
  name: { fieldNum: 2, type: 'string' },
  weight: { fieldNum: 3, type: 'sint64', wire: 'sint' },
  primary: { fieldNum: 4, type: 'submsg', optional: true, subSchema: () => TreeNodeSchema },
  children: { fieldNum: 5, type: 'submsg[]', subSchema: () => TreeNodeSchema },
  branches: { fieldNum: 6, type: 'submsg[]', subSchema: () => TreeNodeSchema },
  labels: { fieldNum: 7, type: 'map', mapKey: 'string', mapVal: 'uint64' },
});

export const NestedNICSchema: MessageSchema<Record<string, unknown>> = defineMessage('NestedNIC', {
  if_index: { fieldNum: 1, type: 'uint32' },
  mac: { fieldNum: 2, type: 'string' },
  ips: { fieldNum: 3, type: 'uint32[]' },
});

export const NestedServerSchema: MessageSchema<Record<string, unknown>> = defineMessage(
  'NestedServer',
  {
    server_id: { fieldNum: 1, type: 'uint32' },
    hostname: { fieldNum: 2, type: 'string' },
    nics: { fieldNum: 3, type: 'submsg[]', subSchema: () => NestedNICSchema },
  },
);

export const NestedRackSchema: MessageSchema<Record<string, unknown>> = defineMessage(
  'NestedRack',
  {
    rack_id: { fieldNum: 1, type: 'uint32' },
    zone: { fieldNum: 2, type: 'string' },
    servers: { fieldNum: 3, type: 'submsg[]', subSchema: () => NestedServerSchema },
  },
);

export const NestedClusterSchema: MessageSchema<Record<string, unknown>> = defineMessage(
  'NestedCluster',
  {
    cluster_name: { fieldNum: 1, type: 'string' },
    racks: { fieldNum: 2, type: 'submsg[]', subSchema: () => NestedRackSchema },
    epoch: { fieldNum: 3, type: 'uint64' },
  },
);

/**
 * Built-in `FileDescriptorSetJSON` for `omnibuf.bench.PeerUpdate` and `omnibuf.conformance.TestAllTypes`
 * so the conformance adapter and Tier 2 / Tier 1 plugin tests work out of the box.
 */
export const CONFORMANCE_FDS: FileDescriptorSetJSON = {
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
          name: 'AllTypesSubMsg',
          field: [
            { name: 'id', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'label', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'flag', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
            { name: 'score', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_SINT64' },
          ],
        },
        {
          name: 'TestAllTypes',
          field: [
            { name: 'f1_uint32', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT32' },
            { name: 'f2_uint64', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT64' },
            { name: 'f3_sint32', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_SINT32' },
            { name: 'f4_sint64', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_SINT64' },
            { name: 'f5_bool', number: 5, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
            { name: 'f6_string', number: 6, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'f7_bytes', number: 7, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
            {
              name: 'f8_sub_msg',
              number: 8,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.AllTypesSubMsg',
            },
            { name: 'f9_string_arr', number: 9, label: 'LABEL_REPEATED', type: 'TYPE_STRING' },
            { name: 'f10_uint32_arr', number: 10, label: 'LABEL_REPEATED', type: 'TYPE_UINT32' },
            {
              name: 'f11_sub_msg_arr',
              number: 11,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.AllTypesSubMsg',
            },
            {
              name: 'f12_map_str_uint',
              number: 12,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.TestAllTypes.F12MapStrUintEntry',
            },
            { name: 'f13_float32', number: 13, label: 'LABEL_OPTIONAL', type: 'TYPE_FLOAT' },
            { name: 'f14_float64', number: 14, label: 'LABEL_OPTIONAL', type: 'TYPE_DOUBLE' },
            { name: 'f15_fixed32', number: 15, label: 'LABEL_OPTIONAL', type: 'TYPE_FIXED32' },
            { name: 'f16_fixed64', number: 16, label: 'LABEL_OPTIONAL', type: 'TYPE_FIXED64' },
            { name: 'f20_overflow_str', number: 20, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
          ],
          nestedType: [
            {
              name: 'F12MapStrUintEntry',
              options: { mapEntry: true },
              field: [
                { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_UINT64' },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'omnibuf/conformance/editions_2023.proto',
      package: 'omnibuf.conformance',
      syntax: 'editions',
      edition: 1000,
      enumType: [
        {
          name: 'Editions2023Status',
          value: [
            { name: 'EDITIONS2023_STATUS_UNSPECIFIED', number: 0 },
            { name: 'EDITIONS2023_STATUS_ACTIVE', number: 1 },
            { name: 'EDITIONS2023_STATUS_PAUSED', number: 2 },
          ],
        },
      ],
      messageType: [
        {
          name: 'Editions2023Child',
          field: [
            { name: 'id', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
            { name: 'note', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
          ],
        },
        {
          name: 'TestEditions2023',
          oneofDecl: [{ name: 'choice' }],
          field: [
            { name: 'explicit_int', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
            { name: 'explicit_bool', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
            { name: 'explicit_string', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'explicit_bytes', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
            { name: 'explicit_double', number: 5, label: 'LABEL_OPTIONAL', type: 'TYPE_DOUBLE' },
            {
              name: 'status',
              number: 6,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_ENUM',
              typeName: '.omnibuf.conformance.Editions2023Status',
            },
            {
              name: 'implicit_count',
              number: 7,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              options: { features: { fieldPresence: 'IMPLICIT' } },
            },
            {
              name: 'implicit_flag',
              number: 8,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BOOL',
              options: { features: { fieldPresence: 'IMPLICIT' } },
            },
            {
              name: 'child',
              number: 9,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2023Child',
            },
            {
              name: 'delimited_child',
              number: 10,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2023Child',
              options: { features: { messageEncoding: 'DELIMITED' } },
            },
            { name: 'packed_vals', number: 11, label: 'LABEL_REPEATED', type: 'TYPE_INT32' },
            {
              name: 'expanded_vals',
              number: 12,
              label: 'LABEL_REPEATED',
              type: 'TYPE_INT32',
              options: { features: { repeatedFieldEncoding: 'EXPANDED' } },
            },
            {
              name: 'scores',
              number: 13,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.TestEditions2023.ScoresEntry',
            },
            {
              name: 'choice_int',
              number: 14,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              oneofIndex: 0,
            },
            {
              name: 'choice_text',
              number: 15,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_STRING',
              oneofIndex: 0,
            },
            {
              name: 'choice_flag',
              number: 16,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BOOL',
              oneofIndex: 0,
            },
            {
              name: 'choice_child',
              number: 17,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2023Child',
              oneofIndex: 0,
            },
          ],
          nestedType: [
            {
              name: 'ScoresEntry',
              options: { mapEntry: true },
              field: [
                { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'omnibuf/conformance/editions_2024.proto',
      package: 'omnibuf.conformance',
      syntax: 'editions',
      edition: 1001,
      options: {
        features: {
          fieldPresence: 'IMPLICIT',
          repeatedFieldEncoding: 'EXPANDED',
        },
      },
      enumType: [
        {
          name: 'Editions2024Status',
          value: [
            { name: 'EDITIONS2024_STATUS_UNSPECIFIED', number: 0 },
            { name: 'EDITIONS2024_STATUS_ACTIVE', number: 1 },
            { name: 'EDITIONS2024_STATUS_PAUSED', number: 2 },
          ],
        },
      ],
      messageType: [
        {
          name: 'Editions2024Child',
          field: [
            {
              name: 'id',
              number: 1,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            {
              name: 'note',
              number: 2,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_STRING',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
          ],
        },
        {
          name: 'TestEditions2024',
          options: { features: { jsonFormat: 'LEGACY_BEST_EFFORT' } },
          oneofDecl: [{ name: 'choice' }],
          field: [
            {
              name: 'explicit_int',
              number: 1,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            {
              name: 'explicit_bool',
              number: 2,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BOOL',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            {
              name: 'explicit_string',
              number: 3,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_STRING',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            {
              name: 'explicit_bytes',
              number: 4,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BYTES',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            {
              name: 'explicit_double',
              number: 5,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_DOUBLE',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            {
              name: 'status',
              number: 6,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_ENUM',
              typeName: '.omnibuf.conformance.Editions2024Status',
              options: { features: { fieldPresence: 'EXPLICIT' } },
            },
            { name: 'implicit_count', number: 7, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
            { name: 'implicit_flag', number: 8, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
            {
              name: 'child',
              number: 9,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2024Child',
            },
            {
              name: 'delimited_child',
              number: 10,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2024Child',
              options: { features: { messageEncoding: 'DELIMITED' } },
            },
            {
              name: 'packed_vals',
              number: 11,
              label: 'LABEL_REPEATED',
              type: 'TYPE_INT32',
              options: { features: { repeatedFieldEncoding: 'PACKED' } },
            },
            { name: 'expanded_vals', number: 12, label: 'LABEL_REPEATED', type: 'TYPE_INT32' },
            {
              name: 'scores',
              number: 13,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.TestEditions2024.ScoresEntry',
            },
            {
              name: 'choice_int',
              number: 14,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              oneofIndex: 0,
            },
            {
              name: 'choice_text',
              number: 15,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_STRING',
              oneofIndex: 0,
            },
            {
              name: 'choice_flag',
              number: 16,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BOOL',
              oneofIndex: 0,
            },
            {
              name: 'choice_child',
              number: 17,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2024Child',
              oneofIndex: 0,
            },
          ],
          nestedType: [
            {
              name: 'ScoresEntry',
              options: { mapEntry: true },
              field: [
                { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'omnibuf/conformance/editions_2026.proto',
      package: 'omnibuf.conformance',
      syntax: 'editions',
      edition: 1002,
      enumType: [
        {
          name: 'Editions2026Status',
          value: [
            { name: 'EDITIONS2026_STATUS_UNSPECIFIED', number: 0 },
            { name: 'EDITIONS2026_STATUS_ACTIVE', number: 1 },
            { name: 'EDITIONS2026_STATUS_PAUSED', number: 2 },
          ],
        },
      ],
      messageType: [
        {
          name: 'Editions2026Child',
          field: [
            { name: 'id', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
            { name: 'note', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
          ],
        },
        {
          name: 'TestEditions2026',
          oneofDecl: [{ name: 'choice' }],
          field: [
            { name: 'explicit_int', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
            { name: 'explicit_bool', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_BOOL' },
            { name: 'explicit_string', number: 3, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
            { name: 'explicit_bytes', number: 4, label: 'LABEL_OPTIONAL', type: 'TYPE_BYTES' },
            { name: 'explicit_double', number: 5, label: 'LABEL_OPTIONAL', type: 'TYPE_DOUBLE' },
            {
              name: 'status',
              number: 6,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_ENUM',
              typeName: '.omnibuf.conformance.Editions2026Status',
            },
            {
              name: 'implicit_count',
              number: 7,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              options: { features: { fieldPresence: 'IMPLICIT' } },
            },
            {
              name: 'implicit_flag',
              number: 8,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BOOL',
              options: { features: { fieldPresence: 'IMPLICIT' } },
            },
            {
              name: 'child',
              number: 9,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2026Child',
            },
            {
              name: 'delimited_child',
              number: 10,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2026Child',
              options: { features: { messageEncoding: 'DELIMITED' } },
            },
            { name: 'packed_vals', number: 11, label: 'LABEL_REPEATED', type: 'TYPE_INT32' },
            {
              name: 'expanded_vals',
              number: 12,
              label: 'LABEL_REPEATED',
              type: 'TYPE_INT32',
              options: { features: { repeatedFieldEncoding: 'EXPANDED' } },
            },
            {
              name: 'scores',
              number: 13,
              label: 'LABEL_REPEATED',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.TestEditions2026.ScoresEntry',
            },
            {
              name: 'choice_int',
              number: 14,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_INT32',
              oneofIndex: 0,
            },
            {
              name: 'choice_text',
              number: 15,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_STRING',
              oneofIndex: 0,
            },
            {
              name: 'choice_flag',
              number: 16,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_BOOL',
              oneofIndex: 0,
            },
            {
              name: 'choice_child',
              number: 17,
              label: 'LABEL_OPTIONAL',
              type: 'TYPE_MESSAGE',
              typeName: '.omnibuf.conformance.Editions2026Child',
              oneofIndex: 0,
            },
          ],
          nestedType: [
            {
              name: 'ScoresEntry',
              options: { mapEntry: true },
              field: [
                { name: 'key', number: 1, label: 'LABEL_OPTIONAL', type: 'TYPE_STRING' },
                { name: 'value', number: 2, label: 'LABEL_OPTIONAL', type: 'TYPE_INT32' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const LocationProtobufDesc: ProtobufDescMessage = {
  typeName: 'omnibuf.bench.Location',
  fields: [
    {
      number: 1,
      name: 'region',
      localName: 'region',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 2,
      name: 'datacenter',
      localName: 'datacenter',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 3,
      name: 'city',
      localName: 'city',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 4,
      name: 'rack',
      localName: 'rack',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 5,
      name: 'latitude',
      localName: 'latitude',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.FLOAT,
    },
    {
      number: 6,
      name: 'longitude',
      localName: 'longitude',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.FLOAT,
    },
  ],
};

export const NeighborProtobufDesc: ProtobufDescMessage = {
  typeName: 'omnibuf.bench.Neighbor',
  fields: [
    {
      number: 1,
      name: 'peer_asn',
      localName: 'peerAsn',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 2,
      name: 'router',
      localName: 'router',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 3,
      name: 'latency_us',
      localName: 'latencyUs',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 4,
      name: 'established',
      localName: 'established',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.BOOL,
    },
  ],
};

export const PeerUpdateProtobufDesc: ProtobufDescMessage = {
  typeName: 'omnibuf.bench.PeerUpdate',
  fields: [
    {
      number: 1,
      name: 'asn',
      localName: 'asn',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 2,
      name: 'router_id',
      localName: 'routerId',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 3,
      name: 'active',
      localName: 'active',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.BOOL,
    },
    {
      number: 4,
      name: 'uptime_sec',
      localName: 'uptimeSec',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT64,
    },
    {
      number: 5,
      name: 'rssi_dbm',
      localName: 'rssiDbm',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.SINT32,
    },
    {
      number: 6,
      name: 'cpu_load',
      localName: 'cpuLoad',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.DOUBLE,
    },
    {
      number: 7,
      name: 'tags',
      localName: 'tags',
      fieldKind: 'list',
      listKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 8,
      name: 'prefixes',
      localName: 'prefixes',
      fieldKind: 'list',
      listKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 9,
      name: 'location',
      localName: 'location',
      fieldKind: 'message',
      message: LocationProtobufDesc,
    },
    {
      number: 10,
      name: 'neighbors',
      localName: 'neighbors',
      fieldKind: 'list',
      listKind: 'message',
      message: NeighborProtobufDesc,
    },
    {
      number: 11,
      name: 'sequence',
      localName: 'sequence',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT64,
    },
  ],
};

export const AllTypesSubMsgProtobufDesc: ProtobufDescMessage = {
  typeName: 'omnibuf.conformance.AllTypesSubMsg',
  fields: [
    {
      number: 1,
      name: 'id',
      localName: 'id',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 2,
      name: 'label',
      localName: 'label',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 3,
      name: 'flag',
      localName: 'flag',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.BOOL,
    },
    {
      number: 4,
      name: 'score',
      localName: 'score',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.SINT64,
    },
  ],
};

export const TestAllTypesProtobufDesc: ProtobufDescMessage = {
  typeName: 'omnibuf.conformance.TestAllTypes',
  fields: [
    {
      number: 1,
      name: 'f1_uint32',
      localName: 'f1Uint32',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 2,
      name: 'f2_uint64',
      localName: 'f2Uint64',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.UINT64,
    },
    {
      number: 3,
      name: 'f3_sint32',
      localName: 'f3Sint32',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.SINT32,
    },
    {
      number: 4,
      name: 'f4_sint64',
      localName: 'f4Sint64',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.SINT64,
    },
    {
      number: 5,
      name: 'f5_bool',
      localName: 'f5Bool',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.BOOL,
    },
    {
      number: 6,
      name: 'f6_string',
      localName: 'f6String',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 7,
      name: 'f7_bytes',
      localName: 'f7Bytes',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.BYTES,
    },
    {
      number: 8,
      name: 'f8_sub_msg',
      localName: 'f8SubMsg',
      fieldKind: 'message',
      message: AllTypesSubMsgProtobufDesc,
    },
    {
      number: 9,
      name: 'f9_string_arr',
      localName: 'f9StringArr',
      fieldKind: 'list',
      listKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
    {
      number: 10,
      name: 'f10_uint32_arr',
      localName: 'f10Uint32Arr',
      fieldKind: 'list',
      listKind: 'scalar',
      scalar: ProtoScalarType.UINT32,
    },
    {
      number: 11,
      name: 'f11_sub_msg_arr',
      localName: 'f11SubMsgArr',
      fieldKind: 'list',
      listKind: 'message',
      message: AllTypesSubMsgProtobufDesc,
    },
    {
      number: 12,
      name: 'f12_map_str_uint',
      localName: 'f12MapStrUint',
      fieldKind: 'map',
      mapKey: ProtoScalarType.STRING,
      mapKind: 'scalar',
      scalar: ProtoScalarType.UINT64,
    },
    {
      number: 13,
      name: 'f13_float32',
      localName: 'f13Float32',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.FLOAT,
    },
    {
      number: 14,
      name: 'f14_float64',
      localName: 'f14Float64',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.DOUBLE,
    },
    {
      number: 15,
      name: 'f15_fixed32',
      localName: 'f15Fixed32',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.FIXED32,
    },
    {
      number: 16,
      name: 'f16_fixed64',
      localName: 'f16Fixed64',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.FIXED64,
    },
    {
      number: 20,
      name: 'f20_overflow_str',
      localName: 'f20OverflowStr',
      fieldKind: 'scalar',
      scalar: ProtoScalarType.STRING,
    },
  ],
};

function makeEditionsProtobufDesc(
  year: '2023' | '2024' | '2026',
  edition: number,
): ProtobufDescMessage {
  const file = {
    name: `omnibuf/conformance/editions_${year}`,
    edition,
    proto: {
      name: `omnibuf/conformance/editions_${year}.proto`,
      syntax: 'editions',
      edition,
    },
  };
  const statusEnum = {
    name: `Editions${year}Status`,
    typeName: `omnibuf.conformance.Editions${year}Status`,
    open: true,
    values: [
      { name: `EDITIONS${year}_STATUS_UNSPECIFIED`, number: 0 },
      { name: `EDITIONS${year}_STATUS_ACTIVE`, number: 1 },
      { name: `EDITIONS${year}_STATUS_PAUSED`, number: 2 },
    ],
  };
  const childDesc: ProtobufDescMessage = {
    typeName: `omnibuf.conformance.Editions${year}Child`,
    file,
    fields: [
      {
        number: 1,
        name: 'id',
        localName: 'id',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 2,
        name: 'note',
        localName: 'note',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.STRING,
        presence: 1,
        utf8Validation: true,
      },
    ],
  };
  const choiceOneof = { name: 'choice', localName: 'choice' };
  return {
    typeName: `omnibuf.conformance.TestEditions${year}`,
    file,
    fields: [
      {
        number: 1,
        name: 'explicit_int',
        localName: 'explicitInt',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 2,
        name: 'explicit_bool',
        localName: 'explicitBool',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.BOOL,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 3,
        name: 'explicit_string',
        localName: 'explicitString',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.STRING,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 4,
        name: 'explicit_bytes',
        localName: 'explicitBytes',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.BYTES,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 5,
        name: 'explicit_double',
        localName: 'explicitDouble',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.DOUBLE,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 6,
        name: 'status',
        localName: 'status',
        fieldKind: 'enum',
        enum: statusEnum,
        presence: 1,
        utf8Validation: true,
      },
      {
        number: 7,
        name: 'implicit_count',
        localName: 'implicitCount',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 2,
        utf8Validation: true,
      },
      {
        number: 8,
        name: 'implicit_flag',
        localName: 'implicitFlag',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.BOOL,
        presence: 2,
        utf8Validation: true,
      },
      {
        number: 9,
        name: 'child',
        localName: 'child',
        fieldKind: 'message',
        message: childDesc,
        presence: 1,
        delimitedEncoding: false,
        utf8Validation: true,
      },
      {
        number: 10,
        name: 'delimited_child',
        localName: 'delimitedChild',
        fieldKind: 'message',
        message: childDesc,
        presence: 1,
        delimitedEncoding: true,
        utf8Validation: true,
      },
      {
        number: 11,
        name: 'packed_vals',
        localName: 'packedVals',
        fieldKind: 'list',
        listKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 2,
        utf8Validation: true,
      },
      {
        number: 12,
        name: 'expanded_vals',
        localName: 'expandedVals',
        fieldKind: 'list',
        listKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 2,
        utf8Validation: true,
      },
      {
        number: 13,
        name: 'scores',
        localName: 'scores',
        fieldKind: 'map',
        mapKey: ProtoScalarType.STRING,
        mapKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 2,
        utf8Validation: true,
      },
      {
        number: 14,
        name: 'choice_int',
        localName: 'choiceInt',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.INT32,
        presence: 1,
        oneof: choiceOneof,
        utf8Validation: true,
      },
      {
        number: 15,
        name: 'choice_text',
        localName: 'choiceText',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.STRING,
        presence: 1,
        oneof: choiceOneof,
        utf8Validation: true,
      },
      {
        number: 16,
        name: 'choice_flag',
        localName: 'choiceFlag',
        fieldKind: 'scalar',
        scalar: ProtoScalarType.BOOL,
        presence: 1,
        oneof: choiceOneof,
        utf8Validation: true,
      },
      {
        number: 17,
        name: 'choice_child',
        localName: 'choiceChild',
        fieldKind: 'message',
        message: childDesc,
        presence: 1,
        oneof: choiceOneof,
        utf8Validation: true,
      },
    ],
  };
}

export const TestEditions2023ProtobufDesc: ProtobufDescMessage = makeEditionsProtobufDesc(
  '2023',
  1000,
);
export const TestEditions2024ProtobufDesc: ProtobufDescMessage = makeEditionsProtobufDesc(
  '2024',
  1001,
);
export const TestEditions2026ProtobufDesc: ProtobufDescMessage = makeEditionsProtobufDesc(
  '2026',
  1002,
);

const defaultRegistry = new DescriptorRegistry(CONFORMANCE_FDS);

interface EditionsChildLike {
  id?: number | undefined;
  note?: string | undefined;
}

interface EditionsMessageLike {
  explicitInt?: number | undefined;
  explicitBool?: boolean | undefined;
  explicitString?: string | undefined;
  explicitBytes?: Uint8Array | undefined;
  explicitDouble?: number | undefined;
  status?: number | undefined;
  implicitCount: number;
  implicitFlag: boolean;
  child: EditionsChildLike | null;
  delimitedChild: EditionsChildLike | null;
  packedVals: number[];
  expandedVals: number[];
  scores: Record<string, number>;
  choice: { case: string | undefined; value?: unknown };
  choiceInt?: number | undefined;
  choiceText?: string | undefined;
  choiceFlag?: boolean | undefined;
  choiceChild?: EditionsChildLike | null | undefined;
}

interface EditionsOpaqueLike {
  hasExplicitInt(): boolean;
  getExplicitInt(): number | undefined;
  hasExplicitBool(): boolean;
  getExplicitBool(): boolean | undefined;
  hasExplicitString(): boolean;
  getExplicitString(): string | undefined;
  hasExplicitBytes(): boolean;
  getExplicitBytes(): Uint8Array | undefined;
  hasExplicitDouble(): boolean;
  getExplicitDouble(): number | undefined;
  hasStatus(): boolean;
  getStatus(): number | undefined;
  getImplicitCount(): number;
  getImplicitFlag(): boolean;
  hasChild(): boolean;
  getChild(): EditionsChildLike | null;
  hasDelimitedChild(): boolean;
  getDelimitedChild(): EditionsChildLike | null;
  getPackedVals(): number[];
  getExpandedVals(): number[];
  getScores(): Record<string, number>;
  hasChoiceInt(): boolean;
  getChoiceInt(): number | undefined;
  hasChoiceText(): boolean;
  getChoiceText(): string | undefined;
  hasChoiceFlag(): boolean;
  getChoiceFlag(): boolean | undefined;
  hasChoiceChild(): boolean;
  getChoiceChild(): EditionsChildLike | null | undefined;
}

function editionsChildrenEqual(
  a: EditionsChildLike | null | undefined,
  b: EditionsChildLike | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.id === b.id && a.note === b.note;
}

function numberArraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function numberMapsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.hasOwn(b, k) || a[k] !== b[k]) return false;
  }
  return true;
}

function checkEditionsOpaqueParity(op: EditionsOpaqueLike, msg: EditionsMessageLike): boolean {
  const opBytes = op.getExplicitBytes();
  const bytesMatch =
    opBytes === undefined && msg.explicitBytes === undefined
      ? true
      : opBytes !== undefined &&
        msg.explicitBytes !== undefined &&
        bytesEqual(opBytes, msg.explicitBytes);
  return (
    op.hasExplicitInt() === (msg.explicitInt !== undefined) &&
    op.getExplicitInt() === msg.explicitInt &&
    op.hasExplicitBool() === (msg.explicitBool !== undefined) &&
    op.getExplicitBool() === msg.explicitBool &&
    op.hasExplicitString() === (msg.explicitString !== undefined) &&
    op.getExplicitString() === msg.explicitString &&
    op.hasExplicitBytes() === (msg.explicitBytes !== undefined) &&
    bytesMatch &&
    op.hasExplicitDouble() === (msg.explicitDouble !== undefined) &&
    Object.is(op.getExplicitDouble(), msg.explicitDouble) &&
    op.hasStatus() === (msg.status !== undefined) &&
    op.getStatus() === msg.status &&
    op.getImplicitCount() === msg.implicitCount &&
    op.getImplicitFlag() === msg.implicitFlag &&
    op.hasChild() === (msg.child !== null) &&
    editionsChildrenEqual(op.getChild(), msg.child) &&
    op.hasDelimitedChild() === (msg.delimitedChild !== null) &&
    editionsChildrenEqual(op.getDelimitedChild(), msg.delimitedChild) &&
    numberArraysEqual(op.getPackedVals(), msg.packedVals) &&
    numberArraysEqual(op.getExpandedVals(), msg.expandedVals) &&
    numberMapsEqual(op.getScores(), msg.scores) &&
    op.hasChoiceInt() === (msg.choice.case === 'choiceInt') &&
    op.getChoiceInt() === msg.choiceInt &&
    op.hasChoiceText() === (msg.choice.case === 'choiceText') &&
    op.getChoiceText() === msg.choiceText &&
    op.hasChoiceFlag() === (msg.choice.case === 'choiceFlag') &&
    op.getChoiceFlag() === msg.choiceFlag &&
    op.hasChoiceChild() === (msg.choice.case === 'choiceChild') &&
    editionsChildrenEqual(op.getChoiceChild(), msg.choiceChild)
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Exercise the append-oriented runtime directly: generated opaque marshal
// methods allocate a fresh buffer and cannot test preservation of a nonempty prefix.
function checkSpliceAliasedPrefix(packet: Uint8Array): void {
  const appendDirty = (enc: Encoder, fnum: number): void => {
    enc.writeUint(fnum, 1n << 40n);
  };
  const spliced = spliceFields(packet, 1 << 1, 2, appendDirty);
  for (const prefixLen of [0, 3, 32]) {
    const prefix = new Uint8Array(prefixLen).fill(0xa5);
    const storage = new Uint8Array(prefixLen + packet.byteLength + 512);
    storage.set(prefix, 0);
    storage.set(packet, prefixLen);
    const want = new Uint8Array(prefixLen + spliced.byteLength);
    want.set(prefix, 0);
    want.set(spliced, prefixLen);
    const enc = new Encoder(storage, prefixLen);
    const rawSlice = storage.subarray(prefixLen, prefixLen + packet.byteLength);
    const got = spliceFields(rawSlice, 1 << 1, 2, appendDirty, enc);
    if (!bytesEqual(got, want)) {
      throw new Error(
        `opaque splice with ${prefixLen}-byte aliased prefix changed prefix or output`,
      );
    }
    if (!bytesEqual(rawSlice, packet)) {
      throw new Error(`opaque splice with ${prefixLen}-byte aliased prefix modified source packet`);
    }
  }
}

/**
 * Execute a single `ConformanceRequest` and return a `ConformanceResponse`.
 * Matches `cmd/conformance-go/main.go` across all 4 tiers (`TestTierBlind`, `TestTierPlugin`, `TestTierProtobufTypes`, `TestTierAnnotatedStruct`).
 */
export function handleConformanceRequest(
  req: Partial<ConformanceRequest>,
  _registry: DescriptorRegistry = defaultRegistry,
): ConformanceResponse {
  const resp = ConformanceResponseSchema.create();
  try {
    const payload = req.omnibuf_payload ?? new Uint8Array(0);
    const tier = req.tier ?? TestTierUnspecified;

    switch (tier) {
      case TestTierBlind: {
        try {
          decodeBlind(payload);
        } catch (err) {
          resp.parse_error = err instanceof Error ? err.message : String(err);
          return resp;
        }
        if (req.requested_output_format === WireFormatJSON) {
          resp.json_payload = decodeBlindJSON(payload, { fallbackOnNonFinite: true });
        }
        return resp;
      }

      case TestTierPlugin: {
        switch (req.message_type) {
          case 'omnibuf.bench.PeerUpdate': {
            if (req.test_opaque_splice || req.test_opaque_splice_shrink) {
              try {
                const probe = new OpaquePeerUpdate(payload);
                probe.setSequence(1);
                probe.marshal();
              } catch (err) {
                resp.parse_error = err instanceof Error ? err.message : String(err);
                return resp;
              }
            }
            const msg = createPeerUpdate({
              asn: 999999,
              routerId: 'stale-router',
              active: true,
              tags: ['stale-tag'],
              prefixes: [999],
              location: createLocation({ region: 'stale', city: 'stale-city', rack: 999 }),
              neighbors: [createNeighbor({ peerAsn: 999, router: 'stale-neighbor' })],
              sequence: 999999,
            });
            try {
              decodePeerUpdate(payload, msg);
            } catch (err) {
              resp.parse_error = err instanceof Error ? err.message : String(err);
              return resp;
            }
            if (req.test_opaque_splice || req.test_opaque_splice_shrink) {
              try {
                checkSpliceAliasedPrefix(payload);
              } catch (err) {
                resp.runtime_error = err instanceof Error ? err.message : String(err);
                return resp;
              }
            }
            const op = new OpaquePeerUpdate(payload);
            const opLoc = op.getLocation();
            if (
              op.getAsn() !== msg.asn ||
              op.getRouterId() !== msg.routerId ||
              op.getActive() !== msg.active ||
              BigInt(op.getUptimeSec()) !== BigInt(msg.uptimeSec) ||
              op.getRssiDbm() !== msg.rssiDbm ||
              !Object.is(op.getCpuLoad(), msg.cpuLoad) ||
              op.getTags().length !== msg.tags.length ||
              op.getPrefixes().length !== msg.prefixes.length ||
              (opLoc?.city ?? '') !== (msg.location?.city ?? '') ||
              op.getNeighbors().length !== msg.neighbors.length ||
              BigInt(op.getSequence()) !== BigInt(msg.sequence)
            ) {
              resp.parse_error = 'opaque PeerUpdate getter mismatch with decoded struct';
              return resp;
            }

            if (req.test_opaque_splice) {
              try {
                op.setAsn(1_000_000);
                op.setRouterId('edge-rtr-fra01-'.repeat(20));
                op.setActive(!op.getActive());
                op.setUptimeSec(0xffffffffffffffffn);
                op.setRssiDbm(-1_000_000);
                op.setCpuLoad(99.875);
                op.setTags(['tag-grow-a', 'tag-grow-b', 'long-tag-'.repeat(20)]);
                op.setPrefixes([100000, 200000, 300000, 400000, 500000, 600000]);
                op.setLocation({
                  $typeName: 'omnibuf.bench.Location',
                  region: 'eu-central-grown',
                  datacenter: 'fra-dc-'.repeat(25),
                  city: 'Berlin',
                  rack: 999999,
                  latitude: 52.52,
                  longitude: 13.405,
                });
                const curSeq = op.getSequence();
                const nextSeq = BigInt.asUintN(
                  64,
                  (typeof curSeq === 'bigint' ? curSeq : BigInt(curSeq)) + 1n,
                );
                op.setSequence(nextSeq <= 9007199254740991n ? Number(nextSeq) : nextSeq);
                resp.omnibuf_payload = op.marshal();
              } catch (err) {
                resp.serialize_error = err instanceof Error ? err.message : String(err);
              }
              return resp;
            }

            if (req.test_opaque_splice_shrink) {
              try {
                op.setAsn(1);
                op.setRouterId('r');
                op.setActive(false);
                op.setUptimeSec(5);
                op.setRssiDbm(-1);
                op.setCpuLoad(0.5);
                op.setTags(['t']);
                op.setPrefixes([1]);
                op.setLocation({
                  $typeName: 'omnibuf.bench.Location',
                  region: 'r',
                  datacenter: 'd',
                  city: 'c',
                  rack: 1,
                  latitude: 1.0,
                  longitude: 2.0,
                });
                op.setSequence(2);
                resp.omnibuf_payload = op.marshal();
              } catch (err) {
                resp.serialize_error = err instanceof Error ? err.message : String(err);
              }
              return resp;
            }

            try {
              resp.omnibuf_payload = marshalPeerUpdateOmniBuf(msg, {
                deterministic: true,
                selfDescribing: Boolean(req.self_describing),
              });
            } catch (err) {
              resp.serialize_error = err instanceof Error ? err.message : String(err);
            }
            return resp;
          }

          case 'omnibuf.conformance.TestAllTypes': {
            if (req.test_opaque_splice || req.test_opaque_splice_shrink) {
              try {
                const probe = new OpaqueTestAllTypes(payload);
                probe.setF1Uint32(1);
                probe.marshal();
              } catch (err) {
                resp.parse_error = err instanceof Error ? err.message : String(err);
                return resp;
              }
            }
            const msg = createTestAllTypes({
              f1Uint32: 999999,
              f5Bool: true,
              f6String: 'stale-str',
              f7Bytes: new Uint8Array([0xff]),
              f8SubMsg: createAllTypesSubMsg({
                id: 999,
                label: 'stale-sub',
                flag: true,
                score: -999,
              }),
              f9StringArr: ['stale'],
              f10Uint32Arr: [999],
              f11SubMsgArr: [createAllTypesSubMsg({ id: 999, label: 'stale-elem' })],
              f12MapStrUint: { stale: 999 },
              f20OverflowStr: 'stale-overflow',
            });
            try {
              decodeTestAllTypes(payload, msg);
            } catch (err) {
              resp.parse_error = err instanceof Error ? err.message : String(err);
              return resp;
            }
            if (req.test_opaque_splice || req.test_opaque_splice_shrink) {
              try {
                checkSpliceAliasedPrefix(payload);
              } catch (err) {
                resp.runtime_error = err instanceof Error ? err.message : String(err);
                return resp;
              }
            }
            const op = new OpaqueTestAllTypes(payload);
            void op.getF12MapStrUint();
            const opSub = op.getF8SubMsg();
            const wantSub = msg.f8SubMsg;
            const opBytes = op.getF7Bytes();
            let bytesMatch = opBytes.length === msg.f7Bytes.length;
            if (bytesMatch) {
              for (let i = 0; i < opBytes.length; i++) {
                if (opBytes[i] !== msg.f7Bytes[i]) {
                  bytesMatch = false;
                  break;
                }
              }
            }
            if (
              op.getF1Uint32() !== msg.f1Uint32 ||
              BigInt(op.getF2Uint64()) !== BigInt(msg.f2Uint64) ||
              op.getF3Sint32() !== msg.f3Sint32 ||
              BigInt(op.getF4Sint64()) !== BigInt(msg.f4Sint64) ||
              op.getF5Bool() !== msg.f5Bool ||
              op.getF6String() !== msg.f6String ||
              !bytesMatch ||
              (opSub?.id ?? 0) !== (wantSub?.id ?? 0) ||
              (opSub?.label ?? '') !== (wantSub?.label ?? '') ||
              (opSub?.flag ?? false) !== (wantSub?.flag ?? false) ||
              BigInt(opSub?.score ?? 0) !== BigInt(wantSub?.score ?? 0) ||
              op.getF9StringArr().length !== msg.f9StringArr.length ||
              op.getF10Uint32Arr().length !== msg.f10Uint32Arr.length ||
              op.getF11SubMsgArr().length !== msg.f11SubMsgArr.length ||
              !Object.is(op.getF13Float32(), msg.f13Float32) ||
              !Object.is(op.getF14Float64(), msg.f14Float64) ||
              op.getF15Fixed32() !== msg.f15Fixed32 ||
              BigInt(op.getF16Fixed64()) !== BigInt(msg.f16Fixed64) ||
              op.getF20OverflowStr() !== msg.f20OverflowStr
            ) {
              resp.parse_error = 'opaque TestAllTypes getter mismatch with decoded struct';
              return resp;
            }

            if (req.test_opaque_splice) {
              try {
                op.setF1Uint32(1_000_000);
                op.setF2Uint64(0xffffffffffffffffn);
                op.setF3Sint32(-1_000_000);
                op.setF4Sint64(-9223372036854775808n);
                op.setF5Bool(!op.getF5Bool());
                op.setF6String('grown-str-'.repeat(30));
                const f7 = new Uint8Array(260);
                for (let i = 0; i < 260; i += 2) {
                  f7[i] = 0xab;
                  f7[i + 1] = 0xcd;
                }
                op.setF7Bytes(f7);
                op.setF8SubMsg({
                  $typeName: 'omnibuf.conformance.AllTypesSubMsg',
                  id: 888888,
                  label: 'sub-grown-'.repeat(20),
                  flag: true,
                  score: -999999999,
                });
                op.setF9StringArr(['arr-grow-1', 'arr-grow-2', 'arr-grow-3-'.repeat(15)]);
                op.setF10Uint32Arr([100000, 200000, 300000, 400000, 500000]);
                op.setF11SubMsgArr([
                  {
                    $typeName: 'omnibuf.conformance.AllTypesSubMsg',
                    id: 100001,
                    label: 'elem0-'.repeat(25),
                    flag: true,
                    score: -500000,
                  },
                  {
                    $typeName: 'omnibuf.conformance.AllTypesSubMsg',
                    id: 100002,
                    label: 'elem1-grown',
                    flag: false,
                    score: 500000,
                  },
                ]);
                op.setF12MapStrUint({
                  k1: 1000000,
                  k2: 0xffffffffffffffffn,
                  k3_long_key: 424242,
                });
                op.setF13Float32(-1234.5);
                op.setF14Float64(3.141592653589793);
                op.setF15Fixed32(0xdeadbeef);
                op.setF16Fixed64(0xcafebabedeadbeefn);
                op.setF20OverflowStr('overflow20-'.repeat(20));
                resp.omnibuf_payload = op.marshal();
              } catch (err) {
                resp.serialize_error = err instanceof Error ? err.message : String(err);
              }
              return resp;
            }

            if (req.test_opaque_splice_shrink) {
              try {
                op.setF1Uint32(1);
                op.setF2Uint64(2);
                op.setF3Sint32(-1);
                op.setF4Sint64(-2);
                op.setF5Bool(false);
                op.setF6String('s');
                op.setF7Bytes(new Uint8Array([0x01]));
                op.setF8SubMsg({
                  $typeName: 'omnibuf.conformance.AllTypesSubMsg',
                  id: 1,
                  label: 'x',
                  flag: false,
                  score: -1,
                });
                op.setF9StringArr(['a']);
                op.setF10Uint32Arr([7]);
                op.setF11SubMsgArr([
                  {
                    $typeName: 'omnibuf.conformance.AllTypesSubMsg',
                    id: 1,
                    label: 'e',
                    flag: true,
                    score: 1,
                  },
                ]);
                op.setF12MapStrUint({ k: 1 });
                op.setF13Float32(0.5);
                op.setF14Float64(-0.25);
                op.setF15Fixed32(7);
                op.setF16Fixed64(9);
                op.setF20OverflowStr('z');
                resp.omnibuf_payload = op.marshal();
              } catch (err) {
                resp.serialize_error = err instanceof Error ? err.message : String(err);
              }
              return resp;
            }

            try {
              resp.omnibuf_payload = marshalTestAllTypesOmniBuf(msg, {
                deterministic: true,
                selfDescribing: Boolean(req.self_describing),
              });
            } catch (err) {
              resp.serialize_error = err instanceof Error ? err.message : String(err);
            }
            return resp;
          }

          case 'omnibuf.conformance.TestEditions2023': {
            const msg = createTestEditions2023({
              explicitInt: 999,
              explicitBool: true,
              explicitString: 'stale',
              explicitBytes: new Uint8Array([0xff]),
              explicitDouble: 99.5,
              status: Editions2023Status.EDITIONS2023_STATUS_PAUSED,
              implicitCount: 999,
              implicitFlag: true,
              child: createEditions2023Child({ id: 999, note: 'stale' }),
              delimitedChild: createEditions2023Child({ id: 999, note: 'stale' }),
              packedVals: [999],
              expandedVals: [999],
              scores: { stale: 999 },
              choice: { case: 'choiceText', value: 'stale' },
            });
            try {
              decodeTestEditions2023(payload, msg);
            } catch (err) {
              resp.parse_error = err instanceof Error ? err.message : String(err);
              return resp;
            }
            const op = new OpaqueTestEditions2023(payload);
            if (!checkEditionsOpaqueParity(op, msg)) {
              resp.parse_error = 'opaque TestEditions2023 getter mismatch with decoded struct';
              return resp;
            }
            try {
              resp.omnibuf_payload = marshalTestEditions2023OmniBuf(msg, {
                deterministic: true,
                selfDescribing: Boolean(req.self_describing),
              });
            } catch (err) {
              resp.serialize_error = err instanceof Error ? err.message : String(err);
            }
            return resp;
          }

          case 'omnibuf.conformance.TestEditions2024': {
            const msg = createTestEditions2024({
              explicitInt: 999,
              explicitBool: true,
              explicitString: 'stale',
              explicitBytes: new Uint8Array([0xff]),
              explicitDouble: 99.5,
              status: Editions2024Status.EDITIONS2024_STATUS_PAUSED,
              implicitCount: 999,
              implicitFlag: true,
              child: createEditions2024Child({ id: 999, note: 'stale' }),
              delimitedChild: createEditions2024Child({ id: 999, note: 'stale' }),
              packedVals: [999],
              expandedVals: [999],
              scores: { stale: 999 },
              choice: { case: 'choiceText', value: 'stale' },
            });
            try {
              decodeTestEditions2024(payload, msg);
            } catch (err) {
              resp.parse_error = err instanceof Error ? err.message : String(err);
              return resp;
            }
            const op = new OpaqueTestEditions2024(payload);
            if (!checkEditionsOpaqueParity(op, msg)) {
              resp.parse_error = 'opaque TestEditions2024 getter mismatch with decoded struct';
              return resp;
            }
            try {
              resp.omnibuf_payload = marshalTestEditions2024OmniBuf(msg, {
                deterministic: true,
                selfDescribing: Boolean(req.self_describing),
              });
            } catch (err) {
              resp.serialize_error = err instanceof Error ? err.message : String(err);
            }
            return resp;
          }

          case 'omnibuf.conformance.TestEditions2026': {
            const msg = createTestEditions2026({
              explicitInt: 999,
              explicitBool: true,
              explicitString: 'stale',
              explicitBytes: new Uint8Array([0xff]),
              explicitDouble: 99.5,
              status: Editions2026Status.EDITIONS2026_STATUS_PAUSED,
              implicitCount: 999,
              implicitFlag: true,
              child: createEditions2026Child({ id: 999, note: 'stale' }),
              delimitedChild: createEditions2026Child({ id: 999, note: 'stale' }),
              packedVals: [999],
              expandedVals: [999],
              scores: { stale: 999 },
              choice: { case: 'choiceText', value: 'stale' },
            });
            try {
              decodeTestEditions2026(payload, msg);
            } catch (err) {
              resp.parse_error = err instanceof Error ? err.message : String(err);
              return resp;
            }
            const op = new OpaqueTestEditions2026(payload);
            if (!checkEditionsOpaqueParity(op, msg)) {
              resp.parse_error = 'opaque TestEditions2026 getter mismatch with decoded struct';
              return resp;
            }
            try {
              resp.omnibuf_payload = marshalTestEditions2026OmniBuf(msg, {
                deterministic: true,
                selfDescribing: Boolean(req.self_describing),
              });
            } catch (err) {
              resp.serialize_error = err instanceof Error ? err.message : String(err);
            }
            return resp;
          }

          default:
            resp.skipped =
              'plugin tier generated for PeerUpdate, TestAllTypes, and Editions 2023/2024/2026';
            return resp;
        }
      }

      case TestTierProtobufTypes: {
        const desc =
          req.message_type === 'omnibuf.bench.PeerUpdate'
            ? PeerUpdateProtobufDesc
            : req.message_type === 'omnibuf.conformance.TestAllTypes'
              ? TestAllTypesProtobufDesc
              : req.message_type === 'omnibuf.conformance.TestEditions2023'
                ? TestEditions2023ProtobufDesc
                : req.message_type === 'omnibuf.conformance.TestEditions2024'
                  ? TestEditions2024ProtobufDesc
                  : req.message_type === 'omnibuf.conformance.TestEditions2026'
                    ? TestEditions2026ProtobufDesc
                    : null;
        if (!desc) {
          resp.skipped =
            'protobuf types tier exercises PeerUpdate, TestAllTypes, and Editions 2023/2024/2026';
          return resp;
        }
        let msg;
        try {
          msg = fromBinary(desc, payload);
        } catch (err) {
          resp.parse_error = err instanceof Error ? err.message : String(err);
          return resp;
        }
        try {
          resp.omnibuf_payload = toBinary(desc, msg, {
            deterministic: true,
            selfDescribing: Boolean(req.self_describing),
          });
        } catch (err) {
          resp.serialize_error = err instanceof Error ? err.message : String(err);
        }
        return resp;
      }

      case TestTierAnnotatedStruct: {
        const opts = {
          deterministic: true,
          selfDescribing: Boolean(req.self_describing),
        };
        const roundtrip = <T extends object>(schema: MessageSchema<T>): ConformanceResponse => {
          let msg: T;
          try {
            msg = schema.decode(payload);
          } catch (err) {
            resp.parse_error = err instanceof Error ? err.message : String(err);
            return resp;
          }
          try {
            resp.omnibuf_payload = schema.encode(msg, opts);
          } catch (err) {
            resp.serialize_error = err instanceof Error ? err.message : String(err);
          }
          return resp;
        };
        switch (req.message_type) {
          case 'omnibuf.bench.PeerUpdate':
            return roundtrip(PeerUpdateSchema);
          case 'omnibuf.conformance.TreeNode':
            return roundtrip(TreeNodeSchema);
          case 'omnibuf.conformance.NestedCluster':
            return roundtrip(NestedClusterSchema);
          default:
            return roundtrip(TestAllTypesSchema);
        }
      }

      default:
        resp.runtime_error = `unsupported tier: ${tier}`;
        return resp;
    }
  } catch (err) {
    resp.runtime_error = err instanceof Error ? err.message : String(err);
    return resp;
  }
}
