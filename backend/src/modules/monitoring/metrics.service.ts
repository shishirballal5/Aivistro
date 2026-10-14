import { Injectable } from '@nestjs/common';

const BUCKETS = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
interface Hist { counts: number[]; sum: number; count: number }
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/** Tiny dependency-free Prometheus text exposition. Labels are bounded: the ROUTE PATTERN (/series/:ref), never the raw URL. */
@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Hist>();
  private readonly started = Date.now();

  record(method: string, route: string, status: number, seconds: number): void {
    const key = `${method}|${route}|${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const dk = `${method}|${route}`;
    const h = this.durations.get(dk) ?? { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => { if (seconds <= b) h.counts[i]++; });
    h.sum += seconds; h.count++;
    this.durations.set(dk, h);
  }

  render(queueCounts: Record<string, Record<string, number>>): string {
    const out: string[] = ['# HELP aivistro_http_requests_total HTTP requests by method, route pattern and status', '# TYPE aivistro_http_requests_total counter'];
    for (const [k, v] of this.requests) { const [m, r, s] = k.split('|'); out.push(`aivistro_http_requests_total{method="${esc(m)}",route="${esc(r)}",status="${s}"} ${v}`); }
    out.push('# HELP aivistro_http_request_duration_seconds HTTP request latency', '# TYPE aivistro_http_request_duration_seconds histogram');
    for (const [k, h] of this.durations) {
      const [m, r] = k.split('|'); const lbl = `method="${esc(m)}",route="${esc(r)}"`;
      BUCKETS.forEach((b, i) => out.push(`aivistro_http_request_duration_seconds_bucket{${lbl},le="${b}"} ${h.counts[i]}`));
      out.push(`aivistro_http_request_duration_seconds_bucket{${lbl},le="+Inf"} ${h.count}`, `aivistro_http_request_duration_seconds_sum{${lbl}} ${h.sum.toFixed(6)}`, `aivistro_http_request_duration_seconds_count{${lbl}} ${h.count}`);
    }
    out.push('# HELP aivistro_queue_jobs BullMQ jobs by queue and state', '# TYPE aivistro_queue_jobs gauge');
    for (const [q, states] of Object.entries(queueCounts)) for (const [s, n] of Object.entries(states)) out.push(`aivistro_queue_jobs{queue="${esc(q)}",state="${s}"} ${n}`);
    const mem = process.memoryUsage();
    out.push('# TYPE aivistro_process_uptime_seconds gauge', `aivistro_process_uptime_seconds ${Math.round((Date.now() - this.started) / 1000)}`, '# TYPE aivistro_process_resident_memory_bytes gauge', `aivistro_process_resident_memory_bytes ${mem.rss}`, '# TYPE aivistro_process_heap_used_bytes gauge', `aivistro_process_heap_used_bytes ${mem.heapUsed}`);
    return `${out.join('\n')}\n`;
  }
}
