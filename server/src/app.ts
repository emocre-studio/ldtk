import express, { type Express } from 'express';
import cors from 'cors';
import type { Storage } from './storage/Storage.js';
import { createProjectRouter } from './routes/bundle.js';
import { createMutationRouter } from './routes/mutations.js';
import { createImageRouter } from './routes/images.js';
import { errorMiddleware } from './errors.js';

export function createApp(storage: Storage): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(createProjectRouter(storage));
  app.use(createMutationRouter(storage));
  app.use(createImageRouter(storage));

  app.use(errorMiddleware);
  return app;
}
