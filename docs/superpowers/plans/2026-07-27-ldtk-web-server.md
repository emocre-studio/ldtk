# LDtk Web Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o servidor HTTP que carrega e persiste projetos LDtk (manifesto + níveis separados + imagens) para o editor web embutido.

**Architecture:** API REST em Node/TypeScript com Express. Uma camada `Storage` (interface) isola persistência; a implementação inicial `DiskStorage` grava em disco espelhando o modelo multi-arquivo do LDtk. O JSON do projeto é tratado como **opaco** (validado só como JSON, não contra o schema LDtk). Conflito de escrita é detectado por uma `version`/ETag por projeto. As rotas cuidam de HTTP (If-Match, status); o `Storage` cuida de persistência.

**Tech Stack:** Node.js, TypeScript, Express, multer (multipart), image-size (dimensões de imagem), cors; testes com vitest + supertest.

## Global Constraints

- Runtime: Node.js >= 20.
- TypeScript estrito (`"strict": true`).
- O servidor **não** valida o JSON do projeto contra o schema LDtk — apenas que é JSON válido e dentro do limite de tamanho.
- Formato de fio = JSON nativo do LDtk (`ProjectJson` no manifesto, `LevelJson` nos níveis).
- Sem autenticação no MVP — apenas `projectId` na rota.
- Versão/ETag: string; projeto inexistente ⇒ `"0"`. Todo `PUT`/`DELETE` de manifesto ou nível bem-sucedido incrementa a versão. Upload de imagem **não** incrementa.
- Todas as respostas de erro têm corpo `{ error: string, code: string }` com status HTTP adequado.
- `url` de imagem é retornada como caminho relativo (`/api/project/:id/images/:imgId`); o cliente resolve contra a base.
- Todo o código do servidor vive em `server/` na raiz do repositório.

---

### Task 1: Scaffolding do projeto do servidor

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/.gitignore`
- Create: `server/src/app.ts`
- Test: `server/test/app.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `createApp(storage: Storage): express.Express` — fábrica do app Express sem `listen`, com CORS e `express.json({ limit: '64mb' })` habilitados, e uma rota `GET /health` → `200 { ok: true }`. Nesta tarefa `Storage` ainda não existe; `createApp` recebe `storage: unknown` temporariamente e é retipado na Task 2.

- [ ] **Step 1: Criar `server/package.json`**

```json
{
  "name": "ldtk-web-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "image-size": "^2.0.0",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Criar `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Criar `server/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Criar `server/.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 5: Instalar dependências**

Run: `cd server && npm install`
Expected: cria `node_modules/` e `package-lock.json` sem erros.

- [ ] **Step 6: Escrever o teste que falha**

`server/test/app.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('createApp', () => {
  it('responds to GET /health', async () => {
    const app = createApp({} as never);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 7: Rodar o teste e ver falhar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module '../src/app.js'`.

- [ ] **Step 8: Implementar `server/src/app.ts`**

```typescript
import express, { type Express } from 'express';
import cors from 'cors';

export function createApp(_storage: unknown): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 9: Rodar o teste e ver passar**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/.gitignore server/src/app.ts server/test/app.test.ts server/package-lock.json
git commit -m "feat(server): scaffolding do servidor web + rota /health"
```

---

### Task 2: `Storage` interface + `DiskStorage` (versão e manifesto)

