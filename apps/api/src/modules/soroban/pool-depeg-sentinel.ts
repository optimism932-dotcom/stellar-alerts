export interface PoolReserveState {
  reserveA: number | bigint | string;
  reserveB: number | bigint | string;
  decimalsA?: number;
  decimalsB?: number;
  amplification?: number;
}

export function toSafeNumber(value: number | bigint | string, decimals = 0): number {
  const raw = typeof value === 'bigint' ? Number(value) : typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(raw) || raw < 0) throw new Error('Invalid reserve value');
  return decimals > 0 ? raw / 10 ** decimals : raw;
}

export function constantProductSpotPrice(reserveA: number | bigint | string, reserveB: number | bigint | string): number {
  const a = toSafeNumber(reserveA);
  const b = toSafeNumber(reserveB);
  if (a <= 0) throw new Error('Reserve A must be positive');
  return b / a;
}

export function stableSwapSpotPrice(reserveA: number | bigint | string, reserveB: number | bigint | string, amplification = 1): number {
  const a = toSafeNumber(reserveA);
  const b = toSafeNumber(reserveB);
  if (a <= 0 || b <= 0) throw new Error('Stable-swap reserves must be positive');
  // The constant-product limit is corrected by amplification so larger
  // balanced pools remain close to parity rather than drifting on rounding.
  const equal = (a + b) / 2;
  const imbalance = Math.abs(a - b) / equal;
  const correction = 1 / (1 + (imbalance / Math.max(1, amplification)));
  return (b / a) * correction;
}

export class PoolDepegSentinel {
  public constantProductSpotPrice = constantProductSpotPrice;
  public stableSwapSpotPrice = stableSwapSpotPrice;

  public calculateSpotPrice(pool: PoolReserveState, model: 'constant-product' | 'stable-swap' = 'constant-product'): number {
    const a = toSafeNumber(pool.reserveA, pool.decimalsA);
    const b = toSafeNumber(pool.reserveB, pool.decimalsB);
    return model === 'stable-swap'
      ? stableSwapSpotPrice(a, b, pool.amplification)
      : constantProductSpotPrice(a, b);
  }

  public reserveRatio(pool: PoolReserveState): number {
    const a = toSafeNumber(pool.reserveA, pool.decimalsA);
    const b = toSafeNumber(pool.reserveB, pool.decimalsB);
    if (a <= 0) throw new Error('Reserve A must be positive');
    return b / a;
  }

  public deviationBps(spotPrice: number, pegPrice = 1): number {
    if (!Number.isFinite(spotPrice) || spotPrice <= 0) throw new Error('Invalid spot price');
    return Math.abs(spotPrice / pegPrice - 1) * 10_000;
  }

  public classifyDepeg(spotPrice: number, pegPrice = 1): 'OK' | 'WARNING' | 'CRITICAL' {
    const deviation = this.deviationBps(spotPrice, pegPrice);
    if (deviation > 200) return 'CRITICAL';
    if (deviation > 50) return 'WARNING';
    return 'OK';
  }

  public evaluateRange(poolId: string, spotPrice: number, minPrice: number, maxPrice: number) {
    const outOfRange = spotPrice < minPrice || spotPrice > maxPrice;
    return { poolId, spotPrice, minPrice, maxPrice, outOfRange, severity: outOfRange ? 'WARNING' : 'OK' as const };
  }
}

export const poolDepegSentinel = new PoolDepegSentinel();
