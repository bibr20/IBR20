/* =========================================================
   IBR20 CUSTOMER PROFILE
   ملف العميل الموحد وإثراء بياناته
   Version: 2.0.0

   يعتمد على:
   - IBRCustomersService (المصدر الموحد لبيانات العميل)
   - IBROrdersService
   - IBRMessagesService

   لا ينشئ جداول أو اتصالات Supabase جديدة.
   لا يفترض وجود جدول customers أو reviews.
========================================================= */

(() => {
    "use strict";

    if (window.IBRCustomerProfile) {
        console.warn("IBRCustomerProfile is already initialized.");
        return;
    }

    const PENDING_ORDER_STATUSES = Object.freeze([
        "new", "contacting", "confirmed", "preparing", "shipped"
    ]);

    const SEGMENT_LABELS = Object.freeze({
        unknown: "غير معروف",
        prospect: "عميل مهتم ولم يطلب",
        new_customer: "عميل جديد",
        returning_customer: "عميل متكرر",
        loyal_customer: "عميل دائم"
    });

    function getCustomersService() {
        const service = window.IBRCustomersService;
        if (
            !service ||
            typeof service.fetchCustomerByPhone !== "function" ||
            typeof service.normalizePhone !== "function" ||
            typeof service.formatPhone !== "function"
        ) {
            throw new Error(
                "خدمة العملاء غير متوافقة. تحقق من تحميل customers-service.js قبل customer-profile.js."
            );
        }
        return service;
    }

    function normalizePhone(phone) {
        const service = getCustomersService();
        return service.normalizePhone(phone);
    }

    function formatPhone(phone) {
        const service = getCustomersService();
        return phone ? service.formatPhone(phone) : "";
    }

    function samePhone(firstPhone, secondPhone) {
        const first = normalizePhone(firstPhone);
        const second = normalizePhone(secondPhone);
        return Boolean(first && second && first === second);
    }

    function toNumber(value) {
        if (typeof value === "string") {
            value = value.replace(/[٬,]/g, "").replace(/[٫]/g, ".");
        }
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    }

    function getTimestamp(value) {
        if (!value) return 0;
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function getField(record, camelName, snakeName, fallback = null) {
        if (!record || typeof record !== "object") return fallback;
        if (record[camelName] !== undefined && record[camelName] !== null) {
            return record[camelName];
        }
        if (record[snakeName] !== undefined && record[snakeName] !== null) {
            return record[snakeName];
        }
        return fallback;
    }

    function firstValue(...values) {
        return values.find(value =>
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
        ) ?? null;
    }

    function sortByDate(records, camelField = "createdAt", snakeField = "created_at") {
        if (!Array.isArray(records)) return [];
        return [...records].sort((a, b) =>
            getTimestamp(getField(b, camelField, snakeField)) -
            getTimestamp(getField(a, camelField, snakeField))
        );
    }

    function normalizeOrder(order) {
        if (!order || typeof order !== "object") return null;
        const items = Array.isArray(order.items)
            ? order.items.map(item => ({ ...item }))
            : [];
        return {
            ...order,
            id: firstValue(order.id),
            order_number: firstValue(order.order_number, order.orderNumber),
            customer_name: firstValue(order.customer_name, order.customerName, order.name),
            customer_phone: firstValue(order.customer_phone, order.customerPhone, order.phone),
            city: firstValue(order.city),
            neighborhood: firstValue(order.neighborhood),
            address: firstValue(order.address),
            customer_note: firstValue(order.customer_note, order.customerNote),
            payment_method: firstValue(order.payment_method, order.paymentMethod),
            status: firstValue(order.status, "unknown"),
            created_at: firstValue(order.created_at, order.createdAt),
            expected_delivery_date: firstValue(
                order.expected_delivery_date, order.expectedDeliveryDate
            ),
            delivered_at: firstValue(order.delivered_at, order.deliveredAt),
            subtotal: toNumber(order.subtotal),
            shipping_fee: toNumber(order.shipping_fee ?? order.shippingFee),
            total_amount: toNumber(
                order.total_amount ?? order.totalAmount ?? order.total
            ),
            items,
            items_count: items.reduce(
                (sum, item) => sum + toNumber(item.quantity), 0
            )
        };
    }

    function normalizeMessage(message) {
        if (!message || typeof message !== "object") return null;
        return {
            ...message,
            id: firstValue(message.id),
            customer_name: firstValue(message.customer_name, message.customerName),
            customer_phone: firstValue(message.customer_phone, message.customerPhone),
            message_type: firstValue(message.message_type, message.messageType),
            created_at: firstValue(message.created_at, message.createdAt),
            customer_reply: firstValue(message.customer_reply, message.customerReply),
            customer_reply_at: firstValue(
                message.customer_reply_at, message.customerReplyAt
            ),
            status: firstValue(message.status, "unknown")
        };
    }

    function getLatestActivity(orders, messages) {
        const timestamps = [];
        orders.forEach(order => {
            if (order.created_at) timestamps.push(order.created_at);
        });
        messages.forEach(message => {
            if (message.created_at) timestamps.push(message.created_at);
            if (message.customer_reply_at) timestamps.push(message.customer_reply_at);
        });
        if (!timestamps.length) return null;
        return timestamps.reduce((latest, current) =>
            getTimestamp(current) > getTimestamp(latest) ? current : latest
        );
    }

    function calculateStats(orders = [], messages = []) {
        const safeOrders = Array.isArray(orders)
            ? orders.map(normalizeOrder).filter(Boolean)
            : [];
        const safeMessages = Array.isArray(messages)
            ? messages.map(normalizeMessage).filter(Boolean)
            : [];

        const validOrders = safeOrders.filter(order => order.status !== "cancelled");
        const cancelledOrders = safeOrders.filter(order => order.status === "cancelled");
        const deliveredOrders = validOrders.filter(order => order.status === "delivered");
        const pendingOrders = validOrders.filter(order =>
            PENDING_ORDER_STATUSES.includes(order.status)
        );

        const nonCancelledOrderValue = validOrders.reduce(
            (sum, order) => sum + order.total_amount, 0
        );
        const totalItems = validOrders.reduce(
            (sum, order) => sum + order.items_count, 0
        );
        const unansweredMessages = safeMessages.filter(message =>
            ["new", "in_review"].includes(message.status)
        );
        const complaints = safeMessages.filter(message =>
            message.message_type === "complaint"
        );
        const suggestions = safeMessages.filter(message =>
            message.message_type === "suggestion"
        );

        return {
            totalOrders: safeOrders.length,
            validOrders: validOrders.length,
            cancelledOrders: cancelledOrders.length,
            pendingOrders: pendingOrders.length,
            deliveredOrders: deliveredOrders.length,
            totalItems,
            nonCancelledOrderValue,
            // توافق قديم: هذا ليس مبلغًا محصلًا أو إيرادًا مؤكدًا.
            totalSpent: nonCancelledOrderValue,
            averageOrderValue: validOrders.length
                ? nonCancelledOrderValue / validOrders.length
                : 0,
            totalMessages: safeMessages.length,
            newMessages: safeMessages.filter(m => m.status === "new").length,
            unansweredMessages: unansweredMessages.length,
            answeredMessages: safeMessages.filter(m => m.status === "answered").length,
            complaints: complaints.length,
            suggestions: suggestions.length,
            productsCount: validOrders.reduce(
                (sum, order) => sum + order.items.length, 0
            )
        };
    }

    function collectProductSummary(orders) {
        const map = new Map();
        (Array.isArray(orders) ? orders : []).forEach(order => {
            if (order.status === "cancelled") return;
            (order.items || []).forEach(item => {
                const key = String(
                    item.product_id || item.product_sku || item.product_name || item.id || "unknown"
                );
                const current = map.get(key) || {
                    product_id: item.product_id || null,
                    product_sku: item.product_sku || null,
                    product_name: item.product_name || "منتج",
                    product_image_url: item.product_image_url || null,
                    quantity: 0,
                    total_value: 0,
                    order_count: 0
                };
                current.quantity += toNumber(item.quantity);
                current.total_value += toNumber(
                    item.line_total ?? (toNumber(item.unit_price) * toNumber(item.quantity))
                );
                current.order_count += 1;
                if (!current.product_image_url && item.product_image_url) {
                    current.product_image_url = item.product_image_url;
                }
                map.set(key, current);
            });
        });
        return [...map.values()].sort((a, b) => b.quantity - a.quantity);
    }

    function collectCustomerDetails(customer, orders) {
        const source = customer && typeof customer === "object" ? customer : {};
        const latestOrder = orders[0] || {};

        // لا نختلق حقولاً: نعرض فقط القيم الموجودة في بيانات العميل/طلباته.
        return {
            name: firstValue(
                source.name, source.customer_name, source.customerName,
                latestOrder.customer_name
            ),
            phone: firstValue(
                source.phone, source.customer_phone, source.customerPhone,
                latestOrder.customer_phone
            ),
            email: firstValue(
                source.email, source.customer_email, source.customerEmail
            ),
            city: firstValue(source.city, latestOrder.city),
            neighborhood: firstValue(
                source.neighborhood, latestOrder.neighborhood
            ),
            address: firstValue(source.address, latestOrder.address),
            customer_note: firstValue(
                source.customer_note, source.customerNote,
                latestOrder.customer_note
            ),
            // يحتفظ بكل خصائص السجل الأصلي دون إضافة قيم افتراضية مضللة.
            source
        };
    }

    function buildProfile(customer, orders = [], messages = []) {
        if (!customer) return null;

        const sortedOrders = sortByDate(
            (Array.isArray(orders) ? orders : [])
                .map(normalizeOrder).filter(Boolean)
        );
        const sortedMessages = sortByDate(
            (Array.isArray(messages) ? messages : [])
                .map(normalizeMessage).filter(Boolean)
        );

        const stats = calculateStats(sortedOrders, sortedMessages);
        const details = collectCustomerDetails(customer, sortedOrders);
        const phone = details.phone || "";
        const latestOrder = sortedOrders[0] || null;
        const latestMessage = sortedMessages[0] || null;

        return {
            customer: {
                ...customer,
                ...details,
                phone,
                formatted_phone: phone ? formatPhone(phone) : "",
                formattedPhone: phone ? formatPhone(phone) : ""
            },
            details,
            stats,
            orders: sortedOrders,
            messages: sortedMessages,
            products: collectProductSummary(sortedOrders),
            latestOrder,
            latestMessage,
            latestActivity: getLatestActivity(sortedOrders, sortedMessages),
            hasOrders: sortedOrders.length > 0,
            hasMessages: sortedMessages.length > 0,
            hasPurchases: stats.validOrders > 0,
            isReturningCustomer: stats.validOrders > 1,
            generatedAt: new Date().toISOString()
        };
    }

    async function getProfileByPhone(phone, options = {}) {
        const normalizedPhone = normalizePhone(phone);
        if (!normalizedPhone) {
            throw new Error("رقم هاتف العميل غير صالح.");
        }

        try {
            const customer = await getCustomersService().fetchCustomerByPhone(
                normalizedPhone,
                {
                    ordersLimit: Math.min(
                        Math.max(Number(options.ordersLimit) || 500, 1), 1000
                    ),
                    messagesLimit: Math.min(
                        Math.max(Number(options.messagesLimit) || 500, 1), 1000
                    ),
                    refresh: options.refresh === true
                }
            );

            if (!customer) return null;

            const orders = Array.isArray(customer.orders) ? customer.orders : [];
            const messages = Array.isArray(customer.messages) ? customer.messages : [];

            // بعض نسخ خدمة العملاء تعيد سجلاً مجمعاً، وأخرى تعيد customer داخل المفتاح.
            const customerRecord = customer.customer &&
                typeof customer.customer === "object"
                ? { ...customer, ...customer.customer }
                : customer;

            return buildProfile(customerRecord, orders, messages);
        } catch (error) {
            console.error("[IBRCustomerProfile]", error);
            throw new Error(error?.message || "تعذر تحميل ملف العميل.");
        }
    }

    async function refreshProfile(phone, options = {}) {
        return getProfileByPhone(phone, { ...options, refresh: true });
    }

    async function getQuickSummary(phone, options = {}) {
        const profile = await getProfileByPhone(phone, options);
        if (!profile) return null;
        return {
            name: profile.customer.name || "",
            phone: profile.customer.formatted_phone,
            totalOrders: profile.stats.totalOrders,
            validOrders: profile.stats.validOrders,
            nonCancelledOrderValue: profile.stats.nonCancelledOrderValue,
            totalItems: profile.stats.totalItems,
            pendingOrders: profile.stats.pendingOrders,
            deliveredOrders: profile.stats.deliveredOrders,
            totalMessages: profile.stats.totalMessages,
            unansweredMessages: profile.stats.unansweredMessages,
            latestActivity: profile.latestActivity,
            segment: getCustomerSegment(profile)
        };
    }

    function getCustomerSegment(profile) {
        if (!profile || !profile.stats) return "unknown";
        const count = Number(profile.stats.validOrders) || 0;
        if (!count) return "prospect";
        if (count === 1) return "new_customer";
        if (count >= 5) return "loyal_customer";
        return "returning_customer";
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

    window.IBRCustomerProfile = Object.freeze({
        version: "2.0.0",
        normalizePhone,
        formatPhone,
        samePhone,
        toNumber,
        getField,
        normalizeOrder,
        normalizeMessage,
        calculateStats,
        collectProductSummary,
        collectCustomerDetails,
        buildProfile,
        getProfileByPhone,
        refreshProfile,
        getQuickSummary,
        getCustomerSegment,
        segmentLabels: SEGMENT_LABELS,
        formatCurrency,
        formatDate
    });

    console.info("IBRCustomerProfile v2.0.0 initialized successfully.");
})();