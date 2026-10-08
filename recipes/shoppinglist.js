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
const FONT_STORAGE = "recipeBookFont";
const THEMES = [
  "violet",
  "blueberry",
  "peacock",
  "cyan",
  "lavender",
  "flamingo",
  "tomato",
  "tangerine",
  "banana",
  "sage",
  "basil",
  "grape",
  "graphite"
];
const MODES = ["light", "dark"];
const FONTS = [
  { id: "nunito", name: "Nunito",
    url: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" },
  { id: "quicksand", name: "Quicksand",
    url: "https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap" },
  { id: "poppins", name: "Poppins",
    url: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" },
  { id: "rubik", name: "Rubik",
    url: "https://fonts.googleapis.com/css2?family=Rubik:wght@400;600;700;800&display=swap" },
  { id: "jost", name: "Jost",
    url: "https://fonts.googleapis.com/css2?family=Jost:wght@400;600;700;800&display=swap" },
  { id: "karla", name: "Karla",
    url: "https://fonts.googleapis.com/css2?family=Karla:wght@400;600;700;800&display=swap" },
  { id: "fredoka", name: "Fredoka",
    url: "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap" },
  { id: "baloo2", name: "Baloo 2",
    url: "https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;700;800&display=swap" },
  { id: "comfortaa", name: "Comfortaa",
    url: "https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap" },
  { id: "dmsans", name: "DM Sans",
    url: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap" },
  { id: "spacegrotesk", name: "Space Grotesk",
    url: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" },
  { id: "inter", name: "Inter",
    url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" }
];
let loadedFonts = new Set();

let items = [];
let signedIn = false;
// Ids rendered during the previous render(), so we only play the entry
// animation for genuinely new rows (and never re-flash the whole list).
let lastRenderedIds = new Set();
// While our own per-item order writes settle, ignore live-sync snapshots that
// only differ by order (they would otherwise rebuild the list mid-sync).
const ORDER_ECHO_MS = 1500;
let orderEchoUntil = 0;

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

function fontFor(id) {
  return FONTS.find((f) => f.id === id) || FONTS[0];
}

function loadFont(id) {
  const f = fontFor(id);
  if (!f || loadedFonts.has(f.id) || document.getElementById(`gf-${f.id}`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.id = `gf-${f.id}`;
  link.href = f.url;
  link.onload = () => loadedFonts.add(f.id);
  link.onerror = () => loadedFonts.add(f.id);
  document.head.appendChild(link);
}

function applyFont(font) {
  const f = fontFor(font);
  document.documentElement.style.setProperty(
    "--font",
    `"${f.name}", system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`
  );
  try {
    localStorage.setItem(FONT_STORAGE, f.id);
  } catch (_) {
    /* ignore */
  }
  const sel = document.getElementById("font-select");
  if (sel) sel.value = f.id;
  loadFont(f.id);
}

function storedFont() {
  try {
    return localStorage.getItem(FONT_STORAGE) || "nunito";
  } catch (_) {
    return "nunito";
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

// Ticking/removing reflows the list (the row moves to the bottom, or another
// item slides up into its place). Some browsers then fire a second synthetic
// "click" at the same screen position, which used to land on the item that
// moved up underneath — ticking the wrong row. Ignore such repeat taps at the
// same spot within a short window.
let lastTap = { x: 0, y: 0, t: 0 };

function isRepeatTap(e) {
  // Keyboard activation has no coordinates (clientX/Y are 0) — never suppress
  // those, only real taps/clicks that arrive at the same spot.
  if (!e || (!e.clientX && !e.clientY)) return false;
  const dt = Date.now() - lastTap.t;
  const dist = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y);
  return dt < 600 && dist < 30;
}

function rememberTap(e) {
  if (e && (e.clientX || e.clientY)) {
    lastTap = { x: e.clientX, y: e.clientY, t: Date.now() };
  }
}

function makeCheck(it) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sl-item__check";
  btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
  btn.setAttribute("aria-pressed", String(it.done));
  btn.setAttribute("aria-label", `${it.done ? "Untick" : "Tick"} ${it.name}`);
  btn.addEventListener("click", (e) => toggle(it, e));
  return btn;
}

function toggle(it, e) {
  if (isRepeatTap(e)) return;
  rememberTap(e);
  applyToggle(it);
}

// Tick / untick (used by tap and by a right-swipe).
function applyToggle(it) {
  it.done = !it.done;
  it.at = Date.now();
  // Unticking brings the item back among the "to buy" items, on top.
  if (!it.done) it.order = nextTopOrder();
  persistItem(it.id, { done: it.done, at: it.at, order: it.order });
  vibrate(10);
  render();
}

function remove(it, e) {
  if (isRepeatTap(e)) return;
  rememberTap(e);
  applyRemove(it);
}

// Delete an item (used by the ✕ button and by a left-swipe).
function applyRemove(it) {
  items = items.filter((x) => x !== it);
  persistRemoveItem(it.id);
  vibrate(15);
  render();
}

function vibrate(ms) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(ms);
    } catch (_) {
      /* ignore */
    }
  }
}

// Turn a name span into an inline text field. Commits on Enter/blur, cancels
// on Escape or an unchanged value.
function editName(span, it) {
  if (span.dataset.editing === "1") return;
  span.dataset.editing = "1";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "sl-item__name-edit";
  input.value = it.name;
  input.setAttribute("aria-label", "Item name");
  input.classList.add("sl-no-gesture");

  let cancelled = false;
  const commit = () => {
    if (input.dataset.done === "1") return;
    input.dataset.done = "1";
    const next = input.value.trim();
    if (!cancelled && next && next !== it.name) {
      it.name = next;
      persistItem(it.id, { name: next });
    }
    render();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelled = true;
      input.blur();
    }
  });
  input.addEventListener("blur", commit);
  // Keep taps/clicks inside the field from reaching the row gesture.
  ["pointerdown", "click"].forEach((type) =>
    input.addEventListener(type, (e) => e.stopPropagation())
  );

  span.replaceWith(input);
  input.focus();
  input.select();
}

function row(it) {
  const li = document.createElement("li");
  li.className = "sl-item" + (it.done ? " sl-item--done" : "");
  // Only play the entry animation for rows that weren't on screen last time;
  // re-rendering the list (e.g. a remote sync) must not re-flash the rows.
  if (lastRenderedIds.has(it.id)) li.classList.add("sl-item--no-enter");
  li.dataset.id = it.id;

  // The swipeable content layer. The action backgrounds sit behind it.
  const content = document.createElement("div");
  content.className = "sl-item__content";

  const grip = document.createElement("span");
  grip.className = "sl-item__grip";
  grip.innerHTML = '<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>';
  grip.setAttribute("aria-hidden", "true");
  content.appendChild(grip);

  content.appendChild(makeCheck(it));

  const body = document.createElement("div");
  body.className = "sl-item__body";

  const name = document.createElement("span");
  name.className = "sl-item__name";
  name.textContent = it.name;
  body.appendChild(name);
  // Editable amount, sitting right next to the name. Tapping it edits the
  // amount instead of ticking the item off.
  const amount = document.createElement("input");
  amount.type = "text";
  amount.className = "sl-item__amount";
  amount.value = it.amount || "";
  amount.placeholder = "amount";
  amount.setAttribute("aria-label", `Amount for ${it.name}`);
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
  // Let the pointer gesture treat the amount field as non-swipeable/clickable.
  amount.classList.add("sl-no-gesture");
  body.appendChild(amount);
  content.appendChild(body);

  // Desktop affordance: a visible ✕ to remove without swiping. Hidden on
  // touch layouts, where a left-swipe deletes instead.
  const del = document.createElement("button");
  del.type = "button";
  del.className = "sl-item__del sl-no-gesture";
  del.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  del.setAttribute("aria-label", `Remove ${it.name}`);
  del.addEventListener("click", (e) => remove(it, e));
  content.appendChild(del);

  li.appendChild(content);

  // Swipe action backgrounds (revealed as the content slides).
  const actionTick = document.createElement("div");
  actionTick.className = "sl-item__action sl-item__action--tick";
  actionTick.innerHTML =
    '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>' +
    `<span>${it.done ? "Untick" : "Tick"}</span>`;

  const actionDel = document.createElement("div");
  actionDel.className = "sl-item__action sl-item__action--delete";
  actionDel.innerHTML =
    '<i class="fa-solid fa-trash-can" aria-hidden="true"></i><span>Delete</span>';

  li.appendChild(actionTick);
  li.appendChild(actionDel);

  wireItemGesture(li, content, it);

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

  lastRenderedIds = new Set(items.map((i) => i.id));

  const empty = document.getElementById("sl-empty");
  if (empty) empty.hidden = items.length > 0;

  const clearRow = document.getElementById("sl-clear-row");
  if (clearRow) clearRow.hidden = items.length === 0;

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

// --- Row gestures: long-press to drag, swipe to act, tap to tick -----------
//
// All handled with pointer events (which — unlike HTML5 drag events — fire on
// touch). One handler per row decides between:
//   • tap                     → tick / untick
//   • swipe right             → tick / untick
//   • swipe left              → delete
//   • press & hold            → pick the row up and drag it to reorder
// The amount field and the ✕ button opt out (.sl-no-gesture) so they behave
// natively.

const TAP_SLOP = 12; // px of movement still counted as a tap
const SWIPE_START = 12; // px before a horizontal swipe begins
const SWIPE_ACTION = 90; // px to trigger the swipe action
const LONG_PRESS = 380; // ms to pick up a row for dragging
const SWIPE_MAX = 140; // furthest the content follows the finger

function wireItemGesture(li, content, it) {
  let g = null; // active gesture

  const clearTimer = () => {
    if (g && g.timer) {
      clearTimeout(g.timer);
      g.timer = null;
    }
  };
  const detach = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const onDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (dragState) return;
    // Let the amount field and the ✕ button work normally.
    if (e.target.closest(".sl-no-gesture") || e.target.closest(".sl-item__del")) {
      return;
    }

    g = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      t0: Date.now(),
      mode: null,
      dx: 0,
      pointerType: e.pointerType,
      startEl: e.target
    };

    // Grabbing the handle starts a drag straight away.
    if (e.target.closest(".sl-item__grip")) {
      // Stop the browser from starting a native drag / text selection, which
      // would cancel the pointer stream and abort the reorder.
      e.preventDefault();
      beginDrag(li, it, e.clientX, e.clientY);
      g.mode = "drag";
    } else {
      // Otherwise a long press anywhere on the row picks it up.
      g.timer = setTimeout(() => {
        if (!g || g.mode === "swipe") return;
        g.mode = "drag";
        content.style.transform = "";
        li.classList.remove("is-swiping");
        beginDrag(li, it, g.lastX, g.lastY);
      }, LONG_PRESS);
    }

    try {
      li.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    // Listen on window (not li): reordering re-inserts the row, which drops the
    // row's pointer capture, so row-scoped listeners would stop mid-drag.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const onMove = (e) => {
    if (!g || e.pointerId !== g.id) return;
    g.lastX = e.clientX;
    g.lastY = e.clientY;

    if (g.mode === "drag") {
      e.preventDefault();
      moveDrag(e.clientY);
      return;
    }

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;

    if (g.mode === "swipe") {
      e.preventDefault();
      g.dx = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
      content.style.transform = `translateX(${g.dx}px)`;
      li.classList.toggle("is-swiping", true);
      return;
    }

    // Decide: horizontal swipe, or a vertical scroll we should leave alone.
    if (Math.abs(dx) > SWIPE_START && Math.abs(dx) > Math.abs(dy) * 1.2) {
      clearTimer();
      g.mode = "swipe";
      g.dx = dx;
      content.style.transform = `translateX(${dx}px)`;
      li.classList.add("is-swiping");
    } else if (Math.abs(dy) > TAP_SLOP) {
      // Vertical scroll — cancel the long-press so we don't hijack scrolling.
      clearTimer();
    }
  };

  const onUp = (e) => {
    if (!g || e.pointerId !== g.id) return;
    clearTimer();
    detach();
    try {
      li.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }

    const wasDrag = g.mode === "drag";
    const wasSwipe = g.mode === "swipe";
    const dx = g.dx;
    const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
    const duration = Date.now() - g.t0;
    const pointerType = g.pointerType;
    const startEl = g.startEl;
    g = null;

    if (wasDrag) {
      endDrag();
      // Swallow the click that immediately follows the pointerup so releasing
      // a drag never ticks/unticks the row or opens the name editor.
      suppressNextClick(li);
      return;
    }

    if (wasSwipe) {
      if (dx <= -SWIPE_ACTION) {
        slideOut(li, "left", () => applyRemove(it));
      } else if (dx >= SWIPE_ACTION) {
        slideOut(li, "right", () => applyToggle(it));
      } else {
        settleBack(li, content);
      }
      suppressNextClick(li);
      return;
    }

    if (moved > TAP_SLOP || duration >= LONG_PRESS) return;

    // On touch, tapping the name (or the empty area of the row) edits it;
    // the check circle and the desktop mouse toggle instead.
    const onName = startEl && startEl.closest && startEl.closest(".sl-item__name");
    if (
      (onName || (startEl && startEl.closest && startEl.closest(".sl-item__body"))) &&
      pointerType !== "mouse"
    ) {
      suppressNextClick(li);
      const span = li.querySelector(".sl-item__name");
      if (span) editName(span, it);
      return;
    }

    // Plain tap on the check circle (or a mouse click anywhere) → tick / untick.
    applyToggle(it);
    suppressNextClick(li);
  };

  const onCancel = (e) => {
    if (!g || e.pointerId !== g.id) return;
    clearTimer();
    detach();
    const wasDrag = g.mode === "drag";
    const wasSwipe = g.mode === "swipe";
    g = null;
    if (wasDrag) endDrag();
    else if (wasSwipe) settleBack(li, content);
  };

  li.addEventListener("pointerdown", onDown);
}

// Swallow the click the browser fires right after a swipe/tap we already
// handled, so the check button doesn't react a second time.
function suppressNextClick(li) {
  const swallow = (e) => {
    e.stopPropagation();
    e.preventDefault();
    li.removeEventListener("click", swallow, true);
  };
  li.addEventListener("click", swallow, true);
  setTimeout(() => li.removeEventListener("click", swallow, true), 400);
}

function settleBack(li, content) {
  content.style.transition = "transform 0.18s ease";
  content.style.transform = "translateX(0px)";
  li.classList.remove("is-swiping");
  setTimeout(() => {
    content.style.transition = "";
  }, 200);
}

function slideOut(li, dir, done) {
  const content = li.querySelector(".sl-item__content");
  li.classList.add("is-removing", `is-removing--${dir}`);
  if (content) {
    content.style.transition = "transform 0.2s ease, opacity 0.2s ease";
    content.style.transform = `translateX(${dir === "left" ? "-110%" : "110%"})`;
    content.style.opacity = "0";
  }
  vibrate(dir === "left" ? 18 : 10);
  setTimeout(done, 160);
}

// --- Drag & drop reordering ------------------------------------------------

// Dragging is only allowed within the same group (open items vs bought items),
// so bought items can never jump above the active list.
let dragState = null;

function beginDrag(li, it, x, y) {
  dragState = {
    li,
    it,
    list: li.parentElement,
    lastY: y,
    moved: false
  };
  li.classList.add("is-dragging");
  document.body.classList.add("is-dragging");
  vibrate(15);
  requestAnimationFrame(autoScroll);
}

function moveDrag(clientY) {
  if (!dragState) return;
  dragState.lastY = clientY;
  dragState.moved = true;

  const rows = Array.from(
    dragState.list.querySelectorAll(":scope > .sl-item")
  );
  // Insert before the first same-group row whose vertical midpoint is below
  // the pointer. Compare viewport coordinates (clientY is viewport-based, and
  // offsetTop is document-relative — mixing them misplaces rows once the page
  // is scrolled, e.g. when autoScroll kicks in mid-drag).
  let before = null;
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (sameGroup(r, dragState.li) && clientY < mid) {
      before = r;
      break;
    }
  }

  if (before) {
    if (dragState.li.nextElementSibling !== before) {
      reorder(dragState.list, rows, dragState.li, before);
    }
    return;
  }

  // No row below the pointer in this group: drop at the end of the group
  // (i.e. right before the other group).
  const groupRows = rows.filter(
    (r) => sameGroup(r, dragState.li) && r !== dragState.li
  );
  const last = groupRows[groupRows.length - 1];
  const ref = last ? last.nextSibling : null;
  if (dragState.li.nextSibling !== ref) {
    reorder(dragState.list, rows, dragState.li, ref);
  }
}

// Move the dragged row into place and animate the rows it displaces with a
// FLIP slide (record positions, move, then translate back and release), so the
// list glides instead of snapping.
function reorder(list, rows, dragged, ref) {
  const shifted = rows.filter(
    (r) => r !== dragged && sameGroup(r, dragged)
  );
  const before = new Map(
    shifted.map((r) => [r, r.getBoundingClientRect().top])
  );

  list.insertBefore(dragged, ref);

  shifted.forEach((r) => {
    const dy = before.get(r) - r.getBoundingClientRect().top;
    if (!dy) return;
    r.style.transition = "none";
    r.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      r.style.transition = "transform 0.16s var(--ease)";
      r.style.transform = "";
    });
  });
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

