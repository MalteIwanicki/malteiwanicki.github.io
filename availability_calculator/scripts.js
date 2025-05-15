const downtimeInput = document.getElementById("Downtime");
const unitSelect = document.getElementById("unit");
const frequencySelect = document.getElementById("frequency");
const availabilityInput = document.getElementById("availability");
const formulaDisplay = document.getElementById("formulaDisplay");
const infoBox = document.getElementById("infoBox");

const minutesPer = {
    hourly: 60,
    daily:  60 * 24,
    weekly: 60 * 24 * 7,
    yearly: 60 * 24 * 365
};

const unitToMinutes = {
    seconds: 1/60,
    minutes: 1,
    hours:  60,
    days: 60 * 24,
    weeks: 60 * 24 * 7
};


const allowedUnits = {
    hourly: ["seconds", "minutes"],
    daily: ["seconds", "minutes", "hours"],
    weekly: ["seconds", "minutes", "hours", "days"],
    yearly: ["seconds", "minutes", "hours", "days"]
};

let userChangingAvailability = false;
let userChangingTime = false;

function changeIcon(newIcon) {
    const iconSpan = document.getElementById("hoverIcon");
    iconSpan.textContent = newIcon;
}

function formatNumbers(value) {
    return parseFloat(value.toFixed(4)).toString();
}

function updateFormula() {
    const time = parseFloat(downtimeInput.value);
    const unit = unitSelect.value;
    const frequency = frequencySelect.value;

    const totalMinutes = minutesPer[frequency];
    const downtimeMinutes = time * unitToMinutes[unit];
    const availability = Number(((totalMinutes - downtimeMinutes) / totalMinutes * 100).toPrecision(6));

    if (!userChangingAvailability) {
        availabilityInput.value = formatNumbers(availability);
    }

    const unitDisplay = {
        seconds: "s",
        minutes: "min",
        hours: "h",
        days: "d",
        weeks: "w"
    }[unit];

    const totalTimeInUnit = totalMinutes / unitToMinutes[unit];

    const formulaLatex = `
\\begin{align*}
\\text{Availability} &=\\frac{\\text{Up Time}}{\\text{Total Time}}\\times 100\\\\[1.1em]
&=  \\frac{\\text{Total Time} - \\text{Down Time}}{\\text{Total Time}}\\times 100 \\\\[1.1em]
&= \\frac{${formatNumbers(totalTimeInUnit)}\\ \\text{${unitDisplay}} - ${time}\\ \\text{${unitDisplay}}}{${formatNumbers(totalTimeInUnit)}\\ \\text{${unitDisplay}}} \\times 100 \\\\[1.1em]
&= ${availability} \\ \\%
\\end{align*}
`;

    formulaDisplay.innerHTML = `$$${formulaLatex}$$`;
    if (window.MathJax) MathJax.typesetPromise();
}

function updateDowntime() {
    const desiredAvailability = parseFloat(availabilityInput.value);
    const frequency = frequencySelect.value;
    const unit = unitSelect.value;
    const totalMinutes = minutesPer[frequency];
    const downtimeMinutes = totalMinutes * (1 - desiredAvailability / 100);
    const Downtime = downtimeMinutes / unitToMinutes[unit];

    if (!userChangingTime) {
        downtimeInput.value = formatNumbers(Downtime);
    }
    updateFormula();
}

function updateUnitOptions(value="minutes") {
    const freq = frequencySelect.value;
    const validUnits = allowedUnits[freq];
    unitSelect.innerHTML = "";
    validUnits.forEach(unit => {
        const opt = document.createElement("option");
        opt.value = unit;
        opt.textContent = unit;
        unitSelect.appendChild(opt);
    });
        unitSelect.value = value
    updateFormula();
}



function shareLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("time", downtimeInput.value);
    url.searchParams.set("unit", unitSelect.value);
    url.searchParams.set("freq", frequencySelect.value);
    url.searchParams.set("avail", availabilityInput.value);
    navigator.clipboard.writeText(url.toString());
    alert("Link copied to clipboard!");
}

function toggleInfo() {
    infoBox.style.display = infoBox.style.display === "block" ? "none" : "block";
}

downtimeInput.addEventListener("input", () => {
    userChangingTime = true;
    userChangingAvailability = false;
    updateFormula();
    userChangingTime = false;
});

availabilityInput.addEventListener("input", () => {
    userChangingAvailability = true;
    userChangingTime = false;
    updateDowntime();
    userChangingAvailability = false;
});

unitSelect.addEventListener("change", () => {
    updateFormula();
});
frequencySelect.addEventListener("change", () => {
    updateUnitOptions();
    updateFormula();
});

// Initial setup
updateUnitOptions();
unitSelect.value = "minutes";
const params = new URLSearchParams(window.location.search);
if (params.has("time")) downtimeInput.value = params.get("time");
if (params.has("freq")) frequencySelect.value = params.get("freq");
if (params.has("unit")) updateUnitOptions(params.get("unit"));;


if (params.has("avail")) {
    availabilityInput.value = params.get("avail");
    userChangingAvailability = true;
    updateDowntime();
    userChangingAvailability = false;
}

    unitSelect.dataset.currentUnit = unitSelect.value;
updateFormula();

document.querySelectorAll('.preset-link').forEach(link => {
        link.addEventListener('click', function (event) {
            event.preventDefault(); // prevent default link behavior

            const avail = this.dataset.avail;
            const unit = unitSelect.value || "minutes";
            const freq = frequencySelect.value || 'yearly';
            const url = `?avail=${avail}&unit=${unit}&freq=${freq}`;
            window.location.href = url;
        });
    });