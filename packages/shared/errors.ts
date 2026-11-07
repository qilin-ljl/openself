const brand = Symbol.for('openself.AppError');
export class AppError extends Error {
  readonly [brand] = true;
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
    this.name = 'AppError';
  }
}
export function isAppError(error: unknown): error is AppError {
  return error !== null && typeof error === 'object' && Reflect.get(error, brand) === true;
}
