import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: the same build as the PWA (dist/), packed into a native shell.
// Build it with `npm run build && npx cap sync android`; CI does this (.github/workflows/android.yml).
const config: CapacitorConfig = {
  appId: 'com.marekjancik.purplesector',
  appName: 'Purple Sector',
  webDir: 'dist',
  backgroundColor: '#0C0E12',
  plugins: {
    // Google sign-in happens natively; the web Firebase SDK then signs in with its token (Auth.tsx).
    FirebaseAuthentication: { skipNativeAuth: true, providers: ['google.com'] },
  },
};

export default config;
