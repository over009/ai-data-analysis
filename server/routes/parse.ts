import { Router, Request, Response } from 'express';
import { parseIntent, ParseError } from '../lib/intent/parser.js';

export const parseRouter = Router();

parseRouter.post('/parse', async (req: Request, res: Response) => {
  try {
    const { input, context } = req.body;

    if (!input || typeof input !== 'string') {
      res.status(400).json({ error: '缺少 input 参数' });
      return;
    }

    if (input.trim().length === 0) {
      res.status(400).json({ error: '输入不能为空' });
      return;
    }

    // Prompt injection basic check
    const INJECTION_PATTERNS = [
      /ignore.*previous.*instructions/i,
      /system.*prompt/i,
      /pretend|假装|扮演/i,
    ];
    const isInjection = INJECTION_PATTERNS.some(p => p.test(input));
    if (isInjection) {
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        type: 'security',
        event: 'injection_attempt',
        data: { input: input.substring(0, 200) }
      }));
      res.json({
        action: 'reject',
        message: '我只能帮你查询数据指标。',
      });
      return;
    }

    const result = await parseIntent(input, context);
    res.json(result);
  } catch (err) {
    if (err instanceof ParseError) {
      if (err.code === 'NO_API_KEY') {
        res.status(503).json({
          error: 'LLM 服务未配置，请设置 ANTHROPIC_API_KEY',
          code: err.code,
        });
        return;
      }
      res.status(400).json({
        action: 'reject',
        message: err.message,
        code: err.code,
      });
      return;
    }

    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      type: 'parse_error',
      data: { error: (err as Error).message, input: req.body?.input?.substring(0, 200) }
    }));

    res.status(500).json({ error: '解析失败，请稍后重试' });
  }
});
