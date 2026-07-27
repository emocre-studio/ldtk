# LDtk Web — Remover Electron/Node do build (issue #10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar `-lib electron` e `-lib hxnodejs` do build web, tornando o fork genuinamente browser-only — hoje eles ainda são compilados e neutralizados em runtime pelo `web-shim.js`.

**Architecture:** Mesma técnica já validada com `NT`/`ET`: em vez de espalhar `#if` pelos ~25 call sites, criam-se **aliases em `import.hx`** (`ED`, `SHELL`, `CLIP`) que apontam para implementações web ou para as do Electron, e os call sites passam a usar o nome curto. Só sobram guardas pontuais onde não há alias possível (`Sys`, `js.Node`, `IpcRenderer`).

**Tech Stack:** Haxe→JS. Verificação: compile-gate (web **e** desktop) + as três suítes de teste (unit interp, unit node, smoke e2e).

## Global Constraints

- **O desktop não pode regredir**: `haxe renderer.hxml` deve continuar compilando e usando as implementações Electron originais.
- Novo código web em `srcweb/web/`.
- **Decisão de produto (confirmada):** no web o clipboard é **interno** — copiar/colar dentro do editor funciona (entidades, camadas, níveis); não há integração com o clipboard do sistema.
- Diálogos nativos (abrir/salvar/escolher pasta) não existem no browser: `WebDialogs` **não** chama o callback e avisa o usuário, exceto o picker de imagem, que já tem caminho próprio (`WebImagePicker`).
- Ao final, `app/assets/js/web-shim.js` deve encolher: sem `hxnodejs`/`electron`, os stubs de `fs`/`os`/`path`/`child_process`/`electron`/`buffer` deixam de ser necessários. O que **permanece** é o que vem do Heaps/std: `zlib`→pako, `process` (hrtime) e os `require` dos externs de UI (codemirror, sortablejs).
- **Fora de escopo (declarado):** excluir importers/exporters do build. Eles são Haxe puro (usam `NT`) e não forçam as libs node; removê-los exige guardar os pontos de menu que os alcançam. Fica registrado na issue.

---

### Task 1: `WebDialogs` + alias `ED`

**Files:**
- Create: `srcweb/web/WebDialogs.hx`
- Modify: `src/electron.renderer/import.hx`
- Modify (call sites → `ED.`): `misc/JsTools.hx`, `ui/FieldInstancesForm.hx`, `ui/modal/panel/EditEnumDefs.hx`, `ui/modal/panel/EditProject.hx`, `ui/modal/dialog/LostFile.hx`, `page/Home.hx`, `page/Editor.hx`

**Interfaces:**
- Consumes: `ui.Notification`.
- Produces:
  - `WebDialogs` com a mesma superfície usada no código: `openFile(?exts:Array<String>, ?defaultPath:String, cb:String->Void)`, `saveFileAs(?exts:Array<String>, ?defaultPath:String, cb:String->Void)`, `openDir(?defaultPath:String, cb:String->Void)`. No web todas notificam "não disponível no editor web" e **não** chamam `cb`.
  - Alias em `import.hx`: `#if web import web.WebDialogs as ED; #else import dn.js.ElectronDialogs as ED; #end`.
  - Todos os `dn.js.ElectronDialogs.` passam a ser `ED.`.

- [ ] **Step 1: Criar `srcweb/web/WebDialogs.hx`**

```haxe
package web;

/**
	Substituto browser do dn.js.ElectronDialogs (aliased como ED em import.hx).
	O browser não expõe diálogos nativos de arquivo/pasta: estas chamadas avisam
	o usuário e NÃO invocam o callback (o fluxo simplesmente não prossegue).
	A exceção é a escolha de imagem, que tem caminho próprio via WebImagePicker.
**/
class WebDialogs {
	static function unavailable(what:String) {
		ui.Notification.error(what + " não está disponível no editor web.");
	}

	public static function openFile(?exts:Array<String>, ?defaultPath:String, cb:String->Void) {
		unavailable("Abrir arquivo");
	}

	public static function saveFileAs(?exts:Array<String>, ?defaultPath:String, cb:String->Void) {
		unavailable("Salvar como");
	}

	public static function openDir(?defaultPath:String, cb:String->Void) {
		unavailable("Escolher pasta");
	}
}
```

- [ ] **Step 2: Adicionar o alias em `import.hx`**

