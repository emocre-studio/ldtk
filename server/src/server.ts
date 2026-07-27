import { createApp } from './app.js';
import { DiskStorage } from './storage/DiskStorage.js';

const port = Number(process.env.PORT ?? 4000);
const storageDir = process.env.STORAGE_DIR ?? './storage';

const app = createApp(new DiskStorage(storageDir));
app.listen(port, () => {
  console.log(`LDtk web server on :${port} (storage: ${storageDir})`);
});
