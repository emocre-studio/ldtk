import { defineConfig } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "..", "app", "assets", "js", "renderer.web.js");
if (!existsSync(BUILD))
	throw new Error(
		"Build web ausente: " + BUILD +
		"\nRode `haxe renderer.web.hxml` na raiz do repo antes dos testes e2e."
	);

const STORAGE = mkdtempSync(join(tmpdir(), "ldtk-e2e-"));

export default defineConfig({
	testDir: ".",
	timeout: 90_000,
	expect: { timeout: 20_000 },
	fullyParallel: false,
	workers: 1,
	use: {
		channel: "chrome",
		baseURL: "http://localhost:8100",
	},
	webServer: [
		{
			command: "npm start",
			cwd: join(HERE, "..", "server"),
			env: { PORT: "4488", STORAGE_DIR: STORAGE },
			url: "http://localhost:4488/health",
			reuseExistingServer: false,
			stdout: "pipe",
		},
		{
			command: "node static-server.mjs",
			cwd: HERE,
			env: { PORT: "8100" },
			url: "http://localhost:8100/web.html",
			reuseExistingServer: false,
			stdout: "pipe",
		},
	],
});
