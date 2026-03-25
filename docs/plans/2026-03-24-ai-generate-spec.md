# AI 生成 UI Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI generate UI spec templates from natural language — backend fills data, frontend renders unchanged.

**Architecture:** New `/api/generate-spec` endpoint: LLM generates spec layout template + `_meta` (query params) → validate → `queryMetric()` → `fillSpecWithData()` → return full `MetricQueryResult` with AI-generated `ui_spec`. Frontend `openCard()` calls this instead of separate parse + query. Chip interactions still use fast path (`updateCard → queryMetric → buildUISpec`).

**Tech Stack:** Google Gemini (existing), json-render catalog.prompt(), Express, React

**Spec:** `docs/specs/2026-03-24-ai-generate-spec-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/lib/tools/fill-spec.ts` | Create | `fillSpecWithData()` + `validateSpecTemplate()` |
| `server/lib/prompts/spec-prompt.ts` | Create | Build LLM system prompt for spec generation |
| `server/routes/generate-spec.ts` | Create | `POST /api/generate-spec` endpoint |
| `server/index.ts` | Modify | Mount new route |
| `src/types.ts` | Modify | Add `input?` to CardState, add GenerateSpecResponse type |
| `src/lib/api.ts` | Modify | Add `generateSpec()` function |
| `src/state/card-manager.ts` | Modify | `openCard()` accepts `{ input }` and calls generateSpec |
| `src/App.tsx` | Modify | `handleSend()` simplified, handleMetricClick uses generateSpec |

---

### Task 1: fillSpecWithData() + validateSpecTemplate()

**Files:**
- Create: `server/lib/tools/fill-spec.ts`

- [ ] **Step 1: Create fill-spec.ts**

```typescript
import type { MetricQueryResult, QueryParams, MetricDefinition } from '../types.js';

interface SpecTemplate {
  _meta: {
    metric_id: string;
    time_range: string;
    dimensions: string[];
    aggregation: string;
  };
  root: string;
  elements: Record<string, any>;
}

const VALID_TIME_RANGES = ['this_week', 'last_week', 'this_month', 'last_month'];

/**
 * Validate the LLM-generated spec template.
 * Returns null if valid, error message if invalid.
 */
export function validateSpecTemplate(
  template: any,
  metricExists: (id: string) => boolean,
): string | null {
  if (!template || typeof template !== 'object') return 'Not an object';
  if (!template._meta) return 'Missing _meta';
  if (!template._meta.metric_id) return 'Missing _meta.metric_id';
  if (!metricExists(template._meta.metric_id)) return `Unknown metric: ${template._meta.metric_id}`;
  if (!VALID_TIME_RANGES.includes(template._meta.time_range)) return `Invalid time_range: ${template._meta.time_range}`;
  if (!template.root) return 'Missing root';
  if (!template.elements) return 'Missing elements';
  if (!template.elements[template.root]) return `Root "${template.root}" not found in elements`;
  return null;
}

/**
 * Fill a spec template with real data from queryMetric result.
 * Mutates the template in place and returns it.
 */
export function fillSpecWithData(
  template: SpecTemplate,
  result: MetricQueryResult,
  params: QueryParams,
  metric: MetricDefinition,
): SpecTemplate {
  const elements = template.elements;

  for (const [key, el] of Object.entries(elements)) {
    switch (el.type) {
      case 'MetricValue':
        el.props = {
          ...el.props,
          value: result.current.value,
          unit: result.metric.unit,
          change: result.compare?.change_percent ?? null,
          description: result.metric.description,
          dateRange: result.current.date_range,
        };
        break;

      case 'Chart':
        el.props = {
          ...el.props,
          rows: result.current.rows,
        };
        break;

      case 'DimChartGrid':
        // Data injected via frontend context, no fill needed
        break;

      case 'DimensionChips':
        el.props = {
          ...el.props,
          options: metric.dimensions,
          active: params.dimensions || [],
        };
        break;

      case 'TimeChips':
        el.props = {
          ...el.props,
          active: params.time_range,
        };
        break;

      case 'TrendChip':
        el.props = {
          ...el.props,
          active: params.aggregation === 'daily',
        };
        break;

      case 'Recommendations':
        el.props = { ...el.props, items: result.recommendations };
        break;

      case 'RelatedAlerts': {
        const anomalies = result.related.filter(r => r.is_anomaly);
        el.props = { ...el.props, items: anomalies };
        break;
      }

      case 'Warnings':
        el.props = { ...el.props, messages: result.validation.warnings };
        break;
    }
  }

  // Conditional cleanup: remove empty RelatedAlerts/Warnings/Recommendations
  removeEmptyElements(elements, 'RelatedAlerts', 'items');
  removeEmptyElements(elements, 'Warnings', 'messages');
  removeEmptyElements(elements, 'Recommendations', 'items');

  return template;
}

/** Remove elements of given type if their array prop is empty, and clean parent children refs. */
function removeEmptyElements(
  elements: Record<string, any>,
  typeName: string,
  arrayProp: string,
): void {
  const keysToRemove: string[] = [];

  for (const [key, el] of Object.entries(elements)) {
    if (el.type === typeName) {
      const arr = el.props?.[arrayProp];
      if (!arr || (Array.isArray(arr) && arr.length === 0)) {
        keysToRemove.push(key);
      }
    }
  }

  for (const key of keysToRemove) {
    delete elements[key];
    // Remove from parent children arrays
    for (const el of Object.values(elements)) {
      if (Array.isArray(el.children)) {
        el.children = el.children.filter((c: string) => c !== key);
      }
    }
  }
}
```

