// Servidor estático mínimo para a pasta app/ (onde vive web.html + assets/).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "app");
const PORT = Number(process.env.PORT ?? 8100);

const TYPES = {
	".html": "text/html", ".js": "text/javascript", ".css": "text/css",
	".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml",
	".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

createServer(async (req, res) => {
	try {
		const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
		const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
		const file = join(ROOT, safe);
		if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }
		const data = await readFile(file);
		res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
		res.end(data);
	} catch {
		res.writeHead(404).end("not found");
	}
}).listen(PORT, () => console.log(`static on :${PORT} (root ${ROOT})`));
