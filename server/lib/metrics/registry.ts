import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { MetricDefinition, MetricsConfig, CorrelationGroup } from '../types.js';

const CONFIG_PATH = path.resolve(process.cwd(), 'config/metrics.yaml');

class MetricsRegistry {
  private metrics: Map<string, MetricDefinition> = new Map();
  private correlations: CorrelationGroup[] = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const config = yaml.load(raw) as MetricsConfig;

      if (!config?.metrics) {
        throw new Error('metrics.yaml: missing "metrics" key');
      }

      for (const m of config.metrics) {
        this.metrics.set(m.id, m);
      }

      this.correlations = config.correlations || [];

      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        type: 'registry_loaded',
        data: { metrics_count: this.metrics.size, correlations_count: this.correlations.length }
      }));
    } catch (err: any) {
      console.error(`FATAL: Failed to load metrics.yaml at ${CONFIG_PATH}: ${err.message}`);
      process.exit(1);
    }
  }

  getMetric(id: string): MetricDefinition | undefined {
    return this.metrics.get(id);
  }

  getAllMetrics(): MetricDefinition[] {
    return Array.from(this.metrics.values());
  }

  getMetricsByDomain(domain: string): MetricDefinition[] {
    return this.getAllMetrics().filter(m => m.domain === domain);
  }

  getDomains(): string[] {
    const domains = new Set(this.getAllMetrics().map(m => m.domain));
    return Array.from(domains);
  }

  getCorrelations(): CorrelationGroup[] {
    return this.correlations;
  }

  getRelatedMetrics(metricId: string): MetricDefinition[] {
    const metric = this.getMetric(metricId);
    if (!metric) return [];
    return metric.related_metrics
      .map(id => this.getMetric(id))
      .filter((m): m is MetricDefinition => m !== undefined);
  }

  supportsAggregation(metricId: string, aggregation: string): boolean {
    const metric = this.getMetric(metricId);
    if (!metric) return false;
    return metric.aggregations.some(a => a.type === aggregation);
  }

  getMetricSummaryForLLM(): string {
    return this.getAllMetrics().map(m => {
      const aggs = m.aggregations.map(a => a.type).join(', ');
      const dims = m.dimensions.join(', ');
      return `- ${m.id}（${m.name}）：${m.description}。单位：${m.unit}。可按 ${dims} 拆分。聚合方式：${aggs}（默认 ${m.default_aggregation}）`;
    }).join('\n');
  }
}

export const registry = new MetricsRegistry();
