package web;

class ProjectTransport {
	public static var projectId : String;
	public static var apiBaseUrl : String;
	public static var version : String = "0";
	public static var serverLevelIids : Array<String> = [];

	public static function loadBundle(projectId:String, apiBaseUrl:String, onOk:String->Void, onError:String->Void) : Void {
		ProjectTransport.projectId = projectId;
		ProjectTransport.apiBaseUrl = apiBaseUrl;
		var url = apiBaseUrl + "/api/project/" + projectId + "/bundle";
		var xhr = new js.html.XMLHttpRequest();
		xhr.open("GET", url, true);
		xhr.onreadystatechange = function() {
			if( xhr.readyState != 4 ) return;
			if( xhr.status < 200 || xhr.status >= 300 ) {
				onError('HTTP ${xhr.status} ao carregar $url');
				return;
			}
			try {
				var bundle = haxe.Json.parse(xhr.responseText);
				version = bundle.version != null ? Std.string(bundle.version) : "0";
				serverLevelIids = bundle.levels != null ? Reflect.fields(bundle.levels) : [];
				populate(bundle);
				onOk("/web/project.ldtk");
			} catch( e:Dynamic ) {
				onError("Falha ao processar bundle: " + Std.string(e));
			}
		}
		xhr.onerror = function(_) onError('Erro de rede ao carregar $url');
		xhr.send();
	}

	static function sendJson(method:String, path:String, body:String, onOk:String->Void, onError:String->Void) {
		var xhr = new js.html.XMLHttpRequest();
		xhr.open(method, apiBaseUrl + path, true);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.setRequestHeader("If-Match", version);
		xhr.onreadystatechange = function() {
			if( xhr.readyState != 4 ) return;
			if( xhr.status == 409 ) { onError("conflict"); return; }
			if( xhr.status < 200 || xhr.status >= 300 ) { onError('HTTP ${xhr.status} em $method $path'); return; }
			try {
				var r = haxe.Json.parse(xhr.responseText);
				if( r.version != null ) version = Std.string(r.version);
			} catch(_:Dynamic) {}
			onOk(xhr.responseText);
		}
		xhr.onerror = function(_) onError('Erro de rede em $method $path');
		xhr.send(body);
	}

	public static function flush(onOk:Void->Void, onError:String->Void) : Void {
		var manifestJson = WebFS.fs.readString("/web/project.ldtk");
		var manifest : Dynamic = haxe.Json.parse(manifestJson);

		// Descobrir iids atuais e níveis alterados (dirty)
		var currentIids : Array<String> = [];
		var levelPuts : Array<{ iid:String, body:String }> = [];
		function scanLevel(l:Dynamic) {
			if( l==null || l.iid==null ) return;
			var iid = Std.string(l.iid);
			currentIids.push(iid);
			if( manifest.externalLevels==true && l.externalRelPath!=null ) {
				var vpath = "/web/" + Std.string(l.externalRelPath);
				if( WebFS.fs.dirty.exists(vpath) && WebFS.fs.exists(vpath) )
					levelPuts.push({ iid: iid, body: WebFS.fs.readString(vpath) });
			}
		}
		if( manifest.worlds!=null )
			for( w in (cast manifest.worlds:Array<Dynamic>) )
				if( w.levels!=null ) for( l in (cast w.levels:Array<Dynamic>) ) scanLevel(l);
		if( manifest.levels!=null )
			for( l in (cast manifest.levels:Array<Dynamic>) ) scanLevel(l);

		// Deletes: níveis que o servidor tinha e não existem mais
		var deletes : Array<String> = [];
		for( iid in serverLevelIids )
			if( currentIids.indexOf(iid) < 0 ) deletes.push(iid);

		var base = "/api/project/" + projectId;
		// Sequência: manifest, depois PUTs de nível, depois DELETEs
		function runDeletes(i:Int) {
			if( i >= deletes.length ) {
				serverLevelIids = currentIids;
				WebFS.fs.clearDirty();
				onOk();
				return;
			}
			var xhr = new js.html.XMLHttpRequest();
			xhr.open("DELETE", apiBaseUrl + base + "/level/" + deletes[i], true);
			xhr.setRequestHeader("If-Match", version);
			xhr.onreadystatechange = function() {
				if( xhr.readyState!=4 ) return;
				if( xhr.status==409 ) { onError("conflict"); return; }
				if( xhr.status>=200 && xhr.status<300 ) {
					try { var r = haxe.Json.parse(xhr.responseText); if(r.version!=null) version = Std.string(r.version); } catch(_:Dynamic) {}
					runDeletes(i+1);
				} else onError('HTTP ${xhr.status} em DELETE');
			}
			xhr.onerror = function(_) onError("Erro de rede em DELETE");
			xhr.send();
		}
		function runLevels(i:Int) {
			if( i >= levelPuts.length ) { runDeletes(0); return; }
			sendJson("PUT", base + "/level/" + levelPuts[i].iid, levelPuts[i].body,
				(_) -> runLevels(i+1), onError);
		}
		sendJson("PUT", base + "/manifest", manifestJson, (_) -> runLevels(0), onError);
	}

	public static function uploadImage(bytes:haxe.io.Bytes, name:String,
		onOk:(img:{id:String,name:String,url:String,pxWid:Int,pxHei:Int})->Void, onError:String->Void) : Void {
		var form = new js.html.FormData();
		var arr = new js.lib.Uint8Array(bytes.getData());
		var blob = new js.html.Blob([arr]);
		form.append("file", blob, name);
		var xhr = new js.html.XMLHttpRequest();
		xhr.open("POST", apiBaseUrl + "/api/project/" + projectId + "/images", true);
		xhr.onreadystatechange = function() {
			if( xhr.readyState!=4 ) return;
			if( xhr.status<200 || xhr.status>=300 ) { onError('HTTP ${xhr.status} no upload'); return; }
			try {
				var r = haxe.Json.parse(xhr.responseText);
				onOk({ id:Std.string(r.id), name:Std.string(r.name), url:Std.string(r.url), pxWid:r.pxWid, pxHei:r.pxHei });
			} catch(e:Dynamic) { onError("Resposta de upload inválida: "+Std.string(e)); }
		}
		xhr.onerror = function(_) onError("Erro de rede no upload");
		xhr.send(form);
	}

	static function populate(bundle:Dynamic) {
		WebFS.reset();
		var manifest = bundle.manifest;
		WebFS.writeFileString("/web/project.ldtk", haxe.Json.stringify(manifest));

		// Níveis externos: mapear iid -> externalRelPath a partir do manifesto
		if( manifest.externalLevels == true && bundle.levels != null ) {
			var byIid : Map<String,Dynamic> = new Map();
			for( iid in Reflect.fields(bundle.levels) )
				byIid.set(iid, Reflect.field(bundle.levels, iid));

			function writeLevel(l:Dynamic) {
				if( l == null || l.iid == null || l.externalRelPath == null ) return;
				var lvl = byIid.get(Std.string(l.iid));
				if( lvl == null ) return;
				WebFS.writeFileString("/web/" + Std.string(l.externalRelPath), haxe.Json.stringify(lvl));
			}

			if( manifest.worlds != null )
				for( w in (cast manifest.worlds : Array<Dynamic>) )
					if( w.levels != null )
						for( l in (cast w.levels : Array<Dynamic>) ) writeLevel(l);
			if( manifest.levels != null )
				for( l in (cast manifest.levels : Array<Dynamic>) ) writeLevel(l);
		}

		WebFS.fs.clearDirty();
	}
}
