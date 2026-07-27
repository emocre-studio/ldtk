# LDtk Web — Tratamento de Erros de Rede (issue #13)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o editor web se comportar de forma previsível quando a rede/servidor falha — sem estado enganoso e sem perda silenciosa de trabalho.

**Architecture:** Quatro pontos de falha, cada um com uma resposta específica (conforme o design): boot (tela bloqueante + retry), flush (mantém o projeto marcado como não-salvo e preserva o dirty set), conflito 409 (diálogo acionável), upload (erro localizado, projeto intacto).

**Tech Stack:** Haxe→JS (`renderer.web.hxml`), jQuery/DOM. Verificação: compile-gate + simulação real de cada falha no navegador.

## Global Constraints

- Código web novo em `srcweb/web/`; guardas `#if web` no código do editor. Desktop **não** pode regredir (`haxe renderer.hxml` deve compilar).
- **Princípio (do design):** durante a sessão a memória é a fonte da verdade; falha de rede nunca perde o estado em edição — apenas adia a persistência.
- A tela de erro de boot **não** pode depender do sistema de modais (`ui.Modal` faz `super(Editor.ME)` e anexa em `#page`; no boot o `Editor` ainda não existe). Usar DOM direto em `#page`.
- Mensagens de usuário em português, consistentes com as já existentes no web (`"Saved to server"` é a única em inglês e permanece).

---

### Task 1: `WebErrorScreen` — tela bloqueante de falha no boot + retry

**Files:**
- Create: `srcweb/web/WebErrorScreen.hx`
- Modify: `src/electron.renderer/App.hx` (extrair o boot web em função reutilizável e usar a tela)

**Interfaces:**
- Consumes: nada (DOM puro via `js.Browser`).
- Produces:
  - `WebErrorScreen.show(title:String, detail:String, ?onRetry:Void->Void):Void` — limpa `#page` e renderiza uma tela de erro ocupando a página, com título, detalhe e (se `onRetry` != null) um botão "Tentar de novo" que limpa a tela e chama `onRetry`.
  - `WebErrorScreen.clear():Void` — remove a tela.
  - Em `App.hx`, o boot web vira `function startWebBoot():Void` (chamada no delayer e pelo retry).

- [ ] **Step 1: Criar `srcweb/web/WebErrorScreen.hx`**

```haxe
package web;

/**
	Tela de erro que ocupa a página inteira, usada quando o editor não pôde nem
	abrir (falha ao carregar o projeto do servidor). Não usa o sistema de modais
	do LDtk de propósito: `ui.Modal` depende de `Editor.ME`, que no boot ainda
	não existe.
**/
class WebErrorScreen {
	static inline var ID = "webErrorScreen";

	public static function clear() {
		var old = js.Browser.document.getElementById(ID);
		if( old!=null ) old.remove();
	}

	public static function show(title:String, detail:String, ?onRetry:Void->Void) {
		clear();
		var doc = js.Browser.document;
		var wrapper = doc.createDivElement();
		wrapper.id = ID;
		wrapper.setAttribute("style",
			"position:fixed; inset:0; z-index:9999; display:flex; align-items:center;"
			+ " justify-content:center; background:#1c2028; color:#e8e8e8;"
			+ " font-family:sans-serif; text-align:center; padding:2em;");

		var box = doc.createDivElement();
		box.setAttribute("style", "max-width:36em;");

		var h = doc.createElement("h1");
		h.textContent = title;
		h.setAttribute("style", "color:#ff9b52; font-size:1.6em; margin:0 0 0.6em 0;");
		box.appendChild(h);

		var p = doc.createParagraphElement();
		p.textContent = detail;
		p.setAttribute("style", "opacity:0.85; line-height:1.5; word-break:break-word;");
		box.appendChild(p);

		if( onRetry!=null ) {
			var btn = doc.createButtonElement();
			btn.textContent = "Tentar de novo";
			btn.setAttribute("style",
				"margin-top:1.4em; padding:0.6em 1.4em; font-size:1em; cursor:pointer;"
				+ " border:none; border-radius:4px; background:#ff9b52; color:#1c2028;");
			btn.onclick = function(_) {
				clear();
				onRetry();
			}
			box.appendChild(btn);
		}

		wrapper.appendChild(box);
		doc.body.appendChild(wrapper);
	}
}
```

- [ ] **Step 2: Extrair o boot web em `startWebBoot()` no `App.hx`**

Substituir o bloco `#if web ... #else` dentro do `delayer.addS( ()->{ ... }, 0.2)` de modo que o ramo web apenas chame a nova função:

