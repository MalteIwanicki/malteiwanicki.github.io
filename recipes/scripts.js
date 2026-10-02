// Hi, This code was completly with chat-gpt or claude and my instructions generated. Don't judge it too hard.
// Function to create a recipe div element
function setCookie(name, value, days) {
    let date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

// Canonical names for ingredients that are written differently across recipes,
// so that the same ingredient is grouped together in the summary.
const ingredientAliases = {
  "potatoes": "potato",
  "onions": "onion",
  "red onions": "onion",
  "egg": "eggs",
  "courgette": "courgettes",
  "spring onion": "spring onions",
  "parmesan": "parmesan cheese",
  "mixed vegetables": "frozen mixed veggies",
  "frozen mixed vegetables": "frozen mixed veggies",
  "vegetables": "frozen mixed veggies",
  "porree": "leek",
  "schalotten": "schallots",
  "kochsahne": "cream",
  "chili": "chilli",
  "oil": "olive oil",
  "grated tasty cheese": "grated cheese",
  "salt and pepper": "salt",
  "peas": "frozen peas",
  "hot water": "water",
  "potato slices or frozen chips": "chips",
  "oven potatoes / chips": "chips",
  "toastbrötchen": "toasties",
  "english muffins": "toasties",
  "toast or english muffins": "toasties",
  "rote spitzpaprika": "red pepper",
  "mittelscharfer senf": "mustard",
  "petersilie": "parsley",
  "eierspätzle frisch": "spätzle",
  "tumeric": "turmeric",
  "apple": "apples"
};

function normalizeIngredient(name) {
  if (!name) return name;
  const trimmed = name.trim();
  return ingredientAliases[trimmed.toLowerCase()] || trimmed;
}

// Update cookie with selected meals
function updateCookie(event) {
    const checkboxes = document.querySelectorAll('.recipe-checkbox');
    const selectedMeals = [];
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            selectedMeals.push(checkbox.dataset.meal);
        }
    });
    setCookie("selectedMeals", JSON.stringify(selectedMeals), 30);  // Save for 30 days
}

function createRecipeDiv(recipe) {
  const recipeDiv = document.createElement('div');
  recipeDiv.classList.add('recipe');

  const nameHeading = document.createElement('h2');
  nameHeading.textContent = recipe.meal;
  recipeDiv.appendChild(nameHeading);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('recipe-checkbox');
  checkbox.dataset.meal = recipe.meal;
  checkbox.addEventListener('change', () => {
    recipeDiv.classList.toggle('selected', checkbox.checked);
    updateCookie();
    updateSummary();
    updateSelectedCount();
  });
  recipeDiv.appendChild(checkbox);

  const ingredientsDetails = document.createElement('details');
  const ingredientsHeading = document.createElement('summary');
  ingredientsHeading.textContent = 'Ingredients';
  ingredientsDetails.appendChild(ingredientsHeading);

  const ingredientsList = document.createElement('ul');
  ingredientsList.classList.add('ingredients-list');
  recipe.ingredients.forEach(ingredient => {
    const ingredientItem = document.createElement('li');
    const foodName = normalizeIngredient(ingredient.food);
     let itemText = `<span class="name">${foodName}</span>`;
    if (ingredient.amount) {
      itemText += `, <span class="amount">${ingredient.amount}</span>`;
    }
    if (ingredient.unit) {
      itemText += ` <span class="unit">${ingredient.unit}</span>`;
    }
    if (ingredient.how) {
      itemText += `, <span class="how">${ingredient.how}</span>`;
    }
    ingredientItem.innerHTML = itemText;
    ingredientsList.appendChild(ingredientItem);
  });
  ingredientsDetails.appendChild(ingredientsList);
  recipeDiv.appendChild(ingredientsDetails);

  const instructionsDetails = document.createElement('details');
  const instructionsHeading = document.createElement('summary');
  instructionsHeading.textContent = 'Instructions';
  instructionsDetails.appendChild(instructionsHeading);

  const instructionsList = document.createElement('ol');
  recipe.instructions.forEach(instruction => {
    const instructionItem = document.createElement('li');
    instructionItem.textContent = instruction;
    instructionsList.appendChild(instructionItem);
  });
  instructionsDetails.appendChild(instructionsList);
  recipeDiv.appendChild(instructionsDetails);
  // Function to handle toggling expansion
  const handleToggle = () => {
        if (ingredientsDetails.open || instructionsDetails.open) {
            recipeDiv.classList.add('expanded');
        } else {
            recipeDiv.classList.remove('expanded');
        }
    };
  ingredientsDetails.addEventListener('toggle', handleToggle);
  instructionsDetails.addEventListener('toggle', handleToggle);


  return recipeDiv;
}

