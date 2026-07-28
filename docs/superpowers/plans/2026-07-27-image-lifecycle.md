# Ciclo de Vida de Imagens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer imagens saírem do servidor: endpoint de remoção e limpeza de órfãs dirigida pelo cliente.

**Architecture:** O servidor segue **opaco** ao JSON do projeto — ele nunca infere quais imagens estão em uso. Ganha `DELETE` de imagem e um `prune` que recebe do cliente a lista do que manter. O cliente monta essa lista a partir dos dois lugares que o próprio LDtk consulta (`defs.tilesets[].relPath` e `levels[].bgRelPath`) e chama o prune ao final do flush, dentro da mesma cadeia de `If-Match`.

**Tech Stack:** Node/TypeScript + Express (servidor, vitest); Haxe→JS (cliente, teste unitário com XHR falso); Playwright (e2e).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-image-lifecycle-design.md`.
- Node >= 20, TS estrito, ESM (imports relativos com `.js`). Servidor em `server/`, cliente em `srcweb/`.
- **O servidor não interpreta o JSON do projeto.** Nenhuma tarefa aqui pode fazê-lo ler `defs`/`levels` para descobrir imagens.
- Upload **não** altera a versão (regra da peça 1, preservada). **`DELETE` de imagem e `prune` alteram**, pois mudam o estado persistido.
- Convenção de imagem no web: o manifesto referencia `images/<id>.<ext>`; o id é o do servidor.
- Risco aceito (decisão do usuário): prune apaga de vez, sem lixeira. O ETag cobre o caso multi-cliente.
- Desktop não pode regredir: `haxe renderer.hxml` deve continuar compilando.

---

### Task 1: `Storage.deleteImage`

**Files:**
- Modify: `server/src/storage/Storage.ts`
- Modify: `server/src/storage/DiskStorage.ts`
- Test: `server/test/storage/diskStorage.images.test.ts` (adicionar casos)

**Interfaces:**
- Consumes: nada.
- Produces: `deleteImage(projectId: string, imgId: string): Promise<boolean>` na interface `Storage` e em `DiskStorage` — remove `<id>.<ext>` e `<id>.meta.json`; devolve `false` se a imagem não existia. **Não** mexe na versão do projeto (quem versiona é a rota).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final do `describe('DiskStorage images', ...)` em `server/test/storage/diskStorage.images.test.ts`:

```typescript
  it('deletes an image and its metadata', async () => {
    const rec = await storage.putImage('p1', png, 'tiles.png', 'image/png');
    expect(await storage.deleteImage('p1', rec.id)).toBe(true);
    expect(await storage.getImage('p1', rec.id)).toBeNull();
    expect(await storage.listImages('p1')).toEqual([]);
  });

  it('returns false when deleting an unknown image', async () => {
    expect(await storage.deleteImage('p1', 'nope')).toBe(false);
  });

  it('deleting one image leaves the others intact', async () => {
    const a = await storage.putImage('p1', png, 'a.png', 'image/png');
    const b = await storage.putImage('p1', png, 'b.png', 'image/png');
    await storage.deleteImage('p1', a.id);
    const left = await storage.listImages('p1');
    expect(left.map((r) => r.id)).toEqual([b.id]);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- diskStorage.images`
Expected: FAIL — `storage.deleteImage is not a function`.

- [ ] **Step 3: Declarar na interface `Storage`**

Em `server/src/storage/Storage.ts`, adicionar após `getImage`:

```typescript
  deleteImage(projectId: string, imgId: string): Promise<boolean>;
```

- [ ] **Step 4: Implementar em `DiskStorage`**

Em `server/src/storage/DiskStorage.ts`, adicionar após `getImage`:

```typescript
  async deleteImage(projectId: string, imgId: string): Promise<boolean> {
    const dir = this.imagesDir(projectId);
    const metaPath = join(dir, `${imgId}.meta.json`);
    if (!existsSync(metaPath)) return false;
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const bytesPath = join(dir, `${imgId}.${this.extFor(meta.contentType)}`);
    if (existsSync(bytesPath)) await rm(bytesPath);
    await rm(metaPath);
    return true;
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- diskStorage.images`
Expected: PASS (8 testes).

- [ ] **Step 6: Commit**

```bash
git add server/src/storage/ server/test/storage/diskStorage.images.test.ts
git commit -m "feat(server): Storage.deleteImage"
```

---

### Task 2: Rotas `DELETE` de imagem e `POST /images/prune`

**Files:**
- Modify: `server/src/routes/images.ts`
- Test: `server/test/routes/imageLifecycle.test.ts`

**Interfaces:**
- Consumes: `Storage.deleteImage`, `Storage.listImages`, `safeSegment`, `HttpError`, `asyncHandler`.
- Produces:
  - `DELETE /api/project/:id/images/:imgId` — `If-Match` obrigatório; 404 `image_not_found` se não existia; sucesso ⇒ `200 { version }` + `ETag`.
  - `POST /api/project/:id/images/prune` — body `{ keep: string[] }`; `If-Match` obrigatório; `keep` ausente/não-array ⇒ `400 invalid_keep`; sucesso ⇒ `200 { version, deleted: string[] }` + `ETag`.
  - O router de imagens precisa do mesmo helper de `If-Match` já usado em `mutations.ts`. Para não duplicar, **extrair** `requireIfMatch` de `mutations.ts` para `server/src/ifMatch.ts` e importar nos dois.

- [ ] **Step 1: Escrever os testes que falham**

`server/test/routes/imageLifecycle.test.ts`:

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
let png: Buffer;

beforeEach(async () => {
  storage = new DiskStorage(await mkdtemp(join(tmpdir(), 'ldtk-store-')));
  app = createApp(storage);
  png = await readFile(new URL('../fixtures/2x3.png', import.meta.url));
});

async function upload(name: string) {
  const res = await request(app)
    .post('/api/project/p1/images')
    .attach('file', png, { filename: name, contentType: 'image/png' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe('DELETE image', () => {
  it('removes the image and bumps the version', async () => {
    const id = await upload('a.png');
    expect((await storage.getVersion('p1'))).toBe('0'); // upload não versiona

    const res = await request(app).delete(`/api/project/p1/images/${id}`).set('If-Match', '0');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('1');
    expect(await storage.getImage('p1', id)).toBeNull();
  });

  it('requires If-Match', async () => {
    const id = await upload('a.png');
    const res = await request(app).delete(`/api/project/p1/images/${id}`);
    expect(res.status).toBe(428);
  });

  it('rejects a stale If-Match', async () => {
    const id = await upload('a.png');
    await request(app).delete(`/api/project/p1/images/${id}`).set('If-Match', '0');
    const res = await request(app).delete(`/api/project/p1/images/${id}`).set('If-Match', '0');
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown image', async () => {
    const res = await request(app).delete('/api/project/p1/images/nope').set('If-Match', '0');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('image_not_found');
  });
});

describe('POST images/prune', () => {
  it('deletes images outside the keep list', async () => {
    const keep = await upload('keep.png');
    const drop = await upload('drop.png');

    const res = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: [keep] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual([drop]);
    expect(res.body.version).toBe('1');

    const left = await storage.listImages('p1');
    expect(left.map((r) => r.id)).toEqual([keep]);
  });

  it('is a no-op when nothing is orphaned', async () => {
    const a = await upload('a.png');
    const res = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: [a] });
    expect(res.body.deleted).toEqual([]);
    expect((await storage.listImages('p1')).length).toBe(1);
  });

  it('empty keep list deletes every image', async () => {
    await upload('a.png');
    await upload('b.png');
    const res = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: [] });
    expect(res.body.deleted).toHaveLength(2);
    expect(await storage.listImages('p1')).toEqual([]);
  });

  it('rejects a missing or non-array keep', async () => {
    const a = await request(app).post('/api/project/p1/images/prune').set('If-Match', '0').send({});
    expect(a.status).toBe(400);
    expect(a.body.code).toBe('invalid_keep');

    const b = await request(app)
      .post('/api/project/p1/images/prune')
      .set('If-Match', '0')
      .send({ keep: 'nope' });
    expect(b.status).toBe(400);
  });

  it('requires If-Match', async () => {
    const res = await request(app).post('/api/project/p1/images/prune').send({ keep: [] });
    expect(res.status).toBe(428);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test -- imageLifecycle`
Expected: FAIL — rotas inexistentes (404 nas chamadas).

- [ ] **Step 3: Extrair `requireIfMatch` para um módulo**

Criar `server/src/ifMatch.ts` com o helper hoje privado em `mutations.ts`:

```typescript
import type { Request } from 'express';
import type { Storage } from './storage/Storage.js';
import { HttpError } from './errors.js';

/**
 * Concorrência otimista: toda mutação declara a versão que pretende substituir.
 * Sem o header ⇒ 428; divergente ⇒ 409 (outro cliente alterou o projeto).
 */
export async function requireIfMatch(req: Request, storage: Storage, id: string): Promise<void> {
  const ifMatch = req.header('If-Match');
  if (ifMatch === undefined) {
    throw new HttpError(428, 'precondition_required', 'If-Match header is required');
  }
  const current = await storage.getVersion(id);
  if (ifMatch !== current) {
    throw new HttpError(409, 'version_conflict', `Expected version ${current}, got ${ifMatch}`);
  }
}
```

Em `server/src/routes/mutations.ts`, remover a função local e passar a importar:

```typescript
import { requireIfMatch } from '../ifMatch.js';
```

- [ ] **Step 4: Adicionar as rotas em `server/src/routes/images.ts`**

Acrescentar os imports necessários (`requireIfMatch` de `../ifMatch.js`; `safeSegment` já é usado no arquivo) e, dentro de `createImageRouter`, antes do `return router;`:

```typescript
  router.delete(
    '/api/project/:id/images/:imgId',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'projectId');
      const imgId = safeSegment(req.params.imgId, 'imageId');
      await requireIfMatch(req, storage, id);
      const existed = await storage.deleteImage(id, imgId);
      if (!existed) {
        throw new HttpError(404, 'image_not_found', `Image ${imgId} not found`);
      }
      const version = await storage.bumpVersion(id);
      res.set('ETag', version).json({ version });
    }),
  );

  router.post(
    '/api/project/:id/images/prune',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'projectId');
      await requireIfMatch(req, storage, id);

      const keep = (req.body as { keep?: unknown })?.keep;
      if (!Array.isArray(keep)) {
        throw new HttpError(400, 'invalid_keep', 'Body must be { keep: string[] }');
      }
      const keepSet = new Set(keep.map(String));

      const deleted: string[] = [];
      for (const img of await storage.listImages(id)) {
        if (keepSet.has(img.id)) continue;
        await storage.deleteImage(id, img.id);
        deleted.push(img.id);
      }

      const version = await storage.bumpVersion(id);
      res.set('ETag', version).json({ version, deleted });
    }),
  );
```

**Atenção à ordem de registro:** `POST /images/prune` precisa ser registrado **antes** de qualquer rota `POST /images` genérica não seria conflito (métodos/paths diferentes), mas `DELETE /images/:imgId` e `GET /images/:imgId` coexistem sem ambiguidade. Verificar no Step 6 que `prune` não é capturado como `:imgId` — como `prune` só responde a `POST` e `:imgId` a `GET`/`DELETE`, não há colisão.

- [ ] **Step 5: Expor `bumpVersion` no `Storage`**

As rotas acima chamam `storage.bumpVersion(id)`, que hoje é privado em `DiskStorage`. Conferir e, se necessário, promovê-lo:

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && grep -n "bump" src/storage/DiskStorage.ts src/storage/Storage.ts`

Se `bump` for privado, renomear para `bumpVersion`, torná-lo público, declarar na interface `Storage` como `bumpVersion(projectId: string): Promise<string>` e ajustar as chamadas internas (`putManifest`, `putLevel`, `deleteLevel`).

- [ ] **Step 6: Rodar e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/server && npm test`
Expected: PASS — os 10 novos casos e todos os anteriores. Rodar também `npx tsc --noEmit` (deve sair limpo).

- [ ] **Step 7: Commit**

```bash
git add server/src/ server/test/routes/imageLifecycle.test.ts
git commit -m "feat(server): DELETE de imagem e POST /images/prune"
```

---

### Task 3: Cliente — extrair imagens referenciadas e podar no flush

**Files:**
- Modify: `srcweb/web/ProjectTransport.hx`
- Test: `test/webtest/ProjectTransportTest.hx` (novos casos)
- Modify: `test/webtest/fake-xhr.mjs` (servidor falso ganha as duas rotas)

**Interfaces:**
- Consumes: `WebFS`, estado de `ProjectTransport`.
- Produces:
  - `public static function referencedImageIds(manifest:Dynamic) : Array<String>` — varre `defs.tilesets[].relPath` e `levels[].bgRelPath` (incluindo `worlds[].levels[]`), extraindo `<id>` do padrão `images/<id>.<ext>`; ignora paths fora do padrão; sem duplicatas.
  - `flush` passa a chamar `POST {base}/images/prune` com `{ keep: referencedImageIds(manifest) }` **depois** dos DELETEs de nível e antes de `onOk`.

- [ ] **Step 1: Ensinar as rotas ao servidor falso**

Em `test/webtest/fake-xhr.mjs`, dentro de `server.handle`, adicionar os matchers e os ramos (antes do `return { status: 404 ... }` final):

```javascript
		const mPrune = path.match(/^\/api\/project\/([^/]+)\/images\/prune$/);
```

```javascript
		if (method === "POST" && mPrune) {
			const bad = needMatch(); if (bad) return bad;
			const keep = new Set((JSON.parse(body || "{}").keep || []).map(String));
			const deleted = [];
			for (const id of Object.keys(server.images))
				if (!keep.has(id)) { delete server.images[id]; deleted.push(id); }
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version), deleted }) };
		}
		if (method === "DELETE" && mImage) {
			const bad = needMatch(); if (bad) return bad;
			if (!(mImage[2] in server.images))
				return { status: 404, body: JSON.stringify({ error: "not found", code: "image_not_found" }) };
			delete server.images[mImage[2]];
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
```

**Ordem:** o matcher de `prune` precisa ser testado **antes** do de `:imgId`, senão `prune` casaria como um id. Colocar o ramo `POST mPrune` acima do ramo `POST mImages`.

- [ ] **Step 2: Escrever os testes que falham**

Em `test/webtest/ProjectTransportTest.hx`, antes do bloco final de `log(...)`, inserir:

```haxe
		// --- 7. referencedImageIds extrai ids de tilesets e de bg de nível
		var manifestWithImgs : Dynamic = untyped __js__("({ defs:{ tilesets:[{relPath:'images/img_a.png'},{relPath:'images/img_b.gif'}] }, levels:[{ bgRelPath:'images/img_c.png' }] })");
		var ids = web.ProjectTransport.referencedImageIds(manifestWithImgs);
		ids.sort(Reflect.compare);
		check("extrai ids de tilesets e bg", ids.join(",") == "img_a,img_b,img_c");

		// --- 8. paths fora do padrão images/<id>.<ext> são ignorados
		var manifestOdd : Dynamic = untyped __js__("({ defs:{ tilesets:[{relPath:'../tiles/foo.png'},{relPath:null}] }, levels:[{ bgRelPath:'images/img_ok.png' }] })");
		var ids2 = web.ProjectTransport.referencedImageIds(manifestOdd);
		check("ignora paths fora do padrão", ids2.join(",") == "img_ok");

		// --- 9. flush poda imagens não referenciadas, depois do manifesto
		setServer(untyped __js__("({ defs:{ tilesets:[{relPath:'images/img_keep.png'}] }, levels:[] })"), untyped __js__("{}"), 0);
		server().images = untyped __js__("{ img_keep:{name:'k.png'}, img_orphan:{name:'o.png'} }");
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->{});
		web.WebFS.fs.writeString(loadedPath, web.WebFS.fs.readString(loadedPath)); // marca sujo
		web.ProjectTransport.flush(()->{}, (e)->log("flush error: "+e));
		var paths2 = requestPaths();
		check("prune veio depois do manifesto",
			paths2.indexOf("POST /api/project/p/images/prune") > paths2.indexOf("PUT /api/project/p/manifest"));
		check("órfã removida no servidor", !Reflect.hasField(server().images, "img_orphan"));
		check("referenciada preservada", Reflect.hasField(server().images, "img_keep"));
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe test.transport.hxml && node test/webtest/run-transport-test.mjs`
Expected: FAIL na compilação — `referencedImageIds` não existe.

- [ ] **Step 4: Implementar `referencedImageIds` em `srcweb/web/ProjectTransport.hx`**

Adicionar antes de `flush`:

```haxe
	/**
		Ids das imagens que o projeto referencia. Varre exatamente os dois lugares
		que o próprio LDtk consulta (Project.isCachedImageUsed): o relPath dos
		tilesets e o bgRelPath dos níveis. Só reconhece o padrão do web,
		`images/<id>.<ext>`; qualquer outro path (ex.: projeto vindo do desktop
		com caminho de disco) não corresponde a uma imagem do servidor.
	**/
	public static function referencedImageIds(manifest:Dynamic) : Array<String> {
		var out : Array<String> = [];
		var seen = new Map<String,Bool>();

		function add(relPath:Dynamic) {
			if( relPath==null ) return;
			var p = Std.string(relPath);
			if( !StringTools.startsWith(p, "images/") ) return;
			var file = p.substr("images/".length);
			var dot = file.lastIndexOf(".");
			var id = dot>0 ? file.substr(0, dot) : file;
			if( id.length>0 && !seen.exists(id) ) {
				seen.set(id, true);
				out.push(id);
			}
		}

		if( manifest.defs!=null && manifest.defs.tilesets!=null )
			for( td in (cast manifest.defs.tilesets : Array<Dynamic>) )
				if( td!=null ) add(td.relPath);

		function scanLevels(levels:Array<Dynamic>) {
			if( levels==null ) return;
			for( l in levels )
				if( l!=null ) add(l.bgRelPath);
		}
		scanLevels( cast manifest.levels );
		if( manifest.worlds!=null )
			for( w in (cast manifest.worlds : Array<Dynamic>) )
				if( w!=null ) scanLevels( cast w.levels );

		return out;
	}
```

- [ ] **Step 5: Chamar o prune ao final do flush**

Em `flush`, substituir o corpo de `runDeletes` no ponto de conclusão (quando `i >= deletes.length`) para encadear o prune antes de encerrar:

```haxe
		function finish() {
			serverLevelIids = currentIids;
			WebFS.fs.clearDirty();
			onOk();
		}
		function runPrune() {
			var keep = referencedImageIds(manifest);
			sendJson("POST", base + "/images/prune", haxe.Json.stringify({ keep: keep }),
				(_) -> finish(), onError);
		}
```
e trocar, dentro de `runDeletes`, o bloco de conclusão:
```haxe
			if( i >= deletes.length ) {
				runPrune();
				return;
			}
```
(removendo dali as três linhas que faziam `serverLevelIids`/`clearDirty`/`onOk`, agora em `finish`).

- [ ] **Step 6: Rodar e ver passar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe test.transport.hxml && node test/webtest/run-transport-test.mjs`
Expected: `ProjectTransport: 22 passed, 0 failed`.

- [ ] **Step 7: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -3 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam.

- [ ] **Step 8: Commit**

```bash
git add srcweb/web/ProjectTransport.hx test/webtest/
git commit -m "feat(web): flush poda imagens órfãs no servidor"
```

---

### Task 4: E2E do ciclo completo + documentação

**Files:**
- Modify: `e2e/smoke.spec.ts`
- Modify: `server/README.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: cenário e2e que sobe imagem, salva, remove a referência e confirma que a imagem sumiu; README com as duas rotas novas.

- [ ] **Step 1: Adicionar o cenário e2e**

Ao final de `e2e/smoke.spec.ts`:

```typescript
test("imagem órfã é removida do servidor no save seguinte", async ({ page }) => {
	const id = "t-orphan";

	// sobe uma imagem "por fora" (simula import) e a referencia num tileset
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABS3WWCAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAd0wf9E4kJcgAAAABJRU5ErkJggg==",
		"base64",
	);
	const form = new FormData();
	form.append("file", new Blob([png], { type: "image/png" }), "orphan.png");
	const up = await fetch(`${API}/api/project/${id}/images`, { method: "POST", body: form });
	expect(up.status).toBe(201);
	expect((await bundle(id)).images).toHaveLength(1);

	// o editor abre um projeto que NÃO referencia essa imagem e salva
	await openEditor(page, id);
	await save(page);
	await expect(page.locator(".notification", { hasText: "Saved to server" })).toBeAttached();

	// o prune do flush removeu a órfã
	expect((await bundle(id)).images).toHaveLength(0);
});
```

- [ ] **Step 2: Rodar o e2e**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml && cd e2e && npm test`
Expected: 5 testes passando (os 4 anteriores + o novo).

- [ ] **Step 3: Documentar as rotas no `server/README.md`**

Na lista de rotas da seção `## API`, acrescentar após a linha do `GET .../images/:imgId`:

```markdown
- `DELETE /api/project/:id/images/:imgId` (header `If-Match: <version>`) → `{ version }`
- `POST /api/project/:id/images/prune`    (header `If-Match: <version>`) → `{ version, deleted }`

O `prune` recebe `{ "keep": ["img_a", ...] }` e apaga toda imagem do projeto fora
da lista. O servidor não interpreta o JSON do projeto: quem sabe quais imagens
estão em uso é o editor, que envia a lista ao salvar.
```

- [ ] **Step 4: Rodar todas as suítes**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk \
 && haxe -cp srcweb -cp test -main webtest.VirtualFSTest --interp \
 && node test/webtest/run-transport-test.mjs \
 && (cd server && npm test 2>&1 | grep -E "Test Files|Tests") \
 && (cd e2e && npm test 2>&1 | tail -3)
```
Expected: VirtualFS 17/17, ProjectTransport 22/22, servidor com todos verdes, e2e 5 passed.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts server/README.md
git commit -m "test(web): e2e do ciclo de vida de imagens + documenta as rotas"
```

---

## Self-Review

**Spec coverage:**
- `DELETE /images/:imgId` com If-Match, 404, versão → Tasks 1–2. ✓
- `POST /images/prune` com `keep`, 400 em corpo inválido, `deleted`, versão → Task 2. ✓
- `Storage.deleteImage` → Task 1. ✓
- Cliente monta a lista dos dois lugares que o LDtk consulta e ignora paths fora do padrão → Task 3. ✓
- Prune ao final do flush, dentro da cadeia de If-Match (cliente desatualizado aborta antes) → Task 3 (o 409 no manifesto já corta a sequência; coberto pelo teste de conflito existente). ✓
- Upload não versiona; delete/prune versionam → assertado na Task 2. ✓
- Servidor segue opaco → nenhuma tarefa faz o servidor ler `defs`/`levels`. ✓

**Placeholder scan:** sem "TBD"/"TODO". O Step 5 da Task 2 é uma verificação concreta (`grep` do `bump`) com instrução do que fazer conforme o resultado — o helper existe hoje como privado e precisa ser promovido; o passo diz exatamente como.

**Type consistency:** `deleteImage(projectId, imgId) → Promise<boolean>` (Task 1) é consumido pelas duas rotas (Task 2). `bumpVersion(projectId) → Promise<string>` passa a ser público e é usado pelas rotas novas e pelos métodos internos existentes. `referencedImageIds(manifest) → Array<String>` (Task 3) é usado só pelo `flush`. O contrato `{ keep: string[] }` → `{ version, deleted: string[] }` é o mesmo no servidor real (Task 2), no servidor falso (Task 3 Step 1) e no e2e (Task 4).

**Risco declarado:** o prune apaga sem lixeira (decisão registrada no spec). O ponto de falha plausível é a montagem da lista no cliente — por isso ela tem teste unitário dedicado (Tasks 3, casos 7–8), além do e2e de ponta a ponta.
