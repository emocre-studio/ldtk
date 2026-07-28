# Servidor — Hardening menor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os dois itens da issue #4 — desacoplar a detecção de erros do body-parser (o que revelou um **bug real de 500 no lugar de 413**) e eliminar o padrão check-then-act do `DiskStorage`.

**Architecture:** Duas mudanças independentes em `server/`. A primeira troca a detecção frágil por uma checagem baseada nos campos públicos que o body-parser define (`type` + `status`), e passa a mapear corretamente payload grande demais. A segunda substitui `existsSync` + operação async por `try/catch` de `ENOENT`, que é atômico e idiomático.

**Tech Stack:** Node/TypeScript, Express; testes em vitest + supertest (suíte existente).

## Global Constraints

- Node >= 20, TS estrito, ESM (imports relativos com `.js`). Tudo em `server/`.
- **Comportamento observável não pode mudar**, exceto a correção do 413 (hoje 500) — que é o ponto.
- Os 69 testes atuais do servidor devem continuar passando sem edição.
- Não introduzir dependências novas.

---

### Task 1: Erros do body-parser — desacoplar e corrigir o 413

**Files:**
- Modify: `server/src/errors.ts`
- Test: `server/test/errors.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `errorMiddleware` passa a reconhecer erros do body-parser pelos campos públicos `type` (string) e `status` (número), em vez de `err instanceof SyntaxError && 'body' in err`. Mapeamento:
  - `entity.parse.failed` ⇒ `400 { code: 'invalid_json' }` (mesmo comportamento de hoje)
  - `entity.too.large` ⇒ `413 { code: 'payload_too_large' }` (**hoje devolve 500**)
  - outro erro do body-parser com `status` 4xx ⇒ esse status com `code: 'bad_request'`
  - qualquer outra coisa ⇒ `500 { code: 'internal' }` (inalterado)

  Verificado empiricamente nesta versão do Express: JSON malformado ⇒ `{ name:'SyntaxError', type:'entity.parse.failed', status:400 }`; payload acima do limite ⇒ `{ name:'PayloadTooLargeError', type:'entity.too.large', status:413 }`.

- [ ] **Step 1: Escrever os testes que falham**

`server/test/errors.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { DiskStorage } from '../src/storage/DiskStorage.js';
import { errorMiddleware, HttpError } from '../src/errors.js';

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  app = createApp(new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-'))));
});

describe('errorMiddleware: erros do body-parser', () => {
  it('malformed JSON is a 400 invalid_json', async () => {
    const res = await request(app)
      .put('/api/project/p1/manifest')
      .set('If-Match', '0')
      .set('Content-Type', 'application/json')
      .send('{ not json ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });

  it('oversized payload is a 413, not a 500', async () => {
    // app dedicado com limite minúsculo, para não precisar mandar 64mb
    const tiny = express();
    tiny.use(express.json({ limit: '100b' }));
    tiny.post('/x', (_req, res) => res.json({ ok: true }));
    tiny.use(errorMiddleware);

    const res = await request(tiny)
      .post('/x')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ a: 'x'.repeat(500) }));

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });
});

