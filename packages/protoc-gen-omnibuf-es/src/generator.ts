import {
  ProtoScalarType,
  parseFieldDescriptorType,
  protoCamelCase,
  safeObjectProperty,
  type DescriptorProtoJSON,
  type EnumDescriptorProtoJSON,
  type FileDescriptorProtoJSON,
  type FileDescriptorSetJSON,
} from '@omnibuf/core';

export interface GeneratedFile {
  name: string;
  content: string;
}

function isRepeated(label: string | number | undefined): boolean {
  return label === 3 || label === 'LABEL_REPEATED';
}

function toPascalCase(snake: string): string {
  return snake
    .split('_')
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : ''))
    .join('');
}

function posixRelativeImport(fromProto: string, toProto: string): string {
  const fromParts = fromProto.replace(/\\/g, '/').split('/');
  fromParts.pop();
  const toBase = toProto.replace(/\\/g, '/').replace(/\.proto$/, '') + '_omnibuf.pb.js';
  const toParts = toBase.split('/');

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const upCount = fromParts.length - common;
  const relParts: string[] = [];
  for (let i = 0; i < upCount; i++) relParts.push('..');
  for (let i = common; i < toParts.length; i++) relParts.push(toParts[i]!);
  const rel = relParts.join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

interface MessageSymbolInfo {
  fullProtoName: string; // e.g. "pkg.Outer.Inner" (no leading dot)
  fileProtoName: string; // e.g. "dir/file.proto"
  exportName: string; // e.g. "Outer_Inner" in its defining file
  desc: DescriptorProtoJSON;
}

interface EnumSymbolInfo {
  fullProtoName: string;
  fileProtoName: string;
  exportName: string;
  desc: EnumDescriptorProtoJSON;
}

interface MapEntryInfo {
  keyType: number;
  valType: number;
  valTypeName?: string;
}

interface SymbolRegistry {
  messages: Map<string, MessageSymbolInfo>;
  enums: Map<string, EnumSymbolInfo>;
  mapEntries: Map<string, MapEntryInfo>;
}

function buildSymbolRegistry(files: FileDescriptorProtoJSON[]): SymbolRegistry {
  const messages = new Map<string, MessageSymbolInfo>();
  const enums = new Map<string, EnumSymbolInfo>();
  const mapEntries = new Map<string, MapEntryInfo>();

  for (const file of files) {
    const fileName = file.name ?? 'messages.proto';
    const pkg = file.package ?? '';
    const usedExportNames = new Set<string>(['$ob', 'globalThis']);
    const allocateExportName = (base: string): string => {
      let candidate = base;
      let suffix = 1;
      while (usedExportNames.has(candidate)) {
        candidate = `${base}$${suffix++}`;
      }
      usedExportNames.add(candidate);
      return candidate;
    };

    for (const en of file.enumType ?? []) {
      const enName = en.name ?? 'Enum';
      const fullProtoName = pkg ? `${pkg}.${enName}` : enName;
      enums.set(fullProtoName, {
        fullProtoName,
        fileProtoName: fileName,
        exportName: allocateExportName(enName),
        desc: en,
      });
    }

    const visitMessage = (
      protoPrefix: string,
      tsPrefix: string,
      msg: DescriptorProtoJSON,
    ): void => {
      const msgName = msg.name ?? 'Message';
      const fullProtoName = protoPrefix ? `${protoPrefix}.${msgName}` : msgName;
      const rawExportName = tsPrefix ? `${tsPrefix}_${msgName}` : msgName;

      if (msg.options?.mapEntry) {
        const kf = (msg.field ?? []).find((x) => x.number === 1);
        const vf = (msg.field ?? []).find((x) => x.number === 2);
        mapEntries.set(fullProtoName, {
          keyType: parseFieldDescriptorType(kf?.type),
          valType: parseFieldDescriptorType(vf?.type),
          valTypeName: vf?.typeName,
        });
        return;
      }

      const exportName = allocateExportName(rawExportName);
      messages.set(fullProtoName, {
        fullProtoName,
        fileProtoName: fileName,
        exportName,
        desc: msg,
      });

      for (const en of msg.enumType ?? []) {
        const enName = en.name ?? 'Enum';
        const enFull = `${fullProtoName}.${enName}`;
        enums.set(enFull, {
          fullProtoName: enFull,
          fileProtoName: fileName,
          exportName: allocateExportName(`${exportName}_${enName}`),
          desc: en,
        });
      }

      for (const nested of msg.nestedType ?? []) {
        visitMessage(fullProtoName, exportName, nested);
      }
    };

    for (const msg of file.messageType ?? []) {
      visitMessage(pkg, '', msg);
    }
  }

  return { messages, enums, mapEntries };
}

function resolveCandidateName<T>(
  rawTypeName: string | undefined,
  enclosingFullProtoName: string,
  pkg: string,
  table: Map<string, T>,
): T | undefined {
  if (!rawTypeName) return undefined;
  if (rawTypeName.startsWith('.')) {
    const clean = rawTypeName.slice(1);
    return table.get(clean);
  }
  // Relative lookup from innermost enclosing message scope outward to package and root
  const parts = enclosingFullProtoName ? enclosingFullProtoName.split('.') : [];
  for (let i = parts.length; i >= 0; i--) {
    const scope = parts.slice(0, i).join('.');
    const candidate = scope ? `${scope}.${rawTypeName}` : rawTypeName;
    const hit = table.get(candidate);
    if (hit) return hit;
  }
  if (pkg) {
    const hit = table.get(`${pkg}.${rawTypeName}`);
    if (hit) return hit;
  }
  return table.get(rawTypeName);
}

interface ResolvedOneof {
  index: number;
  protoName: string;
  localName: string;
  emitProtoAlias: boolean;
  fields: ResolvedField[];
}

interface ResolvedField {
  number: number;
  name: string;
  localName: string;
  emitNameAlias: boolean;
  pascalName: string;
  storageProp: string;
  getterName: string;
  setterName: string;
  shorthandMethods: string[];
  type: number;
  repeated: boolean;
  isMap: boolean;
  mapKeyType: number;
  mapValType: number;
  subMsgSymbol?: string;
  mapValMsgSymbol?: string;
  enumSymbol?: string;
  oneofLocalName?: string;
  oneofProtoName?: string;
  explicitPresence: boolean;
}

function tsTypeForField(f: ResolvedField): string {
  if (f.isMap) {
    const valTs = tsTypeForField({
      ...f,
      isMap: false,
      repeated: false,
      type: f.mapValType,
      subMsgSymbol: f.mapValMsgSymbol,
      oneofLocalName: undefined,
      explicitPresence: false,
    }).replace(' | null', '');
    return `{ [key: string]: ${valTs} }`;
  }
  let base = 'number';
  switch (f.type) {
    case ProtoScalarType.UINT64:
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT64:
    case ProtoScalarType.FIXED64:
    case ProtoScalarType.SFIXED64:
      base = '(number | bigint)';
      break;
    case ProtoScalarType.STRING:
      base = 'string';
      break;
    case ProtoScalarType.BOOL:
      base = 'boolean';
      break;
    case ProtoScalarType.BYTES:
      base = 'globalThis.Uint8Array';
      break;
    case ProtoScalarType.ENUM:
      base = f.enumSymbol ?? 'number';
      break;
    case ProtoScalarType.MESSAGE:
      base = f.subMsgSymbol ?? '{ [key: string]: any }';
      break;
    default:
      base = 'number';
      break;
  }
  if (f.repeated) return `${base}[]`;
  if (f.type === ProtoScalarType.MESSAGE) {
    return f.oneofLocalName ? `${base} | null | undefined` : `${base} | null`;
  }
  if (f.explicitPresence || f.oneofLocalName) return `${base} | undefined`;
  return base;
}

function defaultValueExprForField(f: ResolvedField): string {
  if (f.isMap) return '{}';
  if (f.repeated) return '[]';
  if (f.explicitPresence) return 'undefined';
  switch (f.type) {
    case ProtoScalarType.STRING:
      return "''";
    case ProtoScalarType.BOOL:
      return 'false';
    case ProtoScalarType.BYTES:
      return 'new globalThis.Uint8Array(0)';
    case ProtoScalarType.MESSAGE:
      return 'null';
    case ProtoScalarType.ENUM:
      return '0 as any';
    default:
      return '0';
  }
}

function schemaTypeString(f: { type: number; repeated: boolean; isMap: boolean }): string {
  if (f.isMap) return 'map';
  const suffix = f.repeated ? '[]' : '';
  switch (f.type) {
    case ProtoScalarType.UINT32:
      return `uint32${suffix}`;
    case ProtoScalarType.UINT64:
      return `uint64${suffix}`;
    case ProtoScalarType.INT32:
      return `int32${suffix}`;
    case ProtoScalarType.ENUM:
      return `enum${suffix}`;
    case ProtoScalarType.INT64:
      return `int64${suffix}`;
    case ProtoScalarType.SINT32:
      return `sint32${suffix}`;
    case ProtoScalarType.SINT64:
      return `sint64${suffix}`;
    case ProtoScalarType.FIXED32:
      return `fixed32${suffix}`;
    case ProtoScalarType.SFIXED32:
      return `sfixed32${suffix}`;
    case ProtoScalarType.FIXED64:
      return `fixed64${suffix}`;
    case ProtoScalarType.SFIXED64:
      return `sfixed64${suffix}`;
    case ProtoScalarType.FLOAT:
      return `float32${suffix}`;
    case ProtoScalarType.DOUBLE:
      return `float64${suffix}`;
    case ProtoScalarType.BOOL:
      return `bool${suffix}`;
    case ProtoScalarType.STRING:
      return `string${suffix}`;
    case ProtoScalarType.BYTES:
      return `bytes${suffix}`;
    case ProtoScalarType.MESSAGE:
      return `submsg${suffix}`;
    default:
      return `uint32${suffix}`;
  }
}

function mapWireType(type: number): number {
  switch (type) {
    case ProtoScalarType.UINT32:
    case ProtoScalarType.UINT64:
      return 0;
    case ProtoScalarType.INT32:
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.SINT64:
    case ProtoScalarType.ENUM:
      return 1;
    case ProtoScalarType.BOOL:
      return 2;
    case ProtoScalarType.FIXED32:
      return 4;
    case ProtoScalarType.FIXED64:
      return 5;
    case ProtoScalarType.SFIXED32:
      return 6;
    case ProtoScalarType.SFIXED64:
      return 7;
    case ProtoScalarType.FLOAT:
      return 8;
    case ProtoScalarType.DOUBLE:
      return 9;
    case ProtoScalarType.STRING:
      return 10;
    case ProtoScalarType.BYTES:
      return 11;
    case ProtoScalarType.MESSAGE:
      return 12;
    default:
      return 0;
  }
}

function emitMapPayload(type: number, subMsgSymbol: string | undefined, value: string): string {
  switch (type) {
    case ProtoScalarType.STRING:
      return `enc.writeRawStringPayload(${value});`;
    case ProtoScalarType.BYTES:
      return `enc.writeRawBytesPayload(${value});`;
    case ProtoScalarType.BOOL:
      return `enc.writeByte(${value} === true || globalThis.String(${value}) === 'true' ? 1 : 0);`;
    case ProtoScalarType.MESSAGE:
      return `enc.beginContainer(); if (${value}) encode${subMsgSymbol}(enc, ${value}, options); enc.endContainer();`;
    case ProtoScalarType.FLOAT:
      return `enc.writeRawFloat32(globalThis.Number(${value}));`;
    case ProtoScalarType.DOUBLE:
      return `enc.writeRawFloat64(globalThis.Number(${value}));`;
    case ProtoScalarType.FIXED32:
      return `enc.writeRawFixed32(globalThis.Number(${value}) >>> 0);`;
    case ProtoScalarType.SFIXED32:
      return `enc.writeRawFixed32(globalThis.Number(${value}) | 0);`;
    case ProtoScalarType.FIXED64:
    case ProtoScalarType.SFIXED64:
      return `enc.writeRawFixed64($ob.toBigInt64Input(${value}));`;
    case ProtoScalarType.INT32:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.ENUM:
      return `enc.writeRawVarint($ob.encodeZigZag(globalThis.Number(${value}) | 0));`;
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT64:
      return `enc.writeRawVarint($ob.encodeZigZag($ob.toBigInt64Input(${value})));`;
    case ProtoScalarType.UINT32:
      return `enc.writeRawVarint(globalThis.Number(${value}) >>> 0);`;
    default:
      return `enc.writeRawVarint($ob.toBigInt64Input(${value}));`;
  }
}

function emitFieldValueAccess(f: ResolvedField, objExpr: string): string {
  if (f.oneofLocalName) {
    const g = `((${objExpr} as any).${f.oneofLocalName} ?? ${f.oneofProtoName && f.oneofProtoName !== f.oneofLocalName ? `(${objExpr} as any).${f.oneofProtoName}` : 'undefined'})`;
    return `((${g} && typeof ${g} === 'object' && 'case' in ${g}) ? ((${g}.case === ${JSON.stringify(f.localName)} || ${g}.case === ${JSON.stringify(f.name)}) ? (${g}.value as any) : undefined) : ((${objExpr} as any).${f.localName} ?? ${f.emitNameAlias ? `(${objExpr} as any).${f.name}` : 'undefined'}))`;
  }
  return f.emitNameAlias
    ? `(${objExpr}.${f.localName} ?? ${objExpr}.${f.name})`
    : `${objExpr}.${f.localName}`;
}

function emitEncodeField(f: ResolvedField, objExpr: string, indent: string): string {
  const rawAccess = emitFieldValueAccess(f, objExpr);

  if (f.oneofLocalName || f.explicitPresence) {
    const innerField: ResolvedField = {
      ...f,
      oneofLocalName: undefined,
      explicitPresence: false,
    };
    const innerCode = emitEncodeScalarOrSubMsgWithVar(innerField, '__v', `${indent}  `);
    return [
      `${indent}{`,
      `${indent}  const __v = ${rawAccess};`,
      `${indent}  if (__v !== undefined && __v !== null) {`,
      innerCode,
      `${indent}  }`,
      `${indent}}`,
    ].join('\n');
  }

  return emitEncodeScalarOrSubMsgWithVar(f, rawAccess, indent);
}

function emitEncodeScalarOrSubMsgWithVar(f: ResolvedField, val: string, indent: string): string {
  const num = f.number;
  if (f.isMap) {
    const kw = mapWireType(f.mapKeyType);
    const vw = mapWireType(f.mapValType);
    const sort =
      f.mapKeyType === ProtoScalarType.STRING
        ? '$ob.compareUTF8Strings(a, b)'
        : f.mapKeyType === ProtoScalarType.BOOL
          ? 'globalThis.Number(a === "true") - globalThis.Number(b === "true")'
          : 'globalThis.BigInt(a) < globalThis.BigInt(b) ? -1 : globalThis.BigInt(a) > globalThis.BigInt(b) ? 1 : 0';
    return [
      `${indent}{`,
      `${indent}  const entries = globalThis.Object.entries(${val} ?? {});`,
      `${indent}  if (options?.deterministic) entries.sort(([a], [b]) => ${sort});`,
      `${indent}  enc.writeTag(${num}, 14); enc.beginContainer(3 + entries.length * 2);`,
      `${indent}  enc.writeByte(${kw}); enc.writeByte(${vw}); enc.writeRawVarint(entries.length);`,
      `${indent}  for (const [k, v] of entries) {`,
      `${indent}    ${emitMapPayload(f.mapKeyType, undefined, 'k')}`,
      `${indent}    ${emitMapPayload(f.mapValType, f.mapValMsgSymbol, 'v')}`,
      `${indent}  }`,
      `${indent}  enc.endContainer();`,
      `${indent}}`,
    ].join('\n');
  }
  if (f.repeated) {
    switch (f.type) {
      case ProtoScalarType.UINT32:
        return `${indent}enc.writeUint32Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.UINT64:
        return `${indent}enc.writeUintArr(${num}, ${val} ?? []);`;
      case ProtoScalarType.INT32:
      case ProtoScalarType.INT64:
      case ProtoScalarType.SINT32:
      case ProtoScalarType.SINT64:
      case ProtoScalarType.ENUM:
        return `${indent}enc.writeSintArr(${num}, ${val} ?? []);`;
      case ProtoScalarType.FIXED32:
        return `${indent}enc.writeFixed32Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.SFIXED32:
        return `${indent}enc.writeSfixed32Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.FIXED64:
        return `${indent}enc.writeFixed64Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.SFIXED64:
        return `${indent}enc.writeSfixed64Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.FLOAT:
        return `${indent}enc.writeFloat32Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.DOUBLE:
        return `${indent}enc.writeFloat64Arr(${num}, ${val} ?? []);`;
      case ProtoScalarType.BOOL:
        return `${indent}enc.writeBoolArr(${num}, ${val} ?? []);`;
      case ProtoScalarType.BYTES:
        return `${indent}enc.writeBytesArr(${num}, ${val} ?? []);`;
      case ProtoScalarType.STRING:
        return `${indent}enc.writeStringArr(${num}, ${val} ?? []);`;
      case ProtoScalarType.MESSAGE: {
        const sub = f.subMsgSymbol!;
        return [
          `${indent}{`,
          `${indent}  const arr = ${val} ?? [];`,
          `${indent}  let arrMin = 2 + arr.length * 2;`,
          `${indent}  if (arr.length <= 64) {`,
          `${indent}    for (let i = 0; i < arr.length; i++) {`,
          `${indent}      const item = arr[i];`,
          `${indent}      if (item !== null && item !== undefined) arrMin += minBytes${sub}(item);`,
          `${indent}    }`,
          `${indent}  }`,
          `${indent}  enc.beginSubMsgArr(${num}, arrMin);`,
          `${indent}  for (let i = 0; i < arr.length; i++) {`,
          `${indent}    const item = arr[i];`,
          `${indent}    const elemMin = arrMin > 16383 && item !== null && item !== undefined ? minBytes${sub}(item) : 0;`,
          `${indent}    enc.beginSubMsgElem(elemMin);`,
          `${indent}    if (item !== null && item !== undefined) encode${sub}(enc, item, options);`,
          `${indent}    enc.endSubMsgElem();`,
          `${indent}  }`,
          `${indent}  enc.endSubMsgArr();`,
          `${indent}}`,
        ].join('\n');
      }
      default:
        return '';
    }
  }

  switch (f.type) {
    case ProtoScalarType.UINT32:
      return `${indent}enc.writeUint(${num}, globalThis.Number(${val} ?? 0) >>> 0);`;
    case ProtoScalarType.UINT64:
      return `${indent}enc.writeUint(${num}, ${val} ?? 0);`;
    case ProtoScalarType.INT32:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.ENUM:
      return `${indent}enc.writeInt(${num}, globalThis.Number(${val} ?? 0) | 0);`;
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT64:
      return `${indent}enc.writeInt(${num}, ${val} ?? 0);`;
    case ProtoScalarType.FIXED32:
      return `${indent}enc.writeFixed32(${num}, globalThis.Number(${val} ?? 0) >>> 0);`;
    case ProtoScalarType.SFIXED32:
      return `${indent}enc.writeSfixed32(${num}, globalThis.Number(${val} ?? 0) | 0);`;
    case ProtoScalarType.FIXED64:
      return `${indent}enc.writeFixed64(${num}, ${val} ?? 0);`;
    case ProtoScalarType.SFIXED64:
      return `${indent}enc.writeSfixed64(${num}, ${val} ?? 0);`;
    case ProtoScalarType.FLOAT:
      return `${indent}enc.writeFloat32(${num}, ${val} ?? 0);`;
    case ProtoScalarType.DOUBLE:
      return `${indent}enc.writeFloat64(${num}, ${val} ?? 0);`;
    case ProtoScalarType.BOOL:
      return `${indent}enc.writeBool(${num}, globalThis.Boolean(${val}));`;
    case ProtoScalarType.STRING:
      return `${indent}enc.writeString(${num}, ${val} ?? '');`;
    case ProtoScalarType.BYTES:
      return `${indent}enc.writeBytes(${num}, ${val} ?? new globalThis.Uint8Array(0));`;
    case ProtoScalarType.MESSAGE: {
      const sub = f.subMsgSymbol!;
      return [
        `${indent}{`,
        `${indent}  const subVal = ${val};`,
        `${indent}  if (subVal !== null && subVal !== undefined) {`,
        `${indent}    enc.beginSubMsg(${num}, minBytes${sub}(subVal));`,
        `${indent}    encode${sub}(enc, subVal, options);`,
        `${indent}    enc.endSubMsg();`,
        `${indent}  }`,
        `${indent}}`,
      ].join('\n');
    }
    default:
      return '';
  }
}

function expectedWireTypeNum(f: ResolvedField): number {
  if (f.isMap) return 14;
  if (f.repeated) return 13;
  switch (f.type) {
    case ProtoScalarType.UINT32:
    case ProtoScalarType.UINT64:
      return 0;
    case ProtoScalarType.INT32:
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.SINT64:
    case ProtoScalarType.ENUM:
      return 1;
    case ProtoScalarType.FIXED32:
      return 4;
    case ProtoScalarType.FIXED64:
      return 5;
    case ProtoScalarType.SFIXED32:
      return 6;
    case ProtoScalarType.SFIXED64:
      return 7;
    case ProtoScalarType.FLOAT:
      return 8;
    case ProtoScalarType.DOUBLE:
      return 9;
    case ProtoScalarType.STRING:
      return 10;
    case ProtoScalarType.BYTES:
      return 11;
    case ProtoScalarType.MESSAGE:
      return 12;
    default:
      return 0;
  }
}

function emitAssignDecodedField(f: ResolvedField, valExpr: string): string {
  if (f.oneofLocalName) {
    return `(out as any).${f.oneofLocalName} = { case: ${JSON.stringify(f.localName)}, value: ${valExpr} };`;
  }
  return `out.${f.localName} = ${valExpr};`;
}

function emitDecodeMapEntryInline(
  type: number,
  subMsgSymbol: string | undefined,
  wtVar: string,
  targetVar: string,
  indent: string,
): string {
  switch (type) {
    case ProtoScalarType.STRING:
      return [
        `${indent}if (${wtVar} !== 10 || p >= body.length) throw new globalThis.Error('omnibuf: invalid map string wire type');`,
        `${indent}const __sb = body[p]!;`,
        `${indent}if ((__sb & 1) !== 0) {`,
        `${indent}  const __sl = __sb >>> 1;`,
        `${indent}  p += 1;`,
        `${indent}  if (p + __sl > body.length) throw new globalThis.Error('omnibuf: truncated map string');`,
        `${indent}  ${targetVar} = $ob.decodeUTF8(body, p, p + __sl);`,
        `${indent}  p += __sl;`,
        `${indent}} else {`,
        `${indent}  const [__s, __np] = $ob.readLenSlice(body, p, 0);`,
        `${indent}  ${targetVar} = $ob.decodeUTF8(__s); p = __np;`,
        `${indent}}`,
      ].join('\n');
    case ProtoScalarType.BYTES:
      return [
        `${indent}if (${wtVar} !== 11) throw new globalThis.Error('omnibuf: invalid map bytes wire type');`,
        `${indent}const [__b, __np] = $ob.readLenSlice(body, p, 0);`,
        `${indent}${targetVar} = options?.zeroCopy ? __b : __b.slice(); p = __np;`,
      ].join('\n');
    case ProtoScalarType.BOOL:
      return [
        `${indent}if (${wtVar} !== 2 || p >= body.length || (body[p]! !== 0 && body[p]! !== 1)) throw new globalThis.Error('omnibuf: invalid map bool');`,
        `${indent}${targetVar} = body[p++]! === 1;`,
      ].join('\n');
    case ProtoScalarType.UINT32:
      return [
        `${indent}if (${wtVar} !== 0) throw new globalThis.Error('omnibuf: invalid map uint32 wire type');`,
        `${indent}const [__u, __un] = $ob.decodeVarintBigInt(body, p);`,
        `${indent}if (__un === 0) throw new globalThis.Error('omnibuf: truncated map uint32');`,
        `${indent}${targetVar} = globalThis.Number(__u & 0xffffffffn) >>> 0; p += __un;`,
      ].join('\n');
    case ProtoScalarType.UINT64:
      return [
        `${indent}if (${wtVar} !== 0) throw new globalThis.Error('omnibuf: invalid map uint64 wire type');`,
        `${indent}const [__u, __un] = $ob.decodeVarintAuto(body, p);`,
        `${indent}if (__un === 0) throw new globalThis.Error('omnibuf: truncated map uint64');`,
        `${indent}${targetVar} = __u; p += __un;`,
      ].join('\n');
    case ProtoScalarType.INT32:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.ENUM:
      return [
        `${indent}if (${wtVar} !== 1) throw new globalThis.Error('omnibuf: invalid map sint32/enum wire type');`,
        `${indent}const [__u, __un] = $ob.decodeVarintBigInt(body, p);`,
        `${indent}if (__un === 0) throw new globalThis.Error('omnibuf: truncated map sint32/enum');`,
        `${indent}${targetVar} = $ob.decodeZigZag32(__u); p += __un;`,
      ].join('\n');
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT64:
      return [
        `${indent}if (${wtVar} !== 1) throw new globalThis.Error('omnibuf: invalid map sint64 wire type');`,
        `${indent}const [__u, __un] = $ob.decodeVarintBigInt(body, p);`,
        `${indent}if (__un === 0) throw new globalThis.Error('omnibuf: truncated map sint64');`,
        `${indent}${targetVar} = $ob.decodeZigZagAuto(__u); p += __un;`,
      ].join('\n');
    case ProtoScalarType.FLOAT:
      return [
        `${indent}if (${wtVar} !== 8 || body.length - p < 4) throw new globalThis.Error('omnibuf: invalid map float32');`,
        `${indent}const __bits = (body[p]! | (body[p + 1]! << 8) | (body[p + 2]! << 16) | (body[p + 3]! << 24)) >>> 0;`,
        `${indent}${targetVar} = $ob.float32FromBits(__bits); p += 4;`,
      ].join('\n');
    case ProtoScalarType.FIXED32:
      return [
        `${indent}if (${wtVar} !== 4 || body.length - p < 4) throw new globalThis.Error('omnibuf: invalid map fixed32');`,
        `${indent}${targetVar} = (body[p]! | (body[p + 1]! << 8) | (body[p + 2]! << 16) | (body[p + 3]! << 24)) >>> 0; p += 4;`,
      ].join('\n');
    case ProtoScalarType.SFIXED32:
      return [
        `${indent}if (${wtVar} !== 6 || body.length - p < 4) throw new globalThis.Error('omnibuf: invalid map sfixed32');`,
        `${indent}${targetVar} = (body[p]! | (body[p + 1]! << 8) | (body[p + 2]! << 16) | (body[p + 3]! << 24)) | 0; p += 4;`,
      ].join('\n');
    case ProtoScalarType.DOUBLE:
      return [
        `${indent}if (${wtVar} !== 9 || body.length - p < 8) throw new globalThis.Error('omnibuf: invalid map float64');`,
        `${indent}let __u64 = 0n; for (let b = 7; b >= 0; b--) __u64 = (__u64 << 8n) | globalThis.BigInt(body[p + b]!);`,
        `${indent}${targetVar} = $ob.float64FromBits(__u64); p += 8;`,
      ].join('\n');
    case ProtoScalarType.FIXED64:
      return [
        `${indent}if (${wtVar} !== 5 || body.length - p < 8) throw new globalThis.Error('omnibuf: invalid map fixed64');`,
        `${indent}let __u64 = 0n; for (let b = 7; b >= 0; b--) __u64 = (__u64 << 8n) | globalThis.BigInt(body[p + b]!);`,
        `${indent}${targetVar} = __u64 <= 9007199254740991n ? globalThis.Number(__u64) : __u64; p += 8;`,
      ].join('\n');
    case ProtoScalarType.SFIXED64:
      return [
        `${indent}if (${wtVar} !== 7 || body.length - p < 8) throw new globalThis.Error('omnibuf: invalid map sfixed64');`,
        `${indent}let __u64 = 0n; for (let b = 7; b >= 0; b--) __u64 = (__u64 << 8n) | globalThis.BigInt(body[p + b]!);`,
        `${indent}const __s64 = globalThis.BigInt.asIntN(64, __u64);`,
        `${indent}${targetVar} = __s64 >= -9007199254740991n && __s64 <= 9007199254740991n ? globalThis.Number(__s64) : __s64; p += 8;`,
      ].join('\n');
    case ProtoScalarType.MESSAGE:
      return [
        `${indent}if (${wtVar} !== 12) throw new globalThis.Error('omnibuf: invalid map submsg wire type');`,
        `${indent}const [__sub, __np] = $ob.readLenSlice(body, p, 0);`,
        `${indent}${targetVar} = decode${subMsgSymbol}(__sub, undefined, depth + 2, options); p = __np;`,
      ].join('\n');
    default:
      return '';
  }
}

function emitDecodeFieldCaseBody(f: ResolvedField, indent: string): string {
  const prop = `out.${f.localName}`;
  if (f.isMap) {
    const expKeyWT = mapWireType(f.mapKeyType);
    const expValWT = mapWireType(f.mapValType);
    return [
      `${indent}if (depth + 1 > maxDepth) throw new globalThis.Error(\`omnibuf: nesting depth \${depth + 1} exceeds MaxNestingDepth (\${maxDepth})\`);`,
      `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 3, n);`,
      `${indent}const keyWT = body[0]!;`,
      `${indent}const valWT = body[1]!;`,
      `${indent}$ob.validateMapTypes(keyWT, valWT);`,
      `${indent}if (keyWT !== ${expKeyWT} || valWT !== ${expValWT}) throw new globalThis.Error('omnibuf: WireMap header mismatch');`,
      `${indent}const [count, cn] = $ob.decodeVarintBigInt(body, 2);`,
      `${indent}if (cn === 0 || count > globalThis.BigInt(globalThis.Math.floor((body.length - (2 + cn)) / 2))) throw new globalThis.Error('omnibuf: invalid map count');`,
      `${indent}const dst: { [key: string]: any } = alreadySeen && ${prop} && typeof ${prop} === 'object' ? ${prop} : {};`,
      `${indent}let p = 2 + cn;`,
      `${indent}const c = globalThis.Number(count);`,
      `${indent}for (let i = 0; i < c; i++) {`,
      `${indent}  let kVal: any;`,
      `${indent}  let vVal: any;`,
      `${indent}  {`,
      emitDecodeMapEntryInline(f.mapKeyType, undefined, 'keyWT', 'kVal', `${indent}    `),
      `${indent}  }`,
      `${indent}  {`,
      emitDecodeMapEntryInline(f.mapValType, f.mapValMsgSymbol, 'valWT', 'vVal', `${indent}    `),
      `${indent}  }`,
      `${indent}  const __kStr = globalThis.String(kVal);`,
      `${indent}  if (__kStr === '__proto__') {`,
      `${indent}    globalThis.Object.defineProperty(dst, __kStr, { value: vVal, writable: true, enumerable: true, configurable: true });`,
      `${indent}  } else {`,
      `${indent}    dst[__kStr] = vVal;`,
      `${indent}  }`,
      `${indent}}`,
      `${indent}if (p !== body.length) throw new globalThis.Error('omnibuf: map trailing bytes');`,
      `${indent}${prop} = dst;`,
      `${indent}pos = nextPos;`,
    ].join('\n');
  }

  if (f.repeated) {
    const depthGuard = `${indent}if (depth + 1 > maxDepth) throw new globalThis.Error(\`omnibuf: nesting depth \${depth + 1} exceeds MaxNestingDepth (\${maxDepth})\`);\n`;
    const bodyCode = ((): string => {
      switch (f.type) {
        case ProtoScalarType.STRING:
          return [
            `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}const lb = buf[pos]!;`,
            `${indent}let bodyLen = 0;`,
            `${indent}if ((lb & 1) !== 0) {`,
            `${indent}  bodyLen = lb >>> 1;`,
            `${indent}  pos += 1;`,
            `${indent}} else if ((lb & 2) !== 0) {`,
            `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}  bodyLen = (lb | (buf[pos + 1]! << 8)) >>> 2;`,
            `${indent}  pos += 2;`,
            `${indent}} else {`,
            `${indent}  const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}  const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}  const [arr, ok] = $ob.appendStringArrBody(prev, body);`,
            `${indent}  if (!ok) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}  ${prop} = arr; pos = nextPos;`,
            `${indent}  break;`,
            `${indent}}`,
            `${indent}const bodyEnd = pos + bodyLen;`,
            `${indent}if (bodyLen < 2 || bodyEnd > n) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}if (buf[pos]! === 10 && (buf[pos + 1]! & 1) !== 0) {`,
            `${indent}  const count = buf[pos + 1]! >>> 1;`,
            `${indent}  let p = pos + 2;`,
            `${indent}  if (count > bodyEnd - p) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}  let dst: string[];`,
            `${indent}  let baseIdx = 0;`,
            `${indent}  if (!alreadySeen) { dst = new globalThis.Array<string>(count); ${prop} = dst; } else {`,
            `${indent}    dst = ${prop};`,
            `${indent}    if (!globalThis.Array.isArray(dst)) { dst = new globalThis.Array<string>(count); ${prop} = dst; } else { baseIdx = dst.length; dst.length = baseIdx + count; }`,
            `${indent}  }`,
            `${indent}  for (let i = 0; i < count; i++) {`,
            `${indent}    if (p >= bodyEnd) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}    const sb = buf[p]!;`,
            `${indent}    if ((sb & 1) !== 0) {`,
            `${indent}      const sLen = sb >>> 1;`,
            `${indent}      p += 1;`,
            `${indent}      if (p + sLen > bodyEnd) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}      dst[baseIdx + i] = $ob.decodeUTF8Len(buf, p, sLen);`,
            `${indent}      p += sLen;`,
            `${indent}    } else {`,
            `${indent}      const [sLen, sn] = $ob.decodeVarintBigInt(buf, p, bodyEnd);`,
            `${indent}      if (sn === 0 || sLen > globalThis.BigInt(bodyEnd - (p + sn))) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}      p += sn;`,
            `${indent}      const sLenNum = globalThis.Number(sLen);`,
            `${indent}      dst[baseIdx + i] = $ob.decodeUTF8(buf, p, p + sLenNum);`,
            `${indent}      p += sLenNum;`,
            `${indent}    }`,
            `${indent}  }`,
            `${indent}  if (p !== bodyEnd) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}  pos = bodyEnd;`,
            `${indent}  break;`,
            `${indent}}`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendStringArrBody(prev, buf.subarray(pos, bodyEnd));`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid string array');`,
            `${indent}${prop} = arr; pos = bodyEnd;`,
          ].join('\n');
        case ProtoScalarType.BYTES:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendBytesArrBody(prev, body, globalThis.Boolean(options?.zeroCopy));`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid bytes array');`,
            `${indent}${prop} = arr; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.BOOL:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendBoolArrBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid bool array');`,
            `${indent}${prop} = arr; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.UINT32:
          return [
            `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}const lb = buf[pos]!;`,
            `${indent}let bodyLen = 0;`,
            `${indent}if ((lb & 1) !== 0) {`,
            `${indent}  bodyLen = lb >>> 1;`,
            `${indent}  pos += 1;`,
            `${indent}} else if ((lb & 2) !== 0) {`,
            `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}  bodyLen = (lb | (buf[pos + 1]! << 8)) >>> 2;`,
            `${indent}  pos += 2;`,
            `${indent}} else {`,
            `${indent}  const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}  const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}  const [arr, ok] = $ob.appendUint32ArrBody(prev, body);`,
            `${indent}  if (!ok) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}  ${prop} = arr as any; pos = nextPos;`,
            `${indent}  break;`,
            `${indent}}`,
            `${indent}const bodyEnd = pos + bodyLen;`,
            `${indent}if (bodyLen < 2 || bodyEnd > n) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}if (buf[pos]! === 0 && (buf[pos + 1]! & 1) !== 0) {`,
            `${indent}  const count = buf[pos + 1]! >>> 1;`,
            `${indent}  let p = pos + 2;`,
            `${indent}  if (count > bodyEnd - p) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}  let dst: number[];`,
            `${indent}  let baseIdx = 0;`,
            `${indent}  if (!alreadySeen) { dst = new globalThis.Array<number>(count); ${prop} = dst as any; } else {`,
            `${indent}    dst = ${prop} as number[];`,
            `${indent}    if (!globalThis.Array.isArray(dst)) { dst = new globalThis.Array<number>(count); ${prop} = dst as any; } else { baseIdx = dst.length; dst.length = baseIdx + count; }`,
            `${indent}  }`,
            `${indent}  for (let i = 0; i < count; i++) {`,
            `${indent}    if (p >= bodyEnd) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}    const vb = buf[p]!;`,
            `${indent}    if ((vb & 1) !== 0) {`,
            `${indent}      dst[baseIdx + i] = vb >>> 1;`,
            `${indent}      p += 1;`,
            `${indent}    } else if ((vb & 2) !== 0) {`,
            `${indent}      if (p + 2 > bodyEnd) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}      dst[baseIdx + i] = (vb | (buf[p + 1]! << 8)) >>> 2;`,
            `${indent}      p += 2;`,
            `${indent}    } else if ((vb & 4) !== 0) {`,
            `${indent}      if (p + 4 > bodyEnd) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}      dst[baseIdx + i] = ((vb | (buf[p + 1]! << 8) | (buf[p + 2]! << 16) | (buf[p + 3]! << 24)) >>> 3) >>> 0;`,
            `${indent}      p += 4;`,
            `${indent}    } else {`,
            `${indent}      if (vb !== 0 || p + 9 > bodyEnd) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}      dst[baseIdx + i] = (buf[p + 1]! | (buf[p + 2]! << 8) | (buf[p + 3]! << 16) | (buf[p + 4]! << 24)) >>> 0;`,
            `${indent}      p += 9;`,
            `${indent}    }`,
            `${indent}  }`,
            `${indent}  if (p !== bodyEnd) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}  pos = bodyEnd;`,
            `${indent}  break;`,
            `${indent}}`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendUint32ArrBody(prev, buf.subarray(pos, bodyEnd));`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid uint32 array');`,
            `${indent}${prop} = arr as any; pos = bodyEnd;`,
          ].join('\n');
        case ProtoScalarType.ENUM:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendEnumArrBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid enum array');`,
            `${indent}${prop} = arr as any; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.UINT64:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendUintArrAutoBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid uint64 array');`,
            `${indent}${prop} = arr; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.INT32:
        case ProtoScalarType.SINT32:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendSint32ArrBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid sint32 array');`,
            `${indent}${prop} = arr as any; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.INT64:
        case ProtoScalarType.SINT64:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendSintArrAutoBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid sint array');`,
            `${indent}${prop} = arr as any; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.FLOAT:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendFloat32ArrBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid float32 array');`,
            `${indent}${prop} = arr; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.DOUBLE:
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}const [arr, ok] = $ob.appendFloat64ArrBody(prev, body);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: invalid float64 array');`,
            `${indent}${prop} = arr; pos = nextPos;`,
          ].join('\n');
        case ProtoScalarType.FIXED32:
        case ProtoScalarType.SFIXED32: {
          const expElemType = f.type === ProtoScalarType.SFIXED32 ? 6 : 4;
          const castOp = f.type === ProtoScalarType.SFIXED32 ? '| 0' : '>>> 0';
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const [elemType, c, startP, ok] = $ob.parseArrayHeader(body);`,
            `${indent}if (!ok || elemType !== ${expElemType} || body.length - startP !== c * 4) throw new globalThis.Error('omnibuf: invalid fixed32 array');`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}for (let i = 0; i < c; i++) {`,
            `${indent}  const off = startP + i * 4;`,
            `${indent}  prev.push((body[off]! | (body[off + 1]! << 8) | (body[off + 2]! << 16) | (body[off + 3]! << 24)) ${castOp});`,
            `${indent}}`,
            `${indent}${prop} = prev; pos = nextPos;`,
          ].join('\n');
        }
        case ProtoScalarType.FIXED64:
        case ProtoScalarType.SFIXED64: {
          const isSigned = f.type === ProtoScalarType.SFIXED64;
          const expElemType = isSigned ? 7 : 5;
          return [
            `${indent}const [body, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}const [elemType, c, startP, ok] = $ob.parseArrayHeader(body);`,
            `${indent}if (!ok || elemType !== ${expElemType} || body.length - startP !== c * 8) throw new globalThis.Error('omnibuf: invalid fixed64 array');`,
            `${indent}const prev = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}for (let i = 0; i < c; i++) {`,
            `${indent}  const off = startP + i * 8;`,
            `${indent}  let u64 = 0n; for (let b = 7; b >= 0; b--) u64 = (u64 << 8n) | globalThis.BigInt(body[off + b]!);`,
            isSigned
              ? `${indent}  const s64 = globalThis.BigInt.asIntN(64, u64); prev.push(s64 >= -9007199254740991n && s64 <= 9007199254740991n ? globalThis.Number(s64) : s64);`
              : `${indent}  prev.push(u64 <= 9007199254740991n ? globalThis.Number(u64) : u64);`,
            `${indent}}`,
            `${indent}${prop} = prev; pos = nextPos;`,
          ].join('\n');
        }
        case ProtoScalarType.MESSAGE: {
          const sub = f.subMsgSymbol!;
          return [
            `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}let arrLen = 0;`,
            `${indent}const lb = buf[pos]!;`,
            `${indent}if ((lb & 1) !== 0) {`,
            `${indent}  arrLen = lb >>> 1;`,
            `${indent}  pos += 1;`,
            `${indent}} else if ((lb & 2) !== 0) {`,
            `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}  arrLen = (lb | (buf[pos + 1]! << 8)) >>> 2;`,
            `${indent}  pos += 2;`,
            `${indent}} else {`,
            `${indent}  const [arrPayload, nextPos] = $ob.readLenSlice(buf, pos, 2, n);`,
            `${indent}  const [elemCount, ok] = $ob.countSubMsgArrElems(arrPayload);`,
            `${indent}  if (!ok) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}  const elems = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}  let [, , p] = $ob.parseArrayHeader(arrPayload);`,
            `${indent}  for (let i = 0; i < elemCount; i++) {`,
            `${indent}    const [el, en] = $ob.decodeVarintBigInt(arrPayload, p);`,
            `${indent}    p += en;`,
            `${indent}    const elNum = globalThis.Number(el);`,
            `${indent}    elems.push(decode${sub}(arrPayload, undefined, depth + 2, options, p, p + elNum));`,
            `${indent}    p += elNum;`,
            `${indent}  }`,
            `${indent}  ${prop} = elems; pos = nextPos;`,
            `${indent}  break;`,
            `${indent}}`,
            `${indent}const arrEnd = pos + arrLen;`,
            `${indent}if (arrLen < 2 || arrEnd > n) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}if (buf[pos]! === 12 && (buf[pos + 1]! & 1) !== 0) {`,
            `${indent}  const elemCount = buf[pos + 1]! >>> 1;`,
            `${indent}  let p = pos + 2;`,
            `${indent}  if (elemCount > arrEnd - p) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}  let elems: ${sub}[];`,
            `${indent}  let baseIdx = 0;`,
            `${indent}  if (!alreadySeen) { elems = new globalThis.Array<${sub}>(elemCount); ${prop} = elems; } else {`,
            `${indent}    elems = ${prop};`,
            `${indent}    if (!globalThis.Array.isArray(elems)) { elems = new globalThis.Array<${sub}>(elemCount); ${prop} = elems; } else { baseIdx = elems.length; elems.length = baseIdx + elemCount; }`,
            `${indent}  }`,
            `${indent}  for (let i = 0; i < elemCount; i++) {`,
            `${indent}    if (p >= arrEnd) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}    let elNum = 0;`,
            `${indent}    const eb0 = buf[p]!;`,
            `${indent}    if ((eb0 & 1) !== 0) {`,
            `${indent}      elNum = eb0 >>> 1;`,
            `${indent}      p += 1;`,
            `${indent}    } else if ((eb0 & 2) !== 0) {`,
            `${indent}      if (p + 2 > arrEnd) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}      elNum = (eb0 | (buf[p + 1]! << 8)) >>> 2;`,
            `${indent}      p += 2;`,
            `${indent}    } else {`,
            `${indent}      const [el, en] = $ob.decodeVarintBigInt(buf, p, arrEnd);`,
            `${indent}      if (en === 0 || el > globalThis.BigInt(arrEnd - (p + en))) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}      p += en;`,
            `${indent}      elNum = globalThis.Number(el);`,
            `${indent}    }`,
            `${indent}    if (p + elNum > arrEnd) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}    elems[baseIdx + i] = decode${sub}(buf, undefined, depth + 2, options, p, p + elNum);`,
            `${indent}    p += elNum;`,
            `${indent}  }`,
            `${indent}  if (p !== arrEnd) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}  pos = arrEnd;`,
            `${indent}  break;`,
            `${indent}}`,
            `${indent}const arrPayload = buf.subarray(pos, arrEnd);`,
            `${indent}const [elemCount, ok] = $ob.countSubMsgArrElems(arrPayload);`,
            `${indent}if (!ok) throw new globalThis.Error('omnibuf: corrupt submsg array');`,
            `${indent}const elems = alreadySeen && globalThis.Array.isArray(${prop}) ? ${prop} : [];`,
            `${indent}let [, , p] = $ob.parseArrayHeader(arrPayload);`,
            `${indent}for (let i = 0; i < elemCount; i++) {`,
            `${indent}  const [el, en] = $ob.decodeVarintBigInt(arrPayload, p);`,
            `${indent}  p += en;`,
            `${indent}  const elNum = globalThis.Number(el);`,
            `${indent}  elems.push(decode${sub}(arrPayload, undefined, depth + 2, options, p, p + elNum));`,
            `${indent}  p += elNum;`,
            `${indent}}`,
            `${indent}${prop} = elems; pos = arrEnd;`,
          ].join('\n');
        }
        default:
          return '';
      }
    })();
    return bodyCode ? depthGuard + bodyCode : '';
  }

  switch (f.type) {
    case ProtoScalarType.UINT32:
      return [
        `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: truncated uint32');`,
        `${indent}const vb = buf[pos]!;`,
        `${indent}let u32Val = 0;`,
        `${indent}if ((vb & 1) !== 0) {`,
        `${indent}  u32Val = vb >>> 1;`,
        `${indent}  pos += 1;`,
        `${indent}} else if ((vb & 2) !== 0) {`,
        `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: truncated uint32');`,
        `${indent}  u32Val = (vb | (buf[pos + 1]! << 8)) >>> 2;`,
        `${indent}  pos += 2;`,
        `${indent}} else if ((vb & 4) !== 0) {`,
        `${indent}  if (pos + 4 > n) throw new globalThis.Error('omnibuf: truncated uint32');`,
        `${indent}  u32Val = ((vb | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) >>> 3) >>> 0;`,
        `${indent}  pos += 4;`,
        `${indent}} else {`,
        `${indent}  if (vb !== 0 || pos + 9 > n) throw new globalThis.Error('omnibuf: truncated uint32');`,
        `${indent}  u32Val = (buf[pos + 1]! | (buf[pos + 2]! << 8) | (buf[pos + 3]! << 16) | (buf[pos + 4]! << 24)) >>> 0;`,
        `${indent}  pos += 9;`,
        `${indent}}`,
        `${indent}${emitAssignDecodedField(f, 'u32Val as any')}`,
      ].join('\n');
    case ProtoScalarType.UINT64:
      return [
        `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: truncated uint64');`,
        `${indent}const vb = buf[pos]!;`,
        `${indent}let u64Val: number | bigint;`,
        `${indent}if ((vb & 1) !== 0) {`,
        `${indent}  u64Val = vb >>> 1;`,
        `${indent}  pos += 1;`,
        `${indent}} else if ((vb & 2) !== 0) {`,
        `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: truncated uint64');`,
        `${indent}  u64Val = (vb | (buf[pos + 1]! << 8)) >>> 2;`,
        `${indent}  pos += 2;`,
        `${indent}} else if ((vb & 4) !== 0) {`,
        `${indent}  if (pos + 4 > n) throw new globalThis.Error('omnibuf: truncated uint64');`,
        `${indent}  u64Val = ((vb | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) >>> 3) >>> 0;`,
        `${indent}  pos += 4;`,
        `${indent}} else {`,
        `${indent}  if (vb !== 0 || pos + 9 > n) throw new globalThis.Error('omnibuf: truncated uint64');`,
        `${indent}  const lo = (buf[pos + 1]! | (buf[pos + 2]! << 8) | (buf[pos + 3]! << 16) | (buf[pos + 4]! << 24)) >>> 0;`,
        `${indent}  const hi = (buf[pos + 5]! | (buf[pos + 6]! << 8) | (buf[pos + 7]! << 16) | (buf[pos + 8]! << 24)) >>> 0;`,
        `${indent}  u64Val = hi <= 0x1fffff ? hi * 0x100000000 + lo : (globalThis.BigInt(hi) << 32n) | globalThis.BigInt(lo);`,
        `${indent}  pos += 9;`,
        `${indent}}`,
        `${indent}${emitAssignDecodedField(f, 'u64Val')}`,
      ].join('\n');
    case ProtoScalarType.INT32:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.ENUM:
      return [
        `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: truncated int32/enum');`,
        `${indent}const vb = buf[pos]!;`,
        `${indent}let i32Val = 0;`,
        `${indent}if ((vb & 1) !== 0) {`,
        `${indent}  const u = vb >>> 1;`,
        `${indent}  i32Val = (u >>> 1) ^ -(u & 1);`,
        `${indent}  pos += 1;`,
        `${indent}} else if ((vb & 2) !== 0) {`,
        `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: truncated int32/enum');`,
        `${indent}  const u = (vb | (buf[pos + 1]! << 8)) >>> 2;`,
        `${indent}  i32Val = (u >>> 1) ^ -(u & 1);`,
        `${indent}  pos += 2;`,
        `${indent}} else if ((vb & 4) !== 0) {`,
        `${indent}  if (pos + 4 > n) throw new globalThis.Error('omnibuf: truncated int32/enum');`,
        `${indent}  const u = ((vb | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) >>> 3) >>> 0;`,
        `${indent}  i32Val = (u >>> 1) ^ -(u & 1);`,
        `${indent}  pos += 4;`,
        `${indent}} else {`,
        `${indent}  const [v, vn] = $ob.decodeVarintBigInt(buf, pos, n);`,
        `${indent}  if (vn === 0) throw new globalThis.Error('omnibuf: truncated int32/enum');`,
        `${indent}  i32Val = $ob.decodeZigZag32(v);`,
        `${indent}  pos += vn;`,
        `${indent}}`,
        `${indent}${emitAssignDecodedField(f, 'i32Val as any')}`,
      ].join('\n');
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT64:
      return [
        `${indent}const [v, vn] = $ob.decodeVarintBigInt(buf, pos, n);`,
        `${indent}if (vn === 0) throw new globalThis.Error('omnibuf: truncated int64');`,
        `${indent}${emitAssignDecodedField(f, '$ob.decodeZigZagAuto(v)')}`,
        `${indent}pos += vn;`,
      ].join('\n');
    case ProtoScalarType.BOOL:
      return `${indent}${emitAssignDecodedField(f, 'wt === 3')}`;
    case ProtoScalarType.STRING:
      return [
        `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: truncated string');`,
        `${indent}const sb = buf[pos]!;`,
        `${indent}if ((sb & 1) !== 0) {`,
        `${indent}  const sLen = sb >>> 1;`,
        `${indent}  pos += 1;`,
        `${indent}  if (pos + sLen > n) throw new globalThis.Error('omnibuf: truncated string');`,
        `${indent}  ${emitAssignDecodedField(f, '$ob.decodeUTF8Len(buf, pos, sLen)')}`,
        `${indent}  pos += sLen;`,
        `${indent}} else {`,
        `${indent}  const [s, nextPos] = $ob.readLenSlice(buf, pos, 0, n);`,
        `${indent}  ${emitAssignDecodedField(f, '$ob.decodeUTF8(s)')}`,
        `${indent}  pos = nextPos;`,
        `${indent}}`,
      ].join('\n');
    case ProtoScalarType.BYTES:
      return [
        `${indent}const [b, nextPos] = $ob.readLenSlice(buf, pos, 0, n);`,
        `${indent}${emitAssignDecodedField(f, 'options?.zeroCopy ? b : b.slice()')}`,
        `${indent}pos = nextPos;`,
      ].join('\n');
    case ProtoScalarType.FLOAT:
      return [
        `${indent}if (n - pos < 4) throw new globalThis.Error('omnibuf: truncated float32');`,
        `${indent}${emitAssignDecodedField(f, '$ob.readFloat32At(buf, pos)')}`,
        `${indent}pos += 4;`,
      ].join('\n');
    case ProtoScalarType.FIXED32:
      return [
        `${indent}if (n - pos < 4) throw new globalThis.Error('omnibuf: truncated fixed32');`,
        `${indent}const bits = (buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) >>> 0;`,
        `${indent}${emitAssignDecodedField(f, 'bits')}`,
        `${indent}pos += 4;`,
      ].join('\n');
    case ProtoScalarType.SFIXED32:
      return [
        `${indent}if (n - pos < 4) throw new globalThis.Error('omnibuf: truncated sfixed32');`,
        `${indent}const bits = (buf[pos]! | (buf[pos + 1]! << 8) | (buf[pos + 2]! << 16) | (buf[pos + 3]! << 24)) | 0;`,
        `${indent}${emitAssignDecodedField(f, 'bits')}`,
        `${indent}pos += 4;`,
      ].join('\n');
    case ProtoScalarType.DOUBLE:
      return [
        `${indent}if (n - pos < 8) throw new globalThis.Error('omnibuf: truncated float64');`,
        `${indent}${emitAssignDecodedField(f, '$ob.readFloat64At(buf, pos)')}`,
        `${indent}pos += 8;`,
      ].join('\n');
    case ProtoScalarType.FIXED64:
      return [
        `${indent}if (n - pos < 8) throw new globalThis.Error('omnibuf: truncated fixed64');`,
        `${indent}let u64 = 0n; for (let b = 7; b >= 0; b--) u64 = (u64 << 8n) | globalThis.BigInt(buf[pos + b]!);`,
        `${indent}${emitAssignDecodedField(f, 'u64 <= 9007199254740991n ? globalThis.Number(u64) : u64')}`,
        `${indent}pos += 8;`,
      ].join('\n');
    case ProtoScalarType.SFIXED64:
      return [
        `${indent}if (n - pos < 8) throw new globalThis.Error('omnibuf: truncated sfixed64');`,
        `${indent}let u64 = 0n; for (let b = 7; b >= 0; b--) u64 = (u64 << 8n) | globalThis.BigInt(buf[pos + b]!);`,
        `${indent}const s64 = globalThis.BigInt.asIntN(64, u64);`,
        `${indent}${emitAssignDecodedField(f, 's64 >= -9007199254740991n && s64 <= 9007199254740991n ? globalThis.Number(s64) : s64')}`,
        `${indent}pos += 8;`,
      ].join('\n');
    case ProtoScalarType.MESSAGE: {
      const sub = f.subMsgSymbol!;
      const existingExpr = f.oneofLocalName
        ? `((out as any).${f.oneofLocalName}?.case === ${JSON.stringify(f.localName)} ? (out as any).${f.oneofLocalName}.value : undefined)`
        : prop;
      const mergeExpr = f.oneofLocalName
        ? 'alreadySeen && existing !== undefined && existing !== null'
        : 'alreadySeen';
      return [
        `${indent}if (pos >= n) throw new globalThis.Error('omnibuf: truncated submsg');`,
        `${indent}let subLen = 0;`,
        `${indent}const lb = buf[pos]!;`,
        `${indent}if ((lb & 1) !== 0) {`,
        `${indent}  subLen = lb >>> 1;`,
        `${indent}  pos += 1;`,
        `${indent}} else if ((lb & 2) !== 0) {`,
        `${indent}  if (pos + 2 > n) throw new globalThis.Error('omnibuf: truncated submsg');`,
        `${indent}  subLen = (lb | (buf[pos + 1]! << 8)) >>> 2;`,
        `${indent}  pos += 2;`,
        `${indent}} else {`,
        `${indent}  const [subBytes, nextPos] = $ob.readLenSlice(buf, pos, 0, n);`,
        `${indent}  const existing = ${existingExpr};`,
        `${indent}  const doMerge = ${mergeExpr};`,
        `${indent}  const decodedSub = decode${sub}(subBytes, doMerge ? (existing ?? undefined) : undefined, depth + 1, doMerge ? { ...options, merge: true } : options);`,
        `${indent}  ${emitAssignDecodedField(f, 'decodedSub')}`,
        `${indent}  pos = nextPos;`,
        `${indent}  break;`,
        `${indent}}`,
        `${indent}if (pos + subLen > n) throw new globalThis.Error('omnibuf: truncated submsg');`,
        `${indent}const existing = ${existingExpr};`,
        `${indent}const doMerge = ${mergeExpr};`,
        `${indent}const decodedSub = decode${sub}(buf, doMerge ? (existing ?? undefined) : undefined, depth + 1, doMerge ? { ...options, merge: true } : options, pos, pos + subLen);`,
        `${indent}${emitAssignDecodedField(f, 'decodedSub')}`,
        `${indent}pos += subLen;`,
      ].join('\n');
    }
    default:
      return '';
  }
}

