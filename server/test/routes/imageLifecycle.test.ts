import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let app: ReturnType<typeof createApp>;
let storage: DiskStorage;
let png: Buffer;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
  app = createApp(storage);
  png = await readFile(new URL('../fixtures/2x3.png', import.meta.url));
});

async function upload(name: string) {
  const res = await request(app)
    .post('/api/project/p1/images')
    .attach('file', png, { filename: name, contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('DELETE image', () => {
  it('removes the image and bumps the version', async () => {
    const id = await upload('a.png');
    expect(await storage.getVersion('p1')).toBe('0'); // upload não versiona

    const res = await request(app).delete(`/api/project/p1/images/${id}`).set('If-Match', '0');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(await storage.getImage('p1', id)).toBeNull();
  });

  it('requires If-Match', async () => {
    const id = await upload('a.png');
    const res = await request(app).delete(`/api/project/p1/images/${id}`);
    expect(res.status).toBe(428);
  });

  it('rejects a stale If-Match', async () => {
    const id = await upload('a.png');
    await request(app).delete(`/api/project/p1/images/${id}`).set('If-Match', '0');
    const res = await request(app).delete(`/api/project/p1/images/${id}`).set('If-Match', '0');
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown image', async () => {
    const res = await request(app).delete('/api/project/p1/images/nope').set('If-Match', '0');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('image_not_found');
  });
});

describe('POST images/prune', () => {
  it('deletes images outside the keep list', async () => {
    const keep = await upload('keep.png');
    const drop = await upload('drop.png');

    const res = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: [keep] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual([drop]);
    expect(res.body.version).toBe('1');

    const left = await storage.listImages('p1');
    expect(left.map((r) => r.id)).toEqual([keep]);
  });

  it('is a no-op when nothing is orphaned', async () => {
    const a = await upload('a.png');
    const res = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: [a] });
    expect(res.body.deleted).toEqual([]);
    expect((await storage.listImages('p1')).length).toBe(1);
  });

  it('empty keep list deletes every image', async () => {
    await upload('a.png');
    await upload('b.png');
    const res = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: [] });
    expect(res.body.deleted).toHaveLength(2);
    expect(await storage.listImages('p1')).toEqual([]);
  });

  it('rejects a missing or non-array keep', async () => {
    const a = await request(app).post('/api/project/p1/images/prune').set('If-Match', '0').send({});
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('invalid_keep');

    const b = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: 'nope' });
    expect(b.status).toBe(400);
  });

  it('requires If-Match', async () => {
    const res = await request(app).post('/api/project/p1/images/prune').send({ keep: [] });
    expect(res.status).toBe(428);
  });
});
