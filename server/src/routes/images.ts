import { Router } from 'express';
import multer, { MulterError } from 'multer';
import type { Storage } from '../storage/Storage.js';
import { asyncHandler, HttpError } from '../errors.js';

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
        if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
          next(new HttpError(413, 'file_too_large', 'Image exceeds 20MB limit'));
          return;
        }
        next(err);
      });
    },
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new HttpError(400, 'no_file', 'Expected a multipart field named "file"');
      }
      const id = req.params.id;
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
      const img = await storage.getImage(req.params.id, req.params.imgId);
      if (!img) {
        throw new HttpError(404, 'image_not_found', `Image ${req.params.imgId} not found`);
      }
      res.set('Content-Type', img.contentType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(img.bytes);
    }),
  );

  return router;
}
