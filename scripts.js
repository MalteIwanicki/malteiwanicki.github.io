document.addEventListener('DOMContentLoaded', function () {
            var coll = document.getElementsByClassName("collapsible");
            for (var i = 0; i < coll.length; i++) {
                coll[i].addEventListener("click", function () {
                    this.classList.toggle("active");
                    var content = this.nextElementSibling;
                    if (content.style.display === "block") {
                        content.style.display = "none";
                    } else {
                        content.style.display = "block";
                    }
                });
            }
        });

function calculateEarliestStartDate() {
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  // Set end of current month
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

  // Add 3 months to the end of the current month
  const startMonth = endOfMonth.getMonth() + 3;
  const startYear = endOfMonth.getFullYear() + Math.floor(startMonth / 12);

  // Calculate the first day of the start month
  const startDate = new Date(startYear, startMonth % 12, 1);

  return startDate.toLocaleDateString();
}
document.addEventListener("DOMContentLoaded", function() {
document.getElementById("start-date").textContent = calculateEarliestStartDate();
});


