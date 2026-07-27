# LDtk Web Editor — Save (flush) + Tileset Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o editor web usável de verdade: **salvar** (Ctrl+S persiste o projeto no servidor) e **importar tilesets** (upload da imagem pro servidor, exibindo no editor e sobrevivendo a reload).

**Architecture:** Reaproveita o `ProjectSaver` existente (grava no `VirtualFS` via `NT`); no sucesso do save, `ProjectTransport.flush` envia o dirty set (manifesto + níveis alterados, DELETE de removidos) ao servidor com encadeamento de ETag. Import de tileset: `<input type=file>` → `ProjectTransport.uploadImage` (`POST /images`) → grava os bytes no VFS no path que o tileset referencia. `loadBundle` passa a buscar os bytes das imagens do servidor para o VFS, para tilesets renderizarem após reload.

**Tech Stack:** Haxe→JS (build `renderer.web.hxml`), servidor Node/TS (peça 1). Verificação: `haxe renderer.web.hxml` compila + checagem manual no navegador contra o servidor + `curl` no servidor para confirmar persistência.

## Global Constraints

- Código web novo em `srcweb/web/`; guardas `#if web` no código do editor.
- Não há harness de teste Haxe: verificação = compile-gate + navegador + `curl` no servidor. (VirtualFS tem teste interp, mas flush/upload usam XHR → só navegador.)
- Formato de fio do servidor (peça 1): `GET bundle` → `{version, manifest, levels:{iid:json}, images:[{id,name,url,pxWid,pxHei}]}`; `PUT /manifest` e `PUT/DELETE /level/:iid` exigem header `If-Match: <version>` e retornam `{version}` + header `ETag`; `POST /images` (multipart `file`) → `{id,name,url,pxWid,pxHei}`. `409` = conflito de versão.
- **Convenção de imagem no web:** um tileset importado referencia `relPath = "images/<serverImageId>.<ext>"`; os bytes vivem no VFS em `/web/images/<serverImageId>.<ext>` (pois `project.makeAbsoluteFilePath("images/x")` = `/web/images/x`). `loadBundle` reidrata esses bytes a partir de `apiBaseUrl+url`.
- **Escopo:** salvar (flush) + import de tileset por upload. FORA: exporters, backups no servidor, merge de conflito (409 só avisa).
- O servidor da peça 1 roda em `:4477`; assets servidos de `app/` em `:8099` (ver `app/web.html`).

---

### Task 1: `ProjectTransport` — guardar estado da sessão no `loadBundle`

**Files:**
- Modify: `srcweb/web/ProjectTransport.hx`

**Interfaces:**
- Consumes: `web.WebFS`.
- Produces: campos estáticos `projectId`, `apiBaseUrl`, `version`, e `serverLevelIids:Array<String>`, preenchidos por `loadBundle`. `loadBundle` passa a guardar `projectId`/`apiBaseUrl` recebidos, `version` do bundle, e a lista de iids em `bundle.levels`. Assinatura de `loadBundle` inalterada.

- [ ] **Step 1: Adicionar estado e capturá-lo em `loadBundle`**

Em `srcweb/web/ProjectTransport.hx`, adicionar no topo da classe:
```haxe
	public static var projectId : String;
	public static var apiBaseUrl : String;
	public static var version : String = "0";
	public static var serverLevelIids : Array<String> = [];
```
No `loadBundle`, logo no início, guardar os parâmetros:
```haxe
	public static function loadBundle(projectId:String, apiBaseUrl:String, onOk:String->Void, onError:String->Void) : Void {
		ProjectTransport.projectId = projectId;
		ProjectTransport.apiBaseUrl = apiBaseUrl;
```
No handler de sucesso (dentro do `try`, após `var bundle = haxe.Json.parse(...)`), antes de `populate(bundle)`:
```haxe
				version = bundle.version != null ? Std.string(bundle.version) : "0";
				serverLevelIids = bundle.levels != null ? Reflect.fields(bundle.levels) : [];
```

- [ ] **Step 2: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros.

