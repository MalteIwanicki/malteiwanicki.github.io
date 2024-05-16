// Function to create a recipe div element
function createRecipeDiv(recipe) {
  const recipeDiv = document.createElement('div');
  recipeDiv.classList.add('recipe');

  const nameHeading = document.createElement('h2');
  nameHeading.textContent = recipe.meal;
  recipeDiv.appendChild(nameHeading);

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('recipe-checkbox');
  checkbox.addEventListener('change', updateSummary);
  recipeDiv.appendChild(checkbox);

  const ingredientsDetails = document.createElement('details');
  const ingredientsHeading = document.createElement('summary');
  ingredientsHeading.textContent = 'Ingredients';
  ingredientsDetails.appendChild(ingredientsHeading);

  const ingredientsList = document.createElement('ul');
  ingredientsList.classList.add('ingredients-list');
  recipe.ingredients.forEach(ingredient => {
    const ingredientItem = document.createElement('li');
    let itemText = ingredient.food;
    if (ingredient.amount) {
      itemText = `${ingredient.amount} ${itemText}`;
    }
    if (ingredient.how) {
      itemText = `${itemText} (${ingredient.how})`;
    }
    ingredientItem.textContent = itemText;
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

  return recipeDiv;
}

let selectedRecipes = [];

function updateSummary(event) {
  const checkbox = event.target;
  const recipe = checkbox.closest('.recipe');
  const ingredientsList = recipe.querySelector('.ingredients-list');
  const ingredients = Array.from(ingredientsList.querySelectorAll('li')).map(item => item.textContent);

  if (checkbox.checked) {
    selectedRecipes.push(...ingredients);
  } else {
    selectedRecipes = selectedRecipes.filter(item => !ingredients.includes(item));
  }

  renderSummary();
}

function renderSummary() {
  const summaryList = document.getElementById('summary-list');
  summaryList.innerHTML = '';

  const uniqueIngredients = [...new Set(selectedRecipes)];

  uniqueIngredients.forEach(ingredient => {
    const listItem = document.createElement('li');
    listItem.textContent = ingredient;
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
        renderSummary(); // Call renderSummary after creating recipe divs
      } else {
        console.error('Error: recipes is not an array');
      }
    })
    .catch(error => {
      console.error('Error loading recipes:', error);
    });
}

// Call the buildRecipes function when the page loads
window.addEventListener('load', buildRecipes);