**Files:**
- Create: `server/src/storage/Storage.ts`
- Create: `server/src/storage/DiskStorage.ts`
- Create: `server/fixtures/blank-project.json`
- Test: `server/test/storage/diskStorage.manifest.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Tipos:
    ```typescript
    export interface ImageRecord { id: string; name: string; pxWid: number; pxHei: number }
    export interface StoredImage { bytes: Buffer; contentType: string }
    export interface Storage {
      getVersion(projectId: string): Promise<string>;              // "0" se não existe
      getManifest(projectId: string): Promise<unknown>;            // JSON parseado; default se não existe
      putManifest(projectId: string, manifest: unknown): Promise<string>; // retorna nova versão
      listLevels(projectId: string): Promise<Record<string, unknown>>;    // iid -> JSON parseado
      getLevel(projectId: string, iid: string): Promise<unknown | null>;
      putLevel(projectId: string, iid: string, level: unknown): Promise<string>; // nova versão
      deleteLevel(projectId: string, iid: string): Promise<string | null>;       // nova versão, ou null se não existia
      listImages(projectId: string): Promise<ImageRecord[]>;
      putImage(projectId: string, bytes: Buffer, name: string, contentType: string): Promise<ImageRecord>;
      getImage(projectId: string, imgId: string): Promise<StoredImage | null>;
    }
    ```
  - `class DiskStorage implements Storage` — construtor `new DiskStorage(baseDir: string)`. Nesta tarefa apenas `getVersion`, `getManifest`, `putManifest` são implementados de verdade; `listLevels`/`getLevel`/`putLevel`/`deleteLevel`/`listImages`/`putImage`/`getImage` lançam `Error('not implemented')` (substituídos nas Tasks 3 e 4).
  - Layout em disco: `<baseDir>/projects/<projectId>/manifest.json`, `.../version`, `.../levels/<iid>.json`, `.../images/<imgId>.png` + `.../images/<imgId>.meta.json`.

- [ ] **Step 1: Copiar o fixture de projeto em branco**

O repo já contém um projeto LDtk vazio e válido, gerado pelo próprio editor: `tests/_empty.ldtk` (jsonVersion 1.5.3, `externalLevels: false`, 1 nível vazio). Copiá-lo como fixture — o servidor o serve como default para projetos inexistentes, tratando-o como JSON opaco.

Run:
```bash
mkdir -p server/fixtures && cp tests/_empty.ldtk server/fixtures/blank-project.json && node -e "JSON.parse(require('fs').readFileSync('server/fixtures/blank-project.json','utf8')); console.log('ok')"
```
Expected: imprime `ok`.

- [ ] **Step 2: Escrever o teste que falha**

`server/test/storage/diskStorage.manifest.test.ts`:

```typescript
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
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd server && npm test -- diskStorage.manifest`
Expected: FAIL — `Cannot find module '../../src/storage/DiskStorage.js'`.

- [ ] **Step 4: Criar `server/src/storage/Storage.ts`**

```typescript
export interface ImageRecord {
  id: string;
  name: string;
  pxWid: number;
  pxHei: number;
}

export interface StoredImage {
  bytes: Buffer;
  contentType: string;
}

export interface Storage {
  getVersion(projectId: string): Promise<string>;
  getManifest(projectId: string): Promise<unknown>;
  putManifest(projectId: string, manifest: unknown): Promise<string>;
  listLevels(projectId: string): Promise<Record<string, unknown>>;
  getLevel(projectId: string, iid: string): Promise<unknown | null>;
  putLevel(projectId: string, iid: string, level: unknown): Promise<string>;
  deleteLevel(projectId: string, iid: string): Promise<string | null>;
  listImages(projectId: string): Promise<ImageRecord[]>;
  putImage(
    projectId: string,
    bytes: Buffer,
    name: string,
    contentType: string,
  ): Promise<ImageRecord>;
  getImage(projectId: string, imgId: string): Promise<StoredImage | null>;
}
```

- [ ] **Step 5: Implementar `server/src/storage/DiskStorage.ts` (versão + manifesto; resto em stub)**

```typescript
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
```

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `cd server && npm test -- diskStorage.manifest`
Expected: PASS (5 testes).

- [ ] **Step 7: Commit**

```bash
git add server/src/storage/Storage.ts server/src/storage/DiskStorage.ts server/fixtures/blank-project.json server/test/storage/diskStorage.manifest.test.ts
git commit -m "feat(server): Storage interface + DiskStorage (versão e manifesto)"
```

---

### Task 3: `DiskStorage` — níveis

**Files:**
- Modify: `server/src/storage/DiskStorage.ts` (substituir os stubs de nível)
- Test: `server/test/storage/diskStorage.levels.test.ts`

**Interfaces:**
- Consumes: `DiskStorage` da Task 2.
- Produces: `listLevels`, `getLevel`, `putLevel`, `deleteLevel` implementados. Níveis em `<projectDir>/levels/<iid>.json`. `deleteLevel` retorna `null` se o nível não existia (rota traduz em 404). `putLevel` e `deleteLevel` (quando existia) incrementam a versão do projeto.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/storage/diskStorage.levels.test.ts`:

