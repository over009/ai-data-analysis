import React, { createContext, useContext } from 'react';
import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import {
  Renderer as JRRenderer,
  JSONUIProvider,
} from '@json-render/react';
import { z } from 'zod';
import type { Spec, MetricQueryResult } from '../types';

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

const anyProps = z.record(z.string(), z.any());

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
  actions: {
    toggleTrend: { description: '切换趋势视图' },
  },
});

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
