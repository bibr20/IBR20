
(function () {
    "use strict";

    /* =========================================================
       IBR20 ANALYTICS DASHBOARD
       Version: 2.0.0

       التقارير التشغيلية:
       - المبيعات والطلبات والعملاء
       - المنتجات والتصنيفات
       - الاستفسارات والتقييمات
       - أوقات وأيام الطلبات

       التحليلات السلوكية:
       - الزوار والجلسات والأحداث
       - مشاهدات الصفحات والمنتجات
       - مسار الشراء
       - مصادر الزيارات
       - الصفحات والمنتجات الأكثر مشاهدة
       - توزيع الأحداث والنشاط اليومي

       الأمان:
       - تقارير التحليلات من RPC محمية بصلاحية المدير.
       - لا تُرسل بيانات العملاء الشخصية إلى تقارير التحليلات.
       - لا تُعرض بيانات شخصية في سياق Agentic AI.
    ========================================================= */

    const VERSION = "2.0.0";
    const TIME_ZONE = "Asia/Riyadh";
    const PAGE_SIZE = 1000;
    const MAX_ANALYTICS_DAYS = 400;

    const TABLES = {
        orders: "orders",
        items: "order_items",
        products: "products",
        categories: "categories",
        messages: "customer_messages",
        reviews: "product_reviews"
    };

    const RPC = {
        refresh: "refresh_ibr_analytics_daily_stats",
        report: "get_ibr_analytics_report"
    };

    const state = {
        client: null,
        period: "30",
        customRange: null,

        orders: [],
        items: [],
        products: [],
        categories: [],
        messages: [],
        reviews: [],

        analyticsReport: null,
        analyticsError: null,
        aggregationError: null,

        errors: [],
        sourceStatus: {},
        loading: false,
        initialized: false,
        lastUpdated: null
    };

    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    /* =========================================================
       أدوات عامة
    ========================================================= */

    function escapeHTML(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function getClient() {
        return window.supabaseClient || window.client || null;
    }

    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function safePercent(value) {
        return Math.max(0, Math.min(100, number(value)));
    }

    function money(value) {
        return new Intl.NumberFormat("ar-SA", {
            style: "currency",
            currency: "SAR",
            maximumFractionDigits: 0
        }).format(number(value));
    }

    function integer(value) {
        return new Intl.NumberFormat("ar-SA", {
            maximumFractionDigits: 0
        }).format(number(value));
    }

    function decimal(value, digits = 1) {
        return new Intl.NumberFormat("ar-SA", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        }).format(number(value));
    }

    function dateOf(value) {
        if (!value) return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDate(date, options) {
        if (!date) return "—";

        return new Intl.DateTimeFormat("ar-SA", {
            timeZone: TIME_ZONE,
            ...(options || {
                day: "numeric",
                month: "short"
            })
        }).format(date);
    }

    function todayInRiyadh() {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(new Date());
    }

    function dateStringInRiyadh(value) {
        if (!value) return null;

        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
            return String(value);
        }

        const date = dateOf(value);
        if (!date) return null;

        return new Intl.DateTimeFormat("en-CA", {
            timeZone: TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(date);
    }

    function shiftDateString(dateString, amount) {
        const parts = String(dateString).split("-").map(Number);
        if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
            return dateString;
        }

        const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        date.setUTCDate(date.getUTCDate() + amount);

        return [
            date.getUTCFullYear(),
            String(date.getUTCMonth() + 1).padStart(2, "0"),
            String(date.getUTCDate()).padStart(2, "0")
        ].join("-");
    }

    function daysBetweenInclusive(start, end) {
        const a = new Date(start + "T00:00:00Z");
        const b = new Date(end + "T00:00:00Z");
        return Math.max(1, Math.round((b - a) / 86400000) + 1);
    }

    function rangeForPeriod(period) {
        const today = todayInRiyadh();

        if (period === "custom" && state.customRange) {
            const start = state.customRange.from;
            const end = state.customRange.to;
            const days = daysBetweenInclusive(start, end);

            return {
                startDate: start,
                endDate: end,
                previousStartDate: shiftDateString(start, -days),
                previousEndDate: shiftDateString(start, -1),
                label: "الفترة المخصصة",
                days
            };
        }

        if (period === "all") {
            return {
                startDate: null,
                endDate: today,
                previousStartDate: null,
                previousEndDate: null,
                label: "كل المدة",
                days: null
            };
        }

        const days = period === "today"
            ? 1
            : Math.max(1, Number(period) || 30);

        const start = shiftDateString(today, -(days - 1));

        return {
            startDate: start,
            endDate: today,
            previousStartDate: shiftDateString(start, -days),
            previousEndDate: shiftDateString(start, -1),
            label: period === "today" ? "اليوم" : days + " يومًا",
            days
        };
    }

    function inRange(row, range) {
        const date = dateStringInRiyadh(row.created_at);
        if (!date) return false;

        if (range.startDate && date < range.startDate) return false;
        if (range.endDate && date > range.endDate) return false;

        return true;
    }

    function isInDateRange(row, start, end, field = "created_at") {
        const date = dateStringInRiyadh(row[field]);
        if (!date) return false;
        if (start && date < start) return false;
        if (end && date > end) return false;
        return true;
    }

    /* =========================================================
       تحميل بيانات Supabase
    ========================================================= */

    async function fetchAll(table, columns, orderColumn) {
        const all = [];

        for (let from = 0; ; from += PAGE_SIZE) {
            let query = state.client
                .from(table)
                .select(columns || "*");

            if (orderColumn) {
                query = query.order(orderColumn, { ascending: true });
            }

            const { data, error } = await query.range(
                from,
                from + PAGE_SIZE - 1
            );

            if (error) {
                throw new Error(table + ": " + error.message);
            }

            const batch = Array.isArray(data) ? data : [];
            all.push(...batch);

            if (batch.length < PAGE_SIZE) break;
        }

        return all;
    }

    async function loadSource(key, table, columns, orderColumn) {
        state.sourceStatus[key] = "loading";

        try {
            state[key] = await fetchAll(table, columns, orderColumn);
            state.sourceStatus[key] = "success";
        } catch (error) {
            state[key] = [];
            state.sourceStatus[key] = "error";
            state.errors.push(error.message || String(error));
        }
    }

    function analyticsDateRange(range) {
        let start = range.startDate;
        let end = range.endDate || todayInRiyadh();
        let capped = false;

        if (!start) {
            start = shiftDateString(end, -(MAX_ANALYTICS_DAYS - 1));
            capped = true;
        }

        const days = daysBetweenInclusive(start, end);

        if (days > MAX_ANALYTICS_DAYS) {
            start = shiftDateString(end, -(MAX_ANALYTICS_DAYS - 1));
            capped = true;
        }

        return { start, end, capped };
    }

    async function loadBehaviorAnalytics(range) {
        state.analyticsReport = null;
        state.analyticsError = null;
        state.aggregationError = null;

        if (!state.client || typeof state.client.rpc !== "function") {
            state.analyticsError = "واجهة RPC غير متاحة في اتصال Supabase.";
            return;
        }

        const dates = analyticsDateRange(range);

        /*
         * تحديث التجميع اليومي.
         * إذا تعذر تحديثه، نحاول جلب التقرير على أي حال.
         */
        try {
            const { error } = await state.client.rpc(RPC.refresh, {
                p_start_date: dates.start,
                p_end_date: dates.end
            });

            if (error) {
                state.aggregationError = error.message;
            }
        } catch (error) {
            state.aggregationError = error.message || String(error);
        }

        /*
         * التقرير يقرأ الأحداث الخام من خلال RPC المحمية.
         */
        try {
            const { data, error } = await state.client.rpc(RPC.report, {
                p_start_date: dates.start,
                p_end_date: dates.end
            });

            if (error) throw error;

            if (!data || data.success !== true) {
                throw new Error("لم تُرجع دالة التقارير نتيجة صالحة.");
            }

            state.analyticsReport = data;
            state.analyticsReport._rangeCapped = dates.capped;

        } catch (error) {
            state.analyticsError = error.message || String(error);
        }
    }

    async function load() {
        if (state.loading) return;

        state.client = getClient();

        if (!state.client || typeof state.client.from !== "function") {
            showError(
                "تعذر الوصول إلى Supabase. تأكد من تحميل store.js وأن window.supabaseClient متاح."
            );
            return;
        }

        state.loading = true;
        state.errors = [];
        state.sourceStatus = {};

        setLoading(true);
        hideError();

        const range = rangeForPeriod(state.period);

        await Promise.all([
            loadSource("orders", TABLES.orders, "*", "created_at"),
            loadSource("items", TABLES.items, "*", null),
            loadSource("products", TABLES.products, "*", null),
            loadSource("categories", TABLES.categories, "*", "sort_order"),
            loadSource("messages", TABLES.messages, "*", "created_at"),
            loadSource("reviews", TABLES.reviews, "*", "created_at"),
            loadBehaviorAnalytics(range)
        ]);

        state.lastUpdated = new Date();
        state.loading = false;

        setLoading(false);
        render();

        const allErrors = state.errors.slice();

        if (state.analyticsError) {
            allErrors.push("التحليلات السلوكية: " + state.analyticsError);
        }

        if (state.aggregationError) {
            allErrors.push("تحديث التجميع اليومي: " + state.aggregationError);
        }

        if (allErrors.length) {
            showError(
                "تم تحميل البيانات المتاحة، لكن توجد مصادر لم تكتمل: " +
                allErrors.map(escapeHTML).join(" | ") +
                ". تحقق من صلاحيات القراءة وسياسات RLS وحالة دوال Supabase."
            );
        }
    }

    /* =========================================================
       حالات الواجهة والتنبيهات
    ========================================================= */

    function setLoading(isLoading) {
        const refresh = $("[data-analytics-refresh]");

        if (refresh) {
            refresh.disabled = isLoading;
            refresh.innerHTML = isLoading
                ? "جارٍ التحديث..."
                : '<span aria-hidden="true">↻</span> تحديث البيانات';
        }

        const updated = $("[data-last-updated]");

        if (updated && isLoading) {
            updated.textContent = "جارٍ تحديث البيانات...";
        }
    }

    function showError(message) {
        const box = $("[data-analytics-error]");
        if (!box) return;

        box.hidden = false;
        box.textContent = message;
    }

    function hideError() {
        const box = $("[data-analytics-error]");

        if (box) {
            box.hidden = true;
            box.textContent = "";
        }
    }

    function setAlert(message) {
        const box = $("[data-analytics-alert]");
        if (!box) return;

        box.hidden = !message;
        box.textContent = message || "";
    }

    /* =========================================================
       بيانات الفترة التشغيلية
    ========================================================= */

    function getCurrentData(range) {
        const orders = state.orders.filter(order => inRange(order, range));

        const previousOrders = range.previousStartDate
            ? state.orders.filter(order =>
                isInDateRange(
                    order,
                    range.previousStartDate,
                    range.previousEndDate
                )
            )
            : [];

        const messages = state.messages.filter(row => inRange(row, range));

        const reviews = state.reviews.filter(row =>
            row.status === "approved" && inRange(row, range)
        );

        const orderIds = new Set(orders.map(order => order.id));
        const previousIds = new Set(previousOrders.map(order => order.id));

        const items = state.items.filter(item =>
            orderIds.has(item.order_id)
        );

        const previousItems = state.items.filter(item =>
            previousIds.has(item.order_id)
        );

        return {
            orders,
            previousOrders,
            messages,
            reviews,
            items,
            previousItems
        };
    }

    function isDelivered(order) {
        return order.status === "delivered";
    }

    function isCancelled(order) {
        return order.status === "cancelled";
    }

    function sumDelivered(orders) {
        return orders
            .filter(isDelivered)
            .reduce((sum, order) => sum + number(order.total_amount), 0);
    }

    function distinctCustomers(orders) {
        const phones = new Set();

        orders.forEach(order => {
            const phone = String(order.customer_phone || "").trim();
            if (phone) phones.add(phone);
        });

        return phones.size;
    }

    function changePercent(current, previous) {
        if (!previous) return current ? null : 0;

        return ((current - previous) / Math.abs(previous)) * 100;
    }

    function renderChange(key, current, previous, formatter) {
        const el = $('[data-kpi-change="' + key + '"]');
        if (!el) return;

        const change = changePercent(current, previous);

        if (change === null) {
            el.textContent = current ? "جديد" : "—";
            el.title = "لا توجد قيمة مقارنة في الفترة السابقة";
            return;
        }

        const sign = change > 0 ? "+" : "";

        el.textContent = sign + change.toFixed(1) + "%";
        el.style.color = change > 0
            ? "#47745d"
            : (change < 0 ? "#a6534b" : "");

        el.title = formatter ? formatter(current, previous) : "";
    }

    function setKpi(key, value) {
        const el = $('[data-kpi="' + key + '"]');
        if (el) el.textContent = value;
    }

    /* =========================================================
       مؤشرات الأداء التشغيلية
    ========================================================= */

    function renderKPIs(data) {
        const delivered = data.orders.filter(isDelivered);
        const previousDelivered = data.previousOrders.filter(isDelivered);

        const sales = sumDelivered(data.orders);
        const previousSales = sumDelivered(data.previousOrders);

        const avg = delivered.length ? sales / delivered.length : 0;
        const previousAvg = previousDelivered.length
            ? previousSales / previousDelivered.length
            : 0;

        const customers = distinctCustomers(data.orders);
        const previousCustomers = distinctCustomers(data.previousOrders);

        const activeProducts = state.products.filter(p =>
            p.is_active === true && p.is_available !== false
        ).length;

        const approvedAll = state.reviews.filter(r =>
            r.status === "approved"
        );

        const ratingAverage = approvedAll.length
            ? approvedAll.reduce((s, r) => s + number(r.rating), 0) /
            approvedAll.length
            : null;

        setKpi("sales", money(sales));
        setKpi("orders", integer(data.orders.length));
        setKpi("customers", integer(customers));
        setKpi("average", money(avg));
        setKpi("products", integer(activeProducts));
        setKpi("inquiries", integer(data.messages.length));
        setKpi(
            "rating",
            ratingAverage == null ? "—" : ratingAverage.toFixed(1) + " / 5"
        );

        renderChange("sales", sales, previousSales);
        renderChange("orders", data.orders.length, data.previousOrders.length);
        renderChange("customers", customers, previousCustomers);
        renderChange("average", avg, previousAvg);

        const pMeta = $('[data-kpi-meta="products"]');
        if (pMeta) {
            pMeta.textContent =
                integer(state.products.length) + " منتجًا في قاعدة البيانات";
        }

        const iMeta = $('[data-kpi-meta="inquiries"]');
        if (iMeta) {
            iMeta.textContent =
                data.messages.filter(m =>
                    m.status === "new" || m.status === "in_review"
                ).length + " مفتوح أو قيد المتابعة";
        }

        const rMeta = $('[data-kpi-meta="rating"]');
        if (rMeta) {
            rMeta.textContent =
                "من " + integer(approvedAll.length) + " تقييم معتمد";
        }

        const rCount = $('[data-kpi-meta="reviews-count"]');
        if (rCount) {
            rCount.textContent =
                integer(data.reviews.length) + " تقييمًا خلال الفترة";
        }
    }

    /* =========================================================
       الرسم البياني للمبيعات
    ========================================================= */

    function renderSalesChart(data) {
        const host = $("[data-sales-chart]");
        if (!host) return;

        const delivered = data.orders.filter(isDelivered);

        if (!delivered.length) {
            host.innerHTML =
                '<div class="analytics-empty">لا توجد مبيعات مسلّمة في الفترة المحددة.</div>';
            return;
        }

        const bucket = new Map();

        delivered.forEach(order => {
            const key = dateStringInRiyadh(order.created_at);
            if (!key) return;

            bucket.set(
                key,
                (bucket.get(key) || 0) + number(order.total_amount)
            );
        });

        let entries = Array.from(bucket.entries())
            .sort((a, b) => a[0].localeCompare(b[0]));

        if (entries.length > 24) {
            const step = Math.ceil(entries.length / 24);
            const grouped = [];

            for (let i = 0; i < entries.length; i += step) {
                const part = entries.slice(i, i + step);

                grouped.push([
                    part[0][0],
                    part.reduce((sum, item) => sum + item[1], 0)
                ]);
            }

            entries = grouped;
        }

        const max = Math.max(1, ...entries.map(item => item[1]));

        host.innerHTML = entries.map(([key, value]) => {
            const date = new Date(key + "T12:00:00Z");
            const height = Math.max(3, (value / max) * 145);

            return (
                '<div class="analytics-chart-column" title="' +
                escapeHTML(
                    formatDate(date, {
                        day: "numeric",
                        month: "long",
                        timeZone: "UTC"
                    }) + " · " + money(value)
                ) +
                '">' +
                '<span class="analytics-chart-value">' +
                escapeHTML(integer(value)) +
                "</span>" +
                '<div class="analytics-chart-bar" style="height:' +
                height +
                'px"></div>' +
                '<span class="analytics-chart-label">' +
                escapeHTML(formatDate(date, {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC"
                })) +
                "</span></div>"
            );
        }).join("");
    }

    /* =========================================================
       الحالات والتصنيفات
    ========================================================= */

    const ORDER_STATUS_LABELS = {
        new: "جديد",
        contacting: "جارٍ التواصل",
        confirmed: "مؤكد",
        preparing: "قيد التجهيز",
        shipped: "تم الشحن",
        delivered: "تم التسليم",
        cancelled: "ملغي"
    };

    const INQUIRY_STATUS_LABELS = {
        new: "جديد",
        in_review: "قيد المراجعة",
        answered: "تمت الإجابة",
        closed: "مغلق"
    };

    const INQUIRY_TYPE_LABELS = {
        general: "رسالة عامة",
        product_question: "استفسار عن منتج",
        order_question: "استفسار عن طلب",
        complaint: "شكوى",
        suggestion: "اقتراح"
    };

    function renderBreakdown(hostSelector, rows, labels) {
        const host = $(hostSelector);
        if (!host) return;

        const total = rows.reduce((sum, row) => sum + row.count, 0);

        if (!total) {
            host.innerHTML =
                '<div class="analytics-empty">لا توجد بيانات في الفترة المحددة.</div>';
            return;
        }

        host.innerHTML = rows.map(row => {
            const pct = safePercent((row.count / total) * 100);

            return (
                '<div class="analytics-status-row">' +
                '<div class="analytics-row-top"><span>' +
                escapeHTML(labels[row.key] || row.key || "غير محدد") +
                "</span><span>" +
                integer(row.count) +
                " · " +
                pct.toFixed(0) +
                "%</span></div>" +
                '<div class="analytics-progress"><span style="width:' +
                pct +
                '%"></span></div></div>'
            );
        }).join("");
    }

    function countBy(rows, field) {
        const map = new Map();

        rows.forEach(row => {
            const key = row[field] || "unknown";
            map.set(key, (map.get(key) || 0) + 1);
        });

        return Array.from(map, ([key, count]) => ({
            key,
            count
        })).sort((a, b) => b.count - a.count);
    }

    function renderOrderStatuses(data) {
        renderBreakdown(
            "[data-order-statuses]",
            countBy(data.orders, "status"),
            ORDER_STATUS_LABELS
        );
    }

    /* =========================================================
       أداء المنتجات والتصنيفات
    ========================================================= */

    function getItemProductName(item, productMap) {
        const product = item.product_id
            ? productMap.get(item.product_id)
            : null;

        return item.product_name ||
            (product && product.name) ||
            "منتج غير محدد";
    }

    function renderProductPerformance(data) {
        const productMap = new Map(
            state.products.map(p => [p.id, p])
        );

        const salesByProduct = new Map();

        const deliveredIds = new Set(
            data.orders.filter(isDelivered).map(o => o.id)
        );

        const deliveredItems = data.items.filter(item =>
            deliveredIds.has(item.order_id)
        );

        deliveredItems.forEach(item => {
            const id = item.product_id ||
                ("snapshot:" + (item.product_name || "unknown"));

            const current = salesByProduct.get(id) || {
                id,
                name: getItemProductName(item, productMap),
                quantity: 0,
                revenue: 0
            };

            current.quantity += number(item.quantity);
            current.revenue += number(item.line_total);

            salesByProduct.set(id, current);
        });

        const ranked = Array.from(salesByProduct.values())
            .sort((a, b) => b.quantity - a.quantity);

        const totalRevenue = ranked.reduce(
            (sum, product) => sum + product.revenue,
            0
        );

        const host = $("[data-top-products]");

        if (host) {
            host.innerHTML = ranked.length
                ? ranked.slice(0, 10).map(product => {
                    const share = totalRevenue
                        ? safePercent(
                            (product.revenue / totalRevenue) * 100
                        )
                        : 0;

                    return (
                        "<tr><td>" +
                        escapeHTML(product.name) +
                        "</td><td>" +
                        integer(product.quantity) +
                        "</td><td>" +
                        money(product.revenue) +
                        '</td><td><span class="analytics-product-share">' +
                        share.toFixed(1) +
                        "%</span></td></tr>"
                    );
                }).join("")
                : '<tr><td colspan="4" class="analytics-empty">لا توجد منتجات مباعة في الفترة المحددة.</td></tr>';
        }

        const categoryMap = new Map(
            state.categories.map(c => [c.id, c])
        );

        const productSales = new Map();

        ranked.forEach(productSale => {
            const product = productMap.get(productSale.id);
            const categoryId = product && product.category_id;
            const category = categoryId
                ? categoryMap.get(categoryId)
                : null;

            const key = category ? category.name : "بدون تصنيف";

            productSales.set(
                key,
                (productSales.get(key) || 0) + productSale.revenue
            );
        });

        const categories = Array.from(
            productSales,
            ([name, revenue]) => ({ name, revenue })
        ).sort((a, b) => b.revenue - a.revenue);

        const catHost = $("[data-category-performance]");

        if (catHost) {
            const max = Math.max(
                1,
                ...categories.map(category => category.revenue)
            );

            catHost.innerHTML = categories.length
                ? categories.slice(0, 8).map(category => {
                    const width = safePercent(
                        (category.revenue / max) * 100
                    );

                    return (
                        '<div class="analytics-category-row">' +
                        '<div class="analytics-row-top"><span>' +
                        escapeHTML(category.name) +
                        "</span><span>" +
                        money(category.revenue) +
                        "</span></div>" +
                        '<div class="analytics-progress"><span style="width:' +
                        width +
                        '%"></span></div></div>'
                    );
                }).join("")
                : '<div class="analytics-empty">لا توجد مبيعات مصنفة في الفترة المحددة.</div>';
        }

        const soldIds = new Set(ranked.map(product => product.id));

        const stagnant = state.products.filter(product =>
            product.is_active === true &&
            product.is_available !== false &&
            !soldIds.has(product.id)
        );

        const stagnantHost = $("[data-stagnant-products]");

        if (stagnantHost) {
            stagnantHost.innerHTML = stagnant.length
                ? stagnant.slice(0, 30).map(product =>
                    '<span class="analytics-stagnant-item">' +
                    escapeHTML(product.name) +
                    "</span>"
                ).join("")
                : '<div class="analytics-empty">كل المنتجات النشطة لديها مبيعات خلال الفترة، أو لا توجد منتجات نشطة.</div>';
        }

        return ranked;
    }

    /* =========================================================
       العملاء والمدن
    ========================================================= */

    function renderCustomers(data) {
        const cityMap = new Map();

        data.orders.forEach(order => {
            const city = String(order.city || "غير محددة").trim() ||
                "غير محددة";

            cityMap.set(city, (cityMap.get(city) || 0) + 1);
        });

        const cities = Array.from(
            cityMap,
            ([name, count]) => ({ name, count })
        ).sort((a, b) => b.count - a.count);

        const cityHost = $("[data-city-performance]");

        if (cityHost) {
            const max = Math.max(
                1,
                ...cities.map(city => city.count)
            );

            cityHost.innerHTML = cities.length
                ? cities.slice(0, 8).map(city => {
                    const width = safePercent(
                        (city.count / max) * 100
                    );

                    return (
                        '<div class="analytics-city-row">' +
                        '<div class="analytics-row-top"><span>' +
                        escapeHTML(city.name) +
                        "</span><span>" +
                        integer(city.count) +
                        " طلب</span></div>" +
                        '<div class="analytics-progress"><span style="width:' +
                        width +
                        '%"></span></div></div>'
                    );
                }).join("")
                : '<div class="analytics-empty">لا توجد بيانات مدن ضمن الفترة.</div>';
        }

        const customerMap = new Map();

        data.orders.forEach(order => {
            const phone = String(order.customer_phone || "").trim();
            if (!phone) return;

            const item = customerMap.get(phone) || {
                phone,
                name: order.customer_name || "عميل",
                count: 0,
                total: 0
            };

            item.count++;

            if (isDelivered(order)) {
                item.total += number(order.total_amount);
            }

            customerMap.set(phone, item);
        });

        const repeat = Array.from(customerMap.values())
            .filter(customer => customer.count > 1)
            .sort((a, b) => b.count - a.count);

        const host = $("[data-repeat-customers]");

        if (host) {
            host.innerHTML = repeat.length
                ? repeat.slice(0, 7).map(customer =>
                    '<div class="analytics-customer-row"><div><strong>' +
                    escapeHTML(customer.name) +
                    "</strong><small>" +
                    escapeHTML(customer.phone) +
                    '</small></div><div class="analytics-customer-count">' +
                    integer(customer.count) +
                    " طلب</div></div>"
                ).join("")
                : '<div class="analytics-empty">لا يوجد عملاء متكررون في الفترة المحددة.</div>';
        }
    }

    /* =========================================================
       الاستفسارات والتقييمات
    ========================================================= */

    function renderInquiries(data) {
        renderBreakdown(
            "[data-inquiry-statuses]",
            countBy(data.messages, "status"),
            INQUIRY_STATUS_LABELS
        );

        renderBreakdown(
            "[data-inquiry-types]",
            countBy(data.messages, "message_type"),
            INQUIRY_TYPE_LABELS
        );
    }

    function renderReviews(data) {
        const allApproved = state.reviews.filter(r =>
            r.status === "approved"
        );

        const counts = [5, 4, 3, 2, 1].map(star => ({
            star,
            count: allApproved.filter(
                review => number(review.rating) === star
            ).length
        }));

        const host = $("[data-rating-distribution]");

        if (host) {
            const max = Math.max(
                1,
                ...counts.map(item => item.count)
            );

            host.innerHTML = allApproved.length
                ? counts.map(item => {
                    const width = safePercent(
                        (item.count / max) * 100
                    );

                    return (
                        '<div class="analytics-rating-row">' +
                        '<span class="analytics-rating-stars">' +
                        "★".repeat(item.star) +
                        '</span><div class="analytics-progress"><span style="width:' +
                        width +
                        '%"></span></div><span>' +
                        integer(item.count) +
                        "</span></div>"
                    );
                }).join("")
                : '<div class="analytics-empty">لا توجد تقييمات معتمدة حتى الآن.</div>';
        }

        const recent = data.reviews.slice()
            .sort((a, b) =>
                new Date(b.created_at) - new Date(a.created_at)
            )
            .slice(0, 5);

        const recentHost = $("[data-recent-reviews]");

        if (recentHost) {
            recentHost.innerHTML = recent.length
                ? recent.map(review =>
                    '<article class="analytics-review"><div class="analytics-review-head"><strong>' +
                    escapeHTML(review.customer_name || "عميل") +
                    '</strong><span>' +
                    "★".repeat(
                        Math.max(0, Math.min(5, number(review.rating)))
                    ) +
                    '</span></div><p>' +
                    escapeHTML(
                        review.review_text || "تقييم دون تعليق نصي"
                    ) +
                    "</p></article>"
                ).join("")
                : '<div class="analytics-empty">لا توجد تقييمات معتمدة خلال الفترة المحددة.</div>';
        }
    }

    /* =========================================================
       نشاط الطلبات حسب اليوم والساعة - توقيت الرياض
    ========================================================= */

    function getRiyadhDateParts(value) {
        const date = dateOf(value);
        if (!date) return null;

        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: TIME_ZONE,
            weekday: "short",
            hour: "2-digit",
            hourCycle: "h23"
        }).formatToParts(date);

        const result = {};

        parts.forEach(part => {
            result[part.type] = part.value;
        });

        const weekdayMap = {
            Sun: 0,
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6
        };

        return {
            day: weekdayMap[result.weekday],
            hour: Number(result.hour)
        };
    }

    function renderActivity(data) {
        const weekdays = [
            "الأحد",
            "الإثنين",
            "الثلاثاء",
            "الأربعاء",
            "الخميس",
            "الجمعة",
            "السبت"
        ];

        const counts = weekdays.map((name, day) => ({
            name,
            count: data.orders.filter(order => {
                const parts = getRiyadhDateParts(order.created_at);
                return parts && parts.day === day;
            }).length
        }));

        const host = $("[data-weekday-chart]");

        if (host) {
            const max = Math.max(
                1,
                ...counts.map(item => item.count)
            );

            host.innerHTML = counts.map(item => {
                const width = safePercent(
                    (item.count / max) * 100
                );

                return (
                    '<div class="analytics-weekday-row"><span>' +
                    item.name +
                    '</span><div class="analytics-progress"><span style="width:' +
                    width +
                    '%"></span></div><span>' +
                    integer(item.count) +
                    "</span></div>"
                );
            }).join("");
        }

        const hours = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            count: data.orders.filter(order => {
                const parts = getRiyadhDateParts(order.created_at);
                return parts && parts.hour === hour;
            }).length
        }));

        const maxHour = Math.max(
            1,
            ...hours.map(item => item.count)
        );

        const hourHost = $("[data-hour-chart]");

        if (hourHost) {
            hourHost.innerHTML = hours.map(item => {
                const height = Math.max(
                    3,
                    (item.count / maxHour) * 105
                );

                return (
                    '<div class="analytics-hour" title="' +
                    String(item.hour).padStart(2, "0") +
                    ":00 · " +
                    item.count +
                    ' طلب"><div class="analytics-hour-bar" style="height:' +
                    height +
                    'px"></div><small>' +
                    (item.hour % 3 === 0
                        ? String(item.hour).padStart(2, "0")
                        : "") +
                    "</small></div>"
                );
            }).join("");
        }
    }

    /* =========================================================
       الرؤى التشغيلية
    ========================================================= */

    function renderInsights(data, ranked) {
        const insights = [];

        const sales = sumDelivered(data.orders);
        const previousSales = sumDelivered(data.previousOrders);

        if (sales > previousSales && previousSales > 0) {
            insights.push([
                "نمو المبيعات",
                "ارتفعت المبيعات المحققة بنسبة " +
                (
                    ((sales - previousSales) / previousSales) * 100
                ).toFixed(1) +
                "% مقارنة بالفترة السابقة."
            ]);
        } else if (sales < previousSales && previousSales > 0) {
            insights.push([
                "تراجع المبيعات",
                "انخفضت المبيعات المحققة بنسبة " +
                (
                    ((previousSales - sales) / previousSales) * 100
                ).toFixed(1) +
                "% مقارنة بالفترة السابقة."
            ]);
        } else if (sales > 0 && previousSales === 0) {
            insights.push([
                "بداية مبيعات",
                "سُجلت مبيعات مسلّمة في الفترة الحالية، ولا توجد مبيعات مسجلة في فترة المقارنة."
            ]);
        } else {
            insights.push([
                "المبيعات",
                "لا تتوفر مبيعات مسلّمة كافية لإجراء مقارنة ذات معنى في الفترة المختارة."
            ]);
        }

        if (ranked.length) {
            insights.push([
                "المنتج المتصدر",
                "المنتج الأعلى مبيعًا هو «" +
                ranked[0].name +
                "» بعدد " +
                ranked[0].quantity +
                " وحدة وقيمة " +
                money(ranked[0].revenue) +
                "."
            ]);
        }

        const openMessages = data.messages.filter(message =>
            message.status === "new" ||
            message.status === "in_review"
        ).length;

        insights.push([
            "خدمة العملاء",
            openMessages
                ? "يوجد " + openMessages +
                " استفسار جديد أو قيد المراجعة يحتاج إلى متابعة."
                : "لا توجد استفسارات جديدة أو قيد المراجعة ضمن الفترة المحددة."
        ]);

        const cancelled = data.orders.filter(isCancelled).length;

        if (data.orders.length) {
            insights.push([
                "الطلبات الملغاة",
                "تم تسجيل " +
                cancelled +
                " طلب ملغى من أصل " +
                data.orders.length +
                " طلبًا في الفترة."
            ]);
        }

        const host = $("[data-smart-insights]");

        if (host) {
            host.innerHTML = insights.map(([title, body]) =>
                '<article class="analytics-insight-card"><span>' +
                escapeHTML(title) +
                "</span><p>" +
                escapeHTML(body) +
                "</p></article>"
            ).join("");
        }
    }

    /* =========================================================
       التحليلات السلوكية الجديدة
       مصدر البيانات: get_ibr_analytics_report
    ========================================================= */

    function ensureBehaviorSection() {
        let host = $("#ibr-live-analytics");

        if (host) return host;

        const root =
            $(".admin-analytics-page") ||
            $("[data-admin-content]");

        if (!root) return null;

        host = document.createElement("section");
        host.id = "ibr-live-analytics";
        host.className = "ibr-live-analytics";
        host.setAttribute("aria-live", "polite");

        host.innerHTML = `
            <div class="ibr-live-heading">
                <div>
                    <span class="ibr-live-eyebrow">IBR20 INSIGHTS</span>
                    <h2>تحليلات الزوار وسلوك التسوق</h2>
                    <p>قراءة أداء المتجر من الزيارة الأولى حتى إتمام الطلب</p>
                </div>
                <span class="ibr-live-version">Behavior Analytics</span>
            </div>

            <div class="ibr-live-notice" data-live-notice hidden></div>

            <div class="ibr-live-kpis" data-live-kpis>
                <div class="ibr-live-empty">بانتظار تحميل بيانات التحليلات...</div>
            </div>

            <div class="ibr-live-grid">
                <article class="ibr-live-card ibr-live-card-wide">
                    <div class="ibr-live-card-heading">
                        <h3>نشاط المتجر اليومي</h3>
                        <span>عدد الأحداث المسجلة</span>
                    </div>
                    <div class="ibr-live-daily" data-live-daily></div>
                </article>

                <article class="ibr-live-card">
                    <div class="ibr-live-card-heading">
                        <h3>مسار الشراء</h3>
                        <span>من مشاهدة المنتج إلى إتمام الطلب</span>
                    </div>
                    <div class="ibr-live-funnel" data-live-funnel></div>
                </article>

                <article class="ibr-live-card">
                    <div class="ibr-live-card-heading">
                        <h3>أكثر الصفحات مشاهدة</h3>
                        <span>حسب عدد المشاهدات</span>
                    </div>
                    <div class="ibr-live-list" data-live-pages></div>
                </article>

                <article class="ibr-live-card">
                    <div class="ibr-live-card-heading">
                        <h3>المنتجات الأكثر مشاهدة</h3>
                        <span>حسب مشاهدات المنتجات</span>
                    </div>
                    <div class="ibr-live-list" data-live-products></div>
                </article>

                <article class="ibr-live-card">
                    <div class="ibr-live-card-heading">
                        <h3>مصادر الزيارات</h3>
                        <span>مصدر الزيارة والوسيط والحملة</span>
                    </div>
                    <div class="ibr-live-list" data-live-traffic></div>
                </article>

                <article class="ibr-live-card">
                    <div class="ibr-live-card-heading">
                        <h3>توزيع الأحداث</h3>
                        <span>تفاعل الزوار مع المتجر</span>
                    </div>
                    <div class="ibr-live-list" data-live-events></div>
                </article>
            </div>

            <div class="ibr-live-footnote">
                تُعرض هذه التقارير بصورة مجمعة. لا تعرض لوحة التحليلات أرقام هواتف العملاء أو بياناتهم الشخصية ضمن بيانات السلوك.
            </div>
        `;

        const content = document.querySelector(".analytics-page-content");

        if (!content) {
            console.error(
                "IBR Analytics: لم يتم العثور على حاوية محتوى صفحة التحليلات."
            );
            return;
        }

        const footer = content.querySelector(".analytics-footer");

        if (footer) {
            content.insertBefore(host, footer);
        } else {
            content.appendChild(host);
        }

        return host;
    }

    function renderLiveKpis(report) {
        const host = $("[data-live-kpis]");
        if (!host) return;

        const overview = report.overview || {};

        const cards = [
            {
                label: "الزوار",
                value: overview.unique_visitors,
                description: "زوار مميزون خلال الفترة"
            },
            {
                label: "الجلسات",
                value: overview.unique_sessions,
                description: "جلسات التصفح"
            },
            {
                label: "الأحداث",
                value: overview.total_events,
                description: "إجمالي التفاعلات المسجلة"
            },
            {
                label: "مشاهدات الصفحات",
                value: overview.page_views,
                description: "مرات مشاهدة صفحات المتجر"
            },
            {
                label: "مشاهدات المنتجات",
                value: overview.product_views,
                description: "مرات مشاهدة تفاصيل المنتجات"
            },
            {
                label: "إضافات للسلة",
                value: overview.add_to_cart,
                description: "أحداث إضافة المنتجات للسلة"
            },
            {
                label: "بدء إتمام الطلب",
                value: overview.checkout_started,
                description: "مرات بدء عملية الشراء"
            },
            {
                label: "الطلبات المكتملة",
                value: overview.order_completed,
                description: "أحداث إتمام الطلب المسجلة"
            }
        ];

        host.innerHTML = cards.map(card => `
            <article class="ibr-live-kpi">
                <span>${escapeHTML(card.label)}</span>
                <strong>${integer(card.value)}</strong>
                <small>${escapeHTML(card.description)}</small>
            </article>
        `).join("");
    }

    function renderLiveDaily(report) {
        const host = $("[data-live-daily]");
        if (!host) return;

        const rows = Array.isArray(report.daily)
            ? report.daily
            : [];

        if (!rows.length) {
            host.innerHTML =
                '<div class="ibr-live-empty">لا توجد أحداث مسجلة في الأيام المحددة.</div>';
            return;
        }

        const max = Math.max(
            1,
            ...rows.map(row => number(row.event_count))
        );

        host.innerHTML = rows.map(row => {
            const width = safePercent(
                (number(row.event_count) / max) * 100
            );

            const date = row.date
                ? formatDate(new Date(row.date + "T12:00:00Z"), {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC"
                })
                : "—";

            return `
                <div class="ibr-live-daily-row">
                    <span>${escapeHTML(date)}</span>
                    <div class="ibr-live-track">
                        <i style="width:${width}%"></i>
                    </div>
                    <strong>${integer(row.event_count)}</strong>
                </div>
            `;
        }).join("");
    }

    function funnelLabel(name) {
        const labels = {
            product_view: "مشاهدة منتج",
            add_to_cart: "إضافة إلى السلة",
            checkout_started: "بدء إتمام الطلب",
            order_completed: "إتمام الطلب"
        };

        return labels[name] || name || "غير محدد";
    }

    function renderLiveFunnel(report) {
        const host = $("[data-live-funnel]");
        if (!host) return;

        const rows = Array.isArray(report.funnel)
            ? report.funnel
            : [];

        if (!rows.length) {
            host.innerHTML =
                '<div class="ibr-live-empty">لا توجد بيانات لمسار الشراء.</div>';
            return;
        }

        const max = Math.max(
            1,
            ...rows.map(row => number(row.unique_visitors))
        );

        host.innerHTML = rows.map((row, index) => {
            const visitors = number(row.unique_visitors);
            const width = safePercent((visitors / max) * 100);

            /*
             * ملاحظة:
             * التقرير الحالي يعرض عدد الزوار لكل حدث على حدة،
             * ولا يمثل بعدُ قمعاً تسلسلياً لمجموعة الزوار نفسها.
             */
            return `
                <div class="ibr-live-funnel-step">
                    <div class="ibr-live-funnel-top">
                        <span>${index + 1}. ${escapeHTML(funnelLabel(row.event_name))}</span>
                        <strong>${integer(visitors)}</strong>
                    </div>
                    <div class="ibr-live-track">
                        <i style="width:${width}%"></i>
                    </div>
                    <small>
                        ${integer(row.event_count)} تفاعل ·
                        ${integer(row.unique_sessions)} جلسة
                    </small>
                </div>
            `;
        }).join("");
    }

    function renderLiveList(selector, rows, options) {
        const host = $(selector);
        if (!host) return;

        if (!Array.isArray(rows) || !rows.length) {
            host.innerHTML =
                '<div class="ibr-live-empty">لا توجد بيانات متاحة في الفترة المحددة.</div>';
            return;
        }

        const settings = options || {};
        const max = Math.max(
            1,
            ...rows.map(row => number(row[settings.valueKey]))
        );

        host.innerHTML = rows.slice(0, 10).map(row => {
            const value = number(row[settings.valueKey]);
            const width = safePercent((value / max) * 100);
            const title = settings.title(row);

            return `
                <div class="ibr-live-list-row">
                    <div class="ibr-live-list-top">
                        <span title="${escapeHTML(title)}">${escapeHTML(title)}</span>
                        <strong>${integer(value)}</strong>
                    </div>
                    <div class="ibr-live-track">
                        <i style="width:${width}%"></i>
                    </div>
                    ${settings.subtitle
                    ? `<small>${escapeHTML(settings.subtitle(row))}</small>`
                    : ""}
                </div>
            `;
        }).join("");
    }

    function renderLiveTraffic(report) {
        const rows = Array.isArray(report.traffic_sources)
            ? report.traffic_sources
            : [];

        renderLiveList("[data-live-traffic]", rows, {
            valueKey: "sessions",
            title: row => {
                const source = row.source || "direct";
                const medium = row.medium || "(none)";
                return source + " · " + medium;
            },
            subtitle: row => {
                const campaign = row.campaign || "(none)";
                return "الحملة: " + campaign +
                    " · الزوار: " + integer(row.visitors);
            }
        });
    }

    function eventLabel(name) {
        const labels = {
            page_view: "مشاهدة صفحة",
            product_view: "مشاهدة منتج",
            category_view: "مشاهدة تصنيف",
            search: "بحث",
            recommendation_shown: "ظهور توصية",
            recommendation_click: "النقر على توصية",
            favorite: "إضافة للمفضلة",
            add_to_cart: "إضافة للسلة",
            checkout_started: "بدء إتمام الطلب",
            inquiry_submitted: "إرسال استفسار",
            order_completed: "إتمام طلب"
        };

        return labels[name] || name || "حدث آخر";
    }

    function renderLiveEvents(report) {
        const rows = Array.isArray(report.event_breakdown)
            ? report.event_breakdown
            : [];

        renderLiveList("[data-live-events]", rows, {
            valueKey: "event_count",
            title: row => eventLabel(row.event_name)
        });
    }

    function renderBehaviorAnalytics() {
        const host = ensureBehaviorSection();
        if (!host) return;

        if (state.analyticsError || !state.analyticsReport) {
            const notice = $("[data-live-notice]", host);

            if (notice) {
                notice.hidden = false;
                notice.textContent = state.analyticsError
                    ? "تعذر تحميل التحليلات السلوكية: " +
                    state.analyticsError
                    : "لم تصل بيانات التحليلات بعد.";
            }

            const kpis = $("[data-live-kpis]", host);
            if (kpis) {
                kpis.innerHTML =
                    '<div class="ibr-live-empty">تعذر عرض مؤشرات التحليلات السلوكية. تأكد من تسجيل الدخول بحساب المدير ومن صلاحيات دوال التقارير.</div>';
            }

            return;
        }

        const report = state.analyticsReport;
        const notice = $("[data-live-notice]", host);

        if (notice) {
            const messages = [];

            if (report._rangeCapped) {
                messages.push(
                    "تم تحديد تقرير التحليلات بآخر " +
                    MAX_ANALYTICS_DAYS +
                    " يومًا بسبب الحد الأقصى المسموح به."
                );
            }

            if (state.aggregationError) {
                messages.push(
                    "تعذر تحديث التجميع اليومي، لكن تم تحميل التقرير من سجل الأحداث الخام."
                );
            }

            notice.hidden = messages.length === 0;
            notice.textContent = messages.join(" ");
        }

        renderLiveKpis(report);
        renderLiveDaily(report);
        renderLiveFunnel(report);

        renderLiveList("[data-live-pages]", report.top_pages, {
            valueKey: "views",
            title: row => row.page_path || "صفحة غير معروفة",
            subtitle: row =>
                "زوار مميزون: " + integer(row.unique_visitors)
        });

        renderLiveList("[data-live-products]", report.top_products, {
            valueKey: "views",
            title: row => {
                const product = state.products.find(
                    item => item.id === row.product_id
                );

                return product
                    ? product.name
                    : "منتج " + String(row.product_id || "").slice(0, 8);
            },
            subtitle: row =>
                "زوار مميزون: " + integer(row.unique_visitors)
        });

        renderLiveTraffic(report);
        renderLiveEvents(report);
    }

    /* =========================================================
       تحديث الواجهة بالكامل
    ========================================================= */

    function render() {
        const range = rangeForPeriod(state.period);
        const data = getCurrentData(range);

        renderKPIs(data);
        renderSalesChart(data);
        renderOrderStatuses(data);

        const ranked = renderProductPerformance(data);

        renderCustomers(data);
        renderInquiries(data);
        renderReviews(data);
        renderActivity(data);
        renderInsights(data, ranked);

        renderBehaviorAnalytics();

        const updated = $("[data-last-updated]");

        if (updated && state.lastUpdated) {
            updated.textContent =
                "آخر تحديث: " +
                state.lastUpdated.toLocaleTimeString("ar-SA", {
                    timeZone: TIME_ZONE,
                    hour: "2-digit",
                    minute: "2-digit"
                });
        }

        const health = $("[data-data-health]");

        if (health) {
            const operationalSources = [
                "orders",
                "items",
                "products",
                "categories",
                "messages",
                "reviews"
            ];

            const ok = operationalSources.filter(
                key => state.sourceStatus[key] === "success"
            ).length;

            health.textContent =
                "مصادر البيانات التشغيلية: " + ok + " من 6 متاحة";
        }

        const delivered = data.orders.filter(isDelivered).length;

        const active = data.orders.filter(order =>
            [
                "confirmed",
                "preparing",
                "shipped",
                "contacting"
            ].includes(order.status)
        ).length;

        setAlert(
            "ضمن الفترة المختارة: " +
            integer(delivered) +
            " طلبًا مسلّمًا تدخل في المبيعات المحققة، و" +
            integer(active) +
            " طلبًا نشطًا، و" +
            integer(data.orders.filter(isCancelled).length) +
            " طلبًا ملغيًا لا يدخل في الإيرادات."
        );

        updatePeriodButtons();
    }

    function updatePeriodButtons() {
        $$("[data-period]").forEach(button => {
            button.classList.toggle(
                "is-selected",
                button.dataset.period === state.period
            );
        });
    }

    /* =========================================================
       تصدير CSV للتقارير التشغيلية
    ========================================================= */

    function exportCSV() {
        const range = rangeForPeriod(state.period);
        const data = getCurrentData(range);

        const rows = [
            [
                "نوع السجل",
                "رقم الطلب",
                "التاريخ",
                "اسم العميل",
                "الهاتف",
                "المدينة",
                "الحالة",
                "الإجمالي"
            ]
        ];

        data.orders.forEach(order => {
            rows.push([
                "طلب",
                order.order_number || order.id,
                order.created_at || "",
                order.customer_name || "",
                order.customer_phone || "",
                order.city || "",
                ORDER_STATUS_LABELS[order.status] || order.status || "",
                number(order.total_amount)
            ]);
        });

        const csv = "\uFEFF" + rows.map(row =>
            row.map(value =>
                '"' +
                String(value == null ? "" : value).replace(/"/g, '""') +
                '"'
            ).join(",")
        ).join("\r\n");

        const blob = new Blob([csv], {
            type: "text/csv;charset=utf-8;"
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download =
            "ibr20-analytics-" +
            todayInRiyadh() +
            ".csv";

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }

    /* =========================================================
       تجهيز الأحداث
    ========================================================= */

    function bindEvents() {
        const refresh = $("[data-analytics-refresh]");

        if (refresh) {
            refresh.addEventListener("click", load);
        }

        const exportButton = $("[data-analytics-export]");

        if (exportButton) {
            exportButton.addEventListener("click", exportCSV);
        }

        $$("[data-period]").forEach(button => {
            button.addEventListener("click", () => {
                state.period = button.dataset.period;
                state.customRange = null;
                render();
                load();
            });
        });

        const apply = $("[data-apply-range]");

        if (apply) {
            apply.addEventListener("click", () => {
                const fromElement = $("[data-date-from]");
                const toElement = $("[data-date-to]");

                const from = fromElement ? fromElement.value : "";
                const to = toElement ? toElement.value : "";

                if (!from || !to || from > to) {
                    showError(
                        "يرجى اختيار تاريخ بداية ونهاية صحيحين للفترة المخصصة."
                    );
                    return;
                }

                if (daysBetweenInclusive(from, to) > MAX_ANALYTICS_DAYS) {
                    showError(
                        "الفترة المحددة طويلة جدًا. الحد الأقصى لتقارير التحليلات هو " +
                        MAX_ANALYTICS_DAYS +
                        " يومًا."
                    );
                    return;
                }

                hideError();

                state.customRange = { from, to };
                state.period = "custom";

                updatePeriodButtons();
                load();
            });
        }

        const menu = $("[data-admin-menu-toggle]");
        const sidebar = $("[data-admin-sidebar]");

        if (menu && sidebar) {
            menu.addEventListener("click", () => {
                sidebar.classList.toggle("is-open");
            });

            document.addEventListener("click", event => {
                if (!sidebar.classList.contains("is-open")) return;

                if (
                    sidebar.contains(event.target) ||
                    menu.contains(event.target)
                ) {
                    return;
                }

                sidebar.classList.remove("is-open");
            });
        }
    }

    /* =========================================================
       سياق آمن للوكلاء الذكيين
       لا يحتوي على بيانات شخصية أو نصوص رسائل العملاء
    ========================================================= */

    function getAgentContext() {
        const range = rangeForPeriod(state.period);
        const data = getCurrentData(range);
        const report = state.analyticsReport || {};
        const overview = report.overview || {};

        const topProducts = Array.isArray(report.top_products)
            ? report.top_products.slice(0, 10).map(row => {
                const product = state.products.find(
                    item => item.id === row.product_id
                );

                return {
                    product_id: row.product_id,
                    product_name: product ? product.name : null,
                    views: number(row.views),
                    unique_visitors: number(row.unique_visitors)
                };
            })
            : [];

        const topPages = Array.isArray(report.top_pages)
            ? report.top_pages.slice(0, 10).map(row => ({
                page_path: row.page_path,
                views: number(row.views),
                unique_visitors: number(row.unique_visitors)
            }))
            : [];

        return {
            version: VERSION,
            generated_at: new Date().toISOString(),
            timezone: TIME_ZONE,
            period: {
                start_date: range.startDate,
                end_date: range.endDate,
                label: range.label
            },
            operations: {
                orders_count: data.orders.length,
                delivered_orders: data.orders.filter(isDelivered).length,
                cancelled_orders: data.orders.filter(isCancelled).length,
                delivered_sales: sumDelivered(data.orders),
                average_delivered_order: data.orders.filter(isDelivered).length
                    ? sumDelivered(data.orders) /
                    data.orders.filter(isDelivered).length
                    : 0,
                inquiries_count: data.messages.length,
                open_inquiries_count: data.messages.filter(message =>
                    message.status === "new" ||
                    message.status === "in_review"
                ).length,
                active_products_count: state.products.filter(product =>
                    product.is_active === true &&
                    product.is_available !== false
                ).length
            },
            behavior: {
                total_events: number(overview.total_events),
                unique_visitors: number(overview.unique_visitors),
                unique_sessions: number(overview.unique_sessions),
                page_views: number(overview.page_views),
                product_views: number(overview.product_views),
                add_to_cart: number(overview.add_to_cart),
                checkout_started: number(overview.checkout_started),
                order_completed: number(overview.order_completed),
                top_products: topProducts,
                top_pages: topPages,
                funnel: Array.isArray(report.funnel)
                    ? report.funnel
                    : [],
                traffic_sources: Array.isArray(report.traffic_sources)
                    ? report.traffic_sources
                    : [],
                event_breakdown: Array.isArray(report.event_breakdown)
                    ? report.event_breakdown
                    : []
            },
            data_quality: {
                operational_sources: { ...state.sourceStatus },
                analytics_available: !!state.analyticsReport,
                analytics_error: state.analyticsError || null,
                aggregation_error: state.aggregationError || null
            }
        };
    }

    /* =========================================================
       التهيئة والحماية من تكرار التشغيل
    ========================================================= */

    function init() {
        if (state.initialized) return;

        state.initialized = true;
        bindEvents();

        const content = $("[data-admin-content]");

        if (content && !content.hidden) {
            load();
            return;
        }

        let observer = null;

        if (content && typeof MutationObserver !== "undefined") {
            observer = new MutationObserver(() => {
                if (
                    !content.hidden &&
                    !state.lastUpdated &&
                    !state.loading
                ) {
                    observer.disconnect();
                    load();
                }
            });

            observer.observe(content, {
                attributes: true,
                attributeFilter: ["hidden", "class", "style"]
            });
        }

        window.addEventListener("ibr-admin-ready", () => {
            if (!state.lastUpdated && !state.loading) {
                if (observer) observer.disconnect();
                load();
            }
        }, { once: true });
    }

    /* =========================================================
       واجهة البرمجة العامة
    ========================================================= */

    const api = {
        version: VERSION,

        init,
        load,
        render,

        getData: () => ({
            orders: state.orders.slice(),
            orderItems: state.items.slice(),
            products: state.products.slice(),
            categories: state.categories.slice(),
            messages: state.messages.slice(),
            reviews: state.reviews.slice(),
            analyticsReport: state.analyticsReport,
            errors: state.errors.slice(),
            analyticsError: state.analyticsError,
            aggregationError: state.aggregationError
        }),

        /*
         * هذه الواجهة مخصصة لتوفير بيانات مجمعة وآمنة
         * للوكلاء الذكيين، دون بيانات العملاء الشخصية.
         */
        getAgentContext,

        configure: options => {
            if (!options) return;

            if (options.client) {
                state.client = options.client;
            }

            if (options.period) {
                state.period = String(options.period);
            }

            if (options.customRange) {
                state.customRange = options.customRange;
                state.period = "custom";
            }
        },

        reset: () => {
            state.orders = [];
            state.items = [];
            state.products = [];
            state.categories = [];
            state.messages = [];
            state.reviews = [];

            state.analyticsReport = null;
            state.analyticsError = null;
            state.aggregationError = null;

            state.errors = [];
            state.sourceStatus = {};
            state.lastUpdated = null;
            state.loading = false;

            state.period = "30";
            state.customRange = null;
        }
    };

    window.IBRAdminAnalytics = api;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, {
            once: true
        });
    } else {
        init();
    }

})();
