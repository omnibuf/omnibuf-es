import type { MethodDefinition } from '@grpc/grpc-js';
import {
  fromBinary,
  toBinary,
  type BinaryReadOptions,
  type BinaryWriteOptions,
  type SchemaInput,
} from '@omnibuf/core';

/** Wire codec subtype for compact OmniBuf gRPC payloads. */
export const CODEC_NAME = 'omnibuf';

/** Wire codec subtype for self-describing OmniBuf gRPC payloads carrying Field #0 inline. */
export const SELF_DESCRIBING_CODEC_NAME = 'x-omnibuf';

/** gRPC Content-Type header value for compact OmniBuf payloads. */
export const CONTENT_TYPE_GRPC = 'application/grpc+omnibuf';

/**
 * Options configuring OmniBuf serialization and deserialization for `@grpc/grpc-js`.
 */
export interface GrpcCodecOptions {
  /** Emit Field #0 (SchemaMeta) inline in serialized payloads. */
  selfDescribing?: boolean;
  /** Sort map keys deterministically during serialization. */
  deterministic?: boolean;
  /** Additional binary write options forwarded to `toBinary`. */
  writeOptions?: BinaryWriteOptions;
  /** Additional binary read options forwarded to `fromBinary`. */
  readOptions?: BinaryReadOptions;
}

/**
 * Pair of distinct request and response schemas for a gRPC method.
 */
export interface GrpcSchemaPair<Req extends object, Res extends object> {
  readonly request: SchemaInput<Req>;
  readonly response: SchemaInput<Res>;
}

/**
 * `@grpc/grpc-js` serialize/deserialize callbacks backed by OmniBuf.
 */
export interface GrpcMarshallers<Req extends object, Res extends object = Req> {
  requestSerialize(value: Req): Buffer;
  requestDeserialize(bytes: Buffer): Req;
  responseSerialize(value: Res): Buffer;
  responseDeserialize(bytes: Buffer): Res;
}

/**
 * Options for `createGrpcMethodDefinition`.
 */
export interface GrpcMethodOptions extends GrpcCodecOptions {
  requestStream?: boolean;
  responseStream?: boolean;
  originalName?: string;
}

function buildWriteOptions(opts?: GrpcCodecOptions): BinaryWriteOptions | undefined {
  if (!opts) {
    return undefined;
  }
  const hasFlag = opts.selfDescribing !== undefined || opts.deterministic !== undefined;
  if (!hasFlag && !opts.writeOptions) {
    return undefined;
  }
  return {
    ...opts.writeOptions,
    ...(opts.selfDescribing !== undefined ? { selfDescribing: opts.selfDescribing } : {}),
    ...(opts.deterministic !== undefined ? { deterministic: opts.deterministic } : {}),
  };
}

function isSchemaPair<Req extends object, Res extends object>(
  input: SchemaInput<Req> | GrpcSchemaPair<Req, Res>,
): input is GrpcSchemaPair<Req, Res> {
  return (
    typeof input === 'object' &&
    input !== null &&
    'request' in input &&
    'response' in input &&
    !('encode' in input) &&
    !('fields' in input)
  );
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Creates `@grpc/grpc-js` method marshallers (`requestSerialize`, `requestDeserialize`,
 * `responseSerialize`, `responseDeserialize`) backed by OmniBuf.
 */
export function createGrpcMarshallers<T extends object>(
  schema: SchemaInput<T>,
  opts?: GrpcCodecOptions,
): GrpcMarshallers<T, T>;
export function createGrpcMarshallers<Req extends object, Res extends object>(
  schemas: GrpcSchemaPair<Req, Res>,
  opts?: GrpcCodecOptions,
): GrpcMarshallers<Req, Res>;
export function createGrpcMarshallers<Req extends object, Res extends object = Req>(
  schemaOrPair: SchemaInput<Req> | GrpcSchemaPair<Req, Res>,
  opts?: GrpcCodecOptions,
): GrpcMarshallers<Req, Res> {
  const writeOptions = buildWriteOptions(opts);
  const readOptions = opts?.readOptions;

  const reqSchema: SchemaInput<Req> = isSchemaPair(schemaOrPair)
    ? schemaOrPair.request
    : schemaOrPair;
  const resSchema: SchemaInput<Res> = isSchemaPair(schemaOrPair)
    ? schemaOrPair.response
    : (schemaOrPair as unknown as SchemaInput<Res>);

  return {
    requestSerialize(value: Req): Buffer {
      return toBuffer(toBinary(reqSchema, value, writeOptions));
    },
    requestDeserialize(bytes: Buffer): Req {
      return fromBinary(reqSchema, bytes, readOptions);
    },
    responseSerialize(value: Res): Buffer {
      return toBuffer(toBinary(resSchema, value, writeOptions));
    },
    responseDeserialize(bytes: Buffer): Res {
      return fromBinary(resSchema, bytes, readOptions);
    },
  };
}

/**
 * Creates a full `@grpc/grpc-js` `MethodDefinition` wired with OmniBuf marshallers.
 */
export function createGrpcMethodDefinition<Req extends object, Res extends object>(
  path: string,
  schemas: GrpcSchemaPair<Req, Res>,
  opts?: GrpcMethodOptions,
): MethodDefinition<Req, Res> {
  const marshallers = createGrpcMarshallers(schemas, opts);
  return {
    path,
    requestStream: opts?.requestStream ?? false,
    responseStream: opts?.responseStream ?? false,
    ...marshallers,
    ...(opts?.originalName !== undefined ? { originalName: opts.originalName } : {}),
  };
}
