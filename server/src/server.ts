import { createApp } from './app.js';
import { DiskStorage } from './storage/DiskStorage.js';
import { resolveBindHost, exposureWarning } from './bind.js';
import { parseOrigins } from './cors.js';

const port = Number(process.env.PORT ?? 4000);
const storageDir = process.env.STORAGE_DIR ?? './storage';
const host = resolveBindHost(process.env);
const corsOrigins = parseOrigins(process.env.CORS_ORIGINS);

const app = createApp(new DiskStorage(storageDir), { corsOrigins });
app.listen(port, host, () => {
  console.log(`LDtk web server on ${host}:${port} (storage: ${storageDir})`);
  console.log(`CORS: ${corsOrigins ? corsOrigins.join(', ') : 'localhost (default)'}`);
  const warning = exposureWarning(host, port);
  if (warning) console.warn(warning);
});
