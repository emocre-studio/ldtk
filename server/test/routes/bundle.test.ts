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

describe('GET /api/project/:id/bundle', () => {
  it('returns default bundle with version "0" for an unknown project', async () => {
    const res = await request(app).get('/api/project/p1/bundle');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('0');
    expect(res.body.manifest).toBeTypeOf('object');
    expect(res.body.levels).toEqual({});
    expect(res.body.images).toEqual([]);
  });

  it('reflects stored manifest, levels and images', async () => {
    await storage.putManifest('p1', { root: true });
    await storage.putLevel('p1', 'iidA', { n: 1 });
    const rec = await storage.putImage(
      'p1',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABS3WWCAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAd0wf9E4kJcgAAAABJRU5ErkJggg==',
        'base64',
      ),
      'tiles.png',
      'image/png',
    );
    const res = await request(app).get('/api/project/p1/bundle');
    expect(res.body.manifest).toEqual({ root: true });
    expect(res.body.levels).toEqual({ iidA: { n: 1 } });
    expect(res.body.images).toEqual([
      { id: rec.id, name: 'tiles.png', pxWid: 2, pxHei: 3, url: `/api/project/p1/images/${rec.id}` },
    ]);
  });
});
