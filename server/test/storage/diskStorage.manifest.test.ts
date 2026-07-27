import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let baseDir: string;
let storage: DiskStorage;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'ldtk-store-'));
  storage = new DiskStorage(baseDir);
});

describe('DiskStorage manifest + version', () => {
  it('returns version "0" for an unknown project', async () => {
    expect(await storage.getVersion('p1')).toBe('0');
  });

  it('returns the blank fixture as the default manifest', async () => {
    const blank = JSON.parse(
      await readFile(new URL('../../fixtures/blank-project.json', import.meta.url), 'utf8'),
    );
    expect(await storage.getManifest('p1')).toEqual(blank);
  });

  it('does not persist anything when reading a default manifest', async () => {
    await storage.getManifest('p1');
    expect(await storage.getVersion('p1')).toBe('0');
  });

  it('persists a manifest and bumps version to "1"', async () => {
    const m = { hello: 'world' };
    const v = await storage.putManifest('p1', m);
    expect(v).toBe('1');
    expect(await storage.getVersion('p1')).toBe('1');
    expect(await storage.getManifest('p1')).toEqual(m);
  });

  it('bumps version on each manifest write', async () => {
    await storage.putManifest('p1', { a: 1 });
    const v2 = await storage.putManifest('p1', { a: 2 });
    expect(v2).toBe('2');
  });
});
