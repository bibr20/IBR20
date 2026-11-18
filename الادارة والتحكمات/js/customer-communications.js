/* =========================================================
   IBR20 CUSTOMER COMMUNICATIONS
   خدمة التواصل مع العملاء
   Version: 1.1.0

   المسؤوليات:
   1. تجهيز روابط واتساب.
   2. تجهيز رسائل متابعة الطلبات.
   3. تجهيز رسائل الرد على الاستفسارات.
   4. تجهيز روابط الاتصال الهاتفي.
   5. تجهيز روابط البريد الإلكتروني.
   6. نسخ بيانات التواصل.
   7. تسجيل محاولات التواصل داخل الذاكرة.

   لا ترسل رسائل تلقائيًا.
   لا تنشئ جداول جديدة.
   لا تعدل قاعدة البيانات.
   لا تدعي نجاح إرسال الرسائل.
========================================================= */

(() => {

    "use strict";


    /* =====================================================
       1. منع التكرار
    ===================================================== */

    if (window.IBRCustomerCommunications) {

        console.warn(
            "IBRCustomerCommunications is already initialized."
        );

        return;
    }


    /* =====================================================
       2. الإعدادات
    ===================================================== */

    const CONFIG = Object.freeze({

        version: "1.1.0",

        countryCode: "966",

        maxHistory: 200

    });


    /* =====================================================
       3. أنواع التواصل
    ===================================================== */

    const COMMUNICATION_TYPES = Object.freeze({

        whatsapp: "واتساب",

        phone: "اتصال هاتفي",

        email: "بريد إلكتروني",

        copy: "نسخ بيانات",

        note: "ملاحظة تواصل"

    });


    /* =====================================================
       4. سجل التواصل المؤقت
    ===================================================== */

    const communicationHistory = [];


    /* =====================================================
       5. أدوات قراءة الحقول
    ===================================================== */

    function getField(record, ...names) {

        if (
            !record ||
            typeof record !== "object"
        ) {
            return undefined;
        }

        for (const name of names) {

            if (
                Object.prototype.hasOwnProperty.call(
                    record,
                    name
                ) &&
                record[name] !== undefined &&
                record[name] !== null
            ) {
                return record[name];
            }

        }

        return undefined;
    }


    /* =====================================================
       6. تنظيف النصوص
    ===================================================== */

    function cleanText(value) {

        return String(value ?? "").trim();

    }


    /* =====================================================
       7. تحويل الأرقام إلى قيمة آمنة
    ===================================================== */

    function toNumber(value) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return 0;
        }

        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : 0;

    }


    /* =====================================================
       8. توحيد رقم الهاتف السعودي
    ===================================================== */

    function normalizePhone(phone) {

        if (!phone) {
            return "";
        }

        let value = String(phone)
            .replace(/\D/g, "");


        /*
         * 009665XXXXXXXX -> 9665XXXXXXXX
         */

        if (value.startsWith("00966")) {

            value = value.slice(2);

        }


        /*
         * 05XXXXXXXX -> 5XXXXXXXX
         */

        if (value.startsWith("0")) {

            value = value.slice(1);

        }


        /*
         * 5XXXXXXXX -> 9665XXXXXXXX
         */

        if (
            value.length === 9 &&
            value.startsWith("5")
        ) {

            value =
                CONFIG.countryCode + value;

        }


        return value;

    }


    /* =====================================================
       9. التحقق من رقم الهاتف السعودي
    ===================================================== */

    function validatePhone(phone) {

        const normalized = normalizePhone(phone);


        /*
         * صيغة رقم الجوال السعودي:
         * 9665XXXXXXXX
         *
         * مكون من 12 رقمًا.
         */

        if (
            !/^9665\d{8}$/.test(normalized)
        ) {

            throw new Error(
                "رقم الجوال السعودي غير صالح للتواصل. تحقق من الرقم."
            );

        }


        return normalized;

    }


    /* =====================================================
       10. تجهيز رابط واتساب
    ===================================================== */

    function buildWhatsAppUrl(
        phone,
        message = ""
    ) {

        const normalized =
            validatePhone(phone);

        const text = encodeURIComponent(
            cleanText(message)
        );


        return (

            "https://wa.me/" +

            normalized +

            (
                text
                    ? "?text=" + text
                    : ""
            )

        );

    }


    /* =====================================================
       11. تجهيز رابط الاتصال الهاتفي
    ===================================================== */

    function buildPhoneUrl(phone) {

        const normalized =
            validatePhone(phone);

        return "tel:+" + normalized;

    }


    /* =====================================================
       12. تجهيز رابط البريد الإلكتروني
    ===================================================== */

    function buildEmailUrl(
        email,
        subject = "",
        body = ""
    ) {

        const address = cleanText(email);


        if (
            !address ||
            address.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)
        ) {

            throw new Error(
                "عنوان البريد الإلكتروني غير صالح."
            );

        }


        const parameters = new URLSearchParams();


        if (cleanText(subject)) {

            parameters.set(
                "subject",
                cleanText(subject)
            );

        }


        if (cleanText(body)) {

            parameters.set(
                "body",
                cleanText(body)
            );

        }


        const query = parameters.toString();


        return (

            "mailto:" +

            address +

            (query ? "?" + query : "")

        );

    }


    /* =====================================================
       13. تنسيق المبالغ
    ===================================================== */

    function formatCurrency(value) {

        return new Intl.NumberFormat(
            "ar-SA",
            {
                style: "currency",
                currency: "SAR",
                maximumFractionDigits: 2
            }
        ).format(
            toNumber(value)
        );

    }


    /* =====================================================
       14. تنسيق التاريخ
    ===================================================== */

    function formatDate(value) {

        if (!value) {
            return "سيتم تحديده معك";
        }


        /*
         * نتعامل مع التاريخ بصيغة YYYY-MM-DD
         * دون تحويله إلى يوم سابق بسبب المنطقة الزمنية.
         */

        const text = String(value).trim();

        let date;


        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {

            const [year, month, day] =
                text.split("-").map(Number);

            date = new Date(
                year,
                month - 1,
                day
            );

        } else {

            date = new Date(value);

        }


        if (Number.isNaN(date.getTime())) {

            return "سيتم تحديده معك";

        }


        return new Intl.DateTimeFormat(
            "ar-SA",
            {
                year: "numeric",
                month: "long",
                day: "numeric"
            }
        ).format(date);

    }


    /* =====================================================
       15. استخراج بيانات العميل من الطلب
    ===================================================== */

    function getOrderCustomerName(order) {

        return cleanText(
            getField(
                order,
                "customer_name",
                "customerName"
            )
        ) || "عميلنا العزيز";

    }


    function getOrderNumber(order) {

        return cleanText(
            getField(
                order,
                "order_number",
                "orderNumber"
            )
        ) || "غير محدد";

    }


    function getOrderTotal(order) {

        return toNumber(
            getField(
                order,
                "total_amount",
                "totalAmount",
                "total"
            )
        );

    }