No bloco já existente, acrescentar `ED` aos dois ramos:

```haxe
#if web
import web.WebElectronTools as ET;
import web.WebFS as NT;
import web.WebDialogs as ED;
#else
import dn.js.ElectronTools as ET;
import dn.js.NodeTools as NT;
import dn.js.ElectronDialogs as ED;
#end
```

- [ ] **Step 3: Reescrever os call sites**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk && grep -rl "dn\.js\.ElectronDialogs\." src/electron.renderer/ | xargs sed -i '' 's/dn\.js\.ElectronDialogs\./ED./g' && grep -rn "dn\.js\.ElectronDialogs" src/electron.renderer/ || echo "OK: nenhuma referência qualificada restante"
```
Expected: imprime `OK: nenhuma referência qualificada restante`.

- [ ] **Step 4: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam (ainda com as libs presentes — a remoção é a Task 5).

- [ ] **Step 5: Commit**

```bash
git add srcweb/web/WebDialogs.hx src/electron.renderer/
git commit -m "refactor(web): alias ED para diálogos de arquivo (WebDialogs no web)"
```

---

### Task 2: `WebShell` + alias `SHELL`

**Files:**
- Create: `srcweb/web/WebShell.hx`
- Modify: `src/electron.renderer/import.hx`
- Modify (call sites → `SHELL.`): `App.hx`, `misc/JsTools.hx`, `ui/FieldDefsForm.hx`, `ui/modal/dialog/EditAppSettings.hx`, `page/CrashReport.hx`, `page/Home.hx`

**Interfaces:**
- Consumes: `js.Browser`.
- Produces: `WebShell.openExternal(url:String):Void` → `window.open(url, "_blank")`; alias `#if web import web.WebShell as SHELL; #else import electron.Shell as SHELL; #end`.

- [ ] **Step 1: Criar `srcweb/web/WebShell.hx`**

```haxe
package web;

/** Substituto browser do electron.Shell (aliased como SHELL em import.hx). **/
class WebShell {
	public static function openExternal(url:String) {
		js.Browser.window.open(url, "_blank");
	}
}
```

- [ ] **Step 2: Adicionar o alias em `import.hx`**

```haxe
#if web
...
import web.WebShell as SHELL;
#else
...
import electron.Shell as SHELL;
#end
```

- [ ] **Step 3: Reescrever os call sites**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk && grep -rl "electron\.Shell\." src/electron.renderer/ | xargs sed -i '' 's/electron\.Shell\./SHELL./g' && grep -rn "electron\.Shell" src/electron.renderer/ || echo "OK: nenhuma referência restante"
```
Expected: `OK: nenhuma referência restante`.

- [ ] **Step 4: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam.

- [ ] **Step 5: Commit**

```bash
git add srcweb/web/WebShell.hx src/electron.renderer/
git commit -m "refactor(web): alias SHELL para abrir URLs externas"
```

---

### Task 3: `WebClipboard` + alias `CLIP` + clipboard interno no web

**Files:**
- Create: `srcweb/web/WebClipboard.hx`
- Modify: `src/electron.renderer/import.hx`
- Modify: `src/electron.renderer/data/Clipboard.hx` (call sites + `createSystem` no web)
- Modify (call sites → `CLIP.`): `ui/modal/dialog/ColorPicker.hx`, `page/CrashReport.hx`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `WebClipboard` com a superfície usada: `readText():String`, `writeText(s:String):Void`, `write(o:{text:String}):Void`. Guarda o texto num buffer estático (clipboard **interno**, decisão de produto): `writeText` grava no buffer e `readText` devolve o buffer.
  - Alias `#if web import web.WebClipboard as CLIP; #else import electron.Clipboard as CLIP; #end`.
  - `data.Clipboard.createSystem()` no web devolve um clipboard **não** ligado ao sistema.

- [ ] **Step 1: Criar `srcweb/web/WebClipboard.hx`**

```haxe
package web;

/**
	Substituto browser do electron.Clipboard (aliased como CLIP em import.hx).
	O clipboard do browser é assíncrono e pede permissão, enquanto a API do
	Electron é síncrona — então no web usamos um buffer interno: copiar/colar
	DENTRO do editor funciona; não há integração com o clipboard do sistema.
**/
class WebClipboard {
	static var buffer : String = "";

	public static function readText() : String return buffer;

	public static function writeText(s:String) : Void buffer = s;

	public static function write(o:{ text:String }) : Void buffer = o.text;
}
```

