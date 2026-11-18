/* =========================================================
   IBR20 CUSTOMER REPORTS
   خدمة تقارير العملاء وتحليل المبيعات والاستفسارات

   Version: 2.0.0

   التحسينات:
   1. معالجة بناء بيانات العملاء.
   2. توحيد الأرقام العربية والهندية والفارسية.
   3. دعم الحقول العربية بصيغتي snake_case و camelCase.
   4. توافق مباشر مع IBRCustomersService.
   5. معالجة حدود جلب البيانات والتنبيه عند احتمال نقصها.
   6. حماية تصدير CSV من Formula Injection.
   7. تحسين حساب المبيعات والمنتجات والعملاء.

   يعتمد على:
   - orders-service.js
   - messages-service.js
   - customers-service.js
========================================================= */

(() => {

    "use strict";


    /* =====================================================
       منع التهيئة المكررة
    ===================================================== */

    if (window.IBRCustomerReports) {
        return;
    }


    /* =====================================================
       الإعدادات
    ===================================================== */

    const CONFIG = {

        version: "2.0.0",

        defaultLimit: 1000,

        maximumLimit: 1000,

        maximumTopResults: 100,

        cancelledStatus: "cancelled",

        deliveredStatus: "delivered",

        currency: "SAR",

        locale: "ar-SA",

        maximumExportRows: 10000,

        csvSeparator: ","

    };


    /* =====================================================
       الحالات المعتمدة
    ===================================================== */

    const ORDER_STATUSES = {

        new: "طلب جديد",

        contacting: "جاري التواصل",

        confirmed: "تم التأكيد",

        preparing: "قيد التجهيز",

        shipped: "تم الشحن",

        delivered: "تم التسليم",

        cancelled: "ملغي"

    };


    const MESSAGE_STATUSES = {

        new: "جديد",

        in_review: "قيد المراجعة",

        answered: "تم الرد",

        closed: "مغلق"

    };


    const MESSAGE_TYPES = {

        inquiry: "استفسار",

        product_inquiry: "استفسار عن منتج",

        complaint: "شكوى",

        suggestion: "اقتراح",

        support: "طلب مساعدة",

        other: "أخرى"

    };


    /* =====================================================
       الأدوات الأساسية
    ===================================================== */

    function getField(object, ...keys) {

        if (!object || typeof object !== "object") {
            return undefined;
        }

        for (const key of keys) {

            if (
                Object.prototype.hasOwnProperty.call(
                    object,
                    key
                ) &&
                object[key] !== undefined &&
                object[key] !== null
            ) {
                return object[key];
            }

        }

        return undefined;

    }


    function hasValue(value) {

        return (
            value !== undefined &&
            value !== null &&
            value !== ""
        );

    }


    function toNumber(value, fallback = 0) {

        if (!hasValue(value)) {
            return fallback;
        }

        if (typeof value === "number") {

            return Number.isFinite(value)
                ? value
                : fallback;

        }

        const normalized = normalizeDigits(
            String(value)
        );

        const cleaned = normalized
            .replace(/,/g, "")
            .replace(/[^\d.-]/g, "");

        const result = Number(cleaned);

        return Number.isFinite(result)
            ? result
            : fallback;

    }


    function normalizeDigits(value) {

        if (value === null || value === undefined) {
            return "";
        }

        return String(value).replace(
            /[٠-٩۰-۹]/g,
            digit => {

                const code = digit.charCodeAt(0);

                if (code >= 0x0660 && code <= 0x0669) {
                    return String(code - 0x0660);
                }

                if (code >= 0x06F0 && code <= 0x06F9) {
                    return String(code - 0x06F0);
                }

                return digit;

            }
        );

    }


    function normalizePhone(phone) {

        if (!phone) {
            return "";
        }

        let value = normalizeDigits(phone)
            .replace(/\D/g, "");

        if (!value) {
            return "";
        }

        // تحويل بادئة الاتصال الدولية إلى صيغة موحدة.

        if (value.startsWith("00966")) {
            value = value.slice(5);
        }

        if (value.startsWith("966")) {
            value = value.slice(3);
        }

        if (value.startsWith("0")) {
            value = value.slice(1);
        }

        return value;

    }


    function getDate(value) {

        if (!hasValue(value)) {
            return null;
        }

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;

    }


    function getTimestamp(value) {

        const date = getDate(value);

        return date
            ? date.getTime()
            : 0;

    }


    function getOrderStatus(order) {

        return String(
            getField(
                order,
                "status",
                "order_status"
            ) || ""
        ).toLowerCase().trim();

    }


    function getOrderTotal(order) {

        const total = getField(
            order,
            "totalAmount",
            "total_amount",
            "total",
            "grandTotal",
            "grand_total"
        );

        return toNumber(total);

    }


    function getOrderItems(order) {

        const items = getField(
            order,
            "items",
            "orderItems",
            "order_items"
        );

        return Array.isArray(items)
            ? items
            : [];

    }


    function getCustomerName(customer) {

        return String(
            getField(
                customer,
                "customerName",
                "customer_name",
                "name",
                "fullName",
                "full_name"
            ) || "عميل"
        ).trim();

    }


    function getCustomerPhone(customer) {

        return normalizePhone(
            getField(
                customer,
                "customerPhone",
                "customer_phone",
                "phone",
                "mobile"
            )
        );

    }


    function getCustomerEmail(customer) {

        return String(
            getField(
                customer,
                "customerEmail",
                "customer_email",
                "email"
            ) || ""
        ).trim().toLowerCase();

    }


    /* =====================================================
       تنسيق الأرقام والعملات والتواريخ
    ===================================================== */

    function formatNumber(value, maximumFractionDigits = 0) {

        return new Intl.NumberFormat(
            CONFIG.locale,
            {
                maximumFractionDigits
            }
        ).format(
            toNumber(value)
        );

    }


    function formatCurrency(value) {

        return new Intl.NumberFormat(
            CONFIG.locale,
            {
                style: "currency",
                currency: CONFIG.currency,
                maximumFractionDigits: 2
            }
        ).format(
            toNumber(value)
        );

    }


    function formatDate(value, options = {}) {

        const date = getDate(value);

        if (!date) {
            return "—";
        }

        return new Intl.DateTimeFormat(
            CONFIG.locale,
            {
                year: "numeric",
                month: "short",
                day: "numeric",
                ...options
            }
        ).format(date);

    }


    function formatDateTime(value) {

        return formatDate(
            value,
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );

    }


    /* =====================================================
       التحقق من الخدمات
    ===================================================== */

    function getOrdersService() {

        const service = window.IBROrdersService;

        if (
            !service ||
            typeof service.fetchOrders !== "function"
        ) {
            throw new Error(
                "خدمة الطلبات IBROrdersService غير متاحة."
            );
        }

        return service;

    }


    function getMessagesService() {

        const service = window.IBRMessagesService;

        if (
            !service ||
            typeof service.fetchMessages !== "function"
        ) {
            throw new Error(
                "خدمة الرسائل IBRMessagesService غير متاحة."
            );
        }

        return service;

    }


    function getCustomersService() {

        const service = window.IBRCustomersService;

        if (!service) {
            return null;
        }

        return service;

    }


    function validateLimit(value) {

        const limit = Math.floor(
            toNumber(value, CONFIG.defaultLimit)
        );

        return Math.min(
            Math.max(limit, 1),
            CONFIG.maximumLimit
        );

    }


    /* =====================================================
       استخراج بيانات العملاء من سجلات الطلبات والرسائل
    ===================================================== */

    function getCustomerOrdersCount(customer) {

        const directCount = getField(
            customer,
            "nonCancelledOrders",
            "non_cancelled_orders",
            "ordersCount",
            "orders_count",
            "totalOrders",
            "total_orders",
            "ordersCount",
            "orders_count",
            "ordersCount"
        );

        if (hasValue(directCount)) {
            return toNumber(directCount);
        }

        const orders = getField(
            customer,
            "orders"
        );

        if (Array.isArray(orders)) {

            return orders.filter(
                order =>
                    getOrderStatus(order) !==
                    CONFIG.cancelledStatus
            ).length;

        }

        return 0;

    }


    function getCustomerSpent(customer) {

        const directValue = getField(
            customer,
            "nonCancelledOrderValue",
            "non_cancelled_order_value",
            "totalSpent",
            "total_spent",
            "totalSpentAmount",
            "total_spent_amount",
            "totalOrdersAmount",
            "total_orders_amount"
        );

        if (hasValue(directValue)) {
            return toNumber(directValue);
        }

        const orders = getField(
            customer,
            "orders"
        );

        if (Array.isArray(orders)) {

            return orders.reduce(
                (total, order) => {

                    if (
                        getOrderStatus(order) ===
                        CONFIG.cancelledStatus
                    ) {
                        return total;
                    }

                    return total + getOrderTotal(order);

                },
                0
            );

        }

        return 0;

    }


    function getCustomerLastActivity(customer) {

        return getField(
            customer,
            "lastActivityAt",
            "last_activity",
            "last_activity_at",
            "lastActivity",
            "updatedAt",
            "updated_at",
            "createdAt",
            "created_at"
        ) || null;

    }


    function getCustomerFirstActivity(customer) {

        return getField(
            customer,
            "firstActivityAt",
            "first_activity_at",
            "createdAt",
            "created_at"
        ) || null;

    }


    function getCustomerOrderArray(customer) {

        const orders = getField(
            customer,
            "orders"
        );

        return Array.isArray(orders)
            ? orders
            : [];

    }


    function getCustomerMessageArray(customer) {

        const messages = getField(
            customer,
            "messages"
        );

        return Array.isArray(messages)
            ? messages
            : [];

    }


    /* =====================================================
       نهاية الجزء الأول
       يتبع في الجزء الثاني:
       - بناء تقارير الطلبات.
       - بناء تقارير العملاء.
       - بناء تقارير الرسائل.
       - حساب العملاء الجدد والمتكررين.
    ===================================================== */

        /* =====================================================
       تقارير الطلبات
    ===================================================== */

    function buildOrdersReport(orders = []) {

        const report = {

            totalOrders: orders.length,

            activeOrders: 0,

            cancelledOrders: 0,

            newOrders: 0,

            contactingOrders: 0,

            confirmedOrders: 0,

            preparingOrders: 0,

            shippedOrders: 0,

            deliveredOrders: 0,

            totalSales: 0,

            cancelledValue: 0,

            averageOrderValue: 0,

            totalProducts: 0,

            ordersByStatus: {},

            dailySales: {},

            monthlySales: {}

        };


        orders.forEach(order => {

            const status = getOrderStatus(order);

            const total = getOrderTotal(order);

            report.ordersByStatus[status] =
                (report.ordersByStatus[status] || 0) + 1;


            if (status === CONFIG.cancelledStatus) {

                report.cancelledOrders++;

                report.cancelledValue += total;

                return;

            }


            report.activeOrders++;

            report.totalSales += total;


            switch (status) {

                case "new":
                    report.newOrders++;
                    break;

                case "contacting":
                    report.contactingOrders++;
                    break;

                case "confirmed":
                    report.confirmedOrders++;
                    break;

                case "preparing":
                    report.preparingOrders++;
                    break;

                case "shipped":
                    report.shippedOrders++;
                    break;

                case "delivered":
                    report.deliveredOrders++;
                    break;

            }


            const items = getOrderItems(order);

            items.forEach(item => {

                const quantity = toNumber(
                    getField(
                        item,
                        "quantity",
                        "qty"
                    ),
                    1
                );

                report.totalProducts += Math.max(
                    quantity,
                    0
                );

            });


            const createdAt = getField(
                order,
                "createdAt",
                "created_at"
            );

            const date = getDate(createdAt);

            if (!date) {
                return;
            }


            const dayKey = [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0"),
                String(date.getDate()).padStart(2, "0")
            ].join("-");


            const monthKey = [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0")
            ].join("-");


            if (!report.dailySales[dayKey]) {

                report.dailySales[dayKey] = {
                    orders: 0,
                    sales: 0
                };

            }


            report.dailySales[dayKey].orders++;

            report.dailySales[dayKey].sales += total;


            if (!report.monthlySales[monthKey]) {

                report.monthlySales[monthKey] = {
                    orders: 0,
                    sales: 0
                };

            }


            report.monthlySales[monthKey].orders++;

            report.monthlySales[monthKey].sales += total;

        });


        report.averageOrderValue =
            report.activeOrders > 0
                ? report.totalSales / report.activeOrders
                : 0;


        return report;

    }


    /* =====================================================
       تقارير العملاء
    ===================================================== */

    function buildCustomersReport(customers = []) {

        const report = {

            totalCustomers: customers.length,

            newCustomers: 0,

            returningCustomers: 0,

            customersWithoutOrders: 0,

            customersWithOrders: 0,

            totalOrders: 0,

            totalSpent: 0,

            averageSpentPerCustomer: 0,

            averageOrdersPerCustomer: 0,

            topCustomer: null,

            customersByActivity: {

                active: 0,

                inactive: 0

            }

        };


        let highestSpent = -1;


        customers.forEach(customer => {

            const ordersCount =
                getCustomerOrdersCount(customer);

            const spent =
                getCustomerSpent(customer);


            report.totalOrders += ordersCount;

            report.totalSpent += spent;


            if (ordersCount === 0) {

                report.customersWithoutOrders++;

            } else {

                report.customersWithOrders++;

                if (ordersCount === 1) {
                    report.newCustomers++;
                }

                if (ordersCount > 1) {
                    report.returningCustomers++;
                }

            }


            if (spent > highestSpent) {

                highestSpent = spent;

                report.topCustomer = customer;

            }


            const lastActivity = getTimestamp(
                getCustomerLastActivity(customer)
            );


            if (lastActivity) {

                const daysSinceActivity =
                    (Date.now() - lastActivity) /
                    (1000 * 60 * 60 * 24);


                if (daysSinceActivity <= 90) {

                    report.customersByActivity.active++;

                } else {

                    report.customersByActivity.inactive++;

                }

            } else {

                report.customersByActivity.inactive++;

            }

        });


        report.averageSpentPerCustomer =
            report.totalCustomers > 0
                ? report.totalSpent / report.totalCustomers
                : 0;


        report.averageOrdersPerCustomer =
            report.customersWithOrders > 0
                ? report.totalOrders /
                  report.customersWithOrders
                : 0;


        return report;

    }


    /* =====================================================
       تقارير الرسائل والاستفسارات
    ===================================================== */

    function buildMessagesReport(messages = []) {

        const report = {

            totalMessages: messages.length,

            newMessages: 0,

            inReviewMessages: 0,

            answeredMessages: 0,

            closedMessages: 0,

            complaints: 0,

            inquiries: 0,

            suggestions: 0,

            otherMessages: 0,

            messagesByStatus: {},

            messagesByType: {},

            dailyMessages: {}

        };


        messages.forEach(message => {

            const status = String(
                getField(
                    message,
                    "status"
                ) || "new"
            ).toLowerCase().trim();


            const type = String(
                getField(
                    message,
                    "messageType",
                    "message_type",
                    "type"
                ) || "other"
            ).toLowerCase().trim();


            report.messagesByStatus[status] =
                (report.messagesByStatus[status] || 0) + 1;


            report.messagesByType[type] =
                (report.messagesByType[type] || 0) + 1;


            switch (status) {

                case "new":
                    report.newMessages++;
                    break;

                case "in_review":
                    report.inReviewMessages++;
                    break;

                case "answered":
                    report.answeredMessages++;
                    break;

                case "closed":
                    report.closedMessages++;
                    break;

            }


            switch (type) {

                case "complaint":
                    report.complaints++;
                    break;

                case "inquiry":
                case "product_inquiry":
                    report.inquiries++;
                    break;

                case "suggestion":
                    report.suggestions++;
                    break;

                default:
                    report.otherMessages++;
                    break;

            }


            const createdAt = getField(
                message,
                "createdAt",
                "created_at"
            );

            const date = getDate(createdAt);

            if (!date) {
                return;
            }


            const dayKey = [
                date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, "0"),
                String(date.getDate()).padStart(2, "0")
            ].join("-");


            if (!report.dailyMessages[dayKey]) {

                report.dailyMessages[dayKey] = {
                    total: 0,
                    complaints: 0,
                    inquiries: 0
                };

            }


            report.dailyMessages[dayKey].total++;


            if (type === "complaint") {
                report.dailyMessages[dayKey].complaints++;
            }


            if (
                type === "inquiry" ||
                type === "product_inquiry"
            ) {
                report.dailyMessages[dayKey].inquiries++;
            }

        });


        return report;

    }


    /* =====================================================
       ترتيب العملاء حسب قيمة مشترياتهم
    ===================================================== */

    function getTopCustomers(
        customers = [],
        limit = 10
    ) {

        const safeLimit = Math.min(
            Math.max(
                Math.floor(toNumber(limit, 10)),
                1
            ),
            CONFIG.maximumTopResults
        );


        return [...customers]

            .sort((a, b) => {

                return (
                    getCustomerSpent(b) -
                    getCustomerSpent(a)
                );

            })

            .slice(0, safeLimit)

            .map(customer => ({

                name: getCustomerName(customer),

                phone: getCustomerPhone(customer),

                email: getCustomerEmail(customer),

                totalOrders: getCustomerOrdersCount(customer),

                totalSpent: getCustomerSpent(customer),

                lastActivity: getCustomerLastActivity(customer),

                customer

            }));

    }


    /* =====================================================
       ترتيب العملاء حسب النشاط
    ===================================================== */

    function getMostActiveCustomers(
        customers = [],
        limit = 10
    ) {

        const safeLimit = Math.min(
            Math.max(
                Math.floor(toNumber(limit, 10)),
                1
            ),
            CONFIG.maximumTopResults
        );


        return [...customers]

            .sort((a, b) => {

                const activityA = getTimestamp(
                    getCustomerLastActivity(a)
                );

                const activityB = getTimestamp(
                    getCustomerLastActivity(b)
                );


                if (activityA !== activityB) {
                    return activityB - activityA;
                }


                return (
                    getCustomerOrdersCount(b) -
                    getCustomerOrdersCount(a)
                );

            })

            .slice(0, safeLimit)

            .map(customer => ({

                name: getCustomerName(customer),

                phone: getCustomerPhone(customer),

                totalOrders: getCustomerOrdersCount(customer),

                totalSpent: getCustomerSpent(customer),

                lastActivity: getCustomerLastActivity(customer),

                customer

            }));

    }


    /* =====================================================
       نهاية الجزء الثاني

       يتبع في الجزء الثالث:
       - تحليل المنتجات الأكثر مبيعاً.
       - بناء بيانات العملاء.
       - فلترة التقارير بالتاريخ.
       - جلب البيانات من الخدمات.
       - معالجة حدود البيانات.
    ===================================================== */

        /* =====================================================
       المنتجات الأكثر مبيعاً
    ===================================================== */

    function getTopProducts(
        orders = [],
        limit = 10
    ) {

        const safeLimit = Math.min(
            Math.max(
                Math.floor(toNumber(limit, 10)),
                1
            ),
            CONFIG.maximumTopResults
        );


        const products = new Map();


        orders.forEach((order, orderIndex) => {

            if (
                getOrderStatus(order) ===
                CONFIG.cancelledStatus
            ) {
                return;
            }


            const items = getOrderItems(order);


            items.forEach((item, itemIndex) => {

                const productId = String(
                    getField(
                        item,
                        "productId",
                        "product_id",
                        "id",
                        "productSku",
                        "product_sku",
                        "sku",
                        "productName",
                        "product_name",
                        "name"
                    ) || `unknown-${orderIndex}-${itemIndex}`
                );


                const productName = String(
                    getField(
                        item,
                        "productName",
                        "product_name",
                        "name",
                        "title"
                    ) || "منتج غير محدد"
                );


                const sku = String(
                    getField(
                        item,
                        "productSku",
                        "product_sku",
                        "sku"
                    ) || ""
                );


                const quantity = Math.max(
                    toNumber(
                        getField(item, "quantity", "qty"),
                        1
                    ),
                    0
                );


                const unitPrice = Math.max(
                    toNumber(
                        getField(
                            item,
                            "unitPrice",
                            "unit_price",
                            "price"
                        )
                    ),
                    0
                );


                const lineTotalValue = getField(
                    item,
                    "lineTotal",
                    "line_total",
                    "total"
                );


                const revenue = hasValue(lineTotalValue)
                    ? Math.max(toNumber(lineTotalValue), 0)
                    : unitPrice * quantity;


                if (!products.has(productId)) {

                    products.set(productId, {

                        productId,

                        name: productName,

                        sku,

                        quantity: 0,

                        revenue: 0,

                        orderIds: new Set(),

                        imageUrl: getField(
                            item,
                            "productImageUrl",
                            "product_image_url",
                            "imageUrl",
                            "image_url"
                        ) || null

                    });

                }


                const product = products.get(productId);

                product.quantity += quantity;

                product.revenue += revenue;


                const orderId = getField(
                    order,
                    "id",
                    "orderId",
                    "order_id",
                    "orderNumber",
                    "order_number"
                );


                // كل طلب دون معرف موثوق يعامل كسجل مستقل.

                product.orderIds.add(
                    hasValue(orderId)
                        ? String(orderId)
                        : `record-${orderIndex}`
                );


                if (!product.imageUrl) {

                    product.imageUrl = getField(
                        item,
                        "productImageUrl",
                        "product_image_url",
                        "imageUrl",
                        "image_url"
                    ) || null;

                }

            });

        });


        return Array.from(products.values())

            .map(product => ({

                productId: product.productId,

                name: product.name,

                sku: product.sku,

                quantity: product.quantity,

                revenue: product.revenue,

                orderCount: product.orderIds.size,

                imageUrl: product.imageUrl

            }))

            .sort((a, b) => {

                if (b.quantity !== a.quantity) {
                    return b.quantity - a.quantity;
                }

                return b.revenue - a.revenue;

            })

            .slice(0, safeLimit);

    }


    /* =====================================================
       بناء بيانات العملاء من الخدمات المتاحة
    ===================================================== */

    function buildCustomersFromOrdersAndMessages(
        orders = [],
        messages = []
    ) {

        const customersService = getCustomersService();


        if (
            customersService &&
            typeof customersService.buildCustomers === "function"
        ) {

            const normalizedOrders = orders.map(order => {

                if (
                    typeof customersService.normalizeOrder ===
                    "function"
                ) {
                    return customersService.normalizeOrder(order);
                }

                return order;

            });


            const normalizedMessages = messages.map(message => {

                if (
                    typeof customersService.normalizeMessage ===
                    "function"
                ) {
                    return customersService.normalizeMessage(message);
                }

                return message;

            });


            const customers = customersService.buildCustomers(
                normalizedOrders,
                normalizedMessages
            );


            if (Array.isArray(customers)) {
                return customers;
            }

        }


        // بديل مستقل عند عدم توفر خدمة العملاء.

        const customersMap = new Map();


        function getOrCreateCustomer(record, source, index) {

            const phone = getCustomerPhone(record);

            const email = getCustomerEmail(record);

            const identity = phone
                ? `phone:${phone}`
                : email
                    ? `email:${email}`
                    : `${source}:${getField(record, "id") || index}`;


            if (!customersMap.has(identity)) {

                customersMap.set(identity, {

                    name: getCustomerName(record),

                    phone,

                    email,

                    orders: [],

                    messages: [],

                    ordersCount: 0,

                    totalOrders: 0,

                    nonCancelledOrderValue: 0,

                    total_spent: 0,

                    lastActivityAt: null,

                    firstActivityAt: null

                });

            }


            return customersMap.get(identity);

        }


        function updateActivity(customer, value) {

            const timestamp = getTimestamp(value);

            if (!timestamp) {
                return;
            }


            const currentFirst = getTimestamp(
                customer.firstActivityAt
            );

            const currentLast = getTimestamp(
                customer.lastActivityAt
            );


            if (!currentFirst || timestamp < currentFirst) {
                customer.firstActivityAt = value;
            }


            if (!currentLast || timestamp > currentLast) {
                customer.lastActivityAt = value;
            }

        }


        orders.forEach((order, index) => {

            const customer = getOrCreateCustomer(
                order,
                "order",
                index
            );


            customer.orders.push(order);

            customer.totalOrders++;


            if (
                getOrderStatus(order) !==
                CONFIG.cancelledStatus
            ) {

                customer.ordersCount++;

                customer.nonCancelledOrderValue +=
                    getOrderTotal(order);

                customer.total_spent =
                    customer.nonCancelledOrderValue;

            }


            updateActivity(
                customer,
                getField(
                    order,
                    "createdAt",
                    "created_at"
                )
            );

        });


        messages.forEach((message, index) => {

            const customer = getOrCreateCustomer(
                message,
                "message",
                index
            );


            customer.messages.push(message);


            updateActivity(
                customer,
                getField(
                    message,
                    "createdAt",
                    "created_at"
                )
            );

        });


        return Array.from(customersMap.values());

    }


    /* =====================================================
       فلترة البيانات حسب الفترة الزمنية
    ===================================================== */

    function filterByDateRange(
        records = [],
        options = {}
    ) {

        if (!Array.isArray(records)) {
            return [];
        }


        const fromValue = getField(
            options,
            "from",
            "startDate",
            "start_date"
        );


        const toValue = getField(
            options,
            "to",
            "endDate",
            "end_date"
        );


        const fromDate = hasValue(fromValue)
            ? getDate(fromValue)
            : null;


        const toDate = hasValue(toValue)
            ? getDate(toValue)
            : null;


        if (hasValue(fromValue) && !fromDate) {

            throw new Error(
                "تاريخ بداية الفترة غير صالح."
            );

        }


        if (hasValue(toValue) && !toDate) {

            throw new Error(
                "تاريخ نهاية الفترة غير صالح."
            );

        }


        if (
            fromDate &&
            toDate &&
            fromDate.getTime() > toDate.getTime()
        ) {

            throw new Error(
                "تاريخ البداية يجب أن يسبق تاريخ النهاية."
            );

        }


        let startTimestamp = fromDate
            ? fromDate.getTime()
            : -Infinity;


        let endTimestamp = toDate
            ? toDate.getTime()
            : Infinity;


        // إذا كان تاريخ النهاية بدون وقت، يشمل اليوم كاملاً.

        if (
            toDate &&
            typeof toValue === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(toValue)
        ) {

            const endOfDay = new Date(toDate);

            endOfDay.setHours(23, 59, 59, 999);

            endTimestamp = endOfDay.getTime();

        }


        return records.filter(record => {

            const dateValue = getField(
                record,
                "createdAt",
                "created_at",
                "date"
            );


            const timestamp = getTimestamp(dateValue);


            if (!timestamp) {
                return false;
            }


            return (
                timestamp >= startTimestamp &&
                timestamp <= endTimestamp
            );

        });

    }


    /* =====================================================
       تجهيز البيانات الموحدة للتقارير
    ===================================================== */

    async function fetchReportData(options = {}) {

        const ordersService = getOrdersService();

        const messagesService = getMessagesService();


        const limit = validateLimit(
            options.limit
        );


        const results = await Promise.allSettled([

            ordersService.fetchOrders({
                limit
            }),

            messagesService.fetchMessages({
                limit
            })

        ]);


        const ordersResult = results[0];

        const messagesResult = results[1];


        if (ordersResult.status === "rejected") {

            throw new Error(
                "تعذر جلب بيانات الطلبات: " +
                safeErrorMessage(ordersResult.reason)
            );

        }


        if (messagesResult.status === "rejected") {

            throw new Error(
                "تعذر جلب بيانات الرسائل: " +
                safeErrorMessage(messagesResult.reason)
            );

        }


        const rawOrders = Array.isArray(ordersResult.value)
            ? ordersResult.value
            : [];


        const rawMessages = Array.isArray(messagesResult.value)
            ? messagesResult.value
            : [];


        const customersService = getCustomersService();


        const orders = rawOrders.map(order => {

            if (
                customersService &&
                typeof customersService.normalizeOrder ===
                "function"
            ) {
                return customersService.normalizeOrder(order);
            }

            return order;

        });


        const messages = rawMessages.map(message => {

            if (
                customersService &&
                typeof customersService.normalizeMessage ===
                "function"
            ) {
                return customersService.normalizeMessage(message);
            }

            return message;

        });


        return {

            orders,

            messages,

            limit,

            ordersMayBeLimited: rawOrders.length >= limit,

            messagesMayBeLimited: rawMessages.length >= limit,

            fetchedAt: new Date().toISOString()

        };

    }


    /* =====================================================
       رسائل الأخطاء الآمنة
    ===================================================== */

    function safeErrorMessage(error) {

        if (!error) {
            return "خطأ غير معروف";
        }


        const message = String(
            error.message ||
            error.details ||
            error.hint ||
            error
        );


        return message
            .replace(/<[^>]*>/g, "")
            .replace(/[\r\n\t]+/g, " ")
            .slice(0, 400);

    }


    /* =====================================================
       نهاية الجزء الثالث

       يتبع في الجزء الرابع:
       - generateReport.
       - تصدير CSV آمن.
       - تنزيل التقارير.
       - API النهائي.
       - إغلاق الخدمة.
    ===================================================== */

    /* =====================================================
       إنشاء التقرير الشامل
    ===================================================== */

    async function generateReport(options = {}) {

        const data = await fetchReportData(options);


        const filteredOrders = filterByDateRange(
            data.orders,
            options
        );


        const filteredMessages = filterByDateRange(
            data.messages,
            options
        );


        const customers = buildCustomersFromOrdersAndMessages(
            filteredOrders,
            filteredMessages
        );


        const ordersReport = buildOrdersReport(
            filteredOrders
        );


        const customersReport = buildCustomersReport(
            customers
        );


        const messagesReport = buildMessagesReport(
            filteredMessages
        );


        const topCustomers = getTopCustomers(
            customers,
            options.topLimit || 10
        );


        const mostActiveCustomers = getMostActiveCustomers(
            customers,
            options.topLimit || 10
        );


        const topProducts = getTopProducts(
            filteredOrders,
            options.topLimit || 10
        );


        return {

            success: true,

            version: CONFIG.version,

            generatedAt: new Date().toISOString(),

            period: {

                from: getField(
                    options,
                    "from",
                    "startDate",
                    "start_date"
                ) || null,

                to: getField(
                    options,
                    "to",
                    "endDate",
                    "end_date"
                ) || null

            },


            coverage: {

                limit: data.limit,

                ordersFetched: data.orders.length,

                messagesFetched: data.messages.length,

                ordersIncluded: filteredOrders.length,

                messagesIncluded: filteredMessages.length,

                ordersMayBeLimited: data.ordersMayBeLimited,

                messagesMayBeLimited: data.messagesMayBeLimited,

                possiblyIncomplete:
                    data.ordersMayBeLimited ||
                    data.messagesMayBeLimited,

                warning:
                    data.ordersMayBeLimited ||
                    data.messagesMayBeLimited
                        ? "وصل جلب البيانات إلى الحد الأقصى؛ قد تكون بعض السجلات غير مشمولة."
                        : null

            },


            summary: {

                totalOrders: ordersReport.totalOrders,

                activeOrders: ordersReport.activeOrders,

                cancelledOrders: ordersReport.cancelledOrders,

                totalSales: ordersReport.totalSales,

                averageOrderValue: ordersReport.averageOrderValue,

                totalCustomers: customersReport.totalCustomers,

                returningCustomers:
                    customersReport.returningCustomers,

                totalMessages: messagesReport.totalMessages,

                pendingMessages:
                    messagesReport.newMessages +
                    messagesReport.inReviewMessages

            },


            orders: ordersReport,

            customers: customersReport,

            messages: messagesReport,

            topCustomers,

            mostActiveCustomers,

            topProducts,

            customersList: customers,

            ordersList: filteredOrders,

            messagesList: filteredMessages

        };

    }


    /* =====================================================
       إنشاء CSV آمن
    ===================================================== */

    function escapeCSV(value) {

        if (value === null || value === undefined) {
            return '""';
        }


        let textValue = String(value);


        // حماية النصوص فقط من Formula Injection.
        // القيم الرقمية الحقيقية تبقى قابلة للتحليل في Excel.

        if (
            typeof value === "string" &&
            /^[\s]*[=+\-@\t\r]/.test(textValue)
        ) {

            textValue = "'" + textValue;

        }


        textValue = textValue
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");


        return '"' +
            textValue.replace(/"/g, '""') +
            '"';

    }


    function convertToCSV(
        rows = [],
        columns = []
    ) {

        if (!Array.isArray(rows)) {
            throw new Error("بيانات التصدير غير صالحة.");
        }


        if (!Array.isArray(columns) || !columns.length) {
            throw new Error("يجب تحديد أعمدة التصدير.");
        }


        if (rows.length > CONFIG.maximumExportRows) {

            throw new Error(
                "عدد السجلات يتجاوز الحد المسموح للتصدير."
            );

        }


        const header = columns.map(column => {

            return escapeCSV(
                column.label || column.key
            );

        });


        const body = rows.map(row => {

            return columns.map(column => {

                let value = row;

                const path = String(
                    column.key || ""
                ).split(".");


                for (const key of path) {

                    value = value && value[key] !== undefined
                        ? value[key]
                        : "";

                }


                if (typeof column.format === "function") {

                    value = column.format(
                        value,
                        row
                    );

                }


                return escapeCSV(value);

            });

        });


        return [
            header.join(CONFIG.csvSeparator),

            ...body.map(row =>
                row.join(CONFIG.csvSeparator)
            )

        ].join("\r\n");

    }


    /* =====================================================
       تجهيز BOM للغة العربية
    ===================================================== */

    function addCSVBom(csv) {

        return "\uFEFF" + String(csv || "");

    }


    /* =====================================================
       تنزيل ملف CSV
    ===================================================== */

    function downloadCSV(
        csv,
        filename = "ibr20-report.csv"
    ) {

        if (typeof document === "undefined") {

            throw new Error(
                "التنزيل غير متاح في هذه البيئة."
            );

        }


        const safeFilename = String(filename)

            .replace(/[\\/:*?"<>|]/g, "_")

            .replace(/[\r\n]/g, "")

            .trim()

            .slice(0, 120) || "ibr20-report.csv";


        const finalFilename = safeFilename.toLowerCase().endsWith(".csv")
            ? safeFilename
            : `${safeFilename}.csv`;


        const blob = new Blob(
            [
                addCSVBom(csv)
            ],
            {
                type: "text/csv;charset=utf-8;"
            }
        );


        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");


        link.href = url;

        link.download = finalFilename;

        link.style.display = "none";


        document.body.appendChild(link);

        link.click();

        link.remove();


        window.setTimeout(() => {

            URL.revokeObjectURL(url);

        }, 1000);


        return {

            success: true,

            filename: finalFilename

        };

    }


    /* =====================================================
       تصدير تقرير العملاء
    ===================================================== */

    function exportCustomersCSV(customers = []) {

        const rows = customers.map(customer => ({

            name: getCustomerName(customer),

            phone: getCustomerPhone(customer),

            email: getCustomerEmail(customer),

            orders: getCustomerOrdersCount(customer),

            spent: getCustomerSpent(customer),

            firstActivity: getCustomerFirstActivity(customer),

            lastActivity: getCustomerLastActivity(customer)

        }));


        const csv = convertToCSV(
            rows,
            [
                {
                    key: "name",
                    label: "اسم العميل"
                },
                {
                    key: "phone",
                    label: "رقم الجوال"
                },
                {
                    key: "email",
                    label: "البريد الإلكتروني"
                },
                {
                    key: "orders",
                    label: "عدد الطلبات غير الملغاة"
                },
                {
                    key: "spent",
                    label: "قيمة الطلبات غير الملغاة"
                },
                {
                    key: "firstActivity",
                    label: "أول نشاط"
                },
                {
                    key: "lastActivity",
                    label: "آخر نشاط"
                }
            ]
        );


        return downloadCSV(
            csv,
            "ibr20-customers-report.csv"
        );

    }


    /* =====================================================
       تصدير تقرير الطلبات
    ===================================================== */

    function exportOrdersCSV(orders = []) {

        const rows = orders.map(order => ({

            orderNumber: getField(
                order,
                "orderNumber",
                "order_number"
            ) || "",

            customerName: getCustomerName(order),

            customerPhone: getCustomerPhone(order),

            status: ORDER_STATUSES[getOrderStatus(order)] ||
                getOrderStatus(order),

            subtotal: toNumber(
                getField(
                    order,
                    "subtotal"
                )
            ),

            shippingFee: toNumber(
                getField(
                    order,
                    "shippingFee",
                    "shipping_fee"
                )
            ),

            total: getOrderTotal(order),

            paymentMethod: getField(
                order,
                "paymentMethod",
                "payment_method"
            ) || "",

            createdAt: getField(
                order,
                "createdAt",
                "created_at"
            ) || ""

        }));


        const csv = convertToCSV(
            rows,
            [
                {
                    key: "orderNumber",
                    label: "رقم الطلب"
                },
                {
                    key: "customerName",
                    label: "اسم العميل"
                },
                {
                    key: "customerPhone",
                    label: "رقم الجوال"
                },
                {
                    key: "status",
                    label: "حالة الطلب"
                },
                {
                    key: "subtotal",
                    label: "مجموع المنتجات"
                },
                {
                    key: "shippingFee",
                    label: "رسوم الشحن"
                },
                {
                    key: "total",
                    label: "الإجمالي"
                },
                {
                    key: "paymentMethod",
                    label: "طريقة الدفع"
                },
                {
                    key: "createdAt",
                    label: "تاريخ الطلب"
                }
            ]
        );


        return downloadCSV(
            csv,
            "ibr20-orders-report.csv"
        );

    }


    /* =====================================================
       تصدير تقرير الرسائل
    ===================================================== */

    function exportMessagesCSV(messages = []) {

        const rows = messages.map(message => {

            const status = String(
                getField(message, "status") || "new"
            ).toLowerCase();


            const type = String(
                getField(
                    message,
                    "messageType",
                    "message_type"
                ) || "other"
            ).toLowerCase();


            return {

                customerName: getCustomerName(message),

                customerPhone: getCustomerPhone(message),

                subject: getField(
                    message,
                    "subject"
                ) || "",

                type: MESSAGE_TYPES[type] || type,

                status: MESSAGE_STATUSES[status] || status,

                createdAt: getField(
                    message,
                    "createdAt",
                    "created_at"
                ) || ""

            };

        });


        const csv = convertToCSV(
            rows,
            [
                {
                    key: "customerName",
                    label: "اسم العميل"
                },
                {
                    key: "customerPhone",
                    label: "رقم الجوال"
                },
                {
                    key: "subject",
                    label: "الموضوع"
                },
                {
                    key: "type",
                    label: "نوع الرسالة"
                },
                {
                    key: "status",
                    label: "الحالة"
                },
                {
                    key: "createdAt",
                    label: "تاريخ الرسالة"
                }
            ]
        );


        return downloadCSV(
            csv,
            "ibr20-messages-report.csv"
        );

    }


    /* =====================================================
       أدوات مساعدة للتقرير
    ===================================================== */

    function getCoverageWarning(report) {

        if (!report || !report.coverage) {
            return null;
        }

        return report.coverage.warning || null;

    }


    function getReportSummary(report) {

        if (!report || !report.summary) {
            return null;
        }

        return {

            ...report.summary,

            totalSalesFormatted: formatCurrency(
                report.summary.totalSales
            ),

            averageOrderValueFormatted: formatCurrency(
                report.summary.averageOrderValue
            )

        };

    }


    /* =====================================================
       API العام
    ===================================================== */

    window.IBRCustomerReports = Object.freeze({

        version: CONFIG.version,

        config: Object.freeze({
            ...CONFIG
        }),


        // إنشاء التقارير

        generateReport,

        fetchReportData,


        // بناء التقارير

        buildOrdersReport,

        buildCustomersReport,

        buildMessagesReport,

        buildCustomersFromOrdersAndMessages,


        // التحليلات

        getTopCustomers,

        getMostActiveCustomers,

        getTopProducts,


        // الفلترة

        filterByDateRange,


        // بيانات العملاء

        getCustomerOrdersCount,

        getCustomerSpent,

        getCustomerName,

        getCustomerPhone,

        getCustomerEmail,

        normalizePhone,


        // تنسيق البيانات

        formatNumber,

        formatCurrency,

        formatDate,

        formatDateTime,


        // CSV

        convertToCSV,

        escapeCSV,

        addCSVBom,

        downloadCSV,

        exportCustomersCSV,

        exportOrdersCSV,

        exportMessagesCSV,


        // أدوات مساعدة

        getCoverageWarning,

        getReportSummary,

        safeErrorMessage,


        // الحالات والتسميات

        orderStatuses: Object.freeze({
            ...ORDER_STATUSES
        }),

        messageStatuses: Object.freeze({
            ...MESSAGE_STATUSES
        }),

        messageTypes: Object.freeze({
            ...MESSAGE_TYPES
        })

    });


})();