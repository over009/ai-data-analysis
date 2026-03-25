import { registry } from '../metrics/registry.js';
import { MockAdapter, getPreviousTimeRange, getTimeRangeDates, getTimeRangeLabel } from '../datasource/mock-adapter.js';
import { BigQueryAdapter } from '../datasource/bigquery-adapter.js';
import {
  DataSourceAdapter,
  QueryParams,
  MetricQueryResult,
  ValidationResult,
  QueryResult,
  UISpec,
  UIElement,
} from '../types.js';

import { existsSync } from 'fs';

// Use BigQueryAdapter when GCP credentials available, otherwise MockAdapter
const USE_BIGQUERY = !!(process.env.GOOGLE_APPLICATION_CREDENTIALS
  || existsSync('/workspaces/my-vault/doc/ai-data-analysis/ai-data-analysis-490609-176bbbf2bcc6.json'));
const adapter: DataSourceAdapter = USE_BIGQUERY ? new BigQueryAdapter() : new MockAdapter();
console.log(`Data source: ${USE_BIGQUERY ? 'BigQuery' : 'Mock'}`);

export async function queryMetric(params: QueryParams): Promise<MetricQueryResult> {
  const metric = registry.getMetric(params.metric_id);
  if (!metric) {
    throw new QueryError(`Unknown metric: ${params.metric_id}`, 'METRIC_NOT_FOUND');
  }

  // Determine aggregation
  const aggregation = params.aggregation || metric.default_aggregation;
  if (!registry.supportsAggregation(metric.id, aggregation)) {
    const supported = metric.aggregations.map(a => a.type).join(', ');
    throw new QueryError(
      `${metric.name} 不支持 ${aggregation} 聚合，可用方式：${supported}`,
      'UNSUPPORTED_AGGREGATION'
    );
  }

  // Build query params
  const queryParams: QueryParams = {
    ...params,
    aggregation: aggregation as QueryParams['aggregation'],
  };

  // Execute current period + compare period in parallel
  const prevTimeRange = getPreviousTimeRange(params.time_range);
  const prevParams: QueryParams = { ...queryParams, time_range: prevTimeRange };

  const [currentResult, compareResult] = await Promise.all([
    adapter.query(queryParams),
    adapter.query(prevParams),
  ]);

  // Calculate change percent
  const changePercent = compareResult.value !== 0
    ? Math.round(((currentResult.value - compareResult.value) / compareResult.value) * 1000) / 10
    : 0;

  // Query related metrics if requested
  let related: MetricQueryResult['related'] = [];
  if (params.include_related) {
    related = await queryRelatedMetrics(metric.related_metrics, params.time_range, aggregation);
  }

  // Generate recommendations
  const recommendations = generateRecommendations(metric, params);

  // Run validations
  const validation = runValidations(metric, currentResult, changePercent);

  // Get date range labels
  const currentDates = getTimeRangeDates(params.time_range);
  const compareDates = getTimeRangeDates(prevTimeRange);

  // Log
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'query_metric',
    data: {
      metricId: metric.id,
      aggregation,
      time_range: params.time_range,
      dimensions: params.dimensions || [],
      value: currentResult.value,
      changePercent,
      validationPassed: validation.passed,
    }
  }));

  const queryResult: MetricQueryResult = {
    metric: {
      id: metric.id,
      name: metric.name,
      description: metric.description,
      unit: metric.unit,
      chart_type: metric.chart_type,
    },
    current: {
      value: currentResult.value,
      rows: currentResult.rows,
      date_range: `${currentDates.start} ~ ${currentDates.end}`,
      aggregation,
    },
    compare: {
      value: compareResult.value,
      date_range: `${compareDates.start} ~ ${compareDates.end}`,
      change_percent: changePercent,
    },
    related,
    recommendations,
    validation,
    ui_spec: { root: '', elements: {} },
  };

  queryResult.ui_spec = buildUISpec(queryResult, params, metric);

  return queryResult;
}

