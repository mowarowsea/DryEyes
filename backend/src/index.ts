import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { watchesRouter } from './routes/watches.js';

const app = express();

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/health', healthRouter);
app.use('/api/watches', watchesRouter);

app.listen(config.port, () => {
  console.log(`[DryEyes BFF] Server is running on http://localhost:${config.port}`);
  console.log(`[DryEyes BFF] Changedetection URL: ${config.changedetection.baseUrl}`);
  console.log(`[DryEyes BFF] ntfy URL: ${config.ntfy.baseUrl}`);
});
