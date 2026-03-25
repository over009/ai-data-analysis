import { registry } from '../metrics/registry.js';
import type { ParseResult } from './parser.js';

/**
 * Keyword-based fallback parser for when no LLM API key is configured.
 * Matches metric names/aliases, dimensions, time ranges from user input.
 */

interface CardContext {
  metric_id: string;
  dimensions: string[];
  time_range: string;
}

// Metric keyword → metric_id mapping (built from registry at import time)
const METRIC_KEYWORDS: Array<{ keywords: string[]; metric_id: string }> = [];

// Lazy init — registry must be loaded first
let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;

  for (const metric of registry.getAllMetrics()) {
    const kws: string[] = [
      metric.name,
      metric.id,
      metric.example_question,
    ];
    // Extract Chinese part from name (e.g. "销售额 (GMV)" → "销售额")
    const cnMatch = metric.name.match(/^[\u4e00-\u9fff]+/);
    if (cnMatch) {
      kws.push(cnMatch[0]);
    }
    // Extract short aliases (e.g. "总销售额" → "销售额")
    if (metric.name.length > 2) {
      kws.push(metric.name.replace(/^总/, ''));
    }
    // Extract English abbreviation from name (e.g. "销售额 (GMV)" → "GMV")
    const enMatch = metric.name.match(/\(([A-Za-z]+)\)/);
    if (enMatch) {
      kws.push(enMatch[1]);
    }
    // Common short aliases for frequently used metrics
    const SHORT_ALIASES: Record<string, string[]> = {
      dau: ['日活', 'DAU'],
      new_users: ['新用户', '注册'],
      active_devices: ['活跃设备'],
      device_bindings: ['设备绑定', '绑定数'],
      refund_amount: ['退款'],
      refund_rate: ['退款率'],
      sku_sales: ['SKU销量', 'sku'],
      channel_sales: ['渠道销售'],
      consumable_gmv: ['耗材销售'],
      consumable_orders: ['耗材订单'],
    };
    if (SHORT_ALIASES[metric.id]) {
      kws.push(...SHORT_ALIASES[metric.id]);
    }
    METRIC_KEYWORDS.push({ keywords: kws.map(k => k.toLowerCase()), metric_id: metric.id });
  }
}

const TIME_KEYWORDS: Record<string, string> = {
  '本周': 'this_week',
  '这周': 'this_week',
  '上周': 'last_week',
  '上一周': 'last_week',
  '本月': 'this_month',
  '这个月': 'this_month',
  '上月': 'last_month',
  '上个月': 'last_month',
};

const DIM_KEYWORDS: Record<string, string> = {
  '渠道': 'channel',
  '按渠道': 'channel',
  'sku': 'sku',
  '产品': 'sku',
  '按产品': 'sku',
  '按sku': 'sku',
  '地区': 'region',
  '按地区': 'region',
  '区域': 'region',
};

const AGG_KEYWORDS: Record<string, string> = {
  '趋势': 'daily',
  '按天': 'daily',
  '每天': 'daily',
  '日均': 'average',
  '平均': 'average',
  '总共': 'total',
  '总计': 'total',
  '去重': 'distinct',
};

function inferDefaultTimeRange(): string {
  const today = new Date();
  const dow = today.getDay();
  const dom = today.getDate();
  if (dow === 1) return 'last_week';
  if (dom <= 3) return 'last_month';
  return 'this_week';
}

export function keywordParse(input: string, context?: { active_card?: CardContext }): ParseResult {
  ensureInit();

  const lower = input.toLowerCase();

  // Match metric
  let matchedMetric: string | null = null;
  let bestScore = 0;
  for (const entry of METRIC_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw) && kw.length > bestScore) {
        matchedMetric = entry.metric_id;
        bestScore = kw.length;
      }
    }
  }

  // Match time range
  let timeRange: string | null = null;
  for (const [kw, tr] of Object.entries(TIME_KEYWORDS)) {
    if (lower.includes(kw)) {
      timeRange = tr;
      break;
    }
  }

  // Match dimensions
  const dimensions: string[] = [];
  for (const [kw, dim] of Object.entries(DIM_KEYWORDS)) {
    if (lower.includes(kw) && !dimensions.includes(dim)) {
      dimensions.push(dim);
    }
  }

  // Match aggregation
  let aggregation: string | null = null;
  for (const [kw, agg] of Object.entries(AGG_KEYWORDS)) {
    if (lower.includes(kw)) {
      aggregation = agg;
      break;
    }
  }

  // If we have context and no new metric, treat as update
  if (!matchedMetric && context?.active_card) {
    if (timeRange || dimensions.length > 0 || aggregation) {
      const params: Record<string, any> = {};
      if (timeRange) params.time_range = timeRange;
      if (dimensions.length > 0) params.dimensions = dimensions;
      if (aggregation) params.aggregation = aggregation;
      return { action: 'update_card', params };
    }
  }

  // If we found a metric, open a card
  if (matchedMetric) {
    return {
      action: 'open_card',
      params: {
        metric_id: matchedMetric,
        time_range: timeRange || inferDefaultTimeRange(),
        dimensions: dimensions.length > 0 ? dimensions : undefined,
        aggregation: aggregation || undefined,
      },
    };
  }

  // Nothing matched
  return {
    action: 'reject',
    message: '没有匹配到指标。试试输入"销售额"、"日活"、"复购率"等关键词。',
  };
}