- [ ] **Step 3: Commit**

```bash
git add srcweb/web/ProjectTransport.hx
git commit -m "feat(web): ProjectTransport guarda version/projectId/level-iids do bundle"
```

---

### Task 2: `ProjectTransport.flush` — enviar manifesto + níveis alterados + deletes

**Files:**
- Modify: `srcweb/web/ProjectTransport.hx`

**Interfaces:**
- Consumes: estado da Task 1, `web.WebFS`.
- Produces: `static function flush(onOk:Void->Void, onError:String->Void):Void` — monta uma sequência de requests a partir do estado atual do VFS e a executa **sequencialmente** encadeando o `version` (ETag):
  - `PUT {api}/api/project/{id}/manifest` com body = `WebFS.fs.readString("/web/project.ldtk")`.
  - Se `manifest.externalLevels==true`: para cada nível `{iid, externalRelPath}` cujo `"/web/"+externalRelPath` está no dirty set → `PUT .../level/{iid}` com body do VFS.
  - Deletes: cada iid em `serverLevelIids` ausente do manifesto atual → `DELETE .../level/{iid}`.
  - Cada request manda `If-Match: version`; em `200` atualiza `version` do header/corpo; em `409` chama `onError("conflict")` e para. Ao fim, `serverLevelIids` = iids atuais, `WebFS.fs.clearDirty()`, `onOk()`.

- [ ] **Step 1: Implementar `flush` e um runner sequencial de requests**

Adicionar em `srcweb/web/ProjectTransport.hx`:
```haxe
	static function sendJson(method:String, path:String, body:String, onOk:String->Void, onError:String->Void) {
		var xhr = new js.html.XMLHttpRequest();
		xhr.open(method, apiBaseUrl + path, true);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.setRequestHeader("If-Match", version);
		xhr.onreadystatechange = function() {
			if( xhr.readyState != 4 ) return;
			if( xhr.status == 409 ) { onError("conflict"); return; }
			if( xhr.status < 200 || xhr.status >= 300 ) { onError('HTTP ${xhr.status} em $method $path'); return; }
			try {
				var r = haxe.Json.parse(xhr.responseText);
				if( r.version != null ) version = Std.string(r.version);
			} catch(_:Dynamic) {}
			onOk(xhr.responseText);
		}
		xhr.onerror = function(_) onError('Erro de rede em $method $path');
		xhr.send(body);
	}

	public static function flush(onOk:Void->Void, onError:String->Void) : Void {
		var manifestJson = WebFS.fs.readString("/web/project.ldtk");
		var manifest = haxe.Json.parse(manifestJson);

		// Descobrir iids atuais e níveis alterados (dirty)
		var currentIids : Array<String> = [];
		var levelPuts : Array<{ iid:String, body:String }> = [];
		function scanLevel(l:Dynamic) {
			if( l==null || l.iid==null ) return;
			var iid = Std.string(l.iid);
			currentIids.push(iid);
			if( manifest.externalLevels==true && l.externalRelPath!=null ) {
				var vpath = "/web/" + Std.string(l.externalRelPath);
				if( WebFS.fs.dirty.exists(vpath) && WebFS.fs.exists(vpath) )
					levelPuts.push({ iid: iid, body: WebFS.fs.readString(vpath) });
			}
		}
		if( manifest.worlds!=null )
			for( w in (cast manifest.worlds:Array<Dynamic>) )
				if( w.levels!=null ) for( l in (cast w.levels:Array<Dynamic>) ) scanLevel(l);
		if( manifest.levels!=null )
			for( l in (cast manifest.levels:Array<Dynamic>) ) scanLevel(l);

		// Deletes: níveis que o servidor tinha e não existem mais
		var deletes : Array<String> = [];
		for( iid in serverLevelIids )
			if( currentIids.indexOf(iid) < 0 ) deletes.push(iid);

		var base = "/api/project/" + projectId;
		// Sequência: manifest, depois PUTs de nível, depois DELETEs
		function runDeletes(i:Int) {
			if( i >= deletes.length ) {
				serverLevelIids = currentIids;
				WebFS.fs.clearDirty();
				onOk();
				return;
			}
			var xhr = new js.html.XMLHttpRequest();
			xhr.open("DELETE", apiBaseUrl + base + "/level/" + deletes[i], true);
			xhr.setRequestHeader("If-Match", version);
			xhr.onreadystatechange = function() {
				if( xhr.readyState!=4 ) return;
				if( xhr.status==409 ) { onError("conflict"); return; }
				if( xhr.status>=200 && xhr.status<300 ) {
					try { var r = haxe.Json.parse(xhr.responseText); if(r.version!=null) version = Std.string(r.version); } catch(_:Dynamic) {}
					runDeletes(i+1);
				} else onError('HTTP ${xhr.status} em DELETE');
			}
			xhr.onerror = function(_) onError("Erro de rede em DELETE");
			xhr.send();
		}
		function runLevels(i:Int) {
			if( i >= levelPuts.length ) { runDeletes(0); return; }
			sendJson("PUT", base + "/level/" + levelPuts[i].iid, levelPuts[i].body,
				(_) -> runLevels(i+1), onError);
		}
		sendJson("PUT", base + "/manifest", manifestJson, (_) -> runLevels(0), onError);
	}
```

- [ ] **Step 2: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros.

- [ ] **Step 3: Commit**

```bash
git add srcweb/web/ProjectTransport.hx
git commit -m "feat(web): ProjectTransport.flush (manifest + níveis dirty + deletes, ETag)"
```

---

### Task 3: Gancho de save no `Editor.onSave` (web) → flush + guardas de diálogo

**Files:**
- Modify: `src/electron.renderer/page/Editor.hx`

**Interfaces:**
- Consumes: `web.ProjectTransport.flush`, `ui.ProjectSaver`.
- Produces: no web, `onSave` pula os branches de `saveAs`/arquivo-ausente (que usam diálogos nativos) e, após o `ProjectSaver` concluir com sucesso, chama `ProjectTransport.flush`, notificando sucesso/erro. Desktop inalterado.

- [ ] **Step 1: Guardar o branch `saveAs` no web**

Em `onSave`, o bloco `if( saveAs ) { ... ElectronDialogs.saveFileAs ... return; }`: envolver o corpo com `#if !web` de modo que no web o `saveAs` seja ignorado (salva no mesmo projeto):
```haxe
		// Save as...
		if( saveAs ) {
			#if web
			saveAs = false; // no web não há "salvar como"; salva o projeto atual
			#else
			var oldDir = project.getProjectDir();
			dn.js.ElectronDialogs.saveFileAs(["."+Const.FILE_EXTENSION, ".json"], project.getProjectDir(), function(filePath:String) {
				project.filePath.parseFilePath( filePath );
				var newDir = project.getProjectDir();
				App.LOG.fileOp("Remap project paths: "+oldDir+" => "+newDir);
				project.remapAllRelativePaths(oldDir, newDir);
				bypasses.set("missing",true);
				onSave(false, bypasses, onComplete);
			});
			return;
			#end
		}
```

- [ ] **Step 2: Pular a checagem de "arquivo ausente" no web**

O bloco `if( !bypasses.exists("missing") && !NT.fileExists(project.filePath.full) ) { ... return; }` — no web o projeto vem do servidor (não há arquivo físico a validar). Prefixar a condição:
```haxe
		// Check missing file
		if( #if !web !bypasses.exists("missing") && !NT.fileExists(project.filePath.full) #else false #end ) {
```

- [ ] **Step 3: Chamar `flush` no sucesso do `ProjectSaver`**

No callback de sucesso do `new ui.ProjectSaver(...)`, dentro do `else` (após `updateTitle();`), adicionar:
```haxe
				updateTitle();

				#if web
				web.ProjectTransport.flush(
					() -> N.success("Saved to server"),
					(err) -> {
						if( err=="conflict" )
							N.error("O projeto mudou no servidor; recarregue a página.");
						else
							N.error("Falha ao salvar no servidor: "+err);
					}
				);
				#end
```