```typescript
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
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npm test -- diskStorage.levels`
Expected: FAIL — `not implemented`.

- [ ] **Step 3: Implementar os métodos de nível**

Em `server/src/storage/DiskStorage.ts`, adicionar o import de `readdir`/`rm` no topo:

```typescript
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
```

Adicionar helper e substituir os quatro stubs de nível:

```typescript
  private levelsDir(projectId: string): string {
    return join(this.projectDir(projectId), 'levels');
  }

  private levelPath(projectId: string, iid: string): string {
    return join(this.levelsDir(projectId), `${iid}.json`);
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
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd server && npm test -- diskStorage.levels`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add server/src/storage/DiskStorage.ts server/test/storage/diskStorage.levels.test.ts
git commit -m "feat(server): DiskStorage — persistência de níveis"
```

---

### Task 4: `DiskStorage` — imagens

**Files:**
- Modify: `server/src/storage/DiskStorage.ts` (substituir os stubs de imagem)
- Test: `server/test/storage/diskStorage.images.test.ts`
- Test (fixture): `server/test/fixtures/2x3.png` (gerado no Step 1)

**Interfaces:**
- Consumes: `DiskStorage` das Tasks 2–3.
- Produces: `listImages`, `putImage`, `getImage` implementados. `putImage` extrai dimensões com `image-size`, gera um `id` (`img_<contador>` derivado dos arquivos existentes) e grava `<imgId>.<ext>` + `<imgId>.meta.json` (`{ name, pxWid, pxHei, contentType }`). Upload de imagem **não** incrementa a versão do projeto. `getImage` retorna `null` se não existe.

- [ ] **Step 1: Gerar o PNG de fixture 2x3**

Run:
```bash
cd server && mkdir -p test/fixtures && node -e "const fs=require('fs'); const b=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABS3WWCAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAd0wf9E4kJcgAAAABJRU5ErkJggg==','base64'); fs.writeFileSync('test/fixtures/2x3.png', b); console.log('bytes', b.length)"
```
Expected: cria `test/fixtures/2x3.png` (um PNG 2×3 válido) e imprime o tamanho em bytes.

- [ ] **Step 2: Escrever o teste que falha**

`server/test/storage/diskStorage.images.test.ts`:

```typescript
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
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd server && npm test -- diskStorage.images`
Expected: FAIL — `not implemented`.

- [ ] **Step 4: Implementar os métodos de imagem**

Em `server/src/storage/DiskStorage.ts`, adicionar imports no topo:

```typescript
import { imageSize } from 'image-size';
```

Substituir os três stubs de imagem e remover as linhas `void dirname; void fileURLToPath;` e o import não usado de `dirname`/`fileURLToPath` (não são mais necessários):

```typescript
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
```

Também remover, no topo do arquivo, o import `import { fileURLToPath } from 'node:url';` e a linha `import { join, dirname } from 'node:path';` deve virar `import { join } from 'node:path';`.

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd server && npm test -- diskStorage.images`
Expected: PASS (5 testes).

- [ ] **Step 6: Rodar toda a suíte de storage**

Run: `cd server && npm test`
Expected: PASS (todos os testes de storage + app).

- [ ] **Step 7: Commit**

```bash
git add server/src/storage/DiskStorage.ts server/test/storage/diskStorage.images.test.ts server/test/fixtures/2x3.png
git commit -m "feat(server): DiskStorage — upload e leitura de imagens"
```

---

### Task 5: Helper de erros + rota `GET /api/project/:id/bundle`