- [ ] **Step 2: Adicionar o alias em `import.hx`**

```haxe
#if web
...
import web.WebClipboard as CLIP;
#else
...
import electron.Clipboard as CLIP;
#end
```

- [ ] **Step 3: Reescrever os call sites**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk && grep -rl "electron\.Clipboard\." src/electron.renderer/ | xargs sed -i '' 's/electron\.Clipboard\./CLIP./g' && grep -rn "electron\.Clipboard" src/electron.renderer/ || echo "OK: nenhuma referência restante"
```
Expected: `OK: nenhuma referência restante`.

- [ ] **Step 4: No web, o clipboard não se liga ao sistema**

Em `src/electron.renderer/data/Clipboard.hx`, localizar `createSystem()` e fazer com que no web crie a variante interna. Conferir a assinatura real antes de editar:

Run: `cd /Users/afonsof/Projects/emocre/ldtk && grep -n "createSystem\|function new" src/electron.renderer/data/Clipboard.hx | head`

Aplicar a guarda no corpo de `createSystem()` de modo que no web retorne o clipboard **sem** vínculo com o sistema (o mesmo construtor usado pela variante interna), mantendo o desktop inalterado.

- [ ] **Step 5: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam.

- [ ] **Step 6: Commit**

```bash
git add srcweb/web/WebClipboard.hx src/electron.renderer/
git commit -m "refactor(web): alias CLIP + clipboard interno no web"
```

---

### Task 4: Guardas pontuais (`Sys`, `js.Node`, `IpcRenderer` em Settings)

**Files:**
- Modify: `src/electron.renderer/App.hx` (`Sys.getCwd()`)
- Modify: `src/electron.renderer/Const.hx` (`js.Node.process.arch`)
- Modify: `src/electron.common/Settings.hx` (import + usos de `IpcRenderer`)

**Interfaces:**
- Consumes: nada.
- Produces: os três pontos sem alias possível passam a ter `#if web` / `#if !web`.

- [ ] **Step 1: `Sys.getCwd()` no App.hx**

Substituir a linha de log:
```haxe
		LOG.add("BOOT","CWD: "+ #if web js.Browser.location.href #else Sys.getCwd() #end);
```

- [ ] **Step 2: `js.Node.process.arch` no Const.hx**

Envolver o corpo de `getArch()`:
```haxe
	public static function getArch() {
		#if web
		return "web";
		#else
		return switch js.Node.process.arch {
```
…mantendo o `switch` original dentro do `#else` e fechando com `#end` antes do fim do método.

- [ ] **Step 3: `IpcRenderer` no Settings.hx**

Guardar o import:
```haxe
#if !web
import electron.renderer.IpcRenderer;
#end
```
Então compilar e guardar os usos que o compilador apontar (cada `IpcRenderer.…` em `Settings.hx` vira `#if !web … #end`, preservando o comportamento desktop).

Run (para listar os usos): `cd /Users/afonsof/Projects/emocre/ldtk && grep -n "IpcRenderer" src/electron.common/Settings.hx`

- [ ] **Step 4: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam.

- [ ] **Step 5: Commit**

```bash
git add src/electron.renderer/App.hx src/electron.renderer/Const.hx src/electron.common/Settings.hx
git commit -m "refactor(web): guardas para Sys/js.Node/IpcRenderer"
```

---

### Task 5: Remover `-lib electron` e `-lib hxnodejs` do build web

**Files:**
- Modify: `renderer.web.hxml`
- Modify: arquivos residuais que o compilador apontar

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: build web sem as libs Electron/Node no classpath.

- [ ] **Step 1: Remover as duas linhas do `renderer.web.hxml`**

Apagar `-lib hxnodejs` e `-lib electron` (o desktop `renderer.hxml` permanece intocado).

- [ ] **Step 2: Compilar e tratar os residuais**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | head -30`
Expected: eventualmente compila limpo. Cada erro remanescente é um ponto ainda acoplado — guardar com `#if !web` (ou apontar para um shim web) e recompilar até zerar. **Registrar no relatório cada ponto adicional encontrado**, pois eles não estavam no levantamento inicial.

- [ ] **Step 3: Confirmar que o desktop segue intacto**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: compila sem erros.

