export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NODE_ENV !== 'production' &&
    process.env.E2E_FAKE_AUTH === '1'
  ) {
    const { initializeTestContext } = await import('./test-support/runtime');
    await initializeTestContext();
  }
}
