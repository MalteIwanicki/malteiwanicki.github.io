// Home/Office Weekly Planner script (5‑min granularity)
// ---------------------------------------------------
// Data model: schedule = [{day:0-4, start: minutesFrom05, end: minutesFrom05, type:'office'|'home'|'pause'}]
// Persistence: encoded in URL hash as #schedule=<base64url>

(() => {
  const planner = document.getElementById('planner');
  const timeAxis = document.getElementById('timeAxis');
  const contractInput = document.getElementById('contractHours');
  const totalsSpan = document.getElementById('totals');
  const homeOfficeTotalSpan = document.getElementById('homeOfficeTotal');
  const shareBtn = document.getElementById('shareBtn');
  const eventTemplate = document.getElementById('eventTemplate');

  const START_MIN = 0; // 05:00 -> 0 minutes offset (axis start)
  const END_MIN = 15 * 60; // 20:00 -> 900 minutes (axis end)
  const MIN_DURATION = 5; // minutes granularity (grid step)
  const MIN_EVENT_DURATION = 15; // minimum event length in minutes
  // Drag limits: cannot start before 06:00 (60 min) and cannot end after 19:00 (840 min)
  const DRAG_MIN = 60; // 06:00
  const DRAG_MAX = 14 * 60; // 19:00 (14 hours after 05:00)


  let schedule = [];
  let rowHeightPx = 0; // will be computed after layout

  // ---------- Utility functions ----------
  const pad = (n) => (n < 10 ? '0' + n : n);
  const minutesToLabel = (m) => {
    const total = m + 5 * 60; // offset from midnight (05:00 is 5*60)
    const h = Math.floor(total / 60);
    const min = total % 60;
    return `${pad(h)}:${pad(min)}`;
  };

  const encodeSchedule = (sched) => {
    const json = JSON.stringify(sched);
    const b64 = btoa(encodeURIComponent(json));
    // base64url
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const decodeSchedule = (str) => {
    // base64url to base64
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    // pad to multiple of 4
    while (b64.length % 4) b64 += '=';
    try {
      const json = decodeURIComponent(atob(b64));
      return JSON.parse(json);
    } catch (e) {
      console.error('Failed to decode schedule', e);
      return [];
    }
  };

  const saveToHash = () => {
    const encoded = encodeSchedule(schedule);
    window.location.hash = '#schedule=' + encoded;
  };

  const loadFromHash = () => {
    const hash = window.location.hash;
    if (hash.startsWith('#schedule=')) {
      const encoded = hash.substring('#schedule='.length);
      schedule = decodeSchedule(encoded);
    } else {
      schedule = [];
    }
  };

  // ---------- Rendering ----------
  const renderTimeAxis = () => {
    timeAxis.innerHTML = '';
    const totalMinutes = END_MIN - START_MIN;
    const plannerHeight = planner.clientHeight;
    rowHeightPx = plannerHeight / totalMinutes; // px per minute
    for (let m = START_MIN; m <= END_MIN; m += 60) {
      const label = minutesToLabel(m);
      const div = document.createElement('div');
      div.className = 'time-label';
      div.style.top = (m * rowHeightPx) + 'px';
      div.textContent = label;
      timeAxis.appendChild(div);
      // hour line
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = (m * rowHeightPx) + 'px';
      timeAxis.appendChild(line);
    }
  };

  const renderEvents = () => {
    // clear existing events
    const dayCols = planner.querySelectorAll('.day-column');
    dayCols.forEach(col => {
      col.innerHTML = '';
    });
    schedule.forEach(ev => {
      const col = planner.querySelector(`.day-column[data-day="${ev.day}"]`);
      if (!col) return;
      const el = eventTemplate.content.firstElementChild.cloneNode(true);
      el.dataset.type = ev.type;
      el.classList.remove('office', 'home', 'pause');
      el.classList.add(ev.type);
      el.querySelector('.label').textContent = ev.type.charAt(0).toUpperCase() + ev.type.slice(1);
      // set time range text
      const startLabel = minutesToLabel(ev.start);
      const endLabel = minutesToLabel(ev.end);
      el.querySelector('.time').textContent = `${startLabel} – ${endLabel}`;
      const top = ev.start * rowHeightPx;
      const height = (ev.end - ev.start) * rowHeightPx;
      el.style.top = top + 'px';
      el.style.height = height + 'px';
      // store reference to schedule index
      el.dataset.idx = schedule.indexOf(ev);
      col.appendChild(el);
    });
  };

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const updateDayHeaders = () => {
    dayNames.forEach((name, i) => {
      const header = document.querySelector(`.day-header[data-day="${i}"]`);
      if (!header) return;
      // sum office and home minutes for this day
      const dayTotalMin = schedule
        .filter(ev => ev.day === i)
        .reduce((sum, ev) => {
          if (ev.type === 'office' || ev.type === 'home') {
            return sum + (ev.end - ev.start);
          }
          return sum;
        }, 0);
      const h = Math.floor(dayTotalMin / 60);
      const m = dayTotalMin % 60;
      const minutes = m < 10 ? '0' + m : m;
      header.textContent = `${name} ${h}:${minutes}`;
    });
  };

  const updateTotals = () => {
    const totals = { office: 0, home: 0, pause: 0 };
    schedule.forEach(ev => {
      const dur = ev.end - ev.start; // minutes
      totals[ev.type] += dur;
    });
    const contract = parseFloat(contractInput.value) || 0;
    const officeH = (totals.office / 60).toFixed(2);
    const homeH = (totals.home / 60).toFixed(2);
    const pauseH = (totals.pause / 60).toFixed(2);
    const ratio = (totals.office + totals.home) ? ((totals.office / (totals.office + totals.home)) * 100).toFixed(1) + '%' : 'NaN%';
    totalsSpan.textContent = `| Office: ${officeH}h | Home: ${homeH}h | Pause: ${pauseH}h | Ratio: ${ratio} |`;
    updateDayHeaders();
    updateControlTotals();
  };

  const updateControlTotals = () => {
    // total home + office minutes
    const totalMin = schedule.reduce((sum, ev) => {
      if (ev.type === 'office' || ev.type === 'home') {
        return sum + (ev.end - ev.start);
      }
      return sum;
    }, 0);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const minutes = m < 10 ? '0' + m : m;
    const contractHours = parseFloat(contractInput.value) || 0;
    const contractMin = contractHours * 60;
    const diff = totalMin - contractMin;
    const sign = diff >= 0 ? '+' : '-';
    const diffHoursAbs = Math.abs(diff);
    const diffH = Math.floor(diffHoursAbs / 60);
    const diffM = diffHoursAbs % 60;
    const diffFormatted = `${diffH}:${diffM < 10 ? '0' + diffM : diffM}`;
    homeOfficeTotalSpan.textContent = `${h}:${minutes} (${sign}${diffFormatted})`;
  };

  // ---------- Interaction ----------
  const addEvent = (day, minute) => {
    // Ensure start respects drag minimum
    const start = Math.max(DRAG_MIN, Math.floor(minute / MIN_DURATION) * MIN_DURATION);
    // Default duration 30 min but not exceeding DRAG_MAX
    const end = Math.min(start + 30, DRAG_MAX);
    const ev = { day, start, end, type: 'home' }; // default type Home per user answer
    schedule.push(ev);
    // Resolve any overlaps for this day
    adjustDay(day);
    renderEvents();
    updateTotals();
    saveToHash();
  };

  const getMinuteFromY = (y) => {
    const minute = Math.round(y / rowHeightPx / MIN_DURATION) * MIN_DURATION;
    // Clamp to draggable range (DRAG_MIN to DRAG_MAX - MIN_DURATION)
    return Math.min(Math.max(minute, DRAG_MIN), DRAG_MAX - MIN_DURATION);
  };

  // Prevent overlapping events and push them within limits
  const adjustDay = (day) => {
    // Get events for the day sorted by start time
    const dayEvents = schedule.filter(e => e.day === day).sort((a, b) => a.start - b.start);
    for (let i = 0; i < dayEvents.length; i++) {
      const ev = dayEvents[i];
      // Ensure first event respects DRAG_MIN
      if (i === 0) {
        ev.start = Math.max(ev.start, DRAG_MIN);
      } else {
        const prev = dayEvents[i - 1];
        // If overlapping, push this event down to previous end
        if (ev.start < prev.end) {
          ev.start = prev.end;
        }
      }
      // Preserve original duration
      const duration = ev.end - ev.start;
      ev.end = ev.start + duration;
      // Clamp to DRAG_MAX
      if (ev.end > DRAG_MAX) {
        ev.end = DRAG_MAX;
        ev.start = Math.max(DRAG_MIN, ev.end - duration);
      }
    }
  };

  // click to create event
  planner.addEventListener('click', (e) => {
    // ignore clicks on existing events or controls
    if (e.target.closest('.event')) return;
    const col = e.target.closest('.day-column');
    if (!col) return;
    const day = parseInt(col.dataset.day, 10);
    const rect = planner.getBoundingClientRect();
    const y = e.clientY - rect.top; // relative to planner top
    const minute = getMinuteFromY(y);
    addEvent(day, minute);
  });

  // hover show buttons handled via CSS (opacity) – we just need click handlers
  planner.addEventListener('click', (e) => {
    const evEl = e.target.closest('.event');
    if (!evEl) return;
    const idx = parseInt(evEl.dataset.idx, 10);
    const ev = schedule[idx];
    if (e.target.classList.contains('close-btn')) {
      // delete
      schedule.splice(idx, 1);
      renderEvents();
      updateTotals();
      saveToHash();
      e.stopPropagation();
    } else if (e.target.classList.contains('type-btn')) {
      // cycle type
      const order = ['office', 'home', 'pause'];
      const curIdx = order.indexOf(ev.type);
      const next = order[(curIdx + 1) % order.length];
      ev.type = next;
      renderEvents();
      updateTotals();
      saveToHash();
      e.stopPropagation();
    }
  });

  // drag resizing and moving
  let dragInfo = null; // {el, idx, type:'top'|'bottom', startY, startMinute}
  let moveInfo = null; // {idx, startY, originalStart, originalEnd, duration}
  planner.addEventListener('mousedown', (e) => {
    const evEl = e.target.closest('.event');
    if (!evEl) return;
    const idx = parseInt(evEl.dataset.idx, 10);
    const ev = schedule[idx];
    const handle = e.target.closest('.drag-handle');
    if (handle) {
      const type = handle.classList.contains('top') ? 'top' : 'bottom';
      dragInfo = { el: evEl, idx, type, startY: e.clientY, startMinute: type === 'top' ? ev.start : ev.end };
    } else {
      // start moving whole event
      moveInfo = { idx, startY: e.clientY, originalStart: ev.start, originalEnd: ev.end, duration: ev.end - ev.start };
    }
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    // Resize handling
    if (dragInfo) {
      const deltaY = e.clientY - dragInfo.startY;
      const deltaMin = Math.round(deltaY / rowHeightPx / MIN_DURATION) * MIN_DURATION;
      const ev = schedule[dragInfo.idx];
      if (dragInfo.type === 'top') {
        let newStart = dragInfo.startMinute + deltaMin;
        newStart = Math.max(DRAG_MIN, Math.min(newStart, ev.end - MIN_EVENT_DURATION));
        ev.start = newStart;
      } else {
        let newEnd = dragInfo.startMinute + deltaMin;
        newEnd = Math.min(DRAG_MAX, Math.max(newEnd, ev.start + MIN_EVENT_DURATION));
        ev.end = newEnd;
      }
      adjustDay(ev.day);
      renderEvents();
      updateTotals();
      return;
    }
    // Move whole event handling
    if (moveInfo) {
      const deltaY = e.clientY - moveInfo.startY;
      const deltaMin = Math.round(deltaY / rowHeightPx / MIN_DURATION) * MIN_DURATION;
      const ev = schedule[moveInfo.idx];
      let newStart = moveInfo.originalStart + deltaMin;
      let newEnd = moveInfo.originalEnd + deltaMin;
      // clamp within limits
      if (newStart < DRAG_MIN) {
        newStart = DRAG_MIN;
        newEnd = newStart + moveInfo.duration;
      }
      if (newEnd > DRAG_MAX) {
        newEnd = DRAG_MAX;
        newStart = newEnd - moveInfo.duration;
      }
      ev.start = newStart;
      ev.end = newEnd;
      adjustDay(ev.day);
      renderEvents();
      updateTotals();
    }
  });
  document.addEventListener('mouseup', () => {
    if (dragInfo) {
      saveToHash();
    }
    if (moveInfo) {
      saveToHash();
    }
    dragInfo = null;
    moveInfo = null;
  });

  // contract hours live update
  contractInput.addEventListener('input', () => {
    updateTotals();
  });

  // share button
  shareBtn.addEventListener('click', () => {
    saveToHash();
    const url = window.location.origin + window.location.pathname + window.location.hash;
    navigator.clipboard.writeText(url).then(() => {
      const original = shareBtn.textContent;
      shareBtn.textContent = 'Copied!';
      setTimeout(() => (shareBtn.textContent = original), 1500);
    });
  });

  // initialization
  const init = () => {
    loadFromHash();
    renderTimeAxis();
    renderEvents();
    updateTotals();
  };
  window.addEventListener('resize', () => {
    renderTimeAxis();
    renderEvents();
  });
  init();
})();
