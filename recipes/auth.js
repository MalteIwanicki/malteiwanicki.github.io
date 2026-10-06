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
  setDoc,
  updateDoc,
  onSnapshot,
  FieldValue
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

// --- Shopping list storage shape -------------------------------------------
// The shared list is stored as a MAP on the book: shoppingList: { [id]: item }.
// Storing one field per item (instead of one big array) means two people
// shopping at the same time can tick / edit different items without one write
// clobbering the other's. Older books stored a plain array; both are accepted
// on read and arrays are migrated to a map on load.
function shoppingListToMap(value) {
  if (Array.isArray(value)) {
    const map = {};
    value.forEach((it) => {
      if (it && it.id) map[it.id] = it;
    });
    return map;
  }
  if (value && typeof value === "object") return { ...value };
  return {};
}

function shoppingListToArray(value) {
  const map = shoppingListToMap(value);
  return Object.keys(map)
    .map((k) => map[k])
    .filter((it) => it && it.id);
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
      checkedItems: Array.isArray(data.checkedItems) ? data.checkedItems : [],
      shoppingList: shoppingListToArray(data.shoppingList)
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

    // One-time migration: a legacy array shopping list is rewritten as a
    // per-item map so concurrent shoppers stop overwriting each other.
    if (Array.isArray(data.shoppingList)) {
      try {
        await setDoc(
          ref,
          { shoppingList: shoppingListToMap(data.shoppingList) },
          { merge: true }
        );
      } catch (err) {
        console.warn("Shopping-list map migration failed:", err.message);
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
    shoppingList: [],
    seeded: true,
    updatedAt: Date.now()
  };
  try {
    await setDoc(ref, book);
  } catch (err) {
    console.error("Failed to seed recipe book:", err.message);
  }
  return { recipes, selectedMeals, staples, links, shoppingList: [] };
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
  if (Array.isArray(book.shoppingList)) payload.shoppingList = book.shoppingList;
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
  saveSelection: (meals) => saveBook({ selectedMeals: meals }),
  // --- Per-item shopping list API (conflict-free for concurrent shoppers) ---
  // The list lives at shoppingList.<id> as a map, so each item is its own field.
  upsertShoppingItems(items) {
    if (!currentUser || !isAllowed(currentUser) || !items.length) return;
    const map = {};
    items.forEach((it) => {
      if (it && it.id) map[`shoppingList.${it.id}`] = it;
    });
    updateDoc(doc(db, "recipebooks", currentUser.uid), {
      ...map,
      updatedAt: Date.now()
    }).catch((err) => console.error("Failed to add items:", err.message));
  },
  updateShoppingItem(id, patch) {
    if (!currentUser || !isAllowed(currentUser) || !id) return;
    const payload = {};
    Object.keys(patch).forEach((k) => {
      payload[`shoppingList.${id}.${k}`] = patch[k];
    });
    payload.updatedAt = Date.now();
    updateDoc(doc(db, "recipebooks", currentUser.uid), payload).catch((err) =>
      console.error("Failed to update item:", err.message)
    );
  },
  removeShoppingItem(id) {
    if (!currentUser || !isAllowed(currentUser) || !id) return;
    updateDoc(doc(db, "recipebooks", currentUser.uid), {
      [`shoppingList.${id}`]: FieldValue.delete(),
      updatedAt: Date.now()
    }).catch((err) => console.error("Failed to remove item:", err.message));
  },
  clearShoppingList() {
    if (!currentUser || !isAllowed(currentUser)) return;
    updateDoc(doc(db, "recipebooks", currentUser.uid), {
      shoppingList: {},
      updatedAt: Date.now()
    }).catch((err) => console.error("Failed to clear list:", err.message));
  }
};

// --- Live shopping-list sync -----------------------------------------------
// Both partners sign in with the SAME allowlisted Google account, so they share
// the one recipebooks/{uid} document. This subscription pushes the shared
// shopping list to every open tab/device in real time (onSnapshot over
// Firestore's listen channel), so two people shopping at once see each other's
// ticks, edits and new items.
let shoppingListUnsub = null;
const shoppingListCallbacks = new Set();

function notifyShoppingList(list) {
  shoppingListCallbacks.forEach((cb) => {
    try {
      cb(Array.isArray(list) ? list : null);
    } catch (err) {
      console.error("Shopping-list listener failed:", err);
    }
  });
}

// Subscribe to the shared list. `cb` is called immediately (with the latest
// list, or null if the doc has no list yet) and again on every remote change.
// Subscribing also (re)binds the underlying Firestore listener to the current
// user, so it is safe to call whenever auth state changes.
function watchShoppingList(cb) {
  shoppingListCallbacks.add(cb);
  bindShoppingListWatcher();

  return () => {
    shoppingListCallbacks.delete(cb);
    if (!shoppingListCallbacks.size && shoppingListUnsub) {
      shoppingListUnsub();
      shoppingListUnsub = null;
    }
  };
}

function bindShoppingListWatcher() {
  // (Re)bind to the current user whenever the watcher is needed.
  if (shoppingListUnsub) {
    shoppingListUnsub();
    shoppingListUnsub = null;
  }
  if (!currentUser || !isAllowed(currentUser)) {
    notifyShoppingList(null);
    return;
  }
  shoppingListUnsub = onSnapshot(
    doc(db, "recipebooks", currentUser.uid),
    (snap) => {
      const data = snap.exists() ? snap.data() || {} : {};
      notifyShoppingList(
        data.shoppingList === undefined
          ? null
          : shoppingListToArray(data.shoppingList)
      );
    },
    (err) => console.error("Shopping-list sync error:", err.message)
  );
}

// Rebind the listener whenever the signed-in user changes.
onAuthStateChanged(auth, () => {
  if (shoppingListCallbacks.size) bindShoppingListWatcher();
});

window.recipeStore.watchShoppingList = watchShoppingList;

// Signal readiness for scripts that loaded before this module.
window.dispatchEvent(new Event("recipeauthready"));
