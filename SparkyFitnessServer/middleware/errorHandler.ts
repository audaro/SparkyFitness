import type { NextFunction, Request, Response } from 'express';
import { log } from '../config/logging.js';
/**
 * What this handler reads off a thrown value. Nothing guarantees any of it:
 * `next(err)` accepts anything, so every field is treated as best-effort.
 */
interface HandledError {
  message?: string;
  stack?: string;
  /** `http-errors` and Express's own errors carry `status`, not `statusCode`. */
  status?: number;
  statusCode?: number;
  name?: string;
  code?: string;
  /** body-parser tags its payload-size failures `entity.too.large`. */
  type?: string;
}
const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  const err: HandledError =
    error && typeof error === 'object' ? (error as HandledError) : {};
  log(
    'error',
    `Error caught by centralized handler: ${err.message}`,
    err.stack
  );
  // Default to 500 Internal Server Error
  let statusCode = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let code: string | undefined =
    typeof err.code === 'string' ? err.code : undefined;

  if (
    err.name === 'PayloadTooLargeError' ||
    err.type === 'entity.too.large' ||
    statusCode === 413
  ) {
    statusCode = 413;
    code = 'IMAGE_TOO_LARGE';
    message = 'Request payload too large. Please reduce the image size.';
  } else {
    // Handle specific error types if needed (e.g., database errors, validation errors)
    switch (err.name) {
      case 'UnauthorizedError':
        statusCode = 401;
        message = 'Unauthorized: Invalid or missing token.';
        break;
      case 'ForbiddenError':
        statusCode = 403;
        message =
          'Forbidden: You do not have permission to perform this action.';
        break;
      case 'ValidationError':
        statusCode = 400;
        // `|| message` so a ValidationError thrown without one keeps the
        // default rather than answering with `undefined`.
        message = err.message || message;
        break;
      default:
        if (err.code === '23505') {
          statusCode = 409;
          message =
            'Conflict: A resource with this unique identifier already exists.';
        }
        break;
    }
  }
  res.status(statusCode).json({
    error: message,
    code,
    details: process.env.NODE_ENV === 'development' ? err.stack : undefined, // Only send stack in development
  });
};
export default errorHandler;
