package web;

/** Substituto browser do electron.Shell (aliased como SHELL em import.hx). **/
class WebShell {
	public static function openExternal(url:String) {
		js.Browser.window.open(url, "_blank");
	}
}
