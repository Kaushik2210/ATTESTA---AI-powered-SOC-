/** Split out from session.ts so middleware.ts (edge runtime, no
 * node:crypto) can reference the cookie name without pulling in the
 * HMAC signing code that only ever runs in a server component/action.
 */
export const SESSION_COOKIE = "attesta_dev_session";
