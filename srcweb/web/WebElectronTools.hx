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

	// chamados por Progress/App via ET (no browser não há janela nativa a controlar)
	public static function hideWindow() : Void {}
	public static function minimize() : Void {}
	public static function isThrottlingEnabled() : Bool return false;
	public static function disableThrottling() : Void {}
	public static function enableThrottling() : Void {}
	public static function getUserDataDir() : String return "/";
}