**Files:**
- Create: `server/src/errors.ts`
- Create: `server/src/routes/bundle.ts`
- Modify: `server/src/app.ts` (montar o router e o error handler; retipar `storage: Storage`)
- Test: `server/test/routes/bundle.test.ts`

**Interfaces:**
- Consumes: `Storage`, `createApp`.
- Produces:
  - `errors.ts`: `class HttpError extends Error { constructor(status: number, code: string, message: string) }`, `asyncHandler(fn)` (envolve handler async e encaminha erros para o `next`), e `errorMiddleware(err, req, res, next)` que serializa `HttpError` como `{ error, code }` no status certo e trata `SyntaxError` do `express.json` como `400 invalid_json`.
  - `bundle.ts`: `createProjectRouter(storage: Storage): express.Router` com `GET /api/project/:id/bundle` → `200 { version, manifest, levels, images }` onde `images[].url = "/api/project/:id/images/:imgId"`.
  - `createApp` passa a receber `storage: Storage`, monta `createProjectRouter(storage)` e o `errorMiddleware` por último.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/routes/bundle.test.ts`:

```typescript
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

describe('GET /api/project/:id/bundle', () => {
  it('returns default bundle with version "0" for an unknown project', async () => {
    const res = await request(app).get('/api/project/p1/bundle');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('0');
    expect(res.body.manifest).toBeTypeOf('object');
    expect(res.body.levels).toEqual({});
    expect(res.body.images).toEqual([]);
  });

  it('reflects stored manifest, levels and images', async () => {
    await storage.putManifest('p1', { root: true });
    await storage.putLevel('p1', 'iidA', { n: 1 });
    const rec = await storage.putImage(
      'p1',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABS3WWCAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAd0wf9E4kJcgAAAABJRU5ErkJggg==',
        'base64',
      ),
      'tiles.png',
      'image/png',
    );
    const res = await request(app).get('/api/project/p1/bundle');
    expect(res.body.manifest).toEqual({ root: true });
    expect(res.body.levels).toEqual({ iidA: { n: 1 } });
    expect(res.body.images).toEqual([
      { id: rec.id, name: 'tiles.png', pxWid: 2, pxHei: 3, url: `/api/project/p1/images/${rec.id}` },
    ]);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npm test -- routes/bundle`
Expected: FAIL — rota inexistente (404) / import ausente.

- [ ] **Step 3: Criar `server/src/errors.ts`**

```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON body', code: 'invalid_json' });
    return;
  }
  res.status(500).json({ error: 'Internal error', code: 'internal' });
}
```

- [ ] **Step 4: Criar `server/src/routes/bundle.ts`**

```typescript
import { Router } from 'express';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler } from '../errors.js';

export function createProjectRouter(storage: Storage): Router {
  const router = Router();

  router.get(
    '/api/project/:id/bundle',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const [version, manifest, levels, images] = await Promise.all([
        storage.getVersion(id),
        storage.getManifest(id),
        storage.listLevels(id),
        storage.listImages(id),
      ]);
      res.json({
        version,
        manifest,
        levels,
        images: images.map((img) => ({
          ...img,
          url: `/api/project/${id}/images/${img.id}`,
        })),
      });
    }),
  );

  return router;
}
```

- [ ] **Step 5: Atualizar `server/src/app.ts`**

```typescript
import express, { type Express } from 'express';
import cors from 'cors';
import type { Storage } from './storage/Storage.js';
import { createProjectRouter } from './routes/bundle.js';
import { errorMiddleware } from './errors.js';

