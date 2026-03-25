# QueryCard Catalog 化设计

> 日期：2026-03-24
> 状态：已确认，待实现

## 目标

将 QueryCard 内部的渲染逻辑从硬编码 JSX 改为 **spec 驱动**：后端返回 JSON UISpec 描述卡片由哪些块组成，前端用轻量 Renderer 递归渲染。

**不动的部分**：DomainCard、CollapsedCard、PinnedCards、Breadcrumb、Header/Footer 等外层结构不变。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Catalog 范围 | 仅 QueryCard 内部 | 最小改动验证模式 |
| Spec 来源 | 后端 `/api/query` 返回 `ui_spec` | 未来 AI 生成 spec 时前端零改动 |
| Renderer 实现 | 自写轻量版（~50 行） | 当前不需要表达式系统，零依赖可控 |
| Spec 格式 | 扁平 elements map（json-render 风格） | 支持嵌套，未来切换成本低 |
| 交互模式 | 组件 emit → 外层 handler | 业务逻辑留在 App 层，Renderer 纯渲染 |
| 多维度布局 | 前端组合，非后端构建 | 多维度 fan-out 在前端，单次 queryMetric 不知全局 |

## 类型定义

```typescript
interface UISpec {
  root: string;
  elements: Record<string, UIElement>;
}

interface UIElement {
  type: string;
  props: Record<string, any>;
  children?: string[];
}
```

## 组件 Catalog

| type | 用途 | 关键 props |
|------|------|-----------|
| `Stack` | 垂直/水平容器 | `direction`, `gap`, `wrap` |
| `MetricValue` | 大数字 + 变化率 | `value: number`, `unit: string`, `change: number \| null`, `description: string`, `dateRange: string` |
| `Chart` | 单图表（bar/line/pie） | `chartType: 'bar' \| 'line' \| 'pie'`, `rows: Record<string, string \| number>[]` |
| `DimChartGrid` | 多维度图表网格 | `dimensionResults: Record<string, MetricQueryResult>`（从 context 注入），列数由 key 数量决定：2 → 2 列，3+ → 响应式 |
| `DimensionChips` | 维度 toggle chips | `options: string[]`（从 metric.dimensions 读取）, `active: string[]` |
| `TimeChips` | 时间范围选择 | `active: string` |
| `TrendChip` | 趋势 toggle | `active: boolean` |
| `Recommendations` | 建议 chips | `items: { label: string, params: Partial<QueryParams> }[]` |
| `RelatedAlerts` | 关联指标异常提示 | `items: { metric_id: string, name: string, change_percent: number }[]` |
| `Warnings` | 数据验证警告 | `messages: string[]` |

## 后端：buildUISpec()

在 `server/lib/tools/query-metric.ts` 中新增，`queryMetric()` 返回时调用。

**入参**：`(result: MetricQueryResult, params: QueryParams)`，params 中包含 `dimensions`、`time_range`、`aggregation`。

逻辑：
1. 永远添加 `MetricValue`
2. 永远添加 `Chart`（单维度视图，chartType 根据 aggregation === 'daily' 选 line，否则用 metric.chart_type）
3. 添加 `DimensionChips`（options 从 metric registry 的 dimensions 读取，active 从 params.dimensions 读取）+ `TimeChips`（active 从 params.time_range 读取）+ `TrendChip`（active = params.aggregation === 'daily'），用 `Stack(horizontal)` 包裹
4. 条件添加：`RelatedAlerts`（有异常时）、`Recommendations`（有推荐时）、`Warnings`（有警告时）
5. 用 `Stack(vertical)` 包裹所有子元素作为 root

### 多维度特殊处理

多维度查询由前端 `cardManager.updateCard()` fan-out（每个维度独立调用 `/api/query`），单次 `queryMetric()` 不知道自己处于多维度场景。因此：

- **后端**：buildUISpec() 永远生成单维度版本的 spec（含 `Chart`）
- **前端**：当 `card.dimensionResults` 有多个 key 时，前端调用 `patchSpecForMultiDim(spec)` 将 `Chart` 元素替换为 `DimChartGrid`，数据从 `card.dimensionResults` 通过 context 注入

```typescript
function patchSpecForMultiDim(spec: UISpec): UISpec {
  const patched = structuredClone(spec);
  patched.elements['chart'] = {
    type: 'DimChartGrid',
    props: {},  // dimensionResults 从 context 注入
  };
  return patched;
}
```

### 卡片 header

标题、pin/collapse/remove 按钮不放入 spec，仍由外层 QueryCard 壳组件硬编码。这些是卡片管理逻辑，不属于数据内容块。

### 加载和错误状态

loading skeleton 和 error 状态仍在 QueryCard 壳组件中硬编码。Renderer 仅在 `card.status === 'success' && card.result?.ui_spec` 时调用。

`MetricQueryResult` 结构不变，新增 `ui_spec: UISpec` 字段。

## 前端：Renderer + Registry

### Renderer（`src/lib/renderer.tsx`，~50 行）

- 接收 `spec`, `registry`, `onAction`, `context`
- 递归遍历 elements，按 type 查 registry 渲染
- `context` 作为第 4 个参数传给每个 registry 组件
- `context` 包含：`isDark: boolean`、`dimensionResults: Record<string, MetricQueryResult>`
- 未知组件类型（registry 里没有）：渲染 null，开发模式下 console.warn
- 递归深度上限 10，防止循环引用

### Registry（`src/lib/registry.tsx`，~200 行）

- 10 个组件函数，签名 `(props, children, onAction, context) => ReactNode`
- 每个组件定义对应的 Props interface（`MetricValueProps`、`ChartProps` 等）用于内部类型安全
- 从现有 QueryCard JSX 提取，样式不变
- `SingleChart`、`rowsToChartData`、`formatValue` 移入此文件复用

### QueryCard 瘦身

从 ~250 行缩到 ~30 行：
```
CardHeader（硬编码：标题、pin/collapse/remove）
+ loading/error 守卫
+ <Renderer spec={finalSpec} registry={registry}
    onAction={handleCardAction}
    context={{ isDark, dimensionResults: card.dimensionResults }} />
```

其中 `finalSpec` = 多维度时 `patchSpecForMultiDim(card.result.ui_spec)`，否则直接用 `card.result.ui_spec`。

### onAction 处理

App 层的 `handleCardAction(cardId, action, payload)`：

| action | payload | 处理 |
|--------|---------|------|
| `toggleDimension` | `string`（dim name） | `cardManager.updateCard()` |
| `changeTime` | `string`（time_range） | `cardManager.updateCard()` |
| `toggleTrend` | - | `cardManager.updateCard()` |
| `openRelated` | `string`（metric_id） | `handleMetricClick()` |
| `recommend` | `Partial<QueryParams>` | `onRecommendClick()` |

注：`onExport` 不在 spec 内，仍由 QueryCard 壳组件的 header 按钮触发。

## 数据流

```
用户查询 → /api/parse → /api/query
                            ↓
                   queryMetric(params) 返回 {
                     ...MetricQueryResult,
                     ui_spec: buildUISpec(result, params)
                   }
                            ↓
               card.result.ui_spec 存入 CardState
                            ↓
               QueryCard:
               ├─ if loading → skeleton
               ├─ if error → error message
               ├─ CardHeader（硬编码）
               └─ finalSpec = hasMultiDim ? patchSpecForMultiDim(spec) : spec
                  <Renderer spec={finalSpec} onAction context />
                            ↓
               用户点击 chip → onAction('toggleDimension', 'channel')
               → cardManager.updateCard()
               → /api/query 返回新数据 + 新 ui_spec
               → Renderer 重新渲染
```

## 改动文件清单

| 文件 | 改动 | 估计 |
|------|------|------|
| `src/lib/renderer.tsx` | 新建：Renderer 组件 + UISpec/UIElement 类型 + patchSpecForMultiDim | ~60 行 |
| `src/lib/registry.tsx` | 新建：10 个组件 + Props interfaces + 工具函数 | ~250 行 |
| `src/App.tsx` | 瘦身 QueryCard + 新增 handleCardAction | 净减 ~180 行 |
| `src/types.ts` | MetricQueryResult 加 `ui_spec` 字段 | +5 行 |
| `server/lib/tools/query-metric.ts` | 新增 buildUISpec() + queryMetric() 附带 ui_spec | +70 行 |
| `server/lib/types.ts` | 新增 UISpec/UIElement 后端类型 + MetricQueryResult 加字段 | +15 行 |

## 验证清单

1. 打开首页 → 点 domain card → 卡片正常渲染（MetricValue + Chart + Chips）
2. 点维度 chip → 维度切换 + 图表更新
3. 点时间按钮 → 时间切换 + 数据刷新
4. 点趋势 toggle → 图表切换为折线图
5. 选多个维度 → DimChartGrid 网格图表
6. 关联指标异常 → 黄色 alert 显示
7. 推荐 chips → 点击打开新卡片
8. 验证警告 → 底部警告文字显示
9. 折叠/展开/删除/收藏 → 功能正常（header 不受影响）
