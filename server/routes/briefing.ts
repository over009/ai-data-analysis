import { Router } from 'express';
import { registry } from '../lib/metrics/registry.js';
import { MockAdapter, getPreviousTimeRange } from '../lib/datasource/mock-adapter.js';
import type { DataSourceAdapter, Severity } from '../lib/types.js';

export const briefingRouter = Router();

const adapter: DataSourceAdapter = new MockAdapter();

interface AnomalyItem {
  metric_id: string;
  name: string;
  value: number;
  unit: string;
  change: number;
  severity: Severity;
}

interface DomainBriefing {
  domain: string;
  healthy: boolean;
  anomalies: AnomalyItem[];
}

briefingRouter.get('/briefing', async (_req, res) => {
  try {
    const domains = registry.getDomains();
    const allMetrics = registry.getAllMetrics();
    const timeRange = 'this_week';
    const prevTimeRange = getPreviousTimeRange(timeRange);

    // Query all metrics in parallel
    const results = await Promise.allSettled(
      allMetrics.map(async (metric) => {
        const [current, prev] = await Promise.all([
          adapter.query({ metric_id: metric.id, time_range: timeRange }),
          adapter.query({ metric_id: metric.id, time_range: prevTimeRange }),
        ]);

        const change = prev.value !== 0
          ? Math.round(((current.value - prev.value) / prev.value) * 1000) / 10
          : 0;

        return {
          metric,
          value: current.value,
          change,
        };
      })
    );

    // Group by domain and detect anomalies
    const domainBriefings: DomainBriefing[] = domains.map(domain => {
      const anomalies: AnomalyItem[] = [];

      results.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const { metric, value, change } = r.value;
        if (metric.domain !== domain) return;

        const absChange = Math.abs(change);
        const threshold = metric.anomaly_threshold;

        if (absChange >= threshold.critical) {
          anomalies.push({
            metric_id: metric.id,
            name: metric.name,
            value,
            unit: metric.unit,
            change,
            severity: 'critical',
          });
        } else if (absChange >= threshold.warning) {
          anomalies.push({
            metric_id: metric.id,
            name: metric.name,
            value,
            unit: metric.unit,
            change,
            severity: 'warning',
          });
        }
      });

      // Sort: critical first, then by abs change descending
      anomalies.sort((a, b) => {
        if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
        return Math.abs(b.change) - Math.abs(a.change);
      });

      return {
        domain,
        healthy: anomalies.length === 0,
        anomalies,
      };
    });

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      type: 'briefing',
      data: {
        domains: domainBriefings.map(d => ({
          domain: d.domain,
          healthy: d.healthy,
          anomaly_count: d.anomalies.length,
        })),
      },
    }));

    res.json({ domains: domainBriefings });
  } catch (err) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      type: 'briefing_error',
      data: { error: (err as Error).message },
    }));
    res.status(500).json({ error: '简报生成失败' });
  }
});
