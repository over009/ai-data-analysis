// Metric definition from metrics.yaml
export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  domain: string;
  sql_template: string;
  dimensions: string[];
  filters: Record<string, string>;
  chart_type: 'bar' | 'line' | 'pie';
  unit: string;
  default_aggregation: string;
  aggregations: Array<{ type: string; description: string }>;
  anomaly_threshold: {
    warning: number;
    critical: number;
  };
  related_metrics: string[];
  validations: ValidationRule[];
  example_question: string;
}

export interface ValidationRule {
  rule: string;
  min?: number;
  max?: number;
  max_abs?: number;
  message?: string;
}

export interface CorrelationGroup {
  group: string[];
  description: string;
}

export interface MetricsConfig {
  metrics: MetricDefinition[];
  correlations: CorrelationGroup[];
}

// Query types
export interface QueryParams {
  metric_id: string;
  time_range: string;
  dimensions?: string[];
  filters?: Record<string, string>;
  aggregation?: 'daily' | 'total' | 'average' | 'distinct';
  include_related?: boolean;
}

export interface QueryRow {
  [key: string]: string | number;
}

export interface QueryResult {
  value: number;
  rows: QueryRow[];
}

export interface MetricQueryResult {
  metric: {
    id: string;
    name: string;
    description: string;
    unit: string;
    chart_type: string;
  };
  current: {
    value: number;
    rows: QueryRow[];
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
  validation: ValidationResult;
  ui_spec: UISpec;
}

// UI Spec types (json-render style flat elements map)
export interface UISpec {
  root: string;
  elements: Record<string, UIElement>;
}

export interface UIElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
  on?: Record<string, { action: string; params?: Record<string, unknown> }>;
}

export interface ValidationResult {
  passed: boolean;
  warnings: string[];
}

// DataSource adapter interface
export interface DataSourceAdapter {
  query(params: QueryParams): Promise<QueryResult>;
}

// Anomaly severity
export type Severity = 'warning' | 'critical';
