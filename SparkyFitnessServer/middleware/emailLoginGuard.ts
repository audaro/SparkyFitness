import type { Request, Response, NextFunction } from 'express';
import { isEmailLoginDisabled } from '../utils/emailLogin.js';

/** Block public password routes without blocking internal demo sign-in. */
export function emailLoginGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (
    isEmailLoginDisabled() &&
    (req.path.startsWith('/api/auth/sign-in/email') ||
      req.path.startsWith('/api/auth/sign-up/email'))
  ) {
    return res.status(400).json({
      message: 'Email and password is not enabled',
      code: 'EMAIL_PASSWORD_DISABLED',
    });
  }
  next();
}
