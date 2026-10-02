export class MerakiApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requestId: string | null;

  constructor(status: number, message: string, body: unknown, requestId: string | null) {
    super(message);
    this.name = 'MerakiApiError';
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

export class MerakiNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MerakiNetworkError';
  }
}

export class MerakiPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MerakiPaginationError';
  }
}
