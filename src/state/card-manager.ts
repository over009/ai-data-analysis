import { useState, useCallback } from 'react';
import type { CardState, QueryParams, MetricQueryResult } from '../types';
import { queryMetric, generateSpec } from '../lib/api';

const MAX_CARDS = 5;

let cardIdCounter = 0;
function nextId(): string {
  return `card-${++cardIdCounter}-${Date.now()}`;
}

export function useCardManager() {
  const [cards, setCards] = useState<CardState[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'focus' | 'dashboard'>('focus');

  const activeCard = cards.find(c => c.id === activeCardId) || null;

  /** Open a new card — either from NL input or structured params */
  const openCard = useCallback(async (
    params: (QueryParams & { source?: CardState['source'] }) | { input: string; source?: CardState['source'] },
  ): Promise<any> => {
    const id = nextId();
    const isNLInput = 'input' in params && !('metric_id' in params);

    const newCard: CardState = {
      id,
      metric_id: isNLInput ? '' : (params as QueryParams).metric_id,
      metric_name: '',
      dimensions: isNLInput ? [] : ((params as QueryParams).dimensions || []),
      time_range: isNLInput ? '' : (params as QueryParams).time_range,
      aggregation: isNLInput ? '' : ((params as QueryParams).aggregation || 'total'),
      input: isNLInput ? (params as { input: string }).input : undefined,
      source: params.source || 'query',
      status: 'loading',
      result: null,
      dimensionResults: {},
      created_at: Date.now(),
    };

    setCards(prev => [newCard, ...prev].slice(0, MAX_CARDS));
    setActiveCardId(id);
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    try {
      if (isNLInput) {
        // AI generate spec path — with SSE status updates
        const response = await generateSpec(
          (params as { input: string }).input,
          undefined,
          (statusText) => {
            setCards(prev => prev.map(c =>
              c.id === id ? { ...c, statusText } : c
            ));
          },
        );

        // Handle fallback parse results (clarify/reject)
        if ((response as any)._fallback && (response as any).parseResult) {
          setCards(prev => prev.filter(c => c.id !== id));
          setActiveCardId(null);
          return (response as any).parseResult;
        }

        // Backfill CardState from _meta
        const meta = response._meta;
        setCards(prev => prev.map(c =>
          c.id === id
            ? {
                ...c,
                status: 'success' as const,
                result: response,
                metric_id: meta.metric_id,
                metric_name: response.metric.name,
                dimensions: meta.dimensions || [],
                time_range: meta.time_range,
                aggregation: meta.aggregation || 'total',
              }
            : c
        ));
      } else {
        // Structured params path (existing behavior)
        const qp = params as QueryParams;
        const result = await queryMetric({
          metric_id: qp.metric_id,
          time_range: qp.time_range,
          dimensions: qp.dimensions,
          aggregation: qp.aggregation,
          filters: qp.filters,
          include_related: true,
        });

        setCards(prev => prev.map(c =>
          c.id === id
            ? { ...c, status: 'success' as const, result, metric_name: result.metric.name }
            : c
        ));
      }
    } catch (err) {
      setCards(prev => prev.map(c =>
        c.id === id
          ? { ...c, status: 'error' as const, error: (err as Error).message }
          : c
      ));
    }
  }, []);

  /** Update current card in-place (dimension/time switch) */
  const updateCard = useCallback(async (cardId: string, updates: Partial<QueryParams>) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    const newDimensions = updates.dimensions ?? card.dimensions;
    const newTimeRange = updates.time_range ?? card.time_range;
    const newAggregation = updates.aggregation ?? card.aggregation;

    // Multi-dimension: query each dimension separately
    if (newDimensions.length > 1) {
      setCards(prev => prev.map(c =>
        c.id === cardId
          ? { ...c, status: 'loading', dimensions: newDimensions, time_range: newTimeRange, aggregation: newAggregation }
          : c
      ));

      try {
        const results = await Promise.all(
          newDimensions.map(dim =>
            queryMetric({
              metric_id: card.metric_id,
              time_range: newTimeRange,
              dimensions: [dim],
              aggregation: newAggregation,
              include_related: false,
            })
          )
        );

        const dimResults: Record<string, MetricQueryResult> = {};
        newDimensions.forEach((dim, i) => {
          dimResults[dim] = results[i];
        });

        setCards(prev => prev.map(c =>
          c.id === cardId
            ? { ...c, status: 'success', result: results[0], dimensionResults: dimResults, metric_name: results[0].metric.name }
            : c
        ));
      } catch (err) {
        setCards(prev => prev.map(c =>
          c.id === cardId
            ? { ...c, status: 'error', error: (err as Error).message }
            : c
        ));
      }
      return;
    }

    // Single or no dimension
    setCards(prev => prev.map(c =>
      c.id === cardId
        ? { ...c, status: 'loading', dimensions: newDimensions, time_range: newTimeRange, aggregation: newAggregation, dimensionResults: {} }
        : c
    ));

    try {
      const result = await queryMetric({
        metric_id: card.metric_id,
        time_range: newTimeRange,
        dimensions: newDimensions,
        aggregation: newAggregation,
        filters: updates.filters,
        include_related: true,
      });

      setCards(prev => prev.map(c =>
        c.id === cardId
          ? { ...c, status: 'success', result }
          : c
      ));
    } catch (err) {
      setCards(prev => prev.map(c =>
        c.id === cardId
          ? { ...c, status: 'error', error: (err as Error).message }
          : c
      ));
    }
  }, [cards]);

  /** Expand a card (set as active in focus mode) */
  const expandCard = useCallback((cardId: string) => {
    setActiveCardId(cardId);
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });
  }, []);

  /** Collapse active card (focus mode) */
  const collapseCard = useCallback(() => {
    setActiveCardId(null);
  }, []);

  /** Toggle a card's expanded state (dashboard mode) */
  const toggleCardExpanded = useCallback((cardId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  /** Check if a card is expanded (dashboard mode) */
  const isCardExpanded = useCallback((cardId: string) => {
    return expandedIds.has(cardId);
  }, [expandedIds]);

  /** Remove a card */
  const removeCard = useCallback((cardId: string) => {
    setCards(prev => prev.filter(c => c.id !== cardId));
    if (activeCardId === cardId) {
      setActiveCardId(null);
    }
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  }, [activeCardId]);

  /** Toggle between focus and dashboard view modes */
  const toggleViewMode = useCallback(() => {
    setViewMode(prev => prev === 'focus' ? 'dashboard' : 'focus');
  }, []);

  /** Reorder cards by moving a card from one index to another */
  const reorderCards = useCallback((fromIndex: number, toIndex: number) => {
    setCards(prev => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  const hasCards = cards.length > 0;

  return {
    cards,
    activeCard,
    activeCardId,
    hasCards,
    viewMode,
    openCard,
    updateCard,
    expandCard,
    collapseCard,
    toggleCardExpanded,
    isCardExpanded,
    removeCard,
    reorderCards,
    toggleViewMode,
  };
}
