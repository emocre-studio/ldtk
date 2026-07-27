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
