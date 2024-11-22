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
