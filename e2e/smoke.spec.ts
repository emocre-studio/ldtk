import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "http://localhost:4488";
const SAMPLES = join(HERE, "..", "app", "extraFiles", "samples");

async function bundle(projectId: string) {
	const r = await fetch(`${API}/api/project/${projectId}/bundle`);
	return r.json();
}

/**
	Abre o editor e espera ele renderizar, fechando o changelog se aparecer.
	Obs.: `#page` não tem bounding box próprio (o conteúdo do editor é posicionado
	por cima do canvas), então o critério é "attached", não "visible".
*/
async function openEditor(page: Page, projectId: string, api = API) {
	await page.goto(`/web.html?p=${projectId}&api=${encodeURIComponent(api)}`);
	await page.waitForSelector("#page.editor", { state: "attached", timeout: 60_000 });
	// o "what's new" abre em perfil novo e bloqueia atalhos (isLocked)
	const close = page.locator(".window .close").first();
	if (await close.count()) await close.click({ force: true }).catch(() => {});
	await page.waitForTimeout(500);
}

async function save(page: Page) {
	await page.keyboard.press("ControlOrMeta+s");
}

test("abre o projeto do servidor e renderiza o editor", async ({ page }) => {
	await openEditor(page, "t-load");
	await expect(page.locator("#page.editor")).toBeAttached();
	await expect(page).toHaveTitle(/Level_0/);
});

test("salva no servidor e o estado persiste após reload", async ({ page }) => {
	const id = "t-save";
	expect((await bundle(id)).version).toBe("0");

	await openEditor(page, id);
	await save(page);
	await expect(page.locator(".notification", { hasText: "Saved to server" })).toBeAttached();

	const after = await bundle(id);
	expect(Number(after.version)).toBeGreaterThan(0);

	// reload: projeto salvo volta do servidor (sem marca de não-salvo)
	await openEditor(page, id);
	await expect(page).not.toHaveTitle(/\[UNSAVED\]/);
});

test("projeto com níveis externos abre e salva com os níveis separados", async ({ page }) => {
	const id = "t-ext";

	// semeia o sample externalLevels:true (manifesto + 3 .ldtkl)
	const manifest = await readFile(join(SAMPLES, "SeparateLevelFiles.ldtk"), "utf8");
	let v = (await bundle(id)).version;
	let r = await fetch(`${API}/api/project/${id}/manifest`, {
		method: "PUT", headers: { "Content-Type": "application/json", "If-Match": v }, body: manifest,
	});
	expect(r.status).toBe(200);
	v = (await r.json()).version;

	for (const f of ["World_Level_0", "World_Level_1", "World_Level_2"]) {
		const lvl = await readFile(join(SAMPLES, "SeparateLevelFiles", `${f}.ldtkl`), "utf8");
		const iid = JSON.parse(lvl).iid;
		r = await fetch(`${API}/api/project/${id}/level/${iid}`, {
			method: "PUT", headers: { "Content-Type": "application/json", "If-Match": v }, body: lvl,
		});
		expect(r.status).toBe(200);
		v = (await r.json()).version;
	}

	await openEditor(page, id);
	await expect(page).toHaveTitle(/SeparateLevelFiles/);

	await save(page);
	await expect(page.locator(".notification", { hasText: "Saved to server" })).toBeAttached();

	const after = await bundle(id);
	expect(after.manifest.externalLevels).toBe(true);
	expect(Object.keys(after.levels)).toHaveLength(3);
	// cada nível guarda seus dados; o manifesto não os duplica
	for (const lvl of Object.values<any>(after.levels))
		expect(Array.isArray(lvl.layerInstances)).toBe(true);
	for (const l of after.manifest.levels)
		expect(l.layerInstances == null).toBe(true);
});

test("falha ao carregar mostra tela de erro com retry", async ({ page }) => {
	// porta sem servidor
	await page.goto(`/web.html?p=t-fail&api=${encodeURIComponent("http://localhost:9")}`);
	const screen = page.locator("#webErrorScreen");
	await expect(screen).toBeVisible({ timeout: 30_000 });
	await expect(screen).toContainText("Não foi possível carregar o projeto");
	await expect(screen.locator("button")).toBeVisible();
	// não abriu o editor pela metade
	await expect(page.locator("#page.editor")).toHaveCount(0);
});

test("imagem órfã é removida do servidor no save seguinte", async ({ page }) => {
	const id = "t-orphan";

	// sobe uma imagem "por fora" (simula um import abandonado)
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAABS3WWCAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAd0wf9E4kJcgAAAABJRU5ErkJggg==",
		"base64",
	);
	const form = new FormData();
	form.append("file", new Blob([png], { type: "image/png" }), "orphan.png");
	const up = await fetch(`${API}/api/project/${id}/images`, { method: "POST", body: form });
	expect(up.status).toBe(201);
	expect((await bundle(id)).images).toHaveLength(1);

	// o editor abre um projeto que NÃO referencia essa imagem e salva
	await openEditor(page, id);
	await save(page);
	await expect(page.locator(".notification", { hasText: "Saved to server" })).toBeAttached();

	// o prune do flush removeu a órfã
	expect((await bundle(id)).images).toHaveLength(0);
});
