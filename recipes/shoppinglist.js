// Shopping list page (recipes/shoppinglist.html).
//
// A native-app-style tick list. There are no product links here — just items
// that get moved to the bottom once they are in the trolley ("im Einkaufswagen").
//
// Storage: the signed-in user's Firestore book (via auth.js) when signed in,
// otherwise this browser's localStorage. On the first sign-in any local items
// are merged up so nothing is lost.
//
// This module is self-contained (it does NOT import from scripts.js, which
// exposes no exports); it mirrors the same theme storage keys so the look
// stays consistent with the Recipe Book.

const LS_KEY = "recipeShoppingList";
const THEME_STORAGE = "recipeBookTheme";
const MODE_STORAGE = "recipeBookMode";
const THEMES = [
  "violet",
  "blueberry",
  "peacock",
  "lavender",
  "flamingo",
  "sage",
  "basil",
  "graphite"
];
const MODES = ["light", "dark"];

let items = [];
let signedIn = false;

// --- Theme (mirrors scripts.js, same storage keys) -------------------------

function prefersDark() {
  return Boolean(
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function storedMode() {
  try {
    return localStorage.getItem(MODE_STORAGE);
  } catch (_) {
    return null;
  }
}

function storedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE) || "violet";
  } catch (_) {
    return "violet";
  }
}

function applyMode(mode) {
  const m = MODES.includes(mode) ? mode : "light";
  document.documentElement.dataset.mode = m;
  try {
    localStorage.setItem(MODE_STORAGE, m);
  } catch (_) {
    /* ignore */
  }
}

function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : "violet";
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_STORAGE, t);
  } catch (_) {
    /* ignore */
  }
}

// --- Toast (mirrors the .toast markup used in style.css) -------------------

