import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let storage: DiskStorage;
let png: Buffer;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
  png = await readFile(new URL('../fixtures/2x3.png', import.meta.url));
});

describe('DiskStorage images', () => {
  it('stores an image and extracts its dimensions', async () => {
    const rec = await storage.putImage('p1', png, 'tiles.png', 'image/png');
    expect(rec.name).toBe('tiles.png');
    expect(rec.pxWid).toBe(2);
    expect(rec.pxHei).toBe(3);
    expect(rec.id).toMatch(/^img_/);
  });

  it('does not bump project version on image upload', async () => {
    await storage.putImage('p1', png, 'tiles.png', 'image/png');
    expect(await storage.getVersion('p1')).toBe('0');
  });

  it('reads back stored image bytes and content type', async () => {
    const rec = await storage.putImage('p1', png, 'tiles.png', 'image/png');
    const got = await storage.getImage('p1', rec.id);
    expect(got).not.toBeNull();
    expect(got!.contentType).toBe('image/png');
    expect(Buffer.compare(got!.bytes, png)).toBe(0);
  });

  it('lists stored images', async () => {
    await storage.putImage('p1', png, 'a.png', 'image/png');
    await storage.putImage('p1', png, 'b.png', 'image/png');
    const list = await storage.listImages('p1');
    expect(list.map((r) => r.name).sort()).toEqual(['a.png', 'b.png']);
  });

  it('returns null for an unknown image', async () => {
    expect(await storage.getImage('p1', 'nope')).toBeNull();
  });
});
