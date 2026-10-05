// Cooklang layer for the recipe book.
//
// Uses the OFFICIAL Cooklang JavaScript parser (@cooklang/cooklang-ts) loaded
// from a CDN at runtime - no build step. If the CDN is unreachable we fall back
// to a small built-in parser that understands the subset of Cooklang we emit.
//
// Everything is derived from the .cook source, which is the single source of
// truth for a recipe.

const PARSER_URL =
  "https://cdn.jsdelivr.net/npm/@cooklang/cooklang-ts@1.2.8/+esm";

let ParserCtor = null;
let parserLoad = null;
let usingFallback = false;

// Load (once) the official parser. Resolves to the Parser class or null.
export function loadParser() {
  if (ParserCtor) return Promise.resolve(ParserCtor);
  if (!parserLoad) {
    parserLoad = import(/* @vite-ignore */ PARSER_URL)
      .then((mod) => {
        ParserCtor = mod.Parser || mod.default;
        return ParserCtor;
      })
      .catch((err) => {
        console.warn(
          "Cooklang parser CDN unavailable, using built-in fallback:",
          err.message
        );
        usingFallback = true;
        return null;
      });
  }
  return parserLoad;
}

export function isUsingFallback() {
  return usingFallback;
}

// --- Front matter ----------------------------------------------------------

// Splits a .cook document into its YAML front matter (simple key: value pairs)
// and the body containing the steps.
export function splitFrontMatter(source) {
  const text = String(source || "");
  const match = text.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  match[1].split("\n").forEach((line) => {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) return;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[m[1].toLowerCase()] = value;
  });
  return { meta, body: text.slice(match[0].length) };
}

// --- Parsing ---------------------------------------------------------------

const INGREDIENT_WITH_BRACES =
  /@([^@\n{}()]+?)\{([^}]*)\}(?:\(([^)]*)\))?/g;
const INGREDIENT_BARE = /@([^\s@{}()]+)/g;

function parseQuantity(raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value || value.toLowerCase() === "some") return { amount: "", unit: "" };
  const parts = value.split("%");
  return { amount: parts[0].trim(), unit: (parts[1] || "").trim() };
}

// Splits a step's raw text into text/ingredient parts (fallback parser only).
function splitStepParts(text) {
  const parts = [];
  let lastIndex = 0;
  let match;

  const pushText = (value) => {
    if (value) parts.push({ type: "text", value });
  };

  // First pass: ingredients written with braces (supports multi-word names).
  const braceRegex = new RegExp(INGREDIENT_WITH_BRACES.source, "g");
  const consumed = [];
  while ((match = braceRegex.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index));
    const { amount, unit } = parseQuantity(match[2]);
    parts.push({
      type: "ingredient",
      name: match[1].trim(),
      amount,
      unit,
      how: (match[3] || "").trim()
    });
    consumed.push([match.index, braceRegex.lastIndex]);
    lastIndex = braceRegex.lastIndex;
  }
  pushText(text.slice(lastIndex));
  return parts;
}

function toPlainSteps(parts) {
  return parts
    .map((p) => (p.type === "ingredient" ? p.name : p.value))
    .join("")
    .trim();
}

function parseWithOfficial(source, Parser) {
  const { meta, body } = splitFrontMatter(source);
  const parser = new Parser();
  const parsed = parser.parse(body);

  const ingredients = (parsed.ingredients || [])
    .map((ing) => {
      const q = ing.quantity;
      let amount = "";
      if (q !== undefined && q !== null && String(q).toLowerCase() !== "some") {
        amount = String(q).trim();
      }
      return {
        name: String(ing.name || "").trim(),
        amount,
        unit: String(ing.units || "").trim(),
        how: String(ing.preparation || "").trim()
      };
    })
    .filter((ing) => ing.name);

  const steps = (parsed.steps || []).map((tokens) => {
    const parts = [];
    (tokens || []).forEach((tok) => {
      if (tok.type === "ingredient") {
        parts.push({
          type: "ingredient",
          name: tok.name,
          amount:
            tok.quantity && String(tok.quantity).toLowerCase() !== "some"
              ? String(tok.quantity)
              : "",
          unit: tok.units || "",
          how: tok.preparation || ""
        });
      } else if (tok.type === "text") {
        parts.push({ type: "text", value: tok.value });
      } else if (tok.type === "cookware") {
        parts.push({ type: "cookware", name: tok.name });
      } else if (tok.type === "timer") {
        parts.push({
          type: "timer",
          value: [tok.quantity, tok.units].filter(Boolean).join(" ")
        });
      }
    });
    return { parts, text: toPlainSteps(parts) };
  });

  return {
    title: meta.title || "Untitled recipe",
    ingredients,
    steps,
    cookware: (parsed.cookwares || []).map((c) => c.name),
    timers: (parsed.timers || []).map((t) =>
      [t.quantity, t.units].filter(Boolean).join(" ")
    ),
    source
  };
}

function parseWithFallback(source) {
  const { meta, body } = splitFrontMatter(source);
  const blocks = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const ingredients = [];
  const steps = blocks.map((block) => {
    const parts = splitStepParts(block.replace(/\s*\n\s*/g, " "));
    parts.forEach((p) => {
      if (p.type === "ingredient") {
        ingredients.push({
          name: p.name,
          amount: p.amount,
          unit: p.unit,
          how: p.how
        });
      }
    });
    return { parts, text: toPlainSteps(parts) };
  });

  return {
    title: meta.title || "Untitled recipe",
    ingredients,
    steps,
    cookware: [],
    timers: [],
    source
  };
}

// Parse a .cook document into a render-friendly structure.
// Must call loadParser() once before relying on the official parser.
export function parseRecipe(source) {
  if (ParserCtor) return parseWithOfficial(source, ParserCtor);
  return parseWithFallback(source);
}

// --- Serializing -----------------------------------------------------------

// Build the `@name{amount%unit}(how)` token for one ingredient.
function ingredientToken(ing) {
  const name = String(ing.name || "").replace(/[{}@#~]/g, "").trim();
  const amount = String(ing.amount || "").trim();
  const unit = String(ing.unit || "").trim();
  const how = String(ing.how || "").trim();

  let quantity = "";
  if (amount && unit) quantity = `${amount}%${unit}`;
  else if (amount) quantity = amount;

  let token = `@${name}{${quantity}}`;
  if (how) token += `(${how})`;
  return token;
}

// Turn a structured recipe into a .cook document:
// front matter title, a "gather everything" first step, then the steps.
export function serializeRecipe(recipe) {
  const title = String(recipe.title || "").trim() || "Untitled recipe";
  const ingredients = (recipe.ingredients || []).filter(
    (i) => i && String(i.name || "").trim()
  );
  const steps = (recipe.steps || []).map((s) => String(s || "").trim());

  const lines = ["---", `title: ${JSON.stringify(title)}`, "---", ""];

  if (ingredients.length) {
    const tokens = ingredients.map(ingredientToken).join(", ");
    lines.push(`Gather your ingredients: ${tokens}.`, "");
  }

  steps.forEach((step) => {
    if (step) lines.push(step, "");
  });

  return lines.join("\n").trim() + "\n";
}

// Fallback-aware guard so callers can show a small notice when offline.
export function parserStatus() {
  return usingFallback ? "fallback" : "official";
}