export function createApp(storage: Storage): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(createProjectRouter(storage));

  app.use(errorMiddleware);
  return app;
}
```

Nota: o teste `app.test.ts` da Task 1 passava `{} as never`; como `/health` não toca no storage, continua válido.

- [ ] **Step 6: Rodar o teste e ver passar**

Run: `cd server && npm test -- routes/bundle`
Expected: PASS (2 testes).

- [ ] **Step 7: Commit**

```bash
git add server/src/errors.ts server/src/routes/bundle.ts server/src/app.ts server/test/routes/bundle.test.ts
git commit -m "feat(server): rota GET bundle + tratamento de erros"
```

---

### Task 6: Rota `PUT /api/project/:id/manifest` (If-Match / 409 / ETag)

**Files:**
- Create: `server/src/routes/mutations.ts`
- Modify: `server/src/app.ts` (montar o router de mutações)
- Test: `server/test/routes/manifest.test.ts`

**Interfaces:**
- Consumes: `Storage`, `createApp`, `HttpError`, `asyncHandler`.
- Produces:
  - `mutations.ts`: `createMutationRouter(storage: Storage): express.Router`. Nesta tarefa contém apenas `PUT /api/project/:id/manifest`. Um helper interno `requireIfMatch(req, storage, id)` lê o header `If-Match`, compara com `storage.getVersion(id)` e lança `HttpError(428, 'precondition_required', ...)` se ausente ou `HttpError(409, 'version_conflict', ...)` se divergente. Em sucesso, retorna `200 { version }` e ecoa a nova versão no header `ETag`.
  - `createApp` monta este router **antes** do `errorMiddleware`.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/routes/manifest.test.ts`:

```typescript
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

describe('PUT /api/project/:id/manifest', () => {
  it('creates the project on first write with If-Match "0"', async () => {
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0')
      .send({ root: true });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(res.headers.etag).toBe('1');
    expect(await storage.getManifest('p1')).toEqual({ root: true });
  });

  it('rejects a write without If-Match with 428', async () => {
    const res = await request(app).put('/api/project/p1/manifest').send({ root: true });
    expect(res.status).toBe(428);
    expect(res.body.code).toBe('precondition_required');
  });

  it('rejects a stale write with 409', async () => {
    await request(app).put('/api/project/p1/manifest').set('If-Match', '0').send({ a: 1 });
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0') // stale: server is at "1"
      .send({ a: 2 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('version_conflict');
    expect(await storage.getManifest('p1')).toEqual({ a: 1 }); // unchanged
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0')
      .set('Content-Type', 'application/json')
      .send('{ not json ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npm test -- routes/manifest`
Expected: FAIL — rota inexistente.

- [ ] **Step 3: Criar `server/src/routes/mutations.ts`**

```typescript
import { Router, type Request } from 'express';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler, HttpError } from '../errors.js';

async function requireIfMatch(req: Request, storage: Storage, id: string): Promise<void> {
  const ifMatch = req.header('If-Match');
  if (ifMatch === undefined) {
    throw new HttpError(428, 'precondition_required', 'If-Match header is required');
  }
  const current = await storage.getVersion(id);
  if (ifMatch !== current) {
    throw new HttpError(409, 'version_conflict', `Expected version ${current}, got ${ifMatch}`);
  }
}

export function createMutationRouter(storage: Storage): Router {
  const router = Router();

  router.put(
    '/api/project/:id/manifest',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      await requireIfMatch(req, storage, id);
      const version = await storage.putManifest(id, req.body);
      res.set('ETag', version).json({ version });
    }),
  );

  return router;
}
```

- [ ] **Step 4: Montar o router em `server/src/app.ts`**

Adicionar o import e a linha de `app.use`, logo após o router de bundle:

```typescript
import { createMutationRouter } from './routes/mutations.js';
```
```typescript
  app.use(createProjectRouter(storage));
  app.use(createMutationRouter(storage));

  app.use(errorMiddleware);
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd server && npm test -- routes/manifest`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/mutations.ts server/src/app.ts server/test/routes/manifest.test.ts
git commit -m "feat(server): PUT manifest com If-Match/409/ETag"
```

---

### Task 7: Rotas `PUT` e `DELETE` de nível

**Files:**
- Modify: `server/src/routes/mutations.ts` (adicionar rotas de nível)
- Test: `server/test/routes/levels.test.ts`

**Interfaces:**
- Consumes: `createMutationRouter`, `requireIfMatch` (interno), `Storage`.
- Produces: `PUT /api/project/:id/level/:iid` → `200 { version }` + `ETag`; `DELETE /api/project/:id/level/:iid` → `200 { version }` + `ETag`, ou `HttpError(404, 'level_not_found', ...)` se `deleteLevel` retornar `null`. Ambos exigem `If-Match`.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/routes/levels.test.ts`:

