import { describe, expect, it } from 'vitest';
import { AdaptiveLoadShedder, RequestPriority } from '../load-shedder.middleware';

describe('AdaptiveLoadShedder', () => {
  it('always admits critical traffic under overload', () => {
    const shedder = new AdaptiveLoadShedder({ initialLimit: 10, minLimit: 1 });
    shedder.updateMetrics({ elu: 0.95, heapPressure: 0.95 });
    expect(shedder.canAdmit(RequestPriority.CRITICAL)).toBe(true);
  });

  it('sheds bulk reads after saturation', () => {
    const shedder = new AdaptiveLoadShedder({ initialLimit: 10 });
    for (let i = 0; i < 9; i++) shedder.begin();
    shedder.updateMetrics({ elu: 0.95, heapPressure: 0.95 });
    expect(shedder.canAdmit(RequestPriority.BULK_READ)).toBe(false);
  });

  it('uses AIMD to recover the concurrency limit', () => {
    const shedder = new AdaptiveLoadShedder({ initialLimit: 100 });
    shedder.updateMetrics({ elu: 0.95, heapPressure: 0.95 });
    expect(shedder.limit).toBe(50);
    shedder.updateMetrics({ elu: 0.2, heapPressure: 0.2 });
    expect(shedder.limit).toBe(51);
  });
});
