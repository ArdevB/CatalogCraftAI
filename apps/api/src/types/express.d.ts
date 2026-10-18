import 'express-session';
import type { AuthContext } from '../middleware/require-auth.js';

declare module 'express-session' {
  interface SessionData {
    /** Set at login/registration. The only thing the browser holds is the signed session id. */
    userId: string;
    /** The organization the user is currently working in. Re-verified on every request. */
    organizationId: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      /** Present after `requireAuth` has verified the session, user and membership. */
      auth?: AuthContext;
    }
  }
}
