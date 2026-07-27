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