- [ ] **Step 2: Verify file created**

Run: `ls -la server/lib/tools/fill-spec.ts`

---

### Task 2: spec-prompt.ts — LLM system prompt builder

**Files:**
- Create: `server/lib/prompts/spec-prompt.ts`

- [ ] **Step 1: Create spec-prompt.ts**

This file builds the system prompt for the spec-generation LLM call. It uses the json-render catalog's prompt method (imported from the built frontend package) and the metric registry.

```typescript
import { registry } from '../metrics/registry.js';

/**
 * Build system prompt for AI UI spec generation.
 * Uses metric registry for available metrics list.
 */
export function buildSpecPrompt(): string {
  const metrics = registry.getAllMetrics();
  const metricsList = metrics.map(m =>
    `- ${m.id}: ${m.name} (${m.unit}) — 维度: ${m.dimensions.join(', ')} — 图表: ${m.chart_type} — 示例: ${m.example_question}`
  ).join('\n');

  return `# 角色

你是 PetTech 数据助手的 UI 生成器。根据用户的自然语言查询，生成一个 JSON UI Spec 描述卡片布局。

# 可用组件

| 组件 | 用途 | AI 需写的 props |
|------|------|----------------|
| Stack | 容器 | direction ("vertical"/"horizontal"), gap ("sm"/"md"/"lg"), wrap (true/false) |
| MetricValue | 指标大数字+变化率 | 留空 {} |
| Chart | 图表 | chartType ("bar"/"line"/"pie") |
| DimChartGrid | 多维度图表网格 | 留空 {} |
| DimensionChips | 维度切换 | 留空 {} |
| TimeChips | 时间选择 | 留空 {} |
| TrendChip | 趋势切换 | 留空 {} |
| RelatedAlerts | 关联异常提示 | 留空 {} |
| Recommendations | 推荐操作 | 留空 {} |
| Warnings | 数据警告 | 留空 {} |

# 可用指标

${metricsList}

# 输出格式

只输出一个 JSON 对象，不要输出其他文字。格式：

