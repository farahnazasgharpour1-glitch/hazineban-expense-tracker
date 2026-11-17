/* app.js — کنترل تعاملات؛ منطق ذخیره‌سازی در Store و نمایش در UI نگهداری می‌شود. */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const faNum = new Intl.NumberFormat("fa-IR");
  const filters = { q: "", category: "", status: "", from: "", to: "" };
  const sortState = { key: "date", direction: "desc" };
  let currentPage = 1;
  let pageSize = 10;
  let toastTimer = null;
  let searchTimer = null;

  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function currentMonth() { return jalaliMonthKeyFromIso(localDateString()); }

  function normalizeDigits(value) {
    return String(value ?? "")
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .trim();
  }

  function formatPersianDigits(value) {
    return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
  }

  // تبدیل جلالی به میلادی؛ داده‌ها در LocalStorage به شکل ISO/Gregorian نگهداری می‌شوند.
  function div(a, b) { return Math.floor(a / b); }
  function mod(a, b) { return a - Math.floor(a / b) * b; }

  function jalaliCalendar(year) {
    const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    if (year < breaks[0] || year >= breaks[breaks.length - 1]) return null;
    const gy = year + 621;
    let leapJ = -14;
    let jp = breaks[0];
    let jump = 0;
    let jm = 0;
    for (let index = 1; index < breaks.length; index += 1) {
      jm = breaks[index];
      jump = jm - jp;
      if (year < jm) break;
      leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    const n = year - jp;
    leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    let leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { gy, march, leap };
  }

  function jalaliMonthLength(year, month) {
    if (month <= 6) return 31;
    if (month <= 11) return 30;
    const calendar = jalaliCalendar(year);
    return calendar && calendar.leap === 0 ? 30 : 29;
  }

  function jalaliToIso(value) {
    const clean = normalizeDigits(value).replace(/[.\-]/g, "/");
    const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(clean);
    if (!match) return "";
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const calendar = jalaliCalendar(year);
    if (!calendar || month < 1 || month > 12 || day < 1 || day > jalaliMonthLength(year, month)) return "";
    const offset = (month - 1) * 31 - div(month, 7) * (month - 7) + day - 1;
    const gregorian = new Date(Date.UTC(calendar.gy, 2, calendar.march) + offset * 86400000);
    return `${gregorian.getUTCFullYear()}-${String(gregorian.getUTCMonth() + 1).padStart(2, "0")}-${String(gregorian.getUTCDate()).padStart(2, "0")}`;
  }

  function jalaliMonthToKey(value) {
    const clean = normalizeDigits(value).replace(/[.\-]/g, "/");
    const match = /^(\d{4})\/(\d{1,2})$/.exec(clean);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || !jalaliCalendar(Number(match[1]))) return "";
    return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
  }

  const jalaliFormatter = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC",
  });

  function isoToJalali(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const parts = Object.fromEntries(jalaliFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    return formatPersianDigits(`${parts.year}/${parts.month}/${parts.day}`);
  }

  function isoMonthToJalali(monthKey) {
    return formatPersianDigits(String(monthKey).replace("-", "/"));
  }

  function jalaliMonthKeyFromIso(iso) {
    const parts = normalizeDigits(isoToJalali(iso)).split("/");
    return parts.length === 3 ? `${parts[0]}-${parts[1]}` : "";
  }

  /* ---------- تقویم شمسی بومی و سبک ---------- */
  const jalaliMonths = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
  const jalaliDialog = $("#jalaliDialog");
  const jalaliTitle = $("#jalaliTitle");
  const jalaliDays = $("#jalaliDays");
  const jalaliMonthGrid = $("#jalaliMonthGrid");
  const jalaliDateView = $("#jalaliDateView");
  let jalaliPickerState = null;
  let jalaliPickerTrigger = null;

  function dispatchInputChange(input) {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderJalaliPicker() {
    if (!jalaliPickerState) return;
    const { year, month, mode, selectedDay } = jalaliPickerState;
    jalaliTitle.textContent = mode === "month" ? `انتخاب ماه · ${faNum.format(year)}` : `${jalaliMonths[month - 1]} ${faNum.format(year)}`;
    jalaliDateView.hidden = mode === "month";
    jalaliMonthGrid.hidden = mode !== "month";

    if (mode === "month") {
      jalaliMonthGrid.innerHTML = jalaliMonths.map((name, index) => {
        const monthNumber = index + 1;
        const active = monthNumber === month;
        return `<button type="button" class="jalali-month-option" data-calendar-month="${monthNumber}" aria-pressed="${active}">${name}</button>`;
      }).join("");
      return;
    }

    const firstIso = jalaliToIso(`${year}/${month}/1`);
    const [firstYear, firstMonth, firstDay] = firstIso.split("-").map(Number);
    const firstWeekday = (new Date(Date.UTC(firstYear, firstMonth - 1, firstDay)).getUTCDay() + 1) % 7;
    const daysInMonth = jalaliMonthLength(year, month);
    const cells = [];
    for (let blank = 0; blank < firstWeekday; blank += 1) cells.push('<span class="jalali-day-empty" aria-hidden="true"></span>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const active = day === selectedDay;
      cells.push(`<button type="button" class="jalali-day" data-calendar-day="${day}" aria-pressed="${active}" aria-label="${faNum.format(day)} ${jalaliMonths[month - 1]} ${faNum.format(year)}">${faNum.format(day)}</button>`);
    }
    jalaliDays.innerHTML = cells.join("");
  }

  function closeJalaliPicker() {
    if (jalaliDialog.open) jalaliDialog.close();
  }

  function chooseJalaliDay(day) {
    if (!jalaliPickerState) return;
    const { year, month, targetId } = jalaliPickerState;
    const iso = jalaliToIso(`${year}/${month}/${day}`);
    if (!iso) return;
    const input = document.getElementById(targetId);
    input.value = isoToJalali(iso);
    clearFieldError(targetId, targetId === "budgetMonth" ? "#budgetForm" : "#expenseForm");
    dispatchInputChange(input);
    closeJalaliPicker();
  }

  function chooseJalaliMonth(month) {
    if (!jalaliPickerState) return;
    const input = document.getElementById(jalaliPickerState.targetId);
    input.value = formatPersianDigits(`${jalaliPickerState.year}/${String(month).padStart(2, "0")}`);
    clearFieldError(jalaliPickerState.targetId, "#budgetForm");
    dispatchInputChange(input);
    closeJalaliPicker();
  }

  function openJalaliPicker(targetId, mode, trigger) {
    const input = document.getElementById(targetId);
    const current = mode === "month"
      ? jalaliMonthToKey(input.value) || currentMonth()
      : (() => {
        const iso = jalaliToIso(input.value) || localDateString();
        const parts = normalizeDigits(isoToJalali(iso)).split("/");
        return parts.length === 3 ? `${parts[0]}-${parts[1]}-${parts[2]}` : `${currentMonth()}-01`;
      })();
    const [year, month, selectedDay = "1"] = current.split("-").map(Number);
    jalaliPickerState = { targetId, mode, year, month, selectedDay };
    jalaliPickerTrigger = trigger;
    document.querySelectorAll("[data-calendar-target]").forEach((button) => button.setAttribute("aria-expanded", String(button === trigger)));
    renderJalaliPicker();
    if (!jalaliDialog.open) jalaliDialog.showModal();
    $("#jalaliPrev").focus();
  }

  document.querySelectorAll("[data-calendar-target]").forEach((trigger) => {
    trigger.addEventListener("click", () => openJalaliPicker(trigger.dataset.calendarTarget, trigger.dataset.calendarMode, trigger));
  });
  $("#jalaliPrev").addEventListener("click", () => {
    if (!jalaliPickerState) return;
    if (jalaliPickerState.mode === "month") jalaliPickerState.year -= 1;
    else if (jalaliPickerState.month === 1) { jalaliPickerState.month = 12; jalaliPickerState.year -= 1; }
    else jalaliPickerState.month -= 1;
    renderJalaliPicker();
  });
  $("#jalaliNext").addEventListener("click", () => {
    if (!jalaliPickerState) return;
    if (jalaliPickerState.mode === "month") jalaliPickerState.year += 1;
    else if (jalaliPickerState.month === 12) { jalaliPickerState.month = 1; jalaliPickerState.year += 1; }
    else jalaliPickerState.month += 1;
    renderJalaliPicker();
  });
  jalaliDays.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-day]");
    if (button) chooseJalaliDay(Number(button.dataset.calendarDay));
  });
  jalaliMonthGrid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-month]");
    if (button) chooseJalaliMonth(Number(button.dataset.calendarMonth));
  });
  $("#jalaliToday").addEventListener("click", () => {
    if (!jalaliPickerState) return;
    if (jalaliPickerState.mode === "month") {
      const [year, month] = currentMonth().split("-").map(Number);
      jalaliPickerState.year = year;
      chooseJalaliMonth(month);
    } else {
      const todayParts = normalizeDigits(isoToJalali(localDateString())).split("/").map(Number);
      jalaliPickerState.year = todayParts[0];
      jalaliPickerState.month = todayParts[1];
      chooseJalaliDay(todayParts[2]);
    }
  });
  $("#jalaliClose").addEventListener("click", closeJalaliPicker);
  jalaliDialog.addEventListener("close", () => {
    document.querySelectorAll("[data-calendar-target]").forEach((button) => button.setAttribute("aria-expanded", "false"));
    if (jalaliPickerTrigger) jalaliPickerTrigger.focus();
    jalaliPickerTrigger = null;
    jalaliPickerState = null;
  });

  function showToast(message, type = "success") {
    const toast = $("#toast");
    toast.textContent = message;
    toast.className = `toast toast--${type}`;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3600);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function confirmAction(message) {
    const dialog = $("#confirmDialog");
    $("#confirmMessage").textContent = message;
    return new Promise((resolve) => {
      const finish = () => {
        dialog.removeEventListener("close", finish);
        resolve(dialog.returnValue === "confirm");
      };
      dialog.addEventListener("close", finish, { once: true });
      dialog.showModal();
      $("#confirmAccept").focus();
    });
  }

  function formatAmountInput(input) {
    const raw = normalizeDigits(input.value).replace(/[٬,\s]/g, "");
    if (!raw) { input.value = ""; return; }
    if (!/^\d+$/.test(raw)) return;
    const value = Number(raw);
    if (Number.isSafeInteger(value)) input.value = faNum.format(value);
  }

  function setFieldError(fieldId, message, formSelector = "#expenseForm") {
    const field = document.getElementById(fieldId);
    const slot = document.querySelector(`${formSelector} [data-error-for="${fieldId}"]`);
    if (field) field.setAttribute("aria-invalid", "true");
    if (slot) slot.textContent = message;
  }

  function clearFieldError(fieldId, formSelector = "#expenseForm") {
    const field = document.getElementById(fieldId);
    const slot = document.querySelector(`${formSelector} [data-error-for="${fieldId}"]`);
    if (field) field.removeAttribute("aria-invalid");
    if (slot) slot.textContent = "";
  }

  /* ---------- منوی کناری و مدیریت فوکوس ---------- */
  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const menuButton = $("#menuBtn");
  const mobileQuery = window.matchMedia("(max-width: 860px)");
  const currentRoute = document.body.dataset.page || "dashboard";
  const pageTitles = {
    dashboard: "نمای کلی",
    expenses: "مدیریت هزینه‌ها",
    budget: "بودجه ماهانه",
    reports: "گزارش‌ها و تحلیل",
    settings: "تنظیمات و داده‌ها",
    help: "راهنمای استفاده",
  };
  const pageHeading = document.getElementById("pageHeading");
  if (pageHeading) pageHeading.textContent = pageTitles[currentRoute] || pageTitles.dashboard;
  document.querySelectorAll("[data-page-link]").forEach((link) => {
    const isMobileMoreOnHelp = currentRoute === "help" && link.closest(".mobile-nav") && link.dataset.pageLink === "settings";
    const active = link.dataset.pageLink === currentRoute || Boolean(isMobileMoreOnHelp);
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  function syncSidebarAccessibility() {
    const closedOnMobile = mobileQuery.matches && !sidebar.classList.contains("is-open");
    sidebar.setAttribute("aria-hidden", String(closedOnMobile));
    if ("inert" in sidebar) sidebar.inert = closedOnMobile;
  }

  function openMenu() {
    sidebar.classList.add("is-open");
    overlay.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
    syncSidebarAccessibility();
    const firstLink = sidebar.querySelector("[data-nav]");
    if (firstLink) firstLink.focus();
  }

  function closeMenu(restoreFocus = false) {
    sidebar.classList.remove("is-open");
    overlay.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
    syncSidebarAccessibility();
    if (restoreFocus && mobileQuery.matches) menuButton.focus();
  }

  menuButton.addEventListener("click", () => sidebar.classList.contains("is-open") ? closeMenu() : openMenu());
  overlay.addEventListener("click", () => closeMenu(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("is-open")) closeMenu(true);
  });
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.addEventListener("click", () => {
      document.querySelectorAll("[data-nav]").forEach((item) => {
        item.classList.remove("is-active");
        item.removeAttribute("aria-current");
      });
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
      if (mobileQuery.matches) closeMenu(true);
    });
  });
  if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", syncSidebarAccessibility);
  else mobileQuery.addListener(syncSidebarAccessibility);
  window.addEventListener("resize", syncSidebarAccessibility, { passive: true });
  syncSidebarAccessibility();

  /* ---------- پوسته روشن / تاریک ---------- */
  const themeKey = "hazineban.theme";
  function setTheme(theme) {
    const dark = theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    $("#themeToggle").setAttribute("aria-pressed", String(dark));
    $("#themeToggle").setAttribute("aria-label", dark ? "فعال‌کردن حالت روشن" : "فعال‌کردن حالت تاریک");
    $("#themeColorMeta").setAttribute("content", dark ? "#0c1427" : "#101a33");
    try { localStorage.setItem(themeKey, dark ? "dark" : "light"); } catch (error) { /* تنظیم پوسته بدون ذخیره نیز کار می‌کند. */ }
  }
  let savedTheme = "light";
  try { savedTheme = localStorage.getItem(themeKey) || "light"; } catch (error) { /* localStorage ممکن است غیرفعال باشد. */ }
  setTheme(savedTheme);
  $("#themeToggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  /* ---------- تاریخ شمسی و بودجه ---------- */
  $("#todayLabel").textContent = new Intl.DateTimeFormat("fa-IR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(new Date());
  $("#fDate").value = isoToJalali(localDateString());
  $("#budgetMonth").value = isoMonthToJalali(currentMonth());
  $("#budgetAmount").value = Store.getBudget(currentMonth()) ? faNum.format(Store.getBudget(currentMonth())) : "";

  function getSelectedMonth() { return jalaliMonthToKey($("#budgetMonth").value) || currentMonth(); }

  $("#fDate").addEventListener("change", () => {
    const iso = jalaliToIso($("#fDate").value);
    if (!iso) {
      if ($("#fDate").value.trim()) setFieldError("fDate", "تاریخ شمسی معتبر وارد کن؛ نمونه: ۱۴۰۵/۰۸/۲۶");
      return;
    }
    clearFieldError("fDate");
    $("#fDate").value = isoToJalali(iso);
  });
  $("#fDate").addEventListener("input", () => clearFieldError("fDate"));

  $("#budgetMonth").addEventListener("change", () => {
    const month = jalaliMonthToKey($("#budgetMonth").value);
    clearFieldError("budgetMonth", "#budgetForm");
    if (!month) {
      setFieldError("budgetMonth", "ماه را به شکل ۱۴۰۵/۰۸ و در بازهٔ معتبر وارد کن.", "#budgetForm");
      return;
    }
    $("#budgetMonth").value = isoMonthToJalali(month);
    const amount = Store.getBudget(month);
    $("#budgetAmount").value = amount ? faNum.format(amount) : "";
    refresh();
  });

  $("#budgetAmount").addEventListener("blur", (event) => formatAmountInput(event.target));
  $("#fAmount").addEventListener("blur", (event) => formatAmountInput(event.target));

  /* ---------- فیلتر و رندر صفحه‌بندی‌شده ---------- */
  function applyFilters(list) {
    return list.filter((item) => {
      if (filters.category && item.category !== filters.category) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (filters.from && item.date < filters.from) return false;
      if (filters.to && item.date > filters.to) return false;
      if (filters.q) {
        const haystack = `${item.title} ${item.vendor} ${item.note}`.toLocaleLowerCase("fa");
        if (!haystack.includes(filters.q.toLocaleLowerCase("fa"))) return false;
      }
      return true;
    });
  }

  function sortExpenses(list) {
    const direction = sortState.direction === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let result = 0;
      if (sortState.key === "date" || sortState.key === "title") result = String(a[sortState.key]).localeCompare(String(b[sortState.key]), "fa");
      if (sortState.key === "amount") result = a.amount - b.amount;
      return result * direction;
    });
  }

  function updateSortControls() {
    document.querySelectorAll("[data-sort]").forEach((button) => {
      const header = button.closest("th");
      if (!header) return;
      if (button.dataset.sort === sortState.key) header.setAttribute("aria-sort", sortState.direction === "asc" ? "ascending" : "descending");
      else header.removeAttribute("aria-sort");
      button.setAttribute("aria-pressed", String(button.dataset.sort === sortState.key));
    });
  }

  function refresh() {
    const all = Store.list();
    UI.renderMetrics(all);
    UI.renderChart(all);
    const month = getSelectedMonth();
    UI.renderBudget(month, all, Store.getBudget(month));

    const filtered = sortExpenses(applyFilters(all));
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * pageSize;
    UI.renderTable(filtered.slice(start, start + pageSize), filtered.length, currentPage, pageSize);
    updateSortControls();
  }

  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      if (sortState.key === button.dataset.sort) sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      else {
        sortState.key = button.dataset.sort;
        sortState.direction = button.dataset.sort === "title" ? "asc" : "desc";
      }
      currentPage = 1;
      refresh();
    });
  });
  $("#pageSize").addEventListener("change", (event) => {
    pageSize = Number(event.target.value) || 10;
    currentPage = 1;
    refresh();
  });
  $("#prevPage").addEventListener("click", () => { currentPage = Math.max(1, currentPage - 1); refresh(); });
  $("#nextPage").addEventListener("click", () => { currentPage += 1; refresh(); });

  $("#budgetForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const month = jalaliMonthToKey($("#budgetMonth").value);
    const amount = Store.parseAmount($("#budgetAmount").value);
    clearFieldError("budgetMonth", "#budgetForm");
    if (!month) {
      setFieldError("budgetMonth", "ماه معتبر نیست. نمونه: ۱۴۰۵/۰۸", "#budgetForm");
      $("#budgetMonth").focus();
      return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showToast("مبلغ بودجه باید عدد صحیح و بزرگ‌تر از صفر باشد.", "error");
      $("#budgetAmount").focus();
      return;
    }
    try {
      Store.setBudget(month, amount);
      $("#budgetMonth").value = isoMonthToJalali(month);
      $("#budgetAmount").value = faNum.format(amount);
      currentPage = 1;
      refresh();
      showToast("بودجه ماهانه ذخیره شد.");
    } catch (error) { showToast(error.message, "error"); }
  });

  /* ---------- فرم ثبت / ویرایش در پنل کشویی ---------- */
  const expenseDrawer = $("#expenseDrawer");
  function openExpenseDrawer() {
    if (!expenseDrawer.open) expenseDrawer.showModal();
    window.setTimeout(() => $("#fTitle").focus(), 80);
  }
  function closeExpenseDrawer() {
    if (expenseDrawer.open) expenseDrawer.close();
  }
  $("#closeFormDrawerBtn").addEventListener("click", closeExpenseDrawer);
  expenseDrawer.addEventListener("click", (event) => {
    if (event.target === expenseDrawer) closeExpenseDrawer();
  });

  const form = $("#expenseForm");
  function clearErrors() {
    form.querySelectorAll("[data-error-for]").forEach((slot) => { slot.textContent = ""; });
    form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
  }
  function setError(fieldId, message) { setFieldError(fieldId, message); }

  function validate(data) {
    clearErrors();
    let valid = true;
    if (!data.title.trim()) { setError("fTitle", "شرح هزینه را وارد کن."); valid = false; }
    const amount = Store.parseAmount(data.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError("fAmount", "مبلغ باید عددی صحیح و بزرگ‌تر از صفر باشد."); valid = false; }
    if (!Store.hasOwn(Store.CATEGORIES, data.category)) { setError("fCategory", "دسته هزینه را انتخاب کن."); valid = false; }
    if (!Store.hasOwn(Store.DEPARTMENTS, data.department)) { setError("fDepartment", "واحد سازمانی را انتخاب کن."); valid = false; }
    const isoDate = jalaliToIso(data.date);
    if (!isoDate) { setError("fDate", "تاریخ شمسی معتبر وارد کن؛ نمونه: ۱۴۰۵/۰۸/۲۶"); valid = false; }
    if (!valid) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
      return false;
    }
    data.amount = amount;
    data.date = isoDate;
    return true;
  }

  function resetEditMode() {
    $("#editId").value = "";
    $("#formTitle").textContent = "ثبت هزینه جدید";
    $("#saveExpenseBtn").textContent = "ثبت هزینه";
    $("#cancelEditBtn").hidden = true;
  }
  function cancelEditing() {
    form.reset();
    clearErrors();
    resetEditMode();
    $("#fDate").value = isoToJalali(localDateString());
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const editId = data.editId;
    delete data.editId;
    if (!validate(data)) return;
    try {
      if (editId) {
        Store.update(editId, data);
        showToast("هزینه با موفقیت ویرایش شد.");
      } else {
        Store.add(data);
        showToast("هزینه جدید ثبت شد.");
      }
      cancelEditing();
      closeExpenseDrawer();
      currentPage = 1;
      refresh();
    } catch (error) { showToast(error.message, "error"); }
  });

  form.addEventListener("reset", () => {
    window.setTimeout(() => { clearErrors(); resetEditMode(); }, 0);
  });
  $("#cancelEditBtn").addEventListener("click", cancelEditing);
  $("#openFormBtn").addEventListener("click", () => {
    cancelEditing();
    openExpenseDrawer();
  });

  /* ---------- فیلترها با debounce ---------- */
  $("#q").addEventListener("input", (event) => {
    filters.q = event.target.value;
    currentPage = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(refresh, 180);
  });
  $("#fltCategory").addEventListener("change", (event) => { filters.category = event.target.value; currentPage = 1; refresh(); });
  $("#fltStatus").addEventListener("change", (event) => { filters.status = event.target.value; currentPage = 1; refresh(); });
  $("#fltFrom").addEventListener("change", (event) => {
    filters.from = event.target.value ? jalaliToIso(event.target.value) : "";
    if (event.target.value && !filters.from) showToast("تاریخ شروع معتبر نیست؛ نمونه ۱۴۰۵/۰۸/۰۱", "error");
    currentPage = 1; refresh();
  });
  $("#fltTo").addEventListener("change", (event) => {
    filters.to = event.target.value ? jalaliToIso(event.target.value) : "";
    if (event.target.value && !filters.to) showToast("تاریخ پایان معتبر نیست؛ نمونه ۱۴۰۵/۰۸/۳۰", "error");
    currentPage = 1; refresh();
  });
  ["#fltFrom", "#fltTo"].forEach((selector) => $(selector).addEventListener("blur", (event) => {
    const iso = jalaliToIso(event.target.value);
    if (iso) event.target.value = isoToJalali(iso);
  }));

  $("#resetFilters").addEventListener("click", () => {
    Object.keys(filters).forEach((key) => { filters[key] = ""; });
    ["q", "fltCategory", "fltStatus", "fltFrom", "fltTo"].forEach((id) => { $("#" + id).value = ""; });
    currentPage = 1;
    refresh();
  });

  /* ---------- عملیات جدول ---------- */
  $("#tableBody").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    const item = Store.list().find((record) => record.id === id);
    if (!item) return;

    if (action === "delete") {
      const accepted = await confirmAction(`هزینه «${item.title}» حذف شود؟ این کار قابل بازگشت نیست.`);
      if (!accepted) return;
      if (!Store.remove(id)) { showToast("حذف رکورد انجام نشد.", "error"); return; }
      refresh();
      showToast("رکورد حذف شد.");
      return;
    }
    if (action === "status") {
      if (Store.updateStatus(id, button.dataset.status)) {
        refresh();
        showToast("وضعیت هزینه به‌روزرسانی شد.");
      }
      return;
    }
    if (action === "edit") {
      $("#editId").value = item.id;
      $("#fTitle").value = item.title;
      $("#fAmount").value = faNum.format(item.amount);
      $("#fCategory").value = item.category;
      $("#fDepartment").value = item.department;
      $("#fVendor").value = item.vendor;
      $("#fDate").value = isoToJalali(item.date);
      $("#fNote").value = item.note;
      $("#formTitle").textContent = "ویرایش هزینه";
      $("#saveExpenseBtn").textContent = "ذخیره تغییرات";
      $("#cancelEditBtn").hidden = false;
      clearErrors();
      openExpenseDrawer();
    }
  });

  /* ---------- خروجی CSV با محافظت در برابر Formula Injection ---------- */
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[\s\u0000-\u001f\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  $("#exportCsvBtn").addEventListener("click", () => {
    const rows = applyFilters(Store.list());
    if (!rows.length) { showToast("برای خروجی گرفتن رکوردی وجود ندارد.", "error"); return; }
    const header = ["تاریخ شمسی", "شرح", "دسته", "واحد", "طرف حساب", "مبلغ (ریال)", "وضعیت", "توضیحات"];
    const data = [header, ...rows.map((item) => [
      isoToJalali(item.date), item.title, Store.CATEGORIES[item.category], Store.DEPARTMENTS[item.department],
      item.vendor, item.amount, Store.STATUS[item.status], item.note,
    ])];
    const csv = data.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }), `hazineban-expenses-${localDateString()}.csv`);
    showToast("فایل CSV آماده شد.");
  });

  /* ---------- پشتیبان‌گیری و بازیابی JSON ---------- */
  $("#backupBtn").addEventListener("click", () => {
    const backup = Store.backup();
    downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" }), `hazineban-backup-${localDateString()}.json`);
    showToast("فایل پشتیبان دانلود شد.");
  });

  $("#restoreInput").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast("حجم فایل پشتیبان نباید بیشتر از ۵ مگابایت باشد.", "error"); return; }
    const accepted = await confirmAction("اطلاعات فعلی با اطلاعات فایل پشتیبان جایگزین می‌شود. قبل از ادامه، از اطلاعات فعلی نسخه پشتیبان گرفته‌ای؟");
    if (!accepted) return;
    try {
      const contents = await file.text();
      const count = Store.restoreBackup(JSON.parse(contents));
      currentPage = 1;
      refresh();
      showToast(`${faNum.format(count)} رکورد بازیابی شد.`);
    } catch (error) { showToast(error.message || "فایل پشتیبان قابل بازیابی نیست.", "error"); }
  });

  /* ---------- داده‌های نمونهٔ نمایشی ---------- */
  $("#demoDataBtn").addEventListener("click", async () => {
    const existing = Store.list().length;
    const message = existing
      ? "داده‌های فعلی با ۸ رکورد نمایشی جایگزین می‌شوند. اگر اطلاعات واقعی داری، ابتدا پشتیبان بگیر. ادامه می‌دهی؟"
      : "۸ رکورد نمونه و یک بودجه نمایشی برای نمایش امکانات بارگذاری شود؟";
    if (!await confirmAction(message)) return;
    try {
      const count = Store.loadDemo(currentMonth());
      $("#budgetMonth").value = isoMonthToJalali(currentMonth());
      $("#budgetAmount").value = faNum.format(Store.getBudget(currentMonth()));
      currentPage = 1;
      refresh();
      showToast(`${faNum.format(count)} رکورد نمونه بارگذاری شد.`);
    } catch (error) { showToast(error.message, "error"); }
  });

  /* ---------- گزارش چاپی / ذخیره به PDF ---------- */
  function buildReportHtml(month, expenses, budget) {
    const monthExpenses = expenses.filter((item) => jalaliMonthKeyFromIso(item.date) === month && item.status !== "rejected");
    const total = monthExpenses.reduce((sum, item) => sum + item.amount, 0);
    const pending = monthExpenses.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.amount, 0);
    const approved = monthExpenses.filter((item) => item.status === "approved").reduce((sum, item) => sum + item.amount, 0);
    const [year, monthNumber] = month.split("-").map(Number);
    const jalaliMonths = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
    const monthTitle = `${jalaliMonths[monthNumber - 1] || "ماه نامشخص"} ${faNum.format(year)}`;
    const rows = monthExpenses.map((item) => `<tr><td>${UI.humanDate(item.date)}</td><td>${UI.escapeHtml(item.title)}</td><td>${UI.escapeHtml(Store.CATEGORIES[item.category])}</td><td>${UI.escapeHtml(Store.DEPARTMENTS[item.department])}</td><td>${UI.money(item.amount)} ریال</td><td>${UI.escapeHtml(Store.STATUS[item.status])}</td></tr>`).join("");
    const categoryTotals = Object.entries(monthExpenses.reduce((result, item) => {
      result[item.category] = (result[item.category] || 0) + item.amount;
      return result;
    }, Object.create(null))).sort((a, b) => b[1] - a[1]);
    const categoryRows = categoryTotals.map(([category, amount]) => `<tr><td>${UI.escapeHtml(Store.CATEGORIES[category])}</td><td>${UI.money(amount)} ریال</td><td>${total ? faNum.format(Math.round((amount / total) * 100)) : "۰"}٪</td></tr>`).join("");
    const remaining = budget ? Math.max(budget - total, 0) : null;

    const reportStylesheet = new URL("css/report.css?v=2.8.0", window.location.href).href;
    return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>گزارش مالی ${monthTitle} | هزینه‌بان</title><link rel="stylesheet" href="${UI.escapeHtml(reportStylesheet)}"></head><body><main class="report"><header class="report-head"><div><div class="brand">هزینه‌بان</div><div class="sub">گزارش مدیریت هزینه‌ها</div></div><div class="period">دوره گزارش: ${monthTitle}<br>تاریخ تهیه: ${UI.humanDate(localDateString())}</div></header>
      <section class="stats"><div class="stat"><small>مجموع هزینه‌های فعال</small><strong>${UI.money(total)} ریال</strong></div><div class="stat"><small>بودجه ماهانه</small><strong>${budget ? `${UI.money(budget)} ریال` : "تعیین نشده"}</strong></div><div class="stat"><small>باقی‌مانده بودجه</small><strong>${remaining === null ? "—" : `${UI.money(remaining)} ریال`}</strong></div><div class="stat"><small>تعداد رکوردها</small><strong>${faNum.format(monthExpenses.length)}</strong></div></section>
      <p class="sub">مبالغ بر حسب ریال هستند. هزینه‌های ردشده در جمع هزینه‌های فعال محاسبه نشده‌اند.</p><h2>جزئیات هزینه‌ها</h2><table class="report-table"><thead><tr><th>تاریخ</th><th>شرح هزینه</th><th>دسته</th><th>واحد</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>${rows || '<tr><td colspan="6">برای این ماه هزینه‌ای ثبت نشده است.</td></tr>'}</tbody></table>
      <h2>تفکیک هزینه بر اساس دسته</h2><table class="report-table"><thead><tr><th>دسته</th><th>مبلغ</th><th>سهم از کل</th></tr></thead><tbody>${categoryRows || '<tr><td colspan="3">داده‌ای برای تحلیل وجود ندارد.</td></tr>'}</tbody></table>
      <h2>خلاصه وضعیت</h2><p>مبلغ تأییدشده: <strong>${UI.money(approved)} ریال</strong> · مبلغ در انتظار بررسی: <strong>${UI.money(pending)} ریال</strong></p><footer class="footer">این گزارش به‌صورت محلی توسط نمونه‌کار نمایشی هزینه‌بان تولید شده است.</footer></main></body></html>`;
  }

  $("#reportBtn").addEventListener("click", () => {
    const month = getSelectedMonth();
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) { showToast("مرورگر پنجرهٔ گزارش را مسدود کرد؛ اجازهٔ بازشدن پنجرهٔ جدید را فعال کن.", "error"); return; }
    reportWindow.document.open();
    reportWindow.document.write(buildReportHtml(month, Store.list(), Store.getBudget(month)));
    reportWindow.document.close();
    window.setTimeout(() => {
      try { reportWindow.focus(); reportWindow.print(); } catch (error) { showToast("برای ذخیره PDF از گزینهٔ چاپ مرورگر استفاده کن.", "error"); }
    }, 450);
  });

  /* ---------- شروع ---------- */
  refresh();
})();
