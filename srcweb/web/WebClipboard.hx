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
