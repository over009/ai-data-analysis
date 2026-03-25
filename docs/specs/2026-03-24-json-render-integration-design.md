# json-render 库集成设计

> 日期：2026-03-24
> 状态：已确认，待实现
> 前置：QueryCard catalog 化（已完成）

## 目标

用 `@json-render/core` + `@json-render/react` 替换自写的轻量 Renderer + Registry，保留自定义组件实现和 onAction 交互模式。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 替换深度 | 仅 Renderer 层 | 最小改动，体验核心 API |
| 状态管理 | 不用 json-render 的 | cardManager 工作正常，无需替换 |
| 组件实现 | 保留自定义 Recharts 组件 | shadcn 没有对应图表组件 |

## 类型对齐

项目的 `UISpec`/`UIElement` 类型替换为 json-render 的 `Spec` 类型（从 `@json-render/core` 导入）。

- `src/types.ts`：删除自定义 `UISpec`/`UIElement`，改为 `import type { Spec } from '@json-render/core'`，`MetricQueryResult.ui_spec` 类型改为 `Spec`
- `server/lib/types.ts`：保留自定义 `UISpec`/`UIElement`（后端不依赖 json-render），但结构兼容
- `patchSpecForMultiDim`：签名改为接收/返回 `Spec` 类型

json-render 的 `UIElement` 包含额外可选字段（`visible`、`on`、`repeat`、`watch`），我们不使用，不影响兼容性。

## 集成方式

### onAction + context 传递

json-render 组件签名是 `({ props, children, emit }) => ReactNode`。其中：
- `children` 是 `ReactNode`（单个节点，非数组）——与我们自写 Renderer 的 `ReactNode[]` 不同，但 Stack 等容器组件直接 `{children}` 渲染即可
- `emit` 触发 spec 中 `element.on` 声明的 action

我们不使用 json-render 的 action 系统。通过 React Context（`CardContext`）传递 `onAction`、`isDark`、`dimensionResults`，组件内部从 Context 读取：

```typescript
// CardContext
interface CardContextValue {
  onAction: (action: string, payload?: unknown) => void;
  isDark: boolean;
  dimensionResults: Record<string, MetricQueryResult>;
}
const CardContext = createContext<CardContextValue>(/* ... */);
const useCardContext = () => useContext(CardContext);
```

**需要 Context 的组件**：
- 需要 `onAction`：DimensionChips、TimeChips、TrendChip、RelatedAlerts、Recommendations
- 需要 `isDark`：Chart、DimChartGrid
- 需要 `dimensionResults`：DimChartGrid

纯展示组件（MetricValue、Warnings）不需要 Context。

### defineCatalog

用 `z.record(z.any())` 作为 props schema，容器组件声明 `slots`：

```typescript
const catalog = defineCatalog(schema, {
  components: {
    Stack: { props: z.record(z.any()), description: '垂直/水平容器', slots: ['default'] },
    MetricValue: { props: z.record(z.any()), description: '指标值+变化率' },
    Chart: { props: z.record(z.any()), description: '图表' },
    DimChartGrid: { props: z.record(z.any()), description: '多维度图表网格' },
    DimensionChips: { props: z.record(z.any()), description: '维度切换' },
    TimeChips: { props: z.record(z.any()), description: '时间范围选择' },
    TrendChip: { props: z.record(z.any()), description: '趋势切换' },
    RelatedAlerts: { props: z.record(z.any()), description: '关联指标异常' },
    Recommendations: { props: z.record(z.any()), description: '推荐操作' },
    Warnings: { props: z.record(z.any()), description: '数据验证警告' },
  },
  actions: {},
});
```

### defineRegistry

每个组件包装为 json-render 格式，交互组件从 Context 读取 onAction/isDark：

```typescript
const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }) => <StackImpl {...props}>{children}</StackImpl>,
    MetricValue: ({ props }) => <MetricValueImpl {...props} />,
    Chart: ({ props }) => {
      const { isDark } = useCardContext();
      return <ChartImpl {...props} isDark={isDark} />;
    },
    DimChartGrid: ({ props }) => {
      const { isDark, dimensionResults } = useCardContext();
      return <DimChartGridImpl isDark={isDark} dimensionResults={dimensionResults} />;
    },
    DimensionChips: ({ props }) => {
      const { onAction } = useCardContext();
      return <DimensionChipsImpl {...props} onAction={onAction} />;
    },
    TimeChips: ({ props }) => {
      const { onAction } = useCardContext();
      return <TimeChipsImpl {...props} onAction={onAction} />;
    },
    TrendChip: ({ props }) => {
      const { onAction } = useCardContext();
      return <TrendChipImpl {...props} onAction={onAction} />;
    },
    RelatedAlerts: ({ props }) => {
      const { onAction } = useCardContext();
      return <RelatedAlertsImpl {...props} onAction={onAction} />;
    },
    Recommendations: ({ props }) => {
      const { onAction } = useCardContext();
      return <RecommendationsImpl {...props} onAction={onAction} />;
    },
    Warnings: ({ props }) => <WarningsImpl {...props} />,
  },
});
```

组件实现（StackImpl、MetricValueImpl 等）保留现有代码，从裸函数改为标准 React 组件。

### Renderer 使用

```tsx
<CardContext.Provider value={{ onAction, isDark, dimensionResults }}>
  <JSONUIProvider registry={registry} initialState={{}}>
    <Renderer spec={spec} registry={registry} />
  </JSONUIProvider>
</CardContext.Provider>
```

## 后端

`buildUISpec()` 不变。输出的 `{ root, elements }` 结构与 json-render 的 `Spec` 类型结构兼容。后端类型保持自定义 `UISpec`（不依赖 json-render 库）。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `package.json` | 新增 `@json-render/core` + `@json-render/react` + `zod` 依赖 |
| `src/types.ts` | 删除自定义 UISpec/UIElement，改为从 `@json-render/core` 导入 Spec 类型 |
| `src/lib/renderer.tsx` | 重写：删除自写 Renderer，改为 CardContext + defineCatalog + re-export json-render Renderer；patchSpecForMultiDim 签名改为 Spec |
| `src/lib/registry.tsx` | 重写：组件从裸函数改为 defineRegistry 格式 + 独立 Impl 组件 |
| `src/App.tsx` | 微调：包裹 CardContext.Provider + JSONUIProvider |

## 不动的部分

- 后端 buildUISpec() 和 server/lib/types.ts
- cardManager / pins / breadcrumb
- 组件的 JSX 样式和 Recharts 图表
- patchSpecForMultiDim（仅类型签名变）
- DomainCard / CollapsedCard

## 验证清单

与方向 1 相同的 9 项浏览器测试——UI 和交互完全不变。
