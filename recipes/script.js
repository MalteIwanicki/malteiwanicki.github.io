// Function to create a recipe div element
function createRecipeDiv(recipe) {
  const recipeDiv = document.createElement('div');
  recipeDiv.classList.add('recipe');

  const nameHeading = document.createElement('h2');
  nameHeading.textContent = recipe.meal;
  recipeDiv.appendChild(nameHeading);
  return recipeDiv;
}

// Function to build and display recipes
function buildRecipes() {
  const recipesContainer = document.getElementById('recipes-container');

  fetch('recipes.json')
    .then(response => response.json())
    .then(recipes => {
      recipes.forEach(recipe => {
        const recipeDiv = createRecipeDiv(recipe);
        recipesContainer.appendChild(recipeDiv);
      });
    })
    .catch(error => {
      console.error('Error loading recipes:', error);
    });
}

// Call the buildRecipes function when the page loads
window.addEventListener('load', buildRecipes);