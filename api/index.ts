import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import cors from 'cors';
import { queryRouter } from '../server/routes/query.js';
import { briefingRouter } from '../server/routes/briefing.js';
import { parseRouter } from '../server/routes/parse.js';
import { generateSpecRouter } from '../server/routes/generate-spec.js';
import { registry } from '../server/lib/metrics/registry.js';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', queryRouter);
app.use('/api', briefingRouter);
app.use('/api', parseRouter);
app.use('/api', generateSpecRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', metrics_count: registry.getAllMetrics().length });
});

export default app;
