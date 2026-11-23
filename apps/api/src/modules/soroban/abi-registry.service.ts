import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { ContractSpecExtractor, NormalizedAbi } from './spec-extractor';

export class AbiRegistryService {
  constructor(private readonly extractor = new ContractSpecExtractor()) {}

  public async get(contractId: string): Promise<NormalizedAbi | null> {
    const redis = getRedisClient();
    if (redis) {
      try {
        const cached = await redis.get(`soroban:abi:${contractId}`);
        if (cached) return JSON.parse(cached);
      } catch {}
    }
    const row = await (prisma as any).contractAbiRegistry.findUnique({ where: { contractId } });
    if (!row) return null;
    const abi = row.abi as NormalizedAbi;
    // ContractWasmAudit currently stores exported WASM functions, not spec
    // entries. The normalized ABI is populated when extractAndCache is called.
    if (redis) await redis.setex(`soroban:abi:${contractId}`, 86400, JSON.stringify(abi)).catch(() => {});
    return abi;
  }

  public async extractAndCache(contractId: string, wasm: Uint8Array | Buffer): Promise<NormalizedAbi> {
    const abi = this.extractor.normalize(this.extractor.extractEntries(wasm), contractId);
    const redis = getRedisClient();
    if (redis) await redis.setex(`soroban:abi:${contractId}`, 86400, JSON.stringify(abi)).catch(() => {});
    await (prisma as any).contractAbiRegistry.upsert({
      where: { contractId },
      create: { contractId, wasmHash: '', abi: abi as any },
      update: { wasmHash: '', abi: abi as any, extractedAt: new Date() },
    }).catch(() => {});
    return abi;
  }
}

export const abiRegistryService = new AbiRegistryService();
