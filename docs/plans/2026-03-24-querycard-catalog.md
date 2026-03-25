# QueryCard Catalog 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded QueryCard JSX with spec-driven rendering — backend returns UISpec, frontend Renderer recursively renders from registry.

**Architecture:** Backend `buildUISpec()` assembles a flat elements map describing card content blocks. Frontend lightweight Renderer (~50 lines) recursively looks up components from a registry. QueryCard becomes a thin shell (header + Renderer). Interactions bubble up via `onAction` callback.

**Tech Stack:** TypeScript, React, Recharts, Tailwind CSS, Express

**Spec:** `docs/specs/2026-03-24-querycard-catalog-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/lib/types.ts` | Modify | Add UISpec/UIElement types, add ui_spec to MetricQueryResult |
| `server/lib/tools/query-metric.ts` | Modify | Add buildUISpec(), attach ui_spec to queryMetric() return |
| `src/types.ts` | Modify | Add UISpec/UIElement types, add ui_spec to MetricQueryResult |
| `src/lib/renderer.tsx` | Create | Renderer component + patchSpecForMultiDim helper |
| `src/lib/registry.tsx` | Create | 10 component functions + props interfaces + helpers |
| `src/App.tsx` | Modify | Slim QueryCard to shell + Renderer, add handleCardAction |

---

### Task 1: Add UISpec types (backend + frontend)

**Files:**
- Modify: `server/lib/types.ts:60-90`
- Modify: `src/types.ts:19-52`

- [ ] **Step 1: Add UISpec/UIElement to server types**

In `server/lib/types.ts`, add before the `ValidationResult` interface (line 92):

```typescript
// UI Spec types (json-render style flat elements map)
export interface UISpec {
  root: string;
  elements: Record<string, UIElement>;
}

export interface UIElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}
```

Then add `ui_spec` to `MetricQueryResult` (after `validation` field, line 89):

```typescript
  validation: ValidationResult;
  ui_spec: UISpec;
```

- [ ] **Step 2: Add UISpec/UIElement to frontend types**

In `src/types.ts`, add at the top (after line 1):

```typescript
// UI Spec types (json-render style flat elements map)
export interface UISpec {
  root: string;
  elements: Record<string, UIElement>;
}

export interface UIElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}
```

Then add `ui_spec` to `MetricQueryResult` (after `validation` field, line 51):

```typescript
  validation: {
    passed: boolean;
    warnings: string[];
  };
  ui_spec: UISpec;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant && npx tsc --noEmit 2>&1 | head -20`

Expected: Errors about missing `ui_spec` in `queryMetric()` return — this is correct, we fix it in Task 2.

---

### Task 2: Backend buildUISpec()

**Files:**
- Modify: `server/lib/tools/query-metric.ts`

- [ ] **Step 1: Add buildUISpec function**

Add this function at the end of `server/lib/tools/query-metric.ts` (before the `QueryError` class):

```typescript
function buildUISpec(
  result: MetricQueryResult,
  params: QueryParams,
  metric: MetricDefinition,
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

  // 2. Chart (always single-dim version; frontend patches for multi-dim)
  const chartType = params.aggregation === 'daily' ? 'line' : result.metric.chart_type;
  elements['chart'] = {
    type: 'Chart',
    props: {
      chartType,
      rows: result.current.rows,
    },
  };
  rootChildren.push('chart');

  // 3. Interaction chips: dimensions + time + trend
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
    props: {
      active: params.time_range,
    },
  };
  elements['trend-chip'] = {
    type: 'TrendChip',
    props: {
      active: params.aggregation === 'daily',
    },
  };
  rootChildren.push('chips');

  // 4. Related alerts (only if anomalies exist)
  const anomalies = result.related.filter(r => r.is_anomaly);
  if (anomalies.length > 0) {
    elements['alerts'] = {
      type: 'RelatedAlerts',
      props: { items: anomalies },
    };
    rootChildren.push('alerts');
  }

  // 5. Recommendations (only if present)
  if (result.recommendations.length > 0) {
    elements['recs'] = {
      type: 'Recommendations',
      props: { items: result.recommendations },
    };
    rootChildren.push('recs');
  }

  // 6. Validation warnings (only if present)
  if (result.validation.warnings.length > 0) {
    elements['warnings'] = {
      type: 'Warnings',
      props: { messages: result.validation.warnings },
    };
    rootChildren.push('warnings');
  }

  // Root container
  elements['root'] = {
    type: 'Stack',
    props: { direction: 'vertical', gap: 'md' },
    children: rootChildren,
  };

  return { root: 'root', elements };
}
```