let selectedRecipes = [];
let foodLinks = {};
let staples = []
async function loadFoodLinks() {
    try {
        const response = await fetch('food_links.json');
        foodLinks = await response.json();
    } catch (error) {
        console.error('Error loading food links:', error);
    }
}

async function loadStaples() {
  try {
    const staplesResponse = await fetch('staples.json');
    staples = await staplesResponse.json();
  } catch (error) {
    console.error('Error loading staples:', error);
  }
}

function updateSelectedCount() {
  const count = document.querySelectorAll('.recipe-checkbox:checked').length;
  const pill = document.getElementById('selected-count');
  if (pill) {
    pill.textContent = `${count} selected`;
  }
}

function updateSummary() {
  // Rebuild the selected ingredient list from the currently checked recipes so
  // the summary always reflects the real state (no stale entries).
  selectedRecipes = [];
  document.querySelectorAll('.recipe-checkbox:checked').forEach(checkbox => {
    const recipe = checkbox.closest('.recipe');
    const recipeName = recipe.querySelector('h2').textContent;
    const ingredientsList = recipe.querySelector('.ingredients-list');
    const ingredients = Array.from(ingredientsList.querySelectorAll('li')).map(item => {
      const nameSpan = item.querySelector('span.name');
      const amountSpan = item.querySelector('span.amount');
      const unitSpan  = item.querySelector('span.unit');
      const howSpan = item.querySelector('span.how');
      const name = nameSpan ? nameSpan.textContent : '';
      const amount = amountSpan ? amountSpan.textContent : '';
      const unit = unitSpan ? unitSpan.textContent : '';
      const how = howSpan ? howSpan.textContent : '';
      return { name, amount, unit, how, recipeName };
    });
    selectedRecipes.push(...ingredients);
  });
  renderSummary();
}


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Variable to track the last request time
let lastRequestTime = 0;

async function translateAndUpdateLink(name, nameItem) {
  const currentTime = Date.now();
  const timeSinceLastRequest = currentTime - lastRequestTime;
  const minDelayBetweenRequests = 3000; // 1 second delay between requests

  if (timeSinceLastRequest < minDelayBetweenRequests) {
    await delay(minDelayBetweenRequests - timeSinceLastRequest);
  }

  // Translate the name from English to German using MyMemoryTranslated API
  const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(name)}&langpair=en|de`;
  try {
    lastRequestTime = Date.now(); // Update the last request time
    const response = await fetch(apiUrl);
    const data = await response.json();
    const germanName = data.responseData.translatedText;
    const link = `https://shop.rewe.de/productList?search=${encodeURIComponent(germanName)}&sorting=PRICE_ASC`;
    // Update the link with the German translation
    nameItem.innerHTML = `<a target="_blank" href="${link}">${name}</a>`;
  } catch (error) {
    // Handle any errors that occur during the translation
    console.error('Error translating name:', error);
  }
}

// --- Amount aggregation helpers -------------------------------------------
// The same ingredient is often listed with the same unit across recipes
// (e.g. garlic "1", "2", "2-4"). These helpers parse the amounts and add
// them together so the shopping list shows a single total per unit.

const unicodeFractions = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875
};

function parseSingleAmount(value) {
  const s = String(value).trim();
  if (/^\d+(?:[.,]\d+)?$/.test(s)) {
    return parseFloat(s.replace(',', '.'));
  }
  const fractionMatch = s.match(/^(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$/);
  if (fractionMatch) {
    const whole = fractionMatch[1] ? parseInt(fractionMatch[1], 10) : 0;
    return whole + unicodeFractions[fractionMatch[2]];
  }
  return null;
}

// Returns { min, max } for a numeric amount (ranges like "2-4" included) or null.
function parseAmountRange(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const rangeMatch = s.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/);
  if (rangeMatch) {
    return {
      min: parseFloat(rangeMatch[1].replace(',', '.')),
      max: parseFloat(rangeMatch[2].replace(',', '.'))
    };
  }
  const single = parseSingleAmount(s);
  return single == null ? null : { min: single, max: single };
}

