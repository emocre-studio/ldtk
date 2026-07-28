import { Router } from 'express';
import multer, { MulterError } from 'multer';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler, HttpError } from '../errors.js';
import { requireIfMatch } from '../ifMatch.js';
import { safeSegment } from './validate.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      cb(new HttpError(415, 'unsupported_media_type', `Unsupported type ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

export function createImageRouter(storage: Storage): Router {
  const router = Router();

  router.post(
    '/api/project/:id/images',
    (req, res, next) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            next(new HttpError(413, 'file_too_large', 'Image exceeds 20MB limit'));
            return;
          }
          next(new HttpError(400, 'upload_error', err.message));
          return;
        }
        next(err);
      });
    },
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new HttpError(400, 'no_file', 'Expected a multipart field named "file"');
      }
      const id = safeSegment(req.params.id, 'id');
      const rec = await storage.putImage(
        id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );
      res.status(201).json({ ...rec, url: `/api/project/${id}/images/${rec.id}` });
    }),
  );

  router.get(
    '/api/project/:id/images/:imgId',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'id');
      const imgId = safeSegment(req.params.imgId, 'imgId');
      const img = await storage.getImage(id, imgId);
      if (!img) {
        throw new HttpError(404, 'image_not_found', `Image ${imgId} not found`);
      }
      res.set('Content-Type', img.contentType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(img.bytes);
    }),
  );

  // Registrado antes de :imgId; não há colisão (métodos distintos), mas mantém
  // a leitura óbvia de que "prune" não é um id de imagem.
  router.post(
    '/api/project/:id/images/prune',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'projectId');
      await requireIfMatch(req, storage, id);

      const keep = (req.body as { keep?: unknown })?.keep;
      if (!Array.isArray(keep)) {
        throw new HttpError(400, 'invalid_keep', 'Body must be { keep: string[] }');
      }
      const keepSet = new Set(keep.map(String));

      const deleted: string[] = [];
      for (const img of await storage.listImages(id)) {
        if (keepSet.has(img.id)) continue;
        await storage.deleteImage(id, img.id);
        deleted.push(img.id);
      }

      const version = await storage.bumpVersion(id);
      res.set('ETag', version).json({ version, deleted });
    }),
  );

  router.delete(
    '/api/project/:id/images/:imgId',
    asyncHandler(async (req, res) => {
      const id = safeSegment(req.params.id, 'projectId');
      const imgId = safeSegment(req.params.imgId, 'imageId');
      await requireIfMatch(req, storage, id);
      const existed = await storage.deleteImage(id, imgId);
      if (!existed) {
        throw new HttpError(404, 'image_not_found', `Image ${imgId} not found`);
      }
      const version = await storage.bumpVersion(id);
      res.set('ETag', version).json({ version });
    }),
  );

  return router;
}
