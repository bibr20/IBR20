
/* =========================================================
   IBR ADMIN DASHBOARD
   لوحة النظرة العامة للإدارة
   الإصدار: 1.0
   ========================================================= */

(function () {
    "use strict";

    if (window.IBRAdminDashboard) return;

    const dashboard = {
        client: null,
        config: {},
        initialized: false,
        loading: false,
        lastData: null
    };

    /* -----------------------------------------------------
       الإعدادات الافتراضية
    ----------------------------------------------------- */

    const DEFAULTS = {
        selectors: {
            orders: '[data-dashboard-stat="orders"]',
            products: '[data-dashboard-stat="products"]',
            messages: '[data-dashboard-stat="messages"]',
            pending: '[data-dashboard-stat="pending"]',

            recentOrders: '[data-dashboard-recent-orders]',
            recentMessages: '[data-dashboard-recent-messages]',

            lastUpdated: '[data-dashboard-updated]',
            refreshButton: '[data-dashboard-refresh]',
            loading: '[data-dashboard-loading]',
            error: '[data-dashboard-error]'
        },

        limits: {
            recentOrders: 5,
            recentMessages: 5
        },

        tables: {},

        fields: {
            orders: {
                createdAt: null,
                status: null
            },

            products: {
                active: null
            },

            messages: {
                createdAt: null,
                status: null
            }
        },

        statuses: {
            pending: []
        },

        onLoad: null,
        onError: null
    };

    /* -----------------------------------------------------
       أدوات مساعدة
    ----------------------------------------------------- */

    function mergeConfig(base, extra, seen = new WeakMap()) {
    // التحقق من أن القيمة كائن عادي
    const isPlainObject = value =>
        value !== null &&
        typeof value === "object" &&
        (
            Object.getPrototypeOf(value) === Object.prototype ||
            Object.getPrototypeOf(value) === null
        );

    // إذا لم تكن الإعدادات الإضافية كائنًا عاديًا
    if (!isPlainObject(extra)) {
        return extra === undefined ? base : extra;
    }

    // منع التكرار الناتج عن المراجع الدائرية
    if (seen.has(extra)) {
        return seen.get(extra);
    }

    const result = isPlainObject(base)
        ? { ...base }
        : {};

    // تسجيل الكائن قبل بدء الدمج
    seen.set(extra, result);

    Object.keys(extra).forEach(key => {
        const value = extra[key];

        if (isPlainObject(value)) {
            result[key] = mergeConfig(
                result[key],
                value,
                seen
            );
        } else {
            // المصفوفات والقيم الأخرى تُحفظ كما هي
            result[key] = value;
        }
    });

    return result;
}

    function escapeHTML(value) {
        if (window.IBRAdmin?.escapeHTML) {
            return window.IBRAdmin.escapeHTML(value);
        }

        return String(value ?? "").replace(
            /[&<>"']/g,
            char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[char]
        );
    }

    function formatNumber(value) {
        if (window.IBRAdmin?.formatNumber) {
            return window.IBRAdmin.formatNumber(value);
        }

        return Number(value || 0).toLocaleString("ar-SA");
    }

    function formatDate(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "—";
        }

        return date.toLocaleDateString("ar-SA", {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function formatDateTime(value) {
        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "—";
        }

        return date.toLocaleString("ar-SA", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    }

    function notify(message, type = "info") {
        if (window.IBRAdmin?.notify) {
            window.IBRAdmin.notify(message, type);
            return;
        }

        console[type === "error" ? "error" : "log"](message);
    }

    function getElement(selector) {
        if (!selector) return null;

        return document.querySelector(selector);
    }

    function setText(selector, value) {
        const element = getElement(selector);

        if (element) {
            element.textContent = value;
        }
    }

    function setHTML(selector, value) {
        const element = getElement(selector);

        if (element) {
            element.innerHTML = value;
        }
    }

    function showElement(selector, visible) {
        const element = getElement(selector);

        if (element) {
            element.hidden = !visible;
        }
    }

    function getTableName(name) {
        return dashboard.config.tables?.[name] || null;
    }

    function getField(group, name) {
        return dashboard.config.fields?.[group]?.[name] || null;
    }

    /* -----------------------------------------------------
       التحقق من الإعدادات
    ----------------------------------------------------- */

    function validateConfiguration() {
        if (!dashboard.client) {
            throw new Error(
                "لم يتم ربط لوحة الإدارة بعميل Supabase."
            );
        }

        if (typeof dashboard.client.from !== "function") {
            throw new Error(
                "عميل Supabase غير صالح."
            );
        }

        return true;
    }

    /* -----------------------------------------------------
       قراءة البيانات
    ----------------------------------------------------- */

    async function fetchTable(tableName, limit = 100) {
        if (!tableName) {
            return {
                configured: false,
                data: []
            };
        }

        const { data, error } = await dashboard.client
            .from(tableName)
            .select("*")
            .limit(limit);

        if (error) {
            throw error;
        }

        return {
            configured: true,
            data: Array.isArray(data) ? data : []
        };
    }

    async function loadOrders() {
        return fetchTable(
            getTableName("orders"),
            200
        );
    }

    async function loadProducts() {
        return fetchTable(
            getTableName("products"),
            500
        );
    }

    async function loadMessages() {
        return fetchTable(
            getTableName("messages"),
            200
        );
    }

    /* -----------------------------------------------------
       حساب الإحصاءات
    ----------------------------------------------------- */

    function countPending(items, statusField, pendingValues) {
        if (!statusField || !Array.isArray(pendingValues)) {
            return null;
        }

        if (!pendingValues.length) {
            return null;
        }

        return items.filter(item =>
            pendingValues.includes(item[statusField])
        ).length;
    }

    function calculateStatistics(data) {
        const orders = data.orders.data;
        const products = data.products.data;
        const messages = data.messages.data;

        const orderStatus = getField("orders", "status");
        const messageStatus = getField("messages", "status");
        const productActive = getField("products", "active");

        const pendingOrderValues =
            dashboard.config.statuses?.pending || [];

        const pendingOrders = countPending(
            orders,
            orderStatus,
            pendingOrderValues
        );

        const pendingMessages = countPending(
            messages,
            messageStatus,
            pendingOrderValues
        );

        let activeProducts = null;

        if (productActive) {
            activeProducts = products.filter(
                product => product[productActive] === true
            ).length;
        }

        return {
            orders: data.orders.configured
                ? orders.length
                : null,

            products: data.products.configured
                ? products.length
                : null,

            messages: data.messages.configured
                ? messages.length
                : null,

            pendingOrders,
            pendingMessages,
            activeProducts
        };
    }

    /* -----------------------------------------------------
       عرض الإحصاءات
    ----------------------------------------------------- */

    function renderStat(selector, value) {
        const element = getElement(selector);

        if (!element) return;

        element.textContent =
            value === null || value === undefined
                ? "—"
                : formatNumber(value);

        element.dataset.loaded = "true";
    }

    function renderStatistics(stats) {
        const selectors = dashboard.config.selectors;

        renderStat(
            selectors.orders,
            stats.orders
        );

        renderStat(
            selectors.products,
            stats.products
        );

        renderStat(
            selectors.messages,
            stats.messages
        );

        const pendingValue =
            stats.pendingOrders === null &&
            stats.pendingMessages === null
                ? null
                : (stats.pendingOrders || 0) +
                  (stats.pendingMessages || 0);

        renderStat(
            selectors.pending,
            pendingValue
        );
    }

    /* -----------------------------------------------------
       ترتيب البيانات الأحدث
    ----------------------------------------------------- */

    function sortByDate(items, dateField, limit) {
        if (!dateField) {
            return items.slice(0, limit);
        }

        return [...items]
            .sort((a, b) => {
                const dateA = new Date(a[dateField]).getTime() || 0;
                const dateB = new Date(b[dateField]).getTime() || 0;

                return dateB - dateA;
            })
            .slice(0, limit);
    }

    /* -----------------------------------------------------
       عرض آخر الطلبات
    ----------------------------------------------------- */

    function renderRecentOrders(items) {
        const selector =
            dashboard.config.selectors.recentOrders;

        const element = getElement(selector);

        if (!element) return;

        if (!dashboard.config.tables.orders) {
            element.innerHTML = `
                <div class="admin-empty">
                    لم يتم ربط جدول الطلبات بعد.
                </div>
            `;
            return;
        }

        if (!items.length) {
            element.innerHTML = `
                <div class="admin-empty">
                    لا توجد طلبات لعرضها.
                </div>
            `;
            return;
        }

        const dateField = getField(
            "orders",
            "createdAt"
        );

        const recent = sortByDate(
            items,
            dateField,
            dashboard.config.limits.recentOrders
        );

        element.innerHTML = recent.map((item, index) => {
            const date = dateField
                ? formatDateTime(item[dateField])
                : "—";

            return `
                <article class="admin-recent-item">
                    <div class="admin-recent-item__content">
                        <strong>
                            طلب ${formatNumber(index + 1)}
                        </strong>

                        <span>${escapeHTML(date)}</span>
                    </div>
                </article>
            `;
        }).join("");
    }

    /* -----------------------------------------------------
       عرض آخر رسائل العملاء
    ----------------------------------------------------- */

    function renderRecentMessages(items) {
        const selector =
            dashboard.config.selectors.recentMessages;

        const element = getElement(selector);

        if (!element) return;

        if (!dashboard.config.tables.messages) {
            element.innerHTML = `
                <div class="admin-empty">
                    لم يتم ربط جدول رسائل العملاء بعد.
                </div>
            `;
            return;
        }

        if (!items.length) {
            element.innerHTML = `
                <div class="admin-empty">
                    لا توجد رسائل لعرضها.
                </div>
            `;
            return;
        }

        const dateField = getField(
            "messages",
            "createdAt"
        );

        const recent = sortByDate(
            items,
            dateField,
            dashboard.config.limits.recentMessages
        );

        element.innerHTML = recent.map((item, index) => {
            const date = dateField
                ? formatDateTime(item[dateField])
                : "—";

            return `
                <article class="admin-recent-item">
                    <div class="admin-recent-item__content">
                        <strong>
                            رسالة ${formatNumber(index + 1)}
                        </strong>

                        <span>${escapeHTML(date)}</span>
                    </div>
                </article>
            `;
        }).join("");
    }

    /* -----------------------------------------------------
       حالات التحميل والأخطاء
    ----------------------------------------------------- */

    function setLoading(loading) {
        dashboard.loading = loading;

        showElement(
            dashboard.config.selectors.loading,
            loading
        );

        const button = getElement(
            dashboard.config.selectors.refreshButton
        );

        if (button) {
            button.disabled = loading;

            button.classList.toggle(
                "is-loading",
                loading
            );
        }
    }

    function showError(message) {
        const selector =
            dashboard.config.selectors.error;

        const element = getElement(selector);

        if (element) {
            element.textContent = message;
            element.hidden = false;
        }

        if (typeof dashboard.config.onError === "function") {
            dashboard.config.onError(message);
        }

        notify(message, "error");
    }

    function clearError() {
        const element = getElement(
            dashboard.config.selectors.error
        );

        if (element) {
            element.textContent = "";
            element.hidden = true;
        }
    }

    /* -----------------------------------------------------
       تحميل لوحة الإدارة
    ----------------------------------------------------- */

    async function load() {
        if (dashboard.loading) return;

        setLoading(true);
        clearError();

        try {
            validateConfiguration();

            const [
                orders,
                products,
                messages
            ] = await Promise.all([
                loadOrders(),
                loadProducts(),
                loadMessages()
            ]);

            const data = {
                orders,
                products,
                messages
            };

            dashboard.lastData = data;

            const stats = calculateStatistics(data);

            renderStatistics(stats);

            renderRecentOrders(orders.data);
            renderRecentMessages(messages.data);

            setText(
                dashboard.config.selectors.lastUpdated,
                formatDateTime(new Date())
            );

            if (typeof dashboard.config.onLoad === "function") {
                dashboard.config.onLoad({
                    data,
                    statistics: stats
                });
            }

            return {
                success: true,
                data,
                statistics: stats
            };

        } catch (error) {
            console.error(
                "IBR Dashboard Error:",
                error
            );

            showError(
                "تعذر تحميل بيانات لوحة الإدارة. تحقق من الاتصال والصلاحيات وإعدادات الجداول."
            );

            return {
                success: false,
                error
            };

        } finally {
            setLoading(false);
        }
    }

    /* -----------------------------------------------------
       ربط زر التحديث
    ----------------------------------------------------- */

    function bindEvents() {
        const button = getElement(
            dashboard.config.selectors.refreshButton
        );

        if (button && !button.dataset.dashboardBound) {
            button.dataset.dashboardBound = "true";

            button.addEventListener("click", () => {
                load();
            });
        }
    }

    /* -----------------------------------------------------
       تهيئة لوحة الإدارة
    ----------------------------------------------------- */

    function init(options = {}) {
        dashboard.config = mergeConfig(
            DEFAULTS,
            options
        );

        dashboard.client =
            options.client ||
            window.supabaseClient ||
            window.client ||
            null;

        bindEvents();

        dashboard.initialized = true;

        if (options.autoLoad !== false) {
            return load();
        }

        return Promise.resolve({
            success: true,
            initialized: true
        });
    }

    /* -----------------------------------------------------
       تحديث الإعدادات
    ----------------------------------------------------- */

    function configure(options = {}) {
        dashboard.config = mergeConfig(
            dashboard.config,
            options
        );

        if (options.client) {
            dashboard.client = options.client;
        }

        bindEvents();

        return dashboard.config;
    }

    /* -----------------------------------------------------
       الواجهة العامة
    ----------------------------------------------------- */

    window.IBRAdminDashboard = {
        init,
        configure,
        load,

        getData() {
            return dashboard.lastData;
        },

        getConfig() {
            return dashboard.config;
        },

        isLoading() {
            return dashboard.loading;
        },

        isInitialized() {
            return dashboard.initialized;
        }
    };

})();
