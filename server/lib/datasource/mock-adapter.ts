import { DataSourceAdapter, QueryParams, QueryResult, QueryRow } from '../types.js';

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Same seed → same sequence, so identical params always return identical data.
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Time range definitions
const TIME_RANGES: Record<string, { days: number; label: string; prevLabel: string }> = {
  this_week: { days: 7, label: '本周', prevLabel: '上周' },
  last_week: { days: 7, label: '上周', prevLabel: '上上周' },
  this_month: { days: 30, label: '本月', prevLabel: '上月' },
  last_month: { days: 30, label: '上月', prevLabel: '上上月' },
};

// Base values per metric (realistic for a small pet-tech company)
const BASE_VALUES: Record<string, number> = {
  gmv: 48000,
  order_count: 320,
  avg_order_value: 150,
  refund_amount: 2300,
  refund_rate: 4.8,
  sku_sales: 520,
  channel_sales: 48000,
  new_users: 180,
  dau: 1245,
  device_bindings: 45,
  active_devices: 890,
  consumable_gmv: 12500,
  consumable_orders: 280,
  repurchase_rate: 32.4,
};

// Dimension values
const DIMENSION_VALUES: Record<string, string[]> = {
  channel: ['官网', 'Amazon', '线下', '其他'],
  sku: ['智能猫砂盆 Pro', '智能猫砂盆 Lite', '猫砂', '滤网', '垃圾袋'],
  region: ['北美', '欧洲', '亚太'],
};

// Distribution weights for dimension splits
const DIMENSION_WEIGHTS: Record<string, number[]> = {
  channel: [0.42, 0.32, 0.16, 0.10],
  sku: [0.30, 0.25, 0.22, 0.13, 0.10],
  region: [0.55, 0.28, 0.17],
};

// Which metrics should show anomalies (change > 10%)
const ANOMALY_METRICS: Record<string, number> = {
  channel_sales: -18.1,
  consumable_orders: -16.2,
  repurchase_rate: -5.1,
  refund_rate: 15.2,
};

export class MockAdapter implements DataSourceAdapter {
  async query(params: QueryParams): Promise<QueryResult> {
    const seed = hashString(`${params.metric_id}:${params.time_range}:${params.aggregation || 'default'}:${(params.dimensions || []).join(',')}:${JSON.stringify(params.filters || {})}`);
    const rand = seededRandom(seed);

    const baseValue = BASE_VALUES[params.metric_id] || 1000;
    const aggregation = params.aggregation || 'total';
    const timeRange = TIME_RANGES[params.time_range] || TIME_RANGES.last_week;
    const dimensions = params.dimensions || [];

    // Apply anomaly shift if this metric has one
    const anomalyShift = ANOMALY_METRICS[params.metric_id] || 0;

    if (dimensions.length > 0) {
      return this.queryWithDimensions(baseValue, dimensions, aggregation, timeRange, rand, anomalyShift, params.filters);
    }

    switch (aggregation) {
      case 'daily':
        return this.queryDaily(baseValue, timeRange, rand, anomalyShift);
      case 'average':
        return this.queryAverage(baseValue, timeRange, rand, anomalyShift);
      case 'distinct':
        return this.queryDistinct(baseValue, timeRange, rand);
      case 'total':
      default:
        return this.queryTotal(baseValue, rand, anomalyShift);
    }
  }

  private queryTotal(baseValue: number, rand: () => number, anomalyShift: number): QueryResult {
    const noise = 1 + (rand() - 0.5) * 0.1;
    const value = Math.round(baseValue * noise * (1 + anomalyShift / 100));
    return { value, rows: [{ value }] };
  }

  private queryDaily(baseValue: number, timeRange: { days: number }, rand: () => number, anomalyShift: number): QueryResult {
    const days = timeRange.days;
    const dailyBase = baseValue / days;
    const rows: QueryRow[] = [];
    let total = 0;

    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Add trend (slight decline for anomaly metrics, slight rise otherwise)
      const trendFactor = anomalyShift !== 0
        ? 1 + (anomalyShift / 100) * ((days - i) / days)
        : 1 + 0.02 * ((days - i) / days);
      const noise = 1 + (rand() - 0.5) * 0.15;
      const value = Math.round(dailyBase * trendFactor * noise);

      rows.push({ date: dateStr, value });
      total += value;
    }

