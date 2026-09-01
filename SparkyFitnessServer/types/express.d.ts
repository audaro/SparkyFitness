declare global {
  namespace Express {
    interface Request {
      /** The RLS context user ID (equals activeUserId). Set by authMiddleware. */
      userId: string;
      /** The authenticated (logged-in) user's ID. Set by authMiddleware. */
      authenticatedUserId: string;
      /** Same as authenticatedUserId at assignment time. Set by authMiddleware. */
      originalUserId: string;
      /** The active user ID (may differ from authenticatedUserId when context-switching). */
      activeUserId: string;
      /** Full Better Auth user object (includes role, email, etc.). */
      user: Record<string, unknown>;
      /**
       * Staging-directory key for an image upload, set by the multer disk
       * storage in `middleware/imageUpload.ts` so the `destination` and the
       * route handler agree on where the request's files landed.
       */
      imageUploadId?: string;
    }
  }
}

export {};