\`\`\`json
{
  "_meta": {
    "metric_id": "指标ID",
    "time_range": "this_week|last_week|this_month|last_month",
    "dimensions": [],
    "aggregation": "total|daily|average|distinct"
  },
  "root": "root",
  "elements": {
    "root": { "type": "Stack", "props": { "direction": "vertical", "gap": "md" }, "children": [...] },
    ...其他元素
  }
}
\`\`\`

# 规则

1. _meta.metric_id 必须是上面列表中的指标 ID
2. _meta.time_range 根据用户意图推断：提到"上周"→last_week，"这个月"→this_month，默认 last_week
3. _meta.aggregation 根据指标类型推断：金额/数量类→total，日活类→daily，比率类→average
4. 除了 Stack 和 Chart 之外，其他组件的 props 留空 {}，后端会自动填充数据
5. Chart 的 chartType 参考指标的图表类型
6. 可以乐观地加入 RelatedAlerts 和 Recommendations，后端会按数据决定是否保留
7. 标准布局：MetricValue → Chart → Chips(DimensionChips+TimeChips+TrendChip) → RelatedAlerts → Recommendations
8. 如果用户提到维度（"按渠道"），在 _meta.dimensions 中加入

# 示例

用户：上周销售额
输出：
{
  "_meta": { "metric_id": "gmv", "time_range": "last_week", "dimensions": [], "aggregation": "total" },
  "root": "root",
  "elements": {
    "root": { "type": "Stack", "props": { "direction": "vertical", "gap": "md" }, "children": ["value", "chart", "chips", "alerts", "recs"] },
    "value": { "type": "MetricValue", "props": {} },
    "chart": { "type": "Chart", "props": { "chartType": "bar" } },
    "chips": { "type": "Stack", "props": { "direction": "horizontal", "gap": "sm", "wrap": true }, "children": ["dim-chips", "time-chips", "trend-chip"] },
    "dim-chips": { "type": "DimensionChips", "props": {} },
    "time-chips": { "type": "TimeChips", "props": {} },
    "trend-chip": { "type": "TrendChip", "props": {} },
    "alerts": { "type": "RelatedAlerts", "props": {} },
    "recs": { "type": "Recommendations", "props": {} }
  }
}

用户：这个月日活趋势
输出：
{
  "_meta": { "metric_id": "dau", "time_range": "this_month", "dimensions": [], "aggregation": "daily" },
  "root": "root",
  "elements": {
    "root": { "type": "Stack", "props": { "direction": "vertical", "gap": "md" }, "children": ["value", "chart", "chips", "alerts", "recs"] },
    "value": { "type": "MetricValue", "props": {} },
    "chart": { "type": "Chart", "props": { "chartType": "line" } },
    "chips": { "type": "Stack", "props": { "direction": "horizontal", "gap": "sm", "wrap": true }, "children": ["dim-chips", "time-chips", "trend-chip"] },
    "dim-chips": { "type": "DimensionChips", "props": {} },
    "time-chips": { "type": "TimeChips", "props": {} },
    "trend-chip": { "type": "TrendChip", "props": {} },
    "alerts": { "type": "RelatedAlerts", "props": {} },
    "recs": { "type": "Recommendations", "props": {} }
  }
}`;
}
```

- [ ] **Step 2: Verify file created**

Run: `ls -la server/lib/prompts/spec-prompt.ts`

---

### Task 3: generate-spec route

**Files:**
- Create: `server/routes/generate-spec.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Create generate-spec.ts**

