import { authHelper, isJwtExpired } from '../../api/auth-helper';

/**
 * Decide whether a shopping sync 401 is worth retrying.
 *
 * Short-lived access tokens and `POST /api/auth/token` are not shipped yet
 * (see backend design). While the stored JWT is still unexpired, retry once:
 * the rejection may be a race with a token write. An expired or missing token
 * cannot be refreshed here, so the caller should send the user to sign in
 * and try the same queued op later.
 */
export async function recoverShoppingListAuth(): Promise<boolean> {
  const token = await authHelper.getJWT();
  if (!token) return false;
  return !isJwtExpired(token);
}
