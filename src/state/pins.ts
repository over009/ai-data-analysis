import { useState, useEffect, useCallback } from 'react';
import { queryMetric } from '../lib/api';
import type { CardState, MetricQueryResult } from '../types';

const STORAGE_KEY = 'pettech-pins';
const MAX_PINS = 5;

export interface PinnedCard {
  metric_id: string;
  dimensions: string[];
  time_range: string;
  aggregation: string;
  pinned_at: number;
}

export interface PinnedCardWithData extends PinnedCard {
  status: 'loading' | 'success' | 'error';
  result: MetricQueryResult | null;
  error?: string;
}

function loadPins(): PinnedCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePins(pins: PinnedCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
}

export function usePinnedCards() {
  const [pins, setPins] = useState<PinnedCard[]>(loadPins);
  const [pinData, setPinData] = useState<PinnedCardWithData[]>([]);

  // Refresh pin data on mount and when pins change
  useEffect(() => {
    if (pins.length === 0) {
      setPinData([]);
      return;
    }

    // Initialize with loading state
    setPinData(pins.map(p => ({ ...p, status: 'loading' as const, result: null })));

    // Fetch data for each pin
    pins.forEach((pin, idx) => {
      queryMetric({
        metric_id: pin.metric_id,
        time_range: pin.time_range,
        dimensions: pin.dimensions,
        aggregation: pin.aggregation,
        include_related: false,
      })
        .then(result => {
          setPinData(prev => prev.map((p, i) =>
            i === idx ? { ...p, status: 'success' as const, result } : p
          ));
        })
        .catch(err => {
          // If metric no longer exists, remove the pin
          if ((err as Error).message.includes('未知指标') || (err as Error).message.includes('404')) {
            removePin(pin.metric_id);
          } else {
            setPinData(prev => prev.map((p, i) =>
              i === idx ? { ...p, status: 'error' as const, error: (err as Error).message } : p
            ));
          }
        });
    });
  }, [pins]);

  const addPin = useCallback((card: CardState) => {
    setPins(prev => {
      // Don't duplicate
      if (prev.some(p => p.metric_id === card.metric_id && JSON.stringify(p.dimensions) === JSON.stringify(card.dimensions))) {
        return prev;
      }
      const newPin: PinnedCard = {
        metric_id: card.metric_id,
        dimensions: card.dimensions,
        time_range: card.time_range,
        aggregation: card.aggregation,
        pinned_at: Date.now(),
      };
      const updated = [newPin, ...prev].slice(0, MAX_PINS);
      savePins(updated);
      return updated;
    });
  }, []);

  const removePin = useCallback((metricId: string) => {
    setPins(prev => {
      const updated = prev.filter(p => p.metric_id !== metricId);
      savePins(updated);
      return updated;
    });
  }, []);

  const isPinned = useCallback((metricId: string): boolean => {
    return pins.some(p => p.metric_id === metricId);
  }, [pins]);

  const togglePin = useCallback((card: CardState) => {
    if (isPinned(card.metric_id)) {
      removePin(card.metric_id);
    } else {
      addPin(card);
    }
  }, [isPinned, addPin, removePin]);

  return {
    pins: pinData,
    hasPins: pins.length > 0,
    addPin,
    removePin,
    isPinned,
    togglePin,
  };
}
