/* =========================================================
   IBR20 — CUSTOMERS SERVICE
   خدمة تجميع وإدارة بيانات العملاء

   Version: 1.2.0

   مصادر البيانات:
   - orders عبر IBROrdersService
   - customer_messages مباشرة عبر Supabase

   لا يعتمد على جدول customers.

   التحديثات:
   1. توحيد جلب الطلبات عبر IBROrdersService.
   2. منع تكرار جلب تفاصيل order_items.
   3. الاحتفاظ بتفاصيل المنتجات داخل ملف العميل.
   4. توحيد نتائج الطلبات والرسائل بصيغة camelCase.
   5. دعم البحث والجلب المباشر بواسطة رقم الهاتف.
   6. تحسين تجميع العملاء دون رقم هاتف.
   7. توضيح قيمة الطلبات غير الملغاة.
========================================================= */

(() => {

    "use strict";


    /* =====================================================
       1. منع التكرار
    ===================================================== */

    if (window.IBRCustomersService) {

        console.warn(
            "IBRCustomersService already initialized."
        );

        return;

    }


    /* =====================================================
       2. الإعدادات
    ===================================================== */

    const CONFIG = Object.freeze({

        messagesTable: "customer_messages",

        defaultOrdersLimit: 500,

        defaultMessagesLimit: 500,

        maximumLimit: 1000

    });


    let supabaseClient = null;


    /* =====================================================
       3. حالات الطلبات
    ===================================================== */

    const ORDER_STATUS_LABELS = Object.freeze({

        new: "طلب جديد",

        contacting: "جارٍ التواصل",

        confirmed: "مؤكد",

        preparing: "قيد التجهيز",

        shipped: "تم الشحن",

        delivered: "تم التسليم",

        cancelled: "ملغي"

    });


    /* =====================================================
       4. حالات الرسائل
    ===================================================== */

    const MESSAGE_STATUS_LABELS = Object.freeze({

        new: "جديدة",

        in_review: "قيد المراجعة",

        answered: "تمت الإجابة",

        closed: "مغلقة"

    });


    /* =====================================================
       5. الحصول على اتصال Supabase
    ===================================================== */

    function getClient() {

        const client =

            supabaseClient ||

            window.supabaseClient ||

            window.IBRAdmin?.getClient?.();


        if (
            !client ||
            typeof client.from !== "function"
        ) {

            throw new Error(
                "اتصال Supabase غير متوفر. تحقق من تحميل store.js."
            );

        }


        return client;

    }


    /* =====================================================
       6. الحصول على خدمة الطلبات
    ===================================================== */

    function getOrdersService() {

        const service = window.IBROrdersService;


        if (
            !service ||
            typeof service.fetchOrders !== "function"
        ) {

            throw new Error(
                "خدمة الطلبات IBROrdersService غير محملة. تحقق من ترتيب ملفات JavaScript."
            );

        }


        return service;

    }


    /* =====================================================
       7. ربط الاتصال بالخدمات
    ===================================================== */

    function configure(options = {}) {

        if (options.client) {

            if (
                typeof options.client.from !== "function"
            ) {

                throw new Error(
                    "اتصال Supabase المرسل غير صالح."
                );

            }


            supabaseClient = options.client;


            /*
             * استخدام الاتصال نفسه في خدمة الطلبات.
             * لا يتم إنشاء اتصال جديد.
             */

            const ordersService =
                window.IBROrdersService;


            if (
                ordersService &&
                typeof ordersService.configure === "function"
            ) {

                ordersService.configure({

                    client: options.client

                });

            }

        }


        return true;

    }


    /* =====================================================
       8. تنظيف رقم الهاتف
    ===================================================== */

    function normalizePhone(phone) {

        if (
            phone === null ||
            phone === undefined
        ) {

            return "";

        }


        let value = String(phone).replace(
            /\D/g,
            ""
        );


        if (value.startsWith("00966")) {

            value = value.slice(5);

        } else if (value.startsWith("966")) {

            value = value.slice(3);

        }


        if (value.startsWith("0")) {

            value = value.slice(1);

        }


        return value;

    }


    /* =====================================================
       9. تنسيق رقم الهاتف
    ===================================================== */

    function formatPhone(phone) {

        const normalized = normalizePhone(phone);


        if (!normalized) {
            return "—";
        }


        if (
            normalized.startsWith("5") &&
            normalized.length === 9
        ) {

            return (

                "+966 " +

                normalized.slice(0, 2) +

                " " +

                normalized.slice(2, 5) +

                " " +

                normalized.slice(5)

            );

        }


        return "+" + normalized;

    }


    /* =====================================================
       10. أدوات مساعدة
    ===================================================== */

    function cleanText(value) {

        if (
            value === null ||
            value === undefined
        ) {

            return "";

        }


        return String(value).trim();

    }


    function toNumber(value) {

        const number = Number(value);


        return Number.isFinite(number)
            ? number
            : 0;

    }


    function getTimestamp(value) {

        if (!value) {
            return 0;
        }


        const timestamp = new Date(value).getTime();


        return Number.isFinite(timestamp)
            ? timestamp
            : 0;

    }


    function sortByDate(records, field = "createdAt") {

        return [...records].sort((a, b) => {

            return (

                getTimestamp(b[field]) -

                getTimestamp(a[field])

            );

        });

    }


    function getLimit(value, fallback) {

        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {

            return fallback;

        }


        const limit = Number(value);


        if (
            !Number.isFinite(limit) ||
            limit <= 0
        ) {

            return fallback;

        }


        return Math.min(

            Math.floor(limit),

            CONFIG.maximumLimit

        );

    }


    /* =====================================================
       11. تجهيز تفاصيل المنتج
    ===================================================== */

    function normalizeOrderItem(item = {}) {

        return {

            ...item,

            id: item.id || null,

            orderId:
                item.orderId ||
                item.order_id ||
                null,

            productId:
                item.productId ||
                item.product_id ||
                null,

            productName:
                cleanText(
                    item.productName ||
                    item.product_name
                ),

            productSku:
                cleanText(
                    item.productSku ||
                    item.product_sku
                ),

            productImageUrl:
                item.productImageUrl ||
                item.product_image_url ||
                null,

            unitPrice: toNumber(
                item.unitPrice ??
                item.unit_price
            ),

            quantity: toNumber(
                item.quantity
            ),

            lineTotal: toNumber(
                item.lineTotal ??
                item.line_total
            ),

            productSnapshot:
                item.productSnapshot ||
                item.product_snapshot ||
                {},

            createdAt:
                item.createdAt ||
                item.created_at ||
                null

        };

    }


    /* =====================================================
       12. تجهيز سجل الطلب
       النتيجة تستخدم camelCase
    ===================================================== */

    function normalizeOrder(order = {}) {

        const items = Array.isArray(order.items)

            ? order.items.map(normalizeOrderItem)

            : [];


        const itemsCount = items.reduce(

            (total, item) => {

                return total + item.quantity;

            },

            0

        );


        const status = order.status || "new";


        return {

            id: order.id || null,

            orderNumber: cleanText(
                order.orderNumber ||
                order.order_number
            ),

            customerName: cleanText(
                order.customerName ||
                order.customer_name
            ),

            customerPhone: cleanText(
                order.customerPhone ||
                order.customer_phone
            ),

            normalizedPhone: normalizePhone(
                order.customerPhone ||
                order.customer_phone
            ),

            city: cleanText(order.city),

            neighborhood: cleanText(
                order.neighborhood
            ),

            address: cleanText(order.address),

            customerNote: cleanText(
                order.customerNote ||
                order.customer_note
            ),

            status,

            statusLabel:
                ORDER_STATUS_LABELS[status] ||
                order.statusLabel ||
                "حالة غير معروفة",

            subtotal: toNumber(
                order.subtotal
            ),

            shippingFee: toNumber(
                order.shippingFee ??
                order.shipping_fee
            ),

            totalAmount: toNumber(
                order.totalAmount ??
                order.total_amount
            ),

            paymentMethod:
                order.paymentMethod ||
                order.payment_method ||
                "cod",

            createdAt:
                order.createdAt ||
                order.created_at ||
                null,

            updatedAt:
                order.updatedAt ||
                order.updated_at ||
                null,

            expectedDeliveryDate:
                order.expectedDeliveryDate ||
                order.expected_delivery_date ||
                null,

            deliveredAt:
                order.deliveredAt ||
                order.delivered_at ||
                null,

            adminNote: cleanText(
                order.adminNote ||
                order.admin_note
            ),

            items,

            itemsCount: toNumber(
                order.itemsCount ??
                order.items_count ??
                itemsCount
            ),

            productsCount: toNumber(
                order.productsCount ??
                order.products_count ??
                items.length
            )

        };

    }


    /* =====================================================
       13. تجهيز سجل الرسالة
       النتيجة تستخدم camelCase
    ===================================================== */

    function normalizeMessage(message = {}) {

        const status = message.status || "new";


        return {

            id: message.id || null,

            customerName: cleanText(
                message.customer_name
            ),

            customerPhone: cleanText(
                message.customer_phone
            ),

            normalizedPhone: normalizePhone(
                message.customer_phone
            ),

            customerEmail: cleanText(
                message.customer_email
            ),

            messageType:
                message.message_type ||
                "general",

            subject: cleanText(
                message.subject
            ),

            message: cleanText(
                message.message
            ),

            status,

            statusLabel:
                MESSAGE_STATUS_LABELS[status] ||
                "حالة غير معروفة",

            productId:
                message.product_id ||
                null,

            productName: cleanText(
                message.product_name
            ),

            productSku: cleanText(
                message.product_sku
            ),

            productImageUrl:
                message.product_image_url ||
                null,

            inquiryNumber:
                message.inquiry_number ||
                null,

            createdAt:
                message.created_at ||
                null,

            updatedAt:
                message.updated_at ||
                null,

            adminNote: cleanText(
                message.admin_note
            ),

            customerReply: cleanText(
                message.customer_reply
            ),

            customerReplyAt:
                message.customer_reply_at ||
                null

        };

    }


    /* =====================================================
       14. جلب الطلبات عبر IBROrdersService

       مهم:
       لا يوجد استعلام مباشر هنا على جدول orders.
       خدمة الطلبات هي المصدر الوحيد للطلبات والتفاصيل.
    ===================================================== */

    async function fetchOrders(options = {}) {

        const ordersService = getOrdersService();


        const limit = getLimit(

            options.limit,

            CONFIG.defaultOrdersLimit

        );


        const serviceOptions = {

            limit

        };


        if (options.status) {

            serviceOptions.status = options.status;

        }


        if (options.id) {

            serviceOptions.id = options.id;

        }


        if (options.orderNumber) {

            serviceOptions.orderNumber =
                options.orderNumber;

        }


        if (options.customerPhone) {

            serviceOptions.customerPhone =
                options.customerPhone;

        }


        const orders = await ordersService.fetchOrders(
            serviceOptions
        );


        return Array.isArray(orders)

            ? orders.map(normalizeOrder)

            : [];

    }


    /* =====================================================
       15. جلب الرسائل
    ===================================================== */

    async function fetchMessages(options = {}) {

        const client = getClient();


        const limit = getLimit(

            options.limit,

            CONFIG.defaultMessagesLimit

        );


        let query = client

            .from(CONFIG.messagesTable)

            .select([

                "id",

                "customer_name",

                "customer_phone",

                "customer_email",

                "message_type",

                "subject",

                "message",

                "status",

                "product_id",

                "product_name",

                "product_sku",

                "product_image_url",

                "inquiry_number",

                "created_at",

                "updated_at",

                "admin_note",

                "customer_reply",

                "customer_reply_at"

            ].join(","))

            .order("created_at", {

                ascending: false

            })

            .limit(limit);


        if (options.status) {

            query = query.eq(
                "status",
                options.status
            );

        }


        if (options.id) {

            query = query.eq(
                "id",
                options.id
            );

        }


        if (options.customerPhone) {

            query = query.eq(
                "customer_phone",
                options.customerPhone
            );

        }


        const { data, error } = await query;


        if (error) {

            console.error(
                "[IBRCustomersService] Messages loading error:",
                error
            );


            throw new Error(
                "تعذر تحميل رسائل العملاء: " +
                error.message
            );

        }


        return (data || []).map(normalizeMessage);

    }


    /* =====================================================
       16. تجميع العملاء
    ===================================================== */

    function buildCustomers(
        orders = [],
        messages = []
    ) {

        const customersMap = new Map();


        function getOrCreateCustomer(
            record,
            source,
            index
        ) {

            const phone = normalizePhone(
                record.customerPhone
            );


            /*
             * العملاء أصحاب رقم الهاتف نفسه
             * يتم تجميعهم في ملف واحد.
             *
             * السجلات بدون هاتف لا يتم دمجها
             * مع سجلات أخرى مجهولة.
             */

            const key = phone

                ? `phone:${phone}`

                : `record:${source}:${record.id || index}`;


            if (!customersMap.has(key)) {

                customersMap.set(key, {

                    id: key,

                    name:
                        record.customerName ||
                        "عميل بدون اسم",

                    phone:
                        record.customerPhone ||
                        "",

                    normalizedPhone: phone,

                    email:
                        record.customerEmail ||
                        "",

                    city:
                        record.city ||
                        "",

                    neighborhood:
                        record.neighborhood ||
                        "",

                    address:
                        record.address ||
                        "",

                    orders: [],

                    messages: [],

                    ordersCount: 0,

                    messagesCount: 0,

                    nonCancelledOrderValue: 0,

                    // اسم قديم للتوافق
                    totalOrdersAmount: 0,

                    completedOrdersCount: 0,

                    cancelledOrdersCount: 0,

                    lastOrderAt: null,

                    lastMessageAt: null,

                    lastActivityAt: null,

                    firstActivityAt: null,

                    createdAt: null

                });

            }


            return customersMap.get(key);

        }


        /* =================================================
           إضافة الطلبات
        ================================================= */

        orders.forEach((order, index) => {

            const customer = getOrCreateCustomer({

                id: order.id,

                customerName: order.customerName,

                customerPhone: order.customerPhone,

                city: order.city,

                neighborhood: order.neighborhood,

                address: order.address

            }, "order", index);


            customer.orders.push(order);

            customer.ordersCount++;


            if (order.status === "delivered") {

                customer.completedOrdersCount++;

            }


            if (order.status === "cancelled") {

                customer.cancelledOrdersCount++;

            } else {

                customer.nonCancelledOrderValue +=
                    toNumber(order.totalAmount);

            }


            const orderTime = getTimestamp(
                order.createdAt
            );


            if (

                !customer.lastOrderAt ||

                orderTime >
                getTimestamp(customer.lastOrderAt)

            ) {

                customer.lastOrderAt =
                    order.createdAt;

            }


            if (

                !customer.createdAt ||

                orderTime <
                getTimestamp(customer.createdAt)

            ) {

                customer.createdAt =
                    order.createdAt;

            }


            if (!customer.city && order.city) {

                customer.city = order.city;

            }


            if (
                !customer.neighborhood &&
                order.neighborhood
            ) {

                customer.neighborhood =
                    order.neighborhood;

            }


            if (!customer.address && order.address) {

                customer.address =
                    order.address;

            }

        });


        /* =================================================
           إضافة الرسائل
        ================================================= */

        messages.forEach((message, index) => {

            const customer = getOrCreateCustomer({

                id: message.id,

                customerName: message.customerName,

                customerPhone: message.customerPhone,

                customerEmail: message.customerEmail

            }, "message", index);


            customer.messages.push(message);

            customer.messagesCount++;


            if (
                !customer.email &&
                message.customerEmail
            ) {

                customer.email =
                    message.customerEmail;

            }


            const messageTime = getTimestamp(
                message.createdAt
            );


            if (

                !customer.lastMessageAt ||

                messageTime >
                getTimestamp(customer.lastMessageAt)

            ) {

                customer.lastMessageAt =
                    message.createdAt;

            }


            if (

                !customer.createdAt ||

                messageTime <
                getTimestamp(customer.createdAt)

            ) {

                customer.createdAt =
                    message.createdAt;

            }

        });


        /* =================================================
           حساب النشاط وترتيب السجلات
        ================================================= */

        const customers = Array.from(
            customersMap.values()
        );


        customers.forEach(customer => {

            customer.totalOrdersAmount =
                customer.nonCancelledOrderValue;


            const orderTime = getTimestamp(
                customer.lastOrderAt
            );


            const messageTime = getTimestamp(
                customer.lastMessageAt
            );


            const latestTime = Math.max(

                orderTime,

                messageTime

            );


            customer.lastActivityAt = latestTime

                ? new Date(latestTime).toISOString()

                : null;


            customer.orders = sortByDate(

                customer.orders,

                "createdAt"

            );


            customer.messages = sortByDate(

                customer.messages,

                "createdAt"

            );


            /*
             * اختيار أحدث اسم متوفر للعميل.
             */

            const latestOrder =
                customer.orders[0];

            const latestMessage =
                customer.messages[0];


            const orderName =
                latestOrder?.customerName || "";

            const messageName =
                latestMessage?.customerName || "";


            const orderNameTime = getTimestamp(
                latestOrder?.createdAt
            );

            const messageNameTime = getTimestamp(
                latestMessage?.createdAt
            );


            if (

                messageName &&

                messageNameTime > orderNameTime

            ) {

                customer.name = messageName;

            } else if (orderName) {

                customer.name = orderName;

            } else if (messageName) {

                customer.name = messageName;

            }

        });


        customers.sort((a, b) => {

            return (

                getTimestamp(b.lastActivityAt) -

                getTimestamp(a.lastActivityAt)

            );

        });


        return customers;

    }


    /* =====================================================
       17. جلب وتجميع جميع العملاء
    ===================================================== */

    async function getCustomers(options = {}) {

        const ordersLimit = getLimit(

            options.ordersLimit,

            CONFIG.defaultOrdersLimit

        );


        const messagesLimit = getLimit(

            options.messagesLimit,

            CONFIG.defaultMessagesLimit

        );


        /*
         * الطلبات تأتي من خدمة الطلبات الموحدة.
         * الرسائل تأتي من جدول customer_messages.
         */

        const [orders, messages] = await Promise.all([

            fetchOrders({

                limit: ordersLimit

            }),

            fetchMessages({

                limit: messagesLimit

            })

        ]);


        return buildCustomers(

            orders,

            messages

        );

    }


    /* =====================================================
       18. البحث عن عميل
    ===================================================== */

    function searchCustomers(
        customers = [],
        searchTerm = ""
    ) {

        if (!Array.isArray(customers)) {
            return [];
        }


        const query = cleanText(
            searchTerm
        ).toLowerCase();


        if (!query) {

            return [...customers];

        }


        const normalizedQuery =
            normalizePhone(query);


        return customers.filter(customer => {

            const searchableValues = [

                customer.name,

                customer.phone,

                customer.email,

                customer.city,

                customer.neighborhood,

                customer.address

            ];


            const textMatch =
                searchableValues.some(value => {

                    return cleanText(value)

                        .toLowerCase()

                        .includes(query);

                });


            const phoneMatch = Boolean(

                normalizedQuery &&

                customer.normalizedPhone.includes(
                    normalizedQuery
                )

            );


            const orderMatch =
                customer.orders.some(order => {

                    return cleanText(
                        order.orderNumber
                    )

                        .toLowerCase()

                        .includes(query);

                });


            return (

                textMatch ||

                phoneMatch ||

                orderMatch

            );

        });

    }


    /* =====================================================
       19. البحث داخل مصفوفة عملاء محملة
    ===================================================== */

    function getCustomerByPhone(
        customers = [],
        phone = ""
    ) {

        if (!Array.isArray(customers)) {
            return null;
        }


        const normalized =
            normalizePhone(phone);


        if (!normalized) {
            return null;
        }


        return customers.find(customer => {

            return (
                customer.normalizedPhone === normalized
            );

        }) || null;

    }


    /* =====================================================
       20. جلب ملف عميل مباشرة بواسطة رقم الهاتف
    ===================================================== */

    async function fetchCustomerByPhone(
        phone,
        options = {}
    ) {

        const normalized =
            normalizePhone(phone);


        if (!normalized) {

            throw new Error(
                "رقم هاتف العميل غير صالح."
            );

        }


        const customers = await getCustomers({

            ordersLimit: getLimit(

                options.ordersLimit,

                CONFIG.defaultOrdersLimit

            ),

            messagesLimit: getLimit(

                options.messagesLimit,

                CONFIG.defaultMessagesLimit

            )

        });


        return getCustomerByPhone(

            customers,

            normalized

        );

    }


    /* =====================================================
       21. إحصاءات العملاء
    ===================================================== */

    function getCustomerStats(customers = []) {

        const list = Array.isArray(customers)

            ? customers

            : [];


        const stats = {

            totalCustomers: list.length,

            totalOrders: 0,

            totalMessages: 0,

            nonCancelledOrderValue: 0,

            deliveredOrders: 0,

            cancelledOrders: 0,

            customersWithOrders: 0,

            customersWithMessages: 0

        };


        list.forEach(customer => {

            stats.totalOrders +=
                customer.ordersCount || 0;


            stats.totalMessages +=
                customer.messagesCount || 0;


            stats.nonCancelledOrderValue +=
                toNumber(
                    customer.nonCancelledOrderValue
                );


            if (customer.ordersCount > 0) {

                stats.customersWithOrders++;

            }


            if (customer.messagesCount > 0) {

                stats.customersWithMessages++;

            }


            stats.deliveredOrders +=
                customer.completedOrdersCount || 0;


            stats.cancelledOrders +=
                customer.cancelledOrdersCount || 0;

        });


        return stats;

    }


    /* =====================================================
       22. تجهيز ملخص العميل
    ===================================================== */

    function getCustomerSummary(customer) {

        if (!customer) {
            return null;
        }


        return {

            id: customer.id,

            name: customer.name,

            phone: customer.phone,

            formattedPhone: formatPhone(
                customer.phone
            ),

            email: customer.email,

            city: customer.city,

            neighborhood: customer.neighborhood,

            ordersCount: customer.ordersCount,

            messagesCount: customer.messagesCount,

            nonCancelledOrderValue:
                customer.nonCancelledOrderValue,

            // توافق مع الاسم القديم
            totalOrdersAmount:
                customer.nonCancelledOrderValue,

            completedOrdersCount:
                customer.completedOrdersCount,

            cancelledOrdersCount:
                customer.cancelledOrdersCount,

            lastOrderAt:
                customer.lastOrderAt,

            lastMessageAt:
                customer.lastMessageAt,

            lastActivityAt:
                customer.lastActivityAt,

            createdAt:
                customer.createdAt

        };

    }


    /* =====================================================
       23. تصدير الخدمة
    ===================================================== */

    window.IBRCustomersService = Object.freeze({

        configure,

        getClient,

        getOrdersService,

        normalizePhone,

        formatPhone,

        normalizeOrder,

        normalizeOrderItem,

        normalizeMessage,

        fetchOrders,

        fetchMessages,

        buildCustomers,

        getCustomers,

        searchCustomers,

        getCustomerByPhone,

        fetchCustomerByPhone,

        getCustomerStats,

        getCustomerSummary,

        orderStatusLabels:
            ORDER_STATUS_LABELS,

        messageStatusLabels:
            MESSAGE_STATUS_LABELS

    });


    console.info(
        "IBR Customers Service v1.2.0 initialized successfully."
    );


})();