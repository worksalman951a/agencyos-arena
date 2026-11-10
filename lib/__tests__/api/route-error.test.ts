/**
 * Unit tests for the shared service-error → HTTP mapping.
 *
 * Routes used to answer "Not found" for every non-auth failure, which hid
 * validation messages ("Payment exceeds the outstanding balance of 50.00") and
 * made a rejected payment look like a missing invoice.
 */

import { describe, expect, it } from 'vitest';

import { apiErrorFrom } from '@/lib/api/route-error';

const coded = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

describe('apiErrorFrom', () => {
  it('passes a 400 message through, because it is written for the user', () => {
    expect(apiErrorFrom(coded('Payment exceeds the outstanding balance of 50.00', 400))).toEqual({
      status: 400,
      message: 'Payment exceeds the outstanding balance of 50.00',
    });
  });

  it('falls back to a generic 400 message when none is provided', () => {
    expect(apiErrorFrom({ statusCode: 400 })).toEqual({
      status: 400,
      message: 'Invalid request body',
    });
  });

  it.each([
    [401, 'Unauthenticated'],
    [403, 'Forbidden'],
    [404, 'Not found'],
  ])('maps %i to %s regardless of the internal message', (statusCode, message) => {
    expect(apiErrorFrom(coded('internal detail: org_123', statusCode as number))).toEqual({
      status: statusCode,
      message,
    });
  });

  it('hides unexpected failures behind a 500', () => {
    expect(apiErrorFrom(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toEqual({
      status: 500,
      message: 'Something went wrong. Please try again.',
    });
  });

  it('never leaks a 5xx statusCode from the service layer', () => {
    expect(apiErrorFrom(coded('Prisma: column does not exist', 500))).toEqual({
      status: 500,
      message: 'Something went wrong. Please try again.',
    });
  });

  it('handles non-error values', () => {
    expect(apiErrorFrom(null)).toEqual({
      status: 500,
      message: 'Something went wrong. Please try again.',
    });
    expect(apiErrorFrom('boom')).toEqual({
      status: 500,
      message: 'Something went wrong. Please try again.',
    });
  });
});
