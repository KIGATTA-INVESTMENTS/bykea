import { initializeApp, getApps } from 'firebase/app';

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBaqtOtt4ER1qXWiEQRfKU49c9dk3Md3lw',
  authDomain: 'ingo-92d5f.firebaseapp.com',
  projectId: 'ingo-92d5f',
  storageBucket: 'ingo-92d5f.firebasestorage.app',
  messagingSenderId: '6247948440',
  appId: '1:6247948440:web:1a81d52d74052cfe81f0ed',
};

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
  messagingSenderId:
    process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
  appId: process.env.REACT_APP_FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

/** Public Firebase web config (safe for client / service worker). */
export { firebaseConfig };

let app = null;
if (isFirebaseConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
} else {
  // eslint-disable-next-line no-console
  console.warn('Firebase config is incomplete. Set REACT_APP_FIREBASE_* env vars.');
}

export { app };
export default app;
