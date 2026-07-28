import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { DiskStorage } from '../src/storage/DiskStorage.js';
import { errorMiddleware, HttpError } from '../src/errors.js';

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  app = createApp(new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-'))));
});

describe('errorMiddleware: erros do body-parser', () => {
  it('malformed JSON is a 400 invalid_json', async () => {
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0')
      .set('Content-Type', 'application/json')
      .send('{ not json ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });

  it('oversized payload is a 413, not a 500', async () => {
    // app dedicado com limite minúsculo, para não precisar mandar 64mb
    const tiny = express();
    tiny.use(express.json({ limit: '100b' }));
    tiny.post('/x', (_req, res) => res.json({ ok: true }));
    tiny.use(errorMiddleware);

    const res = await request(tiny)
      .post('/x')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ a: 'x'.repeat(500) }));

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });
});

describe('errorMiddleware: demais casos', () => {
  it('HttpError keeps its status and code', async () => {
    const tiny = express();
    tiny.get('/x', () => {
      throw new HttpError(404, 'nope', 'Not here');
    });
    tiny.use(errorMiddleware);

    const res = await request(tiny).get('/x');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not here', code: 'nope' });
  });

  it('unknown errors stay a 500 without leaking details', async () => {
    const tiny = express();
    tiny.get('/x', () => {
      throw new Error('detalhe interno sensível');
    });
    tiny.use(errorMiddleware);

    const res = await request(tiny).get('/x');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal error', code: 'internal' });
    expect(JSON.stringify(res.body)).not.toContain('sensível');
  });
});
