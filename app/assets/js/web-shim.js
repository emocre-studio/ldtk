// Browser shim for the LDtk web build.
//
// O build web não usa mais `-lib electron` nem `-lib hxnodejs`, então os stubs
// de fs/os/path/process/Buffer/zlib/electron deixaram de ser necessários.
//
// O que resta é apenas `require()`: os externs de UI (CodeMirror, SortableJS,
// simple-color-picker) são declarados com @:jsRequire, e o Haxe emite a chamada
// no init do módulo. As libs reais são carregadas como globais por <script>
// antes deste arquivo.
//
// NOTA sobre abas em segundo plano: o navegador congela requestAnimationFrame
// em abas ocultas, então o editor pausa e retoma ao voltar (comportamento
// normal de app web). Um editor JÁ CARREGADO se recupera sozinho; o que não
// funciona é *carregar* a página numa aba oculta, porque o delta do primeiro
// frame estoura o limite do Heaps e o dt nunca chega a inicializar.
// Já existiu aqui um "relógio virtual" que sobrescrevia Date.now() para
// contornar isso — foi removido: era um workaround para o ambiente de teste
// headless (hoje coberto pelo Playwright) e sobrescrever Date.now globalmente
// afeta todo o app. Não reintroduzir sem necessidade real de produto.
(function () {
	window.require = function (name) {
		if (name === "codemirror") return window.CodeMirror;
		if (name === "sortablejs") return window.Sortable;
		if (name === "simple-color-picker") return window.SimpleColorPicker || function () {};
		if (name && name.indexOf("codemirror/") === 0) return {}; // addons opcionais
		console.warn("[web-shim] unstubbed require: " + name);
		return {};
	};
})();
