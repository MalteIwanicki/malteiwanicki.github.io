// Recipe Book logic.
//
// Recipes are private per user: the signed-in user's book (recipes + selected
// meals) is loaded from Firestore and every recipe is a Cooklang .cook document.
// Cards, the shopping list and selection are all derived by parsing that source.

import {
  loadParser,
  parseRecipe,
  serializeRecipe,
  parserStatus
} from "./cooklang.js";

// --- Ingredient name grouping ----------------------------------------------
// Canonical names for ingredients that are written differently across recipes,
// so that the same ingredient is grouped together in the summary.
const ingredientAliases = {
  potatoes: "potato",
  onions: "onion",
  "red onions": "onion",
  egg: "eggs",
  courgette: "courgettes",
  "spring onion": "spring onions",
  parmesan: "parmesan cheese",
  "mixed vegetables": "frozen mixed veggies",
  "frozen mixed vegetables": "frozen mixed veggies",
  vegetables: "frozen mixed veggies",
  porree: "leek",
  schalotten: "schallots",
  chili: "chilli",
  oil: "olive oil",
  "grated tasty cheese": "grated cheese",
  "salt and pepper": "salt",
  peas: "frozen peas",
  "hot water": "water",
  "potato slices or frozen chips": "chips",
  "oven potatoes / chips": "chips",
  toastbrötchen: "toasties",
  "english muffins": "toasties",
  "toast or english muffins": "toasties",
  "mittelscharfer senf": "mustard",
  petersilie: "parsley",
  "eierspätzle frisch": "spätzle",
  tumeric: "turmeric",
  apple: "apples"
};

function normalizeIngredient(name) {
  if (!name) return name;
  const trimmed = String(name).trim();
  return ingredientAliases[trimmed.toLowerCase()] || trimmed;
}

// --- App state -------------------------------------------------------------

let book = { recipes: [], selectedMeals: [], staples: [], links: {}, theme: "violet", checkedItems: [] };
let parsedCache = new Map();
let editMode = false;
let selectedRecipes = [];
let recipesRendered = false;
let currentEditId = null;
let currentDialogMode = "form";

// The user's book is the source of truth for staples and shopping links.
function getStaples() {
  return Array.isArray(book.staples) ? book.staples : [];
}

// How many of a staple to buy, e.g. 1 (default) or 2. Legacy books just stored
// a repeat count via duplicate entries, which auth.js folds into amounts.
function getStapleAmount(name) {
  const amounts = book.stapleAmounts;
  if (amounts && typeof amounts === "object" && amounts[name] != null) {
    const n = parseInt(amounts[name], 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  return 1;
}

function getLinks() {
  return book.links && typeof book.links === "object" ? book.links : {};
}

// Names the user has already ticked off the shopping list (struck through).
function getChecked() {
  return new Set(Array.isArray(book.checkedItems) ? book.checkedItems : []);
}

// Persist the ticked-off set and refresh the shopping list.
function setChecked(set) {
  book.checkedItems = Array.from(set);
  scheduleSave({ checkedItems: book.checkedItems });
  renderSummary();
}

// A visible circular tick control for a shopping-list row.
function summaryCheckButton(name, isDone) {
  const btn = el("button", "summary-item__check");
  btn.type = "button";
  btn.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
  btn.setAttribute("aria-pressed", String(isDone));
  btn.setAttribute("aria-label", `${isDone ? "Untick" : "Tick off"} ${name}`);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const set = getChecked();
    if (set.has(name)) set.delete(name);
    else set.add(name);
    setChecked(set);
  });
  return btn;
}

// Wire a shopping-list item so clicking it toggles its "done" state. Attached
// to the name span (not the link) so it survives the link being re-rendered by
// the translation helper.
function wireCheckedToggle(nameItem, name) {
  nameItem.addEventListener("click", () => {
    const set = getChecked();
    if (set.has(name)) set.delete(name);
    else set.add(name);
    setChecked(set);
  });
}

// --- Small helpers ---------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Toasts ----------------------------------------------------------------

function showToast(message, variant = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = el("div", `toast toast--${variant}`);
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

// --- Theme -----------------------------------------------------------------
// Google Calendar inspired palettes (see style.css for the color values).
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
const THEME_STORAGE = "recipeBookTheme";
const MODE_STORAGE = "recipeBookMode";
const MODES = ["light", "dark"];

function prefersDark() {
  return Boolean(
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function storedMode() {
  try {
    return localStorage.getItem(MODE_STORAGE); // null when never chosen
  } catch (_) {
    return null;
  }
}

function applyMode(mode, persist = true) {
  const m = MODES.includes(mode) ? mode : "light";
  document.documentElement.dataset.mode = m;
  book.mode = m;
  if (persist) {
    try {
      localStorage.setItem(MODE_STORAGE, m);
    } catch (_) {
      /* ignore */
    }
  }
  document.querySelectorAll("#mode-options .appearance-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.mode === m);
  });
}

function applyTheme(theme, persist = true) {
  const t = THEMES.includes(theme) ? theme : "violet";
  document.documentElement.dataset.theme = t;
  book.theme = t;
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE, t);
    } catch (_) {
      /* ignore */
    }
  }
  document.querySelectorAll("#theme-options .theme-swatch").forEach((sw) => {
    sw.classList.toggle("is-active", sw.dataset.theme === t);
  });
}

function storedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE) || "violet";
  } catch (_) {
    return "violet";
  }
}

// A calm, emoji-free title. (Kept as a hook in case per-recipe icons return.)

// --- Data loading ----------------------------------------------------------

function getParsed(recipe) {
  if (!parsedCache.has(recipe.id)) {
    try {
      parsedCache.set(recipe.id, parseRecipe(recipe.source));
    } catch (err) {
      console.error("Failed to parse recipe", recipe.id, err);
      parsedCache.set(recipe.id, {
        title: recipe.title || "Untitled recipe",
        ingredients: [],
        steps: [],
        cookware: [],
        timers: [],
        source: recipe.source
      });
    }
  }
  return parsedCache.get(recipe.id);
}

function invalidate(id) {
  if (id) parsedCache.delete(id);
  else parsedCache.clear();
}

// --- Rendering -------------------------------------------------------------

function renderEmptyState() {
  const container = document.getElementById("recipes-container");
  container.innerHTML = "";
  const box = el("div", "empty-state");
  const signedIn = window.recipeStore && window.recipeStore.isReady();
  const mark = el("div", "empty-state__mark");
  mark.innerHTML = signedIn
    ? '<i class="fa-solid fa-utensils" aria-hidden="true"></i>'
    : '<i class="fa-solid fa-lock" aria-hidden="true"></i>';
  box.appendChild(mark);
  box.appendChild(
    el(
      "p",
      "empty-state__title",
      signedIn ? "No recipes yet" : "Sign in to see your recipe book"
    )
  );
  if (signedIn) {
    box.appendChild(
      el(
        "p",
        "empty-state__hint",
        "Use “Add recipe” to create your first one."
      )
    );
  }
  container.appendChild(box);
}

function renderBook() {
  const container = document.getElementById("recipes-container");
  container.innerHTML = "";
  recipesRendered = true;
  updateRecipeCount();
  syncSummaryPlacement();

  if (!book.recipes.length) {
    renderEmptyState();
    updateSummary();
    updateSelectedCount();
    return;
  }

  const selected = new Set(book.selectedMeals);
  book.recipes.forEach((recipe) => {
    container.appendChild(createRecipeCard(recipe, selected.has(recipe.id)));
  });
  updateSummary();
  updateSelectedCount();
}

function createRecipeCard(recipe, isSelected) {
  const parsed = getParsed(recipe);
  const title = parsed.title || recipe.title || "Untitled recipe";

  const card = el("div", "recipe");
  card.dataset.id = recipe.id;
  if (isSelected) card.classList.add("selected");

  const head = el("div", "recipe__head");
  const monogram = el(
    "span",
    "recipe__monogram",
    (title.trim()[0] || "?").toUpperCase()
  );
  monogram.setAttribute("aria-hidden", "true");
  const heading = el("div", "recipe__heading");
  heading.appendChild(el("h2", "recipe__title", title));
  const stepCount = parsed.steps.filter((s) => s.text).length;
  const meta = el("div", "recipe__meta");
  const ingMeta = el("span");
  ingMeta.innerHTML = `<i class="fa-solid fa-carrot" aria-hidden="true"></i> ${parsed.ingredients.length} ingredients`;
  const stepMeta = el("span");
  stepMeta.innerHTML = `<i class="fa-solid fa-list-ol" aria-hidden="true"></i> ${stepCount} steps`;
  meta.appendChild(ingMeta);
  meta.appendChild(stepMeta);
  heading.appendChild(meta);
  head.appendChild(monogram);
  head.appendChild(heading);
  card.appendChild(head);

  if (editMode) {
    card.classList.add("recipe--editing");
    card.draggable = true;

    const handle = el("button", "recipe__handle");
    handle.type = "button";
    handle.innerHTML = '<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>';
    handle.setAttribute("aria-label", `Drag ${title} to reorder`);
    card.appendChild(handle);

    const actions = el("div", "recipe__actions");
    const editBtn = el("button", "btn btn--soft btn--sm");
    editBtn.type = "button";
    editBtn.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i> Edit';
    editBtn.setAttribute("aria-label", `Edit ${title}`);
    editBtn.addEventListener("click", () => openEditor(recipe.id));
    const delBtn = el("button", "btn btn--soft btn--sm");
    delBtn.type = "button";
    delBtn.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i> Delete';
    delBtn.setAttribute("aria-label", `Delete ${title}`);
    delBtn.addEventListener("click", () => deleteRecipe(recipe.id));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    card.appendChild(actions);

    wireDragAndDrop(card);
  }

  // Select checkbox (selecting is about shopping, not editing).
  const checkbox = el("input", "recipe-checkbox");
  checkbox.type = "checkbox";
  checkbox.checked = isSelected;
  checkbox.dataset.id = recipe.id;
  checkbox.setAttribute("aria-label", `Select ${title}`);
  checkbox.addEventListener("change", () => {
    card.classList.toggle("selected", checkbox.checked);
    toggleSelected(recipe.id, checkbox.checked);
  });
  card.appendChild(checkbox);

  // Ingredients
  const ingredientsDetails = el("details", "card-section");
  ingredientsDetails.appendChild(el("summary", null, "Ingredients"));
  const ingredientsList = el("ul", "ingredients-list");
  parsed.ingredients.forEach((ing) => {
    const li = el("li");
    li.appendChild(el("span", "name", normalizeIngredient(ing.name)));
    if (ing.amount) li.appendChild(el("span", "amount", `, ${ing.amount}`));
    if (ing.unit) li.appendChild(el("span", "unit", ` ${ing.unit}`));
    if (ing.how) li.appendChild(el("span", "how", `, ${ing.how}`));
    ingredientsList.appendChild(li);
  });
  if (!parsed.ingredients.length) {
    ingredientsList.appendChild(el("li", "muted", "No ingredients yet"));
  }
  ingredientsDetails.appendChild(ingredientsList);
  card.appendChild(ingredientsDetails);

  // Instructions
  const instructionsDetails = el("details", "card-section");
  instructionsDetails.appendChild(el("summary", null, "Instructions"));
  const instructionsList = el("ol");
  parsed.steps.forEach((step) => {
    if (step.text) instructionsList.appendChild(el("li", null, step.text));
  });
  if (!parsed.steps.filter((s) => s.text).length) {
    instructionsList.appendChild(el("li", "muted", "No steps yet"));
  }
  instructionsDetails.appendChild(instructionsList);
  card.appendChild(instructionsDetails);

  const handleToggle = () => {
    if (ingredientsDetails.open || instructionsDetails.open) {
      card.classList.add("expanded");
    } else {
      card.classList.remove("expanded");
    }
  };
  ingredientsDetails.addEventListener("toggle", handleToggle);
  instructionsDetails.addEventListener("toggle", handleToggle);

  return card;
}

// --- Selection -------------------------------------------------------------

function updateRecipeCount() {
  const countEl = document.getElementById("recipe-count");
  if (!countEl) return;
  const n = book.recipes.length;
  countEl.textContent = n === 1 ? "1 recipe" : `${n} recipes`;
}

function toggleSelected(id, isSelected) {
  const set = new Set(book.selectedMeals);
  if (isSelected) set.add(id);
  else set.delete(id);
  book.selectedMeals = Array.from(set);
  scheduleSave({ selectedMeals: book.selectedMeals });
  updateSummary();
  updateSelectedCount();
}

function updateSelectedCount() {
  const boxes = document.querySelectorAll(".recipe-checkbox");
  const count = document.querySelectorAll(".recipe-checkbox:checked").length;
  const countEl = document.getElementById("selected-count");
  if (countEl) countEl.textContent = String(count);

  const bar = document.getElementById("selection-bar");
  if (bar) bar.hidden = count === 0 || boxes.length === 0;

  syncFab();
}

// --- Mobile shopping sheet / FAB -------------------------------------------

function isMobileLayout() {
  return Boolean(
    window.matchMedia && window.matchMedia("(max-width: 1024px)").matches
  );
}

// Keep the single summary card in the right container: the desktop sidebar on
// wide screens, the bottom-sheet slot on small ones.
function syncSummaryPlacement() {
  const card = document.getElementById("summary-card");
  if (!card) return;
  const panel = document.getElementById("summary-panel");
  const slot = document.getElementById("summary-sheet-slot");
  if (isMobileLayout()) {
    if (slot && card.parentElement !== slot) slot.appendChild(card);
  } else {
    if (panel && card.parentElement !== panel) panel.appendChild(card);
  }
  syncFab();
}

// The floating button only appears on small screens for signed-in users who
// actually have something on their list.
function syncFab() {
  const fab = document.getElementById("summary-fab");
  if (!fab) return;
  const signedIn = document.body.classList.contains("signed-in");
  const hasList = selectedRecipes.length > 0 || getStaples().length > 0;
  fab.hidden = !(isMobileLayout() && signedIn && hasList);

  const badge = document.getElementById("summary-fab-count");
  if (badge) {
    const total = document.querySelectorAll(
      "#summary-list .summary-items > li"
    ).length;
    badge.hidden = total === 0;
    badge.textContent = String(total);
  }
}

function openSummarySheet() {
  const sheet = document.getElementById("summary-sheet");
  if (!sheet) return;
  if (!isMobileLayout()) return;
  if (typeof sheet.showModal === "function") sheet.showModal();
  else sheet.setAttribute("open", "");
}

function closeSummarySheet() {
  const sheet = document.getElementById("summary-sheet");
  if (!sheet) return;
  if (typeof sheet.close === "function") sheet.close();
  else sheet.removeAttribute("open");
}

// --- Saving (debounced) ----------------------------------------------------

let saveTimer = null;

function scheduleSave(partial) {
  if (!window.recipeStore || !window.recipeStore.isReady()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.recipeStore
      .saveBook(partial)
      .catch((err) => console.error("Failed to save book:", err));
  }, 400);
}

// --- Shopping list / summary ----------------------------------------------

const unicodeFractions = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
  "⅙": 1 / 6, "⅚": 5 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875
};

