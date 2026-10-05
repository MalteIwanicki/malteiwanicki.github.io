// Google Sign-In via Firebase Auth. ES module; loaded with <script type="module">.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// --- Access control --------------------------------------------------------
// Only these Google accounts may use the app. This list is ALSO enforced
// server-side in firestore.rules, so it cannot be bypassed from the client.
const ALLOWED_EMAILS = [
  "iwanicki.rm@gmail.com",
  "malteiwa@gmail.com"
];

const ACCESS_DENIED_MESSAGE =
  "This is a private app, contact Malte at " +
  "mailto:malteiwa+mealplan@gmail.com to get access";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let deniedEmail = null;
const listeners = new Set();

function isAllowed(user) {
  return Boolean(
    user && user.email && ALLOWED_EMAILS.includes(user.email.toLowerCase())
  );
}

function emit() {
  listeners.forEach((cb) => cb(currentUser));
  // Let classic scripts react without polling.
  window.dispatchEvent(
    new CustomEvent("recipeauthchange", {
      detail: { user: currentUser, deniedEmail }
    })
  );
}

onAuthStateChanged(auth, async (user) => {
  if (user && !isAllowed(user)) {
    // Signed in with a Google account that is not on the allowlist:
    // immediately sign them back out and flag the denial.
    deniedEmail = user.email;
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign-out after denial failed:", err.code, err.message);
    }
    showAccessDenied();
    emit();
    return;
  }

  currentUser = user;
  if (user) {
    deniedEmail = null;
    hideAccessDenied();
  }
  emit();
});

async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Sign-in failed:", err.code, err.message);
    if (err.code === "auth/unauthorized-domain") {
      alert(
        "This domain is not authorized in Firebase. Add it under " +
          "Authentication > Settings > Authorized domains."
      );
    }
  }
}

async function signOutUser() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Sign-out failed:", err.code, err.message);
  }
}

function showAccessDenied() {
  const el = document.getElementById("auth-message");
  if (el) {
    el.innerHTML =
      'This is a private app, contact Malte at ' +
      '<a href="mailto:malteiwa+mealplan@gmail.com">' +
      "malteiwa+mealplan@gmail.com</a> to get access";
    el.hidden = false;
  }
  const overlay = document.getElementById("access-denied-overlay");
  if (overlay) overlay.hidden = false;
  // Also surface it as a dismissable alert (once per denial event).
  alert(ACCESS_DENIED_MESSAGE.replace("mailto:", ""));
}

function hideAccessDenied() {
  const el = document.getElementById("auth-message");
  if (el) el.hidden = true;
  const overlay = document.getElementById("access-denied-overlay");
  if (overlay) overlay.hidden = true;
}

window.recipeAuth = {
  ALLOWED_EMAILS,
  signIn,
  signOut: signOutUser,
  getUser: () => currentUser,
  getDeniedEmail: () => deniedEmail,
  isAllowed: () => Boolean(currentUser && isAllowed(currentUser)),
  onChange(cb) {
    listeners.add(cb);
    cb(currentUser); // fire immediately with the current state
    return () => listeners.delete(cb);
  }
};

// Per-user storage in Firestore: users/{uid} -> { selectedMeals: [...] }.
// Returns null when not signed in (or not allowed).
async function loadSelection() {
  if (!currentUser || !isAllowed(currentUser)) return null;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  return snap.exists() ? snap.data().selectedMeals || [] : null;
}

async function saveSelection(meals) {
  if (!currentUser || !isAllowed(currentUser)) return;
  await setDoc(
    doc(db, "users", currentUser.uid),
    { selectedMeals: meals, updatedAt: Date.now() },
    { merge: true }
  );
}

window.recipeStore = {
  isReady: () => Boolean(currentUser && isAllowed(currentUser)),
  loadSelection,
  saveSelection
};

// Signal readiness for scripts that loaded before this module.
window.dispatchEvent(new Event("recipeauthready"));