function formatAmountValue(value) {
  if (Number.isInteger(value)) return String(value);
  const fractions = [
    [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'],
    [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']
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
  if (!unit) return '';
  const u = String(unit).trim().toLowerCase();
  const aliases = {
    'piece': '', 'pieces': '', 'pc': '', 'pcs': '',
    'pack': 'pack', 'packs': 'pack', 'packet': 'pack', 'packets': 'pack',
    'can': 'can', 'cans': 'can', 'tin': 'can', 'tins': 'can',
    'bunch': 'bunch', 'bunches': 'bunch',
    'cup': 'cup', 'cups': 'cup',
    'handful': 'handful', 'handfuls': 'handful', 'handfull': 'handful', 'handfulls': 'handful'
  };
  return aliases[u] !== undefined ? aliases[u] : u;
}

// Some ingredients are listed with different units across recipes but refer to
// the same package. Convert those to a common unit so they can be added up
// (e.g. a 250 ml tin of coconut milk is one can).
const ingredientUnitConversions = {
  'coconut milk': { from: 'ml', to: 'can', per: 250 }
};

// Groups the selected ingredients by name and adds numeric amounts together
// per unit. Returns a sorted array of { name, details: [string, ...] }.
function groupSelectedIngredients() {
  const groups = {};

  selectedRecipes.forEach(ingredient => {
    const { name, amount, unit, how } = ingredient;
    if (!groups[name]) {
      groups[name] = { name, numeric: [], notes: [] };
    }

    const range = parseAmountRange(amount);
    if (range) {
      let entryMin = range.min;
      let entryMax = range.max;
      let entryUnit = unit || '';

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
        displayUnit: normalizeUnit(entryUnit) === '' ? '' : entryUnit,
        how: how || ''
      });
    } else {
      const parts = [];
      if (amount) parts.push(amount);
      if (unit) parts.push(unit);
      if (how) parts.push(`(${how})`);
      if (parts.length > 0) {
        const text = parts.join(' ');
        if (!groups[name].notes.includes(text)) groups[name].notes.push(text);
      }
    }
  });

  return Object.values(groups).map(group => {
    const details = [];
    const byUnit = {};

    group.numeric.forEach(entry => {
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

    Object.values(byUnit).forEach(aggregated => {
      let text = formatAmountValue(aggregated.min);
      if (aggregated.max !== aggregated.min) {
        text += `-${formatAmountValue(aggregated.max)}`;
      }
      if (aggregated.displayUnit) text += ` ${aggregated.displayUnit}`;
      if (aggregated.hows.length > 0) text += ` (${aggregated.hows.join(', ')})`;
      details.push(text);
    });

    group.notes.forEach(note => details.push(note));

    return { name: group.name, details };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function renderSummary() {
  const summaryList = document.getElementById('summary-list');
  summaryList.innerHTML = '';

  const selectedRecipeNames = new Set(selectedRecipes.map(item => item.recipeName));

  if (selectedRecipeNames.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'summary-empty';
    empty.textContent = 'Select recipes to build your shopping list.';
    summaryList.appendChild(empty);
    return;
  }

  const recipeNamesHeader = document.createElement('h3');
  recipeNamesHeader.textContent = 'Selected Recipes';
  summaryList.appendChild(recipeNamesHeader);

  const recipeNamesList = document.createElement('ul');
  Array.from(selectedRecipeNames).forEach(recipeName => {
    const recipeNameItem = document.createElement('li');
    recipeNameItem.textContent = recipeName;
    recipeNamesList.appendChild(recipeNameItem);
  });
  summaryList.appendChild(recipeNamesList);

  const ingredientsHeader = document.createElement('h3');
  ingredientsHeader.textContent = 'Ingredients';
  summaryList.appendChild(ingredientsHeader);

  const ingredientsList = document.createElement('ul');
  const sortedIngredients = groupSelectedIngredients();

  sortedIngredients.forEach(ingredient => {
    const { name, details } = ingredient;
    const listItem = document.createElement('li');
    const nameItem = document.createElement('span');
    const link = foodLinks[name] + "#add_to_basket" || `https://shop.rewe.de/productList?search=${encodeURIComponent(name)}&sorting=PRICE_ASC`;
    nameItem.innerHTML = `<a target="_blank" href="${link}">${name}</a>`;
    listItem.appendChild(nameItem);

    // translate to german
    if (!foodLinks[name]) { translateAndUpdateLink(name, nameItem); }

    if (details.length > 0) {
      const detailsSpan = document.createElement('span');
      detailsSpan.className = 'details';
      detailsSpan.textContent = ', ' + details.join(', ');
      listItem.appendChild(detailsSpan);
    }
    ingredientsList.appendChild(listItem);
  });
  summaryList.appendChild(ingredientsList);

  if (staples.length > 0) {
    const staplesHeader = document.createElement('h3');
    staplesHeader.textContent = 'Staples';
    summaryList.appendChild(staplesHeader);

    const staplesList = document.createElement('ul');

    // Count occurrences
    const stapleCounts = staples.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});

    const stapleKeysSorted = Object.keys(stapleCounts).sort((a, b) => a.localeCompare(b));

    stapleKeysSorted.forEach(stapleName => {
      const listItem = document.createElement('li');
      const nameItem = document.createElement('span');
      const link = foodLinks[stapleName] + "#add_to_basket" || `https://shop.rewe.de/productList?attribute=discounted&search=${encodeURIComponent(stapleName)}&sorting=PRICE_ASC`;
      nameItem.innerHTML = `<a target="_blank" href="${link}">${stapleName}</a>`;

      listItem.appendChild(nameItem);

      if (!foodLinks[stapleName]) {
        translateAndUpdateLink(stapleName, nameItem);
      }

      if (stapleCounts[stapleName] > 1) {
        const countSpan = document.createElement('span');
        countSpan.className = 'details';
        countSpan.textContent = ` (x${stapleCounts[stapleName]})`;
        listItem.appendChild(countSpan);
      }

      staplesList.appendChild(listItem);
    });
    summaryList.appendChild(staplesList);
  }
}

// Build a plain-text version of the summary (shopping list + staples) for copying
function buildSummaryText() {
  const lines = [];

  const selectedRecipeNames = new Set(selectedRecipes.map(item => item.recipeName));
  if (selectedRecipeNames.size > 0) {
    lines.push('Selected Recipes:');
    Array.from(selectedRecipeNames).forEach(recipeName => lines.push(`- ${recipeName}`));
    lines.push('');
  }

  lines.push('Ingredients:');
  groupSelectedIngredients().forEach(ingredient => {
    const details = ingredient.details.length > 0 ? `, ${ingredient.details.join(', ')}` : '';
    lines.push(`- ${ingredient.name}${details}`);
  });

  if (staples.length > 0) {
    lines.push('');
    lines.push('Staples:');
    const stapleCounts = staples.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1;
      return acc;
    }, {});
    Object.keys(stapleCounts)
      .sort((a, b) => a.localeCompare(b))
      .forEach(stapleName => {
        const count = stapleCounts[stapleName] > 1 ? ` (x${stapleCounts[stapleName]})` : '';
        lines.push(`- ${stapleName}${count}`);
      });
  }

  return lines.join('\n');
}

function copySummary() {
  const text = buildSummaryText();
  const button = document.getElementById('copy-summary-button');
  const showFeedback = (message) => {
    if (!button) return;
    const original = button.textContent;
    button.textContent = message;
    setTimeout(() => { button.textContent = original; }, 1500);
  };

  const fallbackCopy = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showFeedback('Copied!');
    } catch (error) {
      console.error('Error copying summary:', error);
      showFeedback('Copy failed');
    }
    document.body.removeChild(textarea);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showFeedback('Copied!'))
      .catch(() => fallbackCopy());
  } else {
    fallbackCopy();
  }
}

