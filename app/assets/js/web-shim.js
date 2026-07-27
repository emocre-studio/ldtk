// Browser shim for the LDtk web build.
// The compiled renderer emits top-level `require(...)` calls from Electron/Node
// externs (electron, fs, os, path, process, ...). On the web these modules are
// never actually *called* at runtime (their call sites are guarded by `#if web`),
// but the top-level `var X = require("...")` still executes at boot, so `require`
// must exist and return something non-throwing. Real browser libraries
// (CodeMirror, Sortable) are loaded as globals via <script> before this file.
(function () {
	function noop() {}

	// Keep the Heaps render loop alive when the tab is hidden/backgrounded.
	// Browsers pause requestAnimationFrame entirely for hidden tabs, which would
	// freeze the editor loop; fall back to setTimeout while hidden.
	(function () {
		var realRaf = window.requestAnimationFrame.bind(window);
		window.requestAnimationFrame = function (cb) {
			if (document.hidden) return window.setTimeout(function () { cb(performance.now()); }, 16);
			return realRaf(cb);
		};
	})();

	// Globals referenced directly (not via require) by hxnodejs/Heaps code.
	window.global = window.global || window;

	// Minimal Node Buffer polyfill. haxe.io.Bytes on the plain-js target is
	// ArrayBuffer-backed (not Buffer), so this only needs to satisfy node-interop
	// static inits (e.g. sys.io.File.copyBuf) and conversions — never the hot path.
	if (!window.Buffer) {
		var BufferShim = function () {};
		BufferShim.alloc = function (n) { return new Uint8Array(n); };
		BufferShim.from = function (x, enc) {
			if (typeof x === "string") return new TextEncoder().encode(x);
			if (x instanceof ArrayBuffer) return new Uint8Array(x);
			return new Uint8Array(x);
		};
		BufferShim.isBuffer = function () { return false; };
		BufferShim.concat = function (list) {
			var len = 0, i;
			for (i = 0; i < list.length; i++) len += list[i].length;
			var out = new Uint8Array(len), off = 0;
			for (i = 0; i < list.length; i++) { out.set(list[i], off); off += list[i].length; }
			return out;
		};
		window.Buffer = BufferShim;
	}
	// Virtual clock: when the tab is hidden the browser throttles the loop to
	// ~1fps, which makes Heaps' frame dt exceed maxDeltaTime and clamp to 0
	// (freezing all timers). While hidden we advance a virtual clock in fixed
	// ~1/60s steps so the editor keeps progressing; when visible we use the real
	// high-res clock.
	var virtualClock = 0;
	function nowSeconds() {
		if (document.hidden) { virtualClock += 1 / 60; return virtualClock; }
		return (typeof performance !== "undefined" ? performance.now() : Date.now()) * 1e-3;
	}
	window.process = window.process || {
		platform: "browser", argv: [], env: {}, version: "", versions: {},
		cwd: function () { return "/"; }, on: noop, nextTick: function (f) { setTimeout(f, 0); },
		hrtime: function (prev) {
			var now = nowSeconds();
			var s = Math.floor(now);
			var ns = Math.floor((now - s) * 1e9);
			if (prev) {
				var ds = s - prev[0], dns = ns - prev[1];
				if (dns < 0) { ds--; dns += 1e9; }
				return [ds, dns];
			}
			return [s, ns];
		}
	};

	var stubs = {
		"fs": {},
		"path": {
			sep: "/",
			join: function () { return Array.prototype.join.call(arguments, "/"); },
			dirname: function (p) { return String(p).replace(/\/[^\/]*$/, ""); },
			basename: function (p) { return String(p).split("/").pop(); },
			extname: function (p) { var m = /\.[^.\/]+$/.exec(String(p)); return m ? m[0] : ""; },
			resolve: function () { return Array.prototype.join.call(arguments, "/"); }
		},
		"os": {
			platform: function () { return "browser"; },
			homedir: function () { return "/"; },
			tmpdir: function () { return "/tmp"; },
			EOL: "\n"
		},
		"process": window.process,
		"buffer": { Buffer: window.Buffer || function () {} },
		"child_process": {},
		"https": {},
		"http": {},
		"zlib": {
			// backed by pako (loaded as a global before this shim); used by
			// haxe.zip.Uncompress to decompress embedded assets at boot.
			inflateSync: function (buf) { return window.pako.inflate(buf); },
			inflateRawSync: function (buf) { return window.pako.inflateRaw(buf); },
			deflateSync: function (buf) { return window.pako.deflate(buf); }
		},
		"timers": {
			setTimeout: window.setTimeout.bind(window),
			setInterval: window.setInterval.bind(window),
			clearTimeout: window.clearTimeout.bind(window),
			clearInterval: window.clearInterval.bind(window)
		},
		"electron": {
			// deepnightLibs' ElectronTools calls ipcRenderer.sendSync(channel) for
			// window/app info even in the renderer; answer with browser values.
			ipcRenderer: {
				on: noop, once: noop, send: noop,
				invoke: function () { return Promise.resolve(); },
				sendSync: function (channel) {
					switch (channel) {
						case "getUserDataDir": return "/";
						case "getAppResourceDir": return "./";
						case "getLogDir": return "./";
						case "getExeDir": return "./";
						case "getScreenWidth": return window.innerWidth;
						case "getScreenHeight": return window.innerHeight;
						case "getPixelRatio": return window.devicePixelRatio || 1;
						case "isFullScreen": return false;
						case "isDevToolsOpened": return false;
						case "getRawArgs": return [];
						default: return null;
					}
				}
			},
			remote: {}, shell: {}, webFrame: { setZoomFactor: noop, getZoomFactor: function () { return 1; } }
		},
		"electron-updater": { autoUpdater: { on: noop } },
		"insert-css": function () { return {}; }
	};

	window.require = function (name) {
		if (name === "codemirror") return window.CodeMirror;
		if (name === "sortablejs") return window.Sortable;
		if (name === "simple-color-picker") return window.SimpleColorPicker || function () {};
		if (name && name.indexOf("codemirror/") === 0) return {}; // addons (applied to global CodeMirror on demand)
		if (Object.prototype.hasOwnProperty.call(stubs, name)) return stubs[name];
		console.warn("[web-shim] unstubbed require: " + name);
		return {};
	};
})();
