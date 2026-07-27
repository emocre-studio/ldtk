package web;

class WebConfig {
	static function raw() : Dynamic {
		return Reflect.field(js.Browser.window, "LDTK_CONFIG");
	}

	public static function projectId() : String {
		var c = raw();
		return c != null && c.projectId != null ? Std.string(c.projectId) : null;
	}

	public static function apiBaseUrl() : String {
		var c = raw();
		var u = c != null && c.apiBaseUrl != null ? Std.string(c.apiBaseUrl) : "";
		while( StringTools.endsWith(u, "/") ) u = u.substr(0, u.length - 1);
		return u;
	}
}