```typescript
import { Router, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { registry } from '../lib/metrics/registry.js';
import { queryMetric, QueryError } from '../lib/tools/query-metric.js';
import { fillSpecWithData, validateSpecTemplate } from '../lib/tools/fill-spec.js';
import { buildSpecPrompt } from '../lib/prompts/spec-prompt.js';
import { parseIntent } from '../lib/intent/parser.js';
import type { QueryParams } from '../lib/types.js';

const MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 15000;

export const generateSpecRouter = Router();

generateSpecRouter.post('/generate-spec', async (req: Request, res: Response) => {
  const { input, context } = req.body;

  if (!input || typeof input !== 'string') {
    res.status(400).json({ error: '缺少 input 参数' });
    return;
  }

  const startTime = Date.now();

  try {
    // Try AI spec generation
    const result = await generateWithAI(input, context);
    res.json(result);
  } catch (err) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      type: 'generate_spec_fallback',
      data: { input: input.substring(0, 200), error: (err as Error).message, latencyMs: Date.now() - startTime },
    }));

    // Fallback: parseIntent + queryMetric (which includes buildUISpec)
    try {
      const fallbackResult = await fallbackFlow(input, context);
      res.json(fallbackResult);
    } catch (fallbackErr) {
      res.status(500).json({ error: (fallbackErr as Error).message });
    }
  }
});

async function generateWithAI(input: string, context?: any) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('No LLM API key configured');
  }

  const client = new GoogleGenAI({ apiKey });
  const systemPrompt = buildSpecPrompt();

  // LLM call with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let rawOutput: string;
  try {
    const response = await client.models.generateContent({
      model: MODEL,
      contents: input,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 2048,
        temperature: 0,
      },
    });
    rawOutput = (response.text ?? '').trim();
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now();

  if (!rawOutput) throw new Error('LLM returned empty response');

  // Parse JSON (strip markdown fences)
  const jsonStr = rawOutput.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  let template: any;
  try {
    template = JSON.parse(jsonStr);
  } catch {
    throw new Error('LLM output is not valid JSON');
  }

  // Validate
  const validationError = validateSpecTemplate(template, (id) => !!registry.getMetric(id));
  if (validationError) {
    throw new Error(`Spec validation failed: ${validationError}`);
  }

  // Extract QueryParams from _meta
  const meta = template._meta;
  const metric = registry.getMetric(meta.metric_id)!;
  const params: QueryParams = {
    metric_id: meta.metric_id,
    time_range: meta.time_range,
    dimensions: meta.dimensions || [],
    aggregation: meta.aggregation || metric.default_aggregation,
    include_related: true,
  };

  // Query data
  const queryResult = await queryMetric(params);

  // Fill spec with data
  fillSpecWithData(template, queryResult, params, metric);

  // Replace queryResult's buildUISpec-generated ui_spec with AI-generated one
  const { _meta, ...specOnly } = template;
  queryResult.ui_spec = specOnly as any;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'generate_spec_success',
    data: { input: input.substring(0, 200), metric_id: meta.metric_id, latencyMs: Date.now() - latencyMs },
  }));

  // Return MetricQueryResult + _meta for frontend to backfill CardState
  return { ...queryResult, _meta: meta };
}

async function fallbackFlow(input: string, context?: any) {
  // Use existing parseIntent
  const parseResult = await parseIntent(input, context);

  if (parseResult.action !== 'open_card' || !parseResult.params?.metric_id) {
    // Return parse result as-is for clarify/reject handling
    return { _fallback: true, parseResult };
  }

  const params: QueryParams = {
    metric_id: parseResult.params.metric_id,
    time_range: parseResult.params.time_range || 'last_week',
    dimensions: parseResult.params.dimensions || [],
    aggregation: parseResult.params.aggregation,
    include_related: true,
  };

  const result = await queryMetric(params);

  return {
    ...result,
    _meta: {
      metric_id: params.metric_id,
      time_range: params.time_range,
      dimensions: params.dimensions,
      aggregation: params.aggregation || 'total',
    },
  };
}
```

- [ ] **Step 2: Mount route in server/index.ts**

Add import and route:

```typescript
import { generateSpecRouter } from './routes/generate-spec.js';
```

And in the routes section:

```typescript
app.use('/api', generateSpecRouter);
```

- [ ] **Step 3: Verify backend compiles**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | head -20`

---

### Task 4: Frontend types + API client

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Update types.ts**

Add `input?: string` to CardState interface (after `source` field):

```typescript
  source: 'briefing' | 'query' | 'related' | 'pin';
  input?: string;
```

Add new response type at the bottom:

```typescript
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
```

- [ ] **Step 2: Update api.ts**

Add new function:

```typescript
import type { QueryParams, MetricQueryResult, ParseResult, MetricsCatalogEntry, GenerateSpecResponse } from '../types';
```

```typescript
/** POST /api/generate-spec — AI generates UI spec from NL input */
export function generateSpec(
  input: string,
  context?: { active_card?: { metric_id: string; dimensions: string[]; time_range: string } },
): Promise<GenerateSpecResponse> {
  return post<GenerateSpecResponse>('/generate-spec', { input, context });
}
```

---

### Task 5: Update card-manager.ts — openCard accepts NL input

**Files:**
- Modify: `src/state/card-manager.ts`

- [ ] **Step 1: Add generateSpec import and update openCard**

Add import:

```typescript
import { queryMetric, generateSpec } from '../lib/api';
```

Change the `openCard` method signature and implementation. The function now supports TWO modes:
1. `{ input: string }` — NL query, calls generateSpec
2. `{ metric_id, time_range, ... }` — structured params, calls queryMetric (for recommend/related clicks)

Replace the entire `openCard` function with:

```typescript
  /** Open a new card — either from NL input or structured params */
  const openCard = useCallback(async (
    params: (QueryParams & { source?: CardState['source'] }) | { input: string; source?: CardState['source'] },
  ) => {
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
        // AI generate spec path
        const response = await generateSpec((params as { input: string }).input);

        // Handle fallback parse results (clarify/reject)
        if ((response as any)._fallback && (response as any).parseResult) {
          // Remove the loading card and return the parse result for handling
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
                status: 'success',
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
            ? { ...c, status: 'success', result, metric_name: result.metric.name }
            : c
        ));
      }
    } catch (err) {
      setCards(prev => prev.map(c =>
        c.id === id
          ? { ...c, status: 'error', error: (err as Error).message }
          : c
      ));
    }
  }, []);
```

Also update the import at the top to include `generateSpec`:

```typescript
import { queryMetric, generateSpec } from '../lib/api';
```

---

### Task 6: Update App.tsx — simplify handleSend

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Simplify handleSend**

Replace the current `handleSend` function (around line 95-147) with:

```typescript
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
```

- [ ] **Step 2: Update handleMetricClick to use NL input**

Replace `handleMetricClick` (around line 194-201):

```typescript
  const handleMetricClick = (metricId: string, source: CardState['source'] = 'query') => {
    // Use structured params for direct metric clicks (more reliable than NL)
    cardManager.openCard({
      metric_id: metricId,
      time_range: inferDefaultTimeRange(),
      source,
    });
    setIsMetricsModalOpen(false);
  };
```

This keeps direct metric clicks on the structured params path (no AI needed). Only NL text input goes through AI.

- [ ] **Step 3: Update makeCardAction recommend case**

The `recommend` case in `makeCardAction` should also stay on structured params:

```typescript
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
```

(This is actually unchanged from current code — just confirming it stays as-is.)

- [ ] **Step 4: Remove parseInput import if no longer used**

Check if `parseInput` is still used anywhere in App.tsx. If `handleSend` no longer calls it, remove the import:

```typescript
// Remove parseInput from this import line:
import { fetchMetricsCatalog, fetchBriefing } from './lib/api';
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

---

### Task 7: Test in browser

**Files:** None (verification only)

- [ ] **Step 1: Start dev servers**

```bash
cd /workspaces/my-vault/doc/ai-data-analysis/intelligent-data-assistant
npx tsx server/index.ts > /tmp/server.log 2>&1 &
npx vite --port 5173 > /tmp/vite.log 2>&1 &
```

- [ ] **Step 2: Test NL query → AI spec → card renders**

Type "上周销售额" in the input box. Verify:
- Card appears with MetricValue + Chart + Chips
- If no LLM key configured: fallback to keyword parser still works

- [ ] **Step 3: Test chip interactions (fast path)**

Click dimension chip → updates via queryMetric (not AI). Click time button → fast update. Click trend → fast update.

- [ ] **Step 4: Test domain card example button**

Click "上周销售额多少" button on domain card → generates spec via AI.

- [ ] **Step 5: Test recommendation clicks**

Click a recommendation chip → opens via structured params (not AI).

- [ ] **Step 6: Test LLM error fallback**

If LLM key is set, temporarily set an invalid key to test fallback behavior.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "[ai-data-analysis] AI 生成 UI Spec：方向 3 完成

- 新端点 POST /api/generate-spec：LLM 生成布局模板 + 后端填充数据
- fillSpecWithData() 按组件类型填充 + 条件清理空组件
- openCard() 支持 NL 输入模式 + 结构化参数模式
- handleSend 简化为单次 generateSpec 调用
- LLM 失败自动 fallback 到 parseIntent + buildUISpec
- 维度/时间/趋势切换仍走快路径

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
