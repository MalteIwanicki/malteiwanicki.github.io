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

function getLinks() {
  return book.links && typeof book.links === "object" ? book.links : {};
}

// Names the user has already ticked off the shopping list (struck through).
function getChecked() {
  return new Set(Array.isArray(book.checkedItems) ? book.checkedItems : []);
}

// Wire a shopping-list item so clicking it toggles its "done" state. Attached
// to the name span (not the link) so it survives the link being re-rendered by
// the translation helper.
function wireCheckedToggle(nameItem, name) {
  nameItem.addEventListener("click", () => {
    const set = getChecked();
    const li = nameItem.closest("li");
    if (!li) return;
    const nowDone = !set.has(name);
    if (nowDone) {
      set.add(name);
      li.classList.add("summary-item--done");
    } else {
      set.delete(name);
      li.classList.remove("summary-item--done");
    }
    book.checkedItems = Array.from(set);
    scheduleSave({ checkedItems: book.checkedItems });
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
  head.appendChild(el("h2", "recipe__title", title));
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
  const count = document.querySelectorAll(".recipe-checkbox:checked").length;
  const pill = document.getElementById("selected-count");
  if (pill) pill.textContent = `${count} selected`;
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
    .sort((a, b) => a.name.localeCompare(b.name));
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

  if (staples.length > 0) {
    summaryList.appendChild(el("h3", null, "Staples"));
    const staplesList = el("ul", "summary-items");
    const stapleCounts = staples.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
    const checked = getChecked();
    Object.keys(stapleCounts)
      .sort((a, b) => a.localeCompare(b))
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
        listItem.appendChild(nameItem);
        wireCheckedToggle(nameItem, stapleName);

        if (!links[stapleName]) translateAndUpdateLink(stapleName, nameItem);

        if (stapleCounts[stapleName] > 1) {
          listItem.appendChild(
            el("span", "summary-item__amount", `×${stapleCounts[stapleName]}`)
          );
        }
        staplesList.appendChild(listItem);
      });
    summaryList.appendChild(staplesList);
  }
}

function buildSummaryText() {
  const lines = [];
  const selectedRecipeNames = new Set(selectedRecipes.map((i) => i.recipeName));
  if (selectedRecipeNames.size > 0) {
    lines.push("Selected Recipes:");
    Array.from(selectedRecipeNames).forEach((n) => lines.push(`- ${n}`));
    lines.push("");
  }

  const staples = getStaples();
  if (selectedRecipeNames.size > 0) {
    lines.push("Ingredients:");
    groupSelectedIngredients().forEach((ingredient) => {
      const details = ingredient.details.length
        ? `, ${ingredient.details.join(", ")}`
        : "";
      lines.push(`- ${ingredient.name}${details}`);
    });
  }

  if (staples.length > 0) {
    lines.push("");
    lines.push("Staples:");
    const stapleCounts = staples.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
    Object.keys(stapleCounts)
      .sort((a, b) => a.localeCompare(b))
      .forEach((stapleName) => {
        const count = stapleCounts[stapleName] > 1 ? ` (x${stapleCounts[stapleName]})` : "";
        lines.push(`- ${stapleName}${count}`);
      });
  }

  return lines.join("\n");
}

function copySummary() {
  const text = buildSummaryText();
  const button = document.getElementById("copy-summary-button");
  const showFeedback = (message) => {
    if (!button) return;
    const original = button.dataset.label || button.textContent;
    button.textContent = message;
    setTimeout(() => {
      button.textContent = original;
    }, 1500);
  };

  const fallbackCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showFeedback("Copied!");
    } catch (error) {
      console.error("Error copying summary:", error);
      showFeedback("Copy failed");
    }
    document.body.removeChild(textarea);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => showFeedback("Copied!"))
      .catch(() => fallbackCopy());
  } else {
    fallbackCopy();
  }
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

