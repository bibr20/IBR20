/* =========================================================
   IBR20 ADMIN CUSTOMERS
   إدارة الطلبات والعملاء والاستفسارات
   Version: 3.0.0

   الخدمات المتصلة:
   - IBROrdersService
   - IBRMessagesService
   - IBRCustomersService
   - IBRCustomerProfile
   - IBROrderTimeline
   - IBRCustomerTasks
   - IBRCustomerReports
   - IBRCustomerCommunications

   ملاحظات مهمة:
   - لا ينشئ اتصال Supabase جديدًا.
   - يستخدم window.supabaseClient.
   - لا يفترض وجود جدول customers.
   - لا يفترض وجود جدول reviews.
   - المهام وسجل التواصل في الذاكرة فقط.
   - لا يغيّر قاعدة البيانات أو سياساتها.
========================================================= */

(function () {

    "use strict";


    /* =====================================================
       1. منع التكرار
    ===================================================== */

    if (window.IBRAdminCustomers) return;


    /* =====================================================
       2. الحالة العامة
    ===================================================== */

    const state = {

        client: null,

        config: {},

        data: {

            orders: [],

            messages: [],

            reviews: []

        },

        filters: {

            orders: "",

            messages: "",

            reviews: "",

            ordersSearch: "",

            messagesSearch: ""

        },

        loading: false,

        initialized: false,

        requestNumber: 0,

        activeCustomer: null,

        activeOrder: null

    };


    /* =====================================================
       3. الإعدادات الافتراضية
    ===================================================== */

    const DEFAULTS = {

        selectors: {

            orders: '[data-customers-orders]',

            messages: '[data-customers-messages]',

            reviews: '[data-customers-reviews]',

            ordersCount:
                '[data-customers-count="orders"]',

            messagesCount:
                '[data-customers-count="messages"]',

            reviewsCount:
                '[data-customers-count="reviews"]',

            pendingCount:
                '[data-customers-count="pending"]',

            search:
                '[data-customers-search], [data-orders-search], [data-messages-search]',

            refresh:
                '[data-customers-refresh]',

            loading:
                '[data-customers-loading]',

            error:
                '[data-customers-error]',

            tabs:
                '[data-customers-tab]',

            panels:
                '[data-customers-panel]'

        },

        tables: {

            orders: "orders",

            messages: "customer_messages",

            reviews: null

        },

        fields: {

            orders: {

                id: "id",

                orderNumber: "order_number",

                createdAt: "created_at",

                updatedAt: "updated_at",

                deliveredAt: "delivered_at",

                status: "status",

                customerName: "customer_name",

                customerPhone: "customer_phone",

                total: "total_amount",

                deliveryDate: "expected_delivery_date",

                adminNote: "admin_note"

            },

            messages: {

                id: "id",

                createdAt: "created_at",

                status: "status",

                customerName: "customer_name",

                customerPhone: "customer_phone",

                message: "message",

                adminNote: "admin_note",

                customerReply: "customer_reply",

                type: "message_type"

            },

            reviews: {

                id: null,

                createdAt: null,

                status: null,

                rating: null,

                customerName: null,

                content: null

            }

        },

        limits: {

            orders: 200,

            messages: 100,

            reviews: 100

        },

        statuses: {

            reviewApproved: "approved",

            reviewRejected: "rejected"

        },

        whatsappCountryCode: "966",

        onLoad: null,

        onError: null

    };


    /* =====================================================
       4. دمج الإعدادات
    ===================================================== */

    function isPlainObject(value) {

        if (
            !value ||
            typeof value !== "object" ||
            Array.isArray(value)
        ) {

            return false;

        }

        const prototype = Object.getPrototypeOf(value);

        return (
            prototype === Object.prototype ||
            prototype === null
        );

    }


    function mergeConfig(base, extra) {

        const result = {

            ...(isPlainObject(base) ? base : {})

        };

        if (!isPlainObject(extra)) {

            return result;

        }


        Object.keys(extra).forEach(key => {

            if (key === "client") return;

            const value = extra[key];

            if (isPlainObject(value)) {

                result[key] = mergeConfig(
                    result[key],
                    value
                );

            } else {

                result[key] = value;

            }

        });


        return result;

    }


    /* =====================================================
       5. الأدوات العامة
    ===================================================== */

    function escapeHTML(value) {

        if (
            window.IBRAdmin &&
            typeof window.IBRAdmin.escapeHTML === "function"
        ) {

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


    function notify(message, type = "info") {

        const admin = window.IBRAdmin;

        if (
            admin &&
            typeof admin.showAlert === "function"
        ) {

            try {

                admin.showAlert(message, type);

                return;

            } catch (error) {

                console.warn(error);

            }

        }

        if (type === "error") {

            console.error(message);

        } else {

            console.log(message);

        }

    }


    function element(selector) {

        if (!selector) return null;

        try {

            return document.querySelector(selector);

        } catch (error) {

            console.error(
                "Invalid selector:",
                selector,
                error
            );

            return null;

        }

    }


    function getTable(group) {

        return state.config.tables?.[group] || null;

    }


    function getField(group, field) {

        return state.config.fields?.[group]?.[field] || null;

    }


    function getValue(item, group, field) {

        if (!item) return null;

        const configured = getField(group, field);

        const aliases = {

            orderNumber: [
                "orderNumber",
                "order_number"
            ],

            customerName: [
                "customerName",
                "customer_name"
            ],

            customerPhone: [
                "customerPhone",
                "customer_phone"
            ],

            createdAt: [
                "createdAt",
                "created_at"
            ],

            updatedAt: [
                "updatedAt",
                "updated_at"
            ],

            deliveredAt: [
                "deliveredAt",
                "delivered_at"
            ],

            deliveryDate: [
                "deliveryDate",
                "expected_delivery_date"
            ],

            adminNote: [
                "adminNote",
                "admin_note"
            ],

            total: [
                "total",
                "totalAmount",
                "total_amount"
            ],

            status: [
                "status"
            ],
            message: [
                "message"
            ],

            customerReply: [
                "customerReply",
                "customer_reply"
            ],

            type: [
                "type",
                "messageType",
                "message_type"
            ]
        };


        if (configured && item[configured] !== undefined) {

            return item[configured];

        }


        const keys = aliases[field] || [field];

        for (const key of keys) {

            if (item[key] !== undefined) {

                return item[key];

            }

        }

        return null;

    }


    function formatNumber(value) {

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


    function formatCurrency(value) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {

            return "—";

        }

        const number = Number(value);

        if (!Number.isFinite(number)) {

            return "—";

        }

        return number.toLocaleString("ar-SA", {

            minimumFractionDigits: 0,

            maximumFractionDigits: 2

        }) + " ر.س";

    }


    function safeErrorMessage(error) {

        return (
            error?.message ||
            error?.details ||
            error?.hint ||
            "حدث خطأ غير متوقع."
        );

    }


    function validateClient() {

        if (
            !state.client ||
            typeof state.client.from !== "function"
        ) {

            throw new Error(
                "اتصال Supabase غير متوفر."
            );

        }

    }


    function getService(name, method) {

        const service = window[name];

        if (
            !service ||
            typeof service[method] !== "function"
        ) {

            throw new Error(
                "الخدمة " +
                name +
                " أو الدالة " +
                method +
                " غير متوفرة."
            );

        }

        return service;

    }


    /* =====================================================
       6. تهيئة الخدمات
    ===================================================== */

    function configureServices() {

        const services = [

            window.IBROrdersService,

            window.IBRMessagesService,

            window.IBRCustomersService

        ];


        services.forEach(service => {

            if (
                service &&
                typeof service.configure === "function"
            ) {

                service.configure({

                    client: state.client

                });

            }

        });

    }


    /* =====================================================
       7. التحميل والأخطاء
    ===================================================== */

    function setLoading(value) {

        state.loading = Boolean(value);

        const loadingNode = element(
            state.config.selectors.loading
        );

        if (loadingNode) {

            loadingNode.hidden = !state.loading;

        }


        const button = element(
            state.config.selectors.refresh
        );

        if (button) {

            button.disabled = state.loading;

        }

    }


    function showError(message) {

        const node = element(
            state.config.selectors.error
        );

        if (node) {

            node.textContent = message;

            node.hidden = false;

        }


        if (typeof state.config.onError === "function") {

            try {

                state.config.onError(message);

            } catch (error) {

                console.error(error);

            }

        }


        notify(message, "error");

    }


    function clearError() {

        const node = element(
            state.config.selectors.error
        );

        if (node) {

            node.textContent = "";

            node.hidden = true;

        }

    }


    /* =====================================================
       8. تحميل الطلبات
    ===================================================== */

    async function loadOrders() {

        const service = getService(
            "IBROrdersService",
            "fetchOrders"
        );


        const limit = Math.max(
            1,
            Math.min(
                1000,
                Number(state.config.limits.orders) || 200
            )
        );


        const result = await service.fetchOrders({

            limit

        });


        if (!Array.isArray(result)) {

            throw new Error(
                "بيانات الطلبات غير صالحة."
            );

        }


        return result;

    }


    /* =====================================================
       9. تحميل الرسائل
    ===================================================== */

    async function loadMessages() {

        const service = getService(
            "IBRMessagesService",
            "fetchMessages"
        );


        const limit = Math.max(
            1,
            Math.min(
                1000,
                Number(state.config.limits.messages) || 100
            )
        );


        const result = await service.fetchMessages({

            limit

        });


        if (!Array.isArray(result)) {

            throw new Error(
                "بيانات الرسائل غير صالحة."
            );

        }


        return result;

    }


    /* =====================================================
       10. تحميل التقييمات
    ===================================================== */

    async function loadReviews() {

        // لا يوجد جدول تقييمات مؤكد.

        return [];

    }


    /* =====================================================
       11. تحميل جميع الأقسام
    ===================================================== */

    async function load() {

        if (state.loading) {

            return {

                success: false,

                busy: true

            };

        }


        const requestNumber = ++state.requestNumber;

        setLoading(true);

        clearError();


        try {

            validateClient();


            const results = await Promise.allSettled([

                loadOrders(),

                loadMessages(),

                loadReviews()

            ]);


            if (requestNumber !== state.requestNumber) {

                return {

                    success: false,

                    stale: true

                };

            }


            const groups = [

                "orders",

                "messages",

                "reviews"

            ];

            const errors = [];


            results.forEach((result, index) => {

                const group = groups[index];

                if (result.status === "fulfilled") {

                    state.data[group] = result.value;

                } else {

                    state.data[group] = [];

                    errors.push({

                        group,

                        error: result.reason

                    });

                    console.error(
                        group,
                        result.reason
                    );

                }

            });


            renderAll();


            if (typeof state.config.onLoad === "function") {

                try {

                    state.config.onLoad(state.data);

                } catch (error) {

                    console.error(error);

                }

            }


            if (errors.length) {

                const names = {

                    orders: "الطلبات",

                    messages: "الرسائل",

                    reviews: "التقييمات"

                };

                const failed = errors
                    .map(item => names[item.group])
                    .join("، ");


                showError(
                    "تعذر تحميل بعض الأقسام: " + failed
                );


                return {

                    success: false,

                    partial: true,

                    data: state.data,

                    errors

                };

            }


            return {

                success: true,

                data: state.data

            };


        } catch (error) {

            console.error(
                "IBRAdminCustomers.load:",
                error
            );

            showError(
                safeErrorMessage(error)
            );


            return {

                success: false,

                error

            };

        } finally {

            setLoading(false);

        }

    }


    /* =====================================================
       12. الإحصاءات
    ===================================================== */

    function updateCounts() {

        setText(
            state.config.selectors.ordersCount,
            getTable("orders")
                ? formatNumber(state.data.orders.length)
                : "—"
        );


        setText(
            state.config.selectors.messagesCount,
            getTable("messages")
                ? formatNumber(state.data.messages.length)
                : "—"
        );


        setText(
            state.config.selectors.reviewsCount,
            "—"
        );


        const pendingMessages =
            state.data.messages.filter(item => {

                return [

                    "new",

                    "in_review"

                ].includes(
                    getValue(item, "messages", "status")
                );

            }).length;


        const pendingOrders =
            state.data.orders.filter(item => {

                return [

                    "new",

                    "contacting",

                    "confirmed",

                    "preparing",

                    "shipped"

                ].includes(
                    getValue(item, "orders", "status")
                );

            }).length;


        setText(
            state.config.selectors.pendingCount,
            formatNumber(
                pendingMessages + pendingOrders
            )
        );

    }


    function setText(selector, value) {

        const node = element(selector);

        if (node) {

            node.textContent = String(value ?? "");

        }

    }


    /* =====================================================
       13. البحث والتصفية
    ===================================================== */

    function normalizeSearch(value) {

        return String(value ?? "")
            .trim()
            .toLowerCase();

    }


    function filterRecords(items, group) {

        const query = normalizeSearch(
            state.filters[group + "Search"]
        );

        const status = state.filters[group];


        return items.filter(item => {

            const itemStatus = getValue(
                item,
                group,
                "status"
            );


            if (status && itemStatus !== status) {

                return false;

            }


            if (!query) return true;


            const searchable = group === "orders"

                ? [

                    getValue(item, group, "orderNumber"),

                    getValue(item, group, "id"),

                    getValue(item, group, "customerName"),

                    getValue(item, group, "customerPhone"),

                    getValue(item, group, "status"),

                    getValue(item, group, "total"),

                    getValue(item, group, "adminNote")

                ]

                : [

                    getValue(item, group, "id"),

                    getValue(item, group, "customerName"),

                    getValue(item, group, "customerPhone"),

                    getValue(item, group, "message"),

                    getValue(item, group, "status"),

                    getValue(item, group, "adminNote")

                ];


            return searchable.some(value =>

                normalizeSearch(value).includes(query)

            );

        });

    }


    function getSearchGroup(input) {

        if (input.dataset.customersSearch) {

            return input.dataset.customersSearch;

        }

        if (input.hasAttribute("data-orders-search")) {

            return "orders";

        }

        if (input.hasAttribute("data-messages-search")) {

            return "messages";

        }

        return null;

    }


    function bindSearch() {

        document.querySelectorAll(
            state.config.selectors.search
        ).forEach(input => {

            if (input.dataset.customerSearchBound) return;

            input.dataset.customerSearchBound = "true";


            input.addEventListener("input", () => {

                const group = getSearchGroup(input);

                if (!["orders", "messages"].includes(group)) {

                    return;

                }


                state.filters[group + "Search"] =
                    input.value;

                renderAll();

            });

        });

    }


    function getFilterGroup(select) {

        if (select.dataset.customersFilter) {

            return select.dataset.customersFilter;

        }

        if (select.hasAttribute("data-orders-filter")) {

            return "orders";

        }

        if (select.hasAttribute("data-messages-filter")) {

            return "messages";

        }

        if (select.hasAttribute("data-reviews-filter")) {

            return "reviews";

        }

        return null;

    }


    function bindFilters() {

        document.querySelectorAll(
            '[data-customers-filter], [data-orders-filter], [data-messages-filter], [data-reviews-filter]'
        ).forEach(select => {

            if (select.dataset.customerFilterBound) return;

            select.dataset.customerFilterBound = "true";


            document.addEventListener("keydown", event => {

                if (event.key === "Escape") {

                    closeMessageDetails();

                }

            });


            select.addEventListener("change", () => {

                const group = getFilterGroup(select);

                if (
                    !["orders", "messages", "reviews"].includes(group)
                ) {

                    return;

                }


                state.filters[group] = select.value;

                renderAll();

            });

        });

    }


    /* =====================================================
       14. الحالات
    ===================================================== */

    const ORDER_STATUSES = {

        new: "جديد",

        contacting: "جارٍ التواصل",

        confirmed: "مؤكد",

        preparing: "قيد التجهيز",

        shipped: "تم الشحن",

        delivered: "تم التسليم",

        cancelled: "ملغي"

    };


    const MESSAGE_STATUSES = {

        new: "جديد",

        in_review: "قيد المراجعة",

        answered: "تمت الإجابة",

        closed: "مغلقة"

    };


    function statusLabel(status) {

        return (
            ORDER_STATUSES[status] ||
            MESSAGE_STATUSES[status] ||
            status ||
            "غير محدد"
        );

    }


    function statusClass(status) {

        if ([

            "approved",

            "delivered",

            "completed",

            "confirmed",

            "answered"

        ].includes(status)) {

            return "success";

        }


        if ([

            "rejected",

            "cancelled"

        ].includes(status)) {

            return "danger";

        }


        if ([

            "pending",

            "new",

            "contacting",

            "preparing",

            "in_review"

        ].includes(status)) {

            return "pending";

        }


        return "neutral";

    }


    function statusHTML(status) {

        return `
            <span class="customer-status ${statusClass(status)}">
                ${escapeHTML(statusLabel(status))}
            </span>
        `;

    }


    function statusSelectHTML(group, id, currentStatus) {

        const statuses = group === "orders"
            ? ORDER_STATUSES
            : MESSAGE_STATUSES;


        const options = Object.entries(statuses)
            .map(([value, label]) => {

                return `
                    <option
                        value="${escapeHTML(value)}"
                        ${value === currentStatus ? "selected" : ""}>
                        ${escapeHTML(label)}
                    </option>
                `;

            })
            .join("");


        return `
            <select
                class="customer-status-select"
                data-customer-status-group="${group}"
                data-customer-status-id="${escapeHTML(id)}">

                ${options}

            </select>
        `;

    }


    /* =====================================================
       15. تحديث حالة الطلب
    ===================================================== */

    async function updateOrderStatus(orderId, newStatus) {

        if (!orderId) {

            notify("معرّف الطلب غير صالح.", "error");

            return false;

        }


        if (!Object.hasOwn(ORDER_STATUSES, newStatus)) {

            notify("حالة الطلب غير صالحة.", "error");

            return false;

        }


        try {

            const service = getService(
                "IBROrdersService",
                "updateOrderStatus"
            );


            const updated = await service.updateOrderStatus(
                orderId,
                newStatus
            );


            if (!updated) {

                throw new Error(
                    "لم تُرجع الخدمة بيانات تؤكد التحديث."
                );

            }


            const record = state.data.orders.find(item =>

                String(getValue(item, "orders", "id")) ===
                String(orderId)

            );


            if (record) {

                record.status = updated.status;

                record.updated_at =
                    updated.updated_at ??
                    updated.updatedAt ??
                    record.updated_at;

                record.delivered_at =
                    updated.delivered_at ??
                    updated.deliveredAt ??
                    record.delivered_at;

            }


            renderAll();

            notify(
                "تم تحديث حالة الطلب بنجاح.",
                "success"
            );

            return updated;


        } catch (error) {

            console.error(
                "Update order status:",
                error
            );

            notify(
                "تعذر تحديث حالة الطلب: " +
                safeErrorMessage(error),
                "error"
            );

            return false;

        }

    }


    /* =========================================================
       دعوات تقييم المنتجات بعد تسليم الطلب
    ========================================================= */

    async function createOrGetReviewInvitation(orderId) {

        if (!orderId) {
            throw new Error("معرّف الطلب غير موجود.");
        }

        if (!state.client) {
            throw new Error("اتصال قاعدة البيانات غير متاح.");
        }

        const { data, error } = await state.client.functions.invoke(
            "ibr-create-review-invitation",
            {
                body: {
                    order_id: orderId
                }
            }
        );

        if (error) {

            let message = error.message || "تعذر إنشاء دعوة التقييم.";

            // محاولة قراءة رسالة الخطأ التفصيلية من Edge Function.
            try {
                if (error.context && typeof error.context.json === "function") {
                    const details = await error.context.json();

                    if (details && details.error) {
                        message = details.error;
                    }
                }
            } catch (_) {
                // الاحتفاظ برسالة الخطأ الأصلية.
            }

            throw new Error(message);
        }

        if (!data || data.success !== true || !data.data) {
            throw new Error(
                data?.error || "لم يتمكن النظام من تجهيز دعوة التقييم."
            );
        }

        if (!data.data.review_url) {
            throw new Error("لم يُرجع النظام رابط التقييم.");
        }

        return data.data;
    }


    /* =========================================================
       عرض نافذة دعوة التقييم
    ========================================================= */

    function showReviewInvitationModal(invitation) {

        if (!invitation || !invitation.review_url) {
            notify("رابط التقييم غير متوفر.", "error");
            return;
        }

        const oldModal = document.getElementById(
            "ibr-review-invitation-modal"
        );

        if (oldModal) {
            oldModal.remove();
        }

        const expiresAt = invitation.expires_at
            ? new Date(invitation.expires_at)
            : null;

        const formattedExpiry =
            expiresAt && !Number.isNaN(expiresAt.getTime())
                ? new Intl.DateTimeFormat("ar-SA", {
                    dateStyle: "full",
                    timeStyle: "short"
                }).format(expiresAt)
                : "غير محدد";

        const whatsappButton = invitation.whatsapp_url
            ? `
            <a
                href="${escapeHTML(invitation.whatsapp_url)}"
                target="_blank"
                rel="noopener noreferrer"
                class="ibr-review-modal-button ibr-review-whatsapp"
                data-review-invitation-whatsapp
            >
                <span>فتح واتساب وإرسال الدعوة</span>
            </a>
        `
            : `
            <div class="ibr-review-no-whatsapp">
                لا يوجد رقم واتساب صالح لهذا العميل.
                يمكنك نسخ رابط التقييم وإرساله يدويًا.
            </div>
        `;

        const modal = document.createElement("div");

        modal.id = "ibr-review-invitation-modal";

        modal.innerHTML = `
        <div class="ibr-review-modal-backdrop"
             data-review-invitation-close></div>

        <section
            class="ibr-review-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ibr-review-modal-title"
        >

            <button
                type="button"
                class="ibr-review-modal-close"
                data-review-invitation-close
                aria-label="إغلاق"
            >
                &times;
            </button>

            <div class="ibr-review-modal-icon">
                ★
            </div>

            <h3 id="ibr-review-modal-title">
                دعوة تقييم الطلب جاهزة
            </h3>

            <p class="ibr-review-modal-description">
                أصبح بإمكانك مشاركة رابط التقييم الخاص بهذا الطلب مع العميل.
            </p>

            <div class="ibr-review-modal-order">
                <span>رقم الطلب</span>
                <strong>${escapeHTML(invitation.order_number || "—")}</strong>
            </div>

            <label class="ibr-review-modal-label">
                رابط التقييم الخاص
            </label>

            <div class="ibr-review-modal-link">
                <input
                    type="text"
                    readonly
                    value="${escapeHTML(invitation.review_url)}"
                    data-review-invitation-url
                    dir="ltr"
                >

                <button
                    type="button"
                    data-review-invitation-copy
                >
                    نسخ الرابط
                </button>
            </div>

            <div class="ibr-review-modal-expiry">
                <span>تاريخ انتهاء الرابط</span>
                <strong>${escapeHTML(formattedExpiry)}</strong>
            </div>

            <div class="ibr-review-modal-status">
                ${invitation.reused
                ? "تم استرجاع دعوة التقييم السارية السابقة."
                : "تم إنشاء دعوة تقييم جديدة بنجاح."
            }
            </div>

            <div class="ibr-review-modal-actions">
                ${whatsappButton}
            </div>

            <button
                type="button"
                class="ibr-review-modal-secondary"
                data-review-invitation-close
            >
                إغلاق
            </button>

        </section>
    `;

        document.body.appendChild(modal);

        // إضافة التنسيق دون التأثير على تصميم لوحة الإدارة.
        if (!document.getElementById("ibr-review-invitation-styles")) {

            const style = document.createElement("style");

            style.id = "ibr-review-invitation-styles";

            style.textContent = `
            #ibr-review-invitation-modal {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 18px;
                direction: rtl;
                font-family: inherit;
            }

            .ibr-review-modal-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(25, 22, 18, .62);
                backdrop-filter: blur(4px);
            }

            .ibr-review-modal-card {
                position: relative;
                z-index: 1;
                width: 100%;
                max-width: 510px;
                max-height: 90vh;
                overflow-y: auto;
                padding: 30px;
                border-radius: 20px;
                background: #fffdf9;
                color: #33291f;
                box-shadow: 0 20px 70px rgba(0,0,0,.25);
                text-align: center;
            }

            .ibr-review-modal-close {
                position: absolute;
                top: 12px;
                left: 15px;
                width: 34px;
                height: 34px;
                border: 0;
                border-radius: 50%;
                background: #f1ece4;
                color: #514333;
                font-size: 25px;
                cursor: pointer;
            }

            .ibr-review-modal-icon {
                width: 58px;
                height: 58px;
                margin: 0 auto 15px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: #eee4d5;
                color: #927047;
                font-size: 30px;
            }

            .ibr-review-modal-card h3 {
                margin: 0 0 10px;
                font-size: 21px;
            }

            .ibr-review-modal-description {
                margin: 0 0 22px;
                color: #786f64;
                line-height: 1.8;
                font-size: 14px;
            }

            .ibr-review-modal-order,
            .ibr-review-modal-expiry {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 13px 15px;
                margin-bottom: 12px;
                border-radius: 10px;
                background: #f5f0e8;
                font-size: 13px;
            }

            .ibr-review-modal-label {
                display: block;
                margin: 20px 0 9px;
                text-align: right;
                font-size: 13px;
                font-weight: 700;
            }

            .ibr-review-modal-link {
                display: flex;
                gap: 7px;
                padding: 7px;
                border: 1px solid #e2d7c7;
                border-radius: 11px;
                background: #fff;
            }

            .ibr-review-modal-link input {
                flex: 1;
                min-width: 0;
                width: 100%;
                border: 0;
                outline: 0;
                background: transparent;
                color: #5c4936;
                font-size: 12px;
                text-align: left;
            }

            .ibr-review-modal-link button {
                flex-shrink: 0;
                padding: 10px 14px;
                border: 0;
                border-radius: 8px;
                background: #806344;
                color: #fff;
                cursor: pointer;
                font: inherit;
                font-size: 12px;
            }

            .ibr-review-modal-expiry {
                margin-top: 15px;
            }

            .ibr-review-modal-status {
                margin: 15px 0;
                padding: 11px;
                border-radius: 9px;
                background: #f0eee7;
                color: #65543e;
                font-size: 12px;
                line-height: 1.7;
            }

            .ibr-review-modal-actions {
                margin-top: 18px;
            }

            .ibr-review-modal-button {
                display: block;
                padding: 14px;
                border-radius: 10px;
                text-decoration: none;
                font-size: 14px;
                font-weight: 700;
            }

            .ibr-review-whatsapp {
                background: #247b50;
                color: #fff;
            }

            .ibr-review-no-whatsapp {
                padding: 13px;
                border-radius: 9px;
                background: #f6eee2;
                color: #765b39;
                font-size: 12px;
                line-height: 1.8;
            }

            .ibr-review-modal-secondary {
                width: 100%;
                margin-top: 12px;
                padding: 12px;
                border: 1px solid #ded5c8;
                border-radius: 10px;
                background: transparent;
                color: #665646;
                cursor: pointer;
                font: inherit;
            }

            @media (max-width: 480px) {
                .ibr-review-modal-card {
                    padding: 24px 17px;
                }

                .ibr-review-modal-link {
                    flex-direction: column;
                }

                .ibr-review-modal-link input {
                    min-height: 38px;
                }
            }
        `;

            document.head.appendChild(style);
        }
    }


    /* =========================================================
       تجهيز دعوة التقييم وعرض النتيجة
    ========================================================= */

    async function prepareReviewInvitation(orderId) {

        try {

            const invitation = await createOrGetReviewInvitation(
                orderId
            );

            showReviewInvitationModal(invitation);

            return invitation;

        } catch (error) {

            console.error(
                "[IBR Review Invitation]",
                error
            );

            notify(
                "تم تسليم الطلب، لكن تعذر تجهيز دعوة التقييم: " +
                (error.message || "خطأ غير معروف") +
                ". يمكنك إعادة المحاولة من زر دعوة التقييم.",
                "error"
            );

            return false;
        }
    }

    /* =====================================================
       16. تحديث حالة الرسالة
    ===================================================== */

    async function updateMessageStatus(messageId, newStatus) {

        if (!messageId) {

            notify("معرّف الرسالة غير صالح.", "error");

            return false;

        }


        if (!Object.hasOwn(MESSAGE_STATUSES, newStatus)) {

            notify("حالة الرسالة غير صالحة.", "error");

            return false;

        }


        try {

            const service = getService(
                "IBRMessagesService",
                "updateMessageStatus"
            );


            const updated = await service.updateMessageStatus(
                messageId,
                newStatus
            );


            if (!updated) {

                throw new Error(
                    "لم تُرجع الخدمة بيانات تؤكد التحديث."
                );

            }


            const record = state.data.messages.find(item =>

                String(getValue(item, "messages", "id")) ===
                String(messageId)

            );


            if (record) {

                record.status = updated.status;

                record.updated_at =
                    updated.updated_at ??
                    updated.updatedAt ??
                    record.updated_at;

            }


            renderAll();

            notify(
                "تم تحديث حالة الرسالة بنجاح.",
                "success"
            );

            return updated;


        } catch (error) {

            console.error(
                "Update message status:",
                error
            );

            notify(
                "تعذر تحديث حالة الرسالة: " +
                safeErrorMessage(error),
                "error"
            );

            return false;

        }

    }


    /* =====================================================
       17. حفظ ملاحظة الطلب
    ===================================================== */

    async function saveOrderNote(orderId, note) {

        if (!orderId) {

            notify("معرّف الطلب غير صالح.", "error");

            return false;

        }


        try {

            const service = getService(
                "IBROrdersService",
                "updateAdminNote"
            );


            const cleanNote =
                note === null
                    ? null
                    : String(note ?? "").trim();


            const updated = await service.updateAdminNote(
                orderId,
                cleanNote
            );


            if (!updated) {

                throw new Error(
                    "لم تُرجع الخدمة بيانات تؤكد حفظ الملاحظة."
                );

            }


            const record = state.data.orders.find(item =>

                String(getValue(item, "orders", "id")) ===
                String(orderId)

            );


            if (record) {

                record.admin_note = cleanNote;

                record.adminNote = cleanNote;

            }


            renderAll();

            notify(
                "تم حفظ ملاحظة الطلب بنجاح.",
                "success"
            );

            return true;


        } catch (error) {

            console.error(
                "Save order note:",
                error
            );

            notify(
                "تعذر حفظ ملاحظة الطلب: " +
                safeErrorMessage(error),
                "error"
            );

            return false;

        }

    }


    /* =====================================================
       18. حفظ ملاحظة الرسالة
    ===================================================== */

    async function saveMessageNote(id, note) {

        if (!id) {

            notify("معرّف الرسالة غير صالح.", "error");

            return false;

        }


        try {

            const service = getService(
                "IBRMessagesService",
                "updateAdminNote"
            );


            const cleanNote = String(note ?? "").trim();


            const updated = await service.updateAdminNote(
                id,
                cleanNote
            );


            if (!updated) {

                throw new Error(
                    "لم تُرجع الخدمة بيانات تؤكد حفظ الملاحظة."
                );

            }


            const record = state.data.messages.find(item =>

                String(getValue(item, "messages", "id")) ===
                String(id)

            );


            if (record) {

                record.admin_note = cleanNote;

                record.adminNote = cleanNote;

            }


            notify(
                "تم حفظ الملاحظة بنجاح.",
                "success"
            );

            return true;


        } catch (error) {

            console.error(
                "Save message note:",
                error
            );

            notify(
                "تعذر حفظ الملاحظة: " +
                safeErrorMessage(error),
                "error"
            );

            return false;

        }

    }

    /* =====================================================
       نافذة تفاصيل استفسار العميل
    ===================================================== */

    function ensureMessageModalStyles() {

        if (document.getElementById("ibr-message-modal-styles")) {
            return;
        }

        const style = document.createElement("style");

        style.id = "ibr-message-modal-styles";

        style.textContent = `
        .ibr-message-overlay {
            position: fixed;
            inset: 0;
            z-index: 99990;
            background: rgba(35, 26, 19, .68);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px;
            backdrop-filter: blur(5px);
        }

        .ibr-message-dialog {
            width: min(900px, 100%);
            max-height: 92vh;
            overflow-y: auto;
            background: #fffaf4;
            color: #30251d;
            border: 1px solid #e6d9ca;
            border-radius: 19px;
            box-shadow: 0 24px 80px rgba(0,0,0,.25);
            font-family: inherit;
        }

        .ibr-message-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            padding: 21px 25px;
            background: linear-gradient(120deg,#68452e,#8b6548);
            color: white;
            position: sticky;
            top: 0;
            z-index: 2;
        }

        .ibr-message-head h2 {
            margin: 0;
            font-size: 18px;
        }

        .ibr-message-head p {
            margin: 7px 0 0;
            color: rgba(255,255,255,.78);
            font-size: 11px;
        }

        .ibr-message-close {
            width: 38px;
            height: 38px;
            border: 1px solid rgba(255,255,255,.35);
            border-radius: 10px;
            color: white;
            background: rgba(255,255,255,.12);
            cursor: pointer;
            font-size: 22px;
        }

        .ibr-message-body {
            padding: 24px;
            display: grid;
            gap: 19px;
        }

        .ibr-message-section {
            padding: 18px;
            border: 1px solid #e8ded4;
            background: white;
            border-radius: 13px;
            min-width: 0;
        }

        .ibr-message-section h3 {
            margin: 0 0 15px;
            color: #68452e;
            font-size: 14px;
        }

        .ibr-message-info-grid {
            display: grid;
            grid-template-columns: repeat(2,minmax(0,1fr));
            gap: 15px;
        }

        .ibr-message-info-item {
            min-width: 0;
        }

        .ibr-message-info-item small {
            display: block;
            color: #88796b;
            font-size: 10px;
            margin-bottom: 6px;
        }

        .ibr-message-info-item strong {
            display: block;
            font-size: 12px;
            overflow-wrap: anywhere;
            line-height: 1.9;
        }

        .ibr-message-content {
            padding: 17px;
            background: #f8f4ef;
            border: 1px solid #eee4da;
            border-radius: 11px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            line-height: 2.1;
            font-size: 13px;
            min-height: 65px;
        }

        .ibr-message-attachments {
            display: grid;
            grid-template-columns: repeat(auto-fill,minmax(145px,1fr));
            gap: 12px;
        }

        .ibr-message-attachment {
            display: block;
            padding: 8px;
            border: 1px solid #e8ded4;
            border-radius: 11px;
            background: #fff;
            text-decoration: none;
            color: #68452e;
            min-width: 0;
        }

        .ibr-message-attachment img {
            width: 100%;
            height: 145px;
            display: block;
            object-fit: contain;
            background: #f8f4ef;
            border-radius: 7px;
        }

        .ibr-message-attachment span {
            display: block;
            font-size: 11px;
            margin-top: 8px;
            overflow-wrap: anywhere;
        }

        .ibr-message-form {
            display: grid;
            gap: 12px;
        }

        .ibr-message-form label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: #68452e;
        }

        .ibr-message-form textarea,
        .ibr-message-form select {
            display: block;
            width: 100%;
            box-sizing: border-box;
            margin-top: 8px;
            padding: 13px;
            border: 1px solid #e3d6c8;
            border-radius: 10px;
            background: #fff;
            color: #30251d;
            font-family: inherit;
            font-size: 12px;
            line-height: 1.9;
            outline: none;
        }

        .ibr-message-form textarea {
            min-height: 125px;
            resize: vertical;
        }

        .ibr-message-form textarea:focus,
        .ibr-message-form select:focus {
            border-color: #8b6548;
            box-shadow: 0 0 0 3px rgba(139,101,72,.09);
        }

        .ibr-message-form button {
            min-height: 43px;
            padding: 0 18px;
            border: 0;
            border-radius: 9px;
            background: #68452e;
            color: white;
            font-family: inherit;
            font-weight: 700;
            font-size: 12px;
            cursor: pointer;
        }

        .ibr-message-form button:hover {
            background: #8b6548;
        }

        .ibr-message-form button:disabled {
            opacity: .6;
            cursor: wait;
        }

        .ibr-message-loading {
            padding: 55px 20px;
            text-align: center;
            color: #806b59;
        }

        @media(max-width:600px) {
            .ibr-message-overlay {
                padding: 7px;
                align-items: flex-end;
            }

            .ibr-message-dialog {
                max-height: 95vh;
                border-radius: 17px 17px 10px 10px;
            }

            .ibr-message-head {
                padding: 17px;
            }

            .ibr-message-body {
                padding: 13px;
                gap: 12px;
            }

            .ibr-message-section {
                padding: 13px;
            }

            .ibr-message-info-grid {
                grid-template-columns: 1fr;
                gap: 12px;
            }

            .ibr-message-attachments {
                grid-template-columns: repeat(2,minmax(0,1fr));
            }
        }
    `;

        document.head.appendChild(style);
    }


    /* إغلاق نافذة التفاصيل */

    function closeMessageDetails() {

        const modal = document.getElementById(
            "ibr-message-details-modal"
        );

        if (modal) {
            modal.remove();
        }

        document.body.style.overflow = "";
    }


    /* تحويل مسارات المرفقات إلى قائمة */

    function getMessageAttachmentPaths(value) {

        if (!value) return [];

        if (Array.isArray(value)) {
            return value.filter(Boolean);
        }

        try {

            const parsed = JSON.parse(value);

            if (Array.isArray(parsed)) {
                return parsed.filter(Boolean);
            }

            if (typeof parsed === "string") {
                return [parsed];
            }

        } catch (_) { }

        return [String(value)];
    }


    /* إنشاء روابط آمنة مؤقتة للمرفقات */

    async function getMessageAttachmentLinks(value) {

        const paths = getMessageAttachmentPaths(value);
        const links = [];

        for (const path of paths.slice(0, 10)) {

            if (
                typeof path !== "string" ||
                !path.trim()
            ) {
                continue;
            }

            try {

                const { data, error } = await state.client.storage
                    .from("ibr20-contact-attachments")
                    .createSignedUrl(path, 300);

                if (error) {
                    console.warn("Message attachment:", error);
                    continue;
                }

                if (data?.signedUrl) {
                    links.push({
                        path,
                        url: data.signedUrl
                    });
                }

            } catch (error) {
                console.warn(error);
            }
        }

        return links;
    }


    /* إنشاء نافذة التفاصيل */

    function renderMessageDetails(message, attachments) {

        const id = message.id;

        const status = message.status || "new";

        const date = message.created_at
            ? new Date(message.created_at).toLocaleString("ar-SA", {
                dateStyle: "medium",
                timeStyle: "short"
            })
            : "—";

        const imageExtensions = /\.(jpg|jpeg|png|webp|gif|avif)(\?.*)?$/i;

        const attachmentHTML = attachments.length
            ? attachments.map((item, index) => {

                const isImage = imageExtensions.test(item.path);

                return `
                <a
                    class="ibr-message-attachment"
                    href="${escapeHTML(item.url)}"
                    target="_blank"
                    rel="noopener noreferrer">

                    ${isImage ? `
                        <img
                            src="${escapeHTML(item.url)}"
                            alt="مرفق العميل ${index + 1}"
                            loading="lazy">
                    ` : `
                        <div style="
                            min-height:145px;
                            display:flex;
                            align-items:center;
                            justify-content:center;
                            background:#f8f4ef;
                            border-radius:7px;
                            font-size:35px;">
                            📎
                        </div>
                    `}

                    <span>
                        ${isImage
                        ? "عرض الصورة بحجم أكبر"
                        : "فتح المرفق"}
                    </span>

                </a>
            `;

            }).join("")
            : `
            <p class="admin-muted">
                لا توجد مرفقات مضافة لهذا الاستفسار.
            </p>
        `;

        const oldModal = document.getElementById(
            "ibr-message-details-modal"
        );

        if (oldModal) oldModal.remove();

        ensureMessageModalStyles();

        const modalHTML = `
        <div
            id="ibr-message-details-modal"
            class="ibr-message-overlay"
            data-message-modal-backdrop
            role="presentation">

            <section
                class="ibr-message-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ibr-message-dialog-title">

                <header class="ibr-message-head">

                    <div>
                        <h2 id="ibr-message-dialog-title">
                            تفاصيل استفسار العميل
                        </h2>

                        <p>
                            جميع بيانات الرسالة والمرفقات والردود
                        </p>
                    </div>

                    <button
                        type="button"
                        class="ibr-message-close"
                        data-message-modal-close
                        aria-label="إغلاق">
                        ×
                    </button>

                </header>

                <div class="ibr-message-body">

                    <section class="ibr-message-section">

                        <h3>بيانات العميل والاستفسار</h3>

                        <div class="ibr-message-info-grid">

                            <div class="ibr-message-info-item">
                                <small>معرّف الاستفسار</small>
                                <strong dir="ltr">${escapeHTML(id)}</strong>
                            </div>

                            <div class="ibr-message-info-item">
                                <small>تاريخ الإرسال</small>
                                <strong>${escapeHTML(date)}</strong>
                            </div>

                            <div class="ibr-message-info-item">
                                <small>اسم العميل</small>
                                <strong>${escapeHTML(message.customer_name || "—")}</strong>
                            </div>

                            <div class="ibr-message-info-item">
                                <small>رقم الجوال</small>
                                <strong dir="ltr">${escapeHTML(message.customer_phone || "—")}</strong>
                            </div>

                            <div class="ibr-message-info-item">
                                <small>البريد الإلكتروني</small>
                                <strong dir="ltr">${escapeHTML(message.customer_email || "—")}</strong>
                            </div>

                            <div class="ibr-message-info-item">
                                <small>نوع الاستفسار</small>
                                <strong>${escapeHTML(message.message_type || "—")}</strong>
                            </div>

                            <div class="ibr-message-info-item" style="grid-column:1/-1">
                                <small>موضوع الاستفسار</small>
                                <strong>${escapeHTML(message.subject || "بدون موضوع")}</strong>
                            </div>

                        </div>

                    </section>


                    <section class="ibr-message-section">

                        <h3>رسالة العميل كاملة</h3>

                        <div class="ibr-message-content">${escapeHTML(message.message || "لا يوجد نص للرسالة.")}</div>

                    </section>


                    <section class="ibr-message-section">

                        <h3>صور ومرفقات العميل</h3>

                        <div class="ibr-message-attachments">
                            ${attachmentHTML}
                        </div>

                    </section>


                    <section class="ibr-message-section">

                        <h3>إدارة حالة الاستفسار</h3>

                        <div class="ibr-message-form">

                            <label>
                                حالة الاستفسار
                                ${statusSelectHTML("messages", id, status)}
                            </label>

                        </div>

                    </section>


                    <section class="ibr-message-section">

                        <h3>الرد على العميل</h3>

                        <div class="ibr-message-form">

                            <label>
                                نص الرد

                                <textarea
                                    data-message-reply="${escapeHTML(id)}"
                                    placeholder="اكتب ردك الكامل على استفسار العميل...">${escapeHTML(message.customer_reply || "")}</textarea>
                            </label>

                            <button
                                type="button"
                                data-message-save-reply="${escapeHTML(id)}">
                                حفظ الرد
                            </button>

                            <p class="admin-muted">
                                سيُحفظ الرد في سجل الاستفسار، وتتحول حالته إلى «تم الرد».
                            </p>

                        </div>

                    </section>


                    <section class="ibr-message-section">

                        <h3>ملاحظة الإدارة الداخلية</h3>

                        <div class="ibr-message-form">

                            <label>
                                الملاحظة

                                <textarea
                                    data-message-note="${escapeHTML(id)}"
                                    placeholder="اكتب ملاحظة داخلية للفريق، لا تظهر للعميل...">${escapeHTML(message.admin_note || "")}</textarea>
                            </label>

                            <button
                                type="button"
                                data-message-save-note="${escapeHTML(id)}">
                                حفظ ملاحظة الإدارة
                            </button>

                        </div>

                    </section>

                </div>

            </section>

        </div>
    `;

        document.body.insertAdjacentHTML(
            "beforeend",
            modalHTML
        );

        document.body.style.overflow = "hidden";
    }


    /* تحميل وعرض تفاصيل الاستفسار */

    async function showMessageDetails(id) {

        if (!id) {
            notify("معرّف الاستفسار غير صالح.", "error");
            return false;
        }

        ensureMessageModalStyles();

        closeMessageDetails();

        document.body.insertAdjacentHTML(
            "beforeend",
            `
        <div
            id="ibr-message-details-modal"
            class="ibr-message-overlay">

            <section class="ibr-message-dialog">

                <div class="ibr-message-loading">
                    جارٍ تحميل تفاصيل الاستفسار والمرفقات...
                </div>

            </section>

        </div>
        `
        );

        document.body.style.overflow = "hidden";

        try {

            validateClient();

            const { data, error } = await state.client
                .from(getTable("messages"))
                .select("*")
                .eq("id", id)
                .single();

            if (error) throw error;

            if (!data) {
                throw new Error("لم يتم العثور على الاستفسار.");
            }

            const attachments = await getMessageAttachmentLinks(
                data.attachment_path
            );

            renderMessageDetails(data, attachments);

            return true;

        } catch (error) {

            console.error("Message details:", error);

            closeMessageDetails();

            notify(
                "تعذر تحميل تفاصيل الاستفسار: " +
                safeErrorMessage(error),
                "error"
            );

            return false;
        }
    }


    /* حفظ رد الإدارة على العميل */

    async function saveMessageReply(id, reply) {

        if (!id) {
            notify("معرّف الاستفسار غير صالح.", "error");
            return false;
        }

        try {

            const service = getService(
                "IBRMessagesService",
                "saveCustomerReply"
            );

            const cleanReply = String(reply ?? "").trim();

            const updated = await service.saveCustomerReply(
                id,
                cleanReply
            );

            if (!updated) {
                throw new Error("لم يتم تأكيد حفظ الرد.");
            }

            const record = state.data.messages.find(item =>
                String(getValue(item, "messages", "id")) === String(id)
            );

            if (record) {

                record.customer_reply =
                    updated.customer_reply ??
                    updated.customerReply ??
                    cleanReply;

                record.customerReply = record.customer_reply;

                record.status = updated.status || "answered";
            }

            const statusSelect = document.querySelector(
                `[data-customer-status-group="messages"][data-customer-status-id="${CSS.escape(String(id))}"]`
            );

            if (statusSelect) {
                statusSelect.value = "answered";
            }

            renderAll();

            notify(
                "تم حفظ الرد على الاستفسار بنجاح.",
                "success"
            );

            return true;

        } catch (error) {

            console.error("Save message reply:", error);

            notify(
                "تعذر حفظ الرد: " + safeErrorMessage(error),
                "error"
            );

            return false;
        }
    }


    /* =====================================================
       19. عرض الطلبات
    ===================================================== */

    function renderOrders() {

        const node = element(
            state.config.selectors.orders
        );

        if (!node) return;


        if (!getTable("orders")) {

            node.innerHTML = `
                <div class="customers-empty">
                    <strong>جدول الطلبات غير مربوط</strong>
                </div>
            `;

            return;

        }


        const records = filterRecords(
            state.data.orders,
            "orders"
        );


        if (!records.length) {

            node.innerHTML = `
                <div class="customers-empty">
                    <strong>لا توجد طلبات مطابقة</strong>
                    <p>لم يتم العثور على طلبات حسب البحث الحالي.</p>
                </div>
            `;

            return;

        }


        const rows = records.map((item, index) => {

            const id = getValue(item, "orders", "id");

            const orderNumber =
                getValue(item, "orders", "orderNumber");

            const name =
                getValue(item, "orders", "customerName");

            const phone =
                getValue(item, "orders", "customerPhone");

            const total =
                getValue(item, "orders", "total");

            const status =
                getValue(item, "orders", "status");

            const date =
                getValue(item, "orders", "createdAt");

            const note =
                getValue(item, "orders", "adminNote");


            return `
                <tr>

                    <td>
                        <strong>
                            ${escapeHTML(
                orderNumber ||
                id ||
                formatNumber(index + 1)
            )}
                        </strong>
                    </td>

                    <td>
                        ${escapeHTML(name || "—")}
                    </td>

                    <td>
                        <span dir="ltr">
                            ${escapeHTML(phone || "—")}
                        </span>
                    </td>

                    <td>
                        ${escapeHTML(formatCurrency(total))}
                    </td>

                    <td>
                        ${statusHTML(status)}
                    </td>

                    <td>
                        ${escapeHTML(formatDate(date))}
                    </td>

                    <td>
                        <div class="customer-actions">

                            ${phone ? `
                                <button
                                    type="button"
                                    class="customer-action"
                                    data-customer-whatsapp="${escapeHTML(phone)}">
                                    واتساب
                                </button>
                            ` : ""}

                            ${id ? `
                                <button
                                    type="button"
                                    class="customer-action"
                                    data-customer-copy="${escapeHTML(id)}">
                                    نسخ الرقم
                                </button>

                                <button
                                    type="button"
                                    class="customer-action"
                                    data-order-note-toggle="${escapeHTML(id)}">
                                    ملاحظة
                                </button>
                            ` : ""}

                            ${phone ? `
                                <button
                                    type="button"
                                    class="customer-action"
                                    data-customer-profile="${escapeHTML(phone)}">
                                    ملف العميل
                                </button>
                            ` : ""}


                                ${status === "delivered"
                    ? `
                                        <button
                                         type="button"
                                         class="customer-action"
                                         data-review-invitation="${escapeHTML(id)}"
                                          title="إنشاء رابط تقييم لهذا الطلب"
                                         >
                                         دعوة التقييم
                                        </button>
                                `
                    : ""
                }

                        </div>
                    </td>

                </tr>

                <tr class="customer-order-controls" hidden>

                    <td colspan="7">

                        <div class="customer-order-control-inner">

                            <label>
                                حالة الطلب
                                ${statusSelectHTML("orders", id, status)}
                            </label>

                            <label>
                                ملاحظة الإدارة
                                <textarea
                                    data-order-note="${escapeHTML(id)}"
                                    placeholder="اكتب ملاحظة الطلب...">${escapeHTML(note || "")}</textarea>
                            </label>

                            <button
                                type="button"
                                class="customer-action success"
                                data-order-save-note="${escapeHTML(id)}">
                                حفظ الملاحظة
                            </button>

                        </div>

                    </td>

                </tr>
            `;

        }).join("");


        node.innerHTML = `
            <div class="customers-table-wrap">

                <table class="customers-table">

                    <thead>
                        <tr>
                            <th>رقم الطلب</th>
                            <th>العميل</th>
                            <th>رقم التواصل</th>
                            <th>المبلغ</th>
                            <th>الحالة</th>
                            <th>التاريخ</th>
                            <th>الإجراءات</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows}
                    </tbody>

                </table>

            </div>
        `;

    }


    /* =====================================================
       20. عرض الرسائل
    ===================================================== */


    /* =====================================================
       نافذة تفاصيل استفسار العميل
    ===================================================== */

    function ensureMessageDetailsStyles() {

        if (document.getElementById("ibr-message-details-styles")) {
            return;
        }

        const style = document.createElement("style");

        style.id = "ibr-message-details-styles";

        style.textContent = `

        .ibr-message-modal {
            position: fixed;
            inset: 0;
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px;
            background: rgba(25, 20, 16, .68);
            backdrop-filter: blur(5px);
        }

        .ibr-message-dialog {
            width: min(900px, 100%);
            max-height: 92vh;
            overflow-y: auto;
            background: #fff;
            border-radius: 18px;
            box-shadow: 0 20px 70px rgba(0,0,0,.25);
            direction: rtl;
            color: #443326;
        }

        .ibr-message-header {
            position: sticky;
            top: 0;
            z-index: 3;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 18px 22px;
            background: #f8f3ed;
            border-bottom: 1px solid #eadfd3;
        }

        .ibr-message-header h2 {
            margin: 0;
            font-size: 20px;
            color: #68452e;
        }

        .ibr-message-close {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 50%;
            background: #eadfd3;
            color: #68452e;
            font-size: 22px;
            cursor: pointer;
        }

        .ibr-message-body {
            padding: 22px;
        }

        .ibr-message-section {
            margin-bottom: 22px;
            padding: 17px;
            border: 1px solid #eee5dc;
            border-radius: 13px;
            background: #fff;
        }

        .ibr-message-section h3 {
            margin: 0 0 15px;
            color: #68452e;
            font-size: 16px;
        }

        .ibr-message-info-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 14px;
        }

        .ibr-message-info-item {
            min-width: 0;
            padding: 11px;
            border-radius: 9px;
            background: #faf7f3;
        }

        .ibr-message-info-item small {
            display: block;
            margin-bottom: 5px;
            color: #927b67;
        }

        .ibr-message-info-item strong {
            display: block;
            overflow-wrap: anywhere;
            color: #443326;
        }

        .ibr-message-full-text {
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            line-height: 1.9;
            padding: 15px;
            border-radius: 10px;
            background: #faf7f3;
            color: #443326;
        }

        .ibr-message-attachments {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
            gap: 12px;
        }

        .ibr-message-attachment {
            display: block;
            padding: 9px;
            border: 1px solid #eadfd3;
            border-radius: 11px;
            color: #68452e;
            text-decoration: none;
            background: #faf7f3;
            overflow-wrap: anywhere;
        }

        .ibr-message-attachment img {
            display: block;
            width: 100%;
            height: 125px;
            object-fit: contain;
            border-radius: 7px;
            background: #fff;
            margin-bottom: 8px;
        }

        .ibr-message-product-image {
            display: block;
            max-width: 220px;
            max-height: 180px;
            object-fit: contain;
            border-radius: 10px;
            margin-top: 12px;
            background: #faf7f3;
        }

        .ibr-message-form label {
            display: block;
            margin: 12px 0 7px;
            font-weight: 600;
            color: #68452e;
        }

        .ibr-message-form textarea,
        .ibr-message-form select {
            width: 100%;
            box-sizing: border-box;
            padding: 12px;
            border: 1px solid #dfd2c5;
            border-radius: 9px;
            font: inherit;
            background: #fff;
            color: #443326;
        }

        .ibr-message-form textarea {
            min-height: 115px;
            resize: vertical;
            line-height: 1.8;
        }

        .ibr-message-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 9px;
            margin-top: 12px;
        }

        .ibr-message-btn {
            padding: 11px 17px;
            border: 0;
            border-radius: 9px;
            background: #68452e;
            color: #fff;
            font: inherit;
            cursor: pointer;
        }

        .ibr-message-btn.secondary {
            background: #eee5dc;
            color: #68452e;
        }

        .ibr-message-btn:disabled {
            opacity: .55;
            cursor: not-allowed;
        }

        .ibr-message-loading {
            padding: 40px 15px;
            text-align: center;
            color: #806b59;
        }

        .ibr-message-unavailable {
            padding: 13px;
            border-radius: 9px;
            background: #faf2e9;
            color: #806b59;
        }

        @media(max-width:600px) {

            .ibr-message-modal {
                padding: 7px;
                align-items: flex-end;
            }

            .ibr-message-dialog {
                max-height: 94vh;
                border-radius: 16px 16px 10px 10px;
            }

            .ibr-message-header,
            .ibr-message-body {
                padding: 15px;
            }

            .ibr-message-info-grid {
                grid-template-columns: 1fr;
            }

            .ibr-message-attachments {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .ibr-message-section {
                padding: 13px;
            }

        }

    `;

        document.head.appendChild(style);
    }


    /* =====================================================
       التحقق من روابط العرض الخارجية
    ===================================================== */

    function getSafeMessageUrl(value) {

        if (!value) return "";

        try {

            const url = new URL(String(value));

            if (
                url.protocol !== "https:" &&
                url.protocol !== "http:"
            ) {
                return "";
            }

            return url.href;

        } catch (_) {

            return "";
        }
    }


    /* =====================================================
       إنشاء النافذة
    ===================================================== */

    function ensureMessageDetailsModal() {

        ensureMessageDetailsStyles();

        let modal = document.getElementById(
            "ibr-message-details-modal"
        );

        if (modal) return modal;

        modal = document.createElement("div");

        modal.id = "ibr-message-details-modal";
        modal.className = "ibr-message-modal";
        modal.hidden = true;

        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "ibr-message-modal-title");

        modal.innerHTML = `
        <div class="ibr-message-dialog">

            <div class="ibr-message-header">

                <h2 id="ibr-message-modal-title">
                    تفاصيل استفسار العميل
                </h2>

                <button
                    type="button"
                    class="ibr-message-close"
                    data-message-modal-close
                    aria-label="إغلاق">
                    ×
                </button>

            </div>

            <div
                class="ibr-message-body"
                data-message-modal-body>

                <div class="ibr-message-loading">
                    جارٍ تحميل تفاصيل الاستفسار...
                </div>

            </div>

        </div>
    `;

        document.body.appendChild(modal);

        return modal;
    }


    /* =====================================================
       إغلاق النافذة
    ===================================================== */

    function closeMessageDetails() {

        const modal = document.getElementById(
            "ibr-message-details-modal"
        );

        if (modal) {
            modal.hidden = true;
        }

        document.body.style.overflow = "";

    }


    /* =====================================================
       عرض تفاصيل الاستفسار
    ===================================================== */

    async function showMessageDetails(messageId) {

        if (!messageId) {
            notify("معرّف الاستفسار غير صالح.", "error");
            return false;
        }

        const modal = ensureMessageDetailsModal();

        const body = modal.querySelector(
            "[data-message-modal-body]"
        );

        modal.dataset.messageId = String(messageId);
        modal.hidden = false;
        document.body.style.overflow = "hidden";

        body.innerHTML = `
        <div class="ibr-message-loading">
            جارٍ تحميل جميع بيانات الاستفسار والمرفقات...
        </div>
    `;

        try {

            const service = getService(
                "IBRMessagesService",
                "getMessageById"
            );

            const message = await service.getMessageById(
                String(messageId)
            );

            if (!message) {
                throw new Error("لم يتم العثور على الاستفسار.");
            }

            // منع عرض نتيجة قديمة إذا فتح المستخدم استفسارًا آخر.
            if (
                modal.dataset.messageId !== String(messageId)
            ) {
                return false;
            }

            renderMessageDetails(message);

            return true;

        } catch (error) {

            console.error("Message details:", error);

            if (
                modal.dataset.messageId === String(messageId)
            ) {

                body.innerHTML = `
                <div class="ibr-message-unavailable">
                    ${escapeHTML(
                    "تعذر تحميل التفاصيل: " +
                    safeErrorMessage(error)
                )}
                </div>
            `;
            }

            return false;
        }
    }


    /* =====================================================
       بناء محتوى تفاصيل الاستفسار
    ===================================================== */

    function renderMessageDetails(message) {

        const modal = document.getElementById(
            "ibr-message-details-modal"
        );

        if (!modal) return;

        const body = modal.querySelector(
            "[data-message-modal-body]"
        );

        if (!body) return;

        const service = window.IBRMessagesService || {};

        const types = service.messageTypes || {};
        const statuses = service.messageStatuses || {};

        const id = String(message.id || "");

        const name = message.customer_name || "—";
        const phone = message.customer_phone || "—";
        const email = message.customer_email || "—";

        const type = types[message.message_type] ||
            message.message_type || "—";

        const status = statuses[message.status] ||
            message.status || "—";

        const subject = message.subject || "بدون عنوان";

        const inquiryNumber = message.inquiry_number || "—";

        const createdAt = formatDate(message.created_at);

        const fullMessage = message.message || "لا يوجد نص للاستفسار.";

        const reply = message.customer_reply || "";
        const note = message.admin_note || "";

        const attachments = Array.isArray(message.attachments)
            ? message.attachments
            : [];

        const availableAttachments = attachments.filter(item =>
            item && item.available && getSafeMessageUrl(item.url)
        );

        const attachmentHTML = attachments.length

            ? availableAttachments.length

                ? availableAttachments.map(item => {

                    const url = getSafeMessageUrl(item.url);
                    const name = item.name || "مرفق";
                    const extension = String(item.type || "").toLowerCase();

                    const isImage = [
                        "jpg",
                        "jpeg",
                        "png",
                        "webp"
                    ].includes(extension);

                    return `
                    <a
                        class="ibr-message-attachment"
                        href="${escapeHTML(url)}"
                        target="_blank"
                        rel="noopener noreferrer">

                        ${isImage
                            ? `
                                    <img
                                        src="${escapeHTML(url)}"
                                        alt="${escapeHTML(name)}"
                                        loading="lazy">
                                `
                            : `
                                    <div style="
                                        padding:25px 5px;
                                        text-align:center;
                                        font-size:28px;">
                                        📎
                                    </div>
                                `
                        }

                        <strong>${escapeHTML(name)}</strong>

                        <small style="display:block;margin-top:5px">
                            ${isImage ? "فتح الصورة بالحجم الكامل" : "فتح المرفق"}
                        </small>

                    </a>
                `;

                }).join("")

                : `
                <div class="ibr-message-unavailable">
                    تعذر إنشاء روابط المرفقات. تحقق من صلاحيات التخزين.
                </div>
            `

            : `
            <div class="ibr-message-unavailable">
                لا توجد مرفقات مع هذا الاستفسار.
            </div>
        `;

        const productImage = getSafeMessageUrl(
            message.product_image_url
        );

        const productHTML = message.product_id || message.product_name

            ? `
            <div class="ibr-message-section">

                <h3>المنتج المرتبط بالاستفسار</h3>

                <div class="ibr-message-info-grid">

                    <div class="ibr-message-info-item">
                        <small>اسم المنتج</small>
                        <strong>
                            ${escapeHTML(message.product_name || "—")}
                        </strong>
                    </div>

                    <div class="ibr-message-info-item">
                        <small>رمز المنتج</small>
                        <strong>
                            ${escapeHTML(message.product_sku || "—")}
                        </strong>
                    </div>

                </div>

                ${productImage
                ? `
                            <a
                                href="${escapeHTML(productImage)}"
                                target="_blank"
                                rel="noopener noreferrer">

                                <img
                                    class="ibr-message-product-image"
                                    src="${escapeHTML(productImage)}"
                                    alt="صورة المنتج"
                                    loading="lazy">

                            </a>
                        `
                : ""
            }

            </div>
        `

            : "";

        body.innerHTML = `

        <div class="ibr-message-section">

            <h3>بيانات العميل والاستفسار</h3>

            <div class="ibr-message-info-grid">

                <div class="ibr-message-info-item">
                    <small>اسم العميل</small>
                    <strong>${escapeHTML(name)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>رقم الجوال</small>
                    <strong dir="ltr">${escapeHTML(phone)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>البريد الإلكتروني</small>
                    <strong dir="ltr">${escapeHTML(email)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>رقم الاستفسار</small>
                    <strong>${escapeHTML(inquiryNumber)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>نوع الاستفسار</small>
                    <strong>${escapeHTML(type)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>حالة الاستفسار</small>
                    <strong>${escapeHTML(status)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>تاريخ الاستفسار</small>
                    <strong>${escapeHTML(createdAt)}</strong>
                </div>

                <div class="ibr-message-info-item">
                    <small>عنوان الاستفسار</small>
                    <strong>${escapeHTML(subject)}</strong>
                </div>

            </div>

        </div>


        <div class="ibr-message-section">

            <h3>نص استفسار العميل كاملًا</h3>

            <div class="ibr-message-full-text">
                ${escapeHTML(fullMessage)}
            </div>

        </div>


        ${productHTML}


        <div class="ibr-message-section">

            <h3>الصور والمرفقات</h3>

            <div class="ibr-message-attachments">
                ${attachmentHTML}
            </div>

        </div>


        <div class="ibr-message-section ibr-message-form">

            <h3>حالة الاستفسار</h3>

            <label>تحديث الحالة</label>

            ${statusSelectHTML("messages", id, message.status)}

        </div>


        <div class="ibr-message-section ibr-message-form">

            <h3>الرد على العميل</h3>

            <label for="ibr-message-reply">
                نص الرد
            </label>

            <textarea
                id="ibr-message-reply"
                data-message-reply="${escapeHTML(id)}"
                maxlength="5000"
                placeholder="اكتب ردك على استفسار العميل...">${escapeHTML(reply)}</textarea>

            <div class="ibr-message-actions">

                <button
                    type="button"
                    class="ibr-message-btn"
                    data-message-save-reply="${escapeHTML(id)}">
                    حفظ الرد
                </button>

                ${phone !== "—"
                ? `
                            <button
                                type="button"
                                class="ibr-message-btn secondary"
                                data-message-whatsapp-reply="${escapeHTML(id)}">
                                تجهيز الرد في واتساب
                            </button>
                        `
                : ""
            }

            </div>

            <p class="admin-muted">
                حفظ الرد يسجل نصه في قاعدة البيانات ويحوّل حالة الاستفسار إلى «تم الرد».
                لا يتم إرسال رسالة واتساب تلقائيًا.
            </p>

        </div>


        <div class="ibr-message-section ibr-message-form">

            <h3>ملاحظة الإدارة الداخلية</h3>

            <label for="ibr-message-admin-note">
                ملاحظة خاصة بالإدارة
            </label>

            <textarea
                id="ibr-message-admin-note"
                data-message-note="${escapeHTML(id)}"
                maxlength="5000"
                placeholder="اكتب ملاحظة داخلية لا تظهر للعميل...">${escapeHTML(note)}</textarea>

            <div class="ibr-message-actions">

                <button
                    type="button"
                    class="ibr-message-btn secondary"
                    data-message-save-note="${escapeHTML(id)}">
                    حفظ الملاحظة الداخلية
                </button>

            </div>

            <p class="admin-muted">
                هذه الملاحظة منفصلة تمامًا عن رد العميل ولا تُعرض للعميل.
            </p>

        </div>

    `;

    }



    function renderMessages() {

        const node = element(
            state.config.selectors.messages
        );

        if (!node) return;


        if (!getTable("messages")) {

            node.innerHTML = `
            <div class="customers-empty">
                <strong>جدول الرسائل غير مربوط</strong>
            </div>
        `;

            return;

        }


        const records = filterRecords(
            state.data.messages,
            "messages"
        );


        if (!records.length) {

            node.innerHTML = `
            <div class="customers-empty">
                <strong>لا توجد استفسارات مطابقة</strong>
            </div>
        `;

            return;

        }


        const rows = records.map((item, index) => {

            const id = getValue(item, "messages", "id");

            const name =
                getValue(item, "messages", "customerName");

            const phone =
                getValue(item, "messages", "customerPhone");

            const message =
                getValue(item, "messages", "message");

            const status =
                getValue(item, "messages", "status");

            const date =
                getValue(item, "messages", "createdAt");


            return `
            <tr>

                <td>
                    ${formatNumber(index + 1)}
                </td>

                <td>
                    <strong>
                        ${escapeHTML(name || "عميل")}
                    </strong>
                </td>

                <td>
                    <span dir="ltr">
                        ${escapeHTML(phone || "—")}
                    </span>
                </td>

                <td>
                    <div class="customer-message-preview">
                        ${escapeHTML(message || "—")}
                    </div>
                </td>

                <td>
                    ${statusHTML(status)}
                </td>

                <td>
                    ${escapeHTML(formatDate(date))}
                </td>

                <td>

                    <div class="customer-actions">

                        ${id
                    ? `
                                    <button
                                        type="button"
                                        class="customer-action"
                                        data-message-details="${escapeHTML(id)}">
                                        عرض التفاصيل
                                    </button>
                                `
                    : ""
                }

                        ${phone
                    ? `
                                    <button
                                        type="button"
                                        class="customer-action"
                                        data-customer-whatsapp="${escapeHTML(phone)}">
                                        واتساب
                                    </button>
                                `
                    : ""
                }

                    </div>

                </td>

            </tr>
        `;

        }).join("");


        node.innerHTML = `

        <div class="customers-table-wrap">

            <table class="customers-table">

                <thead>

                    <tr>

                        <th>#</th>
                        <th>اسم العميل</th>
                        <th>رقم التواصل</th>
                        <th>نص الاستفسار</th>
                        <th>الحالة</th>
                        <th>التاريخ</th>
                        <th>الإجراءات</th>

                    </tr>

                </thead>

                <tbody>
                    ${rows}
                </tbody>

            </table>

        </div>

    `;

    }


    /* =====================================================
       21. التقييمات
    ===================================================== */

    function renderReviews() {

        // التقييمات أصبحت تحت إدارة المتحكم المستقل.
        if (window.IBRAdminReviews) {
            return [];
        }

        const node = element(
            state.config.selectors.reviews
        );

        if (!node) return;


        node.innerHTML = `
            <div class="customers-empty">
                <strong>التقييمات غير مفعلة حاليًا</strong>
                <p>
                    لم يتم ربط هذا القسم لعدم تأكيد وجود جدول
                    تقييمات في قاعدة البيانات.
                </p>
            </div>
        `;

    }


    /* =====================================================
       22. عرض جميع الأقسام
    ===================================================== */

    function renderAll() {

        updateCounts();

        renderOrders();

        renderMessages();

        renderReviews();

    }


    /* =====================================================
       23. أرقام الهواتف وواتساب
    ===================================================== */

    function normalizePhone(phone) {

        let value = String(phone || "")
            .replace(/\D/g, "");


        if (value.startsWith("00")) {

            value = value.slice(2);

        }


        const countryCode = String(
            state.config.whatsappCountryCode || "966"
        ).replace(/\D/g, "");


        if (value.startsWith("0")) {

            value = countryCode + value.slice(1);

        } else if (
            value.length === 9 &&
            value.startsWith("5")
        ) {

            value = countryCode + value;

        }


        return value;

    }


    function openWhatsApp(phone) {

        const number = normalizePhone(phone);


        if (!/^9665\d{8}$/.test(number)) {

            notify(
                "رقم الهاتف غير صالح لفتح واتساب.",
                "error"
            );

            return false;

        }


        const url = "https://wa.me/" + number;


        window.open(
            url,
            "_blank",
            "noopener,noreferrer"
        );


        return true;

    }


    /* =====================================================
       24. نسخ البيانات
    ===================================================== */

    async function copyText(value) {

        const text = String(value ?? "");

        if (!text) {

            notify("لا توجد بيانات لنسخها.", "error");

            return false;

        }


        try {

            if (
                navigator.clipboard &&
                window.isSecureContext
            ) {

                await navigator.clipboard.writeText(text);

            } else {

                const textarea =
                    document.createElement("textarea");

                textarea.value = text;

                textarea.style.position = "fixed";

                textarea.style.opacity = "0";

                document.body.appendChild(textarea);

                textarea.select();

                const copied =
                    document.execCommand("copy");

                textarea.remove();

                if (!copied) {

                    throw new Error("تعذر النسخ.");

                }

            }


            notify("تم النسخ بنجاح.", "success");

            return true;


        } catch (error) {

            console.error(error);

            notify("تعذر النسخ من المتصفح.", "error");

            return false;

        }

    }


    /* =====================================================
       25. ملف العميل الموحد
    ===================================================== */
    /* =========================================================
       استبدال دالتي ملف العميل في admin-customers.js
       استبدل getCustomerProfile و showCustomerProfile الحاليتين
       بهاتين الدالتين فقط. لا تستبدل الملف كاملاً.
    ========================================================= */

    async function getCustomerProfile(phone, options = {}) {
        if (!phone) {
            throw new Error("رقم هاتف العميل غير متوفر.");
        }

        const service = getService(
            "IBRCustomerProfile",
            "getProfileByPhone"
        );

        return service.getProfileByPhone(
            normalizePhone(phone),
            options
        );
    }


    async function showCustomerProfile(phone) {
        const escape = value => escapeHTML(value ?? "—");
        const value = (...items) => items.find(item =>
            item !== undefined && item !== null && String(item).trim() !== ""
        );
        const safeImage = url => {
            if (!url || typeof url !== "string") return "";
            try {
                const parsed = new URL(url, window.location.href);
                return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
            } catch (_) {
                return "";
            }
        };
        const formatDateTime = date => {
            if (!date) return "—";
            const parsed = new Date(date);
            if (Number.isNaN(parsed.getTime())) return "—";
            return new Intl.DateTimeFormat("ar-SA", {
                timeZone: "Asia/Riyadh",
                dateStyle: "medium",
                timeStyle: "short"
            }).format(parsed);
        };
        const statusText = status => {
            const labels = {
                new: "جديد",
                contacting: "جارٍ التواصل",
                confirmed: "مؤكد",
                preparing: "قيد التجهيز",
                shipped: "تم الشحن",
                delivered: "تم التسليم",
                cancelled: "ملغي",
                answered: "تمت الإجابة",
                in_review: "قيد المراجعة",
                closed: "مغلق"
            };
            return labels[status] || status || "غير محدد";
        };

        try {
            const profile = await getCustomerProfile(phone, {
                ordersLimit: 500,
                messagesLimit: 500
            });

            if (!profile) {
                notify("لم يتم العثور على ملف لهذا العميل.", "info");
                return null;
            }

            state.activeCustomer = profile;

            const oldModal = document.getElementById("ibr-customer-profile-modal");
            if (oldModal) oldModal.remove();

            const customer = profile.customer || {};
            const details = profile.details || customer;
            const stats = profile.stats || {};
            const orders = Array.isArray(profile.orders) ? profile.orders : [];
            const messages = Array.isArray(profile.messages) ? profile.messages : [];
            const products = Array.isArray(profile.products) ? profile.products : [];

            const customerName = value(
                details.name, customer.name, customer.customer_name,
                customer.customerName, "عميل"
            );
            const customerPhone = value(
                details.phone, customer.phone, customer.customer_phone,
                customer.customerPhone, phone
            );
            const customerEmail = value(
                details.email, customer.email, customer.customer_email
            );
            const segmentService = window.IBRCustomerProfile;
            const segment = segmentService &&
                typeof segmentService.getCustomerSegment === "function"
                ? segmentService.getCustomerSegment(profile)
                : "unknown";
            const segmentLabel = segmentService?.segmentLabels?.[segment] || "غير مصنف";

            const orderCards = orders.map(order => {
                const items = Array.isArray(order.items) ? order.items : [];
                const itemCards = items.length ? items.map(item => {
                    const image = safeImage(item.product_image_url);
                    const name = value(item.product_name, "منتج");
                    const quantity = Number(item.quantity) || 0;
                    const unitPrice = Number(item.unit_price) || 0;
                    const lineTotal = Number(item.line_total) ||
                        (unitPrice * quantity);

                    return `
                    <article class="ibr-profile-product">
                        ${image
                            ? `<a href="${escape(image)}" target="_blank" rel="noopener noreferrer">
                                <img src="${escape(image)}" alt="${escape(name)}" loading="lazy">
                               </a>`
                            : `<div class="ibr-profile-product__placeholder" aria-label="لا توجد صورة">صورة غير متاحة</div>`
                        }
                        <div class="ibr-profile-product__info">
                            <strong>${escape(name)}</strong>
                            <small>الكمية: ${formatNumber(quantity)}</small>
                            ${item.product_sku
                            ? `<small>رمز المنتج: ${escape(item.product_sku)}</small>`
                            : ""}
                            <small>سعر الوحدة: ${escape(formatCurrency(unitPrice))}</small>
                            <b>${escape(formatCurrency(lineTotal))}</b>
                        </div>
                    </article>
                `;
                }).join("") : `<p class="ibr-profile-muted">لا توجد تفاصيل منتجات مسجلة لهذا الطلب.</p>`;

                return `
                <section class="ibr-profile-order">
                    <header class="ibr-profile-order__header">
                        <div>
                            <strong>طلب #${escape(value(order.order_number, order.id))}</strong>
                            <small>${escape(formatDateTime(order.created_at))}</small>
                        </div>
                        <span class="ibr-profile-status">${escape(statusText(order.status))}</span>
                    </header>
                    <div class="ibr-profile-order__amount">
                        <span>إجمالي الطلب</span>
                        <strong>${escape(formatCurrency(order.total_amount))}</strong>
                    </div>
                    <div class="ibr-profile-products">${itemCards}</div>
                    <details class="ibr-profile-order__details">
                        <summary>بيانات التوصيل والطلب</summary>
                        <div class="ibr-profile-detail-grid">
                            <div><small>المدينة</small><b>${escape(order.city)}</b></div>
                            <div><small>الحي</small><b>${escape(order.neighborhood)}</b></div>
                            <div class="wide"><small>العنوان</small><b>${escape(order.address)}</b></div>
                            <div><small>طريقة الدفع</small><b>${escape(order.payment_method)}</b></div>
                            <div><small>موعد التسليم المتوقع</small><b>${escape(order.expected_delivery_date)}</b></div>
                            <div class="wide"><small>ملاحظة العميل</small><b>${escape(order.customer_note)}</b></div>
                            <div class="wide"><small>ملاحظة الإدارة الداخلية</small><b>${escape(order.admin_note)}</b></div>
                        </div>
                    </details>
                </section>
            `;
            }).join("");

            const messageCards = messages.map(message => `
            <article class="ibr-profile-message">
                <header>
                    <strong>${escape(value(message.subject, message.message_type, "استفسار"))}</strong>
                    <span>${escape(statusText(message.status))}</span>
                </header>
                <small>${escape(formatDateTime(message.created_at))}</small>
                <p>${escape(message.message)}</p>
                ${message.customer_reply
                    ? `<div class="ibr-profile-reply"><small>رد العميل</small><p>${escape(message.customer_reply)}</p></div>`
                    : ""}
                ${message.inquiry_number
                    ? `<small>رقم الاستفسار: ${escape(message.inquiry_number)}</small>`
                    : ""}
            </article>
        `).join("");

            const productSummary = products.slice(0, 8).map(product => {
                const image = safeImage(product.product_image_url);
                return `
                <div class="ibr-profile-top-product">
                    ${image
                        ? `<img src="${escape(image)}" alt="${escape(product.product_name)}" loading="lazy">`
                        : `<div class="ibr-profile-product__placeholder">—</div>`}
                    <span>${escape(product.product_name)}</span>
                    <b>${formatNumber(product.quantity)}</b>
                </div>
            `;
            }).join("");

            const modal = document.createElement("div");
            modal.id = "ibr-customer-profile-modal";
            modal.className = "customer-detail-modal";
            modal.setAttribute("role", "dialog");
            modal.setAttribute("aria-modal", "true");
            modal.setAttribute("aria-label", "ملف العميل");

            modal.innerHTML = `
            <style>
                #ibr-customer-profile-modal{position:fixed;inset:0;z-index:99999;background:rgba(20,18,15,.68);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto}
                #ibr-customer-profile-modal .customer-detail-modal__content{position:relative;background:#fffdf9;color:#30271f;width:min(1100px,100%);max-height:92vh;overflow:auto;border-radius:18px;padding:24px;box-shadow:0 20px 70px rgba(0,0,0,.25);direction:rtl}
                #ibr-customer-profile-modal .customer-detail-modal__close{position:sticky;top:0;float:left;border:0;border-radius:9px;padding:9px 15px;background:#34271e;color:#fff;cursor:pointer;z-index:2}
                #ibr-customer-profile-modal h2{margin:0 0 8px;font-size:1.5rem}
                #ibr-customer-profile-modal h3{margin:10px 0 4px;font-size:1.3rem}
                #ibr-customer-profile-modal .ibr-profile-muted,#ibr-customer-profile-modal small{color:#827568}
                #ibr-customer-profile-modal .ibr-profile-identity{display:flex;flex-wrap:wrap;gap:8px 18px;margin:10px 0 18px}
                #ibr-customer-profile-modal .ibr-profile-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px;margin:18px 0}
                #ibr-customer-profile-modal .ibr-profile-stat{background:#f5efe7;border:1px solid #e9dfd3;border-radius:12px;padding:13px}
                #ibr-customer-profile-modal .ibr-profile-stat strong{display:block;font-size:1.2rem;margin-bottom:4px}
                #ibr-customer-profile-modal .ibr-profile-stat span{font-size:.83rem;color:#76695d}
                #ibr-customer-profile-modal .ibr-profile-section{margin-top:24px}
                #ibr-customer-profile-modal .ibr-profile-section>h3{border-bottom:1px solid #e8dfd5;padding-bottom:10px}
                #ibr-customer-profile-modal .ibr-profile-personal,#ibr-customer-profile-modal .ibr-profile-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
                #ibr-customer-profile-modal .ibr-profile-personal>div,#ibr-customer-profile-modal .ibr-profile-detail-grid>div{background:#faf7f2;padding:11px;border-radius:9px;min-width:0}
                #ibr-customer-profile-modal .ibr-profile-personal small,#ibr-customer-profile-modal .ibr-profile-detail-grid small{display:block;margin-bottom:5px}
                #ibr-customer-profile-modal .ibr-profile-personal b,#ibr-customer-profile-modal .ibr-profile-detail-grid b{display:block;overflow-wrap:anywhere;font-weight:600}
                #ibr-customer-profile-modal .wide{grid-column:1/-1}
                #ibr-customer-profile-modal .ibr-profile-order{border:1px solid #e9e0d7;border-radius:13px;padding:15px;margin:12px 0}
                #ibr-customer-profile-modal .ibr-profile-order__header{display:flex;justify-content:space-between;gap:12px;align-items:center}
                #ibr-customer-profile-modal .ibr-profile-order__header small{display:block;margin-top:5px}
                #ibr-customer-profile-modal .ibr-profile-status{background:#f0e8de;border-radius:30px;padding:6px 10px;font-size:.82rem;white-space:nowrap}
                #ibr-customer-profile-modal .ibr-profile-order__amount{display:flex;justify-content:space-between;margin:13px 0;padding:10px;background:#faf7f2;border-radius:8px}
                #ibr-customer-profile-modal .ibr-profile-products{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
                #ibr-customer-profile-modal .ibr-profile-product{display:flex;gap:10px;align-items:center;border:1px solid #eee5dc;border-radius:10px;padding:9px;min-width:0}
                #ibr-customer-profile-modal .ibr-profile-product img{width:82px;height:82px;object-fit:cover;border-radius:8px;display:block}
                #ibr-customer-profile-modal .ibr-profile-product__placeholder{width:82px;height:82px;display:grid;place-items:center;text-align:center;background:#eee8df;border-radius:8px;color:#887b6c;font-size:.75rem;flex-shrink:0}
                #ibr-customer-profile-modal .ibr-profile-product__info{display:grid;gap:4px;min-width:0}
                #ibr-customer-profile-modal .ibr-profile-product__info strong{overflow-wrap:anywhere}
                #ibr-customer-profile-modal .ibr-profile-product__info small{font-size:.78rem}
                #ibr-customer-profile-modal details{margin-top:12px}
                #ibr-customer-profile-modal summary{cursor:pointer;font-weight:600;padding:8px 0}
                #ibr-customer-profile-modal .ibr-profile-message{padding:13px;border:1px solid #eee5dc;border-radius:10px;margin:10px 0}
                #ibr-customer-profile-modal .ibr-profile-message header{display:flex;justify-content:space-between;gap:10px}
                #ibr-customer-profile-modal .ibr-profile-message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}
                #ibr-customer-profile-modal .ibr-profile-reply{background:#f5efe7;border-radius:8px;padding:8px 12px}
                #ibr-customer-profile-modal .ibr-profile-top-product{display:flex;align-items:center;gap:9px;padding:8px;border-bottom:1px solid #eee}
                #ibr-customer-profile-modal .ibr-profile-top-product img{width:48px;height:48px;object-fit:cover;border-radius:7px}
                #ibr-customer-profile-modal .ibr-profile-top-product span{flex:1}
                @media(max-width:600px){#ibr-customer-profile-modal{padding:7px}#ibr-customer-profile-modal .customer-detail-modal__content{padding:15px;max-height:96vh}#ibr-customer-profile-modal .ibr-profile-order__header{align-items:flex-start}}
            </style>
            <div class="customer-detail-modal__content">
                <button type="button" class="customer-detail-modal__close" data-profile-close>إغلاق ✕</button>
                <h2>ملف العميل</h2>
                <h3>${escape(customerName)}</h3>
                <div class="ibr-profile-identity">
                    <span dir="ltr">${escape(customerPhone)}</span>
                    ${customerEmail ? `<span>${escape(customerEmail)}</span>` : ""}
                    <span>التصنيف: ${escape(segmentLabel)}</span>
                </div>

                <div class="ibr-profile-stats">
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.totalOrders || 0)}</strong><span>إجمالي الطلبات</span></div>
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.validOrders || 0)}</strong><span>طلبات غير ملغاة</span></div>
                    <div class="ibr-profile-stat"><strong>${escape(formatCurrency(stats.nonCancelledOrderValue || 0))}</strong><span>قيمة الطلبات غير الملغاة وليست تحصيلاً</span></div>
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.totalItems || 0)}</strong><span>إجمالي القطع المطلوبة</span></div>
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.deliveredOrders || 0)}</strong><span>طلبات تم تسليمها</span></div>
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.pendingOrders || 0)}</strong><span>طلبات قيد التنفيذ</span></div>
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.totalMessages || 0)}</strong><span>الاستفسارات</span></div>
                    <div class="ibr-profile-stat"><strong>${formatNumber(stats.unansweredMessages || 0)}</strong><span>استفسارات غير مجابة</span></div>
                </div>

                <section class="ibr-profile-section">
                    <h3>البيانات الشخصية وبيانات التواصل المتاحة</h3>
                    <div class="ibr-profile-personal">
                        <div><small>الاسم</small><b>${escape(customerName)}</b></div>
                        <div><small>رقم الهاتف</small><b dir="ltr">${escape(customerPhone)}</b></div>
                        <div><small>البريد الإلكتروني</small><b>${escape(customerEmail)}</b></div>
                        <div><small>المدينة</small><b>${escape(details.city)}</b></div>
                        <div><small>الحي</small><b>${escape(details.neighborhood)}</b></div>
                        <div class="wide"><small>العنوان</small><b>${escape(details.address)}</b></div>
                        <div class="wide"><small>ملاحظة العميل</small><b>${escape(details.customer_note)}</b></div>
                        <div><small>آخر نشاط مسجل</small><b>${escape(formatDateTime(profile.latestActivity))}</b></div>
                    </div>
                    <p class="ibr-profile-muted">تُعرض البيانات التي وردت فعلياً في سجلات العميل والطلبات؛ الحقول غير المسجلة تظهر بشرطة.</p>
                </section>

                <section class="ibr-profile-section">
                    <h3>الطلبات والمنتجات والصور (${formatNumber(orders.length)})</h3>
                    ${orderCards || `<p class="ibr-profile-muted">لا توجد طلبات مسجلة لهذا العميل.</p>`}
                </section>

                <section class="ibr-profile-section">
                    <h3>أكثر المنتجات طلباً</h3>
                    ${productSummary || `<p class="ibr-profile-muted">لا تتوفر بيانات كافية لملخص المنتجات.</p>`}
                </section>

                <section class="ibr-profile-section">
                    <h3>الاستفسارات والمراسلات (${formatNumber(messages.length)})</h3>
                    ${messageCards || `<p class="ibr-profile-muted">لا توجد استفسارات مسجلة لهذا العميل.</p>`}
                </section>
            </div>
        `;

            document.body.appendChild(modal);

            // إغلاق بالنقر على خلفية النافذة مع الإبقاء على مستمع الإغلاق الحالي.
            modal.addEventListener("click", event => {
                if (event.target === modal) modal.remove();
            });

            return profile;
        } catch (error) {
            console.error("Customer profile:", error);
            notify(
                "تعذر تحميل ملف العميل: " + safeErrorMessage(error),
                "error"
            );
            return null;
        }
    }

    /* =====================================================
       26. السجل الزمني للطلب
    ===================================================== */

    function getOrderTimeline(order) {

        const service = getService(
            "IBROrderTimeline",
            "buildTimeline"
        );


        return service.buildTimeline(order);

    }


    /* =====================================================
       27. المهام
       التخزين الحالي في الذاكرة فقط
    ===================================================== */

    function getCustomerTasks(options = {}) {

        const service = getService(
            "IBRCustomerTasks",
            "getTasks"
        );


        return service.getTasks(options);

    }


    function createCustomerTask(taskData) {

        const service = getService(
            "IBRCustomerTasks",
            "createTask"
        );


        return service.createTask(taskData);

    }


    function updateCustomerTask(taskId, updates) {

        const service = getService(
            "IBRCustomerTasks",
            "updateTask"
        );


        return service.updateTask(
            taskId,
            updates
        );

    }


    function completeCustomerTask(taskId) {

        const service = getService(
            "IBRCustomerTasks",
            "completeTask"
        );


        return service.completeTask(taskId);

    }


    function deleteCustomerTask(taskId) {

        const service = getService(
            "IBRCustomerTasks",
            "deleteTask"
        );


        return service.deleteTask(taskId);

    }


    function createOrderFollowupTasks() {

        const service = getService(
            "IBRCustomerTasks",
            "createOrderFollowupTasks"
        );


        return service.createOrderFollowupTasks(
            state.data.orders
        );

    }


    function createMessageFollowupTasks() {

        const service = getService(
            "IBRCustomerTasks",
            "createMessageFollowupTasks"
        );


        return service.createMessageFollowupTasks(
            state.data.messages
        );

    }


    /* =====================================================
       28. التقارير
       تعتمد على خدمة التقارير الحالية
    ===================================================== */

    function getReportsService() {

        return getService(
            "IBRCustomerReports",
            "getCustomerReports"
        );

    }


    async function getCustomerReports(options = {}) {

        const service = window.IBRCustomerReports;

        if (!service) {

            throw new Error(
                "خدمة تقارير العملاء غير متوفرة."
            );

        }


        if (
            typeof service.getCustomerReports === "function"
        ) {

            return service.getCustomerReports(options);

        }


        if (
            typeof service.generateReports === "function"
        ) {

            return service.generateReports(options);

        }


        throw new Error(
            "لم يتم العثور على دالة إنشاء التقارير."
        );

    }


    /* =====================================================
       29. التواصل مع العملاء
    ===================================================== */

    function getCommunicationsService() {

        return getService(
            "IBRCustomerCommunications",
            "getCommunicationHistory"
        );

    }


    function getCommunicationHistory(options = {}) {

        const service = getCommunicationsService();

        return service.getCommunicationHistory(options);

    }


    function getCommunicationStats() {

        const service = getService(
            "IBRCustomerCommunications",
            "getCommunicationStats"
        );

        return service.getCommunicationStats();

    }


    function buildCustomerWhatsAppMessage(type, data) {

        const service = getService(
            "IBRCustomerCommunications",
            "buildMessage"
        );

        return service.buildMessage(type, data);

    }


    /* =====================================================
       30. التبويبات
    ===================================================== */

    function bindTabs() {

        document.querySelectorAll(
            state.config.selectors.tabs
        ).forEach(tab => {

            if (tab.dataset.customerTabBound) return;

            tab.dataset.customerTabBound = "true";


            tab.addEventListener("click", () => {

                const target =
                    tab.dataset.customersTab;


                document.querySelectorAll(
                    state.config.selectors.tabs
                ).forEach(item => {

                    const active = item === tab;

                    item.classList.toggle(
                        "active",
                        active
                    );

                    item.setAttribute(
                        "aria-selected",
                        active ? "true" : "false"
                    );

                });


                document.querySelectorAll(
                    state.config.selectors.panels
                ).forEach(panel => {

                    panel.hidden =
                        panel.dataset.customersPanel !== target;

                });

            });

        });

    }


    /* =====================================================
       31. الملاحظات
    ===================================================== */

    function toggleControlRow(button, selector) {

        const id =
            button.dataset.orderNoteToggle ||
            button.dataset.messageNoteToggle;

        const rows = document.querySelectorAll(selector);

        rows.forEach(row => {

            const control = row.querySelector(
                "textarea"
            );

            if (!control) return;

            const matches =
                control.dataset.orderNote === id ||
                control.dataset.messageNote === id;

            if (matches) {

                row.hidden = !row.hidden;

            }

        });

    }


    /* =====================================================
       32. ربط الإجراءات
    ===================================================== */

    function bindActions() {

        if (document.body.dataset.customerActionsBound) {
            return;
        }

        document.body.dataset.customerActionsBound = "true";


        // جميع إجراءات النقر
        document.addEventListener("click", async event => {

            const target = event.target;

            if (!(target instanceof Element)) return;


            // إغلاق نافذة تفاصيل الاستفسار
            const messageModalClose = target.closest(
                "[data-message-modal-close]"
            );

            if (messageModalClose) {
                closeMessageDetails();
                return;
            }


            // إغلاق النافذة بالنقر على الخلفية
            if (
                target.id === "ibr-message-details-modal" &&
                (
                    target.classList.contains("ibr-message-modal") ||
                    target.classList.contains("ibr-message-overlay")
                )
            ) {
                closeMessageDetails();
                return;
            }


            // فتح تفاصيل الاستفسار
            const messageDetails = target.closest(
                "[data-message-details]"
            );

            if (messageDetails) {
                await showMessageDetails(
                    messageDetails.dataset.messageDetails
                );
                return;
            }


            // حفظ رد الإدارة
            const messageReplySave = target.closest(
                "[data-message-save-reply]"
            );

            if (messageReplySave) {

                const id =
                    messageReplySave.dataset.messageSaveReply;

                const textarea = document.querySelector(
                    `[data-message-reply="${CSS.escape(String(id))}"]`
                );

                if (!textarea) {
                    notify("تعذر العثور على خانة الرد.", "error");
                    return;
                }

                const reply = textarea.value.trim();

                if (!reply) {
                    notify("اكتب الرد قبل الحفظ.", "error");
                    textarea.focus();
                    return;
                }

                messageReplySave.disabled = true;

                try {

                    const success = await saveMessageReply(id, reply);

                    if (success) {
                        await showMessageDetails(id);
                    }

                } finally {
                    messageReplySave.disabled = false;
                }

                return;
            }


            // تجهيز الرد في واتساب
            const whatsappReply = target.closest(
                "[data-message-whatsapp-reply]"
            );

            if (whatsappReply) {

                const id =
                    whatsappReply.dataset.messageWhatsappReply;

                const textarea = document.querySelector(
                    `[data-message-reply="${CSS.escape(String(id))}"]`
                );

                const record = state.data.messages.find(item =>
                    String(getValue(item, "messages", "id")) ===
                    String(id)
                );

                if (!textarea || !textarea.value.trim() || !record) {
                    notify(
                        "اكتب الرد أولًا وتأكد من وجود بيانات الاستفسار.",
                        "error"
                    );
                    return;
                }

                try {

                    const service = getService(
                        "IBRMessagesService",
                        "buildWhatsAppReply"
                    );

                    const message = service.buildWhatsAppReply(
                        record,
                        textarea.value.trim()
                    );

                    const urlService = getService(
                        "IBRMessagesService",
                        "buildWhatsAppUrl"
                    );

                    const url = urlService.buildWhatsAppUrl(
                        record.customer_phone,
                        message
                    );

                    if (!url) {
                        throw new Error("تعذر إنشاء رابط واتساب.");
                    }

                    window.open(
                        url,
                        "_blank",
                        "noopener,noreferrer"
                    );

                } catch (error) {

                    console.error("WhatsApp reply:", error);

                    notify(
                        safeErrorMessage(error),
                        "error"
                    );

                }

                return;
            }


            // فتح واتساب
            const whatsapp = target.closest(
                "[data-customer-whatsapp]"
            );

            if (whatsapp) {
                openWhatsApp(
                    whatsapp.dataset.customerWhatsapp
                );
                return;
            }


            // نسخ البيانات
            const copy = target.closest(
                "[data-customer-copy]"
            );

            if (copy) {
                await copyText(
                    copy.dataset.customerCopy
                );
                return;
            }


            // فتح ملف العميل
            const profile = target.closest(
                "[data-customer-profile]"
            );

            if (profile) {
                await showCustomerProfile(
                    profile.dataset.customerProfile
                );
                return;
            }


            // إغلاق ملف العميل
            const profileClose = target.closest(
                "[data-profile-close]"
            );

            if (profileClose) {

                const modal = document.getElementById(
                    "ibr-customer-profile-modal"
                );

                if (modal) modal.remove();

                return;
            }


            // حفظ ملاحظة الطلب
            const orderSave = target.closest(
                "[data-order-save-note]"
            );

            if (orderSave) {

                const id = orderSave.dataset.orderSaveNote;

                const textarea = document.querySelector(
                    `[data-order-note="${CSS.escape(String(id))}"]`
                );

                if (!textarea) {
                    notify("تعذر العثور على ملاحظة الطلب.", "error");
                    return;
                }

                orderSave.disabled = true;

                try {
                    await saveOrderNote(id, textarea.value);
                } finally {
                    orderSave.disabled = false;
                }

                return;
            }


            // حفظ ملاحظة الرسالة
            const messageSave = target.closest(
                "[data-message-save-note]"
            );

            if (messageSave) {

                const id = messageSave.dataset.messageSaveNote;

                const textarea = document.querySelector(
                    `[data-message-note="${CSS.escape(String(id))}"]`
                );

                if (!textarea) {
                    notify("تعذر العثور على ملاحظة الرسالة.", "error");
                    return;
                }

                messageSave.disabled = true;

                try {
                    await saveMessageNote(id, textarea.value);
                } finally {
                    messageSave.disabled = false;
                }

                return;
            }


            // إظهار أو إخفاء ملاحظة الطلب
            const orderToggle = target.closest(
                "[data-order-note-toggle]"
            );

            if (orderToggle) {

                toggleControlRow(
                    orderToggle,
                    ".customer-order-controls"
                );

                return;
            }


            // إظهار أو إخفاء ملاحظة الرسالة
            const messageToggle = target.closest(
                "[data-message-note-toggle]"
            );

            if (messageToggle) {

                toggleControlRow(
                    messageToggle,
                    ".customer-message-control-row"
                );

                return;
            }

        });


        // تحديث حالة الطلب أو الاستفسار
        document.addEventListener("change", async event => {

            const target = event.target;

            if (!(target instanceof Element)) return;

            const statusSelect = target.closest(
                "[data-customer-status-group]"
            );

            if (!statusSelect) return;

            const group =
                statusSelect.dataset.customerStatusGroup;

            const id =
                statusSelect.dataset.customerStatusId;

            const newStatus = statusSelect.value;

            if (group !== "orders" && group !== "messages") {
                return;
            }

            const records = group === "orders"
                ? state.data.orders
                : state.data.messages;

            const previousRecord = records.find(item =>
                String(getValue(item, group, "id")) === String(id)
            );

            const previousStatus = previousRecord
                ? getValue(previousRecord, group, "status")
                : null;

            if (
                previousStatus &&
                previousStatus !== newStatus &&
                !window.confirm("هل تريد تغيير حالة هذا السجل؟")
            ) {
                statusSelect.value = previousStatus;
                return;
            }

            statusSelect.disabled = true;

            try {


                let result = false;

                if (group === "orders") {

                    result = await updateOrderStatus(id, newStatus);

                    // إنشاء دعوة تقييم عند انتقال الطلب لأول مرة إلى تم التسليم.
                    if (
                        result &&
                        newStatus === "delivered" &&
                        previousStatus !== "delivered"
                    ) {

                        await prepareReviewInvitation(id);
                    }

                } else {

                    result = await updateMessageStatus(id, newStatus);

                }

                if (!result && previousStatus) {
                    statusSelect.value = previousStatus;
                }


            } catch (error) {

                console.error("Update record status:", error);

                if (previousStatus) {
                    statusSelect.value = previousStatus;
                }

            } finally {

                statusSelect.disabled = false;

            }

        });


        // إغلاق نافذة التفاصيل بزر Escape
        document.addEventListener("keydown", event => {

            if (event.key === "Escape") {
                closeMessageDetails();
            }

        });


        /* =========================================================
           أحداث نافذة دعوة التقييم
        ========================================================= */

        document.addEventListener("click", async event => {

            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            // إغلاق النافذة.
            const closeButton = target.closest(
                "[data-review-invitation-close]"
            );

            if (closeButton) {

                document.getElementById(
                    "ibr-review-invitation-modal"
                )?.remove();

                return;
            }

            // نسخ رابط التقييم.
            const copyButton = target.closest(
                "[data-review-invitation-copy]"
            );

            if (copyButton) {

                const modal = document.getElementById(
                    "ibr-review-invitation-modal"
                );

                const urlInput = modal?.querySelector(
                    "[data-review-invitation-url]"
                );

                if (!urlInput || !urlInput.value) {
                    notify("رابط التقييم غير موجود.", "error");
                    return;
                }

                try {

                    await navigator.clipboard.writeText(
                        urlInput.value
                    );

                    copyButton.textContent = "تم نسخ الرابط";

                    notify(
                        "تم نسخ رابط التقييم بنجاح.",
                        "success"
                    );

                } catch (error) {

                    // بديل النسخ للمتصفحات التي لا تسمح بـ Clipboard API.
                    urlInput.focus();
                    urlInput.select();

                    const copied = document.execCommand("copy");

                    if (copied) {
                        copyButton.textContent = "تم نسخ الرابط";

                        notify(
                            "تم نسخ رابط التقييم بنجاح.",
                            "success"
                        );
                    } else {
                        notify(
                            "تعذر النسخ تلقائيًا. حدد الرابط وانسخه يدويًا.",
                            "error"
                        );
                    }
                }

                return;
            }

            // إنشاء دعوة تقييم من الزر الموجود في الطلب.
            const invitationButton = target.closest(
                "[data-review-invitation]"
            );

            if (invitationButton) {

                const orderId =
                    invitationButton.dataset.reviewInvitation;

                if (!orderId) {
                    notify("معرّف الطلب غير موجود.", "error");
                    return;
                }

                invitationButton.disabled = true;

                const originalText = invitationButton.textContent;

                invitationButton.textContent = "جارٍ التجهيز...";

                try {

                    await prepareReviewInvitation(orderId);

                } finally {

                    invitationButton.disabled = false;

                    invitationButton.textContent = originalText;
                }

                return;
            }

        });


    }

    /* =====================================================
       33. زر تحديث البيانات
    ===================================================== */

    function bindRefresh() {

        const button = element(
            state.config.selectors.refresh
        );

        if (
            !button ||
            button.dataset.customerRefreshBound
        ) {

            return;

        }


        button.dataset.customerRefreshBound = "true";


        button.addEventListener("click", () => {

            load();

        });

    }


    /* =====================================================
       34. ربط جميع الأحداث
    ===================================================== */

    function bindEvents() {

        bindSearch();

        bindFilters();

        bindTabs();

        bindActions();

        bindRefresh();

    }


    /* =====================================================
       35. التحقق من المدير
    ===================================================== */

    async function verifyAdminAccess() {

        const admin = window.IBRAdmin;

        if (
            !admin ||
            typeof admin.requireAdmin !== "function"
        ) {

            throw new Error(
                "نظام التحقق من صلاحية المدير غير متوفر."
            );

        }


        if (
            typeof admin.isAdminVerified === "function" &&
            admin.isAdminVerified() === true
        ) {

            return true;

        }


        const result = await admin.requireAdmin({

            redirectTo: "admin.html"

        });


        if (result === false) return false;


        if (
            typeof admin.isAdminVerified === "function" &&
            admin.isAdminVerified() !== true
        ) {

            return false;

        }


        return true;

    }


    /* =====================================================
       36. تهيئة النظام
    ===================================================== */

    async function init(options = {}) {

        if (state.initialized && state.loading) {

            return {

                success: false,

                busy: true

            };

        }


        state.config = mergeConfig(
            DEFAULTS,
            options
        );


        state.client =
            options.client ||
            window.supabaseClient ||
            null;


        configureServices();

        bindEvents();

        state.initialized = true;


        if (options.autoLoad === false) {

            return {

                success: true,

                initialized: true

            };

        }


        try {

            validateClient();

            const verified =
                await verifyAdminAccess();


            if (!verified) {

                return {

                    success: false,

                    unauthorized: true

                };

            }

        } catch (error) {

            console.error(
                "IBR Admin verification:",
                error
            );

            showError(
                "تعذر التحقق من صلاحية المدير: " +
                safeErrorMessage(error)
            );


            return {

                success: false,

                unauthorized: true,

                error

            };

        }


        return load();

    }


    /* =====================================================
       37. تحديث الإعدادات
    ===================================================== */

    function configure(options = {}) {

        state.config = mergeConfig(
            state.config,
            options
        );


        if (options.client) {

            state.client = options.client;

            configureServices();

        }


        bindEvents();

        return state.config;

    }


    /* =====================================================
       38. الواجهة العامة
    ===================================================== */

    window.IBRAdminCustomers = {

        init,

        configure,

        load,

        render: renderAll,


        getData() {

            return {

                orders: [...state.data.orders],

                messages: [...state.data.messages],

                reviews: [...state.data.reviews]

            };

        },


        getConfig() {

            return state.config;

        },


        getState() {

            return {

                initialized: state.initialized,

                loading: state.loading,

                filters: { ...state.filters },

                activeCustomer: state.activeCustomer,

                activeOrder: state.activeOrder

            };

        },


        // الطلبات

        updateOrderStatus,

        saveOrderNote,


        // الرسائل

        updateMessageStatus,

        saveMessageNote,

        saveMessageReply,

        showMessageDetails,

        closeMessageDetails,

        // العملاء

        getCustomerProfile,

        showCustomerProfile,


        // السجل الزمني

        getOrderTimeline,


        // المهام

        getCustomerTasks,

        createCustomerTask,

        updateCustomerTask,

        completeCustomerTask,

        deleteCustomerTask,

        createOrderFollowupTasks,

        createMessageFollowupTasks,


        // التقارير

        getCustomerReports,


        // التواصل

        getCommunicationHistory,

        getCommunicationStats,

        buildCustomerWhatsAppMessage,

        openWhatsApp,


        // أدوات عامة

        normalizePhone,

        formatDate,

        formatCurrency,

        formatNumber,

        statusLabel,

        statusClass,

        copyText

    };


})();