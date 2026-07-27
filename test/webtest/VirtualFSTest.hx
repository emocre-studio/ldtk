package webtest;

import web.VirtualFS;

class VirtualFSTest {
	static var pass = 0;
	static var fail = 0;

	static function check(name:String, cond:Bool) {
		if( cond ) { pass++; }
		else { fail++; Sys.println('FAIL: $name'); }
	}

	static function main() {
		var fs = new VirtualFS();

		// write + read round-trip
		fs.writeString("/web/project.ldtk", "{\"a\":1}");
		check("exists after write", fs.exists("/web/project.ldtk"));
		check("read round-trip", fs.readString("/web/project.ldtk") == "{\"a\":1}");

		// missing file
		check("missing not exists", !fs.exists("/web/nope"));

		// implicit parent dir
		check("parent is dir", fs.isDir("/web"));
		check("not a file dir", !fs.isDir("/web/project.ldtk"));

		// readDir lists immediate children
		fs.writeString("/web/levels/L0.ldtkl", "{}");
		fs.writeString("/web/levels/L1.ldtkl", "{}");
		var names = fs.readDir("/web/levels");
		names.sort(Reflect.compare);
		check("readDir children", names.join(",") == "L0.ldtkl,L1.ldtkl");
		check("dirHasAnyFile", fs.dirHasAnyFile("/web/levels"));

		// bytes round-trip
		var b = haxe.io.Bytes.ofString("hi");
		fs.writeBytes("/web/img.bin", b);
		check("bytes round-trip", fs.readBytes("/web/img.bin").toString() == "hi");

		// dirty tracking
		check("dirty marked", fs.dirty.exists("/web/project.ldtk"));
		fs.clearDirty();
		check("dirty cleared", !fs.dirty.exists("/web/project.ldtk"));
		fs.removeFile("/web/img.bin");
		check("remove marks dirty", fs.dirty.exists("/web/img.bin"));
		check("removed gone", !fs.exists("/web/img.bin"));

		// normalization (trailing slash / backslash)
		fs.writeString("/web/a/b.txt", "x");
		check("normalized dir", fs.isDir("/web/a/"));

		Sys.println('VirtualFS: $pass passed, $fail failed');
		Sys.exit(fail == 0 ? 0 : 1);
	}
}