```haxe
			#if web
			startWebBoot();

			if( !hasGlContext )
				onGlContextLoss();
			#else
```
(o ramo `#else` do desktop permanece exatamente como está)

E adicionar o método logo após o construtor (antes de `function initKeyBindings()`):

```haxe
	#if web
	/** Carrega o projeto indicado por window.LDTK_CONFIG. Reutilizado pelo botão
		"Tentar de novo" da tela de erro. **/
	public function startWebBoot() {
		var projectId = web.WebConfig.projectId();
		if( projectId==null ) {
			LOG.error("LDTK_CONFIG.projectId ausente");
			web.WebErrorScreen.show(
				"Configuração ausente",
				"window.LDTK_CONFIG.projectId não foi definido. O produto hospedeiro precisa informar qual projeto abrir."
			);
			return;
		}

		LOG.add("BOOT", 'Loading project "$projectId" from server...');
		web.ProjectTransport.loadBundle(
			projectId,
			web.WebConfig.apiBaseUrl(),
			(virtualPath) -> {
				web.WebErrorScreen.clear();
				loadProject(virtualPath);
			},
			(err) -> {
				LOG.error("Failed to load project: "+err);
				web.WebErrorScreen.show(
					"Não foi possível carregar o projeto",
					err,
					() -> startWebBoot()
				);
			}
		);
	}
	#end
```

- [ ] **Step 3: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam sem erros.

- [ ] **Step 4: Verificação manual — falha de boot e retry**

Servir `app/` em `:8099`. Abrir `http://localhost:8099/web.html?p=demo&api=http://localhost:9999` (porta sem servidor).
Expected: tela "Não foi possível carregar o projeto" com o detalhe do erro e botão "Tentar de novo"; **não** cai na Home nem abre o editor pela metade.
Depois, com o servidor real no ar em `:4477`, abrir `...?p=demo&api=http://localhost:4477` e confirmar que o editor abre normalmente (tela de erro não aparece). Registrar os dois resultados.

- [ ] **Step 5: Commit**

```bash
git add srcweb/web/WebErrorScreen.hx src/electron.renderer/App.hx
git commit -m "feat(web): tela de erro bloqueante com retry quando o boot falha"
```

---

### Task 2: Falha no flush mantém o projeto como não-salvo

**Files:**
- Modify: `src/electron.renderer/page/Editor.hx` (callback de sucesso do `ProjectSaver`)

**Interfaces:**
- Consumes: `web.ProjectTransport.flush`, `Editor.needSaving`, `Editor.updateTitle()`.
- Produces: quando o flush falha, o editor volta a marcar `needSaving = true` e atualiza o título (volta o `[UNSAVED]`), de modo que o estado da UI **não** minta dizendo que salvou. O dirty set do VFS já é preservado pelo `flush` (só é limpo no sucesso), então o próximo Ctrl+S reenvia.

- [ ] **Step 1: Ajustar o callback do flush**

Em `src/electron.renderer/page/Editor.hx`, substituir o bloco `#if web ... #end` dentro do callback de sucesso do `ProjectSaver` por:

```haxe
				#if web
				// O saver grava no caminho virtual do projeto; o flush lê de lá.
				web.ProjectTransport.setProjectVPath( project.filePath.full );
				web.ProjectTransport.flush(
					() -> N.success("Saved to server"),
					(err) -> {
						// O projeto NÃO está no servidor: manter marcado como não-salvo
						// para a UI não mentir. O dirty set do VFS é preservado pelo
						// flush, então o próximo save reenvia tudo.
						this.needSaving = true;
						updateTitle();
						if( err=="conflict" )
							onWebSaveConflict();
						else
							N.error("Falha ao salvar no servidor: "+err);
					}
				);
				#end
```

(`onWebSaveConflict` é criado na Task 3; nesta task, criar um stub temporário **não** é necessário se as tasks forem executadas em ordem — a Task 3 adiciona o método antes de compilar. Se precisar compilar após a Task 2 isoladamente, trocar `onWebSaveConflict()` por `N.error("O projeto mudou no servidor; recarregue a página.")` e ajustar na Task 3.)

- [ ] **Step 2: Compilar (após a Task 3, ver nota acima)**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros (com `onWebSaveConflict` já definido pela Task 3).

- [ ] **Step 3: Verificação manual — save com servidor fora do ar**