function endDrag() {
  if (!dragState) return;
  const { li, list, moved } = dragState;
  li.classList.remove("is-dragging");
  document.body.classList.remove("is-dragging");
  dragState = null;

  if (!moved) {
    render();
    return;
  }

  // Read the new DOM order and mirror it onto the item orders (renumbered).
  // Persist every row (not just the ones that moved) so the stored list is
  // self-consistent; otherwise an item that kept its in-memory order but was
  // never written would come back from a remote snapshot with order = null.
  Array.from(list.querySelectorAll(":scope > .sl-item")).forEach((row, index) => {
    const item = items.find((i) => i.id === row.dataset.id);
    if (item) {
      item.order = index;
      persistItem(item.id, { order: index });
    }
  });

  // The per-item order writes come back as a burst of live-sync snapshots;
  // ignore any that only differ by order for a short window so the list isn't
  // rebuilt (and re-animated) while our own writes settle.
  orderEchoUntil = Date.now() + ORDER_ECHO_MS;

  // The DOM already reflects the new order and only the item orders changed —
  // re-rendering here would rebuild every row and replay the entry animation
  // ("everything blinks"). Instead just play a small settle animation on the
  // dropped row (and a matching pulse on the list).
  li.classList.add("sl-item--dropped");
  list.classList.add("sl-list--drop");
  const clear = () => {
    li.classList.remove("sl-item--dropped");
    list.classList.remove("sl-list--drop");
  };
  li.addEventListener("animationend", clear, { once: true });
  setTimeout(clear, 500);
}

