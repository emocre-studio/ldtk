import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageSize } from 'image-size';
import type { ImageRecord, StoredImage, Storage } from './Storage.js';

const BLANK_PROJECT_URL = new URL('../../fixtures/blank-project.json', import.meta.url);

/**
 * Um caminho ausente é estado normal aqui (projeto novo, nível inexistente),
 * não erro. Capturar ENOENT da própria operação evita o padrão check-then-act
 * (`existsSync` seguido de leitura), onde o arquivo pode sumir entre as duas.
 */
function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function orNull<T>(op: Promise<T>): Promise<T | null> {
  try {
    return await op;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

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

  async bumpVersion(projectId: string): Promise<string> {
    const parsed = parseInt(await this.getVersion(projectId), 10);
    const current = Number.isFinite(parsed) ? parsed : 0;
    const next = String(current + 1);
    await mkdir(this.projectDir(projectId), { recursive: true });
    await writeFile(this.versionPath(projectId), next, 'utf8');
    return next;
  }

  async getVersion(projectId: string): Promise<string> {
    const raw = await orNull(readFile(this.versionPath(projectId), 'utf8'));
    return raw?.trim() || '0';
  }

  async getManifest(projectId: string): Promise<unknown> {
    const raw = await orNull(readFile(this.manifestPath(projectId), 'utf8'));
    if (raw === null) return JSON.parse(await readFile(BLANK_PROJECT_URL, 'utf8'));
    return JSON.parse(raw);
  }

  async putManifest(projectId: string, manifest: unknown): Promise<string> {
    await mkdir(this.projectDir(projectId), { recursive: true });
    await writeFile(this.manifestPath(projectId), JSON.stringify(manifest), 'utf8');
    return this.bumpVersion(projectId);
  }

  async listLevels(projectId: string): Promise<Record<string, unknown>> {
    const dir = this.levelsDir(projectId);
    const files = await orNull(readdir(dir));
    if (files === null) return {};
    const out: Record<string, unknown> = {};
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await orNull(readFile(join(dir, file), 'utf8'));
      if (raw !== null) out[file.slice(0, -'.json'.length)] = JSON.parse(raw);
    }
    return out;
  }

  async getLevel(projectId: string, iid: string): Promise<unknown | null> {
    const raw = await orNull(readFile(this.levelPath(projectId, iid), 'utf8'));
    return raw === null ? null : JSON.parse(raw);
  }

  async putLevel(projectId: string, iid: string, level: unknown): Promise<string> {
    await mkdir(this.levelsDir(projectId), { recursive: true });
    await writeFile(this.levelPath(projectId, iid), JSON.stringify(level), 'utf8');
    return this.bumpVersion(projectId);
  }

  async deleteLevel(projectId: string, iid: string): Promise<string | null> {
    const removed = await orNull(rm(this.levelPath(projectId, iid)));
    if (removed === null) return null;
    return this.bumpVersion(projectId);
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
    const files = await orNull(readdir(dir));
    if (files === null) return [];
    const out: ImageRecord[] = [];
    for (const file of files) {
      if (!file.endsWith('.meta.json')) continue;
      const raw = await orNull(readFile(join(dir, file), 'utf8'));
      if (raw === null) continue;
      const meta = JSON.parse(raw);
      out.push({
        id: file.slice(0, -'.meta.json'.length),
        name: meta.name,
        pxWid: meta.pxWid,
        pxHei: meta.pxHei,
      });
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
    const id = `img_${randomUUID()}`;
    const ext = this.extFor(contentType);
    await writeFile(join(dir, `${id}.${ext}`), bytes);
    const meta = { name, pxWid: dims.width, pxHei: dims.height, contentType };
    await writeFile(join(dir, `${id}.meta.json`), JSON.stringify(meta), 'utf8');
    return { id, name, pxWid: dims.width, pxHei: dims.height };
  }

  async getImage(projectId: string, imgId: string): Promise<StoredImage | null> {
    const dir = this.imagesDir(projectId);
    const rawMeta = await orNull(readFile(join(dir, `${imgId}.meta.json`), 'utf8'));
    if (rawMeta === null) return null;
    const meta = JSON.parse(rawMeta);
    const bytes = await orNull(readFile(join(dir, `${imgId}.${this.extFor(meta.contentType)}`)));
    if (bytes === null) return null;
    return { bytes, contentType: meta.contentType };
  }

  async deleteImage(projectId: string, imgId: string): Promise<boolean> {
    const dir = this.imagesDir(projectId);
    const metaPath = join(dir, `${imgId}.meta.json`);
    const rawMeta = await orNull(readFile(metaPath, 'utf8'));
    if (rawMeta === null) return false;
    const meta = JSON.parse(rawMeta);
    await orNull(rm(join(dir, `${imgId}.${this.extFor(meta.contentType)}`)));
    await orNull(rm(metaPath));
    return true;
  }
}
