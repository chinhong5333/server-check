import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function asyncHandler<T extends Request>(
  handler: (request: T, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: T, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(422).json({
      error: {
        code: "validation_failed",
        message: "The request did not match the documented input contract.",
        details: error.flatten()
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown server error";
  response.status(500).json({
    error: {
      code: "internal_error",
      message: "The server could not complete the request. Try again.",
      details: process.env.NODE_ENV === "production" ? undefined : message
    }
  });
};