// Stop the page from scrolling while a row is being dragged, even though rows
// allow vertical panning (touch-action: pan-y). The listener is non-passive so
// preventDefault works before the browser claims the gesture.
function wireListTouchGuards() {
  const list = document.getElementById("sl-list");
  if (!list) return;
  list.addEventListener(
    "touchmove",
    (e) => {
      if (dragState || list.querySelector(".sl-item.is-swiping")) {
        e.preventDefault();
      }
    },
    { passive: false }
  );
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
  if (loaded && loaded.font) applyFont(loaded.font);
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
    // Skip no-op snapshots (e.g. the echo of our own write). Most notably, the
    // per-item order writes after a drag arrive as a burst of partial snapshots
    // whose ordering is temporarily inconsistent — re-rendering then would
    // needlessly rebuild (and re-animate) every row.
    if (itemsEqual(next, items)) return;
    const orderOnly =
      contentEqual(next, items) &&
      Date.now() < orderEchoUntil;
    if (orderOnly) {
      // Adopt the newer order values without touching the DOM.
      const remoteOrder = new Map(
        next.filter((i) => Number.isFinite(i.order)).map((i) => [i.id, i.order])
      );
      items.forEach((it) => {
        if (remoteOrder.has(it.id)) it.order = remoteOrder.get(it.id);
      });
      return;
    }
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

// Everything except `order` — used to detect a snapshot that only differs by a
// (partial) order echo after a drag.
function contentEqual(a, b) {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((i) => [i.id, i]));
  return b.every((it) => {
    const other = byId.get(it.id);
    return (
      other &&
      other.name === it.name &&
      other.amount === it.amount &&
      other.done === it.done &&
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

// --- Compact-on-scroll header ----------------------------------------------

// Collapse the title/actions row while scrolling down so the progress bar
// stays pinned (and shrinks) at the top; restore the full header on scroll up.
function wireScrollHeader() {
  const header = document.querySelector(".sl-header");
  if (!header) return;
  const COMPACT_AFTER = 40;
  const EXPAND_BELOW = 40;
  let lastY = window.scrollY || 0;

  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY || 0;
      const down = y > lastY;
      if (down && y > COMPACT_AFTER) header.classList.add("sl-header--compact");
      else if (!down && y <= EXPAND_BELOW)
        header.classList.remove("sl-header--compact");
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

  const fontSelect = document.getElementById("font-select");
  if (fontSelect) {
    fontSelect.innerHTML = "";
    FONTS.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name;
      opt.style.fontFamily = `"${f.name}", sans-serif`;
      fontSelect.appendChild(opt);
    });
    fontSelect.value = storedFont();
    fontSelect.addEventListener("change", () => {
      applyFont(fontSelect.value);
      persistFont(fontSelect.value);
      document.getElementById("font-select").value = fontSelect.value;
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

function persistFont(font) {
  if (signedIn && window.recipeStore) {
    window.recipeStore.saveBook({ font }).catch(() => {});
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
  applyFont(storedFont());
  setThemeColor();

  wireAddForm();
  wireSettingsActions();
  wireAuthWidget();
  wireScrollHeader();
  wireListTouchGuards();
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
