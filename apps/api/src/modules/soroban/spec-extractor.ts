import * as StellarSdk from 'stellar-sdk';

export interface NormalizedAbi {
  contractId?: string;
  functions: Array<{
    name: string;
    inputs: Array<{ name: string; type: string }>;
    outputs: string[];
  }>;
  structs: Record<string, Array<{ name: string; type: string }>>;
  unions: Record<string, Array<{ name: string; types: string[] }>>;
  enums: Record<string, Array<{ name: string; value: number }>>;
  errors: Record<string, Array<{ name: string; value: number }>>;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  return value == null ? '' : String(value);
}

function typeName(type: any): string {
  if (!type) return 'unknown';
  if (typeof type.name === 'function') return type.name();
  if (typeof type.switch === 'function') {
    const name = type.switch().name;
    if (name) return name.replace(/^scSpecType/i, '').toLowerCase();
  }
  return String(type.switch?.() ?? 'unknown');
}

export class ContractSpecExtractor {
  public extractCustomSections(wasmBytes: Uint8Array | Buffer): Array<{ name: string; data: Buffer }> {
    const buf = Buffer.isBuffer(wasmBytes) ? wasmBytes : Buffer.from(wasmBytes);
    if (buf.length < 8 || buf.subarray(0, 4).toString('hex') !== '0061736d') return [];

    const sections: Array<{ name: string; data: Buffer }> = [];
    let offset = 8;
    while (offset < buf.length) {
      const sectionId = buf[offset++];
      const size = this.readLeb128(buf, offset);
      offset = size.offset;
      const end = offset + size.value;
      if (end > buf.length) break;

      if (sectionId === 0) {
        let pos = offset;
        const nameLen = this.readLeb128(buf, pos);
        pos = nameLen.offset;
        const name = buf.subarray(pos, pos + nameLen.value).toString('utf8');
        pos += nameLen.value;
        sections.push({ name, data: buf.subarray(pos, end) });
      }
      offset = end;
    }
    return sections;
  }

  private readLeb128(buf: Buffer, offset: number): { value: number; offset: number } {
    let value = 0;
    let shift = 0;
    while (offset < buf.length && shift < 35) {
      const byte = buf[offset++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return { value: value >>> 0, offset };
  }

  public extractEntries(wasmBytes: Uint8Array | Buffer): any[] {
    const section = this.extractCustomSections(wasmBytes).find((s) => s.name === 'contractspecv0');
    if (!section) return [];

    const entries: any[] = [];
    let offset = 0;
    // SCSpec payloads are XDR arrays: a 4-byte big-endian entry count,
    // followed by the XDR-encoded entries themselves.
    if (section.data.length >= 4) {
      const count = section.data.readUInt32BE(0);
      if (count <= 10000 && count * 4 <= section.data.length) offset = 4;
      for (let i = 0; i < count && offset < section.data.length; i++) {
        try {
          const entry = StellarSdk.xdr.ScSpecEntry.fromXDR(section.data.subarray(offset));
          entries.push(entry);
          const encoded = entry.toXDR();
          if (!encoded.length || encoded.length + offset > section.data.length) break;
          offset += encoded.length;
        } catch {
          break;
        }
      }
    }
    if (entries.length === 0) {
      try {
        entries.push(StellarSdk.xdr.ScSpecEntry.fromXDR(section.data));
      } catch {}
    }
    return entries;
  }

  public normalize(entries: any[], contractId?: string): NormalizedAbi {
    const abi: NormalizedAbi = { contractId, functions: [], structs: {}, unions: {}, enums: {}, errors: {} };
    for (const entry of entries) {
      const kind = entry.switch?.().name;
      if (kind === 'scSpecEntryFunctionV0') {
        const fn = entry.functionV0();
        abi.functions.push({
          name: text(fn.name()),
          inputs: (fn.inputs() ?? []).map((input: any) => ({ name: text(input.name()), type: typeName(input.type()) })),
          outputs: (fn.outputs() ?? []).map(typeName),
        });
      } else if (kind === 'scSpecEntryUdtStructV0') {
        const value = entry.scSpecEntryUdtStructV0();
        abi.structs[text(value.name())] = (value.fields() ?? []).map((field: any) => ({
          name: text(field.name()), type: typeName(field.type()),
        }));
      } else if (kind === 'scSpecEntryUdtEnumV0') {
        const value = entry.scSpecEntryUdtEnumV0();
        abi.enums[text(value.name())] = (value.cases() ?? []).map((item: any) => ({
          name: text(item.name()), value: Number(item.value()),
        }));
      } else if (kind === 'scSpecEntryUdtErrorEnumV0') {
        const value = entry.scSpecEntryUdtErrorEnumV0();
        abi.errors[text(value.name())] = (value.cases() ?? []).map((item: any) => ({
          name: text(item.name()), value: Number(item.value()),
        }));
      } else if (kind === 'scSpecEntryUdtUnionV0') {
        const value = entry.scSpecEntryUdtUnionV0();
        abi.unions[text(value.name())] = (value.cases() ?? []).map((item: any) => ({
          name: text(item.name()), types: (item.type() ?? []).map(typeName),
        }));
      }
    }
    return abi;
  }
}
