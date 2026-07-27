# LDtk Web Editor — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o editor LDtk **abrir no navegador e renderizar um projeto carregado do servidor** (peça 1), sem salvar ainda — o primeiro marco visual da peça 2.

**Architecture:** Fork só-web por **compilação condicional (`#if web`)**. Um `VirtualFS` em memória substitui o acesso a disco; `WebFS`/`WebElectronTools` (shims Haxe puros) substituem os aliases `NT`/`ET` em `import.hx`. `ProjectTransport.loadBundle` busca o bundle do servidor via `fetch`, popula o VFS e o `ProjectLoader`/`loadProject` **existentes** rodam sem alteração (leem do VFS). O boot pula a tela Home e abre o projeto indicado por `window.LDTK_CONFIG`.

**Tech Stack:** Haxe → JS, Heaps/WebGL, jQuery/DOM. Sem Electron/Node em runtime (externs mantidos no classpath só para compilar; chamadas de runtime neutralizadas por `#if web`).

## Global Constraints

- Alvo Haxe: JS. O build web **mantém** `-lib electron -lib hxnodejs` no classpath (para compilar), e **neutraliza as chamadas de runtime** de node/electron via `#if web`. A remoção real dessas libs é trabalho posterior (issues #10/#11), fora deste plano.
- Todo código web novo vive em **`srcweb/web/`** (uma raiz de classpath separada, adicionada via `-cp srcweb`). **Desvio do plano original** (`src/electron.renderer/web/`): descobrimos que o `import.hx` do editor **cascateia e stacka** no subpacote `web`, arrastando jQuery/hxd/App para os shims. Mantê-los fora de `src/electron.renderer` isola-os desse `import.hx`. O editor referencia `web.*` por pacote (independente da localização física).
- Teste interp do `VirtualFS`: `test/webtest/VirtualFSTest.hx` (pacote `webtest`, para não herdar `import.hx` do root), rodado com `haxe -cp srcweb -cp test -main webtest.VirtualFSTest --interp`.
- **Não existe harness de teste Haxe no projeto.** Verificação = (a) `haxe renderer.web.hxml` compila limpo; (b) checagem **manual no navegador** contra o servidor da peça 1 rodando; (c) lógica pura do `VirtualFS` testada via `haxe --interp`.
- `import.hx` troca, sob `#if web`, `dn.js.NodeTools as NT` → `web.WebFS as NT` e `dn.js.ElectronTools as ET` → `web.WebElectronTools as ET`.
- Formato do bundle do servidor: `{ version:String, manifest:Object, levels:{<iid>:Object}, images:[{id,name,url,pxWid,pxHei}] }` (ver `server/README.md`).
- Config injetada pelo hospedeiro: `window.LDTK_CONFIG = { projectId:String, apiBaseUrl:String }`.
- **Escopo:** apenas **abrir + renderar**. FORA: salvar/flush, upload de imagem, polimento de UX de erro (só uma mensagem básica de falha de load). Esses são as issues #8-restante/#13.
- Caminho virtual do projeto no VFS: `/web/project.ldtk` (níveis externos, se houver, sob `/web/<externalRelPath>`).

---

### Task 1: `VirtualFS` (filesystem em memória) + teste interp

**Files:**
- Create: `src/electron.renderer/web/VirtualFS.hx`
- Test: `test/web/VirtualFSTest.hx`

**Interfaces:**
- Consumes: nada.
- Produces: `class VirtualFS` com API síncrona:
  - `new()`
  - `writeString(path:String, s:String):Void`, `writeBytes(path:String, b:haxe.io.Bytes):Void`
  - `readString(path:String):String` (lança se ausente), `readBytes(path:String):haxe.io.Bytes`
  - `exists(path:String):Bool`, `isDir(path:String):Bool`
  - `readDir(path:String):Array<String>` (nomes dos filhos imediatos), `dirHasAnyFile(path:String):Bool`
  - `createDirs(path:String):Void`, `removeFile(path:String):Void`, `removeDir(path:String):Void`, `rename(from:String, to:String):Void`
  - `dirty:Map<String,Bool>` (marcado em toda escrita/remoção), `clearDirty():Void`
  - Normaliza paths com `/` e sem barra final. Diretórios pais são criados implicitamente em escrita.

- [ ] **Step 1: Escrever o teste que falha**

`test/web/VirtualFSTest.hx`:

```haxe
import web.VirtualFS;

class VirtualFSTest {
	static var pass = 0;
	static var fail = 0;

	static function check(name:String, cond:Bool) {
		if( cond ) { pass++; }
		else { fail++; Sys.println('FAIL: $name'); }
	}

	static function main() {
		var fs = new VirtualFS();

		// write + read round-trip
		fs.writeString("/web/project.ldtk", "{\"a\":1}");
		check("exists after write", fs.exists("/web/project.ldtk"));
		check("read round-trip", fs.readString("/web/project.ldtk") == "{\"a\":1}");

		// missing file
		check("missing not exists", !fs.exists("/web/nope"));

		// implicit parent dir
		check("parent is dir", fs.isDir("/web"));
		check("not a file dir", !fs.isDir("/web/project.ldtk"));

		// readDir lists immediate children
		fs.writeString("/web/levels/L0.ldtkl", "{}");
		fs.writeString("/web/levels/L1.ldtkl", "{}");
		var names = fs.readDir("/web/levels");
		names.sort(Reflect.compare);
		check("readDir children", names.join(",") == "L0.ldtkl,L1.ldtkl");
		check("dirHasAnyFile", fs.dirHasAnyFile("/web/levels"));

		// bytes round-trip
		var b = haxe.io.Bytes.ofString("hi");
		fs.writeBytes("/web/img.bin", b);
		check("bytes round-trip", fs.readBytes("/web/img.bin").toString() == "hi");

		// dirty tracking
		check("dirty marked", fs.dirty.exists("/web/project.ldtk"));
		fs.clearDirty();
		check("dirty cleared", !fs.dirty.exists("/web/project.ldtk"));
		fs.removeFile("/web/img.bin");
		check("remove marks dirty", fs.dirty.exists("/web/img.bin"));
		check("removed gone", !fs.exists("/web/img.bin"));

		// normalization (trailing slash / backslash)
		fs.writeString("/web/a/b.txt", "x");
		check("normalized dir", fs.isDir("/web/a/"));

		Sys.println('VirtualFS: $pass passed, $fail failed');
		Sys.exit(fail == 0 ? 0 : 1);
	}
}
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `haxe -cp src/electron.renderer -cp test -main VirtualFSTest --interp`
Expected: FAIL — `Type not found : web.VirtualFS`.

- [ ] **Step 3: Implementar `src/electron.renderer/web/VirtualFS.hx`**

```haxe
package web;

class VirtualFS {
	var files : Map<String, haxe.io.Bytes> = new Map();
	var dirs : Map<String, Bool> = new Map();
	public var dirty : Map<String, Bool> = new Map();

	public function new() {
		dirs.set("/", true);
	}

	static function norm(path:String) : String {
		var p = StringTools.replace(path, "\\", "/");
		while( p.length > 1 && StringTools.endsWith(p, "/") )
			p = p.substr(0, p.length - 1);
		if( p.length == 0 ) p = "/";
		return p;
	}

	function ensureParents(path:String) {
		var parts = path.split("/");
		parts.pop(); // drop file/leaf
		var cur = "";
		for( part in parts ) {
			cur = cur == "" ? (part == "" ? "/" : part) : (cur == "/" ? "/" + part : cur + "/" + part);
			if( cur != "" ) dirs.set(cur, true);
		}
		dirs.set("/", true);
	}

	public function writeBytes(path:String, b:haxe.io.Bytes) {
		var p = norm(path);
		ensureParents(p);
		files.set(p, b);
		dirty.set(p, true);
	}

	public inline function writeString(path:String, s:String)
		writeBytes(path, haxe.io.Bytes.ofString(s));

	public function readBytes(path:String) : haxe.io.Bytes {
		var p = norm(path);
		if( !files.exists(p) ) throw 'VirtualFS: file not found: $p';
		return files.get(p);
	}

	public inline function readString(path:String) : String
		return readBytes(path).toString();

	public function exists(path:String) : Bool
		return files.exists(norm(path));

	public function isDir(path:String) : Bool
		return dirs.exists(norm(path));

	public function createDirs(path:String) {
		var p = norm(path);
		ensureParents(p + "/_"); // ensure p itself as a dir
		dirs.set(p, true);
	}

	public function readDir(path:String) : Array<String> {
		var base = norm(path);
		var prefix = base == "/" ? "/" : base + "/";
		var out = new Map<String, Bool>();
		for( f in files.keys() )
			addChild(out, base, prefix, f);
		for( d in dirs.keys() )
			if( d != base ) addChild(out, base, prefix, d);
		return [ for( k in out.keys() ) k ];
	}

	static function addChild(out:Map<String,Bool>, base:String, prefix:String, full:String) {
		if( full == base || !StringTools.startsWith(full, prefix) ) return;
		var rest = full.substr(prefix.length);
		var slash = rest.indexOf("/");
		var child = slash < 0 ? rest : rest.substr(0, slash);
		if( child.length > 0 ) out.set(child, true);
	}

	public function dirHasAnyFile(path:String) : Bool
		return readDir(path).length > 0;

	public function removeFile(path:String) {
		var p = norm(path);
		files.remove(p);
		dirty.set(p, true);
	}

	public function removeDir(path:String) {
		var base = norm(path);
		var prefix = base + "/";
		for( f in files.keys() )
			if( f == base || StringTools.startsWith(f, prefix) ) { files.remove(f); dirty.set(f, true); }
		for( d in dirs.keys() )
			if( d == base || StringTools.startsWith(d, prefix) ) dirs.remove(d);
		dirty.set(base, true);
	}

	public function rename(from:String, to:String) {
		var f = norm(from);
		var t = norm(to);
		if( files.exists(f) ) {
			files.set(t, files.get(f));
			files.remove(f);
			dirty.set(f, true);
			dirty.set(t, true);
			ensureParents(t);
		}
	}

	public function clearDirty()
		dirty = new Map();
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `haxe -cp src/electron.renderer -cp test -main VirtualFSTest --interp`
Expected: `VirtualFS: 13 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/electron.renderer/web/VirtualFS.hx test/web/VirtualFSTest.hx
git commit -m "feat(web): VirtualFS em memória + teste interp"
```

---

### Task 2: `WebFS` — fachada estática com a superfície do `NodeTools`

**Files:**
- Create: `src/electron.renderer/web/WebFS.hx`
- Test: `test/web/VirtualFSTest.hx` (adicionar um bloco `WebFS` no mesmo main)

**Interfaces:**
- Consumes: `web.VirtualFS`.
- Produces: `class WebFS` com um `VirtualFS` singleton (`WebFS.fs`) e **os 14 métodos estáticos** que o código chama via `NT.` (mesmas assinaturas do `dn.js.NodeTools`):
  - `fileExists(path):Bool`, `readFileString(path):String`, `readFileBytes(path):haxe.io.Bytes`
  - `writeFileString(path,str):Void`, `writeFileBytes(path,bytes):Void`
  - `readDir(path):Array<String>`, `createDirs(path):Void`, `removeDir(path):Void`, `removeFile(path):Void`, `renameFile(from,to):Void`
  - `isDirectory(path):Bool`, `dirContainsAnyFile(path):Bool`
  - `checkPermissions(path, read, write, ?exec):Bool` → sempre `true` no web
  - `isWindows():Bool` → `false`

- [ ] **Step 1: Escrever o teste que falha (adicionar ao main existente)**

No fim do `main()` de `test/web/VirtualFSTest.hx`, antes das linhas finais de `Sys.println`/`Sys.exit`, inserir:

```haxe
		// WebFS delega ao VFS singleton
		web.WebFS.reset();
		web.WebFS.writeFileString("/web/p.ldtk", "{}");
		check("WebFS fileExists", web.WebFS.fileExists("/web/p.ldtk"));
		check("WebFS readFileString", web.WebFS.readFileString("/web/p.ldtk") == "{}");
		check("WebFS isWindows false", web.WebFS.isWindows() == false);
		check("WebFS checkPermissions true", web.WebFS.checkPermissions("/web", true, true, false));
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `haxe -cp src/electron.renderer -cp test -main VirtualFSTest --interp`
Expected: FAIL — `Type not found : web.WebFS`.

- [ ] **Step 3: Implementar `src/electron.renderer/web/WebFS.hx`**

```haxe
package web;

/** Substituto browser do dn.js.NodeTools (aliased como NT em import.hx sob #if web). */
class WebFS {
	public static var fs(default,null) : VirtualFS = new VirtualFS();

	/** Reinicia o VFS (usado no início do carregamento de um projeto e em testes). */
	public static function reset() {
		fs = new VirtualFS();
	}

	public static function fileExists(path:String) : Bool return fs.exists(path);
	public static function readFileString(path:String) : String return fs.readString(path);
	public static function readFileBytes(path:String) : haxe.io.Bytes return fs.readBytes(path);
	public static function writeFileString(path:String, str:String) : Void fs.writeString(path, str);
	public static function writeFileBytes(path:String, bytes:haxe.io.Bytes) : Void fs.writeBytes(path, bytes);
	public static function readDir(path:String) : Array<String> return fs.readDir(path);
	public static function createDirs(path:String) : Void fs.createDirs(path);
	public static function removeDir(path:String) : Void fs.removeDir(path);
	public static function removeFile(path:String) : Void fs.removeFile(path);
	public static function renameFile(from:String, to:String) : Void fs.rename(from, to);
	public static function isDirectory(path:String) : Bool return fs.isDir(path);
	public static function dirContainsAnyFile(path:String) : Bool return fs.dirHasAnyFile(path);
	public static function checkPermissions(path:String, read:Bool, write:Bool, ?exec:Bool) : Bool return true;
	public static function isWindows() : Bool return false;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `haxe -cp src/electron.renderer -cp test -main VirtualFSTest --interp`
Expected: `VirtualFS: 17 passed, 0 failed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/electron.renderer/web/WebFS.hx test/web/VirtualFSTest.hx
git commit -m "feat(web): WebFS (fachada NodeTools sobre VirtualFS)"
```

---

### Task 3: `WebElectronTools` (shim do `ET`) + `WebConfig`

**Files:**
- Create: `src/electron.renderer/web/WebElectronTools.hx`
- Create: `src/electron.renderer/web/WebConfig.hx`

**Interfaces:**
- Consumes: nada (usa `js.Browser`).
- Produces:
  - `class WebElectronTools` com **os 15 métodos estáticos** chamados via `ET.` (mesmas assinaturas do `dn.js.ElectronTools`), todos web-safe:
    - `getAppResourceDir():String` → `"./"` · `getLogDir():String` → `"./"` · `getExeDir():String` → `"./"`
    - `getScreenWidth():Int` / `getScreenHeight():Int` → `js.Browser.window.innerWidth/innerHeight`
    - `getArgs():dn.Args` → `new dn.Args("")`
    - `isFullScreen():Bool` → `false` · `setFullScreen(v:Bool):Void` → noop
    - `getZoom():Float` → `1.0` · `locate(path:String, ?isFile:Bool):Void` → noop
    - `setWindowTitle(?s:String):Void` → `js.Browser.document.title = s==null ? "LDtk" : s`
    - `reloadWindow():Void` → `js.Browser.location.reload()` · `exitApp(?code:Int):Void` → noop
    - `openDevTools():Void` → noop · `isDevToolsOpened():Bool` → `false`
  - `class WebConfig` que lê `window.LDTK_CONFIG`: `projectId():String`, `apiBaseUrl():String` (default `""` → mesmo host).

- [ ] **Step 1: Implementar `src/electron.renderer/web/WebElectronTools.hx`**

```haxe
package web;

/** Substituto browser do dn.js.ElectronTools (aliased como ET em import.hx sob #if web). */
class WebElectronTools {
	public static function getAppResourceDir() : String return "./";
	public static function getLogDir() : String return "./";
	public static function getExeDir() : String return "./";
	public static function getScreenWidth() : Int return js.Browser.window.innerWidth;
	public static function getScreenHeight() : Int return js.Browser.window.innerHeight;
	public static function getArgs() : dn.Args return new dn.Args("");
	public static function isFullScreen() : Bool return false;
	public static function setFullScreen(v:Bool) : Void {}
	public static function getZoom() : Float return 1.0;
	public static function locate(path:String, ?isFile:Bool) : Void {}
	public static function setWindowTitle(?s:String) : Void
		js.Browser.document.title = s == null ? "LDtk" : s;
	public static function reloadWindow() : Void js.Browser.location.reload();
	public static function exitApp(?code:Int) : Void {}
	public static function openDevTools() : Void {}
	public static function isDevToolsOpened() : Bool return false;
}
```

- [ ] **Step 2: Implementar `src/electron.renderer/web/WebConfig.hx`**

```haxe
package web;

class WebConfig {
	static function raw() : Dynamic {
		return Reflect.field(js.Browser.window, "LDTK_CONFIG");
	}

	public static function projectId() : String {
		var c = raw();
		return c != null && c.projectId != null ? Std.string(c.projectId) : null;
	}

	public static function apiBaseUrl() : String {
		var c = raw();
		var u = c != null && c.apiBaseUrl != null ? Std.string(c.apiBaseUrl) : "";
		while( StringTools.endsWith(u, "/") ) u = u.substr(0, u.length - 1);
		return u;
	}
}
```

- [ ] **Step 3: Verificar que os shims compilam (contra o classpath do renderer)**

Run: `haxe -cp src/electron.renderer -cp src/externs -cp src/electron.common -lib heaps -lib deepnightLibs -lib hxnodejs -lib electron -D web --no-output -main web.WebElectronTools 2>&1 | head -20`
Expected: sem erros de tipo referentes a `web/WebElectronTools.hx`, `web/WebConfig.hx`, `web/WebFS.hx` (avisos/erros de `-main` sobre faltar `main()` são aceitáveis — só verificamos type-check dos arquivos web; se preferir, criar um `main()` trivial temporário é desnecessário pois a Task 4 monta o build real).

- [ ] **Step 4: Commit**

```bash
git add src/electron.renderer/web/WebElectronTools.hx src/electron.renderer/web/WebConfig.hx
git commit -m "feat(web): WebElectronTools + WebConfig (shims de plataforma)"
```

---

### Task 4: Build web (`renderer.web.hxml`) + alias em `import.hx` + guardas de boot → compila e sobe no navegador

**Files:**
- Create: `renderer.web.hxml`
- Create: `app/assets/web.html`
- Modify: `src/electron.renderer/import.hx` (aliases sob `#if web`)
- Modify: `src/electron.renderer/App.hx` (guardar IpcRenderer, initAutoUpdater, Os.platform)
- Modify: `src/electron.renderer/misc/FileWatcher.hx` (stub `#if web`)
- Modify: `src/electron.renderer/ui/ProjectLoader.hx` (guardar CommandRunner na `done`)

**Interfaces:**
- Consumes: `web.WebFS`, `web.WebElectronTools`.
- Produces: um build `renderer.web.hxml` que gera `app/assets/js/renderer.web.js`, compila limpo, e ao abrir `app/assets/web.html` **sobe no navegador sem exceção fatal**, caindo (por ora) na tela Home vazia. O boot direcionado ao projeto vem na Task 6.

- [ ] **Step 1: Criar `renderer.web.hxml`**

```
-cp src/externs
-cp src/electron.common
-cp src/electron.renderer

-lib heaps
-lib castle
-lib deepnightLibs
-lib hxnodejs
-lib electron
-lib ldtk-haxe-api
-lib heaps-aseprite
-lib uuid

-D editor
-D web
-D unlimitedProcesses

-main Boot
-js app/assets/js/renderer.web.js

--macro MacroTools.dumpBuildVersionToFile()
--macro MacroTools.buildLatestReleaseNotes()
--macro Assets.enableXmlFonts()
```

(Igual ao `renderer.hxml`, trocando `-D electron` por `-D web` e a saída para `renderer.web.js`. As libs electron/hxnodejs permanecem no classpath — só compilam externs; o runtime é neutralizado por `#if web`.)

- [ ] **Step 2: Trocar os aliases em `import.hx` sob `#if web`**

Substituir, em `src/electron.renderer/import.hx`, as duas linhas:

```haxe
import dn.js.ElectronTools as ET;
import dn.js.NodeTools as NT;
```

por:

```haxe
#if web
import web.WebElectronTools as ET;
import web.WebFS as NT;
#else
import dn.js.ElectronTools as ET;
import dn.js.NodeTools as NT;
#end
```

- [ ] **Step 3: Guardar as chamadas de runtime electron no `App.hx`**

Em `src/electron.renderer/App.hx`:

(a) as três `IpcRenderer.on(...)` no construtor:
```haxe
		#if !web
		IpcRenderer.on("onWinClose", onWindowCloseButton);
		IpcRenderer.on("onWinMove", onWindowMove);
		IpcRenderer.on("settingsApplied", ()->updateBodyClasses());
		#end
```

(b) a chamada `initAutoUpdater();` no construtor:
```haxe
		#if !web
		initAutoUpdater();
		#end
```

(c) a chamada `IpcRenderer.invoke("appReady");` perto do fim do construtor:
```haxe
		#if !web
		IpcRenderer.invoke("appReady");
		#end
```

(d) os três one-liners de plataforma (linhas ~505-507):
```haxe
	public static function isLinux() return #if web js.Browser.navigator.platform.toLowerCase().indexOf("linux")>=0 #else js.node.Os.platform()=="linux" #end;
	public static function isWindows() return #if web js.Browser.navigator.platform.toLowerCase().indexOf("win")>=0 #else js.node.Os.platform()=="win32" #end;
	public static function isMac() return #if web js.Browser.navigator.platform.toLowerCase().indexOf("mac")>=0 #else js.node.Os.platform()=="darwin" #end;
```

(e) a linha de log `debugPre('Detected OS: '+...+js.node.Os.platform()...)` (~1113): trocar `js.node.Os.platform()` por `"web"` sob guarda:
```haxe
			debugPre('Detected OS: '+(isWindows()?"Windows":isMac()?"macOs":isLinux()?"Linux":"Unknown ("+ #if web "web" #else js.node.Os.platform() #end +")"));
```

- [ ] **Step 4: Stub do `FileWatcher` no web**

Em `src/electron.renderer/misc/FileWatcher.hx`, envolver o corpo dependente de `js.node.Fs`/`FSWatcher` de modo que no web vire noop. Substituir os métodos que usam `js.node.*` por versões guardadas. Concretamente, no método que registra o watch (contém `js.node.Require.require("fs")` e `js.node.Fs.watch`), envolver todo o corpo:
```haxe
	public function watch(absFilePath:String, cb:Void->Void) {
		#if web
		return; // sem file watching no web
		#else
		// ... corpo original com js.node.Require.require("fs") e js.node.Fs.watch ...
		#end
	}
```
E no campo `all` (linha 6, tipo `js.node.fs.FSWatcher`), guardar a declaração:
```haxe
	#if !web
	var all : Array<{ watcher:js.node.fs.FSWatcher, path:String, cb:Void->Void }> = [];
	#else
	var all : Array<Dynamic> = [];
	#end
```
(Ajustar os demais usos de `all`/métodos que tocam `w.watcher` com `#if !web` conforme o compilador apontar.)

- [ ] **Step 5: Guardar `CommandRunner` no `ProjectLoader.done`**

Em `src/electron.renderer/ui/ProjectLoader.hx`, método `done()`, a chamada:
```haxe
		ui.modal.dialog.CommandRunner.runMultipleCommands( p, p.getCustomCommmands(AfterLoad), ()->{
```
envolver de forma que no web se pule direto para o corpo do callback:
```haxe
		#if web
		{
			var onDone = () -> {
```
…mantendo o corpo atual do callback dentro de `onDone`, e ao final:
```haxe
			};
			onDone();
		}
		#else
		ui.modal.dialog.CommandRunner.runMultipleCommands( p, p.getCustomCommmands(AfterLoad), ()->{
			// ...corpo original...
		});
		#end
```
(Alternativa mais simples se preferir menos duplicação: adicionar, no início de `CommandRunner.runMultipleCommands`, `#if web if(onComplete!=null) onComplete(); return; #end`. Escolher UMA das duas abordagens.)

- [ ] **Step 6: Criar o shell HTML web `app/assets/web.html`**

Igual ao `app.html` porém **sem as linhas de `require()`** (que não existem no browser) e apontando para `renderer.web.js`. Conteúdo:

```html
<html>
<head>
	<meta charset="utf-8"/>
	<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; img-src * data:; connect-src *">
	<script type="text/javascript" src="js/jquery.min.js"></script>
	<script>window.$ = window.jQuery = window.jquery;</script>
	<link rel="stylesheet" href="css/app.min.css"/>
	<link rel="stylesheet" href="css/codemirror/codemirror.css"/>
	<link rel="stylesheet" href="css/codemirror/lucario.css"/>
	<!-- Config de embed (ajuste projectId/apiBaseUrl; normalmente injetado pelo produto hospedeiro) -->
	<script>window.LDTK_CONFIG = { projectId: "demo", apiBaseUrl: "http://localhost:4477" };</script>
</head>
<body>
	<div id="debug"></div>
	<div id="miniNotif"></div>
	<div id="updateInstall"></div>
	<div id="clicktrap"></div>
	<canvas id="webgl"></canvas>
	<div id="page"></div>
	<script type="text/javascript" src="js/renderer.web.js"></script>
	<xml id="notification"><div class="notification"><div class="content"></div></div></xml>
	<div id="notificationList"></div>
	<xml id="tip"><div class="tip"><div class="content"><div class="text"></div><div class="keys"></div></div></div></xml>
	<xml id="progressBar"><div class="progressBar"><div class="label"></div><div class="barWrapper"><div class="bar"></div></div></div></xml>
	<xml id="window"><div class="window"><div class="mask"></div><div class="wrapper"><div class="content"></div></div></div></xml>
</body>
</html>
```

- [ ] **Step 7: Compilar o build web**

Run: `haxe renderer.web.hxml 2>&1 | tail -30`
Expected: compila **sem erros**. Se aparecerem erros de runtime-electron não previstos (ex.: outro `js.node.*`/`IpcRenderer`/`electron.*` no caminho de compilação), guardá-los com `#if !web`/`#if web` conforme o survey em issue #6, e recompilar até limpo. Anotar cada guarda adicional no relatório.

- [ ] **Step 8: Verificação manual no navegador (boot sobe)**

Servir a pasta de assets e abrir o shell:
```bash
cd app/assets && python3 -m http.server 8099
```
Abrir `http://localhost:8099/web.html` no navegador. Expected: a aplicação **sobe sem exceção fatal** no console (o canvas WebGL inicializa; cai na tela Home, provavelmente vazia). Registrar no relatório: erros de console remanescentes (se houver) e o estado visual.

- [ ] **Step 9: Commit**

```bash
git add renderer.web.hxml app/assets/web.html src/electron.renderer/import.hx src/electron.renderer/App.hx src/electron.renderer/misc/FileWatcher.hx src/electron.renderer/ui/ProjectLoader.hx
git commit -m "feat(web): build web-only (-D web) + shims aliased + boot sobe no navegador"
```

---

### Task 5: `ProjectTransport.loadBundle` — buscar bundle e popular o VFS

**Files:**
- Create: `src/electron.renderer/web/ProjectTransport.hx`

**Interfaces:**
- Consumes: `web.WebFS`, `web.WebConfig`.
- Produces: `class ProjectTransport` com:
  - `static function loadBundle(projectId:String, apiBaseUrl:String, onOk:String->Void, onError:String->Void):Void` — faz `GET {apiBaseUrl}/api/project/{projectId}/bundle`; ao receber `{version, manifest, levels, images}`: `WebFS.reset()`, escreve o manifesto em `/web/project.ldtk` (via `haxe.Json.stringify(manifest)`), e — se `manifest.externalLevels==true` — escreve cada nível externo no VFS mapeando `iid → externalRelPath` a partir do manifesto (path absoluto = `/web/` + `externalRelPath`); limpa o dirty set; chama `onOk("/web/project.ldtk")`. Em erro de rede/HTTP, chama `onError(msg)`.
  - Usa `js.html.XMLHttpRequest` (síncrono-friendly via callbacks) ou `js.Browser.fetch`. Verificação é manual/navegador (depende de rede).

- [ ] **Step 1: Implementar `src/electron.renderer/web/ProjectTransport.hx`**

```haxe
package web;

class ProjectTransport {
	public static function loadBundle(projectId:String, apiBaseUrl:String, onOk:String->Void, onError:String->Void) : Void {
		var url = apiBaseUrl + "/api/project/" + projectId + "/bundle";
		var xhr = new js.html.XMLHttpRequest();
		xhr.open("GET", url, true);
		xhr.onreadystatechange = function() {
			if( xhr.readyState != 4 ) return;
			if( xhr.status < 200 || xhr.status >= 300 ) {
				onError('HTTP ${xhr.status} ao carregar $url');
				return;
			}
			try {
				var bundle = haxe.Json.parse(xhr.responseText);
				populate(bundle);
				onOk("/web/project.ldtk");
			} catch( e:Dynamic ) {
				onError("Falha ao processar bundle: " + Std.string(e));
			}
		}
		xhr.onerror = function(_) onError('Erro de rede ao carregar $url');
		xhr.send();
	}

	static function populate(bundle:Dynamic) {
		WebFS.reset();
		var manifest = bundle.manifest;
		WebFS.writeFileString("/web/project.ldtk", haxe.Json.stringify(manifest));

		// Níveis externos: mapear iid -> externalRelPath a partir do manifesto
		if( manifest.externalLevels == true && bundle.levels != null ) {
			var byIid : Map<String,Dynamic> = new Map();
			for( iid in Reflect.fields(bundle.levels) )
				byIid.set(iid, Reflect.field(bundle.levels, iid));

			function writeLevel(l:Dynamic) {
				if( l == null || l.iid == null || l.externalRelPath == null ) return;
				var lvl = byIid.get(Std.string(l.iid));
				if( lvl == null ) return;
				WebFS.writeFileString("/web/" + Std.string(l.externalRelPath), haxe.Json.stringify(lvl));
			}

			// projeto multi-mundo (worlds[]) ou mundo único (levels[])
			if( manifest.worlds != null )
				for( w in (cast manifest.worlds : Array<Dynamic>) )
					if( w.levels != null )
						for( l in (cast w.levels : Array<Dynamic>) ) writeLevel(l);
			if( manifest.levels != null )
				for( l in (cast manifest.levels : Array<Dynamic>) ) writeLevel(l);
		}

		WebFS.fs.clearDirty();
	}
}
```

- [ ] **Step 2: Compilar o build web (garantir que o novo arquivo compila)**

Run: `haxe renderer.web.hxml 2>&1 | tail -20`
Expected: compila sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/electron.renderer/web/ProjectTransport.hx
git commit -m "feat(web): ProjectTransport.loadBundle (fetch bundle -> VFS)"
```

---

### Task 6: Boot web (LDTK_CONFIG → loadBundle → loadProject) → walking skeleton renderiza

**Files:**
- Modify: `src/electron.renderer/App.hx` (bloco de boot: caminho web)

**Interfaces:**
- Consumes: `web.WebConfig`, `web.ProjectTransport`, `App.loadProject`.
- Produces: no web, o boot lê `WebConfig`, chama `ProjectTransport.loadBundle` e, no sucesso, `loadProject("/web/project.ldtk")` (que renderiza o `Editor`); no erro, mostra uma mensagem básica. A tela Home é pulada no web.

- [ ] **Step 1: Substituir o bloco de boot no construtor do `App.hx`**

Localizar, dentro de `delayer.addS( ()->{ ... }, 0.2)`, o trecho que decide o que carregar (o `if( path!=null ) loadProject(...) else if(...) else loadPage(Home)`). Envolver com o caminho web:

```haxe
		delayer.addS( ()->{
			#if web
			var projectId = web.WebConfig.projectId();
			if( projectId == null ) {
				LOG.error("LDTK_CONFIG.projectId ausente");
				debug("Erro: LDTK_CONFIG.projectId ausente", 0xff0000, true);
			}
			else {
				LOG.add("BOOT", 'Carregando projeto "$projectId" do servidor...');
				web.ProjectTransport.loadBundle(
					projectId,
					web.WebConfig.apiBaseUrl(),
					(virtualPath) -> loadProject(virtualPath),
					(err) -> {
						LOG.error("Falha ao carregar projeto: " + err);
						debug("Não foi possível carregar o projeto do servidor:\n" + err, 0xff0000, true);
					}
				);
			}

			if( !hasGlContext )
				onGlContextLoss();
			#else
			// ... bloco original (getArgPath / loadProject / reopen last / Home) ...
			#end
		}, 0.2);
```

(Manter o bloco desktop original **inteiro** dentro do `#else`.)

- [ ] **Step 2: Compilar**

Run: `haxe renderer.web.hxml 2>&1 | tail -20`
Expected: compila sem erros.

- [ ] **Step 3: Verificação manual — o walking skeleton (com o servidor rodando)**

Terminal A — subir o servidor da peça 1 com um projeto default:
```bash
cd server && STORAGE_DIR=$(mktemp -d) PORT=4477 npm start
```
Terminal B — servir os assets:
```bash
cd app/assets && python3 -m http.server 8099
```
Abrir `http://localhost:8099/web.html` (o `web.html` já aponta `projectId:"demo"`, `apiBaseUrl:"http://localhost:4477"`).

Expected: o editor **renderiza** — busca o bundle (projeto LDtk em branco), pula a Home e **abre direto no `Editor`** com o mundo vazio, painéis e toolbar visíveis. Confirmar no console de rede a chamada `GET /api/project/demo/bundle` com 200. Registrar no relatório: screenshot/observação do estado e quaisquer erros de console.

- [ ] **Step 4: (Opcional) Verificar com um projeto de conteúdo**

Semear o servidor com um projeto de amostra embutido (níveis embutidos), depois recarregar:
```bash
curl -s -X PUT localhost:4477/api/project/demo/manifest -H 'Content-Type: application/json' -H 'If-Match: 0' --data-binary @tests/grassAndDirt.ldtk
```
Recarregar `web.html`. Expected: o editor renderiza o projeto de amostra (níveis/camadas visíveis). Se `grassAndDirt.ldtk` referenciar tilesets por caminho de disco, as imagens podem faltar (upload de tileset é escopo posterior) — o mapa de layers ainda deve desenhar. Registrar o resultado.

- [ ] **Step 5: Commit**

```bash
git add src/electron.renderer/App.hx
git commit -m "feat(web): boot web abre projeto do servidor (walking skeleton)"
```

---

## Implementation notes / desvios (o que a execução revelou)

O plano previu um "único ponto iterativo" (Task 4, Step 7) para guardar chamadas de runtime. Na prática, o build compilado emite **`require()` de topo** e usa globais Node/Electron que exigiram um **shim de browser** além das guardas `#if web`. Resumo do que foi necessário (tudo em `app/assets/js/web-shim.js` + `app/web.html`), não previsto no plano:

- **`window.require` shim**: o bundle tem `require("electron"|"fs"|"os"|"path"|"process"|"buffer"|"zlib"|"timers"|"codemirror"|"sortablejs"|...)` no init de módulo. O shim devolve stubs seguros (as chamadas de runtime estão guardadas) e as libs reais para codemirror/sortablejs.
- **Globais**: `process` (com `hrtime`), `global`, e um polyfill mínimo de `Buffer` (haxe.io.Bytes no js puro é ArrayBuffer, mas `sys.io.File`/hxnodejs tocam `Buffer` no static-init).
- **zlib → pako**: `haxe.zip.Uncompress` descompacta assets embutidos no boot via `zlib.inflateSync`; mapeado para `pako` (novo dep em `app/package.json`, dist em `app/assets/js/vendor/`).
- **`electron.ipcRenderer.sendSync`**: o `dn.js.ElectronTools` (interno da deepnightLibs, não coberto pelo alias `ET`) roteia info de janela por IPC; o shim responde por canal com valores de browser.
- **`WebFS` fallback de assets**: o app lê seus próprios templates (`./assets/tpl/pages/*.html`) via `NT`. `WebFS.readFileString/Bytes/fileExists` fazem **XHR síncrono** para paths ausentes no VFS e cacheiam — arquivos de projeto vêm do VFS, assets do app vêm do HTTP.
- **`web.html` na raiz `app/`** (não em `app/assets/`): o app resolve assets como `./assets/...` a partir da raiz que contém `assets/`. Servir de `app/` faz os paths baterem. Scripts/CSS referenciados com prefixo `assets/`.
- **Loop em aba oculta**: navegadores congelam `requestAnimationFrame` em abas hidden e o dt do Heaps satura em 0 (freeze). O shim mantém o loop vivo (rAF→setTimeout) e usa um **relógio virtual** enquanto oculto. É só para o ambiente headless de verificação; em aba visível usa o clock real.
- **Libs globais no `web.html`**: `jquery.min.js`, `marked.min.js`, `vendor/{codemirror,sortable,pako}.js`, depois `web-shim.js`, antes do `renderer.web.js`.

**Verificado**: `haxe renderer.web.hxml` compila limpo; servindo `app/` + servidor da peça 1, `web.html` abre, faz `GET /api/project/demo/bundle`, e **renderiza o editor LDtk com o Level_0 do projeto** (canvas WebGL + painéis + toolbar), sem erros de console. `renderer.web.js` é artefato de build (gitignored, como `renderer.js`).

## Self-Review

**Spec coverage (contra o design e as issues #6–#12):**
- #6 (levantamento) → já feito (comentário na issue); informou a superfície exata usada aqui. ✓
- #7 (VirtualFS + WebFS, alias) → Tasks 1, 2, 4 (Step 2). ✓
- #8 (ProjectTransport) → Task 5 implementa `loadBundle` (flush/uploadImage ficam para depois, conforme escopo do skeleton). ✓ (parcial, intencional)
- #9 (stubs de plataforma) → Task 3 (ET/WebConfig), Task 4 (FileWatcher, ElectronUpdater guardado). ElectronDialogs **não** stubado (não está no caminho load+render; fica para o trabalho de save/upload). Anotado. ✓ (parcial, intencional)
- #10 (limpeza de build) → parcial: IpcRenderer/updater/CommandRunner **guardados** (não removidos); libs electron/hxnodejs mantidas no classpath. Remoção real fica na issue #10 completa. ✓ (parcial, intencional — declarado nas Global Constraints)
- #11 (build web + index.html + LDTK_CONFIG) → Task 4 (`renderer.web.hxml`, `web.html`, `WebConfig`). ✓
- #12 (bootstrap) → Task 6. ✓

**Placeholder scan:** sem "TBD"/"TODO". Os passos de código trazem código. O Step 7 da Task 4 ("guardar erros remanescentes conforme o survey") **não** é placeholder — é o método honesto para um porte compilado sem harness: iterar sobre erros reais de compilação/console guiado pela lista concreta da issue #6. As Global Constraints declaram que a verificação é compile-gate + navegador (não TDD), por ausência de harness Haxe.

**Type consistency:** `VirtualFS` (Task 1) expõe `writeString/writeBytes/readString/readBytes/exists/isDir/readDir/dirHasAnyFile/createDirs/removeFile/removeDir/rename/dirty/clearDirty`; `WebFS` (Task 2) delega a esses nomes e expõe a superfície `NT.` (fileExists/readFileString/readFileBytes/writeFileString/writeFileBytes/readDir/createDirs/removeDir/removeFile/renameFile/isDirectory/dirContainsAnyFile/checkPermissions/isWindows) — casada com os usos reais levantados na issue #6. `WebElectronTools` (Task 3) cobre os 15 métodos `ET.` levantados. `ProjectTransport.loadBundle(projectId, apiBaseUrl, onOk, onError)` (Task 5) é consumido exatamente assim no boot da Task 6. `WebConfig.projectId()/apiBaseUrl()` consistentes entre Tasks 3 e 6. O caminho virtual `/web/project.ldtk` é produzido pela Task 5 e consumido pela Task 6.

**Risco declarado:** o Step 7 da Task 4 pode revelar chamadas node/electron de runtime não previstas no caminho load+render (ex.: I/O de arquivo do `dn.Log`, `Sys.getCwd()`). Mitigação: guardá-las com `#if web` uma a uma (a lista da issue #6 cobre as prováveis). É o único ponto iterativo do plano; todo o resto é determinístico.
