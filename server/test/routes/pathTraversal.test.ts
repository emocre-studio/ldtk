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

describe('path traversal protection', () => {
  it('rejects a level iid containing an encoded traversal sequence', async () => {
    const res = await request(app)
      .put('/api/project/p1/level/' + encodeURIComponent('../../pwned'))
      .set('If-Match', '0')
      .send({ n: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_id');
  });

  it('rejects a project id containing an encoded traversal sequence', async () => {
    const res = await request(app).get(
      '/api/project/' + encodeURIComponent('../../x') + '/bundle',
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_id');
  });

  it('still accepts a normal UUID-style iid', async () => {
    const res = await request(app)
      .put('/api/project/p1/level/a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      .set('If-Match', '0')
      .send({ n: 1 });
    expect(res.status).toBe(200);
  });

  it('does not echo the rejected value back to the client', async () => {
    const res = await request(app)
      .get(`/api/project/${encodeURIComponent('../../secret')}/bundle`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_id');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