function parseSingleAmount(value) {
  const s = String(value).trim();
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    return parseFloat(s.replace(",", "."));
  }
  const fractionMatch = s.match(/^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/);
  if (fractionMatch) {
    const whole = fractionMatch[1] ? parseInt(fractionMatch[1], 10) : 0;
    return whole + unicodeFractions[fractionMatch[2]];
  }
  return null;
}

function parseAmountRange(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const rangeMatch = s.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/);
  if (rangeMatch) {
    return {
      min: parseFloat(rangeMatch[1].replace(",", ".")),
      max: parseFloat(rangeMatch[2].replace(",", "."))
    };
  }
  const single = parseSingleAmount(s);
  return single == null ? null : { min: single, max: single };
}

function formatAmountValue(value) {
  if (Number.isInteger(value)) return String(value);
  const fractions = [
    [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"],
    [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [7 / 8, "⅞"]
  ];
  const whole = Math.floor(value);
  const fraction = value - whole;
  for (const [amount, symbol] of fractions) {
    if (Math.abs(fraction - amount) < 0.001) {
      return whole > 0 ? `${whole}${symbol}` : symbol;
    }
  }
  return String(Math.round(value * 100) / 100);
}

function normalizeUnit(unit) {
  if (!unit) return "";
  const u = String(unit).trim().toLowerCase();
  const aliases = {
    piece: "", pieces: "", pc: "", pcs: "",
    pack: "pack", packs: "pack", packet: "pack", packets: "pack",
    can: "can", cans: "can", tin: "can", tins: "can",
    bunch: "bunch", bunches: "bunch",
    cup: "cup", cups: "cup",
    handful: "handful", handfuls: "handful", handfull: "handful", handfulls: "handful"
  };
  return aliases[u] !== undefined ? aliases[u] : u;
}

const ingredientUnitConversions = {
  "coconut milk": { from: "ml", to: "can", per: 250 }
};

// --- Supermarket walkthrough order -----------------------------------------
// Sort the shopping list the way you walk a typical supermarket: fruit &
// vegetables first, frozen last. Items are matched to the first pattern that
// hits (patterns are ordered most-specific first, e.g. "canned tomatoes" is
// pantry, not produce, and anything "frozen" always ends up in the freezer).
const SUPERMARKET_ORDER = [
  "produce",
  "bakery",
  "deli",
  "dairy",
  "pantry",
  "snacks",
  "drinks",
  "other",
  "frozen"
];

const AISLE_PATTERNS = [
  // Frozen is always last — check it before anything else.
  [
    "frozen",
    /\b(frozen|gefroren|tiefk|tk|fish sticks|ice cream|eis|pommes|chips frozen)\b/
  ],
  // Pantry items that would otherwise match a fresh keyword ("canned tomatoes",
  // "tomato paste", "cornflakes", "peanut butter", ...).
  [
    "pantry",
    /\b(canned|tinned|\btin\b|\bcan\b|jar|dose|konserve|paste|sauce|stock|broth|bouillon|flour|sugar|rice|pasta|spaghetti|noodle|noodles|penne|macaroni|fusilli|couscous|quinoa|lentil|lentils|\bbean\b|beans|chickpea|chickpeas|\boil\b|vinegar|soy|mustard|ketchup|mayo|mayonnaise|honey|syrup|spice|spices|salt|baking|yeast|cocoa|chocolate|oat|oats|oatmeal|cereal|cornflakes|breadcrumb|breadcrumbs|\bnuts\b|nut|almond|walnut|cashew|peanut|raisin|cube|curry|turmeric|cumin|cinnamon|nutmeg|vanilla|jam|marmalade|tahini|miso|sriracha|stock cube|semolina|polenta|tapioca|desiccated)\b/
  ],
  // Fruit & vegetables.
  [
    "produce",
    /\b(apple|apples|banana|bananas|orange|oranges|lemon|lemons|lime|limes|tomato|tomatoes|potato|potatoes|onion|onions|shallot|shallots|schallot|schallots|garlic|carrot|carrots|cucumber|cucumbers|courgette|courgettes|zucchini|pepper|peppers|bell pepper|paprika|lettuce|salad|spinach|rocket|arugula|broccoli|cauliflower|mushroom|mushrooms|celery|leek|porree|spring onion|spring onions|scallion|ginger|chilli|chili|parsley|basil|cilantro|coriander|mint|dill|thyme|rosemary|herb|herbs|avocado|corn|sweetcorn|cabbage|beetroot|radish|radishes|pumpkin|squash|berr(y|ies)|strawberr|blueberr|raspberr|grape|grapes|mango|pear|peach|apricot|melon|watermelon|fig|dates?|asparagus|aubergine|eggplant|gherkin|pickle|pickles|\bpea\b|peas|gemüse|obst|kartoffel|zwiebel|tomate|gurke|salat|apfel|banane|ingwer|lauch|kohl|pilze|zitrone)\b/
  ],
  // Bakery.
  [
    "bakery",
    /\b(bread|toast|toasties|toastbrötchen|baguette|bagel|bun|buns|roll|rolls|croissant|pita|tortilla|wrap|wraps|muffin|muffins|brötchen|pretzel|naan|ciabatta|sourdough)\b/
  ],
  // Deli: meat, fish & cheese counter.
  [
    "deli",
    /\b(ham|bacon|sausage|sausages|salami|chorizo|mince|minced|beef|pork|chicken|turkey|lamb|steak|meat|fish|salmon|tuna|cod|prawn|prawns|shrimp|seafood|deli|cold cuts|parma|pepperoni|bratwurst|wurst|hähnchen|hack|schnitzel)\b/
  ],
  // Dairy & chilled.
  [
    "dairy",
    /\b(milk|butter|cheese|yoghurt|yogurt|cream|crème|creme fraiche|cream cheese|mascarpone|mozzarella|parmesan|feta|ricotta|curd|quark|egg|eggs|margarine|sour cream|skyr|kefir|buttermilk|ghee|halloumi|paneer|pudding|milch|käse|joghurt|sahne|\bei\b|eier)\b/
  ],
  // Snacks & sweets.
  [
    "snacks",
    /\b(crisps|chips|cracker|crackers|biscuit|biscuits|cookie|cookies|gummy|gummies|candy|sweets|popcorn|granola bar|cereal bar|keks|süßigkeiten)\b/
  ],
  // Drinks.
  [
    "drinks",
    /\b(water|sparkling|juice|cola|lemonade|beer|wine|soda|drink|drinks|tea|coffee|espresso|kombucha|smoothie|cordial|getränk|saft|wasser|bier|wein)\b/
  ]
];

// Which aisle an item belongs to (falls back to "other" = before frozen).
function aisleIndex(name) {
  const n = String(name || "").toLowerCase();
  for (const [aisle, pattern] of AISLE_PATTERNS) {
    if (pattern.test(n)) return SUPERMARKET_ORDER.indexOf(aisle);
  }
  return SUPERMARKET_ORDER.indexOf("other");
}

// Walkthrough comparison: aisle order first, then alphabetical within an aisle.
function compareByAisle(a, b) {
  return aisleIndex(a) - aisleIndex(b) || String(a).localeCompare(String(b));
}

function groupSelectedIngredients() {
  const groups = {};

  selectedRecipes.forEach((ingredient) => {
    const { name, amount, unit, how } = ingredient;
    if (!groups[name]) {
      groups[name] = { name, numeric: [], notes: [] };
    }

    const range = parseAmountRange(amount);
    if (range) {
      let entryMin = range.min;
      let entryMax = range.max;
      let entryUnit = unit || "";

      const conversion = ingredientUnitConversions[name.toLowerCase()];
      if (conversion && normalizeUnit(entryUnit) === normalizeUnit(conversion.from)) {
        entryMin = range.min / conversion.per;
        entryMax = range.max / conversion.per;
        entryUnit = conversion.to;
      }

      groups[name].numeric.push({
        min: entryMin,
        max: entryMax,
        unit: entryUnit,
        displayUnit: normalizeUnit(entryUnit) === "" ? "" : entryUnit,
        how: how || ""
      });
    } else {
      const parts = [];
      if (amount) parts.push(amount);
      if (unit) parts.push(unit);
      if (how) parts.push(`(${how})`);
      if (parts.length > 0) {
        const text = parts.join(" ");
        if (!groups[name].notes.includes(text)) groups[name].notes.push(text);
      }
    }
  });

  return Object.values(groups)
    .map((group) => {
      const details = [];
      const byUnit = {};

      group.numeric.forEach((entry) => {
        const key = normalizeUnit(entry.unit);
        if (!byUnit[key]) {
          byUnit[key] = { min: 0, max: 0, displayUnit: entry.displayUnit, hows: [] };
        }
        byUnit[key].min += entry.min;
        byUnit[key].max += entry.max;
        if (entry.how && !byUnit[key].hows.includes(entry.how)) {
          byUnit[key].hows.push(entry.how);
        }
      });

      Object.values(byUnit).forEach((aggregated) => {
        let text = formatAmountValue(aggregated.min);
        if (aggregated.max !== aggregated.min) {
          text += `-${formatAmountValue(aggregated.max)}`;
        }
        if (aggregated.displayUnit) text += ` ${aggregated.displayUnit}`;
        if (aggregated.hows.length > 0) text += ` (${aggregated.hows.join(", ")})`;
        details.push(text);
      });

      group.notes.forEach((note) => details.push(note));

      return { name: group.name, details };
    })
    .sort((a, b) => compareByAisle(a.name, b.name));
}

function updateSummary() {
  selectedRecipes = [];
  const selected = new Set(book.selectedMeals);
  book.recipes.forEach((recipe) => {
    if (!selected.has(recipe.id)) return;
    const parsed = getParsed(recipe);
    const recipeName = parsed.title || recipe.title;
    parsed.ingredients.forEach((ing) => {
      selectedRecipes.push({
        name: normalizeIngredient(ing.name),
        amount: ing.amount,
        unit: ing.unit,
        how: ing.how,
        recipeName
      });
    });
  });
  renderSummary();
}

let lastRequestTime = 0;

async function translateAndUpdateLink(name, nameItem) {
  const currentTime = Date.now();
  const timeSinceLastRequest = currentTime - lastRequestTime;
  const minDelayBetweenRequests = 3000;

  if (timeSinceLastRequest < minDelayBetweenRequests) {
    await delay(minDelayBetweenRequests - timeSinceLastRequest);
  }

  const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    name
  )}&langpair=en|de`;
  try {
    lastRequestTime = Date.now();
    const response = await fetch(apiUrl);
    const data = await response.json();
    const germanName = data.responseData.translatedText;
    const link = `https://shop.rewe.de/productList?search=${encodeURIComponent(
      germanName
    )}&sorting=PRICE_ASC`;
    nameItem.innerHTML = `<a target="_blank" href="${link}">${name} <i class="fa-solid fa-cart-plus" aria-hidden="true"></i></a>`;
  } catch (error) {
    console.error("Error translating name:", error);
  }
}

function renderSummary() {
  const summaryList = document.getElementById("summary-list");
  summaryList.innerHTML = "";

  const selectedRecipeNames = new Set(selectedRecipes.map((i) => i.recipeName));
  const staples = getStaples();
  const links = getLinks();

  if (selectedRecipeNames.size === 0 && staples.length === 0) {
    const empty = el("p", "summary-empty");
    empty.textContent = "Select recipes to build your shopping list.";
    summaryList.appendChild(empty);
    return;
  }

  if (selectedRecipeNames.size > 0) {
    summaryList.appendChild(el("h3", null, "Selected Recipes"));
    const recipeNamesList = el("ul");
    Array.from(selectedRecipeNames).forEach((recipeName) => {
      recipeNamesList.appendChild(el("li", null, recipeName));
    });
    summaryList.appendChild(recipeNamesList);
  }

  if (selectedRecipeNames.size > 0) {
    summaryList.appendChild(el("h3", null, "Ingredients"));
    const ingredientsList = el("ul", "summary-items");
    const checked = getChecked();
    groupSelectedIngredients().forEach(({ name, details }) => {
      const listItem = el("li");
      if (checked.has(name)) listItem.classList.add("summary-item--done");
      const nameItem = el("span", "summary-item__name");
      const link =
        links[name] != null
          ? links[name] + "#add_to_basket"
          : `https://shop.rewe.de/productList?search=${encodeURIComponent(
              name
            )}&sorting=PRICE_ASC`;
      nameItem.innerHTML = `<a target="_blank" href="${link}">${name} <i class="fa-solid fa-cart-plus" aria-hidden="true"></i></a>`;
      listItem.appendChild(summaryCheckButton(name, checked.has(name)));
      listItem.appendChild(nameItem);
      wireCheckedToggle(nameItem, name);

      if (!links[name]) translateAndUpdateLink(name, nameItem);

      if (details.length > 0) {
        listItem.appendChild(
          el("span", "summary-item__amount", details.join(", "))
        );
      }
      ingredientsList.appendChild(listItem);
    });
    summaryList.appendChild(ingredientsList);
  }

  // In edit mode the staples live in the inline editor, so don't also render
  // the read-only staples section here (it would duplicate them).
  if (staples.length > 0 && !editMode) {
    summaryList.appendChild(el("h3", null, "Staples"));
    const staplesList = el("ul", "summary-items");
    const checked = getChecked();
    Array.from(new Set(staples))
      .sort(compareByAisle)
      .forEach((stapleName) => {
        const listItem = el("li");
        if (checked.has(stapleName)) listItem.classList.add("summary-item--done");
        const nameItem = el("span", "summary-item__name");
        const link =
          links[stapleName] != null
            ? links[stapleName] + "#add_to_basket"
            : `https://shop.rewe.de/productList?attribute=discounted&search=${encodeURIComponent(
                stapleName
              )}&sorting=PRICE_ASC`;
        nameItem.innerHTML = `<a target="_blank" href="${link}">${stapleName} <i class="fa-solid fa-cart-plus" aria-hidden="true"></i></a>`;
        listItem.appendChild(summaryCheckButton(stapleName, checked.has(stapleName)));
        listItem.appendChild(nameItem);
        wireCheckedToggle(nameItem, stapleName);

        if (!links[stapleName]) translateAndUpdateLink(stapleName, nameItem);

        const amount = getStapleAmount(stapleName);
        if (amount > 1) {
          listItem.appendChild(el("span", "summary-item__amount", `×${amount}`));
        }
        staplesList.appendChild(listItem);
      });
    summaryList.appendChild(staplesList);
  }

  updateSummaryProgress();
  syncFab();
}

// Tick progress for the shopping list (ticked / total) + the Clear-ticked button.
function updateSummaryProgress() {
  const items = document.querySelectorAll("#summary-list .summary-items > li");
  const total = items.length;
  const done = document.querySelectorAll(
    "#summary-list .summary-items > li.summary-item--done"
  ).length;

  const progress = document.getElementById("summary-progress");
  if (progress) {
    progress.hidden = total === 0;
    const track = progress.querySelector(".summary-progress__track");
    const fill = document.getElementById("summary-progress-fill");
    const text = document.getElementById("summary-progress-text");
    const pct = total ? Math.round((done / total) * 100) : 0;
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = `${done}/${total}`;
    if (track) {
      track.setAttribute("aria-valuemax", String(total));
      track.setAttribute("aria-valuenow", String(done));
    }
  }
}

function addToShoppingList() {
  const items = collectShoppingListItems();
  if (!items.length) {
    showToast("Nothing to add \u2014 select recipes first", "error");
    return;
  }

  const signedIn = window.recipeStore && window.recipeStore.isReady();
  const existing = signedIn
    ? Array.isArray(book.shoppingList)
      ? book.shoppingList
      : []
    : readLocalShoppingList();
  const keyOf = (it) =>
    `${String(it.name).toLowerCase()}|${String(it.amount || "").toLowerCase()}`;
  const seen = new Set(existing.map(keyOf));

  const toAdd = [];
  const toRevive = [];
  items.forEach((it) => {
    const key = keyOf(it);
    const match = existing.find((e) => keyOf(e) === key);
    if (match) {
      // Same item + amount already on the list: move it back to the top
      // (unbought) instead of adding a duplicate row.
      match.done = false;
      match.at = Date.now();
      if (match.id) toRevive.push({ id: match.id, done: false, at: match.at });
      return;
    }
    seen.add(key);
    const item = {
      id: window.recipeStore ? window.recipeStore.newId() : String(Date.now()) + Math.random().toString(36).slice(2, 6),
      name: it.name,
      amount: it.amount || "",
      note: it.note || "",
      done: false,
      at: Date.now()
    };
    existing.push(item);
    toAdd.push(item);
  });
  const added = toAdd.length;

  // Signed in: the shared per-user list in Firestore, written per item so a
  // partner shopping at the same time never clobbers these adds. Signed out:
  // this browser's local list, so the flow still works without an account.
  if (signedIn && window.recipeStore.upsertShoppingItems) {
    window.recipeStore.upsertShoppingItems(toAdd);
    toRevive.forEach((it) =>
      window.recipeStore.updateShoppingItem(it.id, {
        done: it.done,
        at: it.at
      })
    );
    book.shoppingList = existing;
  } else if (signedIn) {
    book.shoppingList = existing;
    scheduleSave({ shoppingList: book.shoppingList });
  } else {
    writeLocalShoppingList(existing);
  }

  const total = existing.length;
  if (added > 0) showToast(`Added ${added} item${added === 1 ? "" : "s"} copy to shopping list`);
  else showToast(`${total} item${total === 1 ? "" : "s"} already on the list`);
}

// Local (signed-out) shopping list, shared with shoppinglist.html via the
// same localStorage key.
const SHOPPINGLIST_LS_KEY = "recipeShoppingList";

function readLocalShoppingList() {
  try {
    const raw = localStorage.getItem(SHOPPINGLIST_LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writeLocalShoppingList(list) {
  try {
    localStorage.setItem(SHOPPINGLIST_LS_KEY, JSON.stringify(list));
  } catch (_) {
    /* ignore */
  }
}

// Flatten the current selection (recipe ingredients + staples) into plain
// { name, amount, note } items for the shopping list page. No links here.
function collectShoppingListItems() {
  const items = [];

  groupSelectedIngredients().forEach(({ name, details }) => {
    items.push({
      name,
      amount: details.length ? details.join(", ") : "",
      note: ""
    });
  });

  Array.from(new Set(getStaples()))
    .sort(compareByAisle)
    .forEach((stapleName) => {
      const amount = getStapleAmount(stapleName);
      items.push({
        name: stapleName,
        amount: amount > 1 ? `\u00d7${amount}` : "",
        note: ""
      });
    });

  return items;
}

// --- Edit mode -------------------------------------------------------------

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle("edit-mode", on);
  const toggle = document.getElementById("edit-toggle");
  if (toggle) {
    toggle.textContent = on ? "Done" : "Edit";
    toggle.setAttribute("aria-pressed", String(on));
  }
  setStapleEditMode(on);
  renderBook();
}

async function deleteRecipe(id) {
  const recipe = book.recipes.find((r) => r.id === id);
  if (!recipe) return;
  const title = getParsed(recipe).title || recipe.title;
  if (!confirm(`Delete “${title}”? This cannot be undone.`)) return;

  book.recipes = book.recipes.filter((r) => r.id !== id);
  book.selectedMeals = book.selectedMeals.filter((m) => m !== id);
  invalidate(id);
  scheduleSave({ recipes: book.recipes, selectedMeals: book.selectedMeals });
  renderBook();
}

// --- Drag & drop reordering ------------------------------------------------

let dragId = null;

function wireDragAndDrop(card) {
  card.addEventListener("dragstart", (e) => {
    dragId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", dragId);
    } catch (_) {
      /* ignore */
    }
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    document
      .querySelectorAll(".recipe.drag-over")
      .forEach((n) => n.classList.remove("drag-over"));
    dragId = null;
  });

  card.addEventListener("dragover", (e) => {
    if (!dragId || dragId === card.dataset.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    card.classList.add("drag-over");
  });

  card.addEventListener("dragleave", () => card.classList.remove("drag-over"));

  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");
    const fromId = dragId || e.dataTransfer.getData("text/plain");
    const toId = card.dataset.id;
    if (!fromId || fromId === toId) return;
    reorder(fromId, toId);
  });
}

function reorder(fromId, toId) {
  const fromIndex = book.recipes.findIndex((r) => r.id === fromId);
  const toIndex = book.recipes.findIndex((r) => r.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = book.recipes.splice(fromIndex, 1);
  book.recipes.splice(toIndex, 0, moved);
  scheduleSave({ recipes: book.recipes });
  renderBook();
}

// --- Editor dialog ---------------------------------------------------------

function ingredientRow(ing = {}) {
  const row = el("div", "ingredient-row");
  const make = (cls, placeholder, value, aria, datalist) => {
    const input = el("input", cls);
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value || "";
    input.setAttribute("aria-label", aria);
    if (datalist) input.setAttribute("list", datalist);
    return input;
  };
  row.appendChild(make("ing-name", "Ingredient", ing.name, "Ingredient name", "ingredient-names"));
  row.appendChild(make("ing-amount", "2", ing.amount, "Amount"));
  row.appendChild(make("ing-unit", "g", ing.unit, "Unit"));
  row.appendChild(make("ing-how", "chopped", ing.how, "Preparation"));
  const remove = el("button", "icon-btn");
  remove.type = "button";
  remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  remove.title = "Remove ingredient";
  remove.addEventListener("click", () => row.remove());
  row.appendChild(remove);
  return row;
}

function stepRow(text = "") {
  const row = el("div", "step-row");
  const handle = el("span", "step-row__num");
  handle.setAttribute("aria-hidden", "true");
  const input = document.createElement("textarea");
  input.className = "step-text";
  input.rows = 2;
  input.placeholder = "Describe this step…";
  input.value = text;
  input.setAttribute("aria-label", "Step");
  const remove = el("button", "icon-btn");
  remove.type = "button";
  remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  remove.title = "Remove step";
  remove.addEventListener("click", () => {
    row.remove();
    renumberSteps();
  });
  row.appendChild(handle);
  row.appendChild(input);
  row.appendChild(remove);
  return row;
}

function renumberSteps() {
  document.querySelectorAll("#step-rows .step-row").forEach((row, i) => {
    row.querySelector(".step-row__num").textContent = i + 1;
  });
}

function fillForm(parsed) {
  document.getElementById("recipe-title").value = parsed.title || "";
  const ingContainer = document.getElementById("ingredient-rows");
  ingContainer.innerHTML = "";
  (parsed.ingredients.length ? parsed.ingredients : [{}]).forEach((ing) =>
    ingContainer.appendChild(ingredientRow(ing))
  );

  const stepContainer = document.getElementById("step-rows");
  stepContainer.innerHTML = "";
  const steps = parsed.steps.map((s) => s.text).filter(Boolean);
  (steps.length ? steps : [""]).forEach((s) =>
    stepContainer.appendChild(stepRow(s))
  );
  renumberSteps();
}

function readForm() {
  const title = document.getElementById("recipe-title").value.trim();
  const ingredients = Array.from(
    document.querySelectorAll("#ingredient-rows .ingredient-row")
  )
    .map((row) => ({
      name: row.querySelector(".ing-name").value.trim(),
      amount: row.querySelector(".ing-amount").value.trim(),
      unit: row.querySelector(".ing-unit").value.trim(),
      how: row.querySelector(".ing-how").value.trim()
    }))
    .filter((i) => i.name);

  const steps = Array.from(
    document.querySelectorAll("#step-rows .step-text")
  )
    .map((t) => t.value.trim())
    .filter(Boolean);

  return { title, ingredients, steps };
}

function setDialogMode(mode) {
  currentDialogMode = mode;
  document
    .getElementById("tab-form")
    .classList.toggle("is-active", mode === "form");
  document
    .getElementById("tab-cooklang")
    .classList.toggle("is-active", mode === "cooklang");
  document.getElementById("pane-form").hidden = mode !== "form";
  document.getElementById("pane-cooklang").hidden = mode !== "cooklang";

  const sourceBox = document.getElementById("recipe-source");
  if (mode === "cooklang") {
    sourceBox.value = serializeRecipe(readForm());
  } else {
    fillForm(parseRecipe(sourceBox.value));
  }
  updatePreview();
}

function currentSource() {
  if (currentDialogMode === "cooklang") {
    return document.getElementById("recipe-source").value;
  }
  return serializeRecipe(readForm());
}

function updatePreview() {
  const source = currentSource();
  let parsed;
  try {
    parsed = parseRecipe(source);
  } catch (err) {
    console.error("Preview parse failed:", err);
    return;
  }
  const preview = document.getElementById("recipe-preview");
  preview.innerHTML = "";

  const title = parsed.title || "Untitled recipe";
  const head = el("div", "preview__head");
  head.appendChild(el("h3", null, title));
  preview.appendChild(head);

  const chips = el("div", "chip-grid");
  parsed.ingredients.forEach((ing) => {
    let label = ing.name;
    const qty = [ing.amount, ing.unit].filter(Boolean).join(" ");
    if (qty) label += ` · ${qty}`;
    chips.appendChild(el("span", "chip", label));
  });
  if (!chips.childElementCount) {
    chips.appendChild(el("span", "chip chip--empty", "no ingredients"));
  }
  preview.appendChild(chips);

  const steps = el("ol", "preview__steps");
  parsed.steps.forEach((step) => {
    if (step.text) steps.appendChild(el("li", null, step.text));
  });
  if (!steps.childElementCount) {
    steps.appendChild(el("li", "muted", "no steps yet"));
  }
  preview.appendChild(steps);
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 250);
}

function openEditor(id) {
  currentEditId = id || null;
  const dialog = document.getElementById("recipe-dialog");
  const titleEl = document.getElementById("dialog-title");

  if (id) {
    const recipe = book.recipes.find((r) => r.id === id);
    const parsed = getParsed(recipe);
    titleEl.textContent = "Edit recipe";
    document.getElementById("recipe-source").value = recipe.source;
    fillForm(parsed);
  } else {
    titleEl.textContent = "Add a new recipe";
    const blank = '---\ntitle: ""\n---\n\nGather your ingredients: .\n\n';
    document.getElementById("recipe-source").value = blank;
    fillForm(parseRecipe(blank));
  }

  setDialogMode("form");
  updatePreview();
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  document.getElementById("recipe-title").focus();
}

function closeEditor() {
  const dialog = document.getElementById("recipe-dialog");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
  currentEditId = null;
}

function saveEditor() {
  const source = currentSource();
  const parsed = parseRecipe(source);
  const title = (parsed.title || "").trim();

  if (!title) {
    alert("Please give your recipe a name 🍲");
    setDialogMode("form");
    document.getElementById("recipe-title").focus();
    return;
  }

  if (currentEditId) {
    const recipe = book.recipes.find((r) => r.id === currentEditId);
    recipe.source = source;
    recipe.title = title;
    invalidate(currentEditId);
  } else {
    const id = window.recipeStore ? window.recipeStore.newId() : String(Date.now());
    book.recipes.push({ id, title, source });
    invalidate(id);
  }

  scheduleSave({ recipes: book.recipes });
  closeEditor();
  renderBook();
  refreshIngredientNames();
}

// Every ingredient name mentioned across the recipes, plus the user's staples
// (some of which are ingredients too). Sorted in supermarket-walk order.
function allIngredientNames() {
  const names = new Set();
  book.recipes.forEach((recipe) => {
    getParsed(recipe).ingredients.forEach((ing) => {
      if (ing.name) names.add(normalizeIngredient(ing.name));
    });
  });
  getStaples().forEach((s) => {
    const name = normalizeIngredient(s);
    if (name) names.add(name);
  });
  return Array.from(names).sort(compareByAisle);
}

// Populate the ingredient autocomplete datalist from all known recipes.
function refreshIngredientNames() {
  const list = document.getElementById("ingredient-names");
  if (!list) return;
  list.innerHTML = "";
  allIngredientNames().forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    list.appendChild(option);
  });
}

// --- Auth wiring -----------------------------------------------------------

function initAuth() {
  const widget = document.getElementById("auth-widget");
  if (!widget || !window.recipeAuth) return;

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
  photo.addEventListener("load", showPhoto);
  photo.addEventListener("error", showInitials);

  function getInitials(user) {
    const source = (user.displayName || user.email || "?").trim();
    const parts = source.split(/[\s@._-]+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]).join("");
    return (letters || source[0] || "?").toUpperCase();
  }

  signinBtn.addEventListener("click", () => {
    closeUserMenu();
    window.recipeAuth.signIn();
  });
  signoutBtn.addEventListener("click", () => {
    closeUserMenu();
    window.recipeAuth.signOut();
  });
  if (switchBtn) {
    switchBtn.addEventListener("click", () => {
      closeUserMenu();
      window.recipeAuth.switchAccount();
    });
  }

  window.recipeAuth.onChange(async (user) => {
    const signedIn = Boolean(user);
    document.body.classList.toggle("signed-in", signedIn);
    document.body.classList.toggle("signed-out", !signedIn);
    signinBtn.hidden = signedIn;
    accountActions.hidden = !signedIn;
    nameEl.hidden = !signedIn;
    if (signedIn) {
      nameEl.textContent = user.displayName || user.email || "Signed in";
      initials.textContent = getInitials(user);
      showInitials();
      if (user.photoURL) photo.src = user.photoURL;
      else photo.removeAttribute("src");
      const hint = document.getElementById("shoppinglist-signedout");
      if (hint) hint.hidden = true;
      await loadBookAndRender();
    } else {
      showIcon();
      book = { recipes: [], selectedMeals: [] };
      invalidate();
      setEditMode(false);
      renderEmptyState();
      updateSummary();
      updateSelectedCount();
      closeSummarySheet();
      const hint = document.getElementById("shoppinglist-signedout");
      if (hint) hint.hidden = false;
    }
  });
}

// Open/close the combined account + settings dropdown, and populate the
// appearance controls inside it. Wired independently of auth so settings stay
// reachable even if the auth module is unavailable.
function wireUserMenu() {
  const toggle = document.getElementById("auth-user-toggle");
  const menu = document.getElementById("auth-user-menu");
  if (!toggle || !menu) return;

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

  wireSettingsMenu();
}

function closeUserMenu() {
  const toggle = document.getElementById("auth-user-toggle");
  const menu = document.getElementById("auth-user-menu");
  if (!menu) return;
  menu.hidden = true;
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

async function loadBookAndRender() {
  if (!window.recipeStore || !window.recipeStore.isReady()) return;
  try {
    const loaded = await window.recipeStore.loadBook();
    book = loaded || { recipes: [], selectedMeals: [], staples: [], links: {}, theme: "violet", checkedItems: [] };
    invalidate();
    renderBook();
    refreshIngredientNames();
    // The signed-in user's saved theme/mode win; otherwise keep the local one.
    if (book.theme) applyTheme(book.theme);
    if (book.mode) applyMode(book.mode);
  } catch (err) {
    console.error("Failed to load recipe book:", err);
    renderEmptyState();
  }
}

// --- Boot ------------------------------------------------------------------

function wireStaticControls() {
  const addToListButton = document.getElementById("copy-summary-button");
  if (addToListButton)
    addToListButton.addEventListener("click", addToShoppingList);

  const editToggle = document.getElementById("edit-toggle");
  if (editToggle) {
    editToggle.addEventListener("click", () => setEditMode(!editMode));
  }

  const addBtn = document.getElementById("add-recipe");
  if (addBtn) addBtn.addEventListener("click", () => openEditor(null));

  // Clear the whole meal selection (shown inside the selection bar).
  const selectionClear = document.getElementById("selection-clear");
  if (selectionClear) {
    selectionClear.addEventListener("click", () => {
      book.selectedMeals = [];
      scheduleSave({ selectedMeals: book.selectedMeals });
      renderBook();
    });
  }

  // Mobile shopping sheet + FAB.
  const fab = document.getElementById("summary-fab");
  if (fab) fab.addEventListener("click", openSummarySheet);
  const sheetClose = document.getElementById("summary-sheet-close");
  if (sheetClose) sheetClose.addEventListener("click", closeSummarySheet);
  const sheet = document.getElementById("summary-sheet");
  if (sheet) {
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) closeSummarySheet();
    });
  }

  if (window.matchMedia) {
    const mq = window.matchMedia("(max-width: 1024px)");
    const onChange = () => {
      closeSummarySheet();
      syncSummaryPlacement();
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  // Fallback for environments where the media-query change event does not fire
  // (e.g. programmatic resizes): re-place the summary card on window resize.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncSummaryPlacement, 150);
  });

  // Let the access-denied overlay be dismissed with its ✕ or by clicking the
  // backdrop.
  const deniedOverlay = document.getElementById("access-denied-overlay");
  if (deniedOverlay) {
    const closeDenied = () => {
      deniedOverlay.hidden = true;
    };
    const closeBtn = document.getElementById("access-denied-close");
    if (closeBtn) closeBtn.addEventListener("click", closeDenied);
    deniedOverlay.addEventListener("click", (e) => {
      if (e.target === deniedOverlay) closeDenied();
    });
  }

  const dialog = document.getElementById("recipe-dialog");
  if (dialog) {
    document
      .getElementById("tab-form")
      .addEventListener("click", () => setDialogMode("form"));
    document
      .getElementById("tab-cooklang")
      .addEventListener("click", () => setDialogMode("cooklang"));
    document.getElementById("add-ingredient").addEventListener("click", () => {
      document.getElementById("ingredient-rows").appendChild(ingredientRow());
    });
    document.getElementById("add-step").addEventListener("click", () => {
      document.getElementById("step-rows").appendChild(stepRow());
      renumberSteps();
    });
    document.getElementById("recipe-save").addEventListener("click", saveEditor);
    document
      .getElementById("recipe-cancel")
      .addEventListener("click", closeEditor);
    document
      .getElementById("recipe-cancel-footer")
      .addEventListener("click", closeEditor);
    document
      .getElementById("recipe-source")
      .addEventListener("input", schedulePreview);
    document
      .getElementById("recipe-title")
      .addEventListener("input", schedulePreview);

    // Live preview for form edits (delegated).
    dialog.addEventListener("input", (e) => {
      if (
        e.target.matches(
          "#recipe-title, .ing-name, .ing-amount, .ing-unit, .ing-how, .step-text"
        )
      ) {
        schedulePreview();
      }
    });

    dialog.addEventListener("close", () => {
      currentEditId = null;
    });
  }

  wireShoppingDialog();
}

// --- Theme picker ----------------------------------------------------------

// Populate the appearance controls inside the combined user/settings menu.
function wireSettingsMenu() {
  const options = document.getElementById("theme-options");
  if (!options) return;

  options.innerHTML = "";
  THEMES.forEach((theme) => {
    const sw = el("button", `theme-swatch swatch-${theme}`);
    sw.type = "button";
    sw.dataset.theme = theme;
    sw.title = theme;
    sw.setAttribute("aria-label", `${theme} theme`);
    sw.addEventListener("click", () => {
      applyTheme(theme);
      scheduleSave({ theme });
    });
    options.appendChild(sw);
  });

  const modeOptions = document.getElementById("mode-options");
  if (modeOptions) {
    modeOptions.querySelectorAll(".appearance-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyMode(btn.dataset.mode);
        scheduleSave({ mode: btn.dataset.mode });
      });
    });
  }
}

// --- Staples & shopping links rows -----------------------------------------

function stapleRow(name = "", amount = "") {
  const row = el("div", "staple-row");
  const input = el("input", "staple-name");
  input.type = "text";
  input.value = name;
  input.placeholder = "Add a staple";
  input.setAttribute("aria-label", "Staple");
  input.setAttribute("list", "ingredient-names");
  input.addEventListener("input", () => maybeGrowStapleRow(row));
  const amountInput = el("input", "staple-amount");
  amountInput.type = "number";
  amountInput.min = "1";
  amountInput.step = "1";
  amountInput.value = amount;
  amountInput.placeholder = "1";
  amountInput.setAttribute("aria-label", "Amount");
  const remove = el("button", "icon-btn staple-remove");
  remove.type = "button";
  remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  remove.title = "Remove staple";
  row.appendChild(input);
  row.appendChild(amountInput);
  row.appendChild(remove);
  return row;
}

function linkRow(name = "", url = "") {
  const row = el("div", "link-row");
  const nameInput = el("input", "link-name");
  nameInput.type = "text";
  nameInput.value = name;
  nameInput.placeholder = "ingredient";
  nameInput.setAttribute("aria-label", "Ingredient name");
  nameInput.setAttribute("list", "ingredient-names");
  const urlInput = el("input", "link-url");
  urlInput.type = "url";
  urlInput.value = url;
  urlInput.placeholder = "https://shop.rewe.de/...";
  urlInput.setAttribute("aria-label", "Product URL");
  const remove = el("button", "icon-btn");
  remove.type = "button";
  remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  remove.title = "Remove link";
  remove.addEventListener("click", () => row.remove());
  row.appendChild(nameInput);
  row.appendChild(urlInput);
  row.appendChild(remove);
  return row;
}

// --- Staples editor --------------------------------------------------------

function openStaplesEditor() {
  const dialog = document.getElementById("staples-dialog");
  if (!dialog) return;
  const container = document.getElementById("staple-rows-dialog");
  container.innerHTML = "";
  Array.from(new Set(getStaples())).forEach((s) => {
    const amount = getStapleAmount(s);
    container.appendChild(stapleRow(s, amount > 1 ? String(amount) : ""));
  });
  const addRow = el("button", "staple-add-row");
  addRow.type = "button";
  addRow.id = "staple-add-row-dialog";
  addRow.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> Add staple';
  addRow.addEventListener("click", () => {
    const row = stapleRow();
    container.insertBefore(row, addRow);
    row.querySelector(".staple-name").focus();
  });
  container.appendChild(addRow);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeStaplesEditor() {
  const dialog = document.getElementById("staples-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function saveStaplesEditor() {
  const staples = [];
  const stapleAmounts = {};
  document.querySelectorAll("#staple-rows-dialog .staple-row").forEach((row) => {
    const name = row.querySelector(".staple-name").value.trim();
    if (!name) return;
    if (staples.includes(name)) return; // merge duplicates into one entry
    const raw = parseInt(row.querySelector(".staple-amount").value, 10);
    staples.push(name);
    stapleAmounts[name] = Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  book.staples = staples;
  book.stapleAmounts = stapleAmounts;
  scheduleSave({ staples, stapleAmounts });
  closeStaplesEditor();
  updateSummary();
  refreshIngredientNames();
}

// --- REWE links editor -----------------------------------------------------

function openLinksEditor() {
  const dialog = document.getElementById("links-dialog");
  if (!dialog) return;
  // Every ingredient mentioned across the recipes gets a row. If a matching
  // link already exists its URL is filled in; otherwise it stays empty (the
  // shopping list then falls back to a REWE search for that name).
  const container = document.getElementById("link-rows");
  container.innerHTML = "";
  const links = getLinks();
  allIngredientNames().forEach((name) => {
    if (links[name] == null) links[name] = "";
  });
  Object.keys(links)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => container.appendChild(linkRow(name, links[name])));
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeLinksEditor() {
  const dialog = document.getElementById("links-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function saveLinksEditor() {
  const links = {};
  document.querySelectorAll("#link-rows .link-row").forEach((row) => {
    const name = row.querySelector(".link-name").value.trim();
    const url = row.querySelector(".link-url").value.trim();
    if (name && url) links[name] = url;
  });
  book.links = links;
  scheduleSave({ links });
  closeLinksEditor();
  updateSummary();
}

// --- Inline staples editor (shopping list, edit mode) ----------------------

function wireStapleRowEditing() {
  const container = document.getElementById("staple-rows");
  if (!container || container.dataset.wired) return;
  container.dataset.wired = "true";
  const persist = () => {
    const draft = readStapleRows();
    book.staples = draft.staples;
    book.stapleAmounts = draft.stapleAmounts;
    scheduleSave({
      staples: draft.staples,
      stapleAmounts: draft.stapleAmounts
    });
    updateSummary();
    refreshIngredientNames();
  };
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".staple-remove");
    if (!btn) return;
    const row = btn.closest(".staple-row");
    if (!row) return;
    row.remove();
    persist();
  });
  // Commit a row once the user leaves its name (and give it a default amount).
  container.addEventListener(
    "change",
    (e) => {
      if (!e.target.classList.contains("staple-name")) return;
      const row = e.target.closest(".staple-row");
      const amount = row.querySelector(".staple-amount");
      if (amount && !amount.value) amount.value = "1";
      if (e.target.value.trim()) {
        book.staples = Array.from(new Set(getStaples().concat(e.target.value.trim())));
      }
      persist();
    },
    true
  );
}

// Read the inline staples editor rows into names + amounts.
function readStapleRows() {
  const staples = [];
  const stapleAmounts = {};
  document.querySelectorAll("#staple-rows .staple-row").forEach((row) => {
    const name = row.querySelector(".staple-name").value.trim();
    if (!name) return;
    if (staples.includes(name)) return;
    const raw = parseInt(row.querySelector(".staple-amount").value, 10);
    staples.push(name);
    stapleAmounts[name] = Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  return { staples, stapleAmounts };
}

// The inline editor grows a new blank row once the last row gets a name.
function maybeGrowStapleRow(row) {
  const container = document.getElementById("staple-rows");
  if (!container || row !== container.lastElementChild) return;
  const name = row.querySelector(".staple-name").value.trim();
  if (!name) return;
  const add = document.getElementById("staple-add-row");
  container.insertBefore(stapleRow(), add);
}

// Edit-mode toggle for the inline staples editor inside the shopping list.
function setStapleEditMode(on) {
  const card = document.getElementById("summary-card");
  const inline = document.getElementById("staples-inline");
  if (card) card.classList.toggle("is-editing", on);
  if (inline) inline.hidden = !on;
  if (on) renderStapleEditorRows();
  else updateSummary();
}

function renderStapleEditorRows() {
  const container = document.getElementById("staple-rows");
  if (!container) return;
  container.innerHTML = "";
  Array.from(new Set(getStaples())).forEach((s) => {
    const amount = getStapleAmount(s);
    container.appendChild(stapleRow(s, amount > 1 ? String(amount) : ""));
  });
  const addRow = el("button", "staple-add-row");
  addRow.type = "button";
  addRow.id = "staple-add-row";
  addRow.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> Add staple';
  addRow.addEventListener("click", () => {
    const row = stapleRow();
    container.insertBefore(row, addRow);
    row.querySelector(".staple-name").focus();
  });
  container.appendChild(addRow);
}

function wireShoppingDialog() {
  wireStapleRowEditing();

  // Staples editor dialog.
  const staplesBtn = document.getElementById("manage-staples");
  if (staplesBtn) staplesBtn.addEventListener("click", openStaplesEditor);
  const addStaple = document.getElementById("add-staple");
  if (addStaple) {
    addStaple.addEventListener("click", () => {
      const container = document.getElementById("staple-rows-dialog");
      const add = document.getElementById("staple-add-row-dialog");
      const row = stapleRow();
      if (add) container.insertBefore(row, add);
      else container.appendChild(row);
      row.querySelector(".staple-name").focus();
    });
  }
  const staplesSave = document.getElementById("staples-save");
  if (staplesSave) staplesSave.addEventListener("click", saveStaplesEditor);
  const staplesCancel = document.getElementById("staples-cancel");
  if (staplesCancel) staplesCancel.addEventListener("click", closeStaplesEditor);
  const staplesClose = document.getElementById("staples-close");
  if (staplesClose) staplesClose.addEventListener("click", closeStaplesEditor);

  // REWE links editor dialog.
  const linksBtn = document.getElementById("manage-links");
  if (linksBtn) linksBtn.addEventListener("click", openLinksEditor);
  const addLink = document.getElementById("add-link");
  if (addLink) {
    addLink.addEventListener("click", () =>
      document.getElementById("link-rows").appendChild(linkRow())
    );
  }
  const linksSave = document.getElementById("links-save");
  if (linksSave) linksSave.addEventListener("click", saveLinksEditor);
  const linksCancel = document.getElementById("links-cancel");
  if (linksCancel) linksCancel.addEventListener("click", closeLinksEditor);
  const linksClose = document.getElementById("links-close");
  if (linksClose) linksClose.addEventListener("click", closeLinksEditor);
}

async function boot() {
  // Apply the remembered appearance right away (theme from storage, mode from
  // storage or the OS preference).
  applyTheme(storedTheme());
  applyMode(storedMode() || (prefersDark() ? "dark" : "light"));

  // Try to load the official Cooklang parser up-front; fall back if offline.
  await loadParser();
  if (parserStatus() === "fallback") {
    const notice = document.getElementById("parser-notice");
    if (notice) notice.hidden = false;
  }

  wireStaticControls();
  wireUserMenu();

  // auth.js is a separate module that may still be loading.
  if (window.recipeAuth) initAuth();
  else window.addEventListener("recipeauthready", initAuth, { once: true });
}

window.addEventListener("load", () => {
  boot().catch((error) => console.error("Error during boot:", error));
});
