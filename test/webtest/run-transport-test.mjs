// Instala o XHR/servidor falsos e então carrega o teste Haxe compilado.
import { installFakeXhr, makeFakeServer } from "./fake-xhr.mjs";

const server = makeFakeServer();
globalThis.__fakeServer = server;
installFakeXhr(server);

await import("../../.tmp/transport-test.js");
