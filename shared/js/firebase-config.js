/**
 * Optional Firebase web config.
 * Leave window.ORDER_BOARD_FIREBASE as null for local-only mode.
 * To enable Firestore sync across devices, paste your Firebase web app config:
 *
 *   window.ORDER_BOARD_FIREBASE = {
 *     apiKey: "...",
 *     authDomain: "....firebaseapp.com",
 *     projectId: "...",
 *     storageBucket: "....appspot.com",
 *     messagingSenderId: "...",
 *     appId: "..."
 *   };
 *
 * Also add android/app/google-services.json for native Android if you use Firebase SDKs later.
 */
window.ORDER_BOARD_FIREBASE = null;
