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
  checkbox.addEventListener('change', updateCookie);
  checkbox.addEventListener("change", updateSummary);
  recipeDiv.appendChild(checkbox);

  const ingredientsDetails = document.createElement('details');
  const ingredientsHeading = document.createElement('summary');
  ingredientsHeading.textContent = 'Ingredients';
  ingredientsDetails.appendChild(ingredientsHeading);

  const ingredientsList = document.createElement('ul');
  ingredientsList.classList.add('ingredients-list');
  recipe.ingredients.forEach(ingredient => {
    const ingredientItem = document.createElement('li');
     let itemText = `<span class="name">${ingredient.food}</span>`;
    if (ingredient.amount) {
      itemText += `, <span class="amount">${ingredient.amount}</span>`;
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

function updateSummary(event) {
  const checkbox = event.target;
  const recipe = checkbox.closest('.recipe');
  const ingredientsList = recipe.querySelector('.ingredients-list');
  const ingredients = Array.from(ingredientsList.querySelectorAll('li')).map(item => {
    const nameSpan = item.querySelector('span.name');
    const amountSpan = item.querySelector('span.amount');
    const howSpan = item.querySelector('span.how');
    const name = nameSpan ? nameSpan.textContent : '';
    const amount = amountSpan ? amountSpan.textContent : '';
    const how = howSpan ? howSpan.textContent : '';
    return { name, amount, how };
  });

  if (checkbox.checked) {
    selectedRecipes.push(...ingredients);
  } else {
    selectedRecipes = selectedRecipes.filter(item => !ingredients.some(i => i.name === item.name && i.amount === item.amount && i.how === item.how));
  }
  renderSummary();
}


async function translateAndUpdateLink(name, nameItem) {
    // Translate the name from English to German using MyMemoryTranslated API
    const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(name)}&langpair=en|de`;
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();
        const germanName = data.responseData.translatedText;

        // Update the link with the German translation
        nameItem.innerHTML = `<a target="_blank" href="https://shop.rewe.de/productList?search=${encodeURIComponent(germanName)}&sorting=PRICE_ASC">${name}</a>`;
    } catch (error) {
        // Handle any errors that occur during the translation
        console.error('Error translating name:', error);
    }
}

function renderSummary() {
  const summaryList = document.getElementById('summary-list');
  summaryList.innerHTML = '';

  const groupedIngredients = {};

  selectedRecipes.forEach(ingredient => {
    const { name, amount, how } = ingredient;
    const key = name;

    if (!groupedIngredients[key]) {
      groupedIngredients[key] = {
        name: key,
        details: []
      };
    }

    const detail = [];
    if (amount) {
      detail.push(amount);
    }
    if (how) {
      detail.push(`(${how})`);
    }
    if (detail.length > 0) {
      groupedIngredients[key].details.push(detail.join(' '));
    }
  });

  const sortedIngredients = Object.values(groupedIngredients).sort((a, b) => a.name.localeCompare(b.name));

  sortedIngredients.forEach(ingredient => {
    const { name, details } = ingredient;
    const listItem = document.createElement('li');
    const nameItem = document.createElement('span');
    nameItem.innerHTML = `<a target="_blank" href="https://shop.rewe.de/productList?search=${encodeURIComponent(name)}&sorting=PRICE_ASC">${name}</a>`;
    listItem.appendChild(nameItem);
    
    // translate to german
    translateAndUpdateLink(name, nameItem);    

    if (details.length > 0) {
      const detailsList = document.createElement('span');
      details.forEach(detail => {
        const detailItem = document.createElement('span');
        detailItem.textContent =", " + detail;
        detailsList.appendChild(detailItem);
      });
      listItem.appendChild(detailsList);
    }

    summaryList.appendChild(listItem);
  });
}
// Function to build and display recipes
function buildRecipes() {
  const recipesContainer = document.getElementById('recipes-container');

  fetch('https://malteiwanicki.github.io/recipes/recipes.json')
    .then(response => response.json())
    .then(data => {
      const recipes = data.recipes;
      if (Array.isArray(recipes)) {
        recipes.forEach(recipe => {
          const recipeDiv = createRecipeDiv(recipe);
          recipesContainer.appendChild(recipeDiv);
        });
        const selectedMeals = JSON.parse(getCookie('selectedMeals') || '[]');
        renderSummary(); // Call renderSummary after creating recipe divs

        // recover clicked meals
        selectedMeals.forEach(meal => {
            const checkbox = document.querySelector(`.recipe-checkbox[data-meal="${meal}"]`);
            if (checkbox) {
                checkbox.checked = true;
                checknbox.dispatchEvent(new Event("change"))
            }
        });
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
window.addEventListener('load', buildRecipes);
