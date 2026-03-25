import dotenv from 'dotenv';
dotenv.config({ path: '/workspaces/ai-data-chat/.env.local' });

import express from 'express';
import cors from 'cors';
import { queryRouter } from './routes/query.js';
import { briefingRouter } from './routes/briefing.js';
import { parseRouter } from './routes/parse.js';
import { generateSpecRouter } from './routes/generate-spec.js';
import { registry } from './lib/metrics/registry.js';
import { logger } from './middleware/logger.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(logger);

// Routes
app.use('/api', queryRouter);
app.use('/api', briefingRouter);
app.use('/api', parseRouter);
app.use('/api', generateSpecRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', metrics_count: registry.getAllMetrics().length });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Metrics loaded: ${registry.getAllMetrics().length}`);
});