// Function to build and display recipes
async function buildRecipes() {
  await loadFoodLinks();
  await loadStaples();

  const recipesContainer = document.getElementById('recipes-container');
  
  fetch('recipes.json')
    .then(response => response.json())
    .then(data => {
      const recipes = data.recipes;
      if (Array.isArray(recipes)) {
        recipes.forEach(recipe => {
          const recipeDiv = createRecipeDiv(recipe);
          recipesContainer.appendChild(recipeDiv);
        });
        const selectedMeals = JSON.parse(getCookie('selectedMeals') || '[]');

        // recover clicked meals
        selectedMeals.forEach(meal => {
            const checkbox = document.querySelector(`.recipe-checkbox[data-meal="${meal}"]`);
            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event("change"))
            }
        });

        updateSummary(); // Build the summary from the restored selection
        updateSelectedCount();
      } else {
        console.error('Error: recipes is not an array');
      }
    })
    .catch(error => {
      console.error('Error loading recipes:', error);
    });

    // Restore selected meals from cookie
    
}

// Call the buildRecipes function when the page loads
window.addEventListener('load', () => {
  const copyButton = document.getElementById('copy-summary-button');
  if (copyButton) {
    copyButton.addEventListener('click', copySummary);
  }
  buildRecipes().catch(error => console.error('Error in buildRecipes:', error));
});
