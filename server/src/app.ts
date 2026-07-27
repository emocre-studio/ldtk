import express, { type Express } from 'express';
import cors from 'cors';

export function createApp(_storage: unknown): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
