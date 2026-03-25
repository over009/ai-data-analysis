import { Router, Request, Response } from 'express';
import { queryMetric, QueryError } from '../lib/tools/query-metric.js';
import { registry } from '../lib/metrics/registry.js';

export const queryRouter = Router();

queryRouter.post('/query', async (req: Request, res: Response) => {
  try {
    const { metric_id, time_range, dimensions, aggregation, filters, include_related } = req.body;

    // Input validation
    if (!metric_id || typeof metric_id !== 'string') {
      res.status(400).json({ error: '缺少 metric_id 参数' });
      return;
    }
    if (!time_range || typeof time_range !== 'string') {
      res.status(400).json({ error: '缺少 time_range 参数' });
      return;
    }

    const validTimeRanges = ['this_week', 'last_week', 'this_month', 'last_month'];
    if (!validTimeRanges.includes(time_range)) {
      res.status(400).json({ error: `不支持的时间范围: ${time_range}，可选: ${validTimeRanges.join(', ')}` });
      return;
    }

    // Check metric exists
    if (!registry.getMetric(metric_id)) {
      res.status(404).json({ error: `未知指标: ${metric_id}` });
      return;
    }

    const result = await queryMetric({
      metric_id,
      time_range,
      dimensions: dimensions || [],
      aggregation,
      filters: filters || {},
      include_related: include_related !== false, // default true
    });

    res.json(result);
  } catch (err) {
    if (err instanceof QueryError) {
      const status = err.code === 'METRIC_NOT_FOUND' ? 404 : 400;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }

    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      type: 'query_error',
      data: { error: (err as Error).message, body: req.body }
    }));

    res.status(500).json({ error: '查询失败，请稍后重试' });
  }
});

// GET /api/metrics — 返回所有指标列表（供前端指标目录使用）
queryRouter.get('/metrics', (_req: Request, res: Response) => {
  const domains = registry.getDomains();
  const catalog = domains.map(domain => ({
    domain,
    metrics: registry.getMetricsByDomain(domain).map(m => ({
      id: m.id,
      name: m.name,
      description: m.description,
      dimensions: m.dimensions,
      chart_type: m.chart_type,
      unit: m.unit,
      example_question: m.example_question,
    })),
  }));
  res.json(catalog);
});
