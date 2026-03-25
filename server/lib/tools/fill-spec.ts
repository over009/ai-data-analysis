import type { MetricQueryResult, QueryParams, MetricDefinition } from '../types.js';

const VALID_TIME_RANGES = ['this_week', 'last_week', 'this_month', 'last_month'];

/**
 * Validate the LLM-generated spec template.
 * Returns null if valid, error message if invalid.
 */
export function validateSpecTemplate(
  template: any,
  metricExists: (id: string) => boolean,
): string | null {
  if (!template || typeof template !== 'object') return 'Not an object';
  if (!template._meta) return 'Missing _meta';
  if (!template._meta.metric_id) return 'Missing _meta.metric_id';
  if (!metricExists(template._meta.metric_id)) return `Unknown metric: ${template._meta.metric_id}`;
  if (!VALID_TIME_RANGES.includes(template._meta.time_range)) return `Invalid time_range: ${template._meta.time_range}`;

  // Validate multi-metric entries if present
  if (template._meta.metrics && Array.isArray(template._meta.metrics)) {
    for (const m of template._meta.metrics) {
      if (!m.id) return 'metrics entry missing id';
      if (!metricExists(m.id)) return `Unknown metric in metrics array: ${m.id}`;
      if (m.time_range && !VALID_TIME_RANGES.includes(m.time_range)) return `Invalid time_range in metrics: ${m.time_range}`;
      if (!m.key) return 'metrics entry missing key';
    }
  }

  if (!template.root) return 'Missing root';
  if (!template.elements) return 'Missing elements';
  if (!template.elements[template.root]) return `Root "${template.root}" not found in elements`;
  return null;
}

/**
 * Fill a spec template with real data from queryMetric result.
 * Mutates the template in place and returns it.
 */
export function fillSpecWithData(
  template: { _meta: any; root: string; elements: Record<string, any> },
  result: MetricQueryResult,
  params: QueryParams,
  metric: MetricDefinition,
): void {
  const elements = template.elements;

  for (const [key, el] of Object.entries(elements)) {
    switch (el.type) {
      case 'MetricValue':
        el.props = {
          ...el.props,
          value: result.current.value,
          unit: result.metric.unit,
          change: result.compare?.change_percent ?? null,
          description: result.metric.description,
          dateRange: result.current.date_range,
        };
        break;

      case 'Chart':
        el.props = {
          ...el.props,
          rows: result.current.rows,
        };
        break;

      case 'DimChartGrid':
        // Data injected via frontend context, no fill needed
        break;

      case 'DimensionChips':
        el.props = {
          ...el.props,
          options: metric.dimensions,
          active: params.dimensions || [],
        };
        break;

      case 'TimeChips':
        el.props = {
          ...el.props,
          active: params.time_range,
        };
        break;

      case 'TrendChip':
        el.props = {
          ...el.props,
          active: params.aggregation === 'daily',
        };
        el.on = { press: { action: 'toggleTrend' } };
        break;

      case 'Recommendations':
        el.props = { ...el.props, items: result.recommendations };
        break;

      case 'RelatedAlerts': {
        const anomalies = result.related.filter(r => r.is_anomaly);
        el.props = { ...el.props, items: anomalies };
        break;
      }

      case 'Warnings':
        el.props = { ...el.props, messages: result.validation.warnings };
        break;
    }
  }

  // Conditional cleanup: remove empty RelatedAlerts/Warnings/Recommendations
  removeEmptyElements(elements, 'RelatedAlerts', 'items');
  removeEmptyElements(elements, 'Warnings', 'messages');
  removeEmptyElements(elements, 'Recommendations', 'items');
}

/**
 * Fill a spec template with data from multiple query results.
 * Each component's _dataKey prop determines which result to use.
 * Components without _dataKey use the default result.
 */
export function fillSpecWithMultiData(
  template: { _meta: any; root: string; elements: Record<string, any> },
  resultsMap: Record<string, { result: MetricQueryResult; params: QueryParams; metric: MetricDefinition }>,
  defaultKey: string,
): void {
  const elements = template.elements;

  for (const [key, el] of Object.entries(elements)) {
    // Determine which result to use based on _dataKey
    const dataKey = el.props?._dataKey || defaultKey;
    const data = resultsMap[dataKey];
    if (!data) continue;

    const { result, params, metric } = data;

    // Clean up _dataKey from props (frontend doesn't need it)
    if (el.props?._dataKey) {
      delete el.props._dataKey;
    }

    switch (el.type) {
      case 'MetricValue':
        el.props = {
          ...el.props,
          value: result.current.value,
          unit: result.metric.unit,
          change: result.compare?.change_percent ?? null,
          description: result.metric.description,
          dateRange: result.current.date_range,
        };
        break;

      case 'Chart':
        el.props = {
          ...el.props,
          rows: result.current.rows,
        };
        break;

      case 'DimChartGrid':
        break;

      case 'DimensionChips':
        el.props = {
          ...el.props,
          options: metric.dimensions,
          active: params.dimensions || [],
        };
        break;

      case 'TimeChips':
        el.props = {
          ...el.props,
          active: params.time_range,
        };
        break;

      case 'TrendChip':
        el.props = {
          ...el.props,
          active: params.aggregation === 'daily',
        };
        el.on = { press: { action: 'toggleTrend' } };
        break;

      case 'Recommendations':
        el.props = { ...el.props, items: result.recommendations };
        break;

      case 'RelatedAlerts': {
        const anomalies = result.related.filter(r => r.is_anomaly);
        el.props = { ...el.props, items: anomalies };
        break;
      }

      case 'Warnings':
        el.props = { ...el.props, messages: result.validation.warnings };
        break;
    }
  }

  removeEmptyElements(elements, 'RelatedAlerts', 'items');
  removeEmptyElements(elements, 'Warnings', 'messages');
  removeEmptyElements(elements, 'Recommendations', 'items');
}

/** Remove elements of given type if their array prop is empty, and clean parent children refs. */
function removeEmptyElements(
  elements: Record<string, any>,
  typeName: string,
  arrayProp: string,
): void {
  const keysToRemove: string[] = [];

  for (const [key, el] of Object.entries(elements)) {
    if (el.type === typeName) {
      const arr = el.props?.[arrayProp];
      if (!arr || (Array.isArray(arr) && arr.length === 0)) {
        keysToRemove.push(key);
      }
    }
  }

  for (const key of keysToRemove) {
    delete elements[key];
    for (const el of Object.values(elements)) {
      if (Array.isArray(el.children)) {
        el.children = el.children.filter((c: string) => c !== key);
      }
    }
  }
}
