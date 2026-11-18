/* =========================================================
   IBR20 MESSAGES SERVICE
   خدمة إدارة رسائل العملاء والاستفسارات

   Version: 2.0.0
   RTL / Arabic / Supabase

   المميزات:
   1. جلب الرسائل وتوحيد بياناتها.
   2. البحث الشامل في الرسائل المحملة.
   3. التصفية حسب الحالة والنوع والتاريخ.
   4. الترقيم وجلب العدد الإجمالي.
   5. جلب رسالة واحدة.
   6. تحديث حالة الرسالة.
   7. حفظ الملاحظات الإدارية.
   8. حفظ رد الإدارة.
   9. إحصائيات متقدمة.
   10. روابط مؤقتة آمنة لمرفقات العملاء.
   11. دعم المرفقات المتعددة.
   12. تجهيز معاينة صور المنتجات.
   13. توحيد أرقام الجوال العربية والإنجليزية.
   14. تجهيز روابط واتساب.
   15. تنسيق التواريخ والأرقام.

   الأمان:
   - يستخدم Supabase Client المشترك.
   - لا ينشئ اتصالاً جديداً.
   - لا يستخدم Service Role Key.
   - لا ينفذ إدخالاً مباشراً للرسائل.
   - لا ينفذ حذفاً للرسائل أو المرفقات.
   - يعتمد على RLS وصلاحيات المدير.
   - لا يجعل Storage عاماً.
   - لا يحدث حقول التواريخ يدوياً.
   - لا يعرض الملاحظات الداخلية للعميل.

   قاعدة البيانات المعتمدة:
   Table: customer_messages
   Bucket: ibr20-contact-attachments

========================================================= */

