import { describe, expect, it } from 'vitest';
import { constantProductSpotPrice, stableSwapSpotPrice, PoolDepegSentinel } from '../pool-depeg-sentinel';

describe('PoolDepegSentinel', () => {
  it('calculates balanced constant-product spot price', () => {
    expect(constantProductSpotPrice(100, 100)).toBe(1);
  });

  it('calculates imbalanced constant-product and stable-swap prices', () => {
    expect(constantProductSpotPrice(100, 125)).toBe(1.25);
    expect(stableSwapSpotPrice(100, 100, 100)).toBe(1);
  });

  it('uses tiered 50/200 bps depeg thresholds', () => {
    const sentinel = new PoolDepegSentinel();
    expect(sentinel.classifyDepeg(1.004)).toBe('OK');
    expect(sentinel.classifyDepeg(1.006)).toBe('WARNING');
    expect(sentinel.classifyDepeg(1.021)).toBe('CRITICAL');
  });

  it('detects configured LP range crossings', () => {
    const sentinel = new PoolDepegSentinel();
    expect(sentinel.evaluateRange('pool', 0.99, 0.995, 1.005).outOfRange).toBe(true);
    expect(sentinel.evaluateRange('pool', 1.002, 0.995, 1.005).outOfRange).toBe(false);
  });
});
