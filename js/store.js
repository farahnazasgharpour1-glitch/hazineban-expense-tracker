/* store.js — لایه داده؛ ورودی‌ها پیش از ذخیره‌سازی اعتبارسنجی و نرمال‌سازی می‌شوند. */
(function (global) {
  "use strict";

  const EXPENSES_KEY = "hazineban.expenses.v3";
  const BUDGETS_KEY = "hazineban.budgets.v2";
  const LEGACY_BUDGETS_KEY = "hazineban.budgets.v1";
  const LEGACY_KEY = "ledger.v2";
  const APP_NAME = "hazineban-expense-manager";
  const VERSION = 4;
  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

  const CATEGORIES = Object.freeze({
    travel: "سفر و مأموریت",
    office: "اداری و دفتری",
    it: "فناوری اطلاعات",
    marketing: "بازاریابی",
    salary: "حقوق و دستمزد",
    other: "سایر",
  });

  const DEPARTMENTS = Object.freeze({
    sales: "فروش",
    it: "فنی",
    hr: "منابع انسانی",
    finance: "مالی",
  });

  const STATUS = Object.freeze({
    pending: "در انتظار",
    approved: "تأییدشده",
    rejected: "ردشده",
  });

  function normalizeDigits(value) {
    return String(value ?? "")
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[٬,\s]/g, "")
      .trim();
  }

  function parseAmount(value) {
    const normalized = normalizeDigits(value);
    if (!/^\d+$/.test(normalized)) return NaN;
    const amount = Number(normalized);
    return Number.isSafeInteger(amount) ? amount : NaN;
  }

  function createId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }
    return `hb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readStorage(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (error) {
      console.error("خواندن فضای ذخیره‌سازی ممکن نیست:", error);
      return null;
    }
  }

  function safeParse(raw) {
    try {
      const value = JSON.parse(raw);
      return value && typeof value === "object" ? value : null;
    } catch (error) {
      console.warn("دادهٔ ذخیره‌شده قابل خواندن نبود:", error);
      return null;
    }
  }

  function isIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function normalize(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const amount = parseAmount(item.amount);
    const title = String(item.title || "").trim().slice(0, 120);
    const date = String(item.date || "").slice(0, 10);
    const incomingId = String(item.id || "");
    const id = SAFE_ID.test(incomingId) ? incomingId : createId();

    if (!title || !isIsoDate(date) || !Number.isSafeInteger(amount) || amount <= 0) return null;

    return {
      id,
      title,
      amount,
      category: hasOwn(CATEGORIES, item.category) ? item.category : "other",
      department: hasOwn(DEPARTMENTS, item.department) ? item.department : "finance",
      vendor: String(item.vendor || "").trim().slice(0, 80),
      note: String(item.note || "").trim().slice(0, 300),
      date,
      status: hasOwn(STATUS, item.status) ? item.status : "pending",
      createdAt: typeof item.createdAt === "string" ? item.createdAt.slice(0, 40) : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt.slice(0, 40) : new Date().toISOString(),
      isDemo: Boolean(item.isDemo),
    };
  }

  function normalizeBudgetMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.create(null);
    return Object.entries(value).reduce((result, [month, rawAmount]) => {
      const amount = parseAmount(rawAmount);
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number.isSafeInteger(amount) && amount > 0) {
        result[month] = amount;
      }
      return result;
    }, Object.create(null));
  }

  function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    const usedIds = new Set();
    return list.map((raw) => {
      const item = normalize(raw);
      if (!item) return null;
      if (usedIds.has(item.id)) item.id = createId();
      usedIds.add(item.id);
      return item;
    }).filter(Boolean);
  }

  function writeExpenses(list) {
    try {
      global.localStorage.setItem(EXPENSES_KEY, JSON.stringify({ version: VERSION, expenses: list }));
      return true;
    } catch (error) {
      console.error("ذخیره هزینه‌ها ناموفق بود:", error);
      return false;
    }
  }

  function readExpenses() {
    const current = safeParse(readStorage(EXPENSES_KEY));
    if (current && Array.isArray(current.expenses)) {
      const normalized = normalizeList(current.expenses);
      // هر تغییر نرمال‌سازی (از جمله بازسازی شناسه نامعتبر) باید پایدار شود؛
      // مقایسه صرف تعداد رکوردها برای شناسه‌های معیوب کافی نیست.
      if (JSON.stringify(normalized) !== JSON.stringify(current.expenses)) writeExpenses(normalized);
      return normalized;
    }

    // مهاجرت بدون حذف داده‌های نسخهٔ قبلی
    const legacy = safeParse(readStorage(LEGACY_KEY));
    const legacyList = Array.isArray(legacy) ? legacy : legacy && legacy.expenses;
    if (Array.isArray(legacyList)) {
      const migrated = normalizeList(legacyList);
      writeExpenses(migrated);
      return migrated;
    }
    return [];
  }

  function gregorianMonthToJalaliKey(month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
      year: "numeric", month: "2-digit", timeZone: "UTC",
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}`;
  }

  function migrateLegacyBudgets(value) {
    const oldBudgets = normalizeBudgetMap(value);
    const migrated = Object.create(null);
    Object.entries(oldBudgets).forEach(([gregorianMonth, amount]) => {
      const jalaliMonth = gregorianMonthToJalaliKey(gregorianMonth);
      if (jalaliMonth) migrated[jalaliMonth] = amount;
    });
    return migrated;
  }

  function readBudgets() {
    const current = safeParse(readStorage(BUDGETS_KEY));
    if (current && typeof current === "object") return normalizeBudgetMap(current);
    const legacy = safeParse(readStorage(LEGACY_BUDGETS_KEY));
    const migrated = migrateLegacyBudgets(legacy);
    if (Object.keys(migrated).length) writeBudgets(migrated);
    return migrated;
  }

  function writeBudgets(budgets) {
    try {
      global.localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
      return true;
    } catch (error) {
      console.error("ذخیره بودجه‌ها ناموفق بود:", error);
      return false;
    }
  }

  const Store = {
    CATEGORIES,
    DEPARTMENTS,
    STATUS,
    hasOwn,
    parseAmount,

    list() {
      return readExpenses().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    },

    add(input) {
      const item = normalize({ ...input, id: createId(), status: "pending" });
      if (!item) throw new Error("اطلاعات هزینه معتبر نیست. شرح، مبلغ و تاریخ را بررسی کن.");
      const list = readExpenses();
      list.push(item);
      if (!writeExpenses(list)) throw new Error("فضای ذخیره‌سازی مرورگر در دسترس نیست. فضا را بررسی یا از اطلاعات پشتیبان بگیر.");
      return item;
    },

    update(id, input) {
      const list = readExpenses();
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("هزینهٔ موردنظر پیدا نشد.");
      const updated = normalize({ ...list[index], ...input, id, updatedAt: new Date().toISOString() });
      if (!updated) throw new Error("اطلاعات ویرایش‌شده معتبر نیست.");
      list[index] = updated;
      if (!writeExpenses(list)) throw new Error("ذخیره تغییرات انجام نشد.");
      return updated;
    },

    updateStatus(id, status) {
      if (!hasOwn(STATUS, status)) return false;
      const list = readExpenses();
      const target = list.find((item) => item.id === id);
      if (!target) return false;
      target.status = status;
      target.updatedAt = new Date().toISOString();
      return writeExpenses(list);
    },

    remove(id) {
      const list = readExpenses().filter((item) => item.id !== id);
      return writeExpenses(list);
    },

    getBudget(month) {
      return readBudgets()[month] || 0;
    },

    setBudget(month, rawAmount) {
      const value = parseAmount(rawAmount);
      const validMonth = /^(\d{4})-(\d{2})$/.exec(month);
      if (!validMonth || Number(validMonth[2]) < 1 || Number(validMonth[2]) > 12 || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error("ماه و مبلغ بودجه را به‌درستی وارد کن.");
      }
      const budgets = readBudgets();
      budgets[month] = value;
      if (!writeBudgets(budgets)) throw new Error("ذخیره بودجه انجام نشد.");
      return value;
    },

    backup() {
      return {
        app: APP_NAME,
        version: VERSION,
        exportedAt: new Date().toISOString(),
        expenses: this.list(),
        budgets: readBudgets(),
      };
    },

    restoreBackup(data) {
      if (!data || typeof data !== "object") throw new Error("ساختار فایل پشتیبان معتبر نیست.");
      if (!Array.isArray(data) && data.app && data.app !== APP_NAME) {
        throw new Error("این فایل پشتیبان متعلق به هزینه‌بان نیست.");
      }
      if (!Array.isArray(data) && Number(data.version) > VERSION) {
        throw new Error("نسخهٔ فایل پشتیبان جدیدتر از این برنامه است.");
      }
      const rawExpenses = Array.isArray(data) ? data : data.expenses;
      if (!Array.isArray(rawExpenses)) throw new Error("فایل انتخاب‌شده فهرست هزینهٔ قابل بازیابی ندارد.");
      if (rawExpenses.length > 10000) throw new Error("تعداد رکوردهای فایل بیش از حد مجاز است.");

      const expenses = normalizeList(rawExpenses);
      const rawBudgets = normalizeBudgetMap(Array.isArray(data) ? {} : data.budgets || {});
      const backupVersion = Array.isArray(data) ? 1 : Number(data.version || 1);
      const budgets = backupVersion < 4 ? migrateLegacyBudgets(rawBudgets) : rawBudgets;
      if (rawExpenses.length > 0 && expenses.length === 0) {
        throw new Error("هیچ رکورد معتبری در فایل پشتیبان پیدا نشد.");
      }
      // دو کلید را تا حد امکان تراکنشی جایگزین می‌کنیم تا خطای ذخیره نیمه‌کاره نماند.
      const previousExpenses = readStorage(EXPENSES_KEY);
      const previousBudgets = readStorage(BUDGETS_KEY);
      try {
        global.localStorage.setItem(EXPENSES_KEY, JSON.stringify({ version: VERSION, expenses }));
        global.localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets));
      } catch (error) {
        try {
          if (previousExpenses === null) global.localStorage.removeItem(EXPENSES_KEY);
          else global.localStorage.setItem(EXPENSES_KEY, previousExpenses);
          if (previousBudgets === null) global.localStorage.removeItem(BUDGETS_KEY);
          else global.localStorage.setItem(BUDGETS_KEY, previousBudgets);
        } catch (rollbackError) {
          console.error("بازگردانی وضعیت قبلی پس از خطای بازیابی ناموفق بود:", rollbackError);
        }
        throw new Error("بازیابی کامل نشد؛ اطلاعات قبلی تا حد امکان حفظ شدند. فضای ذخیره‌سازی مرورگر را بررسی کن.");
      }
      return expenses.length;
    },

    loadDemo(monthKey) {
      const now = new Date();
      const jalaliParts = Object.fromEntries(new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
        year: "numeric", month: "2-digit", timeZone: "UTC",
      }).formatToParts(now).map((part) => [part.type, part.value]));
      const month = /^\d{4}-\d{2}$/.test(String(monthKey || "")) ? String(monthKey) : `${jalaliParts.year}-${jalaliParts.month}`;
      const target = /^([0-9]{4})-([0-9]{2})$/.exec(month);
      const monthStart = (() => {
        if (!target) return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
        const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        for (let delta = -40; delta <= 2; delta += 1) {
          const candidate = new Date(todayUtc + delta * 86400000);
          const parts = Object.fromEntries(new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
            year: "numeric", month: "2-digit", timeZone: "UTC",
          }).formatToParts(candidate).map((part) => [part.type, part.value]));
          if (`${parts.year}-${parts.month}` === month) {
            const dayParts = Object.fromEntries(new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
              year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC",
            }).formatToParts(candidate).map((part) => [part.type, part.value]));
            if (dayParts.day === "01") return candidate;
          }
        }
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      })();
      const dateAt = (offset) => {
        const date = new Date(monthStart.getTime() + offset * 86400000);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      };
      const examples = [
        ["خرید تجهیزات اداری", 18500000, "office", "finance", "تجهیزگستر", "تأمین تجهیزات واحد مالی", "approved", 0],
        ["اشتراک ابزارهای طراحی", 8900000, "it", "it", "آوید کلاد", "تمدید اشتراک نرم‌افزارهای تیم طراحی", "approved", 1],
        ["رفت‌وآمد جلسه با مشتری", 2400000, "travel", "sales", "تاکسی اینترنتی", "جلسه معرفی خدمات", "pending", 2],
        ["اجرای کمپین معرفی محصول", 12000000, "marketing", "sales", "استودیو هفت", "هزینه تولید محتوای کمپین", "approved", 3],
        ["پذیرایی جلسه تیم", 1850000, "other", "hr", "کافه آبان", "جلسه برنامه‌ریزی ماهانه", "pending", 4],
        ["حق‌الزحمه پشتیبانی", 15000000, "salary", "hr", "همکار پشتیبانی", "حق‌الزحمه ماهانه", "approved", 5],
        ["تعمیر تجهیزات شبکه", 3200000, "it", "it", "فناوران شبکه", "تعویض قطعه روتر", "pending", 6],
        ["خرید لوازم جانبی", 1150000, "office", "finance", "بازار ابزار", "خرید کابل و مبدل", "rejected", 7],
      ];
      const timestamp = new Date().toISOString();
      const expenses = examples.map((row) => normalize({
        title: row[0], amount: row[1], category: row[2], department: row[3], vendor: row[4],
        note: row[5], status: row[6], date: dateAt(row[7]), isDemo: true, createdAt: timestamp,
      })).filter(Boolean);
      const budgets = readBudgets();
      budgets[month] = 70000000;
      if (!writeExpenses(expenses) || !writeBudgets(budgets)) throw new Error("بارگذاری داده‌های نمونه ممکن نشد.");
      return expenses.length;
    },
  };

  global.Store = Store;
})(window);
