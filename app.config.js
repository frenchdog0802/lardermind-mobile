// Dynamic Expo config. Expo loads app.json first and passes it in as `config`.
// Only the Google Sign-In plugin needs env: its iOS URL scheme is the REVERSED iOS OAuth client id.
const GOOGLE_PLUGIN = '@react-native-google-signin/google-signin';

/** `123-abc.apps.googleusercontent.com` -> `com.googleusercontent.apps.123-abc` */
function reverseGoogleClientId(clientId) {
  const id = (clientId || '').trim();
  const suffix = '.apps.googleusercontent.com';
  if (!id.endsWith(suffix) || id.length === suffix.length) return null;
  return `com.googleusercontent.apps.${id.slice(0, -suffix.length)}`;
}

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const iosUrlScheme = reverseGoogleClientId(iosClientId);
  if (iosClientId && !iosUrlScheme) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must look like <number>-<hash>.apps.googleusercontent.com',
    );
  }

  const plugins = (config.plugins || []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name !== GOOGLE_PLUGIN) return plugin;
    // Without an iOS client id keep the plain plugin (Android keeps working); the iOS Google
    // button stays hidden at runtime until the id is provided.
    return iosUrlScheme ? [GOOGLE_PLUGIN, { iosUrlScheme }] : GOOGLE_PLUGIN;
  });

  return { ...config, plugins };
};

module.exports.reverseGoogleClientId = reverseGoogleClientId;
