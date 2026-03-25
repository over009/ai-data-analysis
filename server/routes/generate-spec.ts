import { Router, Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { registry } from '../lib/metrics/registry.js';
import { queryMetric, QueryError } from '../lib/tools/query-metric.js';
import { fillSpecWithData, fillSpecWithMultiData, validateSpecTemplate } from '../lib/tools/fill-spec.js';
import { buildSpecPrompt } from '../lib/prompts/spec-prompt.js';
import { parseIntent } from '../lib/intent/parser.js';
import { keywordParse } from '../lib/intent/keyword-parser.js';
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

  // Fast path: keyword parser can handle simple queries without LLM
  const quickResult = keywordParse(input, context?.active_card ? { active_card: context.active_card } : undefined);
  if (quickResult.action === 'open_card' && quickResult.params?.metric_id) {
    try {
      const startTime = Date.now();
      const fastResult = await fastPath(quickResult.params);
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        type: 'generate_spec_fast_path',
        data: { input: input.substring(0, 200), metric_id: quickResult.params.metric_id, latencyMs: Date.now() - startTime },
      }));
      res.json(fastResult);
      return;
    } catch (fastErr) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        type: 'fast_path_error',
        data: { error: (fastErr as Error).message },
      }));
    }
  }

  // AI path: use SSE to stream progress updates
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent('status', { text: 'AI 正在分析你的问题...' });
    const result = await generateWithAI(input, context, (status: string) => {
      sendEvent('status', { text: status });
    });
    sendEvent('result', result);
    res.end();
  } catch (err) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      type: 'generate_spec_fallback',
      data: { input: input.substring(0, 200), error: (err as Error).message },
    }));

    sendEvent('status', { text: '切换到快速模式...' });
    try {
      const fallbackResult = await fallbackFlow(input, context);
      sendEvent('result', fallbackResult);
    } catch (fallbackErr) {
      sendEvent('error', { error: (fallbackErr as Error).message });
    }
    res.end();
  }
});

async function generateWithAI(input: string, _context?: any, onStatus?: (text: string) => void) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('No LLM API key configured');
  }

  const client = new GoogleGenAI({ apiKey });
  const systemPrompt = buildSpecPrompt();

  const startTime = Date.now();

  const response = await client.models.generateContent({
    model: MODEL,
    contents: input,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 2048,
      temperature: 0,
    },
  });

  const rawOutput = (response.text ?? '').trim();
  const latencyMs = Date.now() - startTime;

  if (!rawOutput) throw new Error('LLM returned empty response');

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'generate_spec_llm',
    data: { input: input.substring(0, 200), rawOutput: rawOutput.substring(0, 500), latencyMs, model: MODEL },
  }));

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

  onStatus?.('正在解析布局，查询数据...');

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

  let queryResult;

  if (meta.metrics && Array.isArray(meta.metrics) && meta.metrics.length > 0) {
    // Multi-metric: query all in parallel, fill with multi-data
    const entries = meta.metrics as Array<{ id: string; time_range?: string; key: string }>;
    const queryResults = await Promise.all(
      entries.map(async (entry) => {
        const m = registry.getMetric(entry.id)!;
        const p: QueryParams = {
          metric_id: entry.id,
          time_range: entry.time_range || meta.time_range,
          dimensions: meta.dimensions || [],
          aggregation: m.default_aggregation as QueryParams['aggregation'],
          include_related: entry.id === meta.metric_id,
        };
        const result = await queryMetric(p);
        return { key: entry.key, result, params: p, metric: m };
      })
    );

    // Build results map
    const resultsMap: Record<string, { result: any; params: QueryParams; metric: any }> = {};
    for (const qr of queryResults) {
      resultsMap[qr.key] = { result: qr.result, params: qr.params, metric: qr.metric };
    }

    // Use first key as default
    const defaultKey = entries[0].key;
    fillSpecWithMultiData(template, resultsMap, defaultKey);

    // Use primary metric's result as the base MetricQueryResult
    const primaryEntry = queryResults.find(qr => qr.key === defaultKey) || queryResults[0];
    queryResult = primaryEntry.result;
  } else {
    // Single metric: existing flow
    queryResult = await queryMetric(params);
    fillSpecWithData(template, queryResult, params, metric);
  }

  // Replace queryResult's ui_spec with AI-generated one
  const { _meta, ...specOnly } = template;
  queryResult.ui_spec = specOnly as any;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'generate_spec_success',
    data: { input: input.substring(0, 200), metric_id: meta.metric_id, latencyMs: Date.now() - startTime },
  }));

  return { ...queryResult, _meta: meta };
}

async function fastPath(parsedParams: Record<string, any>) {
  const metric = registry.getMetric(parsedParams.metric_id);
  if (!metric) throw new Error(`Unknown metric: ${parsedParams.metric_id}`);

  const params: QueryParams = {
    metric_id: parsedParams.metric_id,
    time_range: parsedParams.time_range || 'last_week',
    dimensions: parsedParams.dimensions || [],
    aggregation: parsedParams.aggregation || metric.default_aggregation,
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

async function fallbackFlow(input: string, context?: any) {
  const parseResult = await parseIntent(input, context);

  if (parseResult.action !== 'open_card' || !parseResult.params?.metric_id) {
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
