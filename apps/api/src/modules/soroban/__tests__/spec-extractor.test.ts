import { describe, expect, it } from 'vitest';
import * as StellarSdk from 'stellar-sdk';
import { ContractSpecExtractor } from '../spec-extractor';

describe('ContractSpecExtractor', () => {
  it('extracts contractspecv0 custom section and normalizes a function ABI', () => {
    const type = new StellarSdk.xdr.ScSpecTypeDef.scSpecTypeU32();
    const input = new StellarSdk.xdr.ScSpecFunctionInputV0({ doc: '', name: 'amount', type });
    const functionV0 = new StellarSdk.xdr.ScSpecFunctionV0({
      doc: '',
      name: 'swap',
      inputs: [input],
      outputs: [type],
    });
    const entry = StellarSdk.xdr.ScSpecEntry.scSpecEntryFunctionV0(functionV0);

    const payload = Buffer.concat([
      Buffer.from([0, 0, 0, 1]),
      entry.toXDR(),
    ]);
    const name = Buffer.from('contractspecv0');
    const customSection = Buffer.concat([
      Buffer.from([0]),
      Buffer.from([name.length + payload.length + 1]),
      Buffer.from([name.length]),
      name,
      payload,
    ]);
    const wasm = Buffer.concat([
      Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      customSection,
    ]);

    const extractor = new ContractSpecExtractor();
    const sections = extractor.extractCustomSections(wasm);
    expect(sections[0].name).toBe('contractspecv0');

    const entries = extractor.extractEntries(wasm);
    expect(entries).toHaveLength(1);
    const abi = extractor.normalize(entries, 'CABC');
    expect(abi.functions).toEqual([{
      name: 'swap',
      inputs: [{ name: 'amount', type: 'u32' }],
      outputs: ['u32'],
    }]);
  });
});