(() => {

    "use strict";


    /* =====================================================
       1. منع التهيئة المكررة
    ===================================================== */

    if (window.IBRMessagesService) {

        console.warn(
            "IBRMessagesService is already initialized."
        );

        return;
    }


    /* =====================================================
       2. إعدادات الخدمة
    ===================================================== */

    const CONFIG = Object.freeze({

        table: "customer_messages",

        storageBucket: "ibr20-contact-attachments",

        defaultLimit: 100,

        maximumLimit: 1000,

        defaultPageSize: 25,

        maximumPageSize: 100,

        maximumNoteLength: 5000,

        maximumReplyLength: 5000,

        signedUrlExpiry: 3600,

        signedUrlCacheTime: 3300000,

        whatsappCountryCode: "966",

        dateLocale: "ar-SA",

        timeZone: "Asia/Riyadh"

    });


    /* =====================================================
       3. أعمدة جدول الرسائل
    ===================================================== */

    const MESSAGE_COLUMNS = [

        "id",

        "customer_name",

        "customer_phone",

        "customer_email",

        "message_type",

        "subject",

        "message",

        "attachment_path",

        "status",

        "admin_note",

        "created_at",

        "updated_at",

        "product_id",

        "product_name",

        "product_sku",

        "product_image_url",

        "inquiry_number",

        "customer_reply",

        "customer_reply_at"

    ].join(",");


    /* =====================================================
       4. أنواع الرسائل
    ===================================================== */

    const MESSAGE_TYPES = Object.freeze({

        general: "رسالة عامة",

        product_question: "استفسار عن منتج",

        order_question: "استفسار عن طلب",

        complaint: "شكوى",

        suggestion: "اقتراح"

    });


    /* =====================================================
       5. حالات الرسائل
    ===================================================== */

    const MESSAGE_STATUSES = Object.freeze({

        new: "جديدة",

        in_review: "قيد المراجعة",

        answered: "تم الرد",

        closed: "مغلقة"

    });


    const VALID_TYPES = Object.freeze(

        Object.keys(MESSAGE_TYPES)

    );


    const VALID_STATUSES = Object.freeze(

        Object.keys(MESSAGE_STATUSES)

    );


    /* =====================================================
       6. ذاكرة الخدمة
    ===================================================== */

    let configuredClient = null;

    const signedUrlCache = new Map();


    /* =====================================================
       7. أدوات مساعدة عامة
    ===================================================== */

    function isPlainObject(value) {

        return (

            value !== null &&

            typeof value === "object" &&

            !Array.isArray(value)

        );
    }


    function cleanText(value) {

        if (value === null || value === undefined) {

            return "";
        }


        return String(value).trim();
    }


    function normalizeDigits(value) {

        return String(value || "")

            .replace(/[٠-٩]/g, digit =>

                String(

                    "٠١٢٣٤٥٦٧٨٩".indexOf(digit)

                )

            )

            .replace(/[۰-۹]/g, digit =>

                String(

                    "۰۱۲۳۴۵۶۷۸۹".indexOf(digit)

                )

            );
    }


    function normalizeSearchText(value) {

        return normalizeDigits(value)

            .toLowerCase()

            .normalize("NFKC")

            .replace(/[\u064B-\u065F\u0670]/g, "")

            .replace(/[أإآ]/g, "ا")

            .replace(/ى/g, "ي")

            .replace(/ة/g, "ه")

            .replace(/\s+/g, " ")

            .trim();
    }


    function getCurrentTime() {

        return Date.now();
    }


    /* =====================================================
       8. اتصال Supabase المشترك
    ===================================================== */

    function getClient() {

        const client =

            configuredClient ||

            window.supabaseClient ||

            (

                window.IBRAdmin &&

                typeof window.IBRAdmin.getClient === "function"

                    ? window.IBRAdmin.getClient()

                    : null

            );


        if (

            !client ||

            typeof client.from !== "function"

        ) {

            throw new Error(

                "اتصال Supabase غير متاح. تحقق من تحميل store.js."

            );
        }


        return client;
    }


    /* =====================================================
       9. تهيئة الخدمة
    ===================================================== */

    function configure(options = {}) {

        if (!isPlainObject(options)) {

            throw new Error(

                "إعدادات الخدمة غير صالحة."

            );
        }


        if (options.client) {

            if (

                typeof options.client.from !== "function"

            ) {

                throw new Error(

                    "Supabase client غير صالح."

                );
            }


            configuredClient = options.client;
        }


        return true;
    }


    /* =====================================================
       10. معالجة الأخطاء
    ===================================================== */

    function handleError(error, fallbackMessage) {

        console.error(

            "[IBRMessagesService]",

            error

        );


        if (error && error.message) {

            throw new Error(error.message);
        }


        throw new Error(

            fallbackMessage ||

            "حدث خطأ أثناء تنفيذ العملية."

        );
    }


    /* =====================================================
       11. التحقق من معرف الرسالة
    ===================================================== */

    function validateMessageId(messageId) {

        if (

            typeof messageId !== "string" ||

            !messageId.trim()

        ) {

            throw new Error(

                "معرف الرسالة غير صالح."

            );
        }


        return messageId.trim();
    }


    /* =====================================================
       12. التحقق من حالة الرسالة
    ===================================================== */

    function validateStatus(status) {

        if (

            typeof status !== "string" ||

            !VALID_STATUSES.includes(status)

        ) {

            throw new Error(

                "حالة الرسالة غير معتمدة."

            );
        }


        return status;
    }


    /* =====================================================
       13. التحقق من نوع الرسالة
    ===================================================== */

    function validateType(type) {

        if (

            typeof type !== "string" ||

            !VALID_TYPES.includes(type)

        ) {

            throw new Error(

                "نوع الرسالة غير معتمد."

            );
        }


        return type;
    }


    /* =====================================================
       14. التحقق من حدود النتائج
    ===================================================== */

    function normalizeLimit(value, fallback, maximum) {

        const number = Number(value);


        if (!Number.isFinite(number)) {

            return fallback;
        }


        return Math.min(

            Math.max(Math.floor(number), 1),

            maximum

        );
    }


    function normalizeOffset(value) {

        const number = Number(value);


        if (

            !Number.isFinite(number) ||

            number < 0

        ) {

            return 0;
        }


        return Math.floor(number);
    }


    /* =====================================================
       15. التحقق من التاريخ
    ===================================================== */

    function validateDate(value, fieldName) {

        if (!value) {

            return null;
        }


        const date = new Date(value);


        if (Number.isNaN(date.getTime())) {

            throw new Error(

                "قيمة التاريخ غير صالحة: " + fieldName

            );
        }


        return date.toISOString();
    }


    /* =====================================================
       16. تحليل مسارات المرفقات
       
       يدعم:
       - JSON array
       - JSON string
       - مسار منفرد
       - null

       لا يقبل روابط خارجية كمسارات Storage.
    ===================================================== */

    function parseAttachmentPaths(value) {

        if (!value) {

            return [];
        }


        let paths = [];


        if (Array.isArray(value)) {

            paths = value;
        }

        else if (typeof value === "string") {

            const cleanValue = value.trim();


            if (!cleanValue) {

                return [];
            }


            try {

                const parsed = JSON.parse(cleanValue);


                if (Array.isArray(parsed)) {

                    paths = parsed;
                }

                else if (typeof parsed === "string") {

                    paths = [parsed];
                }

                else {

                    return [];
                }

            }

            catch (_) {

                paths = [cleanValue];
            }

        }


        return paths

            .map(path => cleanText(path))

            .filter(path => validateAttachmentPath(path));
    }


    /* =====================================================
       17. التحقق من مسار المرفق
       
       المسار المتوقع:
       inquiries/UUID.jpg
       inquiries/UUID.jpeg
       inquiries/UUID.png
       inquiries/UUID.webp
    ===================================================== */

    function validateAttachmentPath(path) {

        if (

            typeof path !== "string" ||

            !path ||

            path.length > 300

        ) {

            return false;
        }


        return /^inquiries\/[0-9a-fA-F-]{36}\.(jpg|jpeg|png|webp)$/i

            .test(path);
    }


    /* =====================================================
       18. إنشاء رابط مؤقت لمرفق واحد
    ===================================================== */

    async function createAttachmentUrl(path, options = {}) {

        if (!validateAttachmentPath(path)) {

            throw new Error(

                "مسار المرفق غير صالح."

            );
        }


        const client = getClient();


        const now = getCurrentTime();

        const cached = signedUrlCache.get(path);


        if (

            !options.forceRefresh &&

            cached &&

            cached.expiresAt > now

        ) {

            return cached.url;
        }


        if (

            !client.storage ||

            typeof client.storage.from !== "function"

        ) {

            throw new Error(

                "خدمة Supabase Storage غير متاحة."

            );
        }


        const storage = client.storage.from(

            CONFIG.storageBucket

        );


        if (

            !storage ||

            typeof storage.createSignedUrl !== "function"

        ) {

            throw new Error(

                "إنشاء روابط المرفقات المؤقتة غير متاح."

            );
        }


        const {

            data,

            error

        } = await storage.createSignedUrl(

            path,

            CONFIG.signedUrlExpiry

        );


        if (error) {

            throw error;
        }


        if (!data || !data.signedUrl) {

            throw new Error(

                "لم يتم إنشاء رابط المرفق."

            );
        }


        signedUrlCache.set(path, {

            url: data.signedUrl,

            expiresAt:

                now + CONFIG.signedUrlCacheTime

        });


        return data.signedUrl;
    }


    /* =====================================================
       19. إنشاء روابط متعددة للمرفقات
       
       يستخدم createSignedUrls إن كانت متاحة.
       وإلا يستخدم createSignedUrl لكل ملف.
    ===================================================== */

    async function createAttachmentUrls(paths, options = {}) {

        const uniquePaths = [

            ...new Set(

                (Array.isArray(paths) ? paths : [])

                    .filter(validateAttachmentPath)

            )

        ];


        if (!uniquePaths.length) {

            return {};
        }


        const now = getCurrentTime();

        const result = {};

        const missingPaths = [];


        uniquePaths.forEach(path => {

            const cached = signedUrlCache.get(path);


            if (

                !options.forceRefresh &&

                cached &&

                cached.expiresAt > now

            ) {

                result[path] = cached.url;
            }

            else {

                missingPaths.push(path);
            }

        });


        if (!missingPaths.length) {

            return result;
        }


        const client = getClient();


        if (

            !client.storage ||

            typeof client.storage.from !== "function"

        ) {

            throw new Error(

                "خدمة Supabase Storage غير متاحة."

            );
        }


        const storage = client.storage.from(

            CONFIG.storageBucket

        );


        if (

            typeof storage.createSignedUrls === "function"

        ) {

            const {

                data,

                error

            } = await storage.createSignedUrls(

                missingPaths,

                CONFIG.signedUrlExpiry

            );


            if (error) {

                throw error;
            }


            (Array.isArray(data) ? data : [])

                .forEach(item => {

                    if (

                        !item ||

                        !item.path ||

                        !item.signedUrl ||

                        !missingPaths.includes(item.path)

                    ) {

                        return;
                    }


                    result[item.path] = item.signedUrl;


                    signedUrlCache.set(item.path, {

                        url: item.signedUrl,

                        expiresAt:

                            now + CONFIG.signedUrlCacheTime

                    });

                });

        }

        else {

            const settled = await Promise.allSettled(

                missingPaths.map(async path => {

                    const url = await createAttachmentUrl(

                        path,

                        options

                    );


                    return {

                        path,

                        url

                    };
                })

            );


            settled.forEach(item => {

                if (item.status === "fulfilled") {

                    result[item.value.path] =

                        item.value.url;
                }

            });

        }


        return result;
    }


    /* =====================================================
       20. تجهيز المرفقات للواجهة
    ===================================================== */

    async function prepareAttachments(message, options = {}) {

        const paths = parseAttachmentPaths(

            message.attachment_path

        );


        if (!paths.length) {

            return [];
        }


        let urls = {};


        try {

            urls = await createAttachmentUrls(

                paths,

                options

            );

        }

        catch (error) {

            console.warn(

                "[IBRMessagesService] تعذر إنشاء روابط المرفقات:",

                error

            );
        }


        return paths.map((path, index) => ({

            path,

            url: urls[path] || null,

            name: path.split("/").pop(),

            type: path.split(".").pop().toLowerCase(),

            index,

            available: Boolean(urls[path])

        }));
    }


    /* =====================================================
       21. توحيد بيانات الرسالة
    ===================================================== */

    function normalizeMessage(message) {

        if (!message) {

            return null;
        }


        const normalized = {

            ...message,


            customer_name:

                cleanText(message.customer_name),


            customer_phone:

                cleanText(message.customer_phone),


            customer_email:

                cleanText(message.customer_email),


            subject:

                cleanText(message.subject),


            message:

                cleanText(message.message),


            admin_note:

                cleanText(message.admin_note),


            customer_reply:

                cleanText(message.customer_reply),


            inquiry_number:

                cleanText(message.inquiry_number),


            product_name:

                cleanText(message.product_name),


            product_sku:

                cleanText(message.product_sku),


            message_type_label:

                MESSAGE_TYPES[message.message_type] ||

                message.message_type || "",


            status_label:

                MESSAGE_STATUSES[message.status] ||

                message.status || "",


            attachment_paths:

                parseAttachmentPaths(

                    message.attachment_path

                ),


            attachments: [],


            has_attachment:

                parseAttachmentPaths(

                    message.attachment_path

                ).length > 0,


            has_product:

                Boolean(message.product_id),


            has_reply:

                Boolean(

                    cleanText(message.customer_reply)

                ),


            product_image:

                cleanText(message.product_image_url),


            has_product_image:

                Boolean(

                    cleanText(message.product_image_url)

                )

        };


        return normalized;
    }


    /* =====================================================
       22. تجهيز رسالة واحدة بكامل بيانات العرض
    ===================================================== */

    async function prepareMessage(message, options = {}) {

        const normalized = normalizeMessage(message);


        if (!normalized) {

            return null;
        }


        normalized.attachments = await prepareAttachments(

            normalized,

            options

        );


        normalized.available_attachments =

            normalized.attachments.filter(

                item => item.available

            );


        normalized.attachment_count =

            normalized.attachments.length;


        normalized.available_attachment_count =

            normalized.available_attachments.length;


        return normalized;
    }


    async function prepareMessages(messages, options = {}) {

        const list = Array.isArray(messages)

            ? messages

            : [];


        return Promise.all(

            list.map(message =>

                prepareMessage(message, options)

            )

        );
    }


    /* =====================================================
       23. بناء استعلام الرسائل
    ===================================================== */

    function buildMessagesQuery(client, options = {}, includeCount = false) {

        let query = client

            .from(CONFIG.table)

            .select(

                MESSAGE_COLUMNS,

                includeCount

                    ? { count: "exact" }

                    : undefined

            );


        if (options.status) {

            query = query.eq(

                "status",

                validateStatus(options.status)

            );
        }


        if (options.type) {

            query = query.eq(

                "message_type",

                validateType(options.type)

            );
        }


        if (options.id) {

            query = query.eq(

                "id",

                validateMessageId(options.id)

            );
        }


        if (options.inquiryNumber) {

            query = query.eq(

                "inquiry_number",

                cleanText(options.inquiryNumber)

            );
        }


        if (options.productId) {

            query = query.eq(

                "product_id",

                options.productId

            );
        }


        if (options.hasAttachment === true) {

            query = query.not(

                "attachment_path",

                "is",

                null

            );
        }


        if (options.hasReply === true) {

            query = query.not(

                "customer_reply",

                "is",

                null

            );
        }


        if (options.fromDate) {

            const fromDate = validateDate(

                options.fromDate,

                "fromDate"

            );


            query = query.gte(

                "created_at",

                fromDate

            );
        }


        if (options.toDate) {

            const toDate = validateDate(

                options.toDate,

                "toDate"

            );


            query = query.lte(

                "created_at",

                toDate

            );
        }


        query = query.order(

            "created_at",

            {

                ascending:

                    options.ascending === true

            }

        );


        return query;
    }


    /* =====================================================
       24. جلب الرسائل
       
       الدالة القديمة محفوظة ومتوافقة:
       fetchMessages(options) => Array

       خيارات إضافية:
       status
       type
       id
       inquiryNumber
       productId
       fromDate
       toDate
       hasAttachment
       hasReply
       limit
       offset
       ascending
       includeAttachments
    ===================================================== */

    async function fetchMessages(options = {}) {

        try {

            const client = getClient();


            const query = buildMessagesQuery(

                client,

                options

            );


            const limit = normalizeLimit(

                options.limit,

                CONFIG.defaultLimit,

                CONFIG.maximumLimit

            );


            const offset = normalizeOffset(

                options.offset

            );


            const {

                data,

                error

            } = await query.range(

                offset,

                offset + limit - 1

            );


            if (error) {

                throw error;
            }


            const messages = Array.isArray(data)

                ? data

                : [];


            if (options.includeAttachments === false) {

                return messages.map(normalizeMessage);
            }


            return await prepareMessages(messages);


        }

        catch (error) {

            handleError(

                error,

                "تعذر تحميل رسائل العملاء."

            );
        }
    }


    /* =====================================================
       25. جلب الرسائل بنظام الصفحات
       
       النتيجة:
       {
           data: [],
           pagination: {
               page,
               pageSize,
               total,
               totalPages,
               hasNextPage,
               hasPreviousPage
           }
       }
    ===================================================== */

    async function fetchMessagesPage(options = {}) {

        try {

            const client = getClient();


            const page = Math.max(

                1,

                Math.floor(Number(options.page) || 1)

            );


            const pageSize = normalizeLimit(

                options.pageSize,

                CONFIG.defaultPageSize,

                CONFIG.maximumPageSize

            );


            const offset = (page - 1) * pageSize;


            const query = buildMessagesQuery(

                client,

                options,

                true

            );


            const {

                data,

                error,

                count

            } = await query.range(

                offset,

                offset + pageSize - 1

            );


            if (error) {

                throw error;
            }


            const messages = Array.isArray(data)

                ? data

                : [];


            const total = Number(count) || 0;


            const totalPages = Math.ceil(

                total / pageSize

            );


            const prepared =

                options.includeAttachments === false

                    ? messages.map(normalizeMessage)

                    : await prepareMessages(messages);


            return {

                data: prepared,

                pagination: {

                    page,

                    pageSize,

                    offset,

                    total,

                    totalPages,

                    hasNextPage:

                        page < totalPages,

                    hasPreviousPage:

                        page > 1,

                    returned: prepared.length

                }

            };

        }

        catch (error) {

            handleError(

                error,

                "تعذر تحميل صفحة الرسائل."

            );
        }
    }


    /* =====================================================
       26. جلب رسالة واحدة بواسطة المعرف
    ===================================================== */

    async function getMessageById(messageId, options = {}) {

        const id = validateMessageId(messageId);


        try {

            const client = getClient();


            const {

                data,

                error

            } = await client

                .from(CONFIG.table)

                .select(MESSAGE_COLUMNS)

                .eq("id", id)

                .maybeSingle();


            if (error) {

                throw error;
            }


            if (!data) {

                return null;
            }


            return options.includeAttachments === false

                ? normalizeMessage(data)

                : await prepareMessage(data);

        }

        catch (error) {

            handleError(

                error,

                "تعذر العثور على الرسالة."

            );
        }
    }


    /* =====================================================
       27. جلب رسالة بواسطة رقم الاستفسار
    ===================================================== */

    async function getMessageByInquiryNumber(number) {

        const inquiryNumber = cleanText(number);


        if (!inquiryNumber) {

            throw new Error(

                "رقم الاستفسار مطلوب."

            );
        }


        try {

            const client = getClient();


            const {

                data,

                error

            } = await client

                .from(CONFIG.table)

                .select(MESSAGE_COLUMNS)

                .eq("inquiry_number", inquiryNumber)

                .maybeSingle();


            if (error) {

                throw error;
            }


            return data

                ? await prepareMessage(data)

                : null;

        }

        catch (error) {

            handleError(

                error,

                "تعذر العثور على الاستفسار."

            );
        }
    }


    /* =====================================================
       28. البحث في الرسائل المحملة
       
       يشمل:
       - اسم العميل
       - الجوال
       - البريد
       - رقم الاستفسار
       - العنوان
       - نص الرسالة
       - نوع الرسالة
       - الحالة
       - المنتج
       - SKU
       - الملاحظة الإدارية
       - رد الإدارة

       ملاحظة:
       البحث محلي ضمن القائمة التي تم تحميلها.
    ===================================================== */

    function searchMessages(messages, searchTerm) {

        if (!Array.isArray(messages)) {

            return [];
        }


        const term = normalizeSearchText(searchTerm);


        if (!term) {

            return messages;
        }


        return messages.filter(message => {

            const values = [

                message.customer_name,

                message.customer_phone,

                message.customer_email,

                message.subject,

                message.message,

                message.message_type,

                MESSAGE_TYPES[message.message_type],

                message.status,

                MESSAGE_STATUSES[message.status],

                message.inquiry_number,

                message.product_name,

                message.product_sku,

                message.admin_note,

                message.customer_reply

            ];


            return values.some(value => {

                return normalizeSearchText(value)

                    .includes(term);

            });

        });
    }


    /* =====================================================
       29. تصفية الرسائل محلياً
    ===================================================== */

    function filterMessages(messages, filters = {}) {

        if (!Array.isArray(messages)) {

            return [];
        }


        return messages.filter(message => {

            if (

                filters.status &&

                message.status !== filters.status

            ) {

                return false;
            }


            if (

                filters.type &&

                message.message_type !== filters.type

            ) {

                return false;
            }


            if (

                filters.hasAttachment === true &&

                !message.has_attachment

            ) {

                return false;
            }


            if (

                filters.hasProduct === true &&

                !message.has_product

            ) {

                return false;
            }


            if (

                filters.hasReply === true &&

                !message.has_reply

            ) {

                return false;
            }


            if (

                filters.priority === "unanswered" &&

                message.status === "answered"

            ) {

                return false;
            }


            if (

                filters.priority === "unanswered" &&

                message.status === "closed"

            ) {

                return false;
            }


            return true;

        });
    }


    /* =====================================================
       30. تحديث حالة الرسالة
       
       يتم تحديث status فقط.
       updated_at مسؤولية Trigger.
    ===================================================== */

    async function updateMessageStatus(

        messageId,

        newStatus

    ) {

        const id = validateMessageId(messageId);

        const status = validateStatus(newStatus);


        try {

            const client = getClient();


            const {

                data,

                error

            } = await client

                .from(CONFIG.table)

                .update({

                    status

                })

                .eq("id", id)

                .select(MESSAGE_COLUMNS)

                .single();


            if (error) {

                throw error;
            }


            if (!data) {

                throw new Error(

                    "لم يتم العثور على الرسالة أو لا تملك صلاحية تعديلها."

                );
            }


            return await prepareMessage(data);

        }

        catch (error) {

            handleError(

                error,

                "تعذر تحديث حالة الرسالة."

            );
        }
    }


    /* =====================================================
       31. تحديث الملاحظة الإدارية
       
       لا تظهر الملاحظة للعميل.
       لا يتم تعديل updated_at يدوياً.
    ===================================================== */

    async function updateAdminNote(messageId, note) {

        const id = validateMessageId(messageId);


        if (

            note !== null &&

            note !== undefined &&

            typeof note !== "string"

        ) {

            throw new Error(

                "الملاحظة الإدارية يجب أن تكون نصاً."

            );
        }


        const cleanNote =

            note === null || note === undefined

                ? null

                : note.trim();


        if (

            cleanNote !== null &&

            cleanNote.length > CONFIG.maximumNoteLength

        ) {

            throw new Error(

                "الملاحظة الإدارية تجاوزت الحد الأقصى المسموح."

            );
        }


        try {

            const client = getClient();


            const {

                data,

                error

            } = await client

                .from(CONFIG.table)

                .update({

                    admin_note: cleanNote

                })

                .eq("id", id)

                .select(MESSAGE_COLUMNS)

                .single();


            if (error) {

                throw error;
            }


            if (!data) {

                throw new Error(

                    "لم يتم العثور على الرسالة أو لا تملك صلاحية تعديلها."

                );
            }


            return await prepareMessage(data);

        }

        catch (error) {

            handleError(

                error,

                "تعذر حفظ الملاحظة الإدارية."

            );
        }
    }


    /* =====================================================
       32. حفظ رد الإدارة على العميل
       
       يحدث:
       - customer_reply
       - status = answered

       لا يحدث:
       - customer_reply_at
       - updated_at

       التواريخ مسؤولية Triggers.
    ===================================================== */

    async function saveCustomerReply(messageId, reply) {

        const id = validateMessageId(messageId);


        if (

            typeof reply !== "string" ||

            !reply.trim()

        ) {

            throw new Error(

                "اكتب نص الرد قبل الحفظ."

            );
        }


        const cleanReply = reply.trim();


        if (

            cleanReply.length >

            CONFIG.maximumReplyLength

        ) {

            throw new Error(

                "الرد تجاوز الحد الأقصى المسموح."

            );
        }


        try {

            const client = getClient();


            const {

                data,

                error

            } = await client

                .from(CONFIG.table)

                .update({

                    customer_reply: cleanReply,

                    status: "answered"

                })

                .eq("id", id)

                .select(MESSAGE_COLUMNS)

                .single();


            if (error) {

                throw error;
            }


            if (!data) {

                throw new Error(

                    "لم يتم العثور على الرسالة أو لا تملك صلاحية الرد عليها."

                );
            }


            return await prepareMessage(data);

        }

        catch (error) {

            handleError(

                error,

                "تعذر حفظ رد الإدارة."

            );
        }
    }


    /* =====================================================
       33. إحصائيات الرسائل
       
       الإحصائيات تعتمد على الرسائل التي تم تمريرها
       إلى الدالة، وليست بالضرورة إجمالي قاعدة البيانات.
    ===================================================== */

    function getMessageStats(messages) {

        const list = Array.isArray(messages)

            ? messages

            : [];


        const stats = {

            total: list.length,

            new: 0,

            in_review: 0,

            answered: 0,

            closed: 0,


            general: 0,

            product_question: 0,

            order_question: 0,

            complaint: 0,

            suggestion: 0,


            withAttachment: 0,

            withProduct: 0,

            withReply: 0,

            withoutReply: 0,


            replyRate: 0,

            averageResponseMinutes: null,

            oldestUnansweredAt: null

        };


        const responseTimes = [];


        list.forEach(message => {

            if (

                VALID_STATUSES.includes(message.status)

            ) {

                stats[message.status]++;
            }


            if (

                VALID_TYPES.includes(message.message_type)

            ) {

                stats[message.message_type]++;
            }


            if (

                message.has_attachment ||

                message.attachment_path

            ) {

                stats.withAttachment++;
            }


            if (message.product_id) {

                stats.withProduct++;
            }


            const reply = cleanText(

                message.customer_reply

            );


            if (reply) {

                stats.withReply++;


                if (

                    message.created_at &&

                    message.customer_reply_at

                ) {

                    const created = new Date(

                        message.created_at

                    ).getTime();


                    const replied = new Date(

                        message.customer_reply_at

                    ).getTime();


                    if (

                        Number.isFinite(created) &&

                        Number.isFinite(replied) &&

                        replied >= created

                    ) {

                        responseTimes.push(

                            (replied - created) / 60000

                        );
                    }

                }

            }

            else {

                stats.withoutReply++;

            }


            if (

                message.status !== "answered" &&

                message.status !== "closed" &&

                message.created_at

            ) {

                const created = new Date(

                    message.created_at

                ).getTime();


                if (

                    Number.isFinite(created) &&

                    (

                        stats.oldestUnansweredAt === null ||

                        created < stats.oldestUnansweredAt

                    )

                ) {

                    stats.oldestUnansweredAt = created;

                }

            }

        });


        if (stats.total > 0) {

            stats.replyRate = Math.round(

                (

                    stats.withReply /

                    stats.total

                ) * 100

            );

        }


        if (responseTimes.length) {

            stats.averageResponseMinutes = Math.round(

                responseTimes.reduce(

                    (sum, value) => sum + value,

                    0

                ) / responseTimes.length

            );

        }


        stats.averageResponseFormatted =

            formatDuration(

                stats.averageResponseMinutes

            );


        stats.oldestUnansweredFormatted =

            stats.oldestUnansweredAt

                ? formatDate(

                    new Date(

                        stats.oldestUnansweredAt

                    ).toISOString()

                )

                : "—";


        return stats;
    }


    /* =====================================================
       34. تنسيق المدة
    ===================================================== */

    function formatDuration(minutes) {

        if (

            minutes === null ||

            minutes === undefined ||

            !Number.isFinite(Number(minutes))

        ) {

            return "—";
        }


        const total = Math.max(

            0,

            Math.round(Number(minutes))

        );


        if (total < 60) {

            return total + " دقيقة";
        }


        const hours = Math.floor(total / 60);

        const remainingMinutes = total % 60;


        if (hours < 24) {

            return remainingMinutes

                ? hours + " ساعة و" + remainingMinutes + " دقيقة"

                : hours + " ساعة";
        }


        const days = Math.floor(hours / 24);

        const remainingHours = hours % 24;


        return remainingHours

            ? days + " يوم و" + remainingHours + " ساعة"

            : days + " يوم";
    }


    /* =====================================================
       35. تنسيق التاريخ
       
       المنطقة الزمنية: السعودية.
    ===================================================== */

    function formatDate(dateValue, options = {}) {

        if (!dateValue) {

            return "—";
        }


        const date = new Date(dateValue);


        if (Number.isNaN(date.getTime())) {

            return "—";
        }


        const formatterOptions = {

            year: "numeric",

            month: "long",

            day: "numeric",

            timeZone: CONFIG.timeZone,

            ...options

        };


        return new Intl.DateTimeFormat(

            CONFIG.dateLocale,

            formatterOptions

        ).format(date);
    }


    function formatDateTime(dateValue) {

        return formatDate(

            dateValue,

            {

                hour: "2-digit",

                minute: "2-digit"

            }

        );
    }


    /* =====================================================
       36. تنسيق رقم الجوال السعودي
       
       يدعم:
       05xxxxxxxx
       5xxxxxxxx
       9665xxxxxxxx
       009665xxxxxxxx
       والأرقام العربية.
    ===================================================== */

    function normalizeSaudiPhone(phone) {

        if (!phone) {

            return "";
        }


        let value = normalizeDigits(phone)

            .replace(/[^\d+]/g, "");


        value = value.replace(/\+/g, "");


        if (value.startsWith("00966")) {

            value = value.slice(2);
        }


        if (value.startsWith("966")) {

            if (

                value.length === 12 &&

                /^9665\d{8}$/.test(value)

            ) {

                return value;
            }


            return "";
        }


        if (

            value.length === 10 &&

            /^05\d{8}$/.test(value)

        ) {

            return "966" + value.slice(1);
        }


        if (

            value.length === 9 &&

            /^5\d{8}$/.test(value)

        ) {

            return "966" + value;
        }


        return "";
    }


    /* =====================================================
       37. تجهيز رابط واتساب
       
       لا يرسل الرسالة تلقائياً.
    ===================================================== */

    function buildWhatsAppUrl(phone, message = "") {

        const normalizedPhone = normalizeSaudiPhone(

            phone

        );


        if (!normalizedPhone) {

            throw new Error(

                "رقم الهاتف غير صالح لفتح واتساب."

            );
        }


        const encodedMessage = encodeURIComponent(

            String(message || "")

        );


        return (

            "https://wa.me/" +

            normalizedPhone +

            (

                encodedMessage

                    ? "?text=" + encodedMessage

                    : ""

            )

        );
    }


    /* =====================================================
       38. إنشاء نص رد مقترح لواتساب
    ===================================================== */

    function buildWhatsAppReply(message, reply) {

        if (!message || !reply) {

            throw new Error(

                "بيانات الرسالة والرد مطلوبة."

            );
        }


        const name = cleanText(

            message.customer_name

        );


        const inquiryNumber = cleanText(

            message.inquiry_number

        );


        return [

            "مرحباً " + (name || "بك") + "،",

            "",

            cleanText(reply),

            "",

            inquiryNumber

                ? "رقم استفسارك: " + inquiryNumber

                : "",

            "متجر IBR20 للأثاث الخشبي"

        ]

            .filter(Boolean)

            .join("\n");
    }


    /* =====================================================
       39. تنظيف ذاكرة روابط المرفقات
    ===================================================== */

    function clearAttachmentUrlCache(path) {

        if (path) {

            signedUrlCache.delete(path);

            return true;
        }


        signedUrlCache.clear();

        return true;
    }


    /* =====================================================
       40. تحديث رابط مرفق بالقوة
    ===================================================== */

    async function refreshAttachmentUrl(path) {

        clearAttachmentUrlCache(path);


        return createAttachmentUrl(

            path,

            {

                forceRefresh: true

            }

        );
    }


    /* =====================================================
       41. بيانات تعريف الخدمة
    ===================================================== */

    function getServiceInfo() {

        return {

            version: "2.0.0",

            table: CONFIG.table,

            storageBucket: CONFIG.storageBucket,

            defaultLimit: CONFIG.defaultLimit,

            maximumLimit: CONFIG.maximumLimit,

            defaultPageSize: CONFIG.defaultPageSize,

            maximumPageSize: CONFIG.maximumPageSize,

            attachmentSecurity: "private-signed-urls",

            usesSharedSupabaseClient: true

        };
    }


    /* =====================================================
       42. تصدير الخدمة
       
       حافظنا على الدوال القديمة.
       وأضفنا الدوال الجديدة.
    ===================================================== */

    window.IBRMessagesService = Object.freeze({

        /* التهيئة والاتصال */

        configure,

        getClient,

        getServiceInfo,


        /* جلب البيانات */

        fetchMessages,

        fetchMessagesPage,

        getMessageById,

        getMessageByInquiryNumber,


        /* البحث والتصفية */

        searchMessages,

        filterMessages,


        /* إدارة الرسائل */

        updateMessageStatus,

        updateAdminNote,

        saveCustomerReply,


        /* المرفقات */

        parseAttachmentPaths,

        prepareAttachments,

        createAttachmentUrl,

        createAttachmentUrls,

        refreshAttachmentUrl,

        clearAttachmentUrlCache,


        /* الإحصائيات */

        getMessageStats,

        formatDuration,


        /* التاريخ */

        formatDate,

        formatDateTime,


        /* واتساب */

        normalizeSaudiPhone,

        buildWhatsAppUrl,

        buildWhatsAppReply,


        /* البيانات الثابتة */

        messageTypes: MESSAGE_TYPES,

        messageStatuses: MESSAGE_STATUSES,

        validTypes: VALID_TYPES,

        validStatuses: VALID_STATUSES,


        /* إعدادات القراءة */

        config: CONFIG,

        messageColumns: MESSAGE_COLUMNS

    });


    console.info(

        "IBRMessagesService v2.0.0 initialized successfully."

    );

})();