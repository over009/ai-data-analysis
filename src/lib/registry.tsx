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
      const entries = Object.entries(dimensionResults) as [string, MetricQueryResult][];
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

    TrendChip: ({ props, emit }) => {
      const p = props as Record<string, any>;
      const active = p.active as boolean;

      return (
        <button
          onClick={() => emit('press')}
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
  actions: {
    toggleTrend: async () => {
      // Action handled by JSONUIProvider handlers in App.tsx
    },
  },
});