// Populate the ingredient autocomplete datalist from all known recipes.
function refreshIngredientNames() {
  const list = document.getElementById("ingredient-names");
  if (!list) return;
  const names = new Set();
  book.recipes.forEach((recipe) => {
    getParsed(recipe).ingredients.forEach((ing) => {
      if (ing.name) names.add(normalizeIngredient(ing.name));
    });
  });
  list.innerHTML = "";
  Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => {
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
  const userBox = document.getElementById("auth-user");
  const photo = document.getElementById("auth-user-photo");
  const initials = document.getElementById("auth-user-initials");
  const nameEl = document.getElementById("auth-user-name");
  const signoutBtn = document.getElementById("auth-signout");

  const showPhoto = () => {
    photo.hidden = false;
    initials.hidden = true;
  };
  const showInitials = () => {
    photo.hidden = true;
    initials.hidden = false;
  };
  photo.addEventListener("load", showPhoto);
  photo.addEventListener("error", showInitials);

  function getInitials(user) {
    const source = (user.displayName || user.email || "?").trim();
    const parts = source.split(/[\s@._-]+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]).join("");
    return (letters || source[0] || "?").toUpperCase();
  }

  signinBtn.addEventListener("click", () => window.recipeAuth.signIn());
  signoutBtn.addEventListener("click", () => window.recipeAuth.signOut());

  window.recipeAuth.onChange(async (user) => {
    const signedIn = Boolean(user);
    document.body.classList.toggle("signed-in", signedIn);
    document.body.classList.toggle("signed-out", !signedIn);
    signinBtn.hidden = signedIn;
    userBox.hidden = !signedIn;
    if (signedIn) {
      nameEl.textContent = user.displayName || user.email || "Signed in";
      initials.textContent = getInitials(user);
      showInitials();
      if (user.photoURL) photo.src = user.photoURL;
      else photo.removeAttribute("src");
      await loadBookAndRender();
    } else {
      book = { recipes: [], selectedMeals: [] };
      invalidate();
      setEditMode(false);
      renderEmptyState();
      updateSummary();
      updateSelectedCount();
    }
  });
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
  const copyButton = document.getElementById("copy-summary-button");
  if (copyButton) copyButton.addEventListener("click", copySummary);

  wireThemePicker();

  const editToggle = document.getElementById("edit-toggle");
  if (editToggle) {
    editToggle.addEventListener("click", () => setEditMode(!editMode));
  }

  const addBtn = document.getElementById("add-recipe");
  if (addBtn) addBtn.addEventListener("click", () => openEditor(null));

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

function wireThemePicker() {
  const toggle = document.getElementById("settings-toggle");
  const menu = document.getElementById("settings-menu");
  const options = document.getElementById("theme-options");
  if (!toggle || !menu || !options) return;

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

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle) {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

// --- Staples & shopping links editor ---------------------------------------

function stapleRow(value = "") {
  const row = el("div", "staple-row");
  const input = el("input", "staple-name");
  input.type = "text";
  input.value = value;
  input.placeholder = "e.g. milk";
  input.setAttribute("aria-label", "Staple");
  const remove = el("button", "icon-btn");
  remove.type = "button";
  remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  remove.title = "Remove staple";
  remove.addEventListener("click", () => row.remove());
  row.appendChild(input);
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

function openShoppingEditor() {
  const dialog = document.getElementById("shopping-dialog");
  if (!dialog) return;

  const stapleContainer = document.getElementById("staple-rows");
  stapleContainer.innerHTML = "";
  getStaples().forEach((s) => stapleContainer.appendChild(stapleRow(s)));

  const linkContainer = document.getElementById("link-rows");
  linkContainer.innerHTML = "";
  Object.entries(getLinks()).forEach(([name, url]) =>
    linkContainer.appendChild(linkRow(name, url))
  );

  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeShoppingEditor() {
  const dialog = document.getElementById("shopping-dialog");
  if (!dialog) return;
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function saveShoppingEditor() {
  const staples = Array.from(
    document.querySelectorAll("#staple-rows .staple-name")
  )
    .map((i) => i.value.trim())
    .filter(Boolean);

  const links = {};
  document.querySelectorAll("#link-rows .link-row").forEach((row) => {
    const name = row.querySelector(".link-name").value.trim();
    const url = row.querySelector(".link-url").value.trim();
    if (name && url) links[name] = url;
  });

  book.staples = staples;
  book.links = links;
  scheduleSave({ staples, links });
  closeShoppingEditor();
  updateSummary();
  refreshIngredientNames();
}
function wireShoppingDialog() {
  const dialog = document.getElementById("shopping-dialog");
  if (!dialog) return;
  const manageBtn = document.getElementById("manage-shopping");
  if (manageBtn) manageBtn.addEventListener("click", openShoppingEditor);
  document
    .getElementById("add-staple")
    .addEventListener("click", () =>
      document.getElementById("staple-rows").appendChild(stapleRow())
    );
  document
    .getElementById("add-link")
    .addEventListener("click", () =>
      document.getElementById("link-rows").appendChild(linkRow())
    );
  document
    .getElementById("shopping-save")
    .addEventListener("click", saveShoppingEditor);
  document
    .getElementById("shopping-cancel")
    .addEventListener("click", closeShoppingEditor);
  document
    .getElementById("shopping-close")
    .addEventListener("click", closeShoppingEditor);
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

  // auth.js is a separate module that may still be loading.
  if (window.recipeAuth) initAuth();
  else window.addEventListener("recipeauthready", initAuth, { once: true });
}

window.addEventListener("load", () => {
  boot().catch((error) => console.error("Error during boot:", error));
});
