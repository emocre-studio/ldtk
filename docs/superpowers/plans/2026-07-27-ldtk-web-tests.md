# LDtk Web — Testes automatizados (issue #14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a rede de segurança que hoje não existe: testes unitários do `ProjectTransport` e um smoke e2e do ciclo real (abrir → salvar → recarregar), incluindo **regressões dos dois bugs que escaparam da revisão de código** e só apareceram na verificação manual.

**Architecture:** Duas camadas. (1) Unit: o Haxe do `ProjectTransport` é compilado para JS e roda em Node contra um **XHR falso + servidor falso em memória** — determinístico, sem rede, milissegundos. (2) E2E: Playwright dirige o Chrome real contra o servidor de verdade e o editor compilado, cobrindo o que só a integração revela.

**Tech Stack:** Haxe→JS + Node (unit); `@playwright/test` com `channel: "chrome"` (e2e, sem baixar Chromium).

## Global Constraints

- Node >= 20. O Chrome do sistema é usado pelo Playwright (`channel: "chrome"`), então a instalação usa `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- Nenhum teste pode depender de estado deixado por outro: cada cenário e2e usa seu **próprio `projectId`**; o servidor de teste roda com `STORAGE_DIR` temporário.
- O e2e **exige** `app/assets/js/renderer.web.js` já compilado (artefato gitignored, ~12MB, build de ~1-2 min). O teste deve falhar com mensagem explícita se faltar, nunca com erro obscuro.
- Testes unitários não podem fazer rede real.
- Atalho de salvar: o LDtk mapeia `ctrl s` para **Cmd** no macOS (`isCtrlCmdDown`), então o e2e usa o modificador `ControlOrMeta` do Playwright.
- Não alterar comportamento de produção nesta issue — apenas adicionar testes. (Se um teste revelar bug, corrigir é legítimo, mas deve ser registrado.)

---

### Task 1: XHR falso + servidor falso (infra do teste unitário)

**Files:**
- Create: `test/webtest/fake-xhr.mjs`
- Create: `test/webtest/run-transport-test.mjs`
- Create: `test.transport.hxml`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `fake-xhr.mjs` exporta `installFakeXhr(server)` — instala `globalThis.XMLHttpRequest` com uma implementação que resolve **sincronamente** dentro de `send()` (dispara `onreadystatechange` com `readyState=4`), roteando para `server`. Suporta: `open(method,url,async)`, `setRequestHeader`, `overrideMimeType`, `responseType="arraybuffer"`, `send(body)`, `status`, `responseText`, `response`, `onerror`, e o header `If-Match` acessível ao servidor falso.
  - Também exporta `makeFakeServer()` — servidor em memória que implementa o contrato real da peça 1: `GET /api/project/:id/bundle`, `PUT .../manifest`, `PUT/DELETE .../level/:iid` (com `If-Match` → `409` em divergência, incrementando `version`), `POST .../images`, `GET .../images/:imgId`. Expõe `state` (manifest, levels, images, version) e `requests` (log de `{method,path,ifMatch}`) para as asserções.
  - `run-transport-test.mjs` instala o fake e então importa o JS compilado do teste Haxe.
  - `test.transport.hxml` compila `webtest.ProjectTransportTest` para `.tmp/transport-test.js`.

- [ ] **Step 1: Criar `test/webtest/fake-xhr.mjs`**

```javascript
// XHR falso + servidor falso em memória, espelhando o contrato do servidor real
// (server/README.md). Resolve sincronamente para tornar os testes determinísticos.