Also add the import at the top of the file:

```typescript
import type { UISpec, UIElement, MetricDefinition } from '../types.js';
```

- [ ] **Step 2: Wire buildUISpec into queryMetric()**

In the `queryMetric()` function, the return statement (around line 90) currently returns an object literal. Add `ui_spec` to it. Change the return block to:

```typescript
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
    ui_spec: { root: '', elements: {} }, // placeholder
  };

  queryResult.ui_spec = buildUISpec(queryResult, params, metric);

  return queryResult;
```

Note: We build the result first with a placeholder, then call `buildUISpec` because it needs the complete `MetricQueryResult` (with related, recommendations, validation).

- [ ] **Step 3: Verify backend compiles**

Run: `cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant && npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

Expected: No backend errors (frontend may still have issues).

---

### Task 3: Frontend Renderer

**Files:**
- Create: `src/lib/renderer.tsx`

- [ ] **Step 1: Create the Renderer component**

Create `src/lib/renderer.tsx`:

```tsx
import React, { type ReactNode } from 'react';
import type { UISpec } from '../types';

export type OnAction = (action: string, payload?: unknown) => void;

export interface RenderContext {
  isDark: boolean;
  dimensionResults: Record<string, any>;
}

export type ComponentFn = (
  props: Record<string, any>,
  children: ReactNode[],
  onAction: OnAction,
  context: RenderContext,
) => ReactNode;

export type Registry = Record<string, ComponentFn>;

interface RendererProps {
  spec: UISpec;
  registry: Registry;
  onAction: OnAction;
  context: RenderContext;
}

const MAX_DEPTH = 10;

export function Renderer({ spec, registry, onAction, context }: RendererProps) {
  function renderElement(key: string, depth: number): ReactNode {
    if (depth > MAX_DEPTH) return null;

    const el = spec.elements[key];
    if (!el) return null;

    const Component = registry[el.type];
    if (!Component) {
      if (import.meta.env.DEV) {
        console.warn(`[Renderer] Unknown component type: "${el.type}"`);
      }
      return null;
    }

    const children = (el.children || []).map(childKey =>
      renderElement(childKey, depth + 1)
    );

    return (
      <React.Fragment key={key}>
        {Component(el.props as Record<string, any>, children, onAction, context)}
      </React.Fragment>
    );
  }

  return <>{renderElement(spec.root, 0)}</>;
}

/**
 * Patch a single-dim spec to show DimChartGrid when multiple dimensions are active.
 * Replaces the Chart element with DimChartGrid (data injected via context).
 */
export function patchSpecForMultiDim(spec: UISpec): UISpec {
  const patched = JSON.parse(JSON.stringify(spec)) as UISpec;
  if (patched.elements['chart']) {
    patched.elements['chart'] = {
      type: 'DimChartGrid',
      props: {},
    };
  }
  return patched;
}
```

- [ ] **Step 2: Verify file created**

Run: `ls -la /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant/src/lib/renderer.tsx`

Expected: File exists.

---

### Task 4: Frontend Registry

**Files:**
- Create: `src/lib/registry.tsx`

- [ ] **Step 1: Create the registry with all 10 components**

Create `src/lib/registry.tsx`. This is the largest file — it contains all component implementations extracted from the current QueryCard. Every component preserves the existing Tailwind classes and Recharts usage exactly.

```tsx
import React, { type ReactNode } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownRight,
  Lightbulb,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ComponentFn, OnAction, RenderContext, Registry } from './renderer';
import type { MetricQueryResult } from '../types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ==================== Helpers ====================

export function rowsToChartData(
  rows: Array<Record<string, string | number>>,
): Array<{ name: string; value: number }> {
  if (rows.length === 0) return [];
  return rows.map(row => {
    const keys = Object.keys(row).filter(k => k !== 'value');
    const label = keys.length > 0 ? String(row[keys[0]]) : '';
    return { name: label, value: row.value as number };
  });
}

export function formatValue(value: number, unit: string): string {
  if (unit === '$') return `$${value.toLocaleString()}`;
  if (unit === '%') return `${value}%`;
  return `${value.toLocaleString()} ${unit}`;
}

const DIM_LABELS: Record<string, string> = {
  channel: '按渠道',
  sku: '按SKU',
  region: '按地区',
};

const TIME_OPTIONS = [
  { value: 'this_week', label: '本周' },
  { value: 'last_week', label: '上周' },
  { value: 'this_month', label: '本月' },
  { value: 'last_month', label: '上月' },
];

const GAP_MAP: Record<string, string> = {
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
};

// ==================== Components ====================

const Stack: ComponentFn = (props, children) => {
  const isHorizontal = props.direction === 'horizontal';
  return (
    <div
      className={cn(
        'flex',
        isHorizontal ? 'flex-row items-center' : 'flex-col',
        isHorizontal && props.wrap && 'flex-wrap',
        GAP_MAP[props.gap as string] || 'gap-4',
      )}
    >
      {children}
    </div>
  );
};

const MetricValue: ComponentFn = (props) => (
  <div>
    <div className="flex items-baseline gap-3 mb-1">
      <span className="text-3xl font-semibold tracking-tight">
        {formatValue(props.value as number, props.unit as string)}
      </span>
      {props.change !== null && props.change !== undefined && (
        <span
          className={cn(
            'flex items-center text-sm font-medium px-2 py-0.5 rounded-md',
            (props.change as number) >= 0
              ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10'
              : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10',
          )}
        >
          {(props.change as number) >= 0 ? (
            <ArrowUpRight size={16} className="mr-1" />
          ) : (
            <ArrowDownRight size={16} className="mr-1" />
          )}
          {Math.abs(props.change as number)}%
        </span>
      )}
    </div>
    <p className="text-xs text-slate-400 dark:text-slate-500">
      {props.description as string} · {props.dateRange as string}
    </p>
  </div>
);

const Chart: ComponentFn = (props, _children, _onAction, context) => {
  const chartData = rowsToChartData(props.rows as Array<Record<string, string | number>>);
  const chartType = props.chartType as string;
  const isDark = context.isDark;

  if (chartData.length <= 1) return null;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chartType === 'line' ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: isDark ? '#94a3b8' : '#64748b' }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: isDark ? '#94a3b8' : '#64748b' }} dx={-10} />
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', backgroundColor: isDark ? '#1e293b' : '#fff' }} />
            <Line type="monotone" dataKey="value" stroke="#0d9488" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
          </LineChart>
        ) : chartType === 'pie' ? (
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={['#2dd4bf', '#0d9488', '#115e59', '#134e4a', '#0f766e'][i % 5]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
          </PieChart>
        ) : (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: isDark ? '#94a3b8' : '#64748b' }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: isDark ? '#94a3b8' : '#64748b' }} dx={-10} />
            <Tooltip cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', backgroundColor: isDark ? '#1e293b' : '#fff' }} />
            <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
};

