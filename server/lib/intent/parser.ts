import { GoogleGenAI } from '@google/genai';
import { buildParsePrompt } from '../prompts/system-prompt.js';
import { keywordParse } from './keyword-parser.js';

// LLM client — lazy init to allow startup without API key (mock mode)
let genai: GoogleGenAI | null = null;

function hasLLMKey(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

function getClient(): GoogleGenAI {
  if (!genai) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new ParseError('GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY not set', 'NO_API_KEY');
    }
    genai = new GoogleGenAI({ apiKey });
  }
  return genai;
}

const MODEL = process.env.LLM_MODEL || 'gemini-2.5-flash';

export interface CardContext {
  metric_id: string;
  dimensions: string[];
  time_range: string;
  result_summary?: string;
}

export interface ParseResult {
  action: 'open_card' | 'update_card' | 'clarify' | 'reject';
  params?: Record<string, any>;
  message?: string;
  options?: Array<{ label: string; params: Record<string, any> }>;
}

/**
 * Parse natural language input into structured intent using LLM.
 */
export async function parseIntent(
  input: string,
  context?: { active_card?: CardContext },
): Promise<ParseResult> {
  // Fallback to keyword parser when no LLM key is configured
  if (!hasLLMKey()) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      type: 'keyword_parse',
      data: { input: input.substring(0, 200), mode: 'keyword_fallback' },
    }));
    return keywordParse(input, context);
  }

  const client = getClient();

  // Build user message with optional card context
  let userMessage = input;
  if (context?.active_card) {
    const card = context.active_card;
    userMessage = `当前卡片：${card.metric_id}，维度：${card.dimensions.length > 0 ? card.dimensions.join(',') : '无'}，时间：${card.time_range}${card.result_summary ? `，数据摘要：${card.result_summary}` : ''}\n\n用户输入：${input}`;
  }

  const systemPrompt = buildParsePrompt();

  const startTime = Date.now();

  const response = await client.models.generateContent({
    model: MODEL,
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 512,
      temperature: 0,
    },
  });

  const latencyMs = Date.now() - startTime;

  const rawOutput = (response.text ?? '').trim();

  if (!rawOutput) {
    throw new ParseError('LLM returned empty response', 'EMPTY_RESPONSE');
  }

  // Log the call
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    type: 'llm_call',
    data: {
      userInput: input,
      hasCardContext: !!context?.active_card,
      rawOutput: rawOutput.substring(0, 500),
      latencyMs,
      model: MODEL,
    }
  }));

  // Parse JSON from response (strip markdown code fences if present)
  const jsonStr = rawOutput.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      type: 'json_parse_error',
      data: { rawOutput: rawOutput.substring(0, 300) }
    }));
    throw new ParseError('LLM 输出格式错误，请换一种方式描述', 'PARSE_ERROR');
  }

  // Validate action
  const validActions = ['open_card', 'update_card', 'clarify', 'reject'];
  if (!validActions.includes(parsed.action)) {
    throw new ParseError('LLM 输出了无效的 action', 'INVALID_ACTION');
  }

  return parsed as ParseResult;
}

export class ParseError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'ParseError';
  }
}
