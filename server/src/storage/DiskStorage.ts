import { readFile, writeFile, mkdir } from 'node:fs/promises';
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

  async listLevels(): Promise<Record<string, unknown>> {
    throw new Error('not implemented');
  }
  async getLevel(): Promise<unknown | null> {
    throw new Error('not implemented');
  }
  async putLevel(): Promise<string> {
    throw new Error('not implemented');
  }
  async deleteLevel(): Promise<string | null> {
    throw new Error('not implemented');
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