const DimChartGrid: ComponentFn = (_props, _children, _onAction, context) => {
  const dimResults = context.dimensionResults as Record<string, MetricQueryResult>;
  const entries = Object.entries(dimResults);
  if (entries.length === 0) return null;
  const isDark = context.isDark;

  return (
    <div className={cn('grid gap-4', entries.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {entries.map(([dim, dimResult]) => {
        const dimData = rowsToChartData(dimResult.current.rows);
        return (
          <div key={dim} className="bg-slate-50 dark:bg-slate-900/30 rounded-xl p-3">
            <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              {DIM_LABELS[dim] || dim}
            </h4>
            <div className="h-40 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dimData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} dy={8} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: isDark ? '#94a3b8' : '#64748b' }} dx={-5} width={40} />
                  <Tooltip cursor={{ fill: isDark ? '#1e293b' : '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', backgroundColor: isDark ? '#1e293b' : '#fff', fontSize: 12 }} />
                  <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const DimensionChips: ComponentFn = (props, _children, onAction) => {
  const options = props.options as string[];
  const active = props.active as string[];

  return (
    <>
      {options.map(dim => (
        <button
          key={dim}
          onClick={() => onAction('toggleDimension', dim)}
          className={cn(
            'text-xs py-1.5 px-3 rounded-full border transition-colors',
            active.includes(dim)
              ? 'bg-teal-600 text-white border-teal-600'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
          )}
        >
          {DIM_LABELS[dim] || dim}
        </button>
      ))}
      <div className="w-px bg-slate-200 dark:bg-slate-700 mx-1" />
    </>
  );
};

const TimeChips: ComponentFn = (props, _children, onAction) => {
  const active = props.active as string;

  return (
    <>
      {TIME_OPTIONS.map(t => (
        <button
          key={t.value}
          onClick={() => onAction('changeTime', t.value)}
          className={cn(
            'text-xs py-1.5 px-3 rounded-full border transition-colors',
            active === t.value
              ? 'bg-slate-800 text-white border-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
          )}
        >
          {t.label}
        </button>
      ))}
      <div className="w-px bg-slate-200 dark:bg-slate-700 mx-1" />
    </>
  );
};

const TrendChip: ComponentFn = (props, _children, onAction) => {
  const active = props.active as boolean;

  return (
    <button
      onClick={() => onAction('toggleTrend')}
      className={cn(
        'text-xs py-1.5 px-3 rounded-full border transition-colors flex items-center gap-1',
        active
          ? 'bg-teal-600 text-white border-teal-600'
          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700',
      )}
    >
      <TrendingUp size={12} />
      趋势
    </button>
  );
};

const RelatedAlerts: ComponentFn = (props, _children, onAction) => {
  const items = props.items as Array<{ metric_id: string; name: string; change_percent: number }>;

  return (
    <>
      {items.map(r => (
        <div
          key={r.metric_id}
          className="flex items-center justify-between text-sm text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-500/10 px-4 py-2.5 rounded-xl border border-amber-100 dark:border-amber-500/20 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
          onClick={() => onAction('openRelated', r.metric_id)}
        >
          <div className="flex items-center gap-2">
            <Lightbulb size={16} />
            <span>
              关联：{r.name} {r.change_percent >= 0 ? '↑' : '↓'}
              {Math.abs(r.change_percent)}%
            </span>
          </div>
          <ChevronRight size={16} />
        </div>
      ))}
    </>
  );
};

const Recommendations: ComponentFn = (props, _children, onAction) => {
  const items = props.items as Array<{ label: string; params: Record<string, unknown> }>;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((rec, i) => (
        <button
          key={i}
          onClick={() => onAction('recommend', rec.params)}
          className="text-xs bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-2 px-3 rounded-full transition-colors border border-slate-200 dark:border-slate-700"
        >
          {rec.label}
        </button>
      ))}
    </div>
  );
};

const Warnings: ComponentFn = (props) => {
  const messages = props.messages as string[];

  return (
    <div className="text-xs text-amber-600 dark:text-amber-400">
      {messages.map((w, i) => (
        <p key={i}>⚠ {w}</p>
      ))}
    </div>
  );
};

// ==================== Registry ====================

export const registry: Registry = {
  Stack,
  MetricValue,
  Chart,
  DimChartGrid,
  DimensionChips,
  TimeChips,
  TrendChip,
  RelatedAlerts,
  Recommendations,
  Warnings,
};
```

- [ ] **Step 2: Verify file created**

Run: `ls -la /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant/src/lib/registry.tsx`

Expected: File exists.

---

### Task 5: Slim down QueryCard in App.tsx

**Files:**
- Modify: `src/App.tsx`

This is the main integration task. We replace the 250-line QueryCard body with a ~30-line shell that uses Renderer.

- [ ] **Step 1: Add imports**

At the top of `src/App.tsx`, add after the existing imports (around line 46):

```typescript
import { Renderer, patchSpecForMultiDim, type OnAction } from './lib/renderer';
import { registry } from './lib/registry';
import { formatValue } from './lib/registry';
```

Remove these imports that are no longer needed directly in App.tsx (they moved to registry.tsx):
- Remove `ArrowUpRight`, `ArrowDownRight`, `Lightbulb`, `TrendingUp` from lucide-react import
- Remove `BarChart`, `Bar`, `LineChart`, `Line`, `PieChart`, `Pie`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`, `Cell` from recharts import

Keep the recharts import line but empty it — or remove entirely if no other component in App.tsx uses it. Check: `CollapsedCard` and `DomainCard` don't use recharts directly. `SingleChart` is being moved to registry. So **remove the entire recharts import**.

- [ ] **Step 2: Replace QueryCard function**

Replace the entire `QueryCard` function (lines 679-930) and the `SingleChart` function (lines 933-973) with this slimmed version:

```tsx
function QueryCard({
  card,
  theme,
  isPinned,
  onTogglePin,
  onAction,
  onExport,
  onCollapse,
  onRemove,
}: {
  card: CardState;
  theme: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onAction: OnAction;
  onExport: () => void;
  onCollapse: () => void;
  onRemove: () => void;
}) {
  const result = card.result;
  const isDark = theme === 'dark';
  const isTrend = card.aggregation === 'daily';
  const hasMultiDim = Object.keys(card.dimensionResults || {}).length > 1;

  if (card.status === 'loading') {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700/50 animate-pulse">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-3" />
        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-6" />
        <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
        <div className="flex gap-2">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
        </div>
      </div>
    );
  }

  if (card.status === 'error') {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-red-200 dark:border-red-900/50">
        <p className="text-red-600 dark:text-red-400 text-sm">{card.error || '查询失败'}</p>
      </div>
    );
  }

  if (!result?.ui_spec) return null;

  const spec = hasMultiDim ? patchSpecForMultiDim(result.ui_spec) : result.ui_spec;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700/50">
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {result.metric.name}
          {card.dimensions.length > 0 && (
            <span className="text-slate-400 dark:text-slate-500">
              （{card.dimensions.map(d => DIM_LABELS[d] || d).join('+')}）
            </span>
          )}
          {isTrend && (
            <span className="text-teal-500 dark:text-teal-400 ml-1">· 趋势</span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={onTogglePin}
            className={cn(
              'transition-colors p-1',
              isPinned
                ? 'text-teal-600 dark:text-teal-400'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
            )}
            title={isPinned ? '取消收藏' : '收藏'}
          >
            <Pin size={16} className={isPinned ? 'fill-current' : ''} />
          </button>
          <button
            onClick={onCollapse}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1"
            title="折叠"
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={onRemove}
            className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
            title="移除"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Spec-driven content */}
      <Renderer
        spec={spec}
        registry={registry}
        onAction={onAction}
        context={{ isDark, dimensionResults: card.dimensionResults || {} }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Update QueryCard call sites in App.tsx**

Find where `QueryCard` is rendered (around line 394-450). The current props include individual handlers like `onDimensionClick`, `onTrendToggle`, `onTimeClick`, `onRelatedClick`, `onRecommendClick`. Replace them with a single `onAction` prop.

Before the QueryCard rendering block, add a handler factory:

```typescript
const makeCardAction = (cardId: string): OnAction => (action, payload) => {
  switch (action) {
    case 'toggleDimension': {
      const dim = payload as string;
      const card = cardManager.cards.find(c => c.id === cardId);
      if (!card) return;
      const dims = card.dimensions.includes(dim)
        ? card.dimensions.filter(d => d !== dim)
        : [...card.dimensions, dim];
      cardManager.updateCard(cardId, { dimensions: dims });
      break;
    }
    case 'changeTime':
      cardManager.updateCard(cardId, { time_range: payload as string });
      break;
    case 'toggleTrend': {
      const card = cardManager.cards.find(c => c.id === cardId);
      if (!card) return;
      const newAgg = card.aggregation === 'daily' ? 'total' : 'daily';
      cardManager.updateCard(cardId, { aggregation: newAgg });
      break;
    }
    case 'openRelated':
      handleMetricClick(payload as string, 'related');
      break;
    case 'recommend':
      cardManager.openCard({
        ...(payload as Record<string, any>),
        time_range: (payload as any).time_range || inferDefaultTimeRange(),
        source: 'query',
      });
      break;
  }
};
```

Then update the QueryCard JSX call. Replace the old individual handler props:

```tsx
<QueryCard
  card={card}
  theme={theme}
  isPinned={pinnedCards.isPinned(card.metric_id)}
  onTogglePin={() => { /* existing pin logic */ }}
  onAction={makeCardAction(card.id)}
  onExport={handleExport}
  onCollapse={() => cardManager.collapseCard()}
  onRemove={() => cardManager.removeCard(card.id)}
/>
```

- [ ] **Step 4: Remove dead code**

Remove these functions from App.tsx that are now in `registry.tsx`:
- `SingleChart` function (lines 933-973)
- `rowsToChartData` function (lines 1033-1039)
- `formatValue` function (lines 1042-1050) — BUT keep the import from registry for `CollapsedCard` usage

Check if `CollapsedCard` uses `formatValue` — yes it does (line 997). So update it to use the imported version:

```typescript
import { formatValue } from './lib/registry';
```

Remove the local `formatValue` and `rowsToChartData` definitions.

Also remove `DIM_LABELS` and `TIME_OPTIONS` from App.tsx IF they are not used elsewhere. Check: `DIM_LABELS` is used in the QueryCard header (which we kept). So keep `DIM_LABELS` in App.tsx. `TIME_OPTIONS` is no longer used in App.tsx (moved to registry). Remove it.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant && npx tsc --noEmit 2>&1 | head -30`

Expected: No errors.

---

### Task 6: Test in browser

**Files:** None (verification only)

- [ ] **Step 1: Start the dev servers**

Run in two terminals:
```bash
cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant
# Terminal 1: backend
npx tsx server/index.ts &
# Terminal 2: frontend
npx vite --port 5173 &
```

- [ ] **Step 2: Verify basic card rendering**

Open `http://localhost:5173`. Click a domain card to open a metric. Verify:
- MetricValue shows (big number + change %)
- Chart renders (bar chart)
- Dimension chips show and are clickable
- Time chips show with correct active state
- Trend chip shows

- [ ] **Step 3: Verify dimension toggle**

Click a dimension chip (e.g., "按渠道"). Verify:
- Chip becomes active (teal background)
- Chart updates with dimension data
- Click a second dimension → DimChartGrid appears (grid of mini charts)
- Deselect to go back to single chart

- [ ] **Step 4: Verify time switch**

Click a different time button. Verify:
- Active button style updates
- Data refreshes with new time range

- [ ] **Step 5: Verify trend toggle**

Click "趋势" chip. Verify:
- Chart switches to line chart
- Click again to go back to bar

- [ ] **Step 6: Verify related alerts + recommendations**

Check if the card shows:
- Yellow alert for anomalous related metrics (click to open new card)
- Recommendation chips at bottom (click to open new card)

- [ ] **Step 7: Verify other features unaffected**

Test:
- Collapse/expand cards
- Pin/unpin
- Breadcrumb navigation
- Export (camera button)
- NL query input

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "[ai-data-analysis] QueryCard catalog 化：spec 驱动渲染

- 后端 buildUISpec() 生成扁平 elements map
- 前端 Renderer 递归渲染 + Registry 10 个组件
- QueryCard 从 ~250 行瘦身到 ~30 行壳组件
- 交互通过 onAction 冒泡，业务逻辑在 App 层

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