async function queryRelatedMetrics(
  relatedIds: string[],
  timeRange: string,
  aggregation: string,
): Promise<MetricQueryResult['related']> {
  if (!relatedIds || relatedIds.length === 0) return [];

  // Query at most 2 related metrics
  const idsToQuery = relatedIds.slice(0, 2);
  const prevTimeRange = getPreviousTimeRange(timeRange);

  const results = await Promise.allSettled(
    idsToQuery.map(async (id) => {
      const relMetric = registry.getMetric(id);
      if (!relMetric) return null;

      const relAgg = (registry.supportsAggregation(id, aggregation)
        ? aggregation
        : relMetric.default_aggregation) as QueryParams['aggregation'];

      const [current, prev] = await Promise.all([
        adapter.query({ metric_id: id, time_range: timeRange, aggregation: relAgg }),
        adapter.query({ metric_id: id, time_range: prevTimeRange, aggregation: relAgg }),
      ]);

      const change = prev.value !== 0
        ? Math.round(((current.value - prev.value) / prev.value) * 1000) / 10
        : 0;

      const threshold = relMetric.anomaly_threshold;
      const isAnomaly = Math.abs(change) >= threshold.warning;

      return {
        metric_id: id,
        name: relMetric.name,
        change_percent: change,
        is_anomaly: isAnomaly,
      };
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

function generateRecommendations(
  metric: ReturnType<typeof registry.getMetric> & {},
  params: QueryParams,
): MetricQueryResult['recommendations'] {
  const recs: MetricQueryResult['recommendations'] = [];

  // Recommend dimension switches (if not already using dimensions)
  if (!params.dimensions || params.dimensions.length === 0) {
    for (const dim of metric.dimensions.slice(0, 2)) {
      const dimLabel = dim === 'channel' ? '渠道' : dim === 'sku' ? 'SKU' : dim === 'region' ? '地区' : dim;
      recs.push({
        label: `按${dimLabel}拆分`,
        params: { metric_id: metric.id, dimensions: [dim], time_range: params.time_range },
      });
    }
  }

  // Recommend related metrics
  for (const relId of metric.related_metrics.slice(0, 2)) {
    const relMetric = registry.getMetric(relId);
    if (relMetric) {
      recs.push({
        label: `看${relMetric.name}`,
        params: { metric_id: relId },
      });
    }
  }

  return recs.slice(0, 4); // Max 4 recommendations
}

function runValidations(
  metric: ReturnType<typeof registry.getMetric> & {},
  result: QueryResult,
  changePercent: number,
): ValidationResult {
  const warnings: string[] = [];

  for (const rule of metric.validations || []) {
    switch (rule.rule) {
      case 'value_gte':
        if (rule.min !== undefined && result.value < rule.min) {
          warnings.push(rule.message || `${metric.name} 值 ${result.value} 低于下限 ${rule.min}`);
        }
        break;
      case 'value_lte':
        if (rule.max !== undefined && result.value > rule.max) {
          warnings.push(rule.message || `${metric.name} 值 ${result.value} 超过上限 ${rule.max}`);
        }
        break;
      case 'ratio_range':
        if (result.value < 0 || result.value > 100) {
          warnings.push(rule.message || `${metric.name} 比率值 ${result.value}% 超出 0-100% 范围`);
        }
        break;
      case 'change_percent_range':
        if (rule.max_abs !== undefined && Math.abs(changePercent) > rule.max_abs) {
          warnings.push(rule.message || `${metric.name} 环比变化 ${changePercent}% 超过 ${rule.max_abs}%，请注意确认`);
        }
        break;
    }
  }

  return {
    passed: warnings.length === 0,
    warnings,
  };
}

function buildUISpec(
  result: MetricQueryResult,
  params: QueryParams,
  metric: ReturnType<typeof registry.getMetric> & {},
): UISpec {
  const elements: Record<string, UIElement> = {};
  const rootChildren: string[] = [];

  // 1. Metric value display
  elements['value'] = {
    type: 'MetricValue',
    props: {
      value: result.current.value,
      unit: result.metric.unit,
      change: result.compare?.change_percent ?? null,
      description: result.metric.description,
      dateRange: result.current.date_range,
    },
  };
  rootChildren.push('value');

  // 2. Chart (always single-dim; frontend patches for multi-dim)
  const chartType = params.aggregation === 'daily' ? 'line' : result.metric.chart_type;
  elements['chart'] = {
    type: 'Chart',
    props: { chartType, rows: result.current.rows },
  };
  rootChildren.push('chart');

  // 3. Interaction chips
  elements['chips'] = {
    type: 'Stack',
    props: { direction: 'horizontal', gap: 'sm', wrap: true },
    children: ['dim-chips', 'time-chips', 'trend-chip'],
  };
  elements['dim-chips'] = {
    type: 'DimensionChips',
    props: {
      options: metric.dimensions,
      active: params.dimensions || [],
    },
  };
  elements['time-chips'] = {
    type: 'TimeChips',
    props: { active: params.time_range },
  };
  elements['trend-chip'] = {
    type: 'TrendChip',
    props: { active: params.aggregation === 'daily' },
    on: { press: { action: 'toggleTrend' } },
  };
  rootChildren.push('chips');

  // 4. Related alerts (only if anomalies)
  const anomalies = result.related.filter(r => r.is_anomaly);
  if (anomalies.length > 0) {
    elements['alerts'] = {
      type: 'RelatedAlerts',
      props: { items: anomalies },
    };
    rootChildren.push('alerts');
  }

  // 5. Recommendations
  if (result.recommendations.length > 0) {
    elements['recs'] = {
      type: 'Recommendations',
      props: { items: result.recommendations },
    };
    rootChildren.push('recs');
  }

  // 6. Warnings
  if (result.validation.warnings.length > 0) {
    elements['warnings'] = {
      type: 'Warnings',
      props: { messages: result.validation.warnings },
    };
    rootChildren.push('warnings');
  }

  // Root
  elements['root'] = {
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md' },
    children: rootChildren,
  };

  return { root: 'root', elements };
}

export class QueryError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'QueryError';
  }
}
