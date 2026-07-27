import { Router, type Request } from 'express';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler, HttpError } from '../errors.js';
import { safeSegment } from './validate.js';

async function requireIfMatch(req: Request, storage: Storage, id: string): Promise<void> {
  const ifMatch = req.header('If-Match');
  if (ifMatch === undefined) {
    throw new HttpError(428, 'precondition_required', 'If-Match header is required');
  }
  const current = await storage.getVersion(id);
  if (ifMatch !== current) {
    throw new HttpError(409, 'version_conflict', `Expected version ${current}, got ${ifMatch}`);
  }
}

export function createMutationRouter(storage: Storage): Router {
  const router = Router();

  router.put(
    '/api/project/:id/manifest',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'id');
      await requireIfMatch(req, storage, id);
      const version = await storage.putManifest(id, req.body);
      res.set('ETag', version).json({ version });
    }),
  );

  router.put(
    '/api/project/:id/level/:iid',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'id');
      const iid = safeSegment(req.params.iid, 'iid');
      await requireIfMatch(req, storage, id);
      const version = await storage.putLevel(id, iid, req.body);
      res.set('ETag', version).json({ version });
    }),
  );

  router.delete(
    '/api/project/:id/level/:iid',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'id');
      const iid = safeSegment(req.params.iid, 'iid');
      await requireIfMatch(req, storage, id);
      const version = await storage.deleteLevel(id, iid);
      if (version === null) {
        throw new HttpError(404, 'level_not_found', `Level ${iid} not found`);
      }
      res.set('ETag', version).json({ version });
    }),
  );

  return router;
}
