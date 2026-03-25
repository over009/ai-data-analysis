# AI 生成 UI Spec 设计

> 日期：2026-03-24
> 状态：已确认，待实现
> 前置：json-render 库集成（已完成）

## 目标

让 AI 直接生成 UI spec 模板（布局 + 配置），后端查数据后填充，Renderer / Registry / CardContext 零改动渲染。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 数据来源 | AI 生成布局模板，后端填充数据 | 分工清晰，各司其职 |
| 触发条件 | 所有查询统一走 AI 路径 | 探索阶段，简单优先 |
| 数据占位符 | 固定 slot 协议（按组件类型填充） | AI 不需要知道数据模型，出错率低 |

## 架构

### 响应格式

`/api/generate-spec` 返回完整 `MetricQueryResult`（与 `/api/query` 格式一致），其中 `ui_spec` 是 AI 生成 + 数据填充后的 spec。这样 CardState 的 `result` 字段类型不变，CollapsedCard 等读 `result.metric.name` 的代码不受影响。

### 新数据流

```
用户输入 NL 查询
        ↓
  POST /api/generate-spec { input, context? }
        ↓
  1. 构建 LLM 提示（catalog prompt + 指标列表 + 规则）
  2. LLM 返回 spec 模板 + _meta（metric_id, time_range, dimensions, aggregation）
  3. 验证 _meta：metric_id 在 registry 中存在，time_range 合法
  4. 构建 QueryParams：{ metric_id, time_range, dimensions, aggregation, include_related: true }
  5. 调 queryMetric(params) 查数据，得到 MetricQueryResult
  6. fillSpecWithData(specTemplate, result, params, metric) 填充数据 props
  7. 条件清理：移除无数据的 RelatedAlerts/Warnings/Recommendations
  8. 将填充后的 spec 赋值到 result.ui_spec
        ↓
  返回完整 MetricQueryResult（ui_spec 是 AI 版本）
        ↓
  前端收到后：
  - 存入 card.result
  - 从 result 回写 CardState 字段：
    metric_id = result.metric.id
    metric_name = result.metric.name
    dimensions = _meta.dimensions（通过响应附带）
    time_range = _meta.time_range
    aggregation = _meta.aggregation
  - Renderer 渲染 result.ui_spec
```

### CardState 生命周期

```
openCard({ input: "上周销售额" })
  ↓
  创建 CardState {
    id, input, status: 'loading',
    metric_id: '',            ← 占位，等响应回写
    metric_name: '',
    dimensions: [],
    time_range: '',
    aggregation: '',
    source: 'query',
    result: null,
    dimensionResults: {},
  }
  ↓
  调 generateSpec(input)
  ↓
  响应到达后回写：
    card.metric_id = result.metric.id
    card.metric_name = result.metric.name
    card.dimensions = response._meta.dimensions
    card.time_range = response._meta.time_range
    card.aggregation = response._meta.aggregation
    card.result = result
    card.status = 'success'
  ↓
  后续 updateCard() 用回写后的 metric_id/time_range 走快路径
```

### 响应附带 _meta

`/api/generate-spec` 返回 `{ ...MetricQueryResult, _meta: { metric_id, time_range, dimensions, aggregation } }`。前端从 `_meta` 回写 CardState 字段。`_meta` 是额外字段，不影响 MetricQueryResult 类型（前端用 `as any` 或新增类型）。

### 交互快路径

用户点维度/时间/趋势 chip 时，仍走 `updateCard() → queryMetric() → buildUISpec()` 快路径。只有**首次打开卡片**走 AI 生成路径。

### patchSpecForMultiDim 兼容

如果 AI 生成的 spec 已包含 `DimChartGrid`，跳过 patch。否则（spec 含 `Chart` 但前端有多维度 dimensionResults），正常 patch。

## LLM 配置

- 模型：与现有 parseIntent 相同（Gemini 2.5 Flash）
- maxOutputTokens：2048（典型 spec ~500-800 tokens）
- 超时：15 秒，超时后 fallback
- 温度：0（确定性输出）

### 系统提示

包含：
1. `catalog.prompt()` 自动生成的组件列表和描述（json-render 内置方法）
2. 可用指标列表（id, name, dimensions, chart_type, unit, example_question）
3. 输出格式规则（`_meta` + `root` + `elements`）
4. 各组件的 props 规则（Stack 写 direction/gap/wrap，Chart 写 chartType，其他留空）
5. 1-2 个完整示例

### AI 输出格式

```json
{
  "_meta": {
    "metric_id": "gmv",
    "time_range": "last_week",
    "dimensions": [],
    "aggregation": "total"
  },
  "root": "root",
  "elements": {
    "root": {
      "type": "Stack",
      "props": { "direction": "vertical", "gap": "md" },
      "children": ["value", "chart", "chips", "alerts", "recs"]
    },
    "value": { "type": "MetricValue", "props": {} },
    "chart": { "type": "Chart", "props": { "chartType": "bar" } },
    "chips": {
      "type": "Stack",
      "props": { "direction": "horizontal", "gap": "sm", "wrap": true },
      "children": ["dim-chips", "time-chips", "trend-chip"]
    },
    "dim-chips": { "type": "DimensionChips", "props": {} },
    "time-chips": { "type": "TimeChips", "props": {} },
    "trend-chip": { "type": "TrendChip", "props": {} },
    "alerts": { "type": "RelatedAlerts", "props": {} },
    "recs": { "type": "Recommendations", "props": {} }
  }
}
```

## Spec 验证

LLM 返回后、填充数据前，验证：
1. JSON 合法
2. `_meta.metric_id` 在 registry 中存在
3. `_meta.time_range` 在合法值列表中（this_week, last_week, this_month, last_month）
4. `root` key 在 `elements` 中存在
5. `elements` 中无循环引用（可选，递归深度上限 10 已在 Renderer 中）

验证失败 → fallback 到 parseIntent + queryMetric + buildUISpec。

## fillSpecWithData() 填充规则

| 组件类型 | 填充的 props | 数据来源 |
|---------|-------------|---------|
| MetricValue | value, unit, change, description, dateRange | result.current.value, result.metric.unit, result.compare.change_percent, result.metric.description, result.current.date_range |
| Chart | rows（合并到 AI 已写的 props） | result.current.rows |
| DimChartGrid | 不填（context 注入） | — |
| DimensionChips | options, active | metric.dimensions, params.dimensions |
| TimeChips | active | params.time_range |
| TrendChip | active | params.aggregation === 'daily' |
| Recommendations | items | result.recommendations |
| RelatedAlerts | items | result.related.filter(r => r.is_anomaly) |
| Warnings | messages | result.validation.warnings |

**条件清理**：RelatedAlerts/Warnings/Recommendations——如果填充后 items/messages 为空数组，从 spec 中移除该元素，并从父级 children 中删除其引用。

## 新增文件

| 文件 | 职责 |
|------|------|
| `server/lib/tools/fill-spec.ts` | fillSpecWithData() + validateSpecTemplate() |
| `server/lib/prompts/spec-prompt.ts` | 构建 LLM 系统提示 |
| `server/routes/generate-spec.ts` | POST /api/generate-spec 端点 |

## 修改文件

| 文件 | 改动 |
|------|------|
| `server/index.ts` | 挂载 /api/generate-spec 路由 |
| `src/lib/api.ts` | 新增 generateSpec() 函数 |
| `src/state/card-manager.ts` | openCard() 改为接受 `{ input }` 并调 generateSpec()，响应后回写 CardState 字段 |
| `src/App.tsx` | handleSend() 简化：直接调 openCard({ input })；handleMetricClick 也走 generateSpec |
| `src/types.ts` | CardState 新增 `input?: string`；新增 GenerateSpecResponse 类型 |

## 不动的部分

- json-render Renderer / Registry / CardContext
- buildUISpec() — 保留作为 updateCard 快路径
- queryMetric() — 保留，generate-spec 内部也调用
- /api/query 端点 — 保留
- DomainCard / CollapsedCard / pins / breadcrumb
- fillSpecWithData 可复用 buildUISpec 的填充逻辑

## 错误处理

- LLM 返回非法 JSON → fallback 到 parseIntent + queryMetric + buildUISpec
- spec 验证失败（无效 metric_id、缺 root 等）→ 同上 fallback
- LLM 超时（15s）→ 同上 fallback
- queryMetric 失败 → 返回 error（与现有行为一致）
- LLM 返回未知组件类型 → Renderer 已有容错（渲染 null）

## 验证清单

1. NL 查询 → AI 生成 spec → 卡片正常渲染
2. 点维度 chip → 快路径更新（不走 AI）
3. 点时间按钮 → 快路径更新
4. 趋势 toggle → 快路径更新
5. Domain card 示例按钮 → 走 AI 路径
6. 推荐 chips → 正常工作
7. 关联指标异常 → 正常显示
8. LLM 失败 → fallback 正常工作
9. 多维度 → patchSpecForMultiDim 兼容
10. CollapsedCard → metric_name / value 正常显示
