/** Base error for SmartThings API failures. `status` is 0 for network errors and timeouts. */
export class SmartThingsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number = 0,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'SmartThingsApiError';
  }
}

/** HTTP 401 that persisted after one token refresh. */
export class SmartThingsUnauthorizedError extends SmartThingsApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'SmartThingsUnauthorizedError';
  }
}

/** HTTP 429 that persisted after the allowed number of retries. */
export class SmartThingsRateLimitError extends SmartThingsApiError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'SmartThingsRateLimitError';
  }
}
