package web;

/** Substituto browser do dn.js.NodeTools (aliased como NT em import.hx sob #if web). */
class WebFS {
	public static var fs(default,null) : VirtualFS = new VirtualFS();

	/** Reinicia o VFS (usado no início do carregamento de um projeto e em testes). */
	public static function reset() {
		fs = new VirtualFS();
	}

	/**
		Project files live in the in-memory VFS (written by ProjectTransport).
		The app ALSO reads its own bundled asset files (UI templates, etc.) via NT,
		e.g. "./assets/tpl/pages/editor.html". Those are served as static files, so
		for a path not in the VFS we fetch it once via a synchronous XHR (NT's read
		API is synchronous by contract) and cache it in the VFS.
	**/
	static function tryFetchIntoVfs(path:String) : Bool {
		if( fs.exists(path) )
			return true;
		#if js
		try {
			var xhr = new js.html.XMLHttpRequest();
			xhr.open("GET", path, false); // synchronous
			xhr.overrideMimeType("text/plain; charset=x-user-defined");
			xhr.send();
			if( xhr.status>=200 && xhr.status<300 ) {
				// x-user-defined maps each raw byte to a char in 0x00..0xFF
				var raw = xhr.responseText;
				var b = haxe.io.Bytes.alloc(raw.length);
				for( i in 0...raw.length )
					b.set(i, raw.charCodeAt(i) & 0xFF);
				fs.writeBytes(path, b);
				fs.clearDirty(); // app assets are not user edits
				return true;
			}
		}
		catch(_:Dynamic) {}
		#end
		return false;
	}

	public static function fileExists(path:String) : Bool
		return fs.exists(path) || tryFetchIntoVfs(path);

	public static function readFileString(path:String) : String {
		tryFetchIntoVfs(path);
		return fs.readString(path);
	}

	public static function readFileBytes(path:String) : haxe.io.Bytes {
		tryFetchIntoVfs(path);
		return fs.readBytes(path);
	}
	public static function writeFileString(path:String, str:String) : Void fs.writeString(path, str);
	public static function writeFileBytes(path:String, bytes:haxe.io.Bytes) : Void fs.writeBytes(path, bytes);
	public static function readDir(path:String) : Array<String> return fs.readDir(path);
	public static function createDirs(path:String) : Void fs.createDirs(path);
	public static function removeDir(path:String) : Void fs.removeDir(path);
	public static function removeFile(path:String) : Void fs.removeFile(path);
	public static function renameFile(from:String, to:String) : Bool { fs.rename(from, to); return true; }
	public static function isDirectory(path:String) : Bool return fs.isDir(path);
	public static function dirContainsAnyFile(path:String) : Bool return fs.dirHasAnyFile(path);
	public static function checkPermissions(path:String, read:Bool, write:Bool, ?exec:Bool) : Bool return true;
	public static function isWindows() : Bool return false;
}
