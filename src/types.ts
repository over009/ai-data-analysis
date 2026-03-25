// ===== Query Card Model Types =====

import type { Spec } from '@json-render/core';
export type { Spec };

export interface CardState {
  id: string;
  metric_id: string;
  metric_name: string;
  dimensions: string[];
  time_range: string;
  aggregation: string;
  source: 'briefing' | 'query' | 'related' | 'pin';
  input?: string;
  status: 'loading' | 'success' | 'error' | 'empty';
  statusText?: string;
  result: MetricQueryResult | null;
  /** Per-dimension results when multiple dimensions are selected */
  dimensionResults: Record<string, MetricQueryResult>;
  error?: string;
  created_at: number;
}

export interface MetricQueryResult {
  metric: {
    id: string;
    name: string;
    description: string;
    unit: string;
    chart_type: 'bar' | 'line' | 'pie';
  };
  current: {
    value: number;
    rows: Array<Record<string, string | number>>;
    date_range: string;
    aggregation: string;
  };
  compare: {
    value: number;
    date_range: string;
    change_percent: number;
  } | null;
  related: Array<{
    metric_id: string;
    name: string;
    change_percent: number;
    is_anomaly: boolean;
  }>;
  recommendations: Array<{
    label: string;
    params: Partial<QueryParams>;
  }>;
  validation: {
    passed: boolean;
    warnings: string[];
  };
  ui_spec: Spec;
}

export interface QueryParams {
  metric_id: string;
  time_range: string;
  dimensions?: string[];
  aggregation?: string;
  filters?: Record<string, string>;
  include_related?: boolean;
}

// Parse API types
export interface ParseResult {
  action: 'open_card' | 'update_card' | 'clarify' | 'reject';
  params?: Partial<QueryParams>;
  message?: string;
  options?: Array<{ label: string; params: Partial<QueryParams> }>;
}

// Briefing types
export interface DomainBriefing {
  domain: string;
  healthy: boolean;
  anomalies: Array<{
    metric_id: string;
    name: string;
    value: number;
    change: number;
    severity: 'warning' | 'critical';
  }>;
}

// Generate spec response (MetricQueryResult + _meta for CardState backfill)
export interface GenerateSpecResponse extends MetricQueryResult {
  _meta: {
    metric_id: string;
    time_range: string;
    dimensions: string[];
    aggregation: string;
  };
  _fallback?: boolean;
  parseResult?: ParseResult;
}

// Metrics catalog types
export interface MetricsCatalogEntry {
  domain: string;
  metrics: Array<{
    id: string;
    name: string;
    description: string;
    dimensions: string[];
    chart_type: string;
    unit: string;
    example_question: string;
  }>;
}
