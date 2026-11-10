/**
 * Shared translation from a service-layer error to an HTTP response.
 *
 * Services throw errors carrying `statusCode` (and, for 400s, a message written
 * for the user — "Payment exceeds the outstanding balance of 50.00", "Invalid
 * status transition from paid to draft"). Routes used to collapse every
 * non-auth failure into "Not found", which hid those messages from the UI and
 * made a rejected payment look like a missing invoice.
 */

export interface ApiError {
  status: number;
  message: string;
}

const SAFE_MESSAGES: Record<number, string> = {
  401: 'Unauthenticated',
  403: 'Forbidden',
  404: 'Not found',
};

export function apiErrorFrom(error: unknown): ApiError {
  const coded = error as { statusCode?: number; message?: string } | null;
  const statusCode = coded?.statusCode;

  if (statusCode === 400) {
    const message =
      typeof coded?.message === 'string' && coded.message.length > 0
        ? coded.message
        : 'Invalid request body';
    return { status: 400, message };
  }

  if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
    return { status: statusCode, message: SAFE_MESSAGES[statusCode] };
  }

  // Anything unexpected is reported generically: internal messages can mention
  // schema details or ids, and must never reach the client.
  return { status: 500, message: 'Something went wrong. Please try again.' };
}
