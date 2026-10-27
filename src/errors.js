export class HttpError extends Error {
  constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
export const fail = (status, message, retryAfter) => { throw new HttpError(status, message, retryAfter); };
