import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let storage: DiskStorage;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
});

describe('CORS policy', () => {
  it('default policy allows a localhost origin', async () => {
    const app = createApp(storage);
    const res = await request(app).get('/health').set('Origin', 'http://localhost:8100');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8100');
  });

  it('default policy does not allow a foreign origin', async () => {
    const app = createApp(storage);
    const res = await request(app).get('/health').set('Origin', 'https://evil.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests without an Origin header', async () => {
    const app = createApp(storage);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('explicit allow list permits the configured origin only', async () => {
    const app = createApp(storage, { corsOrigins: ['https://app.com'] });

    const ok = await request(app).get('/health').set('Origin', 'https://app.com');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.com');

    const denied = await request(app).get('/health').set('Origin', 'http://localhost:8100');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