    return { value: total, rows };
  }

  private queryAverage(baseValue: number, timeRange: { days: number }, rand: () => number, anomalyShift: number): QueryResult {
    const dailyBase = baseValue / timeRange.days;
    const noise = 1 + (rand() - 0.5) * 0.1;
    const value = Math.round(dailyBase * noise * (1 + anomalyShift / 100));
    return { value, rows: [{ value }] };
  }

  private queryDistinct(baseValue: number, timeRange: { days: number }, rand: () => number): QueryResult {
    // Distinct count is less than sum of daily (dedup factor 0.6-0.8)
    const dedupFactor = 0.6 + rand() * 0.2;
    const value = Math.round(baseValue * dedupFactor);
    return { value, rows: [{ value }] };
  }

  private queryWithDimensions(
    baseValue: number,
    dimensions: string[],
    aggregation: string,
    timeRange: { days: number },
    rand: () => number,
    anomalyShift: number,
    filters?: Record<string, string>,
  ): QueryResult {
    const dim = dimensions[0]; // Primary dimension
    const dimValues = DIMENSION_VALUES[dim] || ['A', 'B', 'C'];
    const weights = DIMENSION_WEIGHTS[dim] || dimValues.map(() => 1 / dimValues.length);

    // If filtered to specific dimension value, return single row
    if (filters && filters[dim]) {
      const filterValue = filters[dim];
      const idx = dimValues.indexOf(filterValue);
      const weight = idx >= 0 ? weights[idx] : 0.25;
      const noise = 1 + (rand() - 0.5) * 0.1;
      const value = Math.round(baseValue * weight * noise * (1 + anomalyShift / 100));
      return { value, rows: [{ [dim]: filterValue, value }] };
    }

    const rows: QueryRow[] = [];
    let total = 0;

    for (let i = 0; i < dimValues.length; i++) {
      const noise = 1 + (rand() - 0.5) * 0.15;
      // Apply anomaly shift unevenly across dimensions
      const dimAnomalyShift = i === 1 ? anomalyShift * 1.5 : anomalyShift * 0.5;
      const value = Math.round(baseValue * weights[i] * noise * (1 + dimAnomalyShift / 100));
      rows.push({ [dim]: dimValues[i], value });
      total += value;
    }

    return { value: total, rows };
  }
}

/**
 * Query the previous time period for comparison.
 * Returns the same structure but for the prior period.
 */
export function getPreviousTimeRange(timeRange: string): string {
  switch (timeRange) {
    case 'this_week': return 'last_week';
    case 'last_week': return 'last_week_prev'; // two weeks ago
    case 'this_month': return 'last_month';
    case 'last_month': return 'last_month_prev';
    default: return 'last_week';
  }
}

export function getTimeRangeLabel(timeRange: string): string {
  return TIME_RANGES[timeRange]?.label || timeRange;
}

export function getTimeRangeDates(timeRange: string): { start: string; end: string } {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday

  switch (timeRange) {
    case 'this_week': {
      return { start: fmt(startOfWeek), end: fmt(today) };
    }
    case 'last_week': {
      const end = new Date(startOfWeek);
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'last_week_prev': {
      const end = new Date(startOfWeek);
      end.setDate(end.getDate() - 8);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(start), end: fmt(today) };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'last_month_prev': {
      const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const end = new Date(today.getFullYear(), today.getMonth() - 1, 0);
      return { start: fmt(start), end: fmt(end) };
    }
    default: {
      const start = new Date(startOfWeek);
      start.setDate(start.getDate() - 7);
      return { start: fmt(start), end: fmt(new Date(startOfWeek.getTime() - 86400000)) };
    }
  }
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0];
}
