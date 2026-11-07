import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
// Authentication is verified against the database in the protected layout and API handlers.
export default createMiddleware(routing);
export const config = { matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/(zh|en)/r/(.*)'] };
