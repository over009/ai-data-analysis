# AI Data Analysis

一个主动式智能数据助手，基于 React + Express 构建。不是"等你来问"的查询工具，而是"帮你盯着"的智能搭档——先告诉你该关注什么，再帮你深入挖掘。

## 核心理念：查询卡片，不是聊天

传统数据对话机器人每次交互都要经过 LLM。本项目使用**查询卡片（Query Card）**作为核心交互单元：

- **80% 的交互**（切维度、切时间、看关联）走结构化 API，不经 LLM，响应 ~40ms
- **20% 的交互**（自然语言查询、复杂分析）通过 LLM（Gemini）解析意图，响应 ~3s
- 卡片原地刷新，不生成新的对话消息

## 功能特性

- **数据简报** — 打开即自动扫描全部指标，异常一目了然
- **自然语言查询** — 一句话提问，返回带图表的结构化卡片
- **智能分流** — 简单查询走关键词解析器（秒出），模糊查询走 LLM
- **拖拽排序** — 基于 @dnd-kit 自由拖动卡片
- **置顶 & 对比** — 重要卡片置顶，多指标并排对比
- **导出 PNG** — 一键截图分享给团队
- **深色 / 浅色模式** — 完整主题支持
- **可插拔数据源** — 内置 BigQuery 适配器，可通过 adapter 接口扩展 PostgreSQL / MySQL

## 系统架构

```
用户层          →  QueryCard, DomainCard, QueryBar, MetricsCatalog
调度层          →  CardManager, BreadcrumbNav, QueryBuilder
API 层          →  GET /api/briefing, POST /api/query, POST /api/parse
能力层          →  IntentParser (LLM), MetricsRegistry (YAML), ValidationEngine
数据层          →  DataSourceAdapter (Mock / BigQuery / ...)
```

UI Spec 以 JSON 描述，通过 [json-render](https://github.com/nicepkg/json-render) 渲染，LLM 可动态生成仪表盘布局。

## 快速开始

**前置条件：** Node.js 18+

```bash
# 安装依赖
npm install

# 复制环境变量（Gemini API Key 可选——没有也能用，走关键词解析器）
cp .env.example .env.local

# 同时启动前端 + 后端
npm run dev:all
```

- 前端：http://localhost:3000
- 后端 API：http://localhost:3001

### 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `GEMINI_API_KEY` | 否 | Gemini API Key，用于自然语言意图解析。不配置则回退到关键词解析器 |
| `LLM_MODEL` | 否 | LLM 模型名称（默认 `gemini-2.5-flash`） |
| `PORT` | 否 | 后端端口（默认 `3001`） |
| `GOOGLE_APPLICATION_CREDENTIALS` | 否 | BigQuery 服务账号密钥路径。不配置则使用 Mock 数据 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + Vite + Tailwind CSS 4 |
| 图表 | Recharts |
| 动画 | Motion (Framer Motion) |
| 拖拽 | @dnd-kit |
| 导出 | html2canvas |
| 后端 | Express + TypeScript |
| LLM | Gemini（via @google/genai） |
| 数据 | BigQuery / Mock adapter |
| 指标配置 | YAML |

## 项目结构

```
src/                          # 前端源码
  components/                 # UI 组件
  state/                      # 状态管理（card-manager, pins, breadcrumb）
  lib/                        # API 客户端, json-render 注册表
server/                       # 后端源码
  routes/                     # API 路由（query, parse, briefing, generate-spec）
  lib/
    datasource/               # 数据适配器（mock, bigquery）
    intent/                   # 自然语言解析器 + 关键词解析器
    metrics/                  # 指标注册表（YAML 驱动）
    prompts/                  # LLM Prompt 模板
    tools/                    # 查询执行工具
```

## License

MIT
