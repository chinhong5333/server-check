import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors.js";
import { safeEqualHex, sha256 } from "../security/crypto.js";

export function requireCsrf(request: Request, _response: Response, next: NextFunction): void {
  const csrfToken = request.get("x-csrf-token");
  const expectedHash = request.auth?.csrfHash;
  if (!csrfToken || !expectedHash || !safeEqualHex(sha256(csrfToken), expectedHash)) {
    next(new AppError(403, "csrf_rejected", "The request security token is missing or invalid."));
    return;
  }
  next();
}
