import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth';
import { firebaseAuth } from './firebase';

/**
 * Google sign-in without a redirect.
 *  - Android APK: the system Google account chooser opens as an overlay (app name and icon at the top, your accounts listed)
 *    and returns an ID token that Firebase turns into a PotHub session. No browser, no redirect.
 *  - Browser / PWA: Google's account chooser opens as a popup window; if the browser blocks popups the caller falls back
 *    to the redirect flow.
 * Setup: NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID = the Web client ID of Firebase's Google provider (see docs/NATIVE-AND-AUTH-SETUP.md).
 */
export const GOOGLE_WEB_CLIENT_ID = String(process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID || '').trim();

const cancelled = () => Object.assign(new Error('Sign-in cancelled.'), { code: 'GOOGLE_CANCELLED' });
const isCancel = (e) => /cancel|dismiss|closed|12501|12502|-5\b|no credential/i.test(`${e?.code || ''} ${e?.message || ''}`);

/** Reads the Google ID token from the Android account picker. Resolves to a string; throws GOOGLE_CANCELLED when the person closes the picker. */
async function pickGoogleIdToken() {
  // APK built by WyBuild: its bridge wraps @capacitor-firebase/authentication (Credential Manager account sheet, no browser).
  const bridgeGoogle = typeof window !== 'undefined' ? window.WyBuildNative?.auth?.google : null;
  if (typeof bridgeGoogle === 'function') {
    // skipNativeAuth: only return the Google credential; PotHub signs in to the web Firebase SDK and exchanges the session itself.
    const r = await bridgeGoogle({ skipNativeAuth: true });
    if (r?.ok === false) {
      if (isCancel({ message: r.error })) throw cancelled();
      throw Object.assign(new Error(r.error || 'The Google account picker could not open.'), { code: 'GOOGLE_NATIVE_FAILED' });
    }
    const idToken = r?.credential?.idToken;
    if (!idToken) throw Object.assign(new Error('Google did not return an identity token. Check that the Firebase Google provider is enabled and this APK\'s SHA-1 is added to the Firebase Android app.'), { code: 'GOOGLE_NO_TOKEN' });
    return idToken;
  }
  // Older Capacitor builds that still ship the Google Auth plugin.
  if (!GOOGLE_WEB_CLIENT_ID) throw Object.assign(new Error('Native Google sign-in is not available in this APK build.'), { code: 'GOOGLE_NOT_CONFIGURED' });
  const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
  try {
    await GoogleAuth.initialize({ clientId: GOOGLE_WEB_CLIENT_ID, scopes: ['profile', 'email'], grantOfflineAccess: false });
    const result = await GoogleAuth.signIn();
    const idToken = result?.authentication?.idToken;
    if (!idToken) throw Object.assign(new Error('Google did not return an identity token. Check the Web client ID and the Android OAuth client SHA-1.'), { code: 'GOOGLE_NO_TOKEN' });
    return idToken;
  } catch (e) { if (isCancel(e)) throw cancelled(); throw e; }
}

/** Native account picker -> Firebase credential -> PotHub session. Throws GOOGLE_CANCELLED when the person closes the chooser. */
export async function signInWithNativeGoogle(api) {
  const idToken = await pickGoogleIdToken();
  const credential = await signInWithCredential(firebaseAuth, GoogleAuthProvider.credential(idToken));
  const firebaseToken = await credential.user.getIdToken();
  const d = await api('/api/auth/firebase-exchange', { method: 'POST', body: JSON.stringify({ idToken: firebaseToken }), timeoutMs: 15000, noRetry: true });
  if (!d?.session || !d?.user) throw new Error('Google sign-in worked, but PotHub could not verify the account. Try again.');
  return { session: d.session, user: d.user, credits: d.credits || 0 };
}

/** Browser popup chooser. Resolves to the Firebase user, throws GOOGLE_CANCELLED, or throws {fallbackToRedirect:true}. */
export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const credential = await signInWithPopup(firebaseAuth, provider);
    return credential.user;
  } catch (e) {
    const code = String(e?.code || '');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') throw cancelled();
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(code)) throw Object.assign(new Error('Popup unavailable.'), { fallbackToRedirect: true });
    throw e;
  }
}
