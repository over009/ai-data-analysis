import { BigQuery } from '@google-cloud/bigquery';
import { DataSourceAdapter, QueryParams, QueryResult, QueryRow } from '../types.js';

const PROJECT_ID = 'ai-data-analysis-490609';
const DATASET = 'pettech';
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS
  || '/workspaces/my-vault/doc/ai-data-analysis/ai-data-analysis-490609-176bbbf2bcc6.json';

let client: BigQuery | null = null;
function getClient(): BigQuery {
  if (!client) {
    client = new BigQuery({ keyFilename: KEY_PATH, projectId: PROJECT_ID });
  }
  return client;
}

/**
 * Map time_range to SQL date filter.
 * Returns [start, end) date strings (YYYY-MM-DD).
 */
function getDateRange(timeRange: string): { start: string; end: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (timeRange) {
    case 'this_week': {
      const dow = today.getDay() || 7; // Monday=1
      const start = new Date(today);
      start.setDate(today.getDate() - dow + 1);
      return { start: fmt(start), end: fmt(today, 1) };
    }
    case 'last_week': {
      const dow = today.getDay() || 7;
      const end = new Date(today);
      end.setDate(today.getDate() - dow + 1);
      const start = new Date(end);
      start.setDate(end.getDate() - 7);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'last_week_prev': {
      // Two weeks ago
      const dow = today.getDay() || 7;
      const end = new Date(today);
      end.setDate(today.getDate() - dow + 1 - 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 7);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(start), end: fmt(today, 1) };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(start), end: fmt(end) };
    }
    case 'last_month_prev': {
      const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      const end = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return { start: fmt(start), end: fmt(end) };
    }
    default:
      throw new Error(`Unknown time_range: ${timeRange}`);
  }
}

function fmt(d: Date, addDays = 0): string {
  const dd = new Date(d);
  dd.setDate(dd.getDate() + addDays);
  return dd.toISOString().slice(0, 10);
}

/**
 * Build SQL for a metric query based on metric_id.
 * Returns { sql, aggregateValue } where aggregateValue extracts the single metric number.
 */
function buildSQL(params: QueryParams, dateRange: { start: string; end: string }): string {
  const { metric_id, dimensions, aggregation } = params;
  const dims = dimensions && dimensions.length > 0 ? dimensions : [];
  const dimCols = dims.length > 0 ? dims.join(', ') + ', ' : '';
  const groupBy = dims.length > 0 ? `GROUP BY ${dims.join(', ')}` : '';
  const dateFilter = (col: string) => `${col} >= '${dateRange.start}' AND ${col} < '${dateRange.end}'`;

  switch (metric_id) {
    // ===== Hardware Sales =====
    case 'gmv':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} SUM(total_price) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} SUM(total_price) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} ${groupBy}`;

    case 'order_count':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} COUNT(*) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} COUNT(*) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} ${groupBy}`;

    case 'avg_order_value':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} AVG(total_price) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} AVG(total_price) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} ${groupBy}`;

    case 'refund_amount':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} SUM(refund_amount) as value FROM \`${DATASET}.orders\` WHERE refund_amount > 0 AND ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} SUM(refund_amount) as value FROM \`${DATASET}.orders\` WHERE ${dateFilter('created_at')} ${groupBy}`;

    case 'refund_rate':
      return `SELECT ${dimCols} ROUND(SAFE_DIVIDE(SUM(refund_amount), SUM(total_price)) * 100, 1) as value FROM \`${DATASET}.orders\` WHERE ${dateFilter('created_at')} ${groupBy}`;

    case 'sku_sales':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols.replace('sku, ', '')} sku, SUM(quantity) as value FROM \`${DATASET}.order_items\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date, sku${dims.filter(d => d !== 'sku').length > 0 ? ', ' + dims.filter(d => d !== 'sku').join(', ') : ''} ORDER BY date`;
      }
      return `SELECT sku, ${dimCols.replace('sku, ', '')} SUM(quantity) as value FROM \`${DATASET}.order_items\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY sku${dims.filter(d => d !== 'sku').length > 0 ? ', ' + dims.filter(d => d !== 'sku').join(', ') : ''}`;

    case 'channel_sales':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, channel, SUM(total_price) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date, channel ORDER BY date`;
      }
      return `SELECT channel, SUM(total_price) as value FROM \`${DATASET}.orders\` WHERE financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY channel`;

    // ===== APP =====
    case 'new_users':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} COUNT(*) as value FROM \`${DATASET}.users\` WHERE ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} COUNT(*) as value FROM \`${DATASET}.users\` WHERE ${dateFilter('created_at')} ${groupBy}`;

    case 'dau':
      if (aggregation === 'daily') {
        return `SELECT date, ${dimCols} COUNT(DISTINCT user_id) as value FROM \`${DATASET}.app_events\` WHERE ${dateFilter('date')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} COUNT(DISTINCT user_id) as value FROM \`${DATASET}.app_events\` WHERE ${dateFilter('date')} ${groupBy}`;

    case 'device_bindings':
      if (aggregation === 'daily') {
        return `SELECT DATE(bound_at) as date, COUNT(*) as value FROM \`${DATASET}.device_bindings\` WHERE ${dateFilter('bound_at')} GROUP BY date ORDER BY date`;
      }
      return `SELECT COUNT(*) as value FROM \`${DATASET}.device_bindings\` WHERE ${dateFilter('bound_at')}`;

    case 'active_devices':
      if (aggregation === 'daily') {
        return `SELECT date, ${dimCols} COUNT(DISTINCT device_id) as value FROM \`${DATASET}.device_events\` WHERE ${dateFilter('date')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} COUNT(DISTINCT device_id) as value FROM \`${DATASET}.device_events\` WHERE ${dateFilter('date')} ${groupBy}`;

    // ===== Consumables =====
    case 'consumable_gmv':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} SUM(total_price) as value FROM \`${DATASET}.orders\` WHERE product_type = 'consumable' AND financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} SUM(total_price) as value FROM \`${DATASET}.orders\` WHERE product_type = 'consumable' AND financial_status = 'paid' AND ${dateFilter('created_at')} ${groupBy}`;

    case 'consumable_orders':
      if (aggregation === 'daily') {
        return `SELECT DATE(created_at) as date, ${dimCols} COUNT(*) as value FROM \`${DATASET}.orders\` WHERE product_type = 'consumable' AND financial_status = 'paid' AND ${dateFilter('created_at')} GROUP BY date${dims.length > 0 ? ', ' + dims.join(', ') : ''} ORDER BY date`;
      }
      return `SELECT ${dimCols} COUNT(*) as value FROM \`${DATASET}.orders\` WHERE product_type = 'consumable' AND financial_status = 'paid' AND ${dateFilter('created_at')} ${groupBy}`;

    case 'repurchase_rate': {
      // Users with 2+ consumable orders / total consumable buyers
      return `SELECT ${dimCols} ROUND(SAFE_DIVIDE(
        COUNTIF(order_cnt >= 2),
        COUNT(*)
      ) * 100, 1) as value
      FROM (
        SELECT user_id, ${dimCols} COUNT(*) as order_cnt
        FROM \`${DATASET}.orders\`
        WHERE product_type = 'consumable' AND financial_status = 'paid' AND ${dateFilter('created_at')}
        GROUP BY user_id${dims.length > 0 ? ', ' + dims.join(', ') : ''}
      ) ${groupBy}`;
    }

    default:
      throw new Error(`Unknown metric_id: ${metric_id}`);
  }
}

export class BigQueryAdapter implements DataSourceAdapter {
  async query(params: QueryParams): Promise<QueryResult> {
    const bq = getClient();
    const dateRange = getDateRange(params.time_range);
    const sql = buildSQL(params, dateRange);

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      type: 'bigquery_query',
      data: { metric_id: params.metric_id, sql: sql.substring(0, 300) },
    }));

    const [rows] = await bq.query({ query: sql });

    if (rows.length === 0) {
      return { value: 0, rows: [] };
    }

    // If no dimensions (aggregate query), rows has single row with `value`
    const dims = params.dimensions && params.dimensions.length > 0 ? params.dimensions : [];
    if (dims.length === 0 && params.aggregation !== 'daily') {
      const val = Number(rows[0].value) || 0;
      return {
        value: Math.round(val * 100) / 100,
        rows: rows.map(r => normalizeRow(r)),
      };
    }

    // Dimension or daily query: sum up value for the total, return rows
    const total = rows.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
    return {
      value: Math.round(total * 100) / 100,
      rows: rows.map(r => normalizeRow(r)),
    };
  }
}

/** Convert BigQuery row values (BigNumeric, Date objects, etc.) to plain JS types */
function normalizeRow(row: Record<string, any>): QueryRow {
  const out: QueryRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) {
      out[k] = 0;
    } else if (typeof v === 'object' && v.value) {
      // BigQuery Timestamp/Date wrapper
      out[k] = String(v.value).slice(0, 10);
    } else if (typeof v === 'number') {
      out[k] = Math.round(v * 100) / 100;
    } else {
      out[k] = v;
    }
  }
  return out;
}
