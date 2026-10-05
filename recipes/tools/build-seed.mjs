// One-off build tool: converts recipes.json (legacy structured format) into
// recipes/seed.js, where every recipe is a Cooklang .cook document.
//
//   node recipes/tools/build-seed.mjs
//
// This tool is temporary: once seeding is verified, recipes.json and this
// folder can be deleted (the generated seed.js is committed).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

if (!existsSync(join(root, "recipes.json"))) {
  console.error(
    "recipes.json not found. It was removed from the repo after the seed was " +
      "generated.\nRestore it from git history (git show <commit>:recipes/recipes.json > recipes/recipes.json) " +
      "if you need to regenerate seed.js."
  );
  process.exit(1);
}

const UNIT_ALIASES = {
  piece: "", pieces: "", pc: "", pcs: "",
  pack: "pack", packs: "pack", packet: "pack", packets: "pack",
  can: "can", cans: "can", tin: "can", tins: "can",
  bunch: "bunch", bunches: "bunch",
  cup: "cup", cups: "cup",
  handful: "handful", handfuls: "handful", handfull: "handful", handfulls: "handful",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  g: "g", gram: "g", grams: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  clove: "clove", cloves: "clove",
  slice: "slice", slices: "slice",
  pinch: "pinch", pinches: "pinch",
  knob: "knob", knobs: "knob"
};

const NUMERIC = /^\s*\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?\s*$|^\s*\d+\s*\/\s*\d+\s*$|^\s*\d+\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]\s*$|^\s*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]\s*$/;

function normalizeUnit(unit) {
  if (!unit) return "";
  const u = String(unit).trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[u] !== undefined ? UNIT_ALIASES[u] : u;
}

function cleanName(name) {
  return String(name || "")
    .replace(/[{}@#~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text, used) {
  let base = String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  if (!base) base = "recipe";
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

// Build the `@name{amount%unit}(prep)` token for one ingredient.
function ingredientToken(ing) {
  const name = cleanName(ing.food);
  const rawAmount = ing.amount ? String(ing.amount).trim() : "";
  const unit = normalizeUnit(ing.unit);
  const how = ing.how ? String(ing.how).trim() : "";

  let quantity = "";
  const notes = [];
  if (how) notes.push(how);

  if (rawAmount && NUMERIC.test(rawAmount)) {
    const amount = rawAmount.replace(/\s*[-–]\s*/, "-").replace(/\s/g, "");
    quantity = unit ? `${amount}%${unit}` : amount;
  } else {
    // Non-numeric amount (e.g. "head / 2 servings") -> keep as a preparation note.
    if (rawAmount) notes.push(unit ? `${rawAmount} ${unit}` : rawAmount);
  }

  let token = `@${name}{${quantity}}`;
  if (notes.length) token += `(${notes.join("; ")})`;
  return token;
}

function toCooklang(recipe) {
  const title = String(recipe.meal || "Untitled recipe").trim();
  const lines = ["---", `title: ${title}`, "---", ""];

  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  if (ingredients.length) {
    const tokens = ingredients.map(ingredientToken).join(", ");
    lines.push(`Gather your ingredients: ${tokens}.`);
    lines.push("");
  } else {
    lines.push("No ingredients listed yet.");
    lines.push("");
  }

  const instructions = Array.isArray(recipe.instructions) ? recipe.instructions : [];
  if (instructions.length) {
    instructions.forEach((step) => {
      lines.push(String(step).trim());
      lines.push("");
    });
  }

  return lines.join("\n").trim() + "\n";
}

function yamlScalar(text) {
  const s = String(text);
  // Quote if it contains YAML-significant characters.
  if (/[:#\-{}[\]&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

const data = JSON.parse(readFileSync(join(root, "recipes.json"), "utf8"));
const used = new Set();

const staples = JSON.parse(readFileSync(join(root, "staples.json"), "utf8"));
const foodLinks = JSON.parse(readFileSync(join(root, "food_links.json"), "utf8"));

const recipes = data.recipes.map((recipe) => ({
  id: slugify(recipe.meal, used),
  title: String(recipe.meal || "Untitled recipe").trim(),
  source: toCooklang(recipe)
}));

const example = {
  id: "example-pancakes",
  title: "Example Pancakes",
  source: `---
title: Example Pancakes
---

Gather your ingredients: @eggs{2}, @plain flour{125%g}, @milk{250%ml}, @sea salt{1%pinch}, @butter{1%knob}.

Crack the @eggs{2} into a #blender, add the @plain flour{125%g}, @milk{250%ml} and @sea salt{1%pinch}, and blitz until smooth.

Pour into a #bowl and leave to stand for ~{15%minutes}.

Melt the @butter{1%knob} in a #frying pan{} and cook each pancake for ~{2%minutes} a side.
`
};

// Rewrite the front-matter title as a YAML scalar for safety.
recipes.forEach((r) => {
  r.source = r.source.replace(/^title: .*$/m, `title: ${yamlScalar(r.title)}`);
});

const header = `// AUTO-GENERATED by tools/build-seed.mjs from recipes.json.
// Each recipe is a Cooklang .cook document (the single source of truth).
// Do not edit by hand - regenerate instead, or edit recipes in the app.

`;

const body = `${header}export const DEFAULT_RECIPES = ${JSON.stringify(recipes, null, 2)};

export const EXAMPLE_RECIPE = ${JSON.stringify(example, null, 2)};

// Default staples and shopping links (seeded into each user's book).
export const DEFAULT_STAPLES = ${JSON.stringify(staples, null, 2)};

export const DEFAULT_FOOD_LINKS = ${JSON.stringify(foodLinks, null, 2)};

// The account whose book is seeded with the full default recipe collection.
// Every other user starts from the single example recipe.
export const SEED_OWNER_EMAIL = "iwanicki.rm@gmail.com";
`;

writeFileSync(join(root, "seed.js"), body, "utf8");
console.log(`Wrote recipes/seed.js with ${recipes.length} recipes.`);
