import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ImageRecord, StoredImage, Storage } from './Storage.js';

const BLANK_PROJECT_URL = new URL('../../fixtures/blank-project.json', import.meta.url);

export class DiskStorage implements Storage {
  constructor(private readonly baseDir: string) {}

  private projectDir(projectId: string): string {
    return join(this.baseDir, 'projects', projectId);
  }

  private manifestPath(projectId: string): string {
    return join(this.projectDir(projectId), 'manifest.json');
  }

  private versionPath(projectId: string): string {
    return join(this.projectDir(projectId), 'version');
  }

  private levelsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'levels');
  }

  private levelPath(projectId: string, iid: string): string {
    return join(this.levelsDir(projectId), `${iid}.json`);
  }

  private async bump(projectId: string): Promise<string> {
    const current = parseInt(await this.getVersion(projectId), 10);
    const next = String(current + 1);
    await mkdir(this.projectDir(projectId), { recursive: true });
    await writeFile(this.versionPath(projectId), next, 'utf8');
    return next;
  }

  async getVersion(projectId: string): Promise<string> {
    const path = this.versionPath(projectId);
    if (!existsSync(path)) return '0';
    return (await readFile(path, 'utf8')).trim() || '0';
  }

  async getManifest(projectId: string): Promise<unknown> {
    const path = this.manifestPath(projectId);
    if (!existsSync(path)) {
      return JSON.parse(await readFile(BLANK_PROJECT_URL, 'utf8'));
    }
    return JSON.parse(await readFile(path, 'utf8'));
  }

  async putManifest(projectId: string, manifest: unknown): Promise<string> {
    await mkdir(this.projectDir(projectId), { recursive: true });
    await writeFile(this.manifestPath(projectId), JSON.stringify(manifest), 'utf8');
    return this.bump(projectId);
  }

  async listLevels(projectId: string): Promise<Record<string, unknown>> {
    const dir = this.levelsDir(projectId);
    if (!existsSync(dir)) return {};
    const out: Record<string, unknown> = {};
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.json')) continue;
      const iid = file.slice(0, -'.json'.length);
      out[iid] = JSON.parse(await readFile(join(dir, file), 'utf8'));
    }
    return out;
  }

  async getLevel(projectId: string, iid: string): Promise<unknown | null> {
    const path = this.levelPath(projectId, iid);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, 'utf8'));
  }

  async putLevel(projectId: string, iid: string, level: unknown): Promise<string> {
    await mkdir(this.levelsDir(projectId), { recursive: true });
    await writeFile(this.levelPath(projectId, iid), JSON.stringify(level), 'utf8');
    return this.bump(projectId);
  }

  async deleteLevel(projectId: string, iid: string): Promise<string | null> {
    const path = this.levelPath(projectId, iid);
    if (!existsSync(path)) return null;
    await rm(path);
    return this.bump(projectId);
  }
  async listImages(): Promise<ImageRecord[]> {
    throw new Error('not implemented');
  }
  async putImage(): Promise<ImageRecord> {
    throw new Error('not implemented');
  }
  async getImage(): Promise<StoredImage | null> {
    throw new Error('not implemented');
  }
}

// silence unused import in this task; used by later tasks
void dirname;
void fileURLToPath;