- [ ] **Step 4: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros.

- [ ] **Step 5: Verificação manual — SAVE ponta a ponta**

Subir servidor (STORAGE_DIR temporário) e assets, abrir `http://localhost:8099/web.html`. No editor: criar uma layer/mundo ou renomear o projeto (qualquer mudança), Ctrl+S. Expected: notificação "Saved to server". Então:
```bash
curl -s localhost:4477/api/project/demo/bundle | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log('version:',d.version,'manifestKeys:',Object.keys(d.manifest).length)"
```
Expected: `version` > 0 (subiu de "0"). Recarregar a página → a mudança persiste. Registrar o resultado.

- [ ] **Step 6: Commit**

```bash
git add src/electron.renderer/page/Editor.hx
git commit -m "feat(web): Ctrl+S dá flush do projeto pro servidor"
```

---

### Task 4: `ProjectTransport.uploadImage` — `POST /images`

**Files:**
- Modify: `srcweb/web/ProjectTransport.hx`

**Interfaces:**
- Consumes: estado da Task 1.
- Produces: `static function uploadImage(bytes:haxe.io.Bytes, name:String, onOk:(img:{id:String,name:String,url:String,pxWid:Int,pxHei:Int})->Void, onError:String->Void):Void` — envia multipart `file` para `POST {api}/api/project/{id}/images` e devolve o registro criado.

- [ ] **Step 1: Implementar `uploadImage`**

Adicionar em `srcweb/web/ProjectTransport.hx`:
```haxe
	public static function uploadImage(bytes:haxe.io.Bytes, name:String,
		onOk:(img:{id:String,name:String,url:String,pxWid:Int,pxHei:Int})->Void, onError:String->Void) : Void {
		var form = new js.html.FormData();
		var arr = new js.lib.Uint8Array(bytes.getData());
		var blob = new js.html.Blob([arr]);
		form.append("file", blob, name);
		var xhr = new js.html.XMLHttpRequest();
		xhr.open("POST", apiBaseUrl + "/api/project/" + projectId + "/images", true);
		xhr.onreadystatechange = function() {
			if( xhr.readyState!=4 ) return;
			if( xhr.status<200 || xhr.status>=300 ) { onError('HTTP ${xhr.status} no upload'); return; }
			try {
				var r = haxe.Json.parse(xhr.responseText);
				onOk({ id:Std.string(r.id), name:Std.string(r.name), url:Std.string(r.url), pxWid:r.pxWid, pxHei:r.pxHei });
			} catch(e:Dynamic) { onError("Resposta de upload inválida: "+Std.string(e)); }
		}
		xhr.onerror = function(_) onError("Erro de rede no upload");
		xhr.send(form);
	}
```

- [ ] **Step 2: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros.

- [ ] **Step 3: Commit**

```bash
git add srcweb/web/ProjectTransport.hx
git commit -m "feat(web): ProjectTransport.uploadImage (POST multipart)"
```

---

### Task 5: `loadBundle` reidrata bytes das imagens no VFS

**Files:**
- Modify: `srcweb/web/ProjectTransport.hx`

**Interfaces:**
- Consumes: `web.WebFS`, estado da Task 1.
- Produces: após popular manifesto/níveis, `loadBundle` busca os bytes de cada imagem do bundle (`apiBaseUrl+img.url`) e grava no VFS em `/web/images/<id>.<ext>` (ext derivada de `img.name`), **antes** de chamar `onOk`. Assim tilesets referenciando `images/<id>.<ext>` renderizam após reload.

- [ ] **Step 1: Buscar imagens antes do `onOk`**

