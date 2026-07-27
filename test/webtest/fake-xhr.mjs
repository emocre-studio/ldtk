// XHR falso + servidor falso em memória, espelhando o contrato do servidor real
// (server/README.md). Resolve sincronamente para tornar os testes determinísticos.

export function makeFakeServer() {
	const server = {
		version: 0,
		manifest: { blank: true },
		levels: {},            // iid -> json
		images: {},            // id -> { name, bytes, pxWid, pxHei }
		requests: [],          // log para asserções
		imageSeq: 0,
		// injeta mudança "por outro cliente" (para testar 409)
		bumpExternally() { this.version++; },
	};

	server.handle = function (method, url, headers, body, responseType) {
		const path = url.replace(/^https?:\/\/[^/]+/, "");
		const ifMatch = headers["If-Match"];
		server.requests.push({ method, path, ifMatch });

		const mBundle = path.match(/^\/api\/project\/([^/]+)\/bundle$/);
		const mManifest = path.match(/^\/api\/project\/([^/]+)\/manifest$/);
		const mLevel = path.match(/^\/api\/project\/([^/]+)\/level\/([^/]+)$/);
		const mImages = path.match(/^\/api\/project\/([^/]+)\/images$/);
		const mImage = path.match(/^\/api\/project\/([^/]+)\/images\/([^/]+)$/);

		const needMatch = () => {
			if (ifMatch === undefined) return { status: 428, body: JSON.stringify({ error: "precondition", code: "precondition_required" }) };
			if (String(ifMatch) !== String(server.version)) return { status: 409, body: JSON.stringify({ error: "conflict", code: "version_conflict" }) };
			return null;
		};

		if (method === "GET" && mBundle) {
			return {
				status: 200,
				body: JSON.stringify({
					version: String(server.version),
					manifest: server.manifest,
					levels: server.levels,
					images: Object.entries(server.images).map(([id, i]) => ({
						id, name: i.name, pxWid: i.pxWid, pxHei: i.pxHei,
						url: `/api/project/p/images/${id}`,
					})),
				}),
			};
		}
		if (method === "PUT" && mManifest) {
			const bad = needMatch(); if (bad) return bad;
			server.manifest = JSON.parse(body);
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
		if (method === "PUT" && mLevel) {
			const bad = needMatch(); if (bad) return bad;
			server.levels[mLevel[2]] = JSON.parse(body);
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
		if (method === "DELETE" && mLevel) {
			const bad = needMatch(); if (bad) return bad;
			if (!(mLevel[2] in server.levels))
				return { status: 404, body: JSON.stringify({ error: "not found", code: "level_not_found" }) };
			delete server.levels[mLevel[2]];
			server.version++;
			return { status: 200, body: JSON.stringify({ version: String(server.version) }) };
		}
		if (method === "POST" && mImages) {
			const id = "img_fake_" + (++server.imageSeq);
			server.images[id] = { name: "up.png", bytes: new Uint8Array([1, 2, 3]), pxWid: 2, pxHei: 3 };
			return {
				status: 201,
				body: JSON.stringify({ id, name: "up.png", pxWid: 2, pxHei: 3, url: `/api/project/p/images/${id}` }),
			};
		}
		if (method === "GET" && mImage) {
			const img = server.images[mImage[2]];
			if (!img) return { status: 404, body: "" };
			return { status: 200, body: "", arrayBuffer: img.bytes.buffer };
		}
		return { status: 404, body: JSON.stringify({ error: "no route", code: "not_found" }) };
	};

	return server;
}

export function installFakeXhr(server) {
	class FakeXhr {
		constructor() {
			this.readyState = 0;
			this.status = 0;
			this.responseText = "";
			this.response = null;
			this.responseType = "";
			this.onreadystatechange = null;
			this.onerror = null;
			this._headers = {};
		}
		open(method, url) { this._method = method; this._url = url; this.readyState = 1; }
		setRequestHeader(k, v) { this._headers[k] = v; }
		overrideMimeType() {}
		send(body) {
			const res = server.handle(this._method, this._url, this._headers, body, this.responseType);
			this.status = res.status;
			this.responseText = res.body || "";
			this.response = this.responseType === "arraybuffer" ? (res.arrayBuffer || null) : this.responseText;
			this.readyState = 4;
			if (this.onreadystatechange) this.onreadystatechange();
		}
	}
	globalThis.XMLHttpRequest = FakeXhr;
}
