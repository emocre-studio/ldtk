import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let app: ReturnType<typeof createApp>;
let storage: DiskStorage;
let pngPath: string;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
  app = createApp(storage);
  pngPath = new URL('../fixtures/2x3.png', import.meta.url).pathname;
});

describe('image routes', () => {
  it('uploads a PNG and returns its record', async () => {
    const res = await request(app)
      .post('/api/project/p1/images')
      .attach('file', pngPath, { filename: 'tiles.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'tiles.png', pxWid: 2, pxHei: 3 });
    expect(res.body.url).toBe(`/api/project/p1/images/${res.body.id}`);
  });

  it('serves uploaded image bytes with content type', async () => {
    const up = await request(app)
      .post('/api/project/p1/images')
      .attach('file', pngPath, { filename: 'tiles.png', contentType: 'image/png' });
    const res = await request(app).get(`/api/project/p1/images/${up.body.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    const original = await readFile(pngPath);
    expect(Buffer.compare(res.body, original)).toBe(0);
  });

  it('rejects an unsupported media type with 415', async () => {
    const res = await request(app)
      .post('/api/project/p1/images')
      .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/project/p1/images');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_file');
  });

  it('returns 404 for an unknown image', async () => {
    const res = await request(app).get('/api/project/p1/images/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('image_not_found');
  });
});
