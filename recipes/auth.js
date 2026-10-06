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
import {
  DEFAULT_RECIPES,
  EXAMPLE_RECIPE,
  DEFAULT_STAPLES,
  DEFAULT_FOOD_LINKS,
  SEED_OWNER_EMAIL
} from "./seed.js";

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
// Always show the Google account chooser, so the user can pick (or switch to) a
// different account instead of silently reusing the last one.
provider.setCustomParameters({ prompt: "select_account" });

let currentUser = null;
let deniedEmail = null;
const listeners = new Set();

function isAllowed(user) {
  return Boolean(
    user && user.email && ALLOWED_EMAILS.includes(user.email.toLowerCase())
  );
}

// Fold duplicate staple entries (legacy "milk, milk, milk") into a single entry
// with a count, so an explicit amount replaces plain repetition.
function normalizeStapleEntries(stapleList, amounts) {
  const names = [];
  const result = {};
  const incoming = amounts && typeof amounts === "object" ? amounts : {};
  (Array.isArray(stapleList) ? stapleList : []).forEach((raw) => {
    const name = String(raw == null ? "" : raw).trim();
    if (!name) return;
    if (result[name] == null) {
      names.push(name);
      result[name] =
        incoming[name] != null ? parseInt(incoming[name], 10) || 1 : 1;
    } else {
      result[name] += 1;
    }
  });
  names.forEach((name) => {
    if (!(result[name] > 0)) result[name] = 1;
  });
  return { names, amounts: result };
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

// Switch to a different Google account: sign out first, then open the account
// chooser. Takes a moment after the popup closes for the new sign-in to emit.
async function switchAccount() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error("Sign-out before switch failed:", err.code, err.message);
  }
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Account switch failed:", err.code, err.message);
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
  switchAccount,
  getUser: () => currentUser,
  getDeniedEmail: () => deniedEmail,
  isAllowed: () => Boolean(currentUser && isAllowed(currentUser)),
  onChange(cb) {
    listeners.add(cb);
    cb(currentUser); // fire immediately with the current state
    return () => listeners.delete(cb);
  }
};

// --- Per-user recipe book --------------------------------------------------
// Each user owns a private book at recipebooks/{uid}:
//   { recipes: [{ id, title, source }], selectedMeals: [recipeId],
//     staples: [...], links: { ingredient: url }, seeded, updatedAt }
// The book is seeded on first read: the full default collection for the seed
// owner, a single example recipe for everyone else.

function newId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

function seedRecipesFor(user) {
  const email = (user && user.email ? user.email : "").toLowerCase();
  const isSeedOwner = email === SEED_OWNER_EMAIL.toLowerCase();
  return (isSeedOwner ? DEFAULT_RECIPES : [EXAMPLE_RECIPE]).map((r) => ({
    id: r.id,
    title: r.title,
    source: r.source
  }));
}

// Read (and seed on first run) the signed-in user's recipe book.
async function loadBook() {
  if (!currentUser || !isAllowed(currentUser)) return null;
  const ref = doc(db, "recipebooks", currentUser.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const data = snap.data() || {};
    const book = {
      recipes: Array.isArray(data.recipes) ? data.recipes : [],
      selectedMeals: Array.isArray(data.selectedMeals)
        ? data.selectedMeals
        : [],
      staples: Array.isArray(data.staples) ? data.staples : [],
      stapleAmounts:
        data.stapleAmounts && typeof data.stapleAmounts === "object"
          ? data.stapleAmounts
          : {},
      links: data.links && typeof data.links === "object" ? data.links : {},
      theme: typeof data.theme === "string" ? data.theme : "violet",
      mode: typeof data.mode === "string" ? data.mode : "light",
      checkedItems: Array.isArray(data.checkedItems) ? data.checkedItems : []
    };

    // Fold legacy duplicate staples ("milk, milk, milk") into one entry with an
    // amount, so the amount model replaces plain repetition going forward.
    if (book.staples.length) {
      const merged = normalizeStapleEntries(book.staples, book.stapleAmounts);
      book.staples = merged.names;
      book.stapleAmounts = merged.amounts;
      if ((data.stapleAmounts === undefined) && merged.names.length) {
        try {
          await setDoc(
            ref,
            {
              staples: book.staples,
              stapleAmounts: book.stapleAmounts,
              updatedAt: Date.now()
            },
            { merge: true }
          );
        } catch (err) {
          console.warn("Staple amount migration failed:", err.message);
        }
      }
    }

    // Backfill staples/links for books created before those fields existed.
    if (data.staples === undefined || data.links === undefined) {
      book.staples = [...DEFAULT_STAPLES];
      book.links = { ...DEFAULT_FOOD_LINKS };
      try {
        await setDoc(
          ref,
          { staples: book.staples, links: book.links, updatedAt: Date.now() },
          { merge: true }
        );
      } catch (err) {
        console.warn("Backfill of staples/links failed:", err.message);
      }
    }
    return book;
  }

  // First run: seed this user's book.
  const recipes = seedRecipesFor(currentUser);
  const staples = [...DEFAULT_STAPLES];
  const links = { ...DEFAULT_FOOD_LINKS };

  // One-time migration of the legacy users/{uid}.selectedMeals list
  // (which stored meal *names*) into the new id-based selection.
  let selectedMeals = [];
  try {
    const legacy = await getDoc(doc(db, "users", currentUser.uid));
    const legacyNames = legacy.exists()
      ? legacy.data().selectedMeals || []
      : [];
    const byTitle = new Map(
      recipes.map((r) => [r.title.toLowerCase(), r.id])
    );
    selectedMeals = legacyNames
      .map((name) => byTitle.get(String(name).toLowerCase()))
      .filter(Boolean);
  } catch (err) {
    console.warn("Legacy selection migration skipped:", err.message);
  }

  const book = {
    recipes,
    selectedMeals,
    staples,
    links,
    seeded: true,
    updatedAt: Date.now()
  };
  try {
    await setDoc(ref, book);
  } catch (err) {
    console.error("Failed to seed recipe book:", err.message);
  }
  return { recipes, selectedMeals, staples, links };
}

// Persist the user's book. `book` may contain any of recipes/selectedMeals/
// staples/links.
async function saveBook(book) {
  if (!currentUser || !isAllowed(currentUser)) return;
  const payload = { updatedAt: Date.now() };
  if (Array.isArray(book.recipes)) payload.recipes = book.recipes;
  if (Array.isArray(book.selectedMeals))
    payload.selectedMeals = book.selectedMeals;
  if (Array.isArray(book.staples)) payload.staples = book.staples;
  if (book.stapleAmounts && typeof book.stapleAmounts === "object")
    payload.stapleAmounts = book.stapleAmounts;
  if (book.links && typeof book.links === "object") payload.links = book.links;
  if (typeof book.theme === "string") payload.theme = book.theme;
  if (typeof book.mode === "string") payload.mode = book.mode;
  if (Array.isArray(book.checkedItems)) payload.checkedItems = book.checkedItems;
  await setDoc(doc(db, "recipebooks", currentUser.uid), payload, {
    merge: true
  });
}

window.recipeStore = {
  isReady: () => Boolean(currentUser && isAllowed(currentUser)),
  loadBook,
  saveBook,
  newId,
  // Kept for backwards compatibility with any older callers.
  loadSelection: async () => (await loadBook())?.selectedMeals ?? null,
  saveSelection: (meals) => saveBook({ selectedMeals: meals })
};

// Signal readiness for scripts that loaded before this module.
window.dispatchEvent(new Event("recipeauthready"));
