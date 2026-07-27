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