Refatorar o sucesso de `loadBundle`: em vez de `populate(bundle); onOk(...)`, fazer `populate(bundle); fetchImages(bundle.images, () -> onOk("/web/project.ldtk"), onError);`. Adicionar:
```haxe
	static function extOf(name:String) : String {
		var i = name.lastIndexOf(".");
		return i>=0 ? name.substr(i+1) : "png";
	}

	static function fetchImages(images:Array<Dynamic>, onDone:Void->Void, onError:String->Void) {
		if( images==null || images.length==0 ) { onDone(); return; }
		var remaining = images.length;
		var failed = false;
		for( img in images ) {
			var id = Std.string(img.id);
			var vpath = "/web/images/" + id + "." + extOf(Std.string(img.name));
			var xhr = new js.html.XMLHttpRequest();
			xhr.open("GET", apiBaseUrl + Std.string(img.url), true);
			xhr.responseType = ARRAYBUFFER;
			xhr.onreadystatechange = function() {
				if( xhr.readyState!=4 ) return;
				if( xhr.status>=200 && xhr.status<300 && xhr.response!=null ) {
					var bytes = haxe.io.Bytes.ofData(xhr.response);
					WebFS.fs.writeBytes(vpath, bytes);
				} else if( !failed ) {
					failed = true; onError('HTTP ${xhr.status} ao buscar imagem $id');
				}
				remaining--;
				if( remaining==0 && !failed ) { WebFS.fs.clearDirty(); onDone(); }
			}
			xhr.onerror = function(_) { if(!failed){ failed=true; onError("Erro de rede ao buscar imagem"); } }
			xhr.send();
		}
	}
```
E trocar, no handler de sucesso do `loadBundle`:
```haxe
				populate(bundle);
				fetchImages( bundle.images, () -> onOk("/web/project.ldtk"), onError );
```
(remover a chamada direta anterior a `onOk`).

- [ ] **Step 2: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros.

- [ ] **Step 3: Commit**

```bash
git add srcweb/web/ProjectTransport.hx
git commit -m "feat(web): loadBundle reidrata bytes das imagens no VFS"
```

---

### Task 6: Picker de imagem web (file input + upload) no `JsTools`

**Files:**
- Create: `srcweb/web/WebImagePicker.hx`
- Modify: `src/electron.renderer/misc/JsTools.hx` (o botão "Pick image", ~1371)

**Interfaces:**
- Consumes: `web.ProjectTransport.uploadImage`, `web.WebFS`.
- Produces: `WebImagePicker.pick(onPicked:(relPath:String)->Void):Void` — abre um `<input type=file accept="image/*">`, lê os bytes do arquivo, faz `uploadImage`, grava os bytes no VFS em `/web/images/<id>.<ext>`, e chama `onPicked("images/<id>.<ext>")`. No `JsTools`, o handler do botão usa `WebImagePicker.pick(_pick)` no web e o `ElectronDialogs.openFile` no desktop.

- [ ] **Step 1: Criar `srcweb/web/WebImagePicker.hx`**

```haxe
package web;

class WebImagePicker {
	public static function pick(onPicked:(relPath:String)->Void) : Void {
		var input = js.Browser.document.createInputElement();
		input.type = "file";
		input.accept = "image/png,image/jpeg,image/gif";
		input.onchange = function(_) {
			if( input.files.length==0 ) return;
			var file = input.files.item(0);
			var reader = new js.html.FileReader();
			reader.onload = function(_) {
				var buf : js.lib.ArrayBuffer = cast reader.result;
				var bytes = haxe.io.Bytes.ofData(buf);
				ProjectTransport.uploadImage(
					bytes, file.name,
					(img) -> {
						var ext = img.name.lastIndexOf(".")>=0 ? img.name.substr(img.name.lastIndexOf(".")+1) : "png";
						var relPath = "images/" + img.id + "." + ext;
						WebFS.fs.writeBytes("/web/" + relPath, bytes);
						WebFS.fs.clearDirty(); // imagem já está no servidor
						onPicked(relPath);
					},
					(err) -> js.Browser.window.alert("Falha no upload: " + err)
				);
			}
			reader.readAsArrayBuffer(file);
		}
		input.click();
	}
}
```

- [ ] **Step 2: Usar o picker web no `JsTools` (botão Pick image)**

