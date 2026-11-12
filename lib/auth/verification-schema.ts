/**
 * Extra columns this application's `Verification` model requires.
 *
 * Better Auth's adapter transforms input by walking the fields it knows about
 * (`getAuthTables`) and drops anything else. The Prisma schema makes
 * `Verification.userId` mandatory, so the field must be declared to the vendor
 * as an additional field; otherwise `createVerificationValue` silently hands
 * Prisma a payload without the relation and every token write fails.
 *
 * Kept in its own pure module so a unit test can verify the declaration
 * without loading the database client.
 */
export const VERIFICATION_ADDITIONAL_FIELDS = {
  userId: { type: 'string', required: true },
} as const;