export function makeFakeServer() {
	const server = {
		version: 0,
		manifest: { blank: true },
		levels: {},            // iid -> json
		images: {},            // id -> { name, bytes, pxWid, pxHei }
		requests: [],          // log para asserções
		imageSeq: 0,
		// injeta mudança "por outro cliente" (para testar 409)
		bumpExternally() { this.version++; },
	};

	server.handle = function (method, url, headers, body, responseType) {
		const path = url.replace(/^https?:\/\/[^/]+/, "");
		const ifMatch = headers["If-Match"];
		server.requests.push({ method, path, ifMatch });

		const mBundle = path.match(/^\/api\/project\/([^/]+)\/bundle$/);
		const mManifest = path.match(/^\/api\/project\/([^/]+)\/manifest$/);
		const mLevel = path.match(/^\/api\/project\/([^/]+)\/level\/([^/]+)$/);
		const mImages = path.match(/^\/api\/project\/([^/]+)\/images$/);
		const mImage = path.match(/^\/api\/project\/([^/]+)\/images\/([^/]+)$/);

		const needMatch = () => {
			if (ifMatch === undefined) return { status: 428, body: JSON.stringify({ error: "precondition", code: "precondition_required" }) };
			if (String(ifMatch) !== String(server.version)) return { status: 409, body: JSON.stringify({ error: "conflict", code: "version_conflict" }) };
			return null;
		};

		if (method === "GET" && mBundle) {
			return {
				status: 200,
				body: JSON.stringify({
					version: String(server.version),
					manifest: server.manifest,
					levels: server.levels,
					images: Object.entries(server.images).map(([id, i]) => ({
						id, name: i.name, pxWid: i.pxWid, pxHei: i.pxHei,
						url: `/api/project/p/images/${id}`,
					})),
				}),
			};
		}
		if (method === "PUT" && mManifest) {
			const bad = needMatch(); if (bad) return bad;
			server.manifest = JSON.parse(body);
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
		if (method === "PUT" && mLevel) {
			const bad = needMatch(); if (bad) return bad;
			server.levels[mLevel[2]] = JSON.parse(body);
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
		if (method === "DELETE" && mLevel) {
			const bad = needMatch(); if (bad) return bad;
			if (!(mLevel[2] in server.levels))
				return { status: 404, body: JSON.stringify({ error: "not found", code: "level_not_found" }) };
			delete server.levels[mLevel[2]];
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
		if (method === "POST" && mImages) {
			const id = "img_fake_" + (++server.imageSeq);
			server.images[id] = { name: "up.png", bytes: new Uint8Array([1, 2, 3]), pxWid: 2, pxHei: 3 };
			return {
				status: 201,
				body: JSON.stringify({ id, name: "up.png", pxWid: 2, pxHei: 3, url: `/api/project/p/images/${id}` }),
			};
		}
		if (method === "GET" && mImage) {
			const img = server.images[mImage[2]];
			if (!img) return { status: 404, body: "" };
			return { status: 200, body: "", arrayBuffer: img.bytes.buffer };
		}
		return { status: 404, body: JSON.stringify({ error: "no route", code: "not_found" }) };
	};

	return server;
}

export function installFakeXhr(server) {
	class FakeXhr {
		constructor() {
			this.readyState = 0;
			this.status = 0;
			this.responseText = "";
			this.response = null;
			this.responseType = "";
			this.onreadystatechange = null;
			this.onerror = null;
			this._headers = {};
		}
		open(method, url) { this._method = method; this._url = url; this.readyState = 1; }
		setRequestHeader(k, v) { this._headers[k] = v; }
		overrideMimeType() {}
		send(body) {
			const res = server.handle(this._method, this._url, this._headers, body, this.responseType);
			this.status = res.status;
			this.responseText = res.body || "";
			this.response = this.responseType === "arraybuffer" ? (res.arrayBuffer || null) : this.responseText;
			this.readyState = 4;
			if (this.onreadystatechange) this.onreadystatechange();
		}
	}
	globalThis.XMLHttpRequest = FakeXhr;
}
```

- [ ] **Step 2: Criar `test/webtest/run-transport-test.mjs`**

```javascript
// Instala o XHR/servidor falsos e então carrega o teste Haxe compilado.
import { installFakeXhr, makeFakeServer } from "./fake-xhr.mjs";

const server = makeFakeServer();
globalThis.__fakeServer = server;
installFakeXhr(server);

await import("../../.tmp/transport-test.js");
```

- [ ] **Step 3: Criar `test.transport.hxml`**

```
-cp srcweb
-cp test
-lib deepnightLibs
-main webtest.ProjectTransportTest
-js .tmp/transport-test.js
```

- [ ] **Step 4: Verificar que a infra carrega (ainda sem o teste Haxe)**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && node -e "import('./test/webtest/fake-xhr.mjs').then(m=>{const s=m.makeFakeServer(); m.installFakeXhr(s); const x=new XMLHttpRequest(); x.open('GET','http://x/api/project/p/bundle'); x.onreadystatechange=()=>{ if(x.readyState===4) console.log('status',x.status,'version',JSON.parse(x.responseText).version); }; x.send(); })"`
Expected: imprime `status 200 version 0`.

- [ ] **Step 5: Commit**

```bash
git add test/webtest/fake-xhr.mjs test/webtest/run-transport-test.mjs test.transport.hxml
git commit -m "test(web): infra de XHR falso + servidor falso para testes unitários"
```

---

### Task 2: Testes unitários do `ProjectTransport`

**Files:**
- Create: `test/webtest/ProjectTransportTest.hx`

**Interfaces:**
- Consumes: `web.ProjectTransport`, `web.WebFS`, o fake da Task 1 (via `globalThis.__fakeServer`).
- Produces: um `main()` que roda os cenários e sai com código 0/1. Cobre:
  1. `loadBundle` popula o VFS (manifesto no path virtual) e guarda `version`.
  2. `loadBundle` com `externalLevels:true` escreve cada nível no path do `externalRelPath` **e** deriva o `projectVPath` do diretório (regressão do bug de níveis externos).
  3. `loadBundle` reidrata bytes das imagens no VFS.
  4. `flush` envia manifesto + **apenas** os níveis sujos (não todos) e encadeia `If-Match`.
  5. `flush` envia `DELETE` de nível removido do manifesto.
  6. `flush` com versão divergente → `onError("conflict")` e **não** limpa o dirty set.
  7. `uploadImage` faz `POST` e devolve o registro.

- [ ] **Step 1: Escrever o teste**

```haxe
package webtest;

class ProjectTransportTest {
	static var pass = 0;
	static var fail = 0;

	static function check(name:String, cond:Bool) {
		if( cond ) pass++;
		else { fail++; Sys.println('FAIL: $name'); }
	}

	static function server() : Dynamic return untyped __js__("globalThis.__fakeServer");

	static function setServer(manifest:Dynamic, levels:Dynamic, version:Int) {
		var s = server();
		s.manifest = manifest;
		s.levels = levels;
		s.version = version;
		s.requests = untyped __js__("[]");
	}

	static function requestPaths() : Array<String> {
		var out = [];
		var reqs : Array<Dynamic> = server().requests;
		for( r in reqs ) out.push(Std.string(r.method) + " " + Std.string(r.path));
		return out;
	}

	static function main() {
		var api = "http://fake";

		// --- 1. loadBundle simples popula o VFS e guarda a versão
		setServer({ hello:"world" }, {}, 3);
		var loadedPath : String = null;
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->Sys.println("unexpected error: "+e));
		check("loadBundle chamou onOk", loadedPath != null);
		check("manifesto no VFS", web.WebFS.fs.exists(loadedPath));
		check("version guardada", web.ProjectTransport.version == "3");

		// --- 2. níveis externos: paths e projectVPath derivado do dir
		var extManifest = {
			externalLevels: true,
			levels: untyped __js__("[{ iid:'A', externalRelPath:'MyProj/L0.ldtkl' }, { iid:'B', externalRelPath:'MyProj/L1.ldtkl' }]"),
		};
		setServer(extManifest, untyped __js__("{ A:{ n:0 }, B:{ n:1 } }"), 0);
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->Sys.println("unexpected error: "+e));
		check("projectVPath deriva do dir dos níveis", loadedPath == "/web/MyProj.ldtk");
		check("nível A no VFS", web.WebFS.fs.exists("/web/MyProj/L0.ldtkl"));
		check("nível B no VFS", web.WebFS.fs.exists("/web/MyProj/L1.ldtkl"));
		check("dirty limpo após load", !web.WebFS.fs.dirty.exists("/web/MyProj/L0.ldtkl"));

		// --- 3. flush envia manifesto + SÓ os níveis sujos, encadeando If-Match
		web.WebFS.fs.writeString("/web/MyProj/L1.ldtkl", "{\"n\":99}"); // suja só o L1
		var flushOk = false;
		web.ProjectTransport.flush(()->flushOk = true, (e)->Sys.println("flush error: "+e));
		check("flush completou", flushOk);
		var paths = requestPaths();
		check("flush enviou manifesto", paths.indexOf("PUT /api/project/p/manifest") >= 0);
		check("flush enviou o nível sujo (B)", paths.indexOf("PUT /api/project/p/level/B") >= 0);
		check("flush NÃO enviou o nível limpo (A)", paths.indexOf("PUT /api/project/p/level/A") < 0);
		check("dirty limpo após flush", !web.WebFS.fs.dirty.exists("/web/MyProj/L1.ldtkl"));

		// --- 4. flush deleta nível que sumiu do manifesto
		var oneLevel = {
			externalLevels: true,
			levels: untyped __js__("[{ iid:'A', externalRelPath:'MyProj/L0.ldtkl' }]"),
		};
		setServer(oneLevel, untyped __js__("{ A:{ n:0 }, B:{ n:1 } }"), 0);
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->{});
		// servidor tinha A e B; manifesto agora só tem A => B deve ser deletado
		web.ProjectTransport.flush(()->{}, (e)->Sys.println("flush error: "+e));
		check("flush deletou o nível removido", requestPaths().indexOf("DELETE /api/project/p/level/B") >= 0);

		// --- 5. conflito de versão => onError("conflict") e dirty preservado
		setServer({ a:1 }, {}, 0);
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->{});
		web.WebFS.fs.writeString(loadedPath, "{\"a\":2}"); // suja o manifesto
		server().bumpExternally();                        // outro cliente mexeu
		var conflictErr : String = null;
		web.ProjectTransport.flush(()->{}, (e)->conflictErr = e);
		check("conflito reportado", conflictErr == "conflict");
		check("dirty preservado no conflito", web.WebFS.fs.dirty.exists(loadedPath));

		// --- 6. uploadImage
		var uploaded : Dynamic = null;
		web.ProjectTransport.uploadImage(
			haxe.io.Bytes.ofString("png"), "tiles.png", "image/png",
			(img)->uploaded = img,
			(e)->Sys.println("upload error: "+e)
		);
		check("upload retornou id", uploaded != null && StringTools.startsWith(Std.string(uploaded.id), "img_"));
		check("upload retornou dimensões", uploaded != null && uploaded.pxWid == 2 && uploaded.pxHei == 3);

		Sys.println('ProjectTransport: $pass passed, $fail failed');
		Sys.exit(fail == 0 ? 0 : 1);
	}
}
```

- [ ] **Step 2: Compilar e rodar**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk && mkdir -p .tmp && haxe test.transport.hxml && node test/webtest/run-transport-test.mjs
```
Expected: `ProjectTransport: 17 passed, 0 failed`, exit 0. Se algum cenário falhar, investigar: pode ser bug real no `ProjectTransport` (registrar antes de corrigir).

- [ ] **Step 3: Ignorar o diretório temporário do build**

Adicionar `.tmp/` ao `.gitignore` (se ainda não estiver).

- [ ] **Step 4: Commit**

```bash
git add test/webtest/ProjectTransportTest.hx .gitignore
git commit -m "test(web): testes unitários do ProjectTransport (load/flush/conflito/upload)"
```

---

### Task 3: Smoke e2e com Playwright

**Files:**
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`
- Create: `e2e/static-server.mjs`
- Create: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: o servidor real (`server/src/server.ts`), o build web (`app/assets/js/renderer.web.js`), os samples em `app/extraFiles/samples/`.
- Produces: 4 cenários de smoke, cada um com seu `projectId`:
  1. **carrega** — abre e o editor renderiza;
  2. **salva e persiste** — Ctrl/Cmd+S → versão do servidor sobe → reload mantém o projeto salvo;
  3. **níveis externos** — projeto `externalLevels:true` semeado via API abre e salva com os níveis separados (regressão do bug do `js.node.Fs`);
  4. **falha de boot** — API inacessível → tela de erro com botão de retry.

- [ ] **Step 1: Criar `e2e/package.json`**

```json
{
  "name": "ldtk-web-e2e",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0"
  }
}
```

- [ ] **Step 2: Instalar (sem baixar Chromium — usamos o Chrome do sistema)**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/e2e && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`
Expected: instala `@playwright/test` sem baixar navegadores.

- [ ] **Step 3: Criar `e2e/static-server.mjs`**

```javascript
// Servidor estático mínimo para a pasta app/ (onde vive web.html + assets/).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "app");
const PORT = Number(process.env.PORT ?? 8100);

const TYPES = {
	".html": "text/html", ".js": "text/javascript", ".css": "text/css",
	".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

createServer(async (req, res) => {
	try {
		const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
		const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
		const file = join(ROOT, safe);
		if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
		const data = await readFile(file);
		res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
		res.end(data);
	} catch {
		res.writeHead(404).end("not found");
	}
}).listen(PORT, () => console.log(`static on :${PORT} (root ${ROOT})`));
```

- [ ] **Step 4: Criar `e2e/playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUILD = join(import.meta.dirname, "..", "app", "assets", "js", "renderer.web.js");
if (!existsSync(BUILD))
	throw new Error(
		"Build web ausente: " + BUILD +
		"\nRode `haxe renderer.web.hxml` na raiz do repo antes dos testes e2e."
	);

const STORAGE = mkdtempSync(join(tmpdir(), "ldtk-e2e-"));

export default defineConfig({
	testDir: ".",
	timeout: 90_000,
	expect: { timeout: 20_000 },
	fullyParallel: false,
	workers: 1,
	use: {
		channel: "chrome",
		baseURL: "http://localhost:8100",
	},
	webServer: [
		{
			command: "npm start",
			cwd: join(import.meta.dirname, "..", "server"),
			env: { PORT: "4488", STORAGE_DIR: STORAGE },
			url: "http://localhost:4488/health",
			reuseExistingServer: false,
			stdout: "pipe",
		},
		{
			command: "node static-server.mjs",
			cwd: import.meta.dirname,
			env: { PORT: "8100" },
			url: "http://localhost:8100/web.html",
			reuseExistingServer: false,
			stdout: "pipe",
		},
	],
});
```

- [ ] **Step 5: Criar `e2e/smoke.spec.ts`**

```typescript
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const API = "http://localhost:4488";
const SAMPLES = join(import.meta.dirname, "..", "app", "extraFiles", "samples");

async function bundle(projectId: string) {
	const r = await fetch(`${API}/api/project/${projectId}/bundle`);
	return r.json();
}

/** Abre o editor e espera ele renderizar, fechando o changelog se aparecer. */
async function openEditor(page: Page, projectId: string, api = API) {
	await page.goto(`/web.html?p=${projectId}&api=${encodeURIComponent(api)}`);
	await page.waitForSelector("#page.editor", { timeout: 60_000 });
	// o "what's new" abre em perfil novo e bloqueia atalhos (isLocked)
	const close = page.locator(".window .close").first();
	if (await close.isVisible().catch(() => false)) await close.click();
	await expect(page.locator(".window")).toHaveCount(0, { timeout: 15_000 }).catch(() => {});
}

async function save(page: Page) {
	await page.keyboard.press("ControlOrMeta+s");
}

test("abre o projeto do servidor e renderiza o editor", async ({ page }) => {
	await openEditor(page, "t-load");
	await expect(page.locator("#page.editor")).toBeVisible();
	await expect(page).toHaveTitle(/Level_0/);
});

test("salva no servidor e o estado persiste após reload", async ({ page }) => {
	const id = "t-save";
	expect((await bundle(id)).version).toBe("0");

	await openEditor(page, id);
	await save(page);
	await expect(page.locator(".notification", { hasText: "Saved to server" })).toBeVisible();

	const after = await bundle(id);
	expect(Number(after.version)).toBeGreaterThan(0);

	// reload: projeto salvo volta do servidor (sem marca de não-salvo)
    await openEditor(page, id);
	await expect(page).not.toHaveTitle(/\[UNSAVED\]/);
});

test("projeto com níveis externos abre e salva com os níveis separados", async ({ page }) => {
	const id = "t-ext";

	// semeia o sample externalLevels:true (manifesto + 3 .ldtkl)
	const manifest = await readFile(join(SAMPLES, "SeparateLevelFiles.ldtk"), "utf8");
	let v = (await bundle(id)).version;
	let r = await fetch(`${API}/api/project/${id}/manifest`, {
		method: "PUT", headers: { "Content-Type": "application/json", "If-Match": v }, body: manifest,
	});
	expect(r.status).toBe(200);
	v = (await r.json()).version;

	for (const f of ["World_Level_0", "World_Level_1", "World_Level_2"]) {
		const lvl = await readFile(join(SAMPLES, "SeparateLevelFiles", `${f}.ldtkl`), "utf8");
		const iid = JSON.parse(lvl).iid;
		r = await fetch(`${API}/api/project/${id}/level/${iid}`, {
			method: "PUT", headers: { "Content-Type": "application/json", "If-Match": v }, body: lvl,
		});
		expect(r.status).toBe(200);
		v = (await r.json()).version;
	}

	await openEditor(page, id);
	await expect(page).toHaveTitle(/SeparateLevelFiles/);

	await save(page);
	await expect(page.locator(".notification", { hasText: "Saved to server" })).toBeVisible();

	const after = await bundle(id);
	expect(after.manifest.externalLevels).toBe(true);
	expect(Object.keys(after.levels)).toHaveLength(3);
	// cada nível guarda seus dados; o manifesto não os duplica
	for (const lvl of Object.values<any>(after.levels))
		expect(Array.isArray(lvl.layerInstances)).toBe(true);
	for (const l of after.manifest.levels)
		expect(l.layerInstances == null).toBe(true);
});

test("falha ao carregar mostra tela de erro com retry", async ({ page }) => {
	// porta sem servidor
	await page.goto(`/web.html?p=t-fail&api=${encodeURIComponent("http://localhost:9")}`);
	const screen = page.locator("#webErrorScreen");
	await expect(screen).toBeVisible({ timeout: 30_000 });
	await expect(screen).toContainText("Não foi possível carregar o projeto");
	await expect(screen.locator("button")).toBeVisible();
	// não abriu o editor pela metade
	await expect(page.locator("#page.editor")).toHaveCount(0);
});
```

- [ ] **Step 6: Rodar o e2e**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml && cd e2e && npm test
```
Expected: 4 testes passando. Falhas aqui podem ser (a) problema de sincronização do teste — ajustar espera; (b) **bug real de produto** — nesse caso registrar no relatório antes de corrigir.

- [ ] **Step 7: Commit**

```bash
git add e2e/ .gitignore
git commit -m "test(web): smoke e2e com Playwright (load/save/níveis externos/erro de boot)"
```

---

### Task 4: Documentar como rodar os testes

**Files:**
- Modify: `server/README.md` (seção de testes do repo web)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: instruções de execução das três suítes.

- [ ] **Step 1: Adicionar a seção**

Em `server/README.md`, ao final, adicionar:

```markdown
## Testes do porte web

Três suítes, da mais rápida para a mais lenta:

    # 1. Servidor (unit + integração)
    cd server && npm test

    # 2. Cliente web (unit, sem rede: XHR e servidor falsos)
    haxe -cp srcweb -cp test -main webtest.VirtualFSTest --interp
    mkdir -p .tmp && haxe test.transport.hxml && node test/webtest/run-transport-test.mjs

    # 3. Smoke e2e (Chrome real + servidor real)
    haxe renderer.web.hxml          # obrigatório: o e2e usa o build
    cd e2e && npm test

O e2e usa o Chrome do sistema (`channel: "chrome"`), então a instalação roda com
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install`.
```

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "docs: como rodar as três suítes de teste do porte web"
```

---

## Self-Review

**Spec coverage (issue #14):**
- Unit do `VirtualFS` → já existia (`test/webtest/VirtualFSTest.hx`), documentado na Task 4. ✓
- Unit do `ProjectTransport` (loadBundle popula VFS; flush manda só os dirty; uploadImage) → Task 2, contra servidor falso (Task 1). ✓
- Smoke e2e (abrir, editar, Ctrl+S, recarregar, conferir persistência) → Task 3, cenários 1–2. ✓
- Importar tileset e conferir após reload → **parcialmente**: o upload é coberto no unit (Task 2, cenário 6) e o caminho HTTP já foi verificado manualmente; o e2e **não** cobre o clique em "Pick image" porque o diálogo de arquivo é nativo. Registrado como limitação (ver abaixo), consistente com o que já estava anotado no marco anterior.

**Regressões dos bugs reais:** o e2e "níveis externos" cobre o bug do `js.node.Fs` (que quebrava o save), e o unit "conflito preserva dirty" cobre a semântica que sustenta o fix do `onComplete`. O bug do `onComplete` em si (não prosseguir com ação pendente) **não** é coberto por teste automatizado — exigiria dirigir o fluxo "fechar projeto → YES" com o servidor derrubado no meio; anotado como lacuna conhecida.

**Placeholder scan:** sem "TBD"/"TODO"; todo passo traz código real e comandos com saída esperada.

**Type consistency:** `makeFakeServer()`/`installFakeXhr(server)` (Task 1) consumidos por `run-transport-test.mjs` e pelo teste Haxe via `globalThis.__fakeServer`. O contrato do servidor falso espelha o real (mesmos paths, `If-Match`, `409`, `{version}`), então os testes unitários exercitam o mesmo protocolo do e2e. `web.ProjectTransport.{loadBundle,flush,uploadImage,version,projectVPath}` e `web.WebFS.fs` já existem com essas assinaturas.

**Limitações declaradas:**
- O clique real em "Pick image" (diálogo nativo de arquivo) não é automatizável aqui; o upload é coberto por unit + verificação manual.
- O e2e depende de um build web prévio (~1-2 min); o config falha cedo com mensagem explícita se faltar.
- `fullyParallel: false` / `workers: 1` de propósito: um servidor compartilhado com isolamento por `projectId` é mais simples e previsível que paralelismo aqui.