Em `src/electron.renderer/misc/JsTools.hx`, no `jPick.click(...)` (~1371), substituir a chamada `dn.js.ElectronDialogs.openFile([...], path, function(absPath){...})` por uma versão guardada:
```haxe
		jPick.click( (_)->{
			var project = Editor.ME.project;
			ui.Tip.clear();
			#if web
			web.WebImagePicker.pick( (relPath) -> _pick(relPath) );
			#else
			var defPath = project.makeAbsoluteFilePath( dn.FilePath.extractDirectoryWithoutSlash(curRelPath, true) );
			if( defPath==null )
				defPath = project.getProjectDir();
			var path = App.ME.settings.getUiDir(project, "PickImage", defPath);
			dn.js.ElectronDialogs.openFile([".png", ".gif", ".jpg", ".jpeg", ".aseprite", ".ase"], path, function(absPath) {
				App.ME.settings.storeUiDir(project, "PickImage", dn.FilePath.extractDirectoryWithoutSlash(absPath,true));
				var relPath = project.makeRelativeFilePath(absPath);
				_pick(relPath);
			});
			#end
		});
```

- [ ] **Step 3: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros.

- [ ] **Step 4: Verificação manual — UPLOAD ponta a ponta**

Com servidor + assets no ar, abrir o editor. Criar/editar um Tileset e usar "Pick image" para escolher um PNG local. Expected: o upload ocorre, a imagem aparece no editor (grid do tileset). Ctrl+S. Então recarregar a página. Expected: o tileset e sua imagem continuam lá após o reload (loadBundle reidratou os bytes). Confirmar no servidor:
```bash
curl -s localhost:4477/api/project/demo/bundle | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log('images:',d.images.map(i=>i.id+' '+i.pxWid+'x'+i.pxHei))"
```
Expected: lista a imagem enviada com dimensões corretas. Registrar o resultado.

- [ ] **Step 5: Commit**

```bash
git add srcweb/web/WebImagePicker.hx src/electron.renderer/misc/JsTools.hx
git commit -m "feat(web): import de tileset via file input + upload pro servidor"
```

---

## Self-Review

**Spec coverage:**
- Salvar explícito (Ctrl+S) → flush → servidor: Tasks 2, 3. ✓ (issue #8 restante)
- ETag/If-Match/409: Tasks 1, 2. ✓
- Níveis separados preservados (PUT/DELETE por iid): Task 2. ✓
- Upload de tileset (file input → POST): Tasks 4, 6. ✓ (issue #9)
- Imagens sobrevivem a reload (reidratar VFS): Task 5. ✓
- Modelo de imagem coerente (`images/<id>.<ext>` no VFS ↔ relPath ↔ servidor): Tasks 4, 5, 6 usam a mesma convenção. ✓

**Placeholder scan:** sem "TBD"/"TODO"; todo passo de código traz o código. As verificações manuais (Tasks 3, 6) são o método honesto (não há harness Haxe para XHR/DOM), com asserção via `curl` no servidor.

**Type consistency:** `ProjectTransport` acumula estado (`projectId/apiBaseUrl/version/serverLevelIids`) na Task 1, consumido por `flush` (Task 2) e `uploadImage` (Task 4). `flush(onOk:Void->Void, onError:String->Void)` consumido pela Task 3. `uploadImage(bytes, name, onOk({id,name,url,pxWid,pxHei}), onError)` consumido pela Task 6. `WebImagePicker.pick(onPicked:String->Void)` consumido pelo `JsTools`. Convenção de path `/web/images/<id>.<ext>` idêntica em loadBundle (Task 5) e no picker (Task 6). Reusa o padrão de XHR síncrono/assíncrono já estabelecido em `ProjectTransport`.

**Risco declarado:** como no skeleton, o único ponto realmente iterativo é a verificação no navegador (Tasks 3 e 6) — comportamentos de runtime não previstos (ex.: `ProjectSaver` tocando estados de export/backup que gravam no VFS, ou o editor exigindo uma layer para importar tileset) são resolvidos pontualmente. O checkpoint de SAVE (Task 3) é independente do de UPLOAD (Task 6): mesmo que o upload precise de iteração, o save já entrega valor.
