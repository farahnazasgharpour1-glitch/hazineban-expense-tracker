/* ui.js — تنها مسئول نمایش داده‌ها؛ متن‌های کاربر همیشه escape می‌شوند. */
(function (global) {
  "use strict";

  const faNum = new Intl.NumberFormat("fa-IR");
  const faDate = new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "2-digit", day: "2-digit" });
  const faMoney = (value) => `${faNum.format(Math.round(Number(value) || 0))} ریال`;
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const palette = ["#5369d8", "#18a392", "#e2a34d", "#9b83db", "#de7282", "#79a4c8"];

  function money(value) {
    return faNum.format(Math.round(Number(value) || 0));
  }

  function humanDate(iso) {
    const parts = String(iso).split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return String(iso || "—");
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    return Number.isNaN(date.getTime()) ? String(iso) : faDate.format(date);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[character]));
  }

  function animateNumber(element, target) {
    const formatted = money(target);
    if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.textContent = formatted;
      return;
    }
    const previous = Number(element.dataset.numericValue || 0);
    element.dataset.numericValue = String(target);
    const start = performance.now();
    const duration = 420;
    function frame(now) {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = money(previous + (target - previous) * eased);
      if (progress < 1) global.requestAnimationFrame(frame);
      else element.textContent = formatted;
    }
    global.requestAnimationFrame(frame);
  }

  function renderMetrics(expenses) {
    const active = expenses.filter((item) => item.status !== "rejected");
    const total = active.reduce((sum, item) => sum + item.amount, 0);
    const pending = expenses.filter((item) => item.status === "pending");
    const approved = expenses.filter((item) => item.status === "approved");

    animateNumber(document.getElementById("mTotal"), total);
    document.getElementById("mCount").textContent = faNum.format(expenses.length);
    animateNumber(document.getElementById("mPending"), pending.reduce((sum, item) => sum + item.amount, 0));
    animateNumber(document.getElementById("mApproved"), approved.reduce((sum, item) => sum + item.amount, 0));
  }

  function renderChart(expenses) {
    const host = document.getElementById("chartBars");
    const donutHost = document.getElementById("chartDonut");
    const totals = Object.create(null);
    expenses.filter((item) => item.status !== "rejected").forEach((item) => {
      if (!hasOwn(Store.CATEGORIES, item.category)) return;
      totals[item.category] = (totals[item.category] || 0) + item.amount;
    });
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      host.innerHTML = '<p class="empty">پس از ثبت هزینه، تحلیل دسته‌بندی اینجا نمایش داده می‌شود.</p>';
      donutHost.innerHTML = '<div class="donut-empty" aria-hidden="true"><span>بدون داده</span></div>';
      return;
    }

    const maximum = entries[0][1];
    host.innerHTML = entries.map(([category, total], index) => {
      const percent = Math.max(3, Math.round((total / maximum) * 100));
      return `<div class="chart__row">
        <span class="chart__label">${escapeHtml(Store.CATEGORIES[category])}</span>
        <div class="chart__track"><div class="chart__bar chart__bar--${index % 4}" style="--bar-width:${percent}%"></div></div>
        <span class="chart__value">${money(total)} <small>ریال</small></span>
      </div>`;
    }).join("");

    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    const circumference = 2 * Math.PI * 42;
    let offset = 0;
    const segments = entries.map(([category, amount], index) => {
      const length = (amount / total) * circumference;
      const markup = `<circle class="donut__segment" cx="54" cy="54" r="42" fill="none" stroke="${palette[index % palette.length]}" stroke-width="12" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" />`;
      offset += length;
      return markup;
    }).join("");
    const legend = entries.map(([category, amount], index) => `<li><span class="donut__swatch" style="--swatch:${palette[index % palette.length]}"></span><span>${escapeHtml(Store.CATEGORIES[category])}</span><strong>${faNum.format(Math.round((amount / total) * 100))}٪</strong></li>`).join("");
    donutHost.innerHTML = `<div class="donut__visual"><svg viewBox="0 0 108 108" role="img" aria-label="نمودار دونات سهم دسته‌های هزینه">${segments}</svg><div class="donut__center"><strong>${faNum.format(entries.length)}</strong><small>دسته فعال</small></div></div><ul class="donut__legend">${legend}</ul>`;
  }

  function renderBudget(month, expenses, budget) {
    const [year, monthNumber] = month.split("-").map(Number);
    const monthNames = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
    const monthLabel = Number.isFinite(year) && monthNumber >= 1 && monthNumber <= 12
      ? `${monthNames[monthNumber - 1]} ${faNum.format(year)}`
      : "ماه انتخاب‌شده";
    const jalaliParts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric", month: "2-digit", timeZone: "UTC" });
    const monthExpenses = expenses.filter((item) => {
      const parts = Object.fromEntries(jalaliParts.formatToParts(new Date(`${item.date}T00:00:00Z`)).map((part) => [part.type, part.value]));
      return `${parts.year}-${parts.month}` === month && item.status !== "rejected";
    });
    const spent = monthExpenses.reduce((sum, item) => sum + item.amount, 0);
    const percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
    const remaining = budget - spent;
    const fill = document.getElementById("budgetProgress");
    const track = document.getElementById("budgetTrack");
    const alert = document.getElementById("budgetAlert");

    document.getElementById("budgetMonthLabel").textContent = monthLabel;
    document.getElementById("budgetPercent").textContent = budget > 0 ? `${faNum.format(percent)}٪` : "—";
    document.getElementById("budgetSpent").textContent = faMoney(spent);
    document.getElementById("budgetLimit").textContent = budget > 0 ? faMoney(budget) : "تعیین نشده";
    document.getElementById("budgetRemaining").textContent = budget > 0 ? faMoney(Math.max(remaining, 0)) : "—";
    fill.style.width = `${Math.min(percent, 100)}%`;
    track.setAttribute("aria-valuenow", String(Math.min(percent, 100)));
    track.setAttribute("aria-valuetext", budget > 0 ? `${percent} درصد بودجه` : "بودجه تعیین نشده");
    track.classList.toggle("is-warning", budget > 0 && percent >= 80 && percent < 100);
    track.classList.toggle("is-over", budget > 0 && percent >= 100);

    alert.className = "budget-alert";
    if (!budget) {
      alert.textContent = "برای این ماه هنوز بودجه‌ای تعیین نشده است.";
    } else if (percent >= 100) {
      alert.textContent = `سقف بودجه ${faNum.format(percent - 100)}٪ بیشتر شده است. هزینه‌های جدید را با دقت بررسی کن.`;
      alert.classList.add("budget-alert--danger");
    } else if (percent >= 80) {
      alert.textContent = `هشدار: ${faNum.format(percent)}٪ از بودجه مصرف شده است؛ به سقف ماهانه نزدیک شده‌ای.`;
      alert.classList.add("budget-alert--warning");
    } else {
      alert.textContent = `وضعیت مناسب است؛ ${faNum.format(100 - percent)}٪ از بودجه هنوز مصرف نشده است.`;
      alert.classList.add("budget-alert--ok");
    }
  }

  function renderTable(expenses, totalCount, page, pageSize) {
    const body = document.getElementById("tableBody");
    const empty = document.getElementById("emptyState");
    const resultCount = document.getElementById("resultCount");
    const pageInfo = document.getElementById("pageInfo");
    const prev = document.getElementById("prevPage");
    const next = document.getElementById("nextPage");
    resultCount.textContent = `${faNum.format(totalCount)} رکورد`;

    if (!totalCount) {
      body.innerHTML = "";
      empty.hidden = false;
      pageInfo.textContent = "۰ از ۰";
      prev.disabled = true;
      next.disabled = true;
      return;
    }
    empty.hidden = true;

    body.innerHTML = expenses.map((item) => {
      const statusLabel = hasOwn(Store.STATUS, item.status) ? Store.STATUS[item.status] : Store.STATUS.pending;
      const statusActions = item.status === "pending"
        ? `<button class="btn btn--sm btn--approve" data-action="status" data-status="approved" data-id="${escapeHtml(item.id)}">تأیید</button><button class="btn btn--sm btn--reject" data-action="status" data-status="rejected" data-id="${escapeHtml(item.id)}">رد</button>`
        : `<button class="btn btn--sm btn--ghost" data-action="status" data-status="pending" data-id="${escapeHtml(item.id)}">بازگردانی</button>`;
      return `<tr data-id="${escapeHtml(item.id)}">
        <td data-label="تاریخ">${humanDate(item.date)}</td>
        <td data-label="شرح"><strong>${escapeHtml(item.title)}</strong>${item.vendor ? `<br><small class="muted">${escapeHtml(item.vendor)}</small>` : ""}${item.isDemo ? '<span class="demo-tag">نمونه</span>' : ""}</td>
        <td data-label="دسته">${escapeHtml(hasOwn(Store.CATEGORIES, item.category) ? Store.CATEGORIES[item.category] : "سایر")}</td>
        <td data-label="واحد">${escapeHtml(hasOwn(Store.DEPARTMENTS, item.department) ? Store.DEPARTMENTS[item.department] : "مالی")}</td>
        <td data-label="مبلغ (ریال)" class="num">${money(item.amount)}</td>
        <td data-label="وضعیت"><span class="badge badge--${escapeHtml(item.status)}">${escapeHtml(statusLabel)}</span></td>
        <td data-label="عملیات"><div class="table-actions"><button class="btn btn--sm btn--ghost" data-action="edit" data-id="${escapeHtml(item.id)}">ویرایش</button>${statusActions}<button class="btn btn--sm btn--danger" data-action="delete" data-id="${escapeHtml(item.id)}">حذف</button></div></td>
      </tr>`;
    }).join("");

    const pages = Math.max(1, Math.ceil(totalCount / pageSize));
    pageInfo.textContent = `صفحهٔ ${faNum.format(page)} از ${faNum.format(pages)}`;
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
  }

  global.UI = { money, faMoney, humanDate, escapeHtml, renderMetrics, renderChart, renderBudget, renderTable };
})(window);