function showToast(message, variant = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast--${variant}`;
  const icon =
    variant === "error"
      ? '<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>';
  toast.innerHTML = `${icon}<span></span>`;
  toast.lastChild.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.25s ease, transform 0.25s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 260);
  }, 2200);
}

// --- Storage helpers -------------------------------------------------------

function isSignedIn() {
  return Boolean(window.recipeStore && window.recipeStore.isReady());
}

function newId() {
  if (window.recipeStore && window.recipeStore.newId) {
    return window.recipeStore.newId();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalize(raw) {
  return {
    id: raw && raw.id ? String(raw.id) : newId(),
    name: String((raw && raw.name) || "").trim(),
    amount: String((raw && raw.amount) || "").trim(),
    note: String((raw && raw.note) || "").trim(),
    done: Boolean(raw && raw.done),
    at: Number(raw && raw.at) || Date.now(),
    order: raw && Number.isFinite(raw.order) ? raw.order : null
  };
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(normalize).filter((i) => i.name) : [];
  } catch (_) {
    return [];
  }
}

function writeLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch (_) {
    /* ignore (private mode) */
  }
}

// Persist helpers. When signed in, each item is written to its own Firestore
// field (shoppingList.<id>) so two people shopping at the same time can tick /
// edit different items without one write overwriting the other's. When signed
// out everything goes to localStorage instead.
function persistNewItems(list) {
  if (!list.length) return;
  if (signedIn && window.recipeStore && window.recipeStore.upsertShoppingItems) {
    window.recipeStore.upsertShoppingItems(list);
  } else {
    writeLocal();
  }
}

function persistItem(id, patch) {
  if (!id) return;
  if (signedIn && window.recipeStore && window.recipeStore.updateShoppingItem) {
    window.recipeStore.updateShoppingItem(id, patch);
  } else {
    writeLocal();
  }
}

function persistRemoveItem(id) {
  if (!id) return;
  if (signedIn && window.recipeStore && window.recipeStore.removeShoppingItem) {
    window.recipeStore.removeShoppingItem(id);
  } else {
    writeLocal();
  }
}

function persistClearAll() {
  if (signedIn && window.recipeStore && window.recipeStore.clearShoppingList) {
    window.recipeStore.clearShoppingList();
  } else {
    writeLocal();
  }
}

function keyOf(it) {
  return `${it.name.toLowerCase()}|${it.amount.toLowerCase()}`;
}

// Merge the local list into the cloud list (local-only items are appended).
function mergeLists(cloud, local) {
  const seen = new Set(cloud.map(keyOf));
  const extra = local.filter((it) => it.name && !seen.has(keyOf(it)));
  return cloud.concat(extra);
}

// --- Ordering --------------------------------------------------------------

// A key issued for items that should appear on top (newest first). Orders are
// renumbered to 0..n-1 after every drag, so going below the minimum works.
function nextTopOrder() {
  let min = 0;
  items.forEach((i) => {
    if (Number.isFinite(i.order) && i.order < min) min = i.order;
  });
  return min - 1;
}

// Give every item a stable order. Items that don't have one yet (e.g. added
// from the Recipe Book) are placed on top, newest first, matching the original
// "just added on top" behaviour; everything else keeps its dragged order.
function ensureOrder() {
  if (items.every((i) => Number.isFinite(i.order))) return;

  const ordered = items
    .filter((i) => Number.isFinite(i.order))
    .sort((a, b) => a.order - b.order);
  const unordered = items
    .filter((i) => !Number.isFinite(i.order))
    .sort((a, b) => b.at - a.at);

  unordered.concat(ordered).forEach((it, i) => {
    it.order = i;
  });
}

// --- Rendering -------------------------------------------------------------

function makeCheck(it) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sl-item__check";
  btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
  btn.setAttribute("aria-pressed", String(it.done));
  btn.setAttribute("aria-label", `${it.done ? "Untick" : "Tick"} ${it.name}`);
  btn.addEventListener("click", () => toggle(it));
  return btn;
}

function toggle(it) {
  it.done = !it.done;
  it.at = Date.now();
  // Unticking brings the item back among the "to buy" items, on top.
  if (!it.done) it.order = nextTopOrder();
  persistItem(it.id, { done: it.done, at: it.at, order: it.order });
  render();
}

function remove(it) {
  items = items.filter((x) => x !== it);
  persistRemoveItem(it.id);
  render();
}

function row(it) {
  const li = document.createElement("li");
  li.className = "sl-item" + (it.done ? " sl-item--done" : "");
  li.dataset.id = it.id;

  const grip = document.createElement("span");
  grip.className = "sl-item__grip";
  grip.innerHTML = '<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>';
  grip.setAttribute("aria-hidden", "true");
  grip.addEventListener("pointerdown", (e) => startDrag(e, li, it));
  li.appendChild(grip);

  li.appendChild(makeCheck(it));

  const body = document.createElement("div");
  body.className = "sl-item__body";
  body.addEventListener("click", () => toggle(it));

  const name = document.createElement("span");
  name.className = "sl-item__name";
  name.textContent = it.name;
  body.appendChild(name);

  // Editable amount, sitting right next to the name. Clicks are stopped so
  // tapping it to edit never ticks the item off.
  const amount = document.createElement("input");
  amount.type = "text";
  amount.className = "sl-item__amount";
  amount.value = it.amount || "";
  amount.placeholder = "amount";
  amount.setAttribute("aria-label", `Amount for ${it.name}`);
  amount.addEventListener("click", (e) => e.stopPropagation());
  const commit = () => {
    const next = amount.value.trim();
    if (next === it.amount) return;
    it.amount = next;
    persistItem(it.id, { amount: next });
  };
  amount.addEventListener("input", () => {
    // Grow the field with its content (min width handled in CSS).
    amount.style.width = `${Math.max(8, amount.value.length + 2)}ch`;
  });
  amount.addEventListener("change", commit);
  amount.addEventListener("blur", commit);
  amount.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      amount.blur();
    }
  });
  body.appendChild(amount);
  li.appendChild(body);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "sl-item__del";
  del.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  del.setAttribute("aria-label", `Remove ${it.name}`);
  del.addEventListener("click", () => remove(it));
  li.appendChild(del);

  return li;
}

function render() {
  const list = document.getElementById("sl-list");
  if (!list) return;
  list.innerHTML = "";

  ensureOrder();
  const sorted = items
    .slice()
    .sort((a, b) => a.order - b.order || b.at - a.at);

  const open = sorted.filter((i) => !i.done);
  const done = sorted.filter((i) => i.done);

  open.forEach((it) => list.appendChild(row(it)));
  done.forEach((it) => list.appendChild(row(it)));

  const empty = document.getElementById("sl-empty");
  if (empty) empty.hidden = items.length > 0;

  updateProgress();
}

function updateProgress() {
  const total = items.length;
  const doneCount = items.filter((i) => i.done).length;
  const progress = document.getElementById("sl-progress");
  if (progress) progress.hidden = total === 0;
  const fill = document.getElementById("sl-progress-fill");
  if (fill) {
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    fill.style.width = `${pct}%`;
  }
  const text = document.getElementById("sl-progress-text");
  if (text) text.textContent = `${doneCount}/${total}`;
}

// --- Drag & drop reordering ------------------------------------------------

// Pointer-based so it also works with touch (HTML5 drag events do not fire on
// mobile browsers). Dragging is only allowed within the same group (open items
// vs bought items), so bought items can never jump above the active list.
let dragState = null;

function startDrag(e, li, it) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();

  dragState = {
    li,
    it,
    pointerId: e.pointerId,
    list: li.parentElement,
    lastY: e.clientY,
    moved: false
  };
  li.classList.add("is-dragging");
  document.body.classList.add("is-dragging");

  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  requestAnimationFrame(autoScroll);
}

function onDragMove(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;
  dragState.lastY = e.clientY;
  dragState.moved = true;

  const rows = Array.from(
    dragState.list.querySelectorAll(":scope > .sl-item")
  );
  // Insert before the first same-group row whose vertical midpoint is below
  // the pointer.
  let before = null;
  for (const r of rows) {
    if (sameGroup(r, dragState.li) && e.clientY < r.offsetTop + r.offsetHeight / 2) {
      before = r;
      break;
    }
  }

  if (before) {
    if (dragState.li.nextElementSibling !== before) {
      dragState.list.insertBefore(dragState.li, before);
    }
    return;
  }

  // No row below the pointer in this group: drop at the end of the group
  // (i.e. right before the divider / the other group).
  const groupRows = rows.filter(
    (r) => sameGroup(r, dragState.li) && r !== dragState.li
  );
  const last = groupRows[groupRows.length - 1];
  const ref = last ? last.nextSibling : null;
  if (dragState.li.nextSibling !== ref) {
    dragState.list.insertBefore(dragState.li, ref);
  }
}

function sameGroup(a, b) {
  return a.classList.contains("sl-item--done") === b.classList.contains("sl-item--done");
}

// Keep scrolling when the pointer nears the top/bottom edge of the viewport.
function autoScroll() {
  if (!dragState) return;
  const y = dragState.lastY;
  const margin = 72;
  const speed = 12;
  if (y < margin) window.scrollBy(0, -speed);
  else if (y > window.innerHeight - margin) window.scrollBy(0, speed);
  requestAnimationFrame(autoScroll);
}

function endDrag(e) {
  if (!dragState || (e && e.pointerId !== dragState.pointerId)) return;
  const { li, list, moved } = dragState;

  window.removeEventListener("pointermove", onDragMove);
  window.removeEventListener("pointerup", endDrag);
  window.removeEventListener("pointercancel", endDrag);
  li.classList.remove("is-dragging");
  document.body.classList.remove("is-dragging");
  dragState = null;

  // A tap on the grip (no movement): just refresh, nothing to reorder.
  if (!moved) return;

  // Read the new DOM order and mirror it onto the item orders (renumbered).
  // Only real item rows count; the clear-all divider is ignored. Drops are
  // applied per item so concurrent shoppers don't clobber each other.
  Array.from(list.querySelectorAll(":scope > .sl-item")).forEach((row, index) => {
    const item = items.find((i) => i.id === row.dataset.id);
    if (item && item.order !== index) {
      item.order = index;
      persistItem(item.id, { order: index });
    }
  });

  render();
}

// --- Add form --------------------------------------------------------------

function wireAddForm() {
  const form = document.getElementById("sl-add-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const nameEl = document.getElementById("sl-add-name");
    const amountEl = document.getElementById("sl-add-amount");
    const name = nameEl.value.trim();
    const amount = amountEl.value.trim();
    if (!name) return;

    const existing = items.find(
      (i) => i.name.toLowerCase() === name.toLowerCase() && i.amount.toLowerCase() === amount.toLowerCase()
    );
    if (existing) {
      existing.done = false;
      existing.at = Date.now();
      persistItem(existing.id, { done: false, at: existing.at });
    } else {
      const item = { id: newId(), name, amount, note: "", done: false, at: Date.now() };
      items.push(item);
      persistNewItems([item]);
    }
    nameEl.value = "";
    amountEl.value = "";
    nameEl.focus();
    render();
  });
}

// --- Header -----------------------------------------------------------------

// Back to the Recipe Book. Prefer real history when we arrived from there so
// the browser back stack stays intact; otherwise navigate to mealplan.
function wireBack() {
  const back = document.getElementById("sl-back");
  if (!back) return;
  back.addEventListener("click", () => {
    if (window.history.length > 1 && document.referrer) {
      window.history.back();
    } else {
      window.location.href = "mealplan.html";
    }
  });
}

// --- Settings menu (account + shopping actions) ----------------------------

// Close the account/settings dropdown.
function closeSettingsMenu() {
  const menu = document.getElementById("auth-user-menu");
  const toggle = document.getElementById("auth-user-toggle");
  if (menu) menu.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

// Remove every item from the list.
function clearAll() {
  if (!items.length) return;
  if (!confirm("Clear the whole shopping list?")) return;
  items = [];
  persistClearAll();
  render();
  showToast("Shopping list cleared");
}

// Remove only the items already ticked off ("bought").
function clearBought() {
  const bought = items.filter((i) => i.done);
  if (!bought.length) {
    showToast("Nothing bought yet", "error");
    return;
  }
  items = items.filter((i) => !i.done);
  if (signedIn && window.recipeStore && window.recipeStore.removeShoppingItem) {
    // Delete each bought item's own field (concurrency-safe).
    bought.forEach((i) => window.recipeStore.removeShoppingItem(i.id));
  } else {
    writeLocal();
  }
  render();
  showToast("Cleared bought items");
}

function wireSettingsActions() {
  const clearDone = document.getElementById("sl-clear-done");
  if (clearDone) {
    clearDone.addEventListener("click", () => {
      closeSettingsMenu();
      clearBought();
    });
  }
  const clearAllBtn = document.getElementById("sl-clear-all");
  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      closeSettingsMenu();
      clearAll();
    });
  }
}

// --- Auth wiring -----------------------------------------------------------

// True while the user is focused in an editable field or mid-drag; remote
// updates then skip the re-render so we never yank the UI out from under them.
function isBusy() {
  if (dragState) return true;
  const el = document.activeElement;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"));
}

async function syncFromAuth() {
  if (!isSignedIn()) {
    signedIn = false;
    items = readLocal();
    return;
  }

  const local = readLocal();
  let loaded = null;
  try {
    loaded = await window.recipeStore.loadBook();
  } catch (err) {
    console.error("Failed to load shopping list:", err);
    return;
  }
  const cloud = Array.isArray(loaded && loaded.shoppingList)
    ? loaded.shoppingList.map(normalize).filter((i) => i.name)
    : [];

  const merged = mergeLists(cloud, local);
  signedIn = true;

  // Only push up local-only items; cloud items are left untouched so a partner's
  // state isn't overwritten on sign-in.
  const cloudKeys = new Set(cloud.map(keyOf));
  const localOnly = merged.filter(
    (it) => !cloudKeys.has(keyOf(it))
  );
  if (localOnly.length) {
    if (window.recipeStore.upsertShoppingItems) {
      window.recipeStore.upsertShoppingItems(localOnly);
    } else {
      window.recipeStore.saveBook({ shoppingList: merged });
    }
  }
  items = merged;

  if (loaded && loaded.theme) applyTheme(loaded.theme);
  if (loaded && loaded.mode) applyMode(loaded.mode);
}

// Subscribe to live changes from other devices signed into the same account,
// so two people shopping at once stay in sync (ticks, edits, new items).
let stopShoppingListWatch = null;

function startShoppingListWatch() {
  if (!window.recipeStore || !window.recipeStore.watchShoppingList) return;
  if (stopShoppingListWatch) stopShoppingListWatch();
  stopShoppingListWatch = window.recipeStore.watchShoppingList((remote) => {
    if (remote == null) return; // not signed in / no list yet
    if (isBusy()) return; // don't disturb an active edit or drag
    const next = remote.map(normalize).filter((i) => i.name);
    // Skip no-op snapshots (e.g. the echo of our own write).
    if (itemsEqual(next, items)) return;
    items = next;
    render();
  });
}

function itemsEqual(a, b) {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((i) => [i.id, i]));
  return b.every((it) => {
    const other = byId.get(it.id);
    return (
      other &&
      other.name === it.name &&
      other.amount === it.amount &&
      other.done === it.done &&
      other.order === it.order &&
      other.at === it.at
    );
  });
}

function initAuthFlow() {
  const apply = async () => {
    await syncFromAuth();
    render();
    startShoppingListWatch();
  };
  if (window.recipeAuth) {
    window.recipeAuth.onChange(apply);
  } else {
    window.addEventListener("recipeauthchange", apply);
  }
  // Live sync with other devices signed into the same account. Start it now if
  // the store is ready, and again once auth.js finishes loading.
  startShoppingListWatch();
  window.addEventListener("recipeauthready", startShoppingListWatch);
}

// --- Hide-on-scroll header -------------------------------------------------

function wireScrollHeader() {
  const header = document.querySelector(".sl-header");
  if (!header) return;
  const HIDE_AFTER = 80;
  let lastY = window.scrollY || 0;

  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY || 0;
      const down = y > lastY;
      // Hide while scrolling down past the header, reveal on any upward scroll.
      if (down && y > HIDE_AFTER) header.classList.add("sl-header--hidden");
      else if (!down || y <= HIDE_AFTER)
        header.classList.remove("sl-header--hidden");
      lastY = y;
    },
    { passive: true }
  );
}

// --- Auth widget (mirrors the Recipe Book header) --------------------------

function wireAuthWidget() {
  const toggle = document.getElementById("auth-user-toggle");
  const menu = document.getElementById("auth-user-menu");
  if (toggle && menu) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Appearance controls.
  const options = document.getElementById("theme-options");
  if (options) {
    THEMES.forEach((theme) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = `theme-swatch swatch-${theme}`;
      sw.dataset.theme = theme;
      sw.title = theme;
      sw.setAttribute("aria-label", `${theme} theme`);
      if (storedTheme() === theme) sw.classList.add("is-active");
      sw.addEventListener("click", () => {
        applyTheme(theme);
        setThemeColor();
        refreshThemeSwatches();
        persistTheme(theme);
      });
      options.appendChild(sw);
    });
  }

  document.querySelectorAll("#mode-options .appearance-btn").forEach((btn) => {
    const mode = btn.dataset.mode;
    btn.classList.toggle("is-active", document.documentElement.dataset.mode === mode);
    btn.addEventListener("click", () => {
      applyMode(mode);
      setThemeColor();
      document
        .querySelectorAll("#mode-options .appearance-btn")
        .forEach((b) => b.classList.toggle("is-active", b.dataset.mode === mode));
      if (signedIn) window.recipeStore.saveBook({ mode });
    });
  });

  if (!window.recipeAuth) {
    const ready = () => wireAuthWidgetIn();
    window.addEventListener("recipeauthready", ready, { once: true });
    window.addEventListener("recipeauthchange", () => wireAuthWidgetIn(), {
      once: true
    });
    return;
  }
  wireAuthWidgetIn();
}

function refreshThemeSwatches() {
  document.querySelectorAll("#theme-options .theme-swatch").forEach((sw) => {
    sw.classList.toggle("is-active", sw.dataset.theme === storedTheme());
  });
}

function persistTheme(theme) {
  if (signedIn && window.recipeStore) {
    window.recipeStore.saveBook({ theme }).catch(() => {});
  }
}

function wireAuthWidgetIn() {
  const auth = window.recipeAuth;
  if (!auth) return;

  const signinBtn = document.getElementById("auth-signin");
  const accountActions = document.getElementById("auth-account-actions");
  const photo = document.getElementById("auth-user-photo");
  const initials = document.getElementById("auth-user-initials");
  const userIcon = document.getElementById("auth-user-icon");
  const nameEl = document.getElementById("auth-user-name");
  const signoutBtn = document.getElementById("auth-signout");
  const switchBtn = document.getElementById("auth-switch");

  const showPhoto = () => {
    photo.hidden = false;
    initials.hidden = true;
    userIcon.hidden = true;
  };
  const showInitials = () => {
    photo.hidden = true;
    initials.hidden = false;
    userIcon.hidden = true;
  };
  const showIcon = () => {
    photo.hidden = true;
    initials.hidden = true;
    userIcon.hidden = false;
  };

  function getInitials(user) {
    const source = (user.displayName || user.email || "?").trim();
    const parts = source.split(/[\s@._-]+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]).join("");
    return (letters || source[0] || "?").toUpperCase();
  }

  if (signinBtn) {
    signinBtn.addEventListener("click", () => {
      if (document.getElementById("auth-user-menu")) {
        document.getElementById("auth-user-menu").hidden = true;
      }
      auth.signIn();
    });
  }
  if (switchBtn) {
    switchBtn.addEventListener("click", () => {
      if (document.getElementById("auth-user-menu")) {
        document.getElementById("auth-user-menu").hidden = true;
      }
      auth.switchAccount();
    });
  }
  if (signoutBtn) {
    signoutBtn.addEventListener("click", () => {
      if (document.getElementById("auth-user-menu")) {
        document.getElementById("auth-user-menu").hidden = true;
      }
      auth.signOut();
    });
  }
  if (photo) {
    photo.addEventListener("load", showPhoto);
    photo.addEventListener("error", showInitials);
  }

  const renderUser = (user) => {
    const isIn = Boolean(user);
    if (signinBtn) signinBtn.hidden = isIn;
    if (accountActions) accountActions.hidden = !isIn;
    if (!nameEl) return;
    nameEl.hidden = !isIn;
    if (isIn) {
      nameEl.textContent = user.displayName || user.email || "Signed in";
      if (initials) initials.textContent = getInitials(user);
      showInitials();
      if (photo && user.photoURL) photo.src = user.photoURL;
    } else {
      showIcon();
    }
  };

  window.addEventListener("recipeauthchange", (e) => {
    renderUser(e.detail ? e.detail.user : null);
  });
  renderUser(auth.getUser());
}

// --- Boot ------------------------------------------------------------------

function setThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim();
  if (accent) meta.setAttribute("content", accent);
}

function boot() {
  applyTheme(storedTheme());
  applyMode(storedMode() || (prefersDark() ? "dark" : "light"));
  setThemeColor();

  wireAddForm();
  wireBack();
  wireSettingsActions();
  wireAuthWidget();
  wireScrollHeader();
  initAuthFlow();
  render();
}

// The accent variable is only resolvable once the stylesheet is applied.
window.addEventListener("load", setThemeColor);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
