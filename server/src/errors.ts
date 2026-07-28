import type { Request, Response, NextFunction, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * O body-parser (usado por express.json) anexa `type` e `status` aos erros que
 * gera. Usar esses campos é mais estável do que farejar `instanceof SyntaxError`
 * + a presença de `body`, que dependem de detalhes internos da lib.
 */
interface BodyParserError {
  type: string;
  status: number;
}

function asBodyParserError(err: unknown): BodyParserError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as Record<string, unknown>;
  return typeof e.type === 'string' && typeof e.status === 'number'
    ? { type: e.type, status: e.status }
    : null;
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  const bodyErr = asBodyParserError(err);
  if (bodyErr) {
    if (bodyErr.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON body', code: 'invalid_json' });
      return;
    }
    if (bodyErr.type === 'entity.too.large') {
      res.status(413).json({ error: 'Payload too large', code: 'payload_too_large' });
      return;
    }
    if (bodyErr.status >= 400 && bodyErr.status < 500) {
      res.status(bodyErr.status).json({ error: 'Bad request', code: 'bad_request' });
      return;
    }
  }
  res.status(500).json({ error: 'Internal error', code: 'internal' });
}
