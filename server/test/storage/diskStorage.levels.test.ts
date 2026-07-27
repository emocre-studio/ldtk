import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let storage: DiskStorage;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
});

describe('DiskStorage levels', () => {
  it('returns an empty map for a project with no levels', async () => {
    expect(await storage.listLevels('p1')).toEqual({});
  });

  it('stores and reads a level by iid, bumping version', async () => {
    const v = await storage.putLevel('p1', 'iidA', { n: 1 });
    expect(v).toBe('1');
    expect(await storage.getLevel('p1', 'iidA')).toEqual({ n: 1 });
  });

  it('lists levels keyed by iid', async () => {
    await storage.putLevel('p1', 'iidA', { n: 1 });
    await storage.putLevel('p1', 'iidB', { n: 2 });
    expect(await storage.listLevels('p1')).toEqual({ iidA: { n: 1 }, iidB: { n: 2 } });
  });

  it('returns null when getting an unknown level', async () => {
    expect(await storage.getLevel('p1', 'nope')).toBeNull();
  });

  it('deletes a level and bumps version', async () => {
    await storage.putLevel('p1', 'iidA', { n: 1 }); // version -> 1
    const v = await storage.deleteLevel('p1', 'iidA'); // version -> 2
    expect(v).toBe('2');
    expect(await storage.getLevel('p1', 'iidA')).toBeNull();
  });

  it('returns null when deleting an unknown level', async () => {
    expect(await storage.deleteLevel('p1', 'nope')).toBeNull();
  });
});
