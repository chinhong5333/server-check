import type { AuthenticatedUser } from "../../shared/contracts.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: AuthenticatedUser;
        userInternalId: string;
        sessionId: string;
        sessionInternalId: string;
        csrfHash: string;
        expiresAt: number;
        jwtExpiresAt: number;
      };
    }
  }
}

export {};
