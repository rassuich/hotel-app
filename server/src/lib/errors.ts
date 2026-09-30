/** Errors carry a stable machine code; the front ends translate codes into FR/EN text. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
  }
}

export const notFound = (code = 'not_found') => new ApiError(404, code);
export const forbidden = (code = 'forbidden', details?: unknown) => new ApiError(403, code, details);
export const conflict = (code: string, details?: unknown) => new ApiError(409, code, details);
export const badRequest = (code: string, details?: unknown) => new ApiError(400, code, details);
export const unauthorized = (code = 'not_authenticated') => new ApiError(401, code);
