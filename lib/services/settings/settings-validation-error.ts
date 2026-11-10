/**
 * Validation failure raised by the settings services.
 *
 * This lives outside the `'use server'` service module on purpose: a
 * `'use server'` module may only export async functions, so exporting a class
 * from it silently drops every export in the module and breaks the build.
 */

export class SettingsValidationError extends Error {
  statusCode = 400;
  fieldErrors: Record<string, string>;
  issues: Array<{ path: string; message: string }>;

  constructor(
    fieldErrors: Record<string, string>,
    issues: Array<{ path: string; message: string }>
  ) {
    super('Validation failed');
    this.name = 'SettingsValidationError';
    this.fieldErrors = fieldErrors;
    this.issues = issues;
  }
}