```typescript
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

describe('level mutations', () => {
  it('stores a level with a valid If-Match', async () => {
    const res = await request(app)
      .put('/api/project/p1/level/iidA')
      .set('If-Match', '0')
      .send({ n: 1 });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(await storage.getLevel('p1', 'iidA')).toEqual({ n: 1 });
  });

  it('rejects a stale level write with 409', async () => {
    await request(app).put('/api/project/p1/level/iidA').set('If-Match', '0').send({ n: 1 });
    const res = await request(app)
      .put('/api/project/p1/level/iidB')
      .set('If-Match', '0')
      .send({ n: 2 });
    expect(res.status).toBe(409);
  });

  it('deletes an existing level', async () => {
    await request(app).put('/api/project/p1/level/iidA').set('If-Match', '0').send({ n: 1 });
    const res = await request(app)
      .delete('/api/project/p1/level/iidA')
      .set('If-Match', '1');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2');
    expect(await storage.getLevel('p1', 'iidA')).toBeNull();
  });

  it('returns 404 when deleting an unknown level', async () => {
    const res = await request(app)
      .delete('/api/project/p1/level/nope')
      .set('If-Match', '0');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('level_not_found');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npm test -- routes/levels`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Adicionar as rotas de nível em `mutations.ts`**

Dentro de `createMutationRouter`, antes de `return router;`:

```typescript
  router.put(
    '/api/project/:id/level/:iid',
    asyncHandler(async (req, res) => {
      const { id, iid } = req.params;
      await requireIfMatch(req, storage, id);
      const version = await storage.putLevel(id, iid, req.body);
      res.set('ETag', version).json({ version });
    }),
  );

  router.delete(
    '/api/project/:id/level/:iid',
    asyncHandler(async (req, res) => {
      const { id, iid } = req.params;
      await requireIfMatch(req, storage, id);
      const version = await storage.deleteLevel(id, iid);
      if (version === null) {
        throw new HttpError(404, 'level_not_found', `Level ${iid} not found`);
      }
      res.set('ETag', version).json({ version });
    }),
  );
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd server && npm test -- routes/levels`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/mutations.ts server/test/routes/levels.test.ts
git commit -m "feat(server): PUT/DELETE de níveis com If-Match"
```

---

### Task 8: Rotas de imagem — `POST` (upload) e `GET` (bytes)

**Files:**
- Create: `server/src/routes/images.ts`
- Modify: `server/src/app.ts` (montar o router de imagens)
- Test: `server/test/routes/images.test.ts`

**Interfaces:**
- Consumes: `Storage`, `createApp`, `HttpError`, `asyncHandler`, fixture `test/fixtures/2x3.png`.
- Produces: `createImageRouter(storage: Storage): express.Router` com:
  - `POST /api/project/:id/images` — multipart campo `file`, via multer em memória, limite 20 MB. Aceita `image/png`, `image/jpeg`, `image/gif`; outros ⇒ `415 unsupported_media_type`. Ausência de arquivo ⇒ `400 no_file`. Excesso de tamanho ⇒ `413 file_too_large`. Sucesso ⇒ `201 { id, name, pxWid, pxHei, url }`.
  - `GET /api/project/:id/images/:imgId` — `200` com os bytes e `Content-Type` corretos + `Cache-Control: public, max-age=31536000, immutable`; inexistente ⇒ `404 image_not_found`.

- [ ] **Step 1: Escrever o teste que falha**

`server/test/routes/images.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { DiskStorage } from '../../src/storage/DiskStorage.js';

let app: ReturnType<typeof createApp>;
let storage: DiskStorage;
let pngPath: string;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
  app = createApp(storage);
  pngPath = new URL('../fixtures/2x3.png', import.meta.url).pathname;
});

