import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { imageSize } from 'image-size';
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
  private imagesDir(projectId: string): string {
    return join(this.projectDir(projectId), 'images');
  }

  private extFor(contentType: string): string {
    if (contentType === 'image/jpeg') return 'jpg';
    if (contentType === 'image/gif') return 'gif';
    return 'png';
  }

  async listImages(projectId: string): Promise<ImageRecord[]> {
    const dir = this.imagesDir(projectId);
    if (!existsSync(dir)) return [];
    const out: ImageRecord[] = [];
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.meta.json')) continue;
      const id = file.slice(0, -'.meta.json'.length);
      const meta = JSON.parse(await readFile(join(dir, file), 'utf8'));
      out.push({ id, name: meta.name, pxWid: meta.pxWid, pxHei: meta.pxHei });
    }
    return out;
  }

  async putImage(
    projectId: string,
    bytes: Buffer,
    name: string,
    contentType: string,
  ): Promise<ImageRecord> {
    const dir = this.imagesDir(projectId);
    await mkdir(dir, { recursive: true });
    const dims = imageSize(bytes);
    const existing = existsSync(dir)
      ? (await readdir(dir)).filter((f) => f.endsWith('.meta.json')).length
      : 0;
    const id = `img_${existing + 1}`;
    const ext = this.extFor(contentType);
    await writeFile(join(dir, `${id}.${ext}`), bytes);
    const meta = { name, pxWid: dims.width, pxHei: dims.height, contentType };
    await writeFile(join(dir, `${id}.meta.json`), JSON.stringify(meta), 'utf8');
    return { id, name, pxWid: dims.width, pxHei: dims.height };
  }

  async getImage(projectId: string, imgId: string): Promise<StoredImage | null> {
    const dir = this.imagesDir(projectId);
    const metaPath = join(dir, `${imgId}.meta.json`);
    if (!existsSync(metaPath)) return null;
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const ext = this.extFor(meta.contentType);
    const bytes = await readFile(join(dir, `${imgId}.${ext}`));
    return { bytes, contentType: meta.contentType };
  }
}
