import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export enum RequestPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  BULK_READ = 'BULK_READ',
}

export interface LoadShedderOptions {
  saturationThreshold?: number;
  initialLimit?: number;
  maxLimit?: number;
  minLimit?: number;
}

export class AdaptiveLoadShedder {
  public limit: number;
  private readonly initialLimit: number;
  private readonly maxLimit: number;
  private readonly minLimit: number;
  private readonly threshold: number;
  private inFlight = 0;
  private elu: { idle: number; active: number } | null = null;

  constructor(options: LoadShedderOptions = {}) {
    this.initialLimit = options.initialLimit ?? 100;
    this.maxLimit = options.maxLimit ?? 1000;
    this.minLimit = options.minLimit ?? 10;
    this.threshold = options.saturationThreshold ?? 0.85;
    this.limit = this.initialLimit;
  }

  public classify(request: FastifyRequest): RequestPriority {
    const route = request.routeOptions?.url ?? request.url.split('?')[0];
    if (route.includes('/health') || route.includes('/alert') || request.headers['x-request-priority'] === 'critical') return RequestPriority.CRITICAL;
    if (/\/(auth|session|notification|dispatch)/.test(route)) return RequestPriority.HIGH;
    if (request.method === 'GET') return RequestPriority.BULK_READ;
    return RequestPriority.NORMAL;
  }

  public updateMetrics(sample?: { elu: number; heapPressure: number }): void {
    const elu = sample?.elu ?? this.readEventLoopUtilization();
    const heapPressure = sample?.heapPressure ?? this.readHeapPressure();
    const queuePressure = this.inFlight / this.limit;
    const saturation = Math.max(elu, heapPressure, queuePressure);
    if (saturation >= this.threshold) {
      this.limit = Math.max(this.minLimit, Math.floor(this.limit * 0.5));
    } else if (saturation < this.threshold * 0.5) {
      this.limit = Math.min(this.maxLimit, this.limit + 1);
    }
  }

  public canAdmit(priority: RequestPriority): boolean {
    this.updateMetrics();
    if (priority === RequestPriority.CRITICAL || priority === RequestPriority.HIGH) return true;
    if (priority === RequestPriority.NORMAL) return this.inFlight < this.limit && this.currentSaturation() < 0.95;
    return this.inFlight < this.limit && this.currentSaturation() < this.threshold;
  }

  public begin(): void { this.inFlight++; }
  public end(): void { this.inFlight = Math.max(0, this.inFlight - 1); }
  public getInFlight(): number { return this.inFlight; }
  public getSaturation(): number { return this.currentSaturation(); }

  private readEventLoopUtilization(): number {
    const perf = (process as any).performance;
    if (typeof perf?.eventLoopUtilization === 'function') {
      const next = perf.eventLoopUtilization(this.elu);
      this.elu = next;
      return next.utilization ?? 0;
    }
    return 0;
  }

  private readHeapPressure(): number {
    const usage = process.memoryUsage();
    const limit = (process as any).availableMemory?.() ?? (process as any).constrainedMemory?.() ?? usage.heapTotal * 2;
    return usage.heapUsed / Math.max(limit, 1);
  }

  private currentSaturation(): number {
    return Math.max(this.readEventLoopUtilization(), this.readHeapPressure(), this.inFlight / this.limit);
  }
}

export function loadShedderMiddleware(shedder = new AdaptiveLoadShedder()) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const priority = shedder.classify(request);
    if (!shedder.canAdmit(priority)) {
      reply.header('retry-after', '1');
      return reply.status(503).send({
        error: 'Service Unavailable',
        code: 'LOAD_SHED',
        priority,
        message: 'The API is temporarily overloaded.',
      });
    }
    shedder.begin();
    request.raw.once('close', () => shedder.end());
  };
}
