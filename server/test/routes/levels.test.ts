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

describe('level mutations', () => {
  it('stores a level with a valid If-Match', async () => {
    const res = await request(app)
      .put('/api/project/p1/level/iidA')
      .set('If-Match', '0')
      .send({ n: 1 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(await storage.getLevel('p1', 'iidA')).toEqual({ n: 1 });
  });

  it('rejects a stale level write with 409', async () => {
    await request(app).put('/api/project/p1/level/iidA').set('If-Match', '0').send({ n: 1 });
    const res = await request(app)
      .put('/api/project/p1/level/iidB')
      .set('If-Match', '0')
      .send({ n: 2 });
    expect(res.status).toBe(409);
  });

  it('deletes an existing level', async () => {
    await request(app).put('/api/project/p1/level/iidA').set('If-Match', '0').send({ n: 1 });
    const res = await request(app)
      .delete('/api/project/p1/level/iidA')
      .set('If-Match', '1');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2');
    expect(await storage.getLevel('p1', 'iidA')).toBeNull();
  });

  it('returns 404 when deleting an unknown level', async () => {
    const res = await request(app)
      .delete('/api/project/p1/level/nope')
      .set('If-Match', '0');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('level_not_found');
  });
});
