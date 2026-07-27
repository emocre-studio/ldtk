import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let app: ReturnType<typeof createApp>;
let storage: DiskStorage;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
  app = createApp(storage);
});

describe('PUT /api/project/:id/manifest', () => {
  it('creates the project on first write with If-Match "0"', async () => {
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0')
      .send({ root: true });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(res.headers.etag).toBe('1');
    expect(await storage.getManifest('p1')).toEqual({ root: true });
  });

  it('rejects a write without If-Match with 428', async () => {
    const res = await request(app).put('/api/project/p1/manifest').send({ root: true });
    expect(res.status).toBe(428);
    expect(res.body.code).toBe('precondition_required');
  });

  it('rejects a stale write with 409', async () => {
    await request(app).put('/api/project/p1/manifest').set('If-Match', '0').send({ a: 1 });
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0') // stale: server is at "1"
      .send({ a: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('version_conflict');
    expect(await storage.getManifest('p1')).toEqual({ a: 1 }); // unchanged
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0')
      .set('Content-Type', 'application/json')
      .send('{ not json ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });
});
