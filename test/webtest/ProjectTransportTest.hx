package webtest;

class ProjectTransportTest {
	static var pass = 0;
	static var fail = 0;

	static function log(s:String) js.Browser.console.log(s);

	static function check(name:String, cond:Bool) {
		if( cond ) pass++;
		else { fail++; log('FAIL: $name'); }
	}

	static function server() : Dynamic return untyped __js__("globalThis.__fakeServer");

	static function setServer(manifest:Dynamic, levels:Dynamic, version:Int) {
		var s = server();
		s.manifest = manifest;
		s.levels = levels;
		s.version = version;
		s.requests = untyped __js__("[]");
	}

	static function requestPaths() : Array<String> {
		var out = [];
		var reqs : Array<Dynamic> = server().requests;
		for( r in reqs ) out.push(Std.string(r.method) + " " + Std.string(r.path));
		return out;
	}

	static function main() {
		var api = "http://fake";

		// --- 1. loadBundle simples popula o VFS e guarda a versão
		setServer({ hello:"world" }, {}, 3);
		var loadedPath : String = null;
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->log("unexpected error: "+e));
		check("loadBundle chamou onOk", loadedPath != null);
		check("manifesto no VFS", web.WebFS.fs.exists(loadedPath));
		check("version guardada", web.ProjectTransport.version == "3");

		// --- 2. níveis externos: paths e projectVPath derivado do dir
		var extManifest = {
			externalLevels: true,
			levels: untyped __js__("[{ iid:'A', externalRelPath:'MyProj/L0.ldtkl' }, { iid:'B', externalRelPath:'MyProj/L1.ldtkl' }]"),
		};
		setServer(extManifest, untyped __js__("{ A:{ n:0 }, B:{ n:1 } }"), 0);
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->log("unexpected error: "+e));
		check("projectVPath deriva do dir dos níveis", loadedPath == "/web/MyProj.ldtk");
		check("nível A no VFS", web.WebFS.fs.exists("/web/MyProj/L0.ldtkl"));
		check("nível B no VFS", web.WebFS.fs.exists("/web/MyProj/L1.ldtkl"));
		check("dirty limpo após load", !web.WebFS.fs.dirty.exists("/web/MyProj/L0.ldtkl"));

		// --- 3. flush envia manifesto + SÓ os níveis sujos, encadeando If-Match
		web.WebFS.fs.writeString("/web/MyProj/L1.ldtkl", "{\"n\":99}"); // suja só o L1
		var flushOk = false;
		web.ProjectTransport.flush(()->flushOk = true, (e)->log("flush error: "+e));
		check("flush completou", flushOk);
		var paths = requestPaths();
		check("flush enviou manifesto", paths.indexOf("PUT /api/project/p/manifest") >= 0);
		check("flush enviou o nível sujo (B)", paths.indexOf("PUT /api/project/p/level/B") >= 0);
		check("flush NÃO enviou o nível limpo (A)", paths.indexOf("PUT /api/project/p/level/A") < 0);
		check("dirty limpo após flush", !web.WebFS.fs.dirty.exists("/web/MyProj/L1.ldtkl"));

		// --- 4. flush deleta nível que sumiu do manifesto
		var oneLevel = {
			externalLevels: true,
			levels: untyped __js__("[{ iid:'A', externalRelPath:'MyProj/L0.ldtkl' }]"),
		};
		setServer(oneLevel, untyped __js__("{ A:{ n:0 }, B:{ n:1 } }"), 0);
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->{});
		// servidor tinha A e B; manifesto agora só tem A => B deve ser deletado
		web.ProjectTransport.flush(()->{}, (e)->log("flush error: "+e));
		check("flush deletou o nível removido", requestPaths().indexOf("DELETE /api/project/p/level/B") >= 0);

		// --- 5. conflito de versão => onError("conflict") e dirty preservado
		setServer({ a:1 }, {}, 0);
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->{});
		web.WebFS.fs.writeString(loadedPath, "{\"a\":2}"); // suja o manifesto
		server().bumpExternally();                        // outro cliente mexeu
		var conflictErr : String = null;
		web.ProjectTransport.flush(()->{}, (e)->conflictErr = e);
		check("conflito reportado", conflictErr == "conflict");
		check("dirty preservado no conflito", web.WebFS.fs.dirty.exists(loadedPath));

		// --- 6. uploadImage
		var uploaded : Dynamic = null;
		web.ProjectTransport.uploadImage(
			haxe.io.Bytes.ofString("png"), "tiles.png", "image/png",
			(img)->uploaded = img,
			(e)->log("upload error: "+e)
		);
		check("upload retornou id", uploaded != null && StringTools.startsWith(Std.string(uploaded.id), "img_"));
		check("upload retornou dimensões", uploaded != null && uploaded.pxWid == 2 && uploaded.pxHei == 3);

		// --- 7. referencedImageIds extrai ids de tilesets e de bg de nível
		var manifestWithImgs : Dynamic = untyped __js__("({ defs:{ tilesets:[{relPath:'images/img_a.png'},{relPath:'images/img_b.gif'}] }, levels:[{ bgRelPath:'images/img_c.png' }] })");
		var ids = web.ProjectTransport.referencedImageIds(manifestWithImgs);
		ids.sort(Reflect.compare);
		check("extrai ids de tilesets e bg", ids.join(",") == "img_a,img_b,img_c");

		// --- 8. paths fora do padrão images/<id>.<ext> são ignorados
		var manifestOdd : Dynamic = untyped __js__("({ defs:{ tilesets:[{relPath:'../tiles/foo.png'},{relPath:null}] }, levels:[{ bgRelPath:'images/img_ok.png' }] })");
		var ids2 = web.ProjectTransport.referencedImageIds(manifestOdd);
		check("ignora paths fora do padrão", ids2.join(",") == "img_ok");

		// --- 9. flush poda imagens não referenciadas, depois do manifesto
		setServer(untyped __js__("({ defs:{ tilesets:[{relPath:'images/img_keep.png'}] }, levels:[] })"), untyped __js__("{}"), 0);
		server().images = untyped __js__("{ img_keep:{name:'k.png'}, img_orphan:{name:'o.png'} }");
		web.ProjectTransport.loadBundle("p", api, (vp)->loadedPath = vp, (e)->{});
		web.WebFS.fs.writeString(loadedPath, web.WebFS.fs.readString(loadedPath)); // marca sujo
		web.ProjectTransport.flush(()->{}, (e)->log("flush error: "+e));
		var paths2 = requestPaths();
		check("prune veio depois do manifesto",
			paths2.indexOf("POST /api/project/p/images/prune") > paths2.indexOf("PUT /api/project/p/manifest"));
		check("órfã removida no servidor", !Reflect.hasField(server().images, "img_orphan"));
		check("referenciada preservada", Reflect.hasField(server().images, "img_keep"));

		log('ProjectTransport: $pass passed, $fail failed');
		untyped __js__("process.exit({0})", fail == 0 ? 0 : 1);
	}
}
