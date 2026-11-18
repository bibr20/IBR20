/* =========================================================
   IBR20 ORDERS SERVICE
   خدمة إدارة الطلبات وتفاصيلها
   Version: 2.0.0

   الجداول والأعمدة المستخدمة مأخوذة من مخطط المشروع الحالي:
   orders + order_items.
   لا ينشئ اتصال Supabase جديدًا ولا يغير قاعدة البيانات.
========================================================= */

(() => {
    "use strict";

    if (window.IBROrdersService) {
        console.warn("IBROrdersService is already initialized.");
        return;
    }

    const CONFIG = Object.freeze({
        ordersTable: "orders",
        itemsTable: "order_items",
        defaultLimit: 100,
        maximumLimit: 1000,
        maximumPageSize: 250
    });

    const ORDER_COLUMNS = [
        "id", "order_number", "idempotency_key",
        "customer_name", "customer_phone", "city",
        "neighborhood", "address", "customer_note",
        "subtotal", "shipping_fee", "total_amount",
        "payment_method", "status", "created_at",
        "updated_at", "expected_delivery_date",
        "delivered_at", "admin_note", "idempotency_hash"
    ].join(",");

    const ITEM_COLUMNS = [
        "id", "order_id", "product_id", "product_name",
        "product_sku", "product_image_url", "unit_price",
        "quantity", "line_total", "product_snapshot", "created_at"
    ].join(",");

    const ORDER_STATUSES = Object.freeze({
        new: "جديد",
        contacting: "جارٍ التواصل",
        confirmed: "مؤكد",
        preparing: "قيد التجهيز",
        shipped: "تم الشحن",
        delivered: "تم التسليم",
        cancelled: "ملغي"
    });

    const VALID_STATUSES = Object.freeze(Object.keys(ORDER_STATUSES));
    let configuredClient = null;

    function getClient() {
        const client = configuredClient ||
            window.supabaseClient ||
            (window.IBRAdmin && typeof window.IBRAdmin.getClient === "function"
                ? window.IBRAdmin.getClient()
                : null);

        if (!client || typeof client.from !== "function") {
            throw new Error("اتصال Supabase غير متاح. تحقق من تحميل store.js.");
        }
        return client;
    }

    function configure(options = {}) {
        if (options.client) {
            if (typeof options.client.from !== "function") {
                throw new Error("Supabase client غير صالح.");
            }
            configuredClient = options.client;
        }
        return true;
    }

    function handleError(error, fallbackMessage) {
        console.error("[IBROrdersService]", error);
        const message = error?.message || error?.details || error?.hint;
        throw new Error(message || fallbackMessage || "حدث خطأ أثناء تنفيذ العملية.");
    }

    function toNumber(value) {
        if (typeof value === "string") {
            value = value.replace(/[٬,]/g, "").replace(/[٫]/g, ".");
        }
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function normalizeArabicDigits(value) {
        return String(value ?? "").replace(/[٠-٩۰-۹]/g, digit => {
            const code = digit.charCodeAt(0);
            return String(code >= 0x06F0 && code <= 0x06F9
                ? code - 0x06F0
                : code - 0x0660);
        });
    }

    function normalizePhone(phone) {
        let value = normalizeArabicDigits(phone).replace(/[^\d+]/g, "");
        if (value.startsWith("00")) value = value.slice(2);
        if (value.startsWith("+")) value = value.slice(1);
        if (value.startsWith("05") && value.length === 10) value = "966" + value.slice(1);
        if (value.startsWith("5") && value.length === 9) value = "966" + value;
        return value;
    }

    function validateOrderId(orderId) {
        if (typeof orderId !== "string" || !orderId.trim()) {
            throw new Error("معرف الطلب غير صالح.");
        }
        return orderId.trim();
    }

    function validateOrderNumber(orderNumber) {
        const value = String(orderNumber ?? "").trim();
        if (!value) throw new Error("رقم الطلب غير صالح.");
        return value;
    }

    function validateStatus(status) {
        if (!VALID_STATUSES.includes(status)) {
            throw new Error("حالة الطلب غير معتمدة.");
        }
        return status;
    }

    function normalizeItem(item) {
        const source = item && typeof item === "object" ? item : {};
        const unitPrice = toNumber(source.unit_price);
        const quantity = toNumber(source.quantity);
        const lineTotal = source.line_total === null ||
            source.line_total === undefined
            ? unitPrice * quantity
            : toNumber(source.line_total);

        return {
            ...source,
            unit_price: unitPrice,
            quantity,
            line_total: lineTotal,
            product_name: source.product_name || "منتج",
            product_image_url: source.product_image_url || null,
            product_snapshot: source.product_snapshot || null
        };
    }

    function normalizeOrder(order) {
        if (!order) return null;
        const items = Array.isArray(order.items)
            ? order.items.map(normalizeItem)
            : [];
        const itemsCount = items.reduce((sum, item) => sum + item.quantity, 0);

        return {
            ...order,
            subtotal: toNumber(order.subtotal),
            shipping_fee: toNumber(order.shipping_fee),
            total_amount: toNumber(order.total_amount),
            items,
            items_count: itemsCount,
            products_count: items.length,
            status_label: ORDER_STATUSES[order.status] || order.status || "غير محدد"
        };
    }

    function uniqueIds(ids) {
        return [...new Set((Array.isArray(ids) ? ids : [])
            .filter(id => typeof id === "string" && id.trim())
            .map(id => id.trim()))];
    }

    async function fetchOrderItems(orderIds, options = {}) {
        const ids = uniqueIds(orderIds);
        if (!ids.length) return [];
        const client = getClient();
        let query = client.from(CONFIG.itemsTable).select(ITEM_COLUMNS)
            .in("order_id", ids)
            .order("created_at", { ascending: true });

        if (options.productId) query = query.eq("product_id", options.productId);

        const { data, error } = await query;
        if (error) handleError(error, "تعذر تحميل تفاصيل المنتجات.");
        return Array.isArray(data) ? data.map(normalizeItem) : [];
    }

    function attachItemsToOrders(orders, items) {
        if (!Array.isArray(orders)) return [];
        const map = new Map();
        (Array.isArray(items) ? items : []).forEach(item => {
            const id = item.order_id;
            if (!map.has(id)) map.set(id, []);
            map.get(id).push(normalizeItem(item));
        });
        return orders.map(order => normalizeOrder({
            ...order,
            items: map.get(order.id) || []
        }));
    }

    function getLimit(value) {
        if (value === undefined || value === null || value === "") {
            return CONFIG.defaultLimit;
        }
        const requested = Number(value);
        if (!Number.isFinite(requested)) return CONFIG.defaultLimit;
        return Math.min(Math.max(Math.floor(requested), 1), CONFIG.maximumLimit);
    }

    function applyOrderFilters(query, options = {}) {
        if (options.status) query = query.eq("status", validateStatus(options.status));
        if (options.id) query = query.eq("id", validateOrderId(options.id));
        if (options.orderNumber) {
            query = query.eq("order_number", validateOrderNumber(options.orderNumber));
        }
        if (options.customerPhone) {
            const phone = String(options.customerPhone).trim();
            if (!phone) throw new Error("رقم هاتف العميل غير صالح.");
            // عمود الهاتف نصي؛ نستخدم القيمة كما خزنت في الطلب حتى لا نخمن تنسيق التخزين.
            query = query.eq("customer_phone", phone);
        }
        if (options.city) query = query.ilike("city", `%${String(options.city).trim()}%`);
        if (options.neighborhood) {
            query = query.ilike("neighborhood", `%${String(options.neighborhood).trim()}%`);
        }
        if (options.createdFrom) query = query.gte("created_at", options.createdFrom);
        if (options.createdTo) query = query.lte("created_at", options.createdTo);
        if (options.excludeCancelled === true) query = query.neq("status", "cancelled");
        return query;
    }

    async function fetchOrders(options = {}) {
        const client = getClient();
        let query = client.from(CONFIG.ordersTable).select(ORDER_COLUMNS);
        query = applyOrderFilters(query, options);
        query = query.order("created_at", { ascending: false });
        query = query.limit(getLimit(options.limit));

        const { data, error } = await query;
        if (error) handleError(error, "تعذر تحميل الطلبات.");
        const orders = Array.isArray(data) ? data : [];
        if (!orders.length) return [];
        const items = await fetchOrderItems(orders.map(order => order.id));
        return attachItemsToOrders(orders, items);
    }

    async function fetchOrdersPage(options = {}) {
        const page = Math.max(1, Math.floor(Number(options.page) || 1));
        const pageSize = Math.min(
            Math.max(1, Math.floor(Number(options.pageSize) || 25)),
            CONFIG.maximumPageSize
        );
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const client = getClient();

        let query = client.from(CONFIG.ordersTable)
            .select(ORDER_COLUMNS, { count: "exact" });
        query = applyOrderFilters(query, options)
            .order("created_at", { ascending: false })
            .range(from, to);

        const { data, error, count } = await query;
        if (error) handleError(error, "تعذر تحميل صفحة الطلبات.");
        const orders = Array.isArray(data) ? data : [];
        const items = orders.length
            ? await fetchOrderItems(orders.map(order => order.id))
            : [];
        const normalized = attachItemsToOrders(orders, items);
        const total = Number.isFinite(count) ? count : null;

        return {
            data: normalized,
            page,
            pageSize,
            total,
            totalPages: total === null ? null : Math.ceil(total / pageSize),
            hasMore: total === null
                ? orders.length === pageSize
                : from + normalized.length < total
        };
    }

    async function getCustomerOrders(phone, options = {}) {
        if (!phone) throw new Error("رقم هاتف العميل غير متوفر.");
        return fetchOrders({
            ...options,
            customerPhone: String(phone).trim(),
            limit: getLimit(options.limit || 500)
        });
    }

    async function getOrderById(orderId) {
        const orders = await fetchOrders({
            id: validateOrderId(orderId),
            limit: 1
        });
        return orders[0] || null;
    }

    async function getOrderByNumber(orderNumber) {
        const number = validateOrderNumber(orderNumber);
        const client = getClient();
        const { data, error } = await client.from(CONFIG.ordersTable)
            .select(ORDER_COLUMNS)
            .eq("order_number", number)
            .maybeSingle();

        if (error) handleError(error, "تعذر البحث عن رقم الطلب.");
        if (!data) return null;
        const items = await fetchOrderItems([data.id]);
        return attachItemsToOrders([data], items)[0] || null;
    }

    function normalizeSearchText(value) {
        return normalizeArabicDigits(value)
            .toLowerCase()
            .replace(/[أإآ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/[ًٌٍَُِّْـ]/g, "")
            .trim();
    }

    function searchOrders(orders, searchTerm) {
        if (!Array.isArray(orders)) return [];
        const term = normalizeSearchText(searchTerm);
        if (!term) return orders;

        return orders.filter(order => {
            const values = [
                order.order_number, order.customer_name, order.customer_phone,
                order.city, order.neighborhood, order.address, order.status,
                ORDER_STATUSES[order.status]
            ];
            (Array.isArray(order.items) ? order.items : []).forEach(item => {
                values.push(item.product_name, item.product_sku);
            });
            return values.some(value => normalizeSearchText(value).includes(term));
        });
    }

    async function updateOrderStatus(orderId, newStatus) {
        const id = validateOrderId(orderId);
        const status = validateStatus(newStatus);
        const client = getClient();
        const payload = { status };
        if (status === "delivered") payload.delivered_at = new Date().toISOString();

        const { data, error } = await client.from(CONFIG.ordersTable)
            .update(payload)
            .eq("id", id)
            .select(ORDER_COLUMNS)
            .single();

        if (error) handleError(error, "تعذر تحديث حالة الطلب.");
        return normalizeOrder(data);
    }

    async function updateAdminNote(orderId, note) {
        const id = validateOrderId(orderId);
        if (note !== null && note !== undefined && typeof note !== "string") {
            throw new Error("ملاحظة الإدارة يجب أن تكون نصًا.");
        }
        const client = getClient();
        const { data, error } = await client.from(CONFIG.ordersTable)
            .update({ admin_note: note === null ? null : String(note || "").trim() })
            .eq("id", id)
            .select(ORDER_COLUMNS)
            .single();

        if (error) handleError(error, "تعذر حفظ ملاحظة الإدارة.");
        return normalizeOrder(data);
    }

    function validateDeliveryDate(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new Error("صيغة موعد التسليم غير صحيحة. استخدم YYYY-MM-DD.");
        }
        const parsed = new Date(`${value}T00:00:00Z`);
        if (
            Number.isNaN(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== value
        ) {
            throw new Error("تاريخ التسليم غير صالح.");
        }
        return value;
    }

    async function updateExpectedDeliveryDate(orderId, deliveryDate) {
        const id = validateOrderId(orderId);
        const normalizedDate = validateDeliveryDate(deliveryDate);
        const client = getClient();
        const { data, error } = await client.from(CONFIG.ordersTable)
            .update({ expected_delivery_date: normalizedDate })
            .eq("id", id)
            .select(ORDER_COLUMNS)
            .single();

        if (error) handleError(error, "تعذر تحديث موعد التسليم.");
        return normalizeOrder(data);
    }

    function getOrderStats(orders) {
        const list = Array.isArray(orders) ? orders : [];
        const stats = {
            total: list.length,
            new: 0, contacting: 0, confirmed: 0, preparing: 0,
            shipped: 0, delivered: 0, cancelled: 0,
            activeOrders: 0,
            cancelledOrders: 0,
            nonCancelledOrderValue: 0,
            totalItems: 0,
            // توافق قديم فقط؛ ليست إيرادات محصلة.
            totalRevenue: 0
        };

        list.forEach(raw => {
            const order = normalizeOrder(raw);
            if (!order) return;
            if (Object.prototype.hasOwnProperty.call(ORDER_STATUSES, order.status)) {
                stats[order.status]++;
            }
            if (order.status === "cancelled") {
                stats.cancelledOrders++;
                return;
            }
            stats.activeOrders++;
            stats.nonCancelledOrderValue += order.total_amount;
            stats.totalItems += order.items_count;
        });

        stats.totalRevenue = stats.nonCancelledOrderValue;
        return stats;
    }

    function formatCurrency(amount) {
        return new Intl.NumberFormat("ar-SA", {
            style: "currency",
            currency: "SAR",
            maximumFractionDigits: 2
        }).format(toNumber(amount));
    }

    function formatDate(dateValue, options = {}) {
        if (!dateValue) return "—";
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("ar-SA", {
            timeZone: "Asia/Riyadh",
            year: "numeric",
            month: options.month || "long",
            day: "numeric",
            ...(options.withTime ? { hour: "2-digit", minute: "2-digit" } : {})
        }).format(date);
    }

    window.IBROrdersService = Object.freeze({
        version: "2.0.0",
        configure,
        getClient,
        fetchOrders,
        fetchOrdersPage,
        fetchOrderItems,
        getCustomerOrders,
        getOrderById,
        getOrderByNumber,
        searchOrders,
        updateOrderStatus,
        updateAdminNote,
        updateExpectedDeliveryDate,
        getOrderStats,
        normalizeOrder,
        normalizeItem,
        normalizePhone,
        normalizeSearchText,
        formatCurrency,
        formatDate,
        orderStatuses: ORDER_STATUSES,
        validStatuses: VALID_STATUSES
    });

    console.info("IBROrdersService v2.0.0 initialized successfully.");
})();