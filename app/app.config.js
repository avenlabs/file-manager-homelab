// Menambahkan skema redirect OAuth Google (reversed client ID) jika client ID diset saat build.
// Contoh: EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=123-abc.apps.googleusercontent.com
//   → skema "com.googleusercontent.apps.123-abc" untuk redirect com.googleusercontent.apps.123-abc:/oauthredirect
const reversed = (id) => (id ? id.split('.').reverse().join('.') : null);

module.exports = ({ config }) => {
  const schemes = [
    config.scheme,
    reversed(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    reversed(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID),
  ].filter(Boolean);
  return { ...config, scheme: [...new Set(schemes)] };
};