Com o editor aberto e o projeto carregado, **parar o servidor** (`pkill -f "PORT=4477"`). Fazer uma alteração e Ctrl+S.
Expected: notificação de erro "Falha ao salvar no servidor: ..." **e** o título volta a exibir `[UNSAVED]`. Subir o servidor de novo e salvar: expected "Saved to server", `[UNSAVED]` some, e o servidor recebe as mudanças (checar `version` via `curl`). Registrar.

- [ ] **Step 4: Commit**

```bash
git add src/electron.renderer/page/Editor.hx
git commit -m "fix(web): falha no flush mantém o projeto marcado como não-salvo"
```

---

### Task 3: Conflito 409 com diálogo acionável

**Files:**
- Modify: `src/electron.renderer/page/Editor.hx` (novo método `onWebSaveConflict`)

**Interfaces:**
- Consumes: `ui.modal.dialog.Choice`, `ET.reloadWindow()`.
- Produces: `function onWebSaveConflict():Void` (web-only) — abre um `Choice` explicando que o projeto mudou no servidor, com duas opções: **"Recarregar do servidor"** (descarta as alterações locais e recarrega a página) e **"Continuar editando"** (fecha o diálogo; o projeto segue marcado como não-salvo).

- [ ] **Step 1: Conferir a API do `Choice`**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && grep -n "public function new" src/electron.renderer/ui/modal/dialog/Choice.hx`
Expected: assinatura no formato `new(str:LocaleString, ?choices:Array<{label:String, cb:Void->Void, ?className:String}>, ?canCancel:Bool)` — confirmar os nomes reais dos campos antes de escrever o código do próximo passo (o LDtk usa `{ label, cb, className }` em `onSave`, ver o branch "sample" do próprio `onSave`).

- [ ] **Step 2: Adicionar `onWebSaveConflict` no `Editor.hx`**

Adicionar o método junto aos demais métodos web-only do `Editor` (por exemplo, logo após `onSave`):

```haxe
	#if web
	/** O servidor rejeitou o save porque o projeto mudou lá (ETag/If-Match).
		Sem merge automático: o usuário escolhe descartar o local ou seguir editando. **/
	function onWebSaveConflict() {
		new ui.modal.dialog.Choice(
			Lang.t._("O projeto foi modificado no servidor desde que você o abriu.\nSalvar agora sobrescreveria essas mudanças, então o salvamento foi cancelado."),
			[
				{
					label: L.untranslated("Recarregar do servidor (descarta suas alterações)"),
					className: "gray",
					cb: () -> ET.reloadWindow(),
				},
				{
					label: L.untranslated("Continuar editando"),
					cb: () -> {},
				},
			]
		);
	}
	#end
```

Se o Step 1 mostrar assinatura diferente, adaptar mantendo as duas opções e os mesmos textos.

- [ ] **Step 3: Compilar web e desktop**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5 && haxe renderer.hxml 2>&1 | grep -vE "WDeprecated" | tail -3`
Expected: ambos compilam sem erros.

- [ ] **Step 4: Verificação manual — conflito real de versão**

Com o editor aberto no projeto `demo`, alterar o projeto **pelo servidor** por fora (simulando outro cliente), o que incrementa a versão:
```bash
V=$(curl -s localhost:4477/api/project/demo/bundle | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).version)")
curl -s -X PUT localhost:4477/api/project/demo/manifest -H 'Content-Type: application/json' -H "If-Match: $V" -d '{"tocado":"por outro cliente"}' -o /dev/null -w "bump: %{http_code}\n"
```
Então, no editor, fazer uma alteração e Ctrl+S.
Expected: aparece o diálogo de conflito com as duas opções; o título continua `[UNSAVED]`; o servidor **não** foi sobrescrito (conferir que o manifesto ainda é o `{"tocado":...}` via `curl`). Registrar.

- [ ] **Step 5: Commit**

```bash
git add src/electron.renderer/page/Editor.hx
git commit -m "feat(web): diálogo acionável no conflito 409 (recarregar ou continuar)"
```

---

### Task 4: Erro de upload sem `window.alert`

**Files:**
- Modify: `srcweb/web/WebImagePicker.hx`

**Interfaces:**
- Consumes: `ui.Notification` (alias global `N` **não** existe em `srcweb/` — usar o nome completo `ui.Notification.error`).
- Produces: falha de upload passa a usar a notificação padrão do editor em vez de `window.alert`, mantendo o projeto intacto (nenhuma referência é gravada).

- [ ] **Step 1: Trocar o `alert` por notificação**

Em `srcweb/web/WebImagePicker.hx`, substituir:
```haxe
					(err) -> js.Browser.window.alert("Falha no upload: " + err)
```
por:
```haxe
					(err) -> ui.Notification.error("Falha ao enviar a imagem: " + err)
```