/* =====================================================
   16. رسالة تأكيد استلام الطلب
===================================================== */

function buildOrderConfirmationMessage(order) {

    if (
        !order ||
        typeof order !== "object"
    ) {
        throw new Error(
            "بيانات الطلب غير متوفرة."
        );
    }

    const name =
        getOrderCustomerName(order);

    const orderNumber =
        getOrderNumber(order);

    const total =
        getOrderTotal(order);

    const formattedTotal =
        Number(total).toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

    return [

        "مرحباً " + name + " 🌿",

        "",

        "شكراً لثقتك بمتجر IBR للأثاث الخشبي.",

        "",

        "يسعدنا إبلاغك بأنه تم استلام طلبك بنجاح.",

        "",

        "رقم طلبك: " + orderNumber,

        "إجمالي الطلب: " + formattedTotal + " ريال",

        "",

        "سنحرص على إبقائك على اطلاع بكل تحديث يطرأ على طلبك.",

        "",

        "شكراً لاختيارك IBR 🤎",

        "",

        "IBR | أثاث خشبي"

    ].join("\n");
}

    /* =====================================================
       17. رسالة متابعة الطلب
    ===================================================== */

    function buildOrderFollowupMessage(order) {

        if (
            !order ||
            typeof order !== "object"
        ) {

            throw new Error(
                "بيانات الطلب غير متوفرة."
            );

        }


        const name =
            getOrderCustomerName(order);

        const orderNumber =
            getOrderNumber(order);


        return [

            "مرحبًا " + name + " 🌿",

            "",

            "نتواصل معك بخصوص طلبك رقم: " +
                orderNumber,

            "",

            "نرغب في التأكد من تفاصيل الطلب ومساعدتك في أي استفسار.",

            "",

            "يسعدنا تواصلك معنا.",

            "IBR للأثاث الخشبي"

        ].join("\n");

    }


    /* =====================================================
       18. رسالة تحديث حالة الطلب
    ===================================================== */

    function buildOrderStatusMessage(
        order,
        statusLabel
    ) {

        if (
            !order ||
            typeof order !== "object"
        ) {

            throw new Error(
                "بيانات الطلب غير متوفرة."
            );

        }


        const name =
            getOrderCustomerName(order);

        const orderNumber =
            getOrderNumber(order);

        const status = cleanText(
            statusLabel
        ) || "تم تحديث حالة الطلب";


        return [

            "مرحبًا " + name + " 🌿",

            "",

            "نود إبلاغك بتحديث حالة طلبك رقم: " +
                orderNumber,

            "",

            "الحالة الحالية: " + status,

            "",

            "شكرًا لثقتك بـ IBR للأثاث الخشبي."

        ].join("\n");

    }


    /* =====================================================
       19. رسالة الرد على استفسار العميل
    ===================================================== */

    function buildInquiryReplyMessage(
        message,
        reply
    ) {

        if (
            !message ||
            typeof message !== "object"
        ) {

            throw new Error(
                "بيانات الاستفسار غير متوفرة."
            );

        }


        const name = cleanText(
            getField(
                message,
                "customer_name",
                "customerName"
            )
        ) || "عميلنا العزيز";


        const inquiryNumber = cleanText(
            getField(
                message,
                "inquiry_number",
                "inquiryNumber"
            )
        );


        const response = cleanText(reply);


        if (!response) {

            throw new Error(
                "اكتب الرد قبل تجهيز الرسالة."
            );

        }


        const lines = [

            "مرحبًا " + name + " 🌿",

            ""

        ];


        if (inquiryNumber) {

            lines.push(
                "بخصوص استفسارك رقم: " +
                    inquiryNumber
            );

            lines.push("");

        }


        lines.push(

            response,

            "",

            "شكرًا لتواصلك مع IBR للأثاث الخشبي."

        );


        return lines.join("\n");

    }


    /* =====================================================
       20. رسالة متابعة موعد التسليم
    ===================================================== */

    function buildDeliveryMessage(order) {

        if (
            !order ||
            typeof order !== "object"
        ) {

            throw new Error(
                "بيانات الطلب غير متوفرة."
            );

        }


        const name =
            getOrderCustomerName(order);

        const orderNumber =
            getOrderNumber(order);


        const deliveryDate = formatDate(
            getField(
                order,
                "expected_delivery_date",
                "expectedDeliveryDate"
            )
        );


        return [

            "مرحبًا " + name + " 🌿",

            "",

            "نتواصل معك بخصوص موعد تسليم طلبك رقم: " +
                orderNumber,

            "",

            "موعد التسليم المتوقع: " + deliveryDate,

            "",

            "يرجى التواصل معنا إذا كانت لديك أي ملاحظات.",

            "",

            "IBR للأثاث الخشبي"

        ].join("\n");

    }


    /* =====================================================
       21. تسجيل محاولة التواصل
    ===================================================== */

    function recordCommunication(data = {}) {

        const type = cleanText(data.type);


        if (
            !Object.prototype.hasOwnProperty.call(
                COMMUNICATION_TYPES,
                type
            )
        ) {

            throw new Error(
                "نوع التواصل غير معتمد."
            );

        }


        const record = {

            id:

                window.crypto &&
                typeof window.crypto.randomUUID === "function"

                    ? window.crypto.randomUUID()

                    : (
                        "communication-" +
                        Date.now() +
                        "-" +
                        communicationHistory.length
                    ),


            type,

            typeLabel:
                COMMUNICATION_TYPES[type],


            customerName:
                cleanText(
                    getField(
                        data,
                        "customerName",
                        "customer_name"
                    )
                ),


            customerPhone:
                cleanText(
                    getField(
                        data,
                        "customerPhone",
                        "customer_phone"
                    )
                ),


            customerEmail:
                cleanText(
                    getField(
                        data,
                        "customerEmail",
                        "customer_email"
                    )
                ),


            orderId:
                getField(
                    data,
                    "orderId",
                    "order_id"
                ) || null,


            messageId:
                getField(
                    data,
                    "messageId",
                    "message_id"
                ) || null,


            description:
                cleanText(data.description),


            createdAt:
                new Date().toISOString(),


            result:
                "attempted"

        };


        communicationHistory.unshift(record);


        if (
            communicationHistory.length >
            CONFIG.maxHistory
        ) {

            communicationHistory.length =
                CONFIG.maxHistory;

        }


        return { ...record };

    }


    /* =====================================================
       22. تجهيز بيانات تسجيل التواصل من الطلب
    ===================================================== */

    function getOrderCommunicationData(order) {

        return {

            customerName:
                getOrderCustomerName(order),

            customerPhone:
                getField(
                    order,
                    "customer_phone",
                    "customerPhone"
                ) || "",

            orderId:
                getField(
                    order,
                    "id",
                    "order_id",
                    "orderId"
                ) || null

        };

    }


    /* =====================================================
       23. تجهيز بيانات تسجيل التواصل من الرسالة
    ===================================================== */

    function getMessageCommunicationData(message) {

        return {

            customerName:

                getField(
                    message,
                    "customer_name",
                    "customerName"
                ) || "",


            customerPhone:

                getField(
                    message,
                    "customer_phone",
                    "customerPhone"
                ) || "",


            customerEmail:

                getField(
                    message,
                    "customer_email",
                    "customerEmail"
                ) || "",


            messageId:

                getField(
                    message,
                    "id",
                    "message_id",
                    "messageId"
                ) || null

        };

    }


    /* =====================================================
       24. فتح واتساب
       من تفاعل المستخدم فقط
    ===================================================== */

    function openWhatsApp(
        phone,
        message = "",
        metadata = {}
    ) {

        const url = buildWhatsAppUrl(
            phone,
            message
        );


        const customerPhone =
            validatePhone(phone);


        const openedWindow = window.open(
            url,
            "_blank",
            "noopener,noreferrer"
        );


        recordCommunication({

            ...metadata,

            type: "whatsapp",

            customerPhone,

            description:
                cleanText(message)
                    ? "تم فتح رابط واتساب برسالة مجهزة."
                    : "تم فتح رابط واتساب."

        });


        /*
         * هذه نتيجة محاولة فتح الرابط فقط.
         * لا تعني أن الرسالة أُرسلت.
         */

        return {

            url,

            opened: Boolean(openedWindow),

            status: "attempted"

        };

    }


    /* =====================================================
       25. فتح اتصال هاتفي
    ===================================================== */

    function openPhone(phone, metadata = {}) {

        const normalized =
            validatePhone(phone);

        const url =
            "tel:+" + normalized;


        recordCommunication({

            ...metadata,

            type: "phone",

            customerPhone: normalized,

            description:
                "تم تجهيز رابط الاتصال الهاتفي."

        });


        window.location.href = url;


        return {

            url,

            status: "attempted"

        };

    }


    /* =====================================================
       26. فتح البريد الإلكتروني
    ===================================================== */

    function openEmail(
        email,
        subject = "",
        body = "",
        metadata = {}
    ) {

        const address = cleanText(email);

        const url = buildEmailUrl(
            address,
            subject,
            body
        );


        recordCommunication({

            ...metadata,

            type: "email",

            customerEmail: address,

            description:
                "تم تجهيز رابط البريد الإلكتروني."

        });


        window.location.href = url;


        return {

            url,

            status: "attempted"

        };

    }


    /* =====================================================
       27. نسخ نص إلى الحافظة
    ===================================================== */

    async function copyText(
        text,
        metadata = {}
    ) {

        const value = String(text ?? "");


        if (!value) {

            throw new Error(
                "لا يوجد نص لنسخه."
            );

        }


        let copied = false;


        if (
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
        ) {

            try {

                await navigator.clipboard.writeText(value);

                copied = true;

            } catch (error) {

                copied = false;

            }

        }


        /*
         * بديل للمتصفحات التي لا تدعم Clipboard API
         * أو عند رفض صلاحية الحافظة.
         */

        if (!copied) {

            const textarea =
                document.createElement("textarea");


            textarea.value = value;

            textarea.setAttribute(
                "readonly",
                ""
            );

            textarea.style.position = "fixed";

            textarea.style.left = "-9999px";


            document.body.appendChild(textarea);

            textarea.select();


            try {

                copied = document.execCommand("copy");

            } finally {

                textarea.remove();

            }

        }


        if (!copied) {

            throw new Error(
                "تعذر نسخ النص. تحقق من صلاحية الحافظة."
            );

        }


        recordCommunication({

            ...metadata,

            type: "copy",

            description:
                "تم نسخ بيانات التواصل."

        });


        return true;

    }


    /* =====================================================
       28. تسجيل ملاحظة تواصل
    ===================================================== */

    function recordCommunicationNote(data = {}) {

        return recordCommunication({

            ...data,

            type: "note"

        });

    }


    /* =====================================================
       29. عرض سجل التواصل المؤقت
    ===================================================== */

    function getCommunicationHistory(options = {}) {

        let result = [
            ...communicationHistory
        ];


        if (options.type) {

            result = result.filter(record => {

                return record.type === options.type;

            });

        }


        if (options.customerPhone) {

            const phone = normalizePhone(
                options.customerPhone
            );


            result = result.filter(record => {

                return normalizePhone(
                    record.customerPhone
                ) === phone;

            });

        }


        if (options.orderId) {

            result = result.filter(record => {

                return String(record.orderId) ===
                    String(options.orderId);

            });

        }


        if (options.messageId) {

            result = result.filter(record => {

                return String(record.messageId) ===
                    String(options.messageId);

            });

        }


        const limit = Number(options.limit);


        if (
            Number.isFinite(limit) &&
            limit > 0
        ) {

            result = result.slice(
                0,
                Math.min(
                    Math.floor(limit),
                    CONFIG.maxHistory
                )
            );

        }


        return result.map(record => ({
            ...record
        }));

    }


    /* =====================================================
       30. مسح سجل التواصل المؤقت
    ===================================================== */

    function clearCommunicationHistory() {

        communicationHistory.length = 0;

        return true;

    }


    /* =====================================================
       31. إحصائيات التواصل المؤقت
    ===================================================== */

    function getCommunicationStats() {

        const stats = {

            total: communicationHistory.length,

            whatsapp: 0,

            phone: 0,

            email: 0,

            copy: 0,

            note: 0

        };


        communicationHistory.forEach(record => {

            if (
                Object.prototype.hasOwnProperty.call(
                    stats,
                    record.type
                )
            ) {

                stats[record.type]++;

            }

        });


        return stats;

    }


    /* =====================================================
       32. معلومات سجل التواصل
    ===================================================== */

    function getStorageInfo() {

        return {

            type: "memory",

            persistent: false,

            count: communicationHistory.length,

            maximum: CONFIG.maxHistory,

            remaining:
                CONFIG.maxHistory -
                communicationHistory.length,

            notice:
                "سجل التواصل مؤقت، ويُمسح عند إعادة تحميل الصفحة أو إغلاقها."

        };

    }


    /* =====================================================
       33. تصدير الخدمة
    ===================================================== */

    window.IBRCustomerCommunications = Object.freeze({

        version: CONFIG.version,

        config: CONFIG,

        normalizePhone,

        validatePhone,

        buildWhatsAppUrl,

        buildPhoneUrl,

        buildEmailUrl,

        buildOrderConfirmationMessage,

        buildOrderFollowupMessage,

        buildOrderStatusMessage,

        buildInquiryReplyMessage,

        buildDeliveryMessage,

        openWhatsApp,

        openPhone,

        openEmail,

        copyText,

        recordCommunication,

        recordCommunicationNote,

        getCommunicationHistory,

        clearCommunicationHistory,

        getCommunicationStats,

        getStorageInfo,

        communicationTypes:
            COMMUNICATION_TYPES

    });


    console.info(
        "IBRCustomerCommunications v1.1.0 initialized successfully."
    );


})();