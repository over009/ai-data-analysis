import type { QueryParams, MetricQueryResult, ParseResult, MetricsCatalogEntry, GenerateSpecResponse } from '../types';

const API_BASE = '/api';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }
  return res.json();
}

/** POST /api/query — structured metric query */
export function queryMetric(params: QueryParams): Promise<MetricQueryResult> {
  return post<MetricQueryResult>('/query', params);
}

/** POST /api/parse — NL intent parsing */
export function parseInput(
  input: string,
  context?: { active_card?: { metric_id: string; dimensions: string[]; time_range: string } },
): Promise<ParseResult> {
  return post<ParseResult>('/parse', { input, context });
}

/** POST /api/generate-spec — AI generates UI spec from NL input (SSE for AI path, JSON for fast path) */
export async function generateSpec(
  input: string,
  context?: { active_card?: { metric_id: string; dimensions: string[]; time_range: string } },
  onStatus?: (text: string) => void,
): Promise<GenerateSpecResponse> {
  const res = await fetch(`${API_BASE}/generate-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, context }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';

  // Fast path returns JSON directly
  if (contentType.includes('application/json')) {
    return res.json();
  }

  // AI path returns SSE stream
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let result: GenerateSpecResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        const eventType = line.slice(7);
        // Next line should be data:
        const dataLine = lines[lines.indexOf(line) + 1];
        if (dataLine?.startsWith('data: ')) {
          const data = JSON.parse(dataLine.slice(6));
          if (eventType === 'status') {
            onStatus?.(data.text);
          } else if (eventType === 'result') {
            result = data;
          } else if (eventType === 'error') {
            throw new Error(data.error);
          }
        }
      }
    }
  }

  if (!result) throw new Error('No result received from SSE stream');
  return result;
}

/** GET /api/metrics — metrics catalog */
export function fetchMetricsCatalog(): Promise<MetricsCatalogEntry[]> {
  return get<MetricsCatalogEntry[]>('/metrics');
}

/** GET /api/briefing — morning briefing (SSE stream) */
export async function fetchBriefing(
  onData: (domains: any[]) => void,
  onSummary: (text: string) => void,
  onError: (err: Error) => void,
): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/briefing`);
    if (!res.ok) {
      throw new Error(`Briefing error: ${res.status}`);
    }
    const data = await res.json();
    // For now, briefing returns JSON directly (SSE streaming is a future enhancement)
    onData(data.domains || []);
    if (data.summary) onSummary(data.summary);
  } catch (err) {
    onError(err as Error);
  }
}
