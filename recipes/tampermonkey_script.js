// ==UserScript==
// @name         Auto Add to Basket
// @namespace    http://tampermonkey.net/
// @version      2025-02-17
// @description  Automatically add product to basket
// @author       Malte Iwanicki
// @match        *://www.rewe.de/shop/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=rewe.de
// @grant        none
// ==/UserScript==

// To use this script in the most efficient way use tampermonkey to inject javascript on the rewe page to add the food automatically to the basket. Install the Tampermonkey extension: https://www.tampermonkey.net/. Create a new script and paste this JavaScript function into it. Configure the script to run on the product pages of your shopping site. Activate developer mode for tampermonkey: https://www.tampermonkey.net/faq.php#Q209
// now everytime a product page is opened with #add_to_basket the product should automatically be added and the page then closed.   

(function() {
    'use strict';

    function addToBasket() {
        // Check if the URL contains '#add_to_basket'
        if (window.location.href.includes('#add_to_basket')) {
            // Find the "Add to Basket" button using the data-testid attribute
            var addButton = document.querySelector('[data-testid="rs-qa-add-to-basket-button"]');

            // Check if the button exists and then trigger a click event
            if (addButton) {
                addButton.click();
            } else {
                console.error('Add to Basket button not found.');
            }
        }
    }

    // Execute the function when the page loads
    window.onload = function() {
        addToBasket();
    };

})();
