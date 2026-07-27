import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { DiskStorage } from '../src/storage/DiskStorage.js';

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  app = createApp(new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-'))));
});

describe('end-to-end happy path', () => {
  it('opens default, saves manifest + level (ETag chain), reloads', async () => {
    // open
    const open = await request(app).get('/api/project/game/bundle');
    expect(open.status).toBe(200);
    let etag = open.body.version; // "0"

    // flush: manifest then level, threading the returned ETag
    const m = await request(app)
      .put('/api/project/game/manifest')
      .set('If-Match', etag)
      .send({ world: 'A' });
    expect(m.status).toBe(200);
    etag = m.body.version; // "1"

    const l = await request(app)
      .put('/api/project/game/level/lvl1')
      .set('If-Match', etag)
      .send({ tiles: [] });
    expect(l.status).toBe(200);
    etag = l.body.version; // "2"

    // reload reflects persisted state
    const reload = await request(app).get('/api/project/game/bundle');
    expect(reload.body.version).toBe('2');
    expect(reload.body.manifest).toEqual({ world: 'A' });
    expect(reload.body.levels).toEqual({ lvl1: { tiles: [] } });
  });

  it('uploads an image and serves it back', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABS3WWCAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAd0wf9E4kJcgAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await request(app)
      .post('/api/project/game/images')
      .attach('file', png, { filename: 'tiles.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const get = await request(app).get(up.body.url);
    expect(get.status).toBe(200);
    expect(get.headers['content-type']).toContain('image/png');
  });
});
