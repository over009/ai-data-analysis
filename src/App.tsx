import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  Camera,
  BarChart2,
  Sun,
  Moon,
  AlignJustify,
  AlignLeft,
  Pin,
  X,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Loader2,
  LayoutDashboard,
  Layers,
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCardManager } from './state/card-manager';
import { usePinnedCards } from './state/pins';
import { useBreadcrumb } from './state/breadcrumb';
import { fetchMetricsCatalog, fetchBriefing } from './lib/api';
import type { CardState, MetricQueryResult, MetricsCatalogEntry, ParseResult, DomainBriefing } from './types';
import { Renderer, JSONUIProvider, CardContextProvider, patchSpecForMultiDim, type OnAction } from './lib/renderer';
import { registry, formatValue, DIM_LABELS } from './lib/registry';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Domain display names
const DOMAIN_NAMES: Record<string, string> = {
  hardware_sales: '硬件销售',
  app: 'APP',
  consumables: '耗材复购',
};

// Example questions per domain
const DOMAIN_EXAMPLES: Record<string, string> = {
  hardware_sales: '上周销售额多少',
  app: '这个月日活怎么样',
  consumables: '耗材复购率多少',
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('pettech-theme') as 'light' | 'dark') || 'light'
  );
  const [density, setDensity] = useState<'standard' | 'compact'>(() =>
    (localStorage.getItem('pettech-density') as 'standard' | 'compact') || 'standard'
  );
  const [inputValue, setInputValue] = useState('');
  const [isMetricsModalOpen, setIsMetricsModalOpen] = useState(false);
  const [catalog, setCatalog] = useState<MetricsCatalogEntry[]>([]);
  const [parseLoading, setParseLoading] = useState(false);
  const [clarifyState, setClarifyState] = useState<ParseResult | null>(null);
  const [briefingData, setBriefingData] = useState<DomainBriefing[]>([]);

  const cardManager = useCardManager();
  const pinnedCards = usePinnedCards();
  const breadcrumb = useBreadcrumb();
  const contentRef = useRef<HTMLDivElement>(null);

  // Load catalog and briefing on mount
  useEffect(() => {
    fetchMetricsCatalog().then(setCatalog).catch(console.error);
    fetchBriefing(
      (domains) => setBriefingData(domains),
      () => {}, // summary text — not used yet
      (err) => console.error('Briefing error:', err),
    );
  }, []);

  // Theme persistence
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('pettech-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('pettech-density', density);
  }, [density]);

  // Push breadcrumb when active card changes (has result)
  useEffect(() => {
    if (cardManager.activeCard && cardManager.activeCard.status === 'success') {
      breadcrumb.push(cardManager.activeCard);
    }
  }, [cardManager.activeCardId, cardManager.activeCard?.status, cardManager.activeCard?.dimensions.join(','), cardManager.activeCard?.time_range]);

  // Handle NL query submission
  const handleSend = async (text: string) => {
    if (!text.trim() || parseLoading) return;
    setInputValue('');
    setClarifyState(null);
    setParseLoading(true);

    try {
      const result = await cardManager.openCard({ input: text, source: 'query' });

      // Handle fallback parse results (clarify/reject from fallback flow)
      if (result && typeof result === 'object' && 'action' in result) {
        const parseResult = result as ParseResult;
        switch (parseResult.action) {
          case 'update_card':
            if (cardManager.activeCardId && parseResult.params) {
              cardManager.updateCard(cardManager.activeCardId, parseResult.params);
            }
            break;
          case 'clarify':
          case 'reject':
            setClarifyState(parseResult);
            break;
        }
      }
    } catch (err) {
      console.error('Generate spec error:', err);
    } finally {
      setParseLoading(false);
    }
  };

  // Build an OnAction handler scoped to a specific card
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
      case 'recommend': {
        const params = payload as Record<string, any>;
        const card = cardManager.cards.find(c => c.id === cardId);
        if (params.metric_id && params.metric_id !== card?.metric_id) {
          cardManager.openCard({
            metric_id: params.metric_id,
            time_range: params.time_range || card?.time_range || inferDefaultTimeRange(),
            dimensions: params.dimensions,
            source: 'related',
          });
        } else {
          cardManager.updateCard(cardId, params);
        }
        break;
      }
    }
  };

  // Handle direct metric click (from catalog or briefing)
  const handleMetricClick = (metricId: string, source: CardState['source'] = 'query') => {
    cardManager.openCard({
      metric_id: metricId,
      time_range: inferDefaultTimeRange(),
      source,
    });
    setIsMetricsModalOpen(false);
  };

  // Handle export
  const handleExport = async () => {
    if (!contentRef.current) return;
    try {
      const canvas = await html2canvas(contentRef.current, {
        backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc',
        scale: 2,
      });
      const link = document.createElement('a');
      link.download = `data-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const isIdle = !cardManager.hasCards;

  return (
    <div
      className={cn(
        'min-h-screen flex flex-col font-sans transition-colors duration-200',
        theme === 'dark' ? 'bg-slate-900 text-slate-100' : 'bg-slate-50 text-slate-900',
        density === 'compact' ? 'text-sm' : 'text-base',
      )}
    >
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold">
            P
          </div>
          <h1 className="font-semibold tracking-tight">智能数据助手</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDensity(d => (d === 'standard' ? 'compact' : 'standard'))}
            className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400"
            title="切换密度"
          >
            {density === 'standard' ? <AlignJustify size={18} /> : <AlignLeft size={18} />}
          </button>
          <button
            onClick={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
            className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400"
            title="切换主题"
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main ref={contentRef} className="flex-1 flex flex-col w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-32">

        {/* Domain Briefing Cards (shown when idle or collapsed at top) */}
        <AnimatePresence mode="wait">
          {isIdle ? (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
            >
              {catalog.map(cat => {
                const briefing = briefingData.find(b => b.domain === cat.domain);
                return (
                  <DomainCard
                    key={cat.domain}
                    domain={cat.domain}
                    metrics={cat.metrics}
                    briefing={briefing}
                    onMetricClick={handleMetricClick}
                    onExampleClick={(q) => handleSend(q)}
                  />
                );
              })}
              {catalog.length === 0 && (
                // Skeleton while loading
                <>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700/50 animate-pulse">
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16 mb-4" />
                      <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-24 mb-6" />
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full mb-2" />
                      <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded w-full mt-4" />
                    </div>
                  ))}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="collapsed-briefing"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-2 mb-6 flex-wrap"
            >
              {catalog.map(cat => (
                <button
                  key={cat.domain}
                  onClick={() => {
                    // Reset to dashboard
                    // Clicking domain name in collapsed mode could expand, for now just show name
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700"
                >
                  {DOMAIN_NAMES[cat.domain] || cat.domain}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pinned Cards */}
        {pinnedCards.hasPins && (
          <div className="mb-6">
            <h3 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
              我的收藏
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pinnedCards.pins.map(pin => (
                <div
                  key={pin.metric_id}
                  onClick={() => handleMetricClick(pin.metric_id, 'pin')}
                  className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-100 dark:border-slate-700/50 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors flex items-center justify-between"
                >
                  <div>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {pin.result?.metric.name || pin.metric_id}
                    </span>
                    {pin.status === 'success' && pin.result && (
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {formatValue(pin.result.current.value, pin.result.metric.unit)}
                        </span>
                        {pin.result.compare && (
                          <span className={cn(
                            'text-xs',
                            pin.result.compare.change_percent >= 0 ? 'text-emerald-600' : 'text-amber-600',
                          )}>
                            {pin.result.compare.change_percent >= 0 ? '↑' : '↓'}
                            {Math.abs(pin.result.compare.change_percent)}%
                          </span>
                        )}
                      </div>
                    )}
                    {pin.status === 'loading' && (
                      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-16 mt-1 animate-pulse" />
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); pinnedCards.removePin(pin.metric_id); }}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1"
                    title="取消收藏"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Breadcrumb Navigation */}
        {breadcrumb.hasEntries && cardManager.hasCards && (
          <nav className="flex items-center gap-1 mb-4 text-xs text-slate-400 dark:text-slate-500 overflow-x-auto">
            {breadcrumb.entries.map((entry, idx) => (
              <React.Fragment key={entry.id}>
                {idx > 0 && <ChevronRight size={12} className="flex-shrink-0" />}
                <button
                  onClick={() => {
                    const snapshot = breadcrumb.goTo(idx);
                    if (snapshot && snapshot.result) {
                      // Restore card from breadcrumb cache
                      cardManager.openCard({
                        metric_id: snapshot.metric_id,
                        time_range: snapshot.time_range,
                        dimensions: snapshot.dimensions,
                        aggregation: snapshot.aggregation,
                        source: snapshot.source,
                      });
                    }
                  }}
                  className={cn(
                    'whitespace-nowrap px-2 py-1 rounded-md transition-colors',
                    idx === breadcrumb.currentIndex
                      ? 'text-teal-600 dark:text-teal-400 font-medium bg-teal-50 dark:bg-teal-500/10'
                      : 'hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  {entry.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}

        {/* Query Cards — drag-and-drop sortable */}
        <DndContext
          collisionDetection={closestCenter}
          onDragEnd={(event: DragEndEvent) => {
            const { active, over } = event;
            if (over && active.id !== over.id) {
              const oldIndex = cardManager.cards.findIndex(c => c.id === active.id);
              const newIndex = cardManager.cards.findIndex(c => c.id === over.id);
              if (oldIndex !== -1 && newIndex !== -1) {
                cardManager.reorderCards(oldIndex, newIndex);
              }
            }
          }}
        >
          <SortableContext items={cardManager.cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-4">
              <AnimatePresence>
                {cardManager.cards.map(card => {
                  const isExpanded = cardManager.isCardExpanded(card.id);

                  return (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <SortableCard id={card.id}>
                        {isExpanded ? (
                          <QueryCard
                            card={card}
                            theme={theme}
                            isPinned={pinnedCards.isPinned(card.metric_id)}
                            onTogglePin={() => pinnedCards.togglePin(card)}
                            onAction={makeCardAction(card.id)}
                            onCollapse={() => cardManager.toggleCardExpanded(card.id)}
                            onRemove={() => cardManager.removeCard(card.id)}
                          />
                        ) : (
                          <CollapsedCard
                            card={card}
                            onClick={() => cardManager.toggleCardExpanded(card.id)}
                            onRemove={() => cardManager.removeCard(card.id)}
                          />
                        )}
                      </SortableCard>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </SortableContext>
        </DndContext>

        {/* Clarify / Reject message */}
        <AnimatePresence>
          {clarifyState && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-4"
            >
              {clarifyState.action === 'clarify' && clarifyState.options ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
                  <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                    {clarifyState.message || '你想看哪种数据？'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {clarifyState.options.map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setClarifyState(null);
                          if (opt.params.metric_id) {
                            cardManager.openCard({
                              metric_id: opt.params.metric_id,
                              time_range: opt.params.time_range || 'last_week',
                              aggregation: opt.params.aggregation,
                              source: 'query',
                            });
                          }
                        }}
                        className="text-sm bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 py-2 px-4 rounded-full border border-slate-200 dark:border-slate-700 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : clarifyState.action === 'reject' ? (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl px-4 py-3 text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  {clarifyState.message}
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent dark:from-slate-900 dark:via-slate-900 pt-12 pb-6 px-4 sm:px-6 lg:px-8 z-20">
        <div className="max-w-4xl mx-auto flex items-end gap-3">
          <button
            onClick={() => setIsMetricsModalOpen(true)}
            className="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            title="指标目录"
          >
            <BarChart2 size={20} />
          </button>
          <button
            onClick={handleExport}
            className="p-3.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            title="导出 PNG"
          >
            <Camera size={20} />
          </button>

          <div className="flex-1 relative">
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(inputValue);
                }
              }}
              placeholder="问问销售额、复购率、日活..."
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 pl-5 pr-14 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 shadow-sm transition-all"
            />
            <button
              onClick={() => handleSend(inputValue)}
              disabled={!inputValue.trim() || parseLoading}
              className="absolute right-2 top-2 bottom-2 p-2 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 dark:disabled:text-slate-500 text-white transition-colors flex items-center justify-center"
            >
              {parseLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Send size={18} className={cn(inputValue.trim() ? 'translate-x-0.5' : '')} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Catalog Modal */}
      <AnimatePresence>
        {isMetricsModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMetricsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 dark:bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-700/50">
                <h2 className="text-xl font-semibold">指标目录</h2>
                <button
                  onClick={() => setIsMetricsModalOpen(false)}
                  className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto p-6 space-y-8">
                {catalog.map(cat => (
                  <div key={cat.domain}>
                    <h3 className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-4">
                      {DOMAIN_NAMES[cat.domain] || cat.domain}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {cat.metrics.map(metric => (
                        <button
                          key={metric.id}
                          onClick={() => handleMetricClick(metric.id)}
                          className="text-left bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700/50 transition-colors"
                        >
                          <div className="font-medium text-slate-900 dark:text-slate-100 mb-1">
                            {metric.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {metric.description}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ==================== Sub-components ====================

/** Domain briefing card (homepage) */
function DomainCard(props: {
  key?: React.Key;
  domain: string;
  metrics: MetricsCatalogEntry['metrics'];
  briefing?: DomainBriefing;
  onMetricClick: (id: string, source: CardState['source']) => void;
  onExampleClick: (q: string) => any;
}) {
  const { domain, metrics, briefing, onMetricClick, onExampleClick } = props;
  const hasAnomalies = briefing && !briefing.healthy && briefing.anomalies.length > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700/50 flex flex-col h-full">
      <h2 className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
        {DOMAIN_NAMES[domain] || domain}
      </h2>

      {/* Briefing status */}
      {!briefing ? (
        <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-24 mb-4 animate-pulse" />
      ) : hasAnomalies ? (
        <div className="mb-4 space-y-2">
          {briefing.anomalies.map(a => (
            <button
              key={a.metric_id}
              onClick={() => onMetricClick(a.metric_id, 'briefing')}
              className={cn(
                'w-full text-left text-sm px-3 py-2 rounded-lg transition-colors flex items-center justify-between',
                a.severity === 'critical'
                  ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                  : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20',
              )}
            >
              <span>
                {a.severity === 'critical' ? '!!' : '!'} {a.name} {a.change >= 0 ? '+' : ''}{a.change}%
              </span>
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      ) : (
        <div className="text-xl font-semibold text-emerald-500 mb-4">
          数据平稳
        </div>
      )}

      <div className="flex-1 mb-4">
        <div className="flex flex-wrap gap-1">
          {metrics.map(m => (
            <button
              key={m.id}
              onClick={() => onMetricClick(m.id, 'briefing')}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
            >
              {m.name}{metrics.indexOf(m) < metrics.length - 1 ? ' · ' : ''}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => onExampleClick(DOMAIN_EXAMPLES[domain] || metrics[0]?.example_question || '')}
        className="text-left text-sm bg-slate-50 dark:bg-slate-900/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-300 py-2.5 px-4 rounded-xl transition-colors border border-slate-200 dark:border-slate-700"
      >
        &ldquo;{DOMAIN_EXAMPLES[domain] || metrics[0]?.example_question}&rdquo;
      </button>
    </div>
  );
}

/** Sortable wrapper for drag-and-drop card reordering */
function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    zIndex: isDragging ? 10 : 'auto' as any,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {/* Drag handle — small grip icon at top-center */}
      <div
        {...listeners}
        className="absolute top-2 left-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors z-10"
        title="拖动排序"
      >
        <svg width="16" height="6" viewBox="0 0 16 6" fill="currentColor" className="text-slate-300 dark:text-slate-600">
          <circle cx="2" cy="1" r="1" /><circle cx="8" cy="1" r="1" /><circle cx="14" cy="1" r="1" />
          <circle cx="2" cy="5" r="1" /><circle cx="8" cy="5" r="1" /><circle cx="14" cy="5" r="1" />
        </svg>
      </div>
      {children}
    </div>
  );
}

/** Expanded Query Card — thin shell: header + spec-driven Renderer */
function QueryCard({
  card,
  theme,
  isPinned,
  onTogglePin,
  onAction,
  onCollapse,
  onRemove,
}: {
  card: CardState;
  theme: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onAction: OnAction;
  onCollapse: () => void;
  onRemove: () => void;
}) {
  const isDark = theme === 'dark';
  const isTrend = card.aggregation === 'daily';
  const hasMultiDim = Object.keys(card.dimensionResults || {}).length > 1;

  if (card.status === 'loading') {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700/50">
        {card.statusText && (
          <p className="text-sm text-teal-600 dark:text-teal-400 mb-4 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            {card.statusText}
          </p>
        )}
        <div className="animate-pulse">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-32 mb-3" />
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-48 mb-6" />
          <div className="h-48 bg-slate-200 dark:bg-slate-700 rounded mb-4" />
          <div className="flex gap-2">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded-full w-20" />
          </div>
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

  if (!card.result?.ui_spec) return null;

  const spec = hasMultiDim ? patchSpecForMultiDim(card.result.ui_spec) : card.result.ui_spec;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700/50">
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
          {card.result.metric.name}
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
      <CardContextProvider value={{ onAction, isDark, dimensionResults: card.dimensionResults || {} }}>
        <JSONUIProvider
          registry={registry}
          initialState={{}}
          handlers={{
            toggleTrend: async () => { onAction('toggleTrend'); },
          }}
        >
          <Renderer spec={spec} registry={registry} />
        </JSONUIProvider>
      </CardContextProvider>
    </div>
  );
}

/** Collapsed card (one-line summary) */
function CollapsedCard({
  card,
  onClick,
  onRemove,
}: {
  card: CardState;
  onClick: () => void;
  onRemove: () => void;
}) {
  const result = card.result;
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-100 dark:border-slate-700/50 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {card.metric_name}
        </span>
        {result?.current && (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {formatValue(result.current.value, result.metric.unit)}
          </span>
        )}
        {result?.compare && (
          <span
            className={cn(
              'text-xs',
              result.compare.change_percent >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400',
            )}
          >
            {result.compare.change_percent >= 0 ? '↑' : '↓'}
            {Math.abs(result.compare.change_percent)}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <ChevronDown size={16} className="text-slate-400" />
        <button
          onClick={e => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors p-1"
          title="移除"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ==================== Helpers ====================

function inferDefaultTimeRange(): string {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const dayOfMonth = today.getDate();
  if (dayOfWeek === 1) return 'last_week';
  if (dayOfMonth <= 3) return 'last_month';
  return 'this_week';
}
