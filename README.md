# AI Data Analysis

An intelligent, proactive data assistant built with React + Express. Instead of waiting for questions, it surfaces anomalies first, then lets you drill down with natural language or one-click interactions.

## Core Concept: Query Cards, Not Chat

Traditional data chatbots route every interaction through an LLM. This assistant uses **Query Cards** as the core interaction unit:

- **80% of interactions** (switching dimensions, time ranges, viewing correlations) go through structured APIs — no LLM needed, ~40ms response
- **20% of interactions** (natural language queries, complex analysis) use LLM (Gemini) for intent parsing — ~3s response
- Cards refresh in-place instead of generating new chat messages

## Features

- **Morning Briefing** — Auto-scans all metrics on load, surfaces anomalies across business domains
- **Natural Language Query** — Type a question, get a structured query card with charts
- **Smart Routing** — Keyword parser handles simple queries instantly; LLM handles ambiguous ones
- **Drag & Drop** — Reorder query cards freely with @dnd-kit
- **Pin & Compare** — Pin important cards, compare metrics side by side
- **Export to PNG** — One-click export for sharing with your team
- **Dark / Light Mode** — Full theme support
- **Pluggable Data Sources** — BigQuery adapter included, easy to add PostgreSQL/MySQL via adapter interface

## Architecture

```
User Layer        →  QueryCard, DomainCard, QueryBar, MetricsCatalog
Harness Layer     →  CardManager, BreadcrumbNav, QueryBuilder
API Layer         →  GET /api/briefing, POST /api/query, POST /api/parse
Capability Layer  →  IntentParser (LLM), MetricsRegistry (YAML), ValidationEngine
Data Layer        →  DataSourceAdapter (Mock / BigQuery / ...)
```

UI specs are defined as JSON and rendered via [json-render](https://github.com/nicepkg/json-render), enabling the LLM to generate dashboard layouts dynamically.

## Quick Start

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Copy env and add your Gemini API key (optional — works without it via keyword parser)
cp .env.example .env.local

# Run frontend + backend
npm run dev:all
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | No | Gemini API key for NL intent parsing. Without it, falls back to keyword parser |
| `LLM_MODEL` | No | LLM model name (default: `gemini-2.5-flash`) |
| `PORT` | No | Backend port (default: `3001`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | Path to BigQuery service account key. Without it, uses mock data |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS 4 |
| Charts | Recharts |
| Animation | Motion (Framer Motion) |
| Drag & Drop | @dnd-kit |
| Export | html2canvas |
| Backend | Express + TypeScript |
| LLM | Gemini (via @google/genai) |
| Data | BigQuery / Mock adapter |
| Metrics Config | YAML |

## Project Structure

```
src/                          # Frontend
  components/                 # UI components
  state/                      # State management (card-manager, pins, breadcrumb)
  lib/                        # API client, json-render registry
server/                       # Backend
  routes/                     # API endpoints (query, parse, briefing, generate-spec)
  lib/
    datasource/               # Data adapters (mock, bigquery)
    intent/                   # NL parser + keyword parser
    metrics/                  # Metrics registry (YAML-driven)
    prompts/                  # LLM prompt templates
    tools/                    # Query execution tools
```

## License

MIT