describe('image routes', () => {
  it('uploads a PNG and returns its record', async () => {
    const res = await request(app)
      .post('/api/project/p1/images')
      .attach('file', pngPath, { filename: 'tiles.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'tiles.png', pxWid: 2, pxHei: 3 });
    expect(res.body.url).toBe(`/api/project/p1/images/${res.body.id}`);
  });

  it('serves uploaded image bytes with content type', async () => {
    const up = await request(app)
      .post('/api/project/p1/images')
      .attach('file', pngPath, { filename: 'tiles.png', contentType: 'image/png' });
    const res = await request(app).get(`/api/project/p1/images/${up.body.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    const original = await readFile(pngPath);
    expect(Buffer.compare(res.body, original)).toBe(0);
  });

  it('rejects an unsupported media type with 415', async () => {
    const res = await request(app)
      .post('/api/project/p1/images')
      .attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/project/p1/images');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_file');
  });

  it('returns 404 for an unknown image', async () => {
    const res = await request(app).get('/api/project/p1/images/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('image_not_found');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd server && npm test -- routes/images`
Expected: FAIL — rotas inexistentes.

- [ ] **Step 3: Criar `server/src/routes/images.ts`**

```typescript
import { Router } from 'express';
import multer, { MulterError } from 'multer';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler, HttpError } from '../errors.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(new HttpError(415, 'unsupported_media_type', `Unsupported type ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

export function createImageRouter(storage: Storage): Router {
  const router = Router();

  router.post(
    '/api/project/:id/images',
    (req, res, next) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
          next(new HttpError(413, 'file_too_large', 'Image exceeds 20MB limit'));
          return;
        }
        next(err);
      });
    },
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new HttpError(400, 'no_file', 'Expected a multipart field named "file"');
      }
      const id = req.params.id;
      const rec = await storage.putImage(
        id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      res.status(201).json({ ...rec, url: `/api/project/${id}/images/${rec.id}` });
    }),
  );

  router.get(
    '/api/project/:id/images/:imgId',
    asyncHandler(async (req, res) => {
      const img = await storage.getImage(req.params.id, req.params.imgId);
      if (!img) {
        throw new HttpError(404, 'image_not_found', `Image ${req.params.imgId} not found`);
      }
      res.set('Content-Type', img.contentType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(img.bytes);
    }),
  );

  return router;
}
```

- [ ] **Step 4: Montar o router em `server/src/app.ts`**

```typescript
import { createImageRouter } from './routes/images.js';
```
```typescript
  app.use(createProjectRouter(storage));
  app.use(createMutationRouter(storage));
  app.use(createImageRouter(storage));

  app.use(errorMiddleware);
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd server && npm test -- routes/images`
Expected: PASS (5 testes).

Nota: `supertest` só popula `res.body` como Buffer quando o content-type é binário; `image/png` satisfaz isso. Se a comparação de bytes falhar por parsing, trocar a asserção por `.expect('Content-Type', /image\/png/)` e `res.body.length`.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/images.ts server/src/app.ts server/test/routes/images.test.ts
git commit -m "feat(server): upload e leitura de imagens via HTTP"
```

---

### Task 9: Entrypoint do servidor + teste de fumaça end-to-end

**Files:**
- Create: `server/src/server.ts`
- Create: `server/README.md`
- Test: `server/test/smoke.test.ts`

**Interfaces:**
- Consumes: `createApp`, `DiskStorage`.
- Produces: `server.ts` — lê `PORT` (default 4000) e `STORAGE_DIR` (default `./storage`) do ambiente, cria `DiskStorage`, `createApp` e `listen`. `smoke.test.ts` exercita o caminho feliz completo via supertest, incluindo o encadeamento de ETag do flush.

- [ ] **Step 1: Criar `server/src/server.ts`**

```typescript
import { createApp } from './app.js';
import { DiskStorage } from './storage/DiskStorage.js';

const port = Number(process.env.PORT ?? 4000);
const storageDir = process.env.STORAGE_DIR ?? './storage';

const app = createApp(new DiskStorage(storageDir));
app.listen(port, () => {
  console.log(`LDtk web server on :${port} (storage: ${storageDir})`);
});
```

- [ ] **Step 2: Escrever o teste de fumaça**

`server/test/smoke.test.ts`:

```typescript
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
```

- [ ] **Step 3: Rodar o teste de fumaça**

Run: `cd server && npm test -- smoke`
Expected: PASS (2 testes).

- [ ] **Step 4: Criar `server/README.md`**

```markdown
# LDtk Web Server

Servidor HTTP que carrega/persiste projetos LDtk (manifesto + níveis separados +
imagens) para o editor web embutido. JSON tratado como opaco; conflito de escrita
detectado por versão/ETag por projeto. Sem autenticação no MVP.

## Rodar

    npm install
    STORAGE_DIR=./storage PORT=4000 npm start   # ou: npm run dev

## API

- `GET  /api/project/:id/bundle` → `{ version, manifest, levels, images }`
- `PUT  /api/project/:id/manifest`     (header `If-Match: <version>`) → `{ version }`
- `PUT  /api/project/:id/level/:iid`   (header `If-Match: <version>`) → `{ version }`
- `DELETE /api/project/:id/level/:iid` (header `If-Match: <version>`) → `{ version }`
- `POST /api/project/:id/images`  (multipart `file`) → `{ id, name, pxWid, pxHei, url }`
- `GET  /api/project/:id/images/:imgId` → bytes da imagem

`If-Match` divergente ⇒ `409 version_conflict`. Ausente em mutação ⇒ `428`.

## Testes

    npm test
```

- [ ] **Step 5: Rodar toda a suíte**

Run: `cd server && npm test`
Expected: PASS — todos os testes (app, storage×3, rotas×4, smoke).

- [ ] **Step 6: Verificar boot manual**

Run: `cd server && STORAGE_DIR=$(mktemp -d) PORT=4123 timeout 3 npm start`
Expected: imprime `LDtk web server on :4123 (storage: ...)` sem erro (encerra pelo timeout).

- [ ] **Step 7: Commit**

```bash
git add server/src/server.ts server/README.md server/test/smoke.test.ts
git commit -m "feat(server): entrypoint + teste de fumaça end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Contrato da API (bundle/manifest/level/images) → Tasks 5–8. ✓
- Níveis separados → Storage/rotas por `iid` (Tasks 3, 7). ✓
- ETag/If-Match/409 → Tasks 6, 7 + encadeamento no smoke (Task 9). ✓
- JSON opaco → storage e rotas nunca validam schema; só `express.json` (400 invalid_json). ✓
- Storage em disco espelhando modelo multi-arquivo, abstração para S3 futuro → interface `Storage` + `DiskStorage` (Tasks 2–4). ✓
- Projeto default a partir de template → `blank-project.json` servido em `getManifest` (Task 2). ✓
- Imagens: upload, dimensões, servir por URL, Cache-Control → Tasks 4, 8. ✓
- Erros `{ error, code }` com status (400/404/409/413/415/428) → Tasks 5–8. ✓
- Sem auth → nenhuma tarefa adiciona auth. ✓
- `url` relativa de imagem → Tasks 5, 8. ✓

**Placeholder scan:** nenhum "TBD"/"TODO"; todo passo de código traz o código. A geração do `blank-project.json` (Task 2, Step 1) é uma ação concreta (exportar do LDtk), não um placeholder.

**Type consistency:** `Storage` (Task 2) é implementada por `DiskStorage` incrementalmente (stubs → Tasks 3–4); assinaturas batem com o uso nas rotas (`getVersion`/`getManifest`/`listLevels`/`listImages` no bundle; `putManifest`/`putLevel`/`deleteLevel` nas mutações; `putImage`/`getImage` nas imagens). `deleteLevel` retorna `string | null` e a rota trata `null` como 404. `ImageRecord`/`StoredImage` usados de forma consistente. `createApp(storage: Storage)` retipado na Task 5 e usado por todos os testes de rota.
