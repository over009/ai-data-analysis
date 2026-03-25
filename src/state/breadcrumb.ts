import { useState, useCallback } from 'react';
import type { CardState } from '../types';

const MAX_ENTRIES = 5;

const DIM_LABELS: Record<string, string> = {
  channel: '渠道',
  sku: 'SKU',
  region: '地区',
};

const TIME_LABELS: Record<string, string> = {
  this_week: '本周',
  last_week: '上周',
  this_month: '本月',
  last_month: '上月',
};

export interface BreadcrumbEntry {
  id: string;
  label: string;
  cardSnapshot: CardState;
}

export function useBreadcrumb() {
  const [entries, setEntries] = useState<BreadcrumbEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  /** Push a new breadcrumb when a card opens or updates */
  const push = useCallback((card: CardState) => {
    const label = buildLabel(card);
    const entry: BreadcrumbEntry = {
      id: `bc-${Date.now()}`,
      label,
      cardSnapshot: { ...card },
    };

    setEntries(prev => {
      // If we're not at the end, truncate forward entries (user went back then did new action)
      const base = currentIndex >= 0 ? prev.slice(0, currentIndex + 1) : prev;
      const updated = [...base, entry].slice(-MAX_ENTRIES);
      return updated;
    });
    setCurrentIndex(prev => {
      const base = prev >= 0 ? Math.min(prev + 1, MAX_ENTRIES - 1) : 0;
      return base;
    });
  }, [currentIndex]);

  /** Navigate to a specific breadcrumb entry — returns the cached card snapshot */
  const goTo = useCallback((index: number): CardState | null => {
    if (index < 0 || index >= entries.length) return null;
    setCurrentIndex(index);
    return entries[index].cardSnapshot;
  }, [entries]);

  /** Clear all breadcrumbs */
  const clear = useCallback(() => {
    setEntries([]);
    setCurrentIndex(-1);
  }, []);

  // Visible entries (collapse early ones to "..." if > MAX_ENTRIES)
  const visibleEntries = entries;
  const hasOverflow = entries.length > MAX_ENTRIES;

  return {
    entries: visibleEntries,
    currentIndex,
    hasEntries: entries.length > 0,
    push,
    goTo,
    clear,
  };
}

function buildLabel(card: CardState): string {
  let label = card.metric_name || card.metric_id;
  if (card.dimensions.length > 0) {
    const dimStr = card.dimensions.map(d => DIM_LABELS[d] || d).join('+');
    label += `(按${dimStr})`;
  }
  return label;
}