- [ ] **Step 2: Compilar**

Run: `cd /Users/afonsof/Projects/emocre/ldtk && haxe renderer.web.hxml 2>&1 | grep -vE "WDeprecated" | tail -5`
Expected: compila sem erros. Se `ui.Notification` não resolver a partir de `srcweb/` (o pacote `ui` vive em `src/electron.renderer/`, que está no mesmo classpath do build), o erro apontará isso — nesse caso, manter a chamada por caminho completo já usado no editor.

- [ ] **Step 3: Verificação manual — upload com servidor fora do ar**

Com o editor aberto, **parar o servidor**. Disparar um upload pelo mesmo caminho HTTP do picker:
```js
// no console da página
var f=new FormData(); f.append('file', new Blob([new Uint8Array([1,2,3])],{type:'image/png'}), 'x.png');
var x=new XMLHttpRequest(); x.open('POST','http://localhost:4477/api/project/demo/images',true);
x.onerror=function(){console.log('erro de rede (esperado)')}; x.send(f);
```
Expected: a requisição falha (servidor fora), e o caminho de erro do picker mostraria a notificação — confirmar que **nenhum** `window.alert` bloqueia a página e que o editor segue utilizável. Registrar.

- [ ] **Step 4: Commit**

```bash
git add srcweb/web/WebImagePicker.hx
git commit -m "fix(web): erro de upload usa notificação em vez de window.alert"
```

---

## Implementation notes (execução)

Executado inline; as quatro falhas foram simuladas de verdade (servidor derrubado, porta errada, versão adulterada por fora).

- **Task 1**: verificada apontando para uma porta sem servidor → tela bloqueante com o detalhe do erro; e o **retry funciona sem reload** (subi o servidor, cliquei "Tentar de novo", o editor abriu).
- **Descoberta durante a Task 2 (fora do plano, corrigida):** `onComplete` do `onSave` rodava **antes** do flush assíncrono terminar. No fluxo "salvar antes de sair", isso levava o usuário para a Home mesmo com o save falhando — trabalho não persistido e contexto perdido. Agora, no web, `onComplete` só roda no sucesso do flush; em caso de erro a ação pendente é **abortada**. Verificado: com o servidor fora, "fechar projeto → YES" mantém o editor aberto.
- **Task 3**: conflito real reproduzido (outro cliente fez `PUT` e subiu a versão) → diálogo de conflito, editor preservado, `[UNSAVED]` mantido, e o **servidor não foi sobrescrito** (manifesto do "outro cliente" intacto).
- **Task 4**: `window.alert` removido; `grep` confirma que não há mais nenhum em `srcweb/`.
- Builds: web e desktop compilam; interp 17/17; servidor 38/38.

**Nota de teste:** no ambiente headless o Ctrl+S sintético é engolido quando há modal aberto (`isLocked()`), o que é o comportamento correto do editor. Os testes de save usaram o botão "YES" do diálogo de alterações não salvas, que exercita o mesmo `onSave`.

## Self-Review

**Spec coverage** (tabela de erros do design + issue #13):
- `loadBundle` falha → tela bloqueante + retry: Task 1. ✓
- `flush` falha → dirty preservado (já era) **e** estado da UI honesto (`[UNSAVED]` volta): Task 2. ✓
- `flush` 409 → aviso acionável, sem merge automático: Task 3. ✓
- `uploadImage` falha → aborta só aquele import, projeto intacto, sem bloquear: Task 4. ✓

**Placeholder scan:** sem "TBD"/"TODO". A Task 3 Step 1 é uma checagem de API real (não placeholder) porque a assinatura do `Choice` precisa ser confirmada no código antes de escrever a chamada — o passo diz exatamente o que verificar e o que fazer com o resultado. A nota de ordem entre Tasks 2 e 3 é explícita para quem executar fora de ordem.

**Type consistency:** `WebErrorScreen.show(title, detail, ?onRetry)` / `.clear()` usados por `App.startWebBoot()`. `startWebBoot()` é público e se auto-referencia no retry. `onWebSaveConflict()` (Task 3) é chamado pelo callback de erro do flush (Task 2) — dependência declarada nas duas tasks. `ProjectTransport.flush(onOk, onError)` e `setProjectVPath` já existem.

**Risco declarado:** a Task 4 não consegue acionar o `input.click()` do picker em ambiente headless (mesma limitação registrada no marco anterior), então a verificação exercita o caminho HTTP e confirma a ausência de `alert`; a validação do fluxo visual completo do picker continua pendente de um teste manual em navegador real.