- [ ] **Step 4: Commit**

```bash
git add renderer.web.hxml src/
git commit -m "build(web): remove electron e hxnodejs do classpath do build web"
```

---

### Task 6: Encolher o `web-shim.js` e verificar tudo

**Files:**
- Modify: `app/assets/js/web-shim.js`
- Modify: `docs/superpowers/plans/...` (notas, ao final)

**Interfaces:**
- Consumes: Task 5.
- Produces: shim reduzido ao que o Heaps/std realmente exige, com as três suítes verdes.

- [ ] **Step 1: Descobrir o que o bundle ainda exige**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk && grep -oE "require\(\"[^\"]+\"\)" app/assets/js/renderer.web.js | sort | uniq -c
```
Expected: uma lista bem menor que a original (que tinha electron×12, fs×7, os, path, process, buffer, child_process, https, zlib, timers). O esperado agora é sobrar apenas o que vem dos externs de UI (`codemirror`, `sortablejs`, `simple-color-picker`) e eventualmente `zlib`.

- [ ] **Step 2: Remover do shim os stubs que não são mais requisitados**

Editar `app/assets/js/web-shim.js` mantendo **apenas** o que a saída do Step 1 (mais os globais usados diretamente) exigir. Guiar-se pelo aviso `console.warn("[web-shim] unstubbed require: ...")` já existente: se algo faltar, ele aparece no console do e2e.

- [ ] **Step 3: Rodar as três suítes**

Run:
```bash
cd /Users/afonsof/Projects/emocre/ldtk \
 && haxe -cp srcweb -cp test -main webtest.VirtualFSTest --interp \
 && haxe test.transport.hxml && node test/webtest/run-transport-test.mjs \
 && (cd server && npm test 2>&1 | grep -E "Tests") \
 && (cd e2e && npm test 2>&1 | tail -3)
```
Expected: `VirtualFS 17/17`, `ProjectTransport 17/17`, servidor `38 passed`, e2e `4 passed`.

- [ ] **Step 4: Conferir o console do e2e por avisos do shim**

Run: `cd /Users/afonsof/Projects/emocre/ldtk/e2e && npx playwright test --reporter=list 2>&1 | grep -i "unstubbed\|error" | head`
Expected: nenhum `unstubbed require`. Se aparecer, restaurar o stub correspondente.

- [ ] **Step 5: Commit**

```bash
git add app/assets/js/web-shim.js
git commit -m "build(web): enxuga o web-shim após remover electron/hxnodejs"
```

---

## Self-Review

**Spec coverage (issue #10):**
- Remover Electron main/IPC/updater do build web → Tasks 1–5 (o `ElectronMain` já não é compilado desde o walking skeleton; IPC/updater ficam fora com a remoção das libs). ✓
- Remover importers/exporters → **fora de escopo, declarado** nas Global Constraints e a registrar na issue: são Haxe puro, não forçam as libs, e removê-los exige guardar pontos de menu. ✓ (decisão explícita, não omissão)

**Placeholder scan:** sem "TBD"/"TODO". As Tasks 3 Step 4 e 4 Step 3 mandam **conferir a assinatura/usos reais antes de editar** — são verificações concretas, não placeholders, porque o número exato de usos de `IpcRenderer` em `Settings.hx` e a forma de `createSystem()` precisam ser lidos no código. A Task 5 Step 2 é iterativa por natureza (remover libs revela acoplamentos), com instrução explícita de registrar cada ponto novo.

**Type consistency:** os três aliases (`ED`, `SHELL`, `CLIP`) seguem o padrão já existente de `NT`/`ET` no mesmo `import.hx`, e cada um tem a **mesma superfície** nos dois ramos: `ED.{openFile,saveFileAs,openDir}`, `SHELL.openExternal`, `CLIP.{readText,writeText,write}`. Os call sites reescritos por `sed` passam a usar exatamente esses nomes.

**Risco declarado:** a Task 5 é a única com resultado não totalmente previsível — remover as libs pode revelar acoplamentos fora do levantamento inicial (o levantamento foi feito por compilação-sonda e listou 8 pontos, mas o compilador para no primeiro lote de erros). Mitigação: as três suítes de teste (76 asserções, incluindo e2e de boot/save) rodam ao final e pegam regressão de comportamento, não só de compilação.
