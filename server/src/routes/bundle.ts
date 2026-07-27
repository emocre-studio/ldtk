import { Router } from 'express';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler } from '../errors.js';

export function createProjectRouter(storage: Storage): Router {
  const router = Router();

  router.get(
    '/api/project/:id/bundle',
    asyncHandler(async (req, res) => {
      const id = req.params.id;
      const [version, manifest, levels, images] = await Promise.all([
        storage.getVersion(id),
        storage.getManifest(id),
        storage.listLevels(id),
        storage.listImages(id),
      ]);
      res.json({
        version,
        manifest,
        levels,
        images: images.map((img) => ({
          ...img,
          url: `/api/project/${id}/images/${img.id}`,
        })),
      });
    }),
  );

  return router;
}