describe('errorMiddleware: demais casos', () => {
  it('HttpError keeps its status and code', async () => {
    const tiny = express();
    tiny.get('/x', () => {
      throw new HttpError(404, 'nope', 'Not here');
    });
    tiny.use(errorMiddleware);

    const res = await request(tiny).get('/x');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not here', code: 'nope' });
  });

  it('unknown errors stay a 500 without leaking details', async () => {
    const tiny = express();
    tiny.get('/x', () => {
      throw new Error('detalhe interno sensível');
    });
    tiny.use(errorMiddleware);

    const res = await request(tiny).get('/x');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal error', code: 'internal' });
    expect(JSON.stringify(res.body)).not.toContain('sensível');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- errors`
Expected: FAIL no teste do 413 (recebe 500). Os demais passam já hoje — servem de rede contra regressão.

- [ ] **Step 3: Reescrever a detecção em `server/src/errors.ts`**

Substituir o bloco do `SyntaxError` por uma checagem baseada nos campos públicos:

```typescript
/**
 * O body-parser (usado por express.json) anexa `type` e `status` aos erros que
 * gera. Usar esses campos é mais estável do que farejar `instanceof SyntaxError`
 * + a presença de `body`, que dependem de detalhes internos da lib.
 */
interface BodyParserError {
  type: string;
  status: number;
}

function asBodyParserError(err: unknown): BodyParserError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  return typeof e.type === 'string' && typeof e.status === 'number'
    ? { type: e.type, status: e.status }
    : null;
}
```

E, no `errorMiddleware`, trocar o `if (err instanceof SyntaxError && 'body' in err)` por:

```typescript
  const bodyErr = asBodyParserError(err);
  if (bodyErr) {
    if (bodyErr.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body', code: 'invalid_json' });
      return;
    }
    if (bodyErr.type === 'entity.too.large') {
      res.status(413).json({ error: 'Payload too large', code: 'payload_too_large' });
      return;
    }
    if (bodyErr.status >= 400 && bodyErr.status < 500) {
      res.status(bodyErr.status).json({ error: 'Bad request', code: 'bad_request' });
      return;
    }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test`
Expected: PASS — os 4 novos casos e os 69 anteriores. Rodar `npx tsc --noEmit` (limpo).

- [ ] **Step 5: Commit**

```bash
git add server/src/errors.ts server/test/errors.test.ts
git commit -m "fix(server): 413 para payload grande + detecção de erro sem depender de internals"
```

---

### Task 2: `DiskStorage` sem check-then-act

**Files:**
- Modify: `server/src/storage/DiskStorage.ts`

**Interfaces:**
- Consumes: nada.
- Produces: os métodos de leitura/remoção deixam de usar `existsSync` antes da operação async; passam a capturar `ENOENT`. O contrato público é **idêntico** (mesmos retornos para ausente), então os testes existentes cobrem a mudança sem edição.

Métodos afetados: `getVersion`, `getManifest`, `listLevels`, `getLevel`, `deleteLevel`, `listImages`, `getImage`, `deleteImage`.

- [ ] **Step 1: Adicionar o helper de ENOENT**

No topo de `server/src/storage/DiskStorage.ts` (após os imports):

```typescript
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
```

- [ ] **Step 2: Reescrever os métodos**

Substituir cada método afetado pela versão sem `existsSync`:

```typescript
  async getVersion(projectId: string): Promise<string> {
    const raw = await orNull(readFile(this.versionPath(projectId), 'utf8'));
    return raw?.trim() || '0';
  }

  async getManifest(projectId: string): Promise<unknown> {
    const raw = await orNull(readFile(this.manifestPath(projectId), 'utf8'));
    if (raw === null) return JSON.parse(await readFile(BLANK_PROJECT_URL, 'utf8'));
    return JSON.parse(raw);
  }

  async listLevels(projectId: string): Promise<Record<string, unknown>> {
    const files = await orNull(readdir(this.levelsDir(projectId)));
    if (files === null) return {};
    const out: Record<string, unknown> = {};
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await orNull(readFile(join(this.levelsDir(projectId), file), 'utf8'));
      if (raw !== null) out[file.slice(0, -'.json'.length)] = JSON.parse(raw);
    }
    return out;
  }

  async getLevel(projectId: string, iid: string): Promise<unknown | null> {
    const raw = await orNull(readFile(this.levelPath(projectId, iid), 'utf8'));
    return raw === null ? null : JSON.parse(raw);
  }

  async deleteLevel(projectId: string, iid: string): Promise<string | null> {
    const removed = await orNull(rm(this.levelPath(projectId, iid)));
    if (removed === null) return null;
    return this.bumpVersion(projectId);
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
```

**Nota:** `orNull(rm(...))` devolve `null` quando o arquivo não existia (`rm` sem `force` lança ENOENT) e `undefined` quando removeu — por isso `deleteLevel` compara com `null` explicitamente, e não por veracidade.

- [ ] **Step 3: Remover o import agora não usado**

Se nenhum `existsSync` restar no arquivo, remover `import { existsSync } from 'node:fs';`.

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && grep -n "existsSync" src/storage/DiskStorage.ts || echo "OK: sem existsSync"`
Expected: `OK: sem existsSync`.

- [ ] **Step 4: Rodar a suíte inteira e o typecheck**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test 2>&1 | grep -E "Test Files|Tests" && npx tsc --noEmit && echo "tsc OK"`
Expected: todos os testes verdes (o contrato não mudou) e `tsc OK`.

- [ ] **Step 5: Rodar o e2e (o storage é exercitado de verdade ali)**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml >/dev/null 2>&1; cd e2e && npm test 2>&1 | tail -3`
Expected: `5 passed`.

- [ ] **Step 6: Commit**

```bash
git add server/src/storage/DiskStorage.ts
git commit -m "refactor(server): DiskStorage captura ENOENT em vez de check-then-act"
```

---

## Self-Review

**Spec coverage (issue #4):**
- Acoplamento do body-parser → Task 1: detecção passa a usar os campos públicos `type`/`status`. ✓
- check-then-act (TOCTOU) nos métodos listados na issue (`getVersion`, `getManifest`, `getLevel`, `listLevels`, `listImages`, `getImage`) → Task 2, mais `deleteLevel` e `deleteImage`, que têm o mesmo padrão e não estavam na issue. ✓
- **Extra encontrado na investigação:** payload acima do limite devolvia `500` em vez de `413`. Corrigido na Task 1 — é o item de maior valor real desta issue.

**Placeholder scan:** sem "TBD"/"TODO"; todo passo traz o código e o comando com saída esperada.

**Type consistency:** `isNotFound(err) → boolean` e `orNull<T>(op) → Promise<T | null>` (Task 2) são usados só dentro do `DiskStorage`. `asBodyParserError(err) → BodyParserError | null` (Task 1) é usado só no `errorMiddleware`. Nenhuma assinatura pública muda: `Storage` permanece idêntica, então rotas e testes existentes não são tocados.

**Risco declarado:** a Task 2 reescreve oito métodos de uma vez sem adicionar testes novos — a garantia vem dos 69 testes existentes, que já cobrem os caminhos de ausente/presente de cada um (é justamente por isso que o contrato foi mantido idêntico). Se algum comportamento escapar, o e2e (Step 5) exercita o storage de ponta a ponta.
