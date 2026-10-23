(() => {
  "use strict";

  const DAY_START = 8 * 60;
  const DAY_END = 23 * 60;
  const SNAP_MINUTES = 30;
  const STORAGE_KEY = "uts-timetable.2026-27SEP.v1";
  const BACKUP_KEY = `${STORAGE_KEY}.backup`;
  const MAX_WEEK_OFFSET = 52;

  const CUSTOM_COLORS = [
    "#3d4f99",
    "#1d6b6b",
    "#8a5a12",
    "#9c3b64",
    "#2b5d8a",
    "#6b4a8f",
    "#5c6b22",
  ];

  const WEEKEND = new Set(WEEKEND_DAYS);
  const OFFICIAL = deepClone(OFFICIAL_CLASSES);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    grid: $("#grid"),
    gridScroll: $("#gridScroll"),
    agenda: $("#agenda"),
    statusPill: $("#statusPill"),
    statusText: $("#statusText"),
    weekendBtn: $("#weekendBtn"),
    saveState: $("#saveState"),
    addClassBtn: $("#addClassBtn"),
    resetBtn: $("#resetBtn"),
    printBtn: $("#printBtn"),
    prevWeekBtn: $("#prevWeekBtn"),
    nextWeekBtn: $("#nextWeekBtn"),
    todayBtn: $("#todayBtn"),
    weekLabel: $("#weekLabel"),
    classDialog: $("#classDialog"),
    classForm: $("#classForm"),
    classDialogKicker: $("#classDialogKicker"),
    classDialogTitle: $("#classDialogTitle"),
    deleteClassBtn: $("#deleteClassBtn"),
    saveClassBtn: $("#saveClassBtn"),
    fieldCode: $("#fieldCode"),
    fieldName: $("#fieldName"),
    fieldType: $("#fieldType"),
    fieldSubgroup: $("#fieldSubgroup"),
    fieldDay: $("#fieldDay"),
    fieldStart: $("#fieldStart"),
    fieldEnd: $("#fieldEnd"),
    fieldVenue: $("#fieldVenue"),
    fieldLecturer: $("#fieldLecturer"),
    formError: $("#formError"),
    resetDialog: $("#resetDialog"),
    confirmResetBtn: $("#confirmResetBtn"),
    toast: $("#toast"),
    toastIcon: $("#toastIcon"),
    toastMessage: $("#toastMessage"),
    toastUndo: $("#toastUndo"),
  };

  const state = {
    classes: [],
    showWeekend: false,
    weekOffset: 0,
    undo: null,
    toastTimer: null,
    notice: "",
    printRestore: null,
    nowKey: "",
  };

  let drag = null;

  try {
    init();
  } catch (error) {
    showFatalError(error);
  }

  /* ------------------------------------------------------------- startup */

  function init() {
    const loaded = loadState();
    state.classes = loaded.classes;
    state.showWeekend = loaded.showWeekend;
    state.weekOffset = loaded.weekOffset;
    state.notice = loaded.notice;

    els.fieldDay.innerHTML = DAYS.map(
      (day) => `<option value="${day}">${day}</option>`
    ).join("");

    const earliest = toTime(DAY_START);
    const latest = toTime(DAY_END);
    [els.fieldStart, els.fieldEnd].forEach((input) => {
      input.min = earliest;
      input.max = latest;
    });

    bindEvents();
    syncWeekendButton();
    render();
    window.setInterval(tickClock, 60_000);
  }

  function bindEvents() {
    els.addClassBtn.addEventListener("click", () => openClassDialog("add"));
    els.resetBtn.addEventListener("click", requestReset);
    els.printBtn.addEventListener("click", () => window.print());
    els.weekendBtn.addEventListener("click", toggleWeekend);
    els.prevWeekBtn.addEventListener("click", () => shiftWeek(-1));
    els.nextWeekBtn.addEventListener("click", () => shiftWeek(1));
    els.todayBtn.addEventListener("click", () => shiftWeek(0, true));

    els.grid.addEventListener("pointerdown", onPointerDown);
    els.grid.addEventListener("keydown", onCardKeyDown);
    els.grid.addEventListener("click", onCardClick);
    els.agenda.addEventListener("click", onAgendaClick);

    els.classForm.addEventListener("submit", saveClassFromForm);
    els.deleteClassBtn.addEventListener("click", deleteCurrentClass);

    $$("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => {
        const dialog = button.closest("dialog");
        if (dialog) dialog.close();
      });
    });

    [els.classDialog, els.resetDialog].forEach((dialog) => {
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
      });
    });

    els.confirmResetBtn.addEventListener("click", resetToOfficial);
    els.toastUndo.addEventListener("click", undoLastChange);

    els.fieldCode.addEventListener("change", () => {
      els.fieldCode.value = els.fieldCode.value.trim().toUpperCase();
      if (!els.fieldName.value.trim()) {
        const course = COURSES.find((item) => item.code === els.fieldCode.value);
        if (course) els.fieldName.value = course.name;
      }
    });

    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", handleAfterPrint);
  }

  /* ------------------------------------------------------------ data I/O */

  function loadState() {
    const fallback = {
      classes: deepClone(OFFICIAL),
      showWeekend: false,
      weekOffset: 0,
      notice: "",
    };

    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        ...fallback,
        notice: "Browser storage is blocked, so changes will not be saved.",
      };
    }

    if (!raw) return fallback;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      keepBackup(raw);
      return {
        ...fallback,
        notice:
          "The saved timetable could not be read, so the official one is showing. The old copy is still in this browser.",
      };
    }

    const rows = Array.isArray(parsed) ? parsed : parsed && parsed.classes;
    if (!Array.isArray(rows)) {
      keepBackup(raw);
      return {
        ...fallback,
        notice:
          "The saved timetable could not be read, so the official one is showing. The old copy is still in this browser.",
      };
    }

    const valid = rows.map(normaliseClass).filter(Boolean);
    const dropped = rows.length - valid.length;

    if (!valid.length && rows.length) {
      keepBackup(raw);
      return {
        ...fallback,
        notice:
          rows.length === 1
            ? "The saved class could not be read, so the official timetable is showing. The old copy is still in this browser."
            : `None of the ${rows.length} saved classes could be read, so the official timetable is showing. The old copy is still in this browser.`,
      };
    }

    const weekend = valid.some((cls) => WEEKEND.has(cls.day));
    const showWeekend =
      weekend ||
      (typeof parsed.showWeekend === "boolean" ? parsed.showWeekend : false);

    return {
      classes: valid,
      showWeekend,
      weekOffset: clampOffset(parsed.weekOffset),
      notice: dropped
        ? `${dropped} saved ${
            dropped === 1 ? "class" : "classes"
          } could not be read and ${dropped === 1 ? "was" : "were"} skipped.`
        : "",
    };
  }

  function keepBackup(raw) {
    try {
      window.localStorage.setItem(BACKUP_KEY, raw);
    } catch (error) {
      /* The backup is best effort; the notice still tells the user. */
    }
  }

  function saveClasses() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          savedAt: new Date().toISOString(),
          showWeekend: state.showWeekend,
          weekOffset: state.weekOffset,
          classes: state.classes,
        })
      );
      state.notice = "";
      renderStorageNotice();
      return true;
    } catch (error) {
      state.notice = "Not saved. Browser storage is unavailable.";
      renderStorageNotice();
      return false;
    }
  }

  function normaliseClass(raw) {
    if (!raw || typeof raw !== "object") return null;

    const code = String(raw.code || "").trim().toUpperCase();
    const day = DAYS.includes(raw.day) ? raw.day : null;
    const start = normaliseTime(raw.start);
    const end = normaliseTime(raw.end);

    if (!code || !day || !start || !end) return null;
    if (toMinutes(end) <= toMinutes(start)) return null;
    if (toMinutes(start) < DAY_START || toMinutes(end) > DAY_END) return null;

    return {
      id: String(raw.id || makeId("class")),
      code,
      name: String(raw.name || code).trim() || code,
      type: String(raw.type || "LECTURE").trim().toUpperCase(),
      subgroup: String(raw.subgroup || "").trim(),
      day,
      start,
      end,
      venue: String(raw.venue || "").trim(),
      lecturer: String(raw.lecturer || "").trim(),
      online:
        Boolean(raw.online) || /online/i.test(String(raw.venue || "")),
    };
  }

  /* --------------------------------------------------------------- render */

  function render() {
    state.nowKey = dayKey(new Date());
    renderGrid();
    renderAgenda();
    renderWeek();
    renderStatus();
    renderStorageNotice();
  }

  function renderGrid() {
    const scrollLeft = els.gridScroll.scrollLeft;
    const days = visibleDays();
    const dates = weekDates();

    els.grid.innerHTML = "";

    const top = document.createElement("div");
    top.className = "timeline-top";
    top.setAttribute("aria-hidden", "true");

    const corner = document.createElement("div");
    corner.className = "timeline-corner";
    corner.textContent = "Date";

    top.append(corner, buildRuler());
    els.grid.appendChild(top);

    if (!state.classes.length) {
      els.grid.appendChild(buildEmptyState());
      els.gridScroll.scrollLeft = scrollLeft;
      return;
    }

    days.forEach((day) => {
      const date = dates[day];
      const row = document.createElement("div");
      row.className =
        "day-row" +
        (WEEKEND.has(day) ? " is-weekend" : "") +
        (isToday(date) ? " is-today" : "");
      row.dataset.day = day;
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `${day}, ${longDate(date)}`);

      const label = document.createElement("div");
      label.className = "day-label";
      label.innerHTML = `
        <span class="day-name">${DAY_ABBR[day]}</span>
        <span class="day-date">${formatDate(date)}</span>
      `;

      const track = document.createElement("div");
      track.className = "day-track";

      state.classes
        .filter((cls) => cls.day === day)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
        .forEach((cls) => track.appendChild(buildCard(cls)));

      appendNowLine(track, date);

      row.append(label, track);
      els.grid.appendChild(row);
    });

    els.gridScroll.scrollLeft = scrollLeft;
  }

  function renderAgenda() {
    const days = visibleDays();
    const dates = weekDates();

    els.agenda.innerHTML = "";

    if (!state.classes.length) {
      els.agenda.appendChild(buildEmptyState());
      return;
    }

    days.forEach((day) => {
      const date = dates[day];
      const items = state.classes
        .filter((cls) => cls.day === day)
        .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

      const group = document.createElement("section");
      group.className =
        "agenda-day" +
        (WEEKEND.has(day) ? " is-weekend" : "") +
        (isToday(date) ? " is-today" : "");
      group.setAttribute("aria-label", `${day}, ${longDate(date)}`);

      const head = document.createElement("div");
      head.className = "agenda-day-head";
      head.innerHTML = `
        <span class="agenda-day-name">${DAY_ABBR[day]}<span class="agenda-day-date">${formatDate(
        date
      )}</span></span>
        <span class="agenda-day-count">${
          items.length ? classCount(items.length) : ""
        }</span>
      `;

      group.appendChild(head);

      if (!items.length) {
        const free = document.createElement("p");
        free.className = "agenda-free";
        free.textContent = "No classes";
        group.appendChild(free);
      }

      items.forEach((cls) => group.appendChild(buildAgendaItem(cls)));

      els.agenda.appendChild(group);
    });
  }

  function renderWeek() {
    const label = `Week of ${formatWeekRange()}`;
    /* The label is a live region; only rewrite it when the week really moved,
       or every unrelated render would re-announce it. */
    if (els.weekLabel.textContent !== label) els.weekLabel.textContent = label;
    els.todayBtn.hidden = state.weekOffset === 0;
  }

  function renderStatus() {
    const official = isOfficialTimetable();
    els.statusPill.classList.toggle("is-edited", !official);
    els.statusText.textContent = official
      ? "Official timetable"
      : "Edited locally";
  }

  function renderStorageNotice() {
    els.saveState.textContent = state.notice || "Saved in this browser";
    els.saveState.classList.toggle("is-error", Boolean(state.notice));
  }

  function buildEmptyState() {
    const box = document.createElement("div");
    box.className = "grid-empty";

    const text = document.createElement("div");
    text.className = "grid-empty-text";
    text.setAttribute("role", "status");
    text.innerHTML =
      "<strong>No classes this week.</strong>" +
      "<span>Add one below, or bring back the 13 classes from UTS TimetableHub.</span>";
    box.appendChild(text);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-primary";
    add.textContent = "Add a class";
    add.addEventListener("click", () => openClassDialog("add"));
    box.appendChild(add);

    return box;
  }

  /* Put focus back on the class that was just edited, so a keyboard user does
     not restart from the top of the page after the sheet re-renders. */
  function focusClass(id) {
    if (id) {
      const match = $$(`[data-id="${cssEscape(id)}"]`).find(
        (node) => node.offsetParent !== null
      );
      if (match) {
        match.focus();
        return;
      }
    }
    els.addClassBtn.focus();
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function buildRuler() {
    const ruler = document.createElement("div");
    ruler.className = "time-ruler";

    for (let hour = 8; hour <= 23; hour += 1) {
      const pct = ((hour * 60 - DAY_START) / (DAY_END - DAY_START)) * 100;

      const label = document.createElement("span");
      label.className = "hour-label";
      if (hour === 8) label.classList.add("is-first");
      if (hour === 23) label.classList.add("is-last");
      label.style.left = `${pct}%`;
      label.textContent = `${String(hour).padStart(2, "0")}:00`;

      const tick = document.createElement("span");
      tick.className = "hour-tick";
      tick.style.left = `${pct}%`;

      ruler.append(label, tick);
    }

    return ruler;
  }

  function buildCard(cls) {
    const duration = toMinutes(cls.end) - toMinutes(cls.start);
    const left =
      ((toMinutes(cls.start) - DAY_START) / (DAY_END - DAY_START)) * 100;
    const width = (duration / (DAY_END - DAY_START)) * 100;

    const card = document.createElement("article");
    card.className = "class-card" + (duration <= 60 ? " is-compact" : "");
    card.dataset.id = cls.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-haspopup", "dialog");
    card.setAttribute(
      "aria-label",
      `${cls.code} ${shortType(cls.type)}, ${cls.day} ${cls.start} to ${
        cls.end
      }, ${cls.venue || "venue not set"}. Press Enter to edit.`
    );
    card.title = `${cls.code} · ${cls.name}\n${cls.type}${
      cls.subgroup ? ` (${cls.subgroup})` : ""
    } · ${cls.day} ${cls.start}–${cls.end}\n${displayVenue(cls)}${
      cls.lecturer ? `\n${cls.lecturer}` : ""
    }`;
    card.style.setProperty("--c", courseColor(cls.code));
    card.style.left = `calc(${left}% + 2px)`;
    card.style.width = `calc(${width}% - 4px)`;

    card.innerHTML = `
      <div class="cc-top">
        <span class="cc-dot" aria-hidden="true"></span>
        <span class="cc-code">${escapeHtml(cls.code)}</span>
        <span class="cc-type">${escapeHtml(shortType(cls.type))}</span>
      </div>
      <div class="cc-name">${escapeHtml(cls.name)}</div>
      <div class="cc-meta">
        <span class="cc-time"><span class="cc-start">${cls.start}</span><span class="cc-sep">–</span><span class="cc-end">${cls.end}</span></span>
        <span class="cc-venue">${escapeHtml(displayVenue(cls))}</span>
      </div>
    `;

    return card;
  }

  function buildAgendaItem(cls) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "agenda-item";
    item.dataset.id = cls.id;
    item.style.setProperty("--c", courseColor(cls.code));
    item.setAttribute("aria-haspopup", "dialog");
    item.setAttribute(
      "aria-label",
      `${cls.code} ${shortType(cls.type)}, ${cls.name}, ${cls.start} to ${
        cls.end
      }, ${displayVenue(cls)}${cls.lecturer ? `, ${cls.lecturer}` : ""}. Edit times.`
    );

    item.innerHTML = `
      <span class="agenda-time" aria-hidden="true">
        <span class="agenda-time-start">${cls.start}</span>
        <span class="agenda-time-end">${cls.end}</span>
      </span>
      <span class="agenda-body">
        <span class="agenda-top">
          <span class="cc-dot" aria-hidden="true"></span>
          <span class="agenda-code">${escapeHtml(cls.code)}</span>
          <span class="agenda-type">${escapeHtml(shortType(cls.type))}</span>
        </span>
        <span class="agenda-name">${escapeHtml(cls.name)}</span>
        <span class="agenda-venue">${escapeHtml(displayVenue(cls))}</span>
      </span>
      <span class="agenda-lecturer">${escapeHtml(cls.lecturer)}</span>
    `;

    return item;
  }

  function appendNowLine(track, date) {
    if (!isToday(date)) return;

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < DAY_START || minutes > DAY_END) return;

    const line = document.createElement("div");
    line.className = "now-line";
    line.setAttribute("aria-hidden", "true");
    line.style.left = `${((minutes - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
    track.appendChild(line);
  }

  function tickClock() {
    const now = new Date();

    if (dayKey(now) !== state.nowKey) {
      render();
      return;
    }

    const minutes = now.getHours() * 60 + now.getMinutes();
    const line = $(".now-line");

    if (minutes < DAY_START || minutes > DAY_END) {
      if (line) line.remove();
      return;
    }

    if (!line) {
      /* Only rebuild the sheet if today has a row to put the line in. */
      if ($(".day-row.is-today")) render();
      return;
    }

    line.style.left = `${((minutes - DAY_START) / (DAY_END - DAY_START)) * 100}%`;
  }

  /* ------------------------------------------------------------- dragging */

  function onPointerDown(event) {
    if (event.button !== 0) return;

    const card = event.target.closest(".class-card");
    if (!card) return;

    const cls = state.classes.find((item) => item.id === card.dataset.id);
    if (!cls) return;

    const rect = card.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      card,
      cls,
      startX: event.clientX,
      startY: event.clientY,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      before: snapshotState(),
      ghost: null,
      preview: null,
      target: null,
      started: false,
    };

    if (card.setPointerCapture) {
      try {
        card.setPointerCapture(event.pointerId);
      } catch (error) {
        /* Pointer capture is an enhancement, not a requirement. */
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.started) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) < 5) return;
      startDragging();
    }

    moveGhost(event);
    updateDropTarget(event);
  }

  function startDragging() {
    drag.started = true;
    drag.card.classList.add("is-dragging");

    const rect = drag.card.getBoundingClientRect();
    const ghost = drag.card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.classList.remove("is-dragging");
    ghost.removeAttribute("tabindex");
    ghost.style.width = `${drag.width}px`;
    ghost.style.height = `${drag.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    const preview = document.createElement("div");
    preview.className = "drop-preview";
    drag.preview = preview;
  }

  function moveGhost(event) {
    if (!drag.ghost) return;
    drag.ghost.style.left = `${event.clientX - drag.grabX}px`;
    drag.ghost.style.top = `${event.clientY - drag.grabY}px`;
    autoScroll(event);
  }

  function autoScroll(event) {
    const rect = els.gridScroll.getBoundingClientRect();
    const edge = 52;
    if (event.clientX < rect.left + edge && event.clientX > rect.left - 20) {
      els.gridScroll.scrollLeft -= 14;
    } else if (
      event.clientX > rect.right - edge &&
      event.clientX < rect.right + 20
    ) {
      els.gridScroll.scrollLeft += 14;
    }
  }

  function updateDropTarget(event) {
    const target = computeDropTarget(event.clientX, event.clientY);
    drag.target = target;

    if (!target) {
      if (drag.preview) drag.preview.remove();
      $$(".day-row.is-drop-target").forEach((row) =>
        row.classList.remove("is-drop-target")
      );
      return;
    }

    const { row, track, day, start, end, conflict } = target;
    const preview = drag.preview;

    if (preview.parentElement !== track) track.appendChild(preview);

    preview.style.left = `calc(${
      ((start - DAY_START) / (DAY_END - DAY_START)) * 100
    }% + 2px)`;
    preview.style.width = `calc(${
      ((end - start) / (DAY_END - DAY_START)) * 100
    }% - 4px)`;
    preview.textContent = `${DAY_ABBR[day]} ${toTime(start)}–${toTime(end)}`;
    preview.classList.toggle("is-invalid", Boolean(conflict));

    $$(".day-row.is-drop-target").forEach((item) =>
      item.classList.remove("is-drop-target")
    );
    row.classList.add("is-drop-target");
  }

  function computeDropTarget(clientX, clientY) {
    const row = $$(".day-row", els.grid).find((item) => {
      const rect = item.getBoundingClientRect();
      return clientY >= rect.top && clientY <= rect.bottom;
    });
    if (!row) return null;

    const track = $(".day-track", row);
    if (!track) return null;

    const trackRect = track.getBoundingClientRect();
    if (clientX < trackRect.left - 8 || clientX > trackRect.right + 8) {
      return null;
    }

    const pxPerMinute = trackRect.width / (DAY_END - DAY_START);
    const ghostLeft = clientX - drag.grabX;
    let start =
      DAY_START + (ghostLeft - trackRect.left) / Math.max(pxPerMinute, 0.001);
    start = Math.round(start / SNAP_MINUTES) * SNAP_MINUTES;

    const duration = toMinutes(drag.cls.end) - toMinutes(drag.cls.start);
    start = Math.max(DAY_START, Math.min(start, DAY_END - duration));
    const end = start + duration;
    const day = row.dataset.day;

    const conflict = state.classes.find(
      (cls) =>
        cls.id !== drag.cls.id &&
        cls.day === day &&
        toMinutes(cls.start) < end &&
        start < toMinutes(cls.end)
    );

    return { row, track, day, start, end, conflict };
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;

    const finished = drag;
    cleanupDrag();

    if (!finished.started) {
      openClassDialog("edit", finished.cls);
      return;
    }

    const cls = state.classes.find((item) => item.id === finished.cls.id);
    if (!cls) return;

    const target = finished.target;
    if (!target) {
      render();
      return;
    }

    if (target.conflict) {
      render();
      showToast(
        `That slot clashes with ${target.conflict.code} (${target.conflict.start}–${target.conflict.end}).`,
        { tone: "error" }
      );
      return;
    }

    const duration = toMinutes(cls.end) - toMinutes(cls.start);
    const sameSlot =
      cls.day === target.day &&
      toMinutes(cls.start) === target.start &&
      toMinutes(cls.end) === target.end;

    if (sameSlot) {
      render();
      return;
    }

    cls.day = target.day;
    cls.start = toTime(target.start);
    cls.end = toTime(target.start + duration);

    state.undo = finished.before;
    saveClasses();
    render();
    showToast(`Moved ${cls.code} to ${target.day}, ${cls.start}–${cls.end}.`, {
      undo: true,
    });
  }

  function cleanupDrag() {
    const finished = drag;
    drag = null;
    if (!finished) return;

    if (finished.ghost) finished.ghost.remove();
    if (finished.preview) finished.preview.remove();

    $$(".day-row.is-drop-target").forEach((row) =>
      row.classList.remove("is-drop-target")
    );

    finished.card.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }

  function onCardKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".class-card");
    if (!card) return;
    const cls = state.classes.find((item) => item.id === card.dataset.id);
    if (!cls) return;
    event.preventDefault();
    openClassDialog("edit", cls);
  }

  /* A pointer click is already handled on pointerup, so this listener exists
     for the other activators: screen readers, voice control, programmatic
     clicks. Those arrive with detail 0. */
  function onCardClick(event) {
    if (event.detail !== 0) return;
    const card = event.target.closest(".class-card");
    if (!card) return;
    const cls = state.classes.find((item) => item.id === card.dataset.id);
    if (cls) openClassDialog("edit", cls);
  }

  function onAgendaClick(event) {
    const item = event.target.closest(".agenda-item");
    if (!item) return;
    const cls = state.classes.find((entry) => entry.id === item.dataset.id);
    if (cls) openClassDialog("edit", cls);
  }

  /* --------------------------------------------------------------- modals */

  function openClassDialog(mode, cls) {
    els.classForm.reset();
    els.formError.textContent = "";
    els.classDialog.dataset.mode = mode;
    els.classDialog.dataset.id = cls ? cls.id : "";

    const editing = mode === "edit";
    els.classDialogKicker.textContent = editing ? "Class details" : "New class";
    els.classDialogTitle.textContent = editing ? "Edit class" : "Add class";
    els.deleteClassBtn.hidden = !editing;
    els.saveClassBtn.textContent = editing ? "Save changes" : "Add class";

    if (cls) {
      els.fieldCode.value = cls.code;
      els.fieldName.value = cls.name;
      els.fieldType.value = cls.type;
      els.fieldSubgroup.value = cls.subgroup;
      els.fieldDay.value = cls.day;
      els.fieldStart.value = cls.start;
      els.fieldEnd.value = cls.end;
      els.fieldVenue.value = cls.venue;
      els.fieldLecturer.value = cls.lecturer;
    } else {
      els.fieldType.value = "LECTURE";
      els.fieldDay.value = visibleDays()[0] || "Monday";
      els.fieldStart.value = "08:00";
      els.fieldEnd.value = "10:00";
    }

    els.classDialog.showModal();
    window.setTimeout(() => els.fieldCode.focus(), 40);
  }

  function saveClassFromForm(event) {
    event.preventDefault();
    els.formError.textContent = "";

    const mode = els.classDialog.dataset.mode;
    const currentId = els.classDialog.dataset.id;
    const code = els.fieldCode.value.trim().toUpperCase();
    const name = els.fieldName.value.trim() || code;
    const type = els.fieldType.value;
    const subgroup = els.fieldSubgroup.value.trim();
    const day = els.fieldDay.value;
    const start = normaliseTime(els.fieldStart.value);
    const end = normaliseTime(els.fieldEnd.value);
    const venue = els.fieldVenue.value.trim();
    const lecturer = els.fieldLecturer.value.trim();

    if (!code) {
      els.formError.textContent = "Enter a course code.";
      els.fieldCode.focus();
      return;
    }
    if (!DAYS.includes(day)) {
      els.formError.textContent = "Choose a valid day.";
      return;
    }
    if (!start || !end) {
      els.formError.textContent = "Enter a start and end time.";
      return;
    }
    if (toMinutes(end) <= toMinutes(start)) {
      els.formError.textContent = "The end time must be after the start time.";
      return;
    }
    if (toMinutes(start) < DAY_START || toMinutes(end) > DAY_END) {
      els.formError.textContent = `Classes must fall between ${toTime(
        DAY_START
      )} and ${toTime(DAY_END)}.`;
      return;
    }

    const conflict = state.classes.find(
      (cls) =>
        cls.id !== currentId &&
        cls.day === day &&
        toMinutes(cls.start) < toMinutes(end) &&
        toMinutes(start) < toMinutes(cls.end)
    );
    if (conflict) {
      els.formError.textContent = `That time clashes with ${conflict.code} ${shortType(
        conflict.type
      )} (${conflict.start}–${conflict.end}).`;
      return;
    }

    const candidate = {
      id: mode === "edit" ? currentId : makeId("class"),
      code,
      name,
      type,
      subgroup,
      day,
      start,
      end,
      venue,
      lecturer,
      online: /online/i.test(venue),
    };

    els.classDialog.close();

    applyChange(
      () => {
        if (mode === "edit") {
          const index = state.classes.findIndex((cls) => cls.id === currentId);
          if (index !== -1) state.classes[index] = candidate;
        } else {
          state.classes.push(candidate);
        }
        if (WEEKEND.has(day)) {
          state.showWeekend = true;
          syncWeekendButton();
        }
      },
      mode === "edit"
        ? `Updated ${code} ${shortType(type)}.`
        : `Added ${code} ${shortType(type)} on ${day}.`
    );

    focusClass(candidate.id);
  }

  function deleteCurrentClass() {
    const id = els.classDialog.dataset.id;
    const cls = state.classes.find((item) => item.id === id);
    if (!cls) return;

    els.classDialog.close();
    applyChange(() => {
      state.classes = state.classes.filter((item) => item.id !== id);
    }, `Deleted ${cls.code} ${shortType(cls.type)} from ${cls.day}.`);
    focusClass(null);
  }

  /* --------------------------------------------------------------- actions */

  function applyChange(mutator, message) {
    const snapshot = snapshotState();
    mutator();
    state.undo = snapshot;
    saveClasses();
    render();
    showToast(message, { undo: true });
  }

  function shiftWeek(delta, goToCurrent = false) {
    const next = goToCurrent ? 0 : clampOffset(state.weekOffset + delta);
    if (next === state.weekOffset) return;
    state.weekOffset = next;
    saveClasses();
    render();
  }

  function requestReset() {
    if (isOfficialTimetable()) {
      showToast("You are already using the official timetable.", {
        tone: "notice",
      });
      return;
    }
    els.resetDialog.showModal();
  }

  function resetToOfficial() {
    els.resetDialog.close();
    applyChange(() => {
      state.classes = deepClone(OFFICIAL);
      state.showWeekend = false;
      syncWeekendButton();
    }, "Official timetable restored.");
  }

  function undoLastChange() {
    if (!state.undo) return;
    const snapshot = state.undo;
    state.undo = null;
    state.classes = snapshot.classes;
    state.showWeekend = snapshot.showWeekend;
    state.weekOffset = snapshot.weekOffset;
    saveClasses();
    render();
    syncWeekendButton();
    hideToast();
    showToast("Change undone.", { tone: "notice" });
  }

  function toggleWeekend() {
    if (
      state.showWeekend &&
      state.classes.some((cls) => WEEKEND.has(cls.day))
    ) {
      showToast("Move weekend classes to a weekday before hiding them.", {
        tone: "notice",
      });
      return;
    }
    state.showWeekend = !state.showWeekend;
    syncWeekendButton();
    saveClasses();
    render();
  }

  function syncWeekendButton() {
    els.weekendBtn.setAttribute(
      "aria-pressed",
      state.showWeekend ? "true" : "false"
    );
    els.weekendBtn.textContent = state.showWeekend
      ? "Hide weekend"
      : "Show weekend";
  }

  function handleBeforePrint() {
    state.printRestore = { weekend: state.showWeekend };
    if (
      !state.showWeekend &&
      state.classes.some((cls) => WEEKEND.has(cls.day))
    ) {
      state.showWeekend = true;
      syncWeekendButton();
      render();
    }
  }

  function handleAfterPrint() {
    if (!state.printRestore) return;
    state.showWeekend = state.printRestore.weekend;
    state.printRestore = null;
    syncWeekendButton();
    render();
  }

  /* ----------------------------------------------------------------- toast */

  function showToast(message, options = {}) {
    const undoable = Boolean(options.undo);
    const tone = options.tone || "success";

    els.toastMessage.textContent = message;
    els.toastUndo.hidden = !undoable;
    els.toast.classList.toggle("is-error", tone === "error");
    els.toastIcon.hidden = tone === "notice";
    els.toastIcon.textContent = tone === "error" ? "!" : "✓";
    els.toast.classList.add("is-visible");

    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(
      () => {
        els.toast.classList.remove("is-visible");
        if (undoable) state.undo = null;
      },
      undoable ? 9000 : 4200
    );
  }

  function hideToast() {
    els.toast.classList.remove("is-visible");
    window.clearTimeout(state.toastTimer);
  }

  /* ---------------------------------------------------------------- errors */

  function showFatalError(error) {
    console.error(error);
    if (!els.grid) return;

    const box = document.createElement("div");
    box.className = "grid-error";
    box.setAttribute("role", "alert");
    box.innerHTML =
      "<strong>The timetable could not load.</strong>" +
      "<span>Reload the page to try again. Your saved classes are untouched.</span>";

    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "btn btn-primary";
    reload.textContent = "Reload";
    reload.addEventListener("click", () => window.location.reload());
    box.appendChild(reload);

    els.grid.innerHTML = "";
    els.grid.appendChild(box);
    els.agenda.innerHTML = "";
    els.agenda.appendChild(box.cloneNode(true));
    els.agenda.querySelector(".btn")?.addEventListener("click", () =>
      window.location.reload()
    );
    els.statusText.textContent = "Timetable unavailable";
  }

  /* ---------------------------------------------------------------- helpers */

  function visibleDays() {
    return state.showWeekend ? DAYS : DAYS.slice(0, 5);
  }

  function snapshotState() {
    return {
      classes: deepClone(state.classes),
      showWeekend: state.showWeekend,
      weekOffset: state.weekOffset,
    };
  }

  function isOfficialTimetable() {
    return canon(state.classes) === canon(OFFICIAL);
  }

  function canon(rows) {
    return JSON.stringify(
      [...rows]
        .map((cls) => [
          cls.id,
          cls.code,
          cls.name,
          cls.type,
          cls.subgroup,
          cls.day,
          cls.start,
          cls.end,
          cls.venue,
          cls.lecturer,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
  }

  function weekStartDate() {
    const base = new Date(`${TIMETABLE_META.weekStart}T00:00:00`);
    base.setDate(base.getDate() + state.weekOffset * 7);
    return base;
  }

  function weekDates() {
    const base = weekStartDate();
    const dates = {};
    DAYS.forEach((day, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() + index);
      dates[day] = date;
    });
    return dates;
  }

  function formatWeekRange() {
    const dates = weekDates();
    const days = visibleDays();
    const first = dates[days[0]];
    const last = dates[days[days.length - 1]];
    const month = new Intl.DateTimeFormat("en-GB", { month: "short" });
    const year = last.getFullYear();

    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()} – ${last.getDate()} ${month.format(first)} ${year}`;
    }
    return `${first.getDate()} ${month.format(first)} – ${last.getDate()} ${month.format(
      last
    )} ${year}`;
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
    }).format(date);
  }

  function longDate(date) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
    }).format(date);
  }

  function classCount(count) {
    if (!count) return "No classes";
    return `${count} ${count === 1 ? "class" : "classes"}`;
  }

  function isToday(date) {
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function clampOffset(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(-MAX_WEEK_OFFSET, Math.min(MAX_WEEK_OFFSET, Math.trunc(number)));
  }

  function displayVenue(cls) {
    if (!cls.online) return cls.venue || "Venue TBC";
    const cleaned = String(cls.venue || "")
      .replace(/\[online\]/gi, "")
      .replace(/\bonline\b/gi, "")
      .replace(/^[\s·\-]+|[\s·\-]+$/g, "")
      .trim();
    return cleaned ? `Online · ${cleaned}` : "Online";
  }

  function shortType(type) {
    const map = {
      LECTURE: "LEC",
      TUTORIAL: "TUT",
      PRACTICAL: "PRAC",
      "TUTORIAL/PRACTICAL": "TUT/PRAC",
    };
    return map[type] || String(type || "").slice(0, 8);
  }

  function courseColor(code) {
    const course = COURSES.find((item) => item.code === code);
    if (course) return course.color;
    let hash = 0;
    for (let index = 0; index < code.length; index += 1) {
      hash = (hash * 31 + code.charCodeAt(index)) >>> 0;
    }
    return CUSTOM_COLORS[hash % CUSTOM_COLORS.length];
  }

  function toMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function toTime(minutes) {
    const value = Math.max(0, Math.round(minutes));
    const hours = Math.floor(value / 60);
    const mins = value % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
  }

  function normaliseTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return map[character];
    });
  }
})();
