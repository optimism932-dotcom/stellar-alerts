import * as StellarSdk from 'stellar-sdk';

export interface RpcProviderStats {
  url: string;
  healthy: boolean;
  ledgerSequence: number;
  ledgerHash: string | null;
  ewmaLatencyMs: number;
  consecutiveFailures: number;
  quarantined: boolean;
  lastCheckedAt: number;
  lastError: string | null;
}

export interface RpcQuorumOptions {
  endpoints?: string[];
  maxLagLedgers?: number;
  ewmaAlpha?: number;
  probeTimeoutMs?: number;
  probe?: (url: string) => Promise<{ sequence: number; hash?: string }>;
}

export function splitRpcEndpoints(...values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.flatMap((value) => (value || '').split(',')).map((value) => value.trim()).filter(Boolean)));
}

export class RpcQuorumPool {
  public readonly endpoints: string[];
  public readonly stats = new Map<string, RpcProviderStats>();
  private readonly maxLagLedgers: number;
  private readonly ewmaAlpha: number;
  private readonly probeTimeoutMs: number;
  private readonly probeFn?: RpcQuorumOptions['probe'];

  constructor(options: RpcQuorumOptions = {}) {
    this.endpoints = options.endpoints ?? [];
    this.maxLagLedgers = options.maxLagLedgers ?? 3;
    this.ewmaAlpha = options.ewmaAlpha ?? 0.2;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000;
    this.probeFn = options.probe;
    for (const url of this.endpoints) {
      this.stats.set(url, {
        url, healthy: true, ledgerSequence: 0, ledgerHash: null, ewmaLatencyMs: 0,
        consecutiveFailures: 0, quarantined: false, lastCheckedAt: 0, lastError: null,
      });
    }
  }

  public markSuccess(url: string, sequence: number, hash: string | null = null, latencyMs = 0): RpcProviderStats {
    const stats = this.stats.get(url) ?? { url, healthy: true, ledgerSequence: 0, ledgerHash: null, ewmaLatencyMs: 0, consecutiveFailures: 0, quarantined: false, lastCheckedAt: 0, lastError: null };
    stats.healthy = !stats.quarantined;
    stats.ledgerSequence = sequence;
    stats.ledgerHash = hash;
    stats.ewmaLatencyMs = stats.ewmaLatencyMs === 0 ? latencyMs : this.ewmaAlpha * latencyMs + (1 - this.ewmaAlpha) * stats.ewmaLatencyMs;
    stats.consecutiveFailures = 0;
    stats.lastError = null;
    stats.lastCheckedAt = Date.now();
    this.stats.set(url, stats);
    this.reconcileQuorum();
    return stats;
  }

  public markFailure(url: string, error?: unknown): RpcProviderStats {
    const stats = this.stats.get(url) ?? { url, healthy: false, ledgerSequence: 0, ledgerHash: null, ewmaLatencyMs: 0, consecutiveFailures: 0, quarantined: false, lastCheckedAt: 0, lastError: null };
    stats.consecutiveFailures++;
    stats.lastError = error instanceof Error ? error.message : String(error ?? 'RPC failure');
    stats.lastCheckedAt = Date.now();
    if (stats.consecutiveFailures >= 2) stats.healthy = false;
    this.stats.set(url, stats);
    return stats;
  }

  public reconcileQuorum(): void {
    const observed = [...this.stats.values()].filter((s) => s.ledgerSequence > 0 && !s.quarantined);
    if (!observed.length) return;
    const highest = Math.max(...observed.map((s) => s.ledgerSequence));
    for (const stats of observed) {
      if (highest - stats.ledgerSequence > this.maxLagLedgers) stats.healthy = false;
    }
  }

  public quarantineDivergence(url: string): void {
    const stats = this.stats.get(url);
    if (!stats) return;
    stats.quarantined = true;
    stats.healthy = false;
    stats.lastError = 'Ledger header hash divergence';
    this.stats.set(url, stats);
  }

  public verifyLedgerHashes(): string[] {
    const hashes = new Map<string, Set<string>>();
    for (const stats of this.stats.values()) {
      if (stats.ledgerHash && !stats.quarantined) {
        if (!hashes.has(stats.ledgerHash)) hashes.set(stats.ledgerHash, new Set());
        hashes.get(stats.ledgerHash)!.add(stats.url);
      }
    }
    if (hashes.size < 2) return [];
    const majority = [...hashes.entries()].sort((a, b) => b[1].size - a[1].size)[0];
    const diverged: string[] = [];
    for (const [hash, urls] of hashes) {
      if (hash !== majority[0]) {
        for (const url of urls) { this.quarantineDivergence(url); diverged.push(url); }
      }
    }
    return diverged;
  }

  public getActiveNode(): string | null {
    const candidates = this.endpoints
      .map((url) => this.stats.get(url))
      .filter((s): s is RpcProviderStats => !!s && s.healthy && !s.quarantined)
      .sort((a, b) => b.ledgerSequence - a.ledgerSequence || a.ewmaLatencyMs - b.ewmaLatencyMs);
    return candidates[0]?.url ?? this.endpoints.find((url) => !this.stats.get(url)?.quarantined) ?? null;
  }

  public async probeAll(): Promise<RpcProviderStats[]> {
    return Promise.all(this.endpoints.map(async (url) => {
      const started = Date.now();
      try {
        let sequence = 0;
        let hash: string | undefined;
        if (this.probeFn) {
          const result = await Promise.race([
            this.probeFn(url),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('RPC probe timeout')), this.probeTimeoutMs)),
          ]);
          sequence = result.sequence;
          hash = result.hash;
        } else {
          const server = new (StellarSdk as any).rpc.Server(url);
          const latest = await server.getLatestLedger();
          sequence = Number(latest.sequence ?? 0);
          hash = latest.headerHash ?? latest.id;
        }
        return this.markSuccess(url, sequence, hash ?? null, Date.now() - started);
      } catch (error) {
        return this.markFailure(url, error);
      }
    }).map(async (promise) => promise)).then((results) => {
      this.verifyLedgerHashes();
      this.reconcileQuorum();
      return results;
    });
  }
}
