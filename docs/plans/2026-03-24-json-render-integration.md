# json-render 库集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom lightweight Renderer with `@json-render/core` + `@json-render/react`, keeping all existing UI and interactions identical.

**Architecture:** Install json-render packages, define a catalog with Zod schemas, wrap existing component implementations in json-render's `defineRegistry` format, pass `onAction`/`isDark`/`dimensionResults` via React Context instead of function arguments. Backend unchanged.

**Tech Stack:** @json-render/core, @json-render/react, zod, React Context

**Spec:** `docs/specs/2026-03-24-json-render-integration-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add dependencies |
| `src/types.ts` | Modify | Replace custom UISpec/UIElement with json-render Spec |
| `src/lib/renderer.tsx` | Rewrite | CardContext + defineCatalog + defineRegistry + re-export json-render Renderer |
| `src/lib/registry.tsx` | Rewrite | Component implementations as standard React components |
| `src/App.tsx` | Modify | Wrap Renderer with CardContext.Provider + JSONUIProvider |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant
pnpm add @json-render/core @json-render/react zod
```

- [ ] **Step 2: Verify installation**

```bash
ls node_modules/@json-render/core/dist/index.mjs && ls node_modules/@json-render/react/dist/index.mjs && echo "OK"
```

Expected: `OK`

---

### Task 2: Replace UISpec types with json-render Spec

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update types**

In `src/types.ts`:
1. Remove the custom `UISpec` and `UIElement` interfaces (lines 3-13)
2. Add import at the top: `import type { Spec } from '@json-render/core';`
3. Change `MetricQueryResult.ui_spec` type from `UISpec` to `Spec`
4. Add re-export: `export type { Spec };`

After edit, the top of the file should look like:

```typescript
// ===== Query Card Model Types =====

import type { Spec } from '@json-render/core';
export type { Spec };

export interface CardState {
  // ... (unchanged)
```

And in `MetricQueryResult`:
```typescript
  ui_spec: Spec;
```

- [ ] **Step 2: Update patchSpecForMultiDim signature**

In `src/lib/renderer.tsx`, change the import and function signature:

```typescript
import type { Spec } from '../types';

export function patchSpecForMultiDim(spec: Spec): Spec {
  const patched = structuredClone(spec) as Spec;
  if (patched.elements['chart']) {
    patched.elements['chart'] = {
      type: 'DimChartGrid',
      props: {},
      children: [],
    };
  }
  return patched;
}
```

Note: json-render's UIElement requires `children` to be `string[]` (not optional). Add `children: []` when creating elements.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant && npx tsc --noEmit 2>&1 | head -20
```

Expected: May show errors in renderer.tsx/registry.tsx (expected — they still use old types). No errors in types.ts or App.tsx.

---

### Task 3: Rewrite renderer.tsx — CardContext + Catalog + json-render re-exports

**Files:**
- Rewrite: `src/lib/renderer.tsx`

- [ ] **Step 1: Replace entire file**

Delete all current content and write:

```tsx
import React, { createContext, useContext, type ReactNode } from 'react';
import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import {
  defineRegistry,
  Renderer as JRRenderer,
  JSONUIProvider,
} from '@json-render/react';
import { z } from 'zod';
import type { Spec } from '../types';
import type { MetricQueryResult } from '../types';

// ==================== CardContext ====================

export type OnAction = (action: string, payload?: unknown) => void;

export interface CardContextValue {
  onAction: OnAction;
  isDark: boolean;
  dimensionResults: Record<string, MetricQueryResult>;
}

const CardContext = createContext<CardContextValue>({
  onAction: () => {},
  isDark: false,
  dimensionResults: {},
});

export const CardContextProvider = CardContext.Provider;
export const useCardContext = () => useContext(CardContext);

// ==================== Catalog ====================

const anyProps = z.record(z.any());

export const catalog = defineCatalog(schema, {
  components: {
    Stack: { props: anyProps, description: '垂直/水平容器' },
    MetricValue: { props: anyProps, description: '指标值+变化率' },
    Chart: { props: anyProps, description: '图表（bar/line/pie）' },
    DimChartGrid: { props: anyProps, description: '多维度图表网格' },
    DimensionChips: { props: anyProps, description: '维度切换 chips' },
    TimeChips: { props: anyProps, description: '时间范围选择' },
    TrendChip: { props: anyProps, description: '趋势切换' },
    RelatedAlerts: { props: anyProps, description: '关联指标异常提示' },
    Recommendations: { props: anyProps, description: '推荐操作 chips' },
    Warnings: { props: anyProps, description: '数据验证警告' },
  },
  actions: {},
});

// ==================== Renderer Wrapper ====================

interface CardRendererProps {
  spec: Spec;
  onAction: OnAction;
  isDark: boolean;
  dimensionResults: Record<string, MetricQueryResult>;
}

export function CardRenderer({ spec, onAction, isDark, dimensionResults }: CardRendererProps) {
  // registry is imported from registry.tsx — circular import avoided by lazy import
  // We pass it as a prop from App.tsx instead
  return null; // Placeholder — will be replaced in Task 5 when App.tsx is updated
}

// ==================== Helpers ====================

export function patchSpecForMultiDim(spec: Spec): Spec {
  const patched = structuredClone(spec) as Spec;
  if (patched.elements['chart']) {
    patched.elements['chart'] = {
      type: 'DimChartGrid',
      props: {},
      children: [],
    };
  }
  return patched;
}

// Re-export json-render components for App.tsx
export { JRRenderer as Renderer, JSONUIProvider };
```

Note: The `CardRenderer` is a placeholder. The actual wiring happens in Task 5 after registry is ready.

---

### Task 4: Rewrite registry.tsx — defineRegistry + Impl components

**Files:**
- Rewrite: `src/lib/registry.tsx`

This is the largest task. We convert each component from a bare function `(props, children, onAction, context) => ReactNode` to a standard React component, then register them via `defineRegistry`.

- [ ] **Step 1: Replace entire file**

Delete all current content and write:

```tsx
import React from 'react';
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
import { defineRegistry } from '@json-render/react';
import { catalog, useCardContext } from './renderer';
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

export const DIM_LABELS: Record<string, string> = {
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

// ==================== defineRegistry ====================

export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }) => {
      const p = props as Record<string, any>;
      const isHorizontal = p.direction === 'horizontal';
      return (
        <div
          className={cn(
            'flex',
            isHorizontal ? 'flex-row items-center' : 'flex-col',
            isHorizontal && p.wrap && 'flex-wrap',
            GAP_MAP[p.gap as string] || 'gap-4',
          )}
        >
          {children}
        </div>
      );
    },

    MetricValue: ({ props }) => {
      const p = props as Record<string, any>;
      return (
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-3xl font-semibold tracking-tight">
              {formatValue(p.value as number, p.unit as string)}
            </span>
            {p.change !== null && p.change !== undefined && (
              <span
                className={cn(
                  'flex items-center text-sm font-medium px-2 py-0.5 rounded-md',
                  (p.change as number) >= 0
                    ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10'
                    : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10',
                )}
              >
                {(p.change as number) >= 0 ? (
                  <ArrowUpRight size={16} className="mr-1" />
                ) : (
                  <ArrowDownRight size={16} className="mr-1" />
                )}
                {Math.abs(p.change as number)}%
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {p.description as string} · {p.dateRange as string}
          </p>
        </div>
      );
    },

    Chart: ({ props }) => {
      const p = props as Record<string, any>;
      const { isDark } = useCardContext();
      const chartData = rowsToChartData(p.rows as Array<Record<string, string | number>>);
      const chartType = p.chartType as string;

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
    },

    DimChartGrid: ({ props }) => {
      const { isDark, dimensionResults } = useCardContext();
      const entries = Object.entries(dimensionResults);
      if (entries.length === 0) return null;

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
    },

    DimensionChips: ({ props }) => {
      const p = props as Record<string, any>;
      const { onAction } = useCardContext();
      const options = p.options as string[];
      const active = p.active as string[];

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
    },

    TimeChips: ({ props }) => {
      const p = props as Record<string, any>;
      const { onAction } = useCardContext();
      const active = p.active as string;

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
    },

    TrendChip: ({ props }) => {
      const p = props as Record<string, any>;
      const { onAction } = useCardContext();
      const active = p.active as boolean;

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
    },

    RelatedAlerts: ({ props }) => {
      const p = props as Record<string, any>;
      const { onAction } = useCardContext();
      const items = p.items as Array<{ metric_id: string; name: string; change_percent: number }>;

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
    },

    Recommendations: ({ props }) => {
      const p = props as Record<string, any>;
      const { onAction } = useCardContext();
      const items = p.items as Array<{ label: string; params: Record<string, unknown> }>;

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
    },

    Warnings: ({ props }) => {
      const p = props as Record<string, any>;
      const messages = p.messages as string[];

      return (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          {messages.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      );
    },
  },
});
```

- [ ] **Step 2: Verify file created and no syntax errors**

```bash
wc -l src/lib/registry.tsx
```

Expected: ~300 lines

---

### Task 5: Update App.tsx — wire up json-render Renderer

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update imports**

Replace:
```typescript
import { Renderer, patchSpecForMultiDim, type OnAction } from './lib/renderer';
import { registry, formatValue, DIM_LABELS } from './lib/registry';
```

With:
```typescript
import { Renderer, JSONUIProvider, CardContextProvider, patchSpecForMultiDim, type OnAction } from './lib/renderer';
import { registry, formatValue, DIM_LABELS } from './lib/registry';
```

- [ ] **Step 2: Update QueryCard Renderer usage**

Find the `<Renderer>` usage inside the QueryCard function. Replace:

```tsx
      <Renderer
        spec={spec}
        registry={registry}
        onAction={onAction}
        context={{ isDark, dimensionResults: card.dimensionResults || {} }}
      />
```

With:

```tsx
      <CardContextProvider value={{ onAction, isDark, dimensionResults: card.dimensionResults || {} }}>
        <JSONUIProvider registry={registry} initialState={{}}>
          <Renderer spec={spec} registry={registry} />
        </JSONUIProvider>
      </CardContextProvider>
```

- [ ] **Step 3: Clean up renderer.tsx placeholder**

Now that App.tsx directly uses `Renderer`/`JSONUIProvider`/`CardContextProvider`, remove the placeholder `CardRenderer` function from `src/lib/renderer.tsx`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

---

### Task 6: Test in browser

**Files:** None (verification only)

- [ ] **Step 1: Start dev servers**

```bash
cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant
npx tsx server/index.ts > /tmp/server.log 2>&1 &
npx vite --port 5173 > /tmp/vite.log 2>&1 &
sleep 10 && curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

Expected: `200`

- [ ] **Step 2: Verify basic card rendering**

Open http://localhost:5173. Click domain card example query. Verify MetricValue + Chart + Chips render.

- [ ] **Step 3: Verify dimension toggle**

Click dimension chip → chart updates. Click second dimension → DimChartGrid grid.

- [ ] **Step 4: Verify time + trend**

Click time button → data refreshes. Click 趋势 → line chart.

- [ ] **Step 5: Verify related alerts + recommendations**

Yellow alert for anomalous metrics. Recommendation chips clickable.

- [ ] **Step 6: Verify other features**

Collapse/expand, pin, breadcrumb, export — all functional.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "[ai-data-analysis] json-render 库集成：替换自写 Renderer

- 引入 @json-render/core + @json-render/react + zod
- defineCatalog 定义 10 个组件 catalog
- defineRegistry 注册组件，通过 CardContext 传递 onAction/isDark
- UISpec 类型替换为 json-render Spec
- UI 和交互不变

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