function wireMaskForField(f: ResolvedField): number {
  switch (f.type) {
    case ProtoScalarType.UINT32:
    case ProtoScalarType.UINT64:
      return 1 << 0;
    case ProtoScalarType.INT32:
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT32:
    case ProtoScalarType.SINT64:
    case ProtoScalarType.ENUM:
      return 1 << 1;
    case ProtoScalarType.BOOL:
      return (1 << 2) | (1 << 3);
    case ProtoScalarType.FIXED32:
      return 1 << 4;
    case ProtoScalarType.FIXED64:
      return 1 << 5;
    case ProtoScalarType.SFIXED32:
      return 1 << 6;
    case ProtoScalarType.SFIXED64:
      return 1 << 7;
    case ProtoScalarType.FLOAT:
      return 1 << 8;
    case ProtoScalarType.DOUBLE:
      return 1 << 9;
    case ProtoScalarType.STRING:
      return 1 << 10;
    case ProtoScalarType.BYTES:
      return 1 << 11;
    case ProtoScalarType.MESSAGE:
      return 1 << 12;
    default:
      return 1 << 0;
  }
}

function emitOpaqueGetterBody(f: ResolvedField, oneof?: ResolvedOneof): string {
  const num = f.number;
  if (f.isMap) {
    const keyKind = schemaTypeString({ type: f.mapKeyType, repeated: false, isMap: false });
    const valKind = schemaTypeString({ type: f.mapValType, repeated: false, isMap: false });
    const subDecoder = f.mapValMsgSymbol
      ? `, (sub) => decode${f.mapValMsgSymbol}(sub, undefined, this._depth + 2)`
      : '';
    return `if (this.${f.storageProp} === undefined) { this.${f.storageProp} = $ob.readTypedMap(this._raw, ${num}, ${JSON.stringify(keyKind)}, ${JSON.stringify(valKind)}${subDecoder})[0]; } return this.${f.storageProp}!;`;
  }
  if (f.repeated) {
    let readExpr: string;
    switch (f.type) {
      case ProtoScalarType.STRING:
        readExpr = `$ob.readStringArr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.BYTES:
        readExpr = `$ob.readBytesArr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.BOOL:
        readExpr = `$ob.readBoolArr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.UINT32:
        readExpr = `$ob.readUint32Arr(__src, ${num})[0] as any`;
        break;
      case ProtoScalarType.ENUM:
        readExpr = `$ob.readEnumArr(__src, ${num})[0] as any`;
        break;
      case ProtoScalarType.UINT64:
        readExpr = `$ob.readUintArr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.SINT32:
      case ProtoScalarType.INT32:
        readExpr = `$ob.readSint32Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.SINT64:
      case ProtoScalarType.INT64:
        readExpr = `$ob.readSintArr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.FLOAT:
        readExpr = `$ob.readFloat32Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.DOUBLE:
        readExpr = `$ob.readFloat64Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.FIXED32:
        readExpr = `$ob.readFixed32Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.SFIXED32:
        readExpr = `$ob.readSfixed32Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.FIXED64:
        readExpr = `$ob.readFixed64Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.SFIXED64:
        readExpr = `$ob.readSfixed64Arr(__src, ${num})[0]`;
        break;
      case ProtoScalarType.MESSAGE:
        readExpr = `$ob.readSubMsgArrDecoded(__src, ${num}, (sub) => decode${f.subMsgSymbol}(sub, undefined, this._depth + 2))[0]`;
        break;
      default:
        readExpr = `[]`;
        break;
    }
    return `if (this.${f.storageProp} === undefined) { const __src = this._sliceField(${num}); this.${f.storageProp} = __src ? ${readExpr} : []; } return this.${f.storageProp}!;`;
  }
  if (f.explicitPresence || f.oneofLocalName) {
    const srcExpr = oneof ? 'slice' : '__src';
    const oneofPreamble = oneof
      ? `const slice = $ob.activeOneofSlice(this._raw, ${num}, [${oneof.fields.map((of) => `[${of.number}, ${wireMaskForField(of)}]`).join(', ')}]); if (!slice) return undefined; `
      : `const __src = this._sliceField(${num}); if (!__src) return undefined; `;
    switch (f.type) {
      case ProtoScalarType.UINT32:
        return `${oneofPreamble}const [v, ok] = $ob.readUint32(${srcExpr}, ${num}); return (ok ? v : undefined) as any;`;
      case ProtoScalarType.ENUM:
        return `${oneofPreamble}const [v, ok] = $ob.readEnum(${srcExpr}, ${num}); return (ok ? v : undefined) as any;`;
      case ProtoScalarType.UINT64:
        return `${oneofPreamble}const [v, ok] = $ob.readUintAuto(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.INT32:
      case ProtoScalarType.SINT32:
        return `${oneofPreamble}const [v, ok] = $ob.readInt32(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.INT64:
      case ProtoScalarType.SINT64:
        return `${oneofPreamble}const [v, ok] = $ob.readIntAuto(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.BOOL:
        return `${oneofPreamble}const [v, ok] = $ob.readBool(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.STRING:
        return `${oneofPreamble}const [v, ok] = $ob.readString(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.BYTES:
        return `${oneofPreamble}const [v, ok] = $ob.readBytes(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.FIXED32:
        return `${oneofPreamble}const [v, ok] = $ob.readFixed32(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.SFIXED32:
        return `${oneofPreamble}const [v, ok] = $ob.readSfixed32(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.FLOAT:
        return `${oneofPreamble}const [v, ok] = $ob.readFloat32(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.FIXED64:
        return `${oneofPreamble}const [v, ok] = $ob.readFixed64Auto(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.SFIXED64:
        return `${oneofPreamble}const [v, ok] = $ob.readSfixed64Auto(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.DOUBLE:
        return `${oneofPreamble}const [v, ok] = $ob.readFloat64(${srcExpr}, ${num}); return ok ? v : undefined;`;
      case ProtoScalarType.MESSAGE:
        return `${oneofPreamble}const [v, ok] = $ob.readSubMsgMerged<${f.subMsgSymbol}>(${srcExpr}, ${num}, (sub, target, merge, s, e) => decode${f.subMsgSymbol}(sub, target, this._depth + 1, merge ? { merge: true } : undefined, s, e)); return ok ? v : undefined;`;
      default:
        return `return undefined as any;`;
    }
  }
  switch (f.type) {
    case ProtoScalarType.UINT32:
      return `const __src = this._sliceField(${num}); return (__src ? $ob.readUint32(__src, ${num})[0] : 0) as any;`;
    case ProtoScalarType.ENUM:
      return `const __src = this._sliceField(${num}); return (__src ? $ob.readEnum(__src, ${num})[0] : 0) as any;`;
    case ProtoScalarType.UINT64:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readUintAuto(__src, ${num})[0] : 0;`;
    case ProtoScalarType.INT32:
    case ProtoScalarType.SINT32:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readInt32(__src, ${num})[0] : 0;`;
    case ProtoScalarType.INT64:
    case ProtoScalarType.SINT64:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readIntAuto(__src, ${num})[0] : 0;`;
    case ProtoScalarType.BOOL:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readBool(__src, ${num})[0] : false;`;
    case ProtoScalarType.STRING:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readString(__src, ${num})[0] : '';`;
    case ProtoScalarType.BYTES:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readBytes(__src, ${num})[0] : new globalThis.Uint8Array(0);`;
    case ProtoScalarType.FIXED32:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readFixed32(__src, ${num})[0] : 0;`;
    case ProtoScalarType.SFIXED32:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readSfixed32(__src, ${num})[0] : 0;`;
    case ProtoScalarType.FLOAT:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readFloat32(__src, ${num})[0] : 0;`;
    case ProtoScalarType.FIXED64:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readFixed64Auto(__src, ${num})[0] : 0;`;
    case ProtoScalarType.SFIXED64:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readSfixed64Auto(__src, ${num})[0] : 0;`;
    case ProtoScalarType.DOUBLE:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readFloat64(__src, ${num})[0] : 0;`;
    case ProtoScalarType.MESSAGE:
      return `if (this.${f.storageProp} === undefined) { const __src = this._sliceField(${num}); this.${f.storageProp} = __src ? $ob.readSubMsgMerged<${f.subMsgSymbol}>(__src, ${num}, (sub, target, merge, s, e) => decode${f.subMsgSymbol}(sub, target, this._depth + 1, merge ? { merge: true } : undefined, s, e))[0] : null; } return this.${f.storageProp};`;
    default:
      return `const __src = this._sliceField(${num}); return __src ? $ob.readUint(__src, ${num})[0] : 0;`;
  }
}

/**
 * Generate a TypeScript module (`*_omnibuf.pb.ts`) for a `FileDescriptorProtoJSON`.
 */
export function generateFileCode(
  file: FileDescriptorProtoJSON,
  allFiles?: FileDescriptorProtoJSON[],
): GeneratedFile {
  const fileName = file.name ?? 'messages.proto';
  const safeFileComment = fileName.replace(/[\r\n]+/g, ' ');
  const isProto2 = file.syntax === 'proto2';
  if ((file.extension?.length ?? 0) > 0) {
    throw new Error(`omnibuf: proto2 extensions are not supported (${safeFileComment})`);
  }
  const pkg = file.package ?? '';
  const registry = buildSymbolRegistry(allFiles ?? [file]);

  // Collect all enums and messages declared in THIS file in declaration order
  const localEnums: EnumSymbolInfo[] = [];
  const localMessages: MessageSymbolInfo[] = [];
  const localExportNames = new Set<string>(['$ob', 'globalThis']);

  const registerMessageExports = (exportName: string): void => {
    localExportNames.add(exportName);
    localExportNames.add(`${exportName}Msg`);
    localExportNames.add(`${exportName}Schema`);
    localExportNames.add(`create${exportName}`);
    localExportNames.add(`encode${exportName}`);
    localExportNames.add(`marshal${exportName}OmniBuf`);
    localExportNames.add(`decode${exportName}`);
    localExportNames.add(`unmarshal${exportName}OmniBuf`);
    localExportNames.add(`Opaque${exportName}`);
  };

  for (const en of file.enumType ?? []) {
    const enName = en.name ?? 'Enum';
    const fullProtoName = pkg ? `${pkg}.${enName}` : enName;
    const info = registry.enums.get(fullProtoName);
    if (info) {
      localEnums.push(info);
      localExportNames.add(info.exportName);
    }
  }

  const collectLocalMessages = (protoPrefix: string, msg: DescriptorProtoJSON): void => {
    const msgName = msg.name ?? 'Message';
    const fullProtoName = protoPrefix ? `${protoPrefix}.${msgName}` : msgName;
    if (msg.options?.mapEntry) return;
    const info = registry.messages.get(fullProtoName);
    if (info) {
      localMessages.push(info);
      registerMessageExports(info.exportName);
    }
    for (const en of msg.enumType ?? []) {
      const enFull = `${fullProtoName}.${en.name ?? 'Enum'}`;
      const enInfo = registry.enums.get(enFull);
      if (enInfo) {
        localEnums.push(enInfo);
        localExportNames.add(enInfo.exportName);
      }
    }
    for (const nested of msg.nestedType ?? []) {
      collectLocalMessages(fullProtoName, nested);
    }
  };

  for (const msg of file.messageType ?? []) {
    collectLocalMessages(pkg, msg);
  }

  // Track external imports by fileProtoName -> Map<originalExport, localAlias>
  const externalImports = new Map<string, Map<string, string>>();

  const hasImportedMessageCollision = (candidate: string): boolean =>
    localExportNames.has(candidate) ||
    localExportNames.has(`${candidate}Schema`) ||
    localExportNames.has(`encode${candidate}`) ||
    localExportNames.has(`decode${candidate}`);

  const ensureImportedSymbol = (
    targetFile: string,
    exportName: string,
    fullProtoName: string,
    isMessage: boolean,
  ): string => {
    if (targetFile === fileName) {
      return exportName;
    }
    let fileImports = externalImports.get(targetFile);
    if (!fileImports) {
      fileImports = new Map<string, string>();
      externalImports.set(targetFile, fileImports);
    }
    const existingAlias = fileImports.get(exportName);
    if (existingAlias) return existingAlias;

    let alias = exportName;
    if (isMessage ? hasImportedMessageCollision(alias) : localExportNames.has(alias)) {
      alias = fullProtoName.replace(/\./g, '_');
    }
    while (isMessage ? hasImportedMessageCollision(alias) : localExportNames.has(alias)) {
      alias = `${alias}$`;
    }
    localExportNames.add(alias);
    fileImports.set(exportName, alias);
    if (isMessage) {
      localExportNames.add(`${alias}Schema`);
      localExportNames.add(`minBytes${alias}`);
      localExportNames.add(`encode${alias}`);
      localExportNames.add(`decode${alias}`);
      localExportNames.add(`Opaque${alias}`);
      fileImports.set(`${exportName}Schema`, `${alias}Schema`);
      fileImports.set(`minBytes${exportName}`, `minBytes${alias}`);
      fileImports.set(`encode${exportName}`, `encode${alias}`);
      fileImports.set(`decode${exportName}`, `decode${alias}`);
      fileImports.set(`Opaque${exportName}`, `Opaque${alias}`);
    }
    return alias;
  };

  const resolveMessageSymbol = (
    rawTypeName: string | undefined,
    enclosingFullProtoName: string,
  ): string => {
    const info = resolveCandidateName(rawTypeName, enclosingFullProtoName, pkg, registry.messages);
    if (!info) {
      const clean = (rawTypeName ?? 'unknown').replace(/^\./, '');
      const parts = clean.split('.');
      return parts[parts.length - 1] || clean;
    }
    return ensureImportedSymbol(info.fileProtoName, info.exportName, info.fullProtoName, true);
  };

  const resolveEnumSymbol = (
    rawTypeName: string | undefined,
    enclosingFullProtoName: string,
  ): string | undefined => {
    const info = resolveCandidateName(rawTypeName, enclosingFullProtoName, pkg, registry.enums);
    if (!info) return undefined;
    return ensureImportedSymbol(info.fileProtoName, info.exportName, info.fullProtoName, false);
  };

  // Pre-resolve fields and oneofs for all local messages so imports are populated first
  const resolvedByMessage = new Map<string, { fields: ResolvedField[]; oneofs: ResolvedOneof[] }>();

  for (const msgInfo of localMessages) {
    const msg = msgInfo.desc;
    const fullProtoName = msgInfo.fullProtoName;
    if ((msg.extension?.length ?? 0) > 0) {
      throw new Error(`omnibuf: proto2 extensions are not supported (${fullProtoName})`);
    }
    const fields: ResolvedField[] = [];
    const oneofsMap = new Map<number, ResolvedOneof>();
    const usedInterfaceProps = new Set<string>([
      '$typeName',
      '$unknown',
      '__proto__',
      'constructor',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      'toString',
      'toJSON',
      'valueOf',
    ]);

    // Pre-allocate real oneof group names first so fields cannot collide with their enclosing oneof property
    for (let idx = 0; idx < (msg.oneofDecl ?? []).length; idx++) {
      const decl = msg.oneofDecl![idx]!;
      const isSyntheticOptional = (msg.field ?? []).some(
        (fld) => fld.oneofIndex === idx && fld.proto3Optional,
      );
      if (isSyntheticOptional || !decl.name) continue;
      const protoName = decl.name;
      let localName = safeObjectProperty(protoCamelCase(protoName));
      while (usedInterfaceProps.has(localName)) {
        localName = `${localName}$`;
      }
      usedInterfaceProps.add(localName);
      oneofsMap.set(idx, {
        index: idx,
        protoName,
        localName,
        emitProtoAlias: false,
        fields: [],
      });
    }

    for (const f of msg.field ?? []) {
      const num = f.number ?? 0;
      const name = f.name ?? `field_${num}`;
      if (!Number.isInteger(num) || num < 1 || num > 536870911) {
        throw new Error(
          `omnibuf: field number ${num} on ${fullProtoName}.${name} out of range (1..536870911)`,
        );
      }
      if (num >= 19000 && num <= 19999) {
        throw new Error(
          `omnibuf: field number ${num} on ${fullProtoName}.${name} is in Protobuf reserved range (19000..19999)`,
        );
      }
      let localName = safeObjectProperty(protoCamelCase(name));
      while (usedInterfaceProps.has(localName)) {
        localName = `${localName}$`;
      }
      usedInterfaceProps.add(localName);

      const type = parseFieldDescriptorType(f.type);
      if (type === ProtoScalarType.GROUP) {
        throw new Error(
          `omnibuf: proto2 groups (TYPE_GROUP) are not supported (${fullProtoName}.${name})`,
        );
      }
      const rep = isRepeated(f.label);

      const mapEntry =
        type === ProtoScalarType.MESSAGE
          ? resolveCandidateName(f.typeName, fullProtoName, pkg, registry.mapEntries)
          : undefined;

      const oneofGroup =
        f.oneofIndex !== undefined && !f.proto3Optional ? oneofsMap.get(f.oneofIndex) : undefined;
      const oneofProtoName = oneofGroup?.protoName;
      const oneofLocalName = oneofGroup?.localName;
      const explicitPresence =
        !oneofLocalName &&
        !rep &&
        type !== ProtoScalarType.MESSAGE &&
        (Boolean(f.proto3Optional) || isProto2);

      let rf: ResolvedField;
      if (type === ProtoScalarType.MESSAGE && mapEntry) {
        rf = {
          number: num,
          name,
          localName,
          emitNameAlias: false,
          pascalName: toPascalCase(name),
          storageProp: '',
          getterName: '',
          setterName: '',
          shorthandMethods: [],
          type,
          repeated: false,
          isMap: true,
          mapKeyType: mapEntry.keyType,
          mapValType: mapEntry.valType,
          mapValMsgSymbol:
            mapEntry.valType === ProtoScalarType.MESSAGE
              ? resolveMessageSymbol(mapEntry.valTypeName, fullProtoName)
              : undefined,
          explicitPresence: false,
        };
      } else {
        rf = {
          number: num,
          name,
          localName,
          emitNameAlias: false,
          pascalName: toPascalCase(name),
          storageProp: '',
          getterName: '',
          setterName: '',
          shorthandMethods: [],
          type,
          repeated: rep,
          isMap: false,
          mapKeyType: ProtoScalarType.STRING,
          mapValType: ProtoScalarType.UINT64,
          subMsgSymbol:
            type === ProtoScalarType.MESSAGE
              ? resolveMessageSymbol(f.typeName, fullProtoName)
              : undefined,
          enumSymbol:
            type === ProtoScalarType.ENUM
              ? resolveEnumSymbol(f.typeName, fullProtoName)
              : undefined,
          oneofLocalName,
          oneofProtoName,
          explicitPresence,
        };
      }

      if (oneofGroup) {
        oneofGroup.fields.push(rf);
      }

      fields.push(rf);
    }

    fields.sort((a, b) => a.number - b.number);

    // Allocate optional snake_case aliases on the interface only if they don't collide
    for (const oneof of oneofsMap.values()) {
      if (oneof.protoName !== oneof.localName && !usedInterfaceProps.has(oneof.protoName)) {
        oneof.emitProtoAlias = true;
        usedInterfaceProps.add(oneof.protoName);
      }
    }
    for (const f of fields) {
      if (f.name !== f.localName && !usedInterfaceProps.has(f.name)) {
        f.emitNameAlias = true;
        usedInterfaceProps.add(f.name);
      }
    }

    // Allocate Opaque<Message> member names (storage, getX/setX, and non-colliding shorthand methods)
    const usedOpaqueMembers = new Set<string>([
      '__proto__',
      'constructor',
      '_raw',
      '_dirtyMask',
      '_dirtySet',
      'raw',
      'marshal',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString',
      'toString',
      'toJSON',
      'valueOf',
    ]);

    for (const f of fields) {
      let storageProp = `_${f.localName}`;
      while (usedOpaqueMembers.has(storageProp)) {
        storageProp = `${storageProp}$`;
      }
      usedOpaqueMembers.add(storageProp);
      f.storageProp = storageProp;

      let getterName = `get${f.pascalName}`;
      let setterName = `set${f.pascalName}`;
      while (usedOpaqueMembers.has(getterName) || usedOpaqueMembers.has(setterName)) {
        getterName = `${getterName}$`;
        setterName = `${setterName}$`;
      }
      usedOpaqueMembers.add(getterName);
      usedOpaqueMembers.add(setterName);
      f.getterName = getterName;
      f.setterName = setterName;
    }

    for (const f of fields) {
      if (!usedOpaqueMembers.has(f.localName)) {
        usedOpaqueMembers.add(f.localName);
        f.shorthandMethods.push(f.localName);
      }
      if (f.name !== f.localName && !usedOpaqueMembers.has(f.name)) {
        usedOpaqueMembers.add(f.name);
        f.shorthandMethods.push(f.name);
      }
    }

    resolvedByMessage.set(msgInfo.exportName, {
      fields,
      oneofs: Array.from(oneofsMap.values()).filter((o) => o.fields.length > 0),
    });
  }

  const lines: string[] = [];
  lines.push('// Code generated by protoc-gen-omnibuf-es. DO NOT EDIT.');
  lines.push(`// source: ${safeFileComment}`);
  lines.push('/* eslint-disable @typescript-eslint/no-unused-vars */');
  lines.push('');
  lines.push("import * as $ob from '@omnibuf/core';");

  for (const [depFile, specMap] of externalImports.entries()) {
    const specs: string[] = [];
    for (const [orig, alias] of specMap.entries()) {
      specs.push(orig === alias ? orig : `${orig} as ${alias}`);
    }
    const importPath = posixRelativeImport(fileName, depFile);
    lines.push(`import { ${specs.join(', ')} } from ${JSON.stringify(importPath)};`);
  }
  lines.push('');

  // Emit Enums
  for (const enInfo of localEnums) {
    lines.push(`export enum ${enInfo.exportName} {`);
    for (const val of enInfo.desc.value ?? []) {
      if (val.name !== undefined && val.number !== undefined) {
        lines.push(`  ${val.name} = ${val.number},`);
      }
    }
    lines.push('}');
    lines.push('');
  }

  // Emit Messages
  for (const msgInfo of localMessages) {
    const msgName = msgInfo.exportName;
    const fullTypeName = msgInfo.fullProtoName;
    const { fields, oneofs } = resolvedByMessage.get(msgName)!;
    const oneofByLocalName = new Map<string, ResolvedOneof>();
    for (const oneof of oneofs) {
      oneofByLocalName.set(oneof.localName, oneof);
    }
    const maxField = fields.reduce((acc, f) => Math.max(acc, f.number), 0);

    // 1. Interface (extending protobuf-es Message<FullTypeName>)
    lines.push(
      `export interface ${msgName} extends $ob.Message<${JSON.stringify(fullTypeName)}> {`,
    );
    for (const oneof of oneofs) {
      const variants = oneof.fields.map(
        (f) =>
          `{ case: ${JSON.stringify(f.localName)}; value: ${tsTypeForField({ ...f, oneofLocalName: undefined, explicitPresence: false }).replace(' | null', '')} }`,
      );
      variants.push('{ case: undefined; value?: undefined }');
      lines.push(`  ${oneof.localName}: ${variants.join(' | ')};`);
      if (oneof.emitProtoAlias) {
        lines.push(`  ${oneof.protoName}?: ${variants.join(' | ')};`);
      }
    }
    for (const f of fields) {
      if (f.oneofLocalName) {
        lines.push(`  ${f.localName}?: ${tsTypeForField(f)};`);
        if (f.emitNameAlias) {
          lines.push(`  ${f.name}?: ${tsTypeForField(f)};`);
        }
      } else {
        const optMod = f.explicitPresence ? '?' : '';
        lines.push(`  ${f.localName}${optMod}: ${tsTypeForField(f)};`);
        if (f.emitNameAlias) {
          lines.push(`  ${f.name}?: ${tsTypeForField(f)};`);
        }
      }
    }
    lines.push('}');
    lines.push('');

    // 2. Compiled MessageSchema
    lines.push(
      `export const ${msgName}Schema: $ob.MessageSchema<${msgName}, ${JSON.stringify(fullTypeName)}> = $ob.defineMessage<${msgName}, ${JSON.stringify(fullTypeName)}>(`,
    );
    lines.push(`  ${JSON.stringify(fullTypeName)},`);
    lines.push('  {');
    for (const f of fields) {
      const st = schemaTypeString(f);
      const nameProp = f.localName !== f.name ? `, name: ${JSON.stringify(f.name)}` : '';
      const oneofProp = f.oneofLocalName
        ? `, oneof: ${JSON.stringify(f.oneofLocalName)}, oneofProtoName: ${JSON.stringify(f.oneofProtoName)}`
        : '';
      const presenceProp = f.explicitPresence ? ', explicitPresence: true' : '';
      if (f.isMap) {
        const key = schemaTypeString({ type: f.mapKeyType, repeated: false, isMap: false });
        const value = schemaTypeString({ type: f.mapValType, repeated: false, isMap: false });
        const sub = f.mapValMsgSymbol ? `, subSchema: () => ${f.mapValMsgSymbol}Schema` : '';
        lines.push(
          `    ${f.localName}: { fieldNum: ${f.number}${nameProp}, type: 'map', mapKey: '${key}', mapVal: '${value}'${sub} },`,
        );
      } else if (f.subMsgSymbol) {
        lines.push(
          `    ${f.localName}: { fieldNum: ${f.number}${nameProp}${oneofProp}${presenceProp}, type: '${st}', subSchema: () => ${f.subMsgSymbol}Schema },`,
        );
      } else {
        lines.push(
          `    ${f.localName}: { fieldNum: ${f.number}${nameProp}${oneofProp}${presenceProp}, type: '${st}' },`,
        );
      }
    }
    lines.push('  }');
    lines.push(');');
    lines.push('');

    // 2b. Hidden-Class Message Implementation
    lines.push(`class ${msgName}Msg implements ${msgName} {`);
    lines.push(`  declare $typeName: ${JSON.stringify(fullTypeName)};`);
    for (const oneof of oneofs) {
      const variants = oneof.fields.map(
        (f) =>
          `{ case: ${JSON.stringify(f.localName)}; value: ${tsTypeForField({ ...f, oneofLocalName: undefined, explicitPresence: false }).replace(' | null', '')} }`,
      );
      variants.push('{ case: undefined; value?: undefined }');
      const unionTs = variants.join(' | ');
      lines.push(`  ${oneof.localName}: ${unionTs} = { case: undefined };`);
      if (oneof.emitProtoAlias) {
        lines.push(`  get ${oneof.protoName}(): ${unionTs} { return this.${oneof.localName}; }`);
        lines.push(
          `  set ${oneof.protoName}(v: ${unionTs} | undefined) { this.${oneof.localName} = v ?? { case: undefined }; }`,
        );
      }
    }
    for (const f of fields) {
      if (f.oneofLocalName) {
        const caseCheck =
          f.name !== f.localName
            ? `g?.case === ${JSON.stringify(f.localName)} || g?.case === ${JSON.stringify(f.name)}`
            : `g?.case === ${JSON.stringify(f.localName)}`;
        lines.push(
          `  get ${f.localName}(): ${tsTypeForField(f)} { const g = this.${f.oneofLocalName} as any; return (${caseCheck}) ? g.value : undefined; }`,
        );
        lines.push(
          `  set ${f.localName}(v: ${tsTypeForField(f)}) { if (v === undefined || v === null) { const g = this.${f.oneofLocalName} as any; if (${caseCheck}) this.${f.oneofLocalName} = { case: undefined }; } else { this.${f.oneofLocalName} = { case: ${JSON.stringify(f.localName)}, value: v as any }; } }`,
        );
        if (f.emitNameAlias) {
          lines.push(`  get ${f.name}(): ${tsTypeForField(f)} { return this.${f.localName}; }`);
          lines.push(`  set ${f.name}(v: ${tsTypeForField(f)}) { this.${f.localName} = v; }`);
        }
      } else {
        lines.push(`  ${f.localName}: ${tsTypeForField(f)} = ${defaultValueExprForField(f)};`);
        if (f.emitNameAlias) {
          lines.push(`  get ${f.name}(): ${tsTypeForField(f)} { return this.${f.localName}; }`);
          lines.push(
            `  set ${f.name}(v: ${tsTypeForField(f)} | undefined) { this.${f.localName} = v as any; }`,
          );
        }
      }
    }
    lines.push('}');
    lines.push(
      `globalThis.Object.defineProperty(${msgName}Msg.prototype, '$typeName', { value: ${JSON.stringify(fullTypeName)}, enumerable: false, writable: true, configurable: true });`,
    );
    lines.push('');

    // 3. Factory
    lines.push(
      `export function create${msgName}(init?: $ob.MessageInitShape<typeof ${msgName}Schema>): ${msgName} {`,
    );
    lines.push(`  if (init === undefined) return new ${msgName}Msg();`);
    lines.push(`  return ${msgName}Schema.create(init);`);
    lines.push('}');
    lines.push('');

    // 4. Single-pass Encoder & fast >16 KiB container size estimator
    lines.push(`export function minBytes${msgName}(msg: Partial<${msgName}>): number {`);
    lines.push(`  let sz = ${fields.length * 2};`);
    for (const f of fields) {
      if (f.isMap || f.repeated || f.oneofLocalName) continue;
      if (f.type === ProtoScalarType.STRING) {
        const val = emitFieldValueAccess(f, 'msg');
        lines.push(`  { const s = ${val}; if (typeof s === 'string') sz += s.length; }`);
      } else if (f.type === ProtoScalarType.BYTES) {
        const val = emitFieldValueAccess(f, 'msg');
        lines.push(`  { const b = ${val}; if (b !== null && b !== undefined) sz += b.length; }`);
      }
    }
    lines.push('  return sz;');
    lines.push('}');
    lines.push('');
    lines.push(
      `export function encode${msgName}(enc: $ob.Encoder, msg: Partial<${msgName}>, options?: $ob.MarshalOptions): void {`,
    );
    for (const f of fields) {
      lines.push(emitEncodeField(f, 'msg', '  '));
    }
    lines.push(
      '  if (options?.writeUnknownFields && globalThis.Array.isArray((msg as any).$unknown)) {',
    );
    lines.push('    for (const uf of (msg as any).$unknown as $ob.UnknownField[]) {');
    lines.push('      enc.writeTag(uf.no, uf.wireType);');
    lines.push('      enc.writeRaw(uf.data);');
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
    lines.push('');

    lines.push(
      `export function marshal${msgName}OmniBuf(msg: Partial<${msgName}>, options?: $ob.MarshalOptions): globalThis.Uint8Array {`,
    );
    lines.push(`  if (options?.selfDescribing && ${msgName}Schema.isCyclicOrDeep()) {`);
    lines.push(`    return ${msgName}Schema.encode(msg as ${msgName}, options);`);
    lines.push('  }');
    lines.push('  const enc = new $ob.Encoder(256);');
    lines.push('  if (options?.selfDescribing) {');
    lines.push(
      `    $ob.writeField0SchemaMeta(enc, ${msgName}Schema.getSchemaMeta(0, msg as { [key: string]: any }), globalThis.Boolean(options.deterministic));`,
    );
    lines.push('  }');
    lines.push(`  encode${msgName}(enc, msg, options);`);
    lines.push('  return enc.finish();');
    lines.push('}');
    lines.push('');

    // 5. Reflection-Free Specialized Decoder
    const use32Mask = maxField <= 30;
    const seenTrackedFields = fields.filter(
      (f) => f.repeated || f.isMap || f.type === ProtoScalarType.MESSAGE,
    );
    const needsSeenTracking = seenTrackedFields.length > 0;
    const needsSeenSet = seenTrackedFields.some((f) => f.number > 30);
    lines.push(
      `export function decode${msgName}(buf: globalThis.Uint8Array, target?: ${msgName}, depth = 0, options?: $ob.BinaryReadOptions, startPos = 0, endPos = buf.length): ${msgName} {`,
    );
    lines.push('  const maxDepth = options?.recursionLimit ?? $ob.MaxNestingDepth;');
    lines.push('  const readUnknown = options?.readUnknownFields ?? true;');
    lines.push('  if (depth > maxDepth) {');
    lines.push(
      '    throw new globalThis.Error(`omnibuf: nesting depth ${depth} exceeds MaxNestingDepth (${maxDepth})`);',
    );
    lines.push('  }');
    lines.push(`  const out: ${msgName} = target ?? new ${msgName}Msg();`);
    lines.push('  if (target !== undefined) {');
    lines.push(`    if (!(out instanceof ${msgName}Msg)) {`);
    lines.push(`      globalThis.Object.setPrototypeOf(out, ${msgName}Msg.prototype);`);
    lines.push('    }');
    lines.push('    if (!options?.merge) {');
    for (const oneof of oneofs) {
      for (const ofld of oneof.fields) {
        lines.push(
          `      if (globalThis.Object.hasOwn(out, ${JSON.stringify(ofld.localName)})) delete (out as any).${ofld.localName};`,
        );
        if (ofld.emitNameAlias) {
          lines.push(
            `      if (globalThis.Object.hasOwn(out, ${JSON.stringify(ofld.name)})) delete (out as any).${ofld.name};`,
          );
        }
      }
    }
    for (const f of fields) {
      if (!f.oneofLocalName && f.emitNameAlias) {
        lines.push(
          `      if (globalThis.Object.hasOwn(out, ${JSON.stringify(f.name)})) delete (out as any).${f.name};`,
        );
      }
    }
    lines.push(`      globalThis.Object.assign(out, new ${msgName}Msg());`);
    lines.push(
      "      if (globalThis.Object.hasOwn(out, '$unknown')) delete (out as any).$unknown;",
    );
    lines.push('    }');
    lines.push('  }');
    lines.push('  const n = endPos;');
    lines.push('  let pos = startPos;');
    if (needsSeenTracking) {
      lines.push('  const isMerge = options?.merge === true;');
      lines.push('  let seenMask = 0;');
      if (needsSeenSet) {
        lines.push('  let seenSet: globalThis.Set<number> | null = null;');
      }
    }
    lines.push(
      '  let unknownFields: $ob.UnknownField[] | null = target !== undefined && globalThis.Array.isArray((out as any).$unknown) ? (out as any).$unknown : null;',
    );
    lines.push('  while (pos < n) {');
    lines.push('    let tag = 0;');
    lines.push('    const b0 = buf[pos]!;');
    lines.push('    if ((b0 & 1) !== 0) {');
    lines.push('      tag = b0 >>> 1;');
    lines.push('      pos += 1;');
    lines.push('    } else if ((b0 & 2) !== 0) {');
    lines.push("      if (pos + 2 > n) throw new globalThis.Error('omnibuf: truncated tag');");
    lines.push('      tag = ((b0 | (buf[pos + 1]! << 8)) >>> 2) >>> 0;');
    lines.push('      pos += 2;');
    lines.push('    } else {');
    lines.push('      const [t64, tn] = $ob.decodeVarintBigInt(buf, pos, n);');
    lines.push(
      "      if (tn === 0 || t64 >> 4n > 536870911n) throw new globalThis.Error('omnibuf: invalid tag');",
    );
    lines.push('      tag = globalThis.Number(t64);');
    lines.push('      pos += tn;');
    lines.push('    }');
    lines.push('    switch (tag) {');
    lines.push('      case 12: {');
    lines.push('        const nextPos = $ob.validateField0At(buf, pos, 12, depth, maxDepth, n);');
    lines.push("        if (nextPos < 0) throw new globalThis.Error('omnibuf: invalid Field #0');");
    lines.push('        pos = nextPos;');
    lines.push('        break;');
    lines.push('      }');
    for (const f of fields) {
      if (!f.isMap && !f.repeated && f.type === ProtoScalarType.BOOL) {
        lines.push(`      case ${f.number * 16 + 2}: {`);
        lines.push(`        ${emitAssignDecodedField(f, 'false')}`);
        lines.push('        break;');
        lines.push('      }');
        lines.push(`      case ${f.number * 16 + 3}: {`);
        lines.push(`        ${emitAssignDecodedField(f, 'true')}`);
        lines.push('        break;');
        lines.push('      }');
        continue;
      }
      const tagVal = f.number * 16 + expectedWireTypeNum(f);
      lines.push(`      case ${tagVal}: {`);
      if (f.repeated || f.isMap || f.type === ProtoScalarType.MESSAGE) {
        if (f.number <= 30) {
          const bitLit = 1 << f.number;
          lines.push(`        const alreadySeen = isMerge || (seenMask & ${bitLit}) !== 0;`);
          lines.push(`        seenMask |= ${bitLit};`);
        } else {
          lines.push(
            `        const alreadySeen = isMerge || (seenSet !== null && seenSet.has(${f.number}));`,
          );
          lines.push('        if (!seenSet) seenSet = new globalThis.Set<number>();');
          lines.push(`        seenSet.add(${f.number});`);
        }
      }
      lines.push(emitDecodeFieldCaseBody(f, '        '));
      lines.push('        break;');
      lines.push('      }');
    }
    lines.push('      default: {');
    lines.push(
      '        const fieldNum = tag <= 0x7fffffff ? tag >>> 4 : globalThis.Math.floor(tag / 16);',
    );
    lines.push('        const wt = tag & 0x0f;');
    lines.push(
      "        if (fieldNum === 0) throw new globalThis.Error('omnibuf: invalid Field #0');",
    );
    lines.push('        const valStart = pos;');
    lines.push(
      '        pos = $ob.validateValue(n < buf.length ? buf.subarray(0, n) : buf, pos, wt, depth, maxDepth);',
    );
    lines.push('        if (readUnknown) {');
    lines.push('          if (!unknownFields) unknownFields = [];');
    lines.push(
      '          unknownFields.push({ no: fieldNum, wireType: wt, data: buf.subarray(valStart, pos).slice() });',
    );
    lines.push('        }');
    lines.push('        break;');
    lines.push('      }');
    lines.push('    }');
    lines.push('  }');
    lines.push(
      "  if (unknownFields !== null && unknownFields.length > 0 && !('$unknown' in out)) {",
    );
    lines.push(
      "    globalThis.Object.defineProperty(out, '$unknown', { value: unknownFields, enumerable: false, writable: true, configurable: true });",
    );
    lines.push('  }');
    lines.push('  return out;');
    lines.push('}');
    lines.push('');

    lines.push(
      `export function unmarshal${msgName}OmniBuf(buf: globalThis.Uint8Array, options?: $ob.BinaryReadOptions): ${msgName} {`,
    );
    lines.push(`  return decode${msgName}(buf, undefined, 0, options);`);
    lines.push('}');
    lines.push('');
    lines.push(`${msgName}Schema.setGeneratedCodec({`);
    lines.push(`  create: () => new ${msgName}Msg(),`);
    lines.push(`  encode: encode${msgName},`);
    lines.push(`  decode: decode${msgName},`);
    lines.push('});');
    lines.push(
      `$ob.registerClassSchema(${msgName}Msg as unknown as new () => ${msgName}, ${msgName}Schema);`,
    );
    lines.push('');

    // 6. Lazy Opaque<Message> View with once-per-packet field index, dirty bitmask/Set & spliceFields
    const opaqueMethodNames = new Set<string>([
      'raw',
      'marshal',
      'marshalValidated',
      'tryMarshal',
      '_sliceField',
    ]);
    for (const f of fields) {
      opaqueMethodNames.add(f.getterName);
      opaqueMethodNames.add(f.setterName);
      for (const sh of f.shorthandMethods) opaqueMethodNames.add(sh);
    }
    const nestedOpaqueFields = fields.filter(
      (f) => !f.repeated && !f.isMap && f.type === ProtoScalarType.MESSAGE && f.subMsgSymbol,
    );

    lines.push(`export class Opaque${msgName} {`);
    lines.push('  private _raw: globalThis.Uint8Array;');
    lines.push('  private _depth: number;');
    lines.push('  private _readCount = 0;');
    lines.push('  private _fieldIndex: globalThis.Map<number, $ob.OpaqueFieldSpan> | null = null;');
    if (use32Mask) {
      lines.push('  private _dirtyMask = 0;');
    } else {
      lines.push('  private _dirtySet: globalThis.Set<number> | null = null;');
    }
    for (const f of fields) {
      lines.push(`  private ${f.storageProp}?: ${tsTypeForField(f)};`);
    }
    for (const f of nestedOpaqueFields) {
      lines.push(`  private _opaque_${f.localName}?: Opaque${f.subMsgSymbol} | null;`);
    }
    lines.push('');
    lines.push('  constructor(raw: globalThis.Uint8Array, depth = 0) {');
    lines.push('    this._raw = raw;');
    lines.push('    this._depth = depth;');
    lines.push('  }');
    lines.push('');
    lines.push('  private _sliceField(fieldNum: number): globalThis.Uint8Array | null {');
    lines.push('    if (this._fieldIndex === null) {');
    lines.push('      if (this._readCount < 2) {');
    lines.push('        this._readCount++;');
    lines.push('        return this._raw;');
    lines.push('      }');
    lines.push('      this._fieldIndex = $ob.indexTopLevelFields(this._raw, this._depth);');
    lines.push('    }');
    lines.push('    return $ob.sliceIndexedField(this._raw, this._fieldIndex, fieldNum);');
    lines.push('  }');
    lines.push('');
    lines.push('  raw(): globalThis.Uint8Array {');
    lines.push('    return this._raw;');
    lines.push('  }');
    lines.push('');

    for (const f of fields) {
      const oneofGroup = f.oneofLocalName ? oneofByLocalName.get(f.oneofLocalName) : undefined;

      lines.push(`  ${f.getterName}(): ${tsTypeForField(f)} {`);
      if (use32Mask) {
        lines.push(`    if ((this._dirtyMask & (1 << ${f.number})) !== 0) {`);
      } else {
        lines.push(`    if (this._dirtySet !== null && this._dirtySet.has(${f.number})) {`);
      }
      lines.push(`      return this.${f.storageProp}!;`);
      lines.push('    }');
      lines.push(`    ${emitOpaqueGetterBody(f, oneofGroup)}`);
      lines.push('  }');
      lines.push('');

      // Zero-copy subarray view helper for bytes / bytes[] fields
      if (!f.isMap && f.type === ProtoScalarType.BYTES) {
        const viewName = `${f.getterName}View`;
        if (!opaqueMethodNames.has(viewName)) {
          opaqueMethodNames.add(viewName);
          if (f.repeated) {
            lines.push(`  ${viewName}(): globalThis.Uint8Array[] {`);
            if (use32Mask) {
              lines.push(`    if ((this._dirtyMask & (1 << ${f.number})) !== 0) {`);
            } else {
              lines.push(`    if (this._dirtySet !== null && this._dirtySet.has(${f.number})) {`);
            }
            lines.push(`      return this.${f.storageProp} ?? [];`);
            lines.push('    }');
            lines.push(`    const __src = this._sliceField(${f.number});`);
            lines.push(`    return __src ? $ob.readBytesArrView(__src, ${f.number})[0] : [];`);
            lines.push('  }');
            lines.push('');
          } else if (f.explicitPresence || f.oneofLocalName) {
            lines.push(`  ${viewName}(): globalThis.Uint8Array | undefined {`);
            if (use32Mask) {
              lines.push(`    if ((this._dirtyMask & (1 << ${f.number})) !== 0) {`);
            } else {
              lines.push(`    if (this._dirtySet !== null && this._dirtySet.has(${f.number})) {`);
            }
            lines.push(`      return this.${f.storageProp};`);
            lines.push('    }');
            if (oneofGroup) {
              lines.push(
                `    const slice = $ob.activeOneofSlice(this._raw, ${f.number}, [${oneofGroup.fields.map((of) => `[${of.number}, ${wireMaskForField(of)}]`).join(', ')}]); if (!slice) return undefined;`,
              );
              lines.push(
                `    const [v, ok] = $ob.readBytesView(slice, ${f.number}); return ok ? v : undefined;`,
              );
            } else {
              lines.push(
                `    const __src = this._sliceField(${f.number}); if (!__src) return undefined;`,
              );
              lines.push(
                `    const [v, ok] = $ob.readBytesView(__src, ${f.number}); return ok ? v : undefined;`,
              );
            }
            lines.push('  }');
            lines.push('');
          } else {
            lines.push(`  ${viewName}(): globalThis.Uint8Array {`);
            if (use32Mask) {
              lines.push(`    if ((this._dirtyMask & (1 << ${f.number})) !== 0) {`);
            } else {
              lines.push(`    if (this._dirtySet !== null && this._dirtySet.has(${f.number})) {`);
            }
            lines.push(`      return this.${f.storageProp}!;`);
            lines.push('    }');
            lines.push(`    const __src = this._sliceField(${f.number});`);
            lines.push(
              `    return __src ? $ob.readBytesView(__src, ${f.number})[0] : new globalThis.Uint8Array(0);`,
            );
            lines.push('  }');
            lines.push('');
          }
        }
      }

      // Lazy nested Opaque caching helper for singular sub-message fields
      if (!f.repeated && !f.isMap && f.type === ProtoScalarType.MESSAGE && f.subMsgSymbol) {
        const opaqueGetterName = `get${f.pascalName}Opaque`;
        if (!opaqueMethodNames.has(opaqueGetterName)) {
          opaqueMethodNames.add(opaqueGetterName);
          lines.push(`  ${opaqueGetterName}(): Opaque${f.subMsgSymbol} | undefined {`);
          lines.push(`    if (this._depth + 1 > $ob.MaxNestingDepth) {`);
          lines.push(
            '      throw new globalThis.Error(`omnibuf: nesting depth ${this._depth + 1} exceeds MaxNestingDepth (${$ob.MaxNestingDepth})`);',
          );
          lines.push('    }');
          lines.push(`    if (this._opaque_${f.localName} !== undefined) {`);
          lines.push(`      return this._opaque_${f.localName} ?? undefined;`);
          lines.push('    }');
          if (oneofGroup) {
            lines.push(
              `    const __src = $ob.activeOneofSlice(this._raw, ${f.number}, [${oneofGroup.fields.map((of) => `[${of.number}, ${wireMaskForField(of)}]`).join(', ')}]);`,
            );
          } else {
            lines.push(`    const __src = this._sliceField(${f.number});`);
          }
          lines.push('    if (!__src) {');
          lines.push(`      this._opaque_${f.localName} = null;`);
          lines.push('      return undefined;');
          lines.push('    }');
          lines.push(`    const [sub, ok] = $ob.readSubMsg(__src, ${f.number});`);
          lines.push('    if (!ok) {');
          lines.push(`      this._opaque_${f.localName} = null;`);
          lines.push('      return undefined;');
          lines.push('    }');
          lines.push(`    const nested = new Opaque${f.subMsgSymbol}(sub, this._depth + 1);`);
          lines.push(`    this._opaque_${f.localName} = nested;`);
          lines.push('    return nested;');
          lines.push('  }');
          lines.push('');
        }
      }

      for (const shorthand of f.shorthandMethods) {
        lines.push(`  ${shorthand}(): ${tsTypeForField(f)} {`);
        lines.push(`    return this.${f.getterName}();`);
        lines.push('  }');
        lines.push('');
      }

      lines.push(`  ${f.setterName}(val: ${tsTypeForField(f)}): void {`);
      if (oneofGroup) {
        lines.push(`    if (val == null && this.${f.getterName}() == null) return;`);
        for (const ofld of oneofGroup.fields) {
          if (ofld.number !== f.number) {
            lines.push(`    this.${ofld.storageProp} = undefined;`);
            if (
              !ofld.repeated &&
              !ofld.isMap &&
              ofld.type === ProtoScalarType.MESSAGE &&
              ofld.subMsgSymbol
            ) {
              lines.push(`    this._opaque_${ofld.localName} = undefined;`);
            }
          }
        }
      }
      lines.push(`    this.${f.storageProp} = val;`);
      if (!f.repeated && !f.isMap && f.type === ProtoScalarType.MESSAGE && f.subMsgSymbol) {
        lines.push(`    this._opaque_${f.localName} = undefined;`);
      }
      if (use32Mask) {
        const dirtyMaskExpr = oneofGroup
          ? oneofGroup.fields.map((of) => `(1 << ${of.number})`).join(' | ')
          : `1 << ${f.number}`;
        lines.push(`    this._dirtyMask |= (${dirtyMaskExpr});`);
      } else {
        lines.push('    if (!this._dirtySet) this._dirtySet = new globalThis.Set<number>();');
        if (oneofGroup) {
          for (const ofld of oneofGroup.fields) {
            lines.push(`    this._dirtySet.add(${ofld.number});`);
          }
        } else {
          lines.push(`    this._dirtySet.add(${f.number});`);
        }
      }
      lines.push('  }');
      lines.push('');
    }

    lines.push('  marshal(options?: $ob.MarshalOptions): globalThis.Uint8Array {');
    lines.push('    let outBuf: globalThis.Uint8Array;');
    if (use32Mask) {
      lines.push('    if (this._dirtyMask !== 0) {');
      lines.push(
        `      outBuf = $ob.spliceFields(this._raw, this._dirtyMask, ${maxField}, (enc, fnum) => {`,
      );
    } else {
      lines.push('    if (this._dirtySet !== null && this._dirtySet.size > 0) {');
      lines.push(
        `      outBuf = $ob.spliceFields(this._raw, this._dirtySet, ${maxField}, (enc, fnum) => {`,
      );
    }
    lines.push('        switch (fnum) {');
    for (const f of fields) {
      lines.push(`          case ${f.number}: {`);
      lines.push(
        `            const msg = { ${f.localName}: this.${f.storageProp}! } as Partial<${msgName}>;`,
      );
      lines.push(emitEncodeField(f, 'msg', '            '));
      lines.push('            break;');
      lines.push('          }');
    }
    lines.push('        }');
    lines.push('      }, undefined, this._depth);');
    lines.push('    } else {');
    lines.push('      $ob.validateMessage(this._raw, this._depth);');
    lines.push('      outBuf = this._raw.slice();');
    lines.push('    }');
    lines.push('    if (options?.selfDescribing && !$ob.readField0SchemaMeta(outBuf)[1]) {');
    lines.push(
      `      const f0 = $ob.encodeField0SchemaMeta(${msgName}Schema.getSchemaMeta(0), globalThis.Boolean(options.deterministic));`,
    );
    lines.push('      const withF0 = new globalThis.Uint8Array(f0.length + outBuf.length);');
    lines.push('      withF0.set(f0, 0);');
    lines.push('      withF0.set(outBuf, f0.length);');
    lines.push('      return withF0;');
    lines.push('    }');
    lines.push('    return outBuf;');
    lines.push('  }');
    lines.push('');
    lines.push('  marshalValidated(options?: $ob.MarshalOptions): globalThis.Uint8Array {');
    lines.push('    const out = this.marshal(options);');
    lines.push('    $ob.validateMessage(out, this._depth);');
    lines.push('    return out;');
    lines.push('  }');
    lines.push('');
    lines.push(
      '  tryMarshal(options?: $ob.MarshalOptions): { ok: true; value: globalThis.Uint8Array } | { ok: false; error: globalThis.Error } {',
    );
    lines.push('    try {');
    lines.push('      return { ok: true, value: this.marshalValidated(options) };');
    lines.push('    } catch (err) {');
    lines.push(
      '      return { ok: false, error: err instanceof globalThis.Error ? err : new globalThis.Error(globalThis.String(err)) };',
    );
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
    lines.push('');
  }

  const baseName = fileName.replace(/\.proto$/, '');
  return {
    name: `${baseName}_omnibuf.pb.ts`,
    content: lines.join('\n'),
  };
}

/**
 * Generate TypeScript files for all files in a `FileDescriptorSetJSON`.
 */
export function generateFromDescriptorSet(fds: FileDescriptorSetJSON): GeneratedFile[] {
  const allFiles = fds.file ?? [];
  const out: GeneratedFile[] = [];
  for (const file of allFiles) {
    out.push(generateFileCode(file, allFiles));
  }
  return out;
}
