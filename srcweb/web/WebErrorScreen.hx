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
