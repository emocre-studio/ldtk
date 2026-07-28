import type { Request } from 'express';
import type { Storage } from './storage/Storage.js';
import { HttpError } from './errors.js';

/**
 * Concorrência otimista: toda mutação declara a versão que pretende substituir.
 * Sem o header ⇒ 428; divergente ⇒ 409 (outro cliente alterou o projeto).
 */
export async function requireIfMatch(req: Request, storage: Storage, id: string): Promise<void> {
  const ifMatch = req.header('If-Match');
  if (ifMatch === undefined) {
    throw new HttpError(428, 'precondition_required', 'If-Match header is required');
  }
  const current = await storage.getVersion(id);
  if (ifMatch !== current) {
    throw new HttpError(409, 'version_conflict', `Expected version ${current}, got ${ifMatch}`);
  }
}
