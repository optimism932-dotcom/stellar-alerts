import { describe, expect, it } from 'vitest';
import { RpcQuorumPool } from '../rpc-pool';

describe('RpcQuorumPool', () => {
  it('demotes providers more than three ledgers behind', () => {
    const pool = new RpcQuorumPool({
      endpoints: ['https://rpc-a', 'https://rpc-b'],
      maxLagLedgers: 3,
    });
    pool.markSuccess('https://rpc-a', 1000, 'hash-a');
    pool.markSuccess('https://rpc-b', 996, 'hash-b');
    expect(pool.stats.get('https://rpc-b')?.healthy).toBe(false);
  });

  it('quarantines nodes whose ledger hash diverges from the majority', () => {
    const pool = new RpcQuorumPool({
      endpoints: ['https://rpc-a', 'https://rpc-b', 'https://rpc-c'],
    });
    pool.markSuccess('https://rpc-a', 1000, 'majority');
    pool.markSuccess('https://rpc-b', 1000, 'majority');
    pool.markSuccess('https://rpc-c', 1000, 'diverged');

    expect(pool.verifyLedgerHashes()).toEqual(['https://rpc-c']);
    expect(pool.stats.get('https://rpc-c')?.quarantined).toBe(true);
  });

  it('fails over to the healthiest non-quarantined provider', () => {
    const pool = new RpcQuorumPool({
      endpoints: ['https://rpc-a', 'https://rpc-b'],
    });
    pool.markSuccess('https://rpc-a', 1000, 'hash');
    pool.markSuccess('https://rpc-b', 999, 'hash', 5);
    pool.quarantineDivergence('https://rpc-a');
    expect(pool.getActiveNode()).toBe('https://rpc-b');
  });
});
