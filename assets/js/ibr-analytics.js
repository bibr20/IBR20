
/* =========================================================
   IBR20 ANALYTICS ENGINE
   محرك تحليلات وسلوك زوار متجر IBR20

   Version: 1.0.0

   المسؤوليات:
   1. إنشاء معرف الزائر والجلسة.
   2. تسجيل زيارات الصفحات.
   3. تسجيل مشاهدات المنتجات والتصنيفات.
   4. تسجيل البحث والتوصيات والمفضلة.
   5. تسجيل تفاعلات السلة والشراء.
   6. إرسال الأحداث إلى Supabase Edge Function.
   7. منع تكرار الأحداث.
   8. إعادة محاولة الإرسال عند انقطاع الاتصال.
   9. عدم تخزين البيانات الشخصية.
   10. عدم التأثير على أنظمة المتجر الحالية.

   ========================================================= */

(function (window, document) {
    "use strict";

    if (window.IBRAnalytics) return;

    /* =====================================================
       1. الإعدادات
    ===================================================== */

    const CONFIG = Object.freeze({

        version: "1.0.0",

        storagePrefix: "ibr-analytics-v1",

        visitorKey: "ibr-analytics-visitor-v1",

        sessionKey: "ibr-analytics-session-v1",

        queueKey: "ibr-analytics-queue-v1",

        consentKey: "ibr-analytics-consent-v1",

        sessionDuration: 30 * 60 * 1000,

        maxQueue: 200,

        maxRetries: 5,

        maxEventAge: 7 * 24 * 60 * 60 * 1000,

        maxQueueStorage: 300000,

        endpoint:
            "https://edttlagqjrcqccxnbcej.supabase.co/functions/v1/ibr-analytics",

        supabaseUrl:
            "https://edttlagqjrcqccxnbcej.supabase.co",

        debug: false

    });

    const ALLOWED_EVENTS = new Set([

        "page_view",

        "product_view",

        "category_view",

        "search",

        "recommendation_shown",

        "recommendation_click",

        "favorite",

        "add_to_cart",

        "checkout_started",

        "inquiry_submitted",

        "order_completed"

    ]);

    const UUID_PATTERN =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    /* =====================================================
       2. الحالة الداخلية
    ===================================================== */

    let visitorId = null;

    let sessionId = null;

    let sessionStartedAt = 0;

    let lastActivityAt = 0;

    let currentPath = null;

    let initialized = false;

    let sending = false;

    let consentGranted = false;

    let queue = [];

    let pageViewRecorded = false;

    let flushPromise = null;

    // رقم دورة الموافقة: يتغير عند قبول الموافقة أو سحبها.
    let consentGeneration = 0;

    // للتحكم في طلب الإرسال الجاري وإلغائه عند سحب الموافقة.
    let activeController = null;

    const pageEvents = new Set();

    const listeners = [];

    /* =====================================================
       3. أدوات مساعدة
    ===================================================== */

    function log() {

        if (!CONFIG.debug) return;

        console.log.apply(
            console,
            ["[IBR Analytics]"].concat(
                Array.from(arguments)
            )
        );

    }

    function warn() {

        if (!CONFIG.debug) return;

        console.warn.apply(
            console,
            ["[IBR Analytics]"].concat(
                Array.from(arguments)
            )
        );

    }

    function now() {

        return Date.now();

    }

    function isoNow() {

        return new Date().toISOString();

    }

    function createUUID() {

        if (
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ) {

            return window.crypto.randomUUID();

        }

        if (
            window.crypto &&
            typeof window.crypto.getRandomValues === "function"
        ) {

            const bytes = new Uint8Array(16);

            window.crypto.getRandomValues(bytes);

            bytes[6] = (bytes[6] & 0x0f) | 0x40;

            bytes[8] = (bytes[8] & 0x3f) | 0x80;

            const hex = Array.from(bytes, function (byte) {

                return byte.toString(16).padStart(2, "0");

            }).join("");

            return (
                hex.slice(0, 8) + "-" +
                hex.slice(8, 12) + "-" +
                hex.slice(12, 16) + "-" +
                hex.slice(16, 20) + "-" +
                hex.slice(20)
            );

        }

        throw new Error(
            "Secure random UUID generation is unavailable."
        );

    }

    function validUUID(value) {

        return (
            typeof value === "string" &&
            UUID_PATTERN.test(value)
        );

    }

    function cleanText(value, maxLength) {

        if (typeof value !== "string") return null;

        const result = value
            .trim()
            .replace(/[\u0000-\u001F\u007F]/g, "");

        if (!result) return null;

        return result.slice(0, maxLength || 100);

    }

    function cleanPath(value) {

        // لا نحوّل القيمة null إلى رابط الصفحة الحالية.
        if (value === null) return null;

        try {

            const url = new URL(
                value || window.location.href,
                window.location.origin
            );

            if (url.origin !== window.location.origin) {
                return null;
            }

            // نرسل مسار الصفحة فقط دون Query Parameters
            // لتجنب تسريب رموز أو بيانات قد توجد في الرابط.
            return url.pathname.slice(0, 500);

        } catch (error) {

            return null;

        }

    }

    function safeStorageGet(key) {

        try {

            return localStorage.getItem(key);

        } catch (error) {

            return null;

        }

    }

    function safeStorageSet(key, value) {

        try {

            localStorage.setItem(key, value);

            return true;

        } catch (error) {

            return false;

        }

    }

    function safeStorageRemove(key) {

        try {

            localStorage.removeItem(key);

        } catch (error) { }

    }

    function readJSON(key, fallback) {

        try {

            const value = safeStorageGet(key);

            if (!value) return fallback;

            return JSON.parse(value);

        } catch (error) {

            return fallback;

        }

    }

    function writeJSON(key, value) {

        try {

            const serialized = JSON.stringify(value);

            if (
                serialized.length >
                CONFIG.maxQueueStorage
            ) {

                return false;

            }

            return safeStorageSet(key, serialized);

        } catch (error) {

            return false;

        }

    }

    function isValidObject(value) {

        return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        );

    }

    /* =====================================================
       4. الموافقة على التحليلات
    ===================================================== */

    function hasConsent() {

        return (
            safeStorageGet(CONFIG.consentKey) === "granted"
        );

    }

    function setConsent(value) {

        const nextConsent = value === true;

        // لا نكرر عمليات التهيئة إذا لم يتغير القرار.
        if (
            nextConsent === consentGranted &&
            safeStorageGet(CONFIG.consentKey) ===
            (nextConsent ? "granted" : "denied")
        ) {

            if (nextConsent && initialized) {
                flush();
            }

            return true;

        }

        // كل تغيير للموافقة يبدأ دورة جديدة.
        consentGeneration++;

        if (nextConsent) {

            consentGranted = true;

            safeStorageSet(
                CONFIG.consentKey,
                "granted"
            );

            log("Analytics consent granted.");

            if (!initialized) {

                initialize();

                return true;

            }

            // إعادة تجهيز الهوية والجلسة عند إعادة الموافقة.
            initializeIdentity();

            initializeSession();

            loadQueue();

            // نعيد تسجيل مشاهدة الصفحة بعد الموافقة.
            recordPageView();

            flush();

            return true;

        }

        // سحب الموافقة: أوقف الإرسال أولاً.
        consentGranted = false;

        safeStorageSet(
            CONFIG.consentKey,
            "denied"
        );

        // إلغاء طلب الشبكة الجاري إن وجد.
        if (activeController) {

            try {

                activeController.abort();

            } catch (error) {

                warn(
                    "Could not abort analytics request:",
                    error
                );

            }

            activeController = null;

        }

        // حذف الأحداث المعلقة والهويات المحلية.
        queue = [];

        visitorId = null;

        sessionId = null;

        sessionStartedAt = 0;

        lastActivityAt = 0;

        currentPath = null;

        pageViewRecorded = false;

        pageEvents.clear();

        viewedProducts.clear();

        viewedCategories.clear();

        safeStorageRemove(CONFIG.visitorKey);

        safeStorageRemove(CONFIG.sessionKey);

        safeStorageRemove(CONFIG.queueKey);

        log("Analytics consent revoked.");

        return true;

    }
    /* =====================================================
       5. هوية الزائر
    ===================================================== */

    function initializeIdentity() {

        if (!consentGranted) return null;

        let savedId = safeStorageGet(
            CONFIG.visitorKey
        );

        if (!validUUID(savedId)) {

            savedId = createUUID();

            safeStorageSet(
                CONFIG.visitorKey,
                savedId
            );

        }

        visitorId = savedId;

        return visitorId;

    }

    /* =====================================================
       6. إدارة الجلسات
    ===================================================== */

    function initializeSession(forceNew) {

        if (!consentGranted) return null;

        const timestamp = now();

        const saved = readJSON(
            CONFIG.sessionKey,
            null
        );

        const validSavedSession = (
            saved &&
            validUUID(saved.sessionId) &&
            validUUID(saved.visitorId) &&
            saved.visitorId === visitorId &&
            Number.isFinite(saved.lastActivityAt) &&
            timestamp - saved.lastActivityAt <
            CONFIG.sessionDuration &&
            timestamp >= saved.lastActivityAt
        );

        if (
            !forceNew &&
            validSavedSession
        ) {

            sessionId = saved.sessionId;

            sessionStartedAt = saved.startedAt;

            lastActivityAt = saved.lastActivityAt;

        } else {

            sessionId = createUUID();

            sessionStartedAt = timestamp;

            lastActivityAt = timestamp;

        }

        persistSession();

        return sessionId;

    }

    function persistSession() {

        if (!sessionId || !visitorId) return;

        writeJSON(CONFIG.sessionKey, {

            sessionId: sessionId,

            visitorId: visitorId,

            startedAt: sessionStartedAt,

            lastActivityAt: lastActivityAt

        });

    }

    function touchSession() {

        if (!consentGranted) return;

        const timestamp = now();

        if (
            !sessionId ||
            timestamp - lastActivityAt >
            CONFIG.sessionDuration
        ) {

            initializeSession(true);

        }

        lastActivityAt = timestamp;

        persistSession();

    }

    /* =====================================================
       7. مصدر الزيارة
    ===================================================== */

    function getTrafficSource() {

        const params = new URLSearchParams(
            window.location.search
        );

        const referrer = document.referrer;

        const campaignSource = cleanText(
            params.get("utm_source"),
            100
        );

        const campaignMedium = cleanText(
            params.get("utm_medium"),
            100
        );

        const campaignName = cleanText(
            params.get("utm_campaign"),
            150
        );

        if (campaignSource) {

            return {

                source: campaignSource,

                medium: campaignMedium,

                campaign: campaignName

            };

        }

        if (!referrer) {

            return {

                source: "direct",

                medium: null,

                campaign: null

            };

        }

        try {

            const referrerUrl = new URL(referrer);

            if (
                referrerUrl.hostname ===
                window.location.hostname
            ) {

                return {

                    source: "internal",

                    medium: null,

                    campaign: null

                };

            }

            return {

                source: cleanText(
                    referrerUrl.hostname,
                    100
                ),

                medium: "referral",

                campaign: null

            };

        } catch (error) {

            return {

                source: "unknown",

                medium: null,

                campaign: null

            };

        }

    }

    /* =====================================================
       8. تجهيز الحدث
    ===================================================== */

    function normalizeEventData(data) {

        if (!isValidObject(data)) return {};

        const allowed = [

            "query_length",

            "result_count",

            "position",

            "item_count"

        ];

        const result = {};

        allowed.forEach(function (key) {

            const value = data[key];

            if (
                typeof value === "number" &&
                Number.isInteger(value) &&
                value >= 0 &&
                value <= 100000
            ) {

                result[key] = value;

            }

        });

        return result;

    }


    function buildEvent(eventName, details, eventId) {

        const options = isValidObject(details)
            ? details
            : {};

        const source = getTrafficSource();

        return {

            event_id: validUUID(eventId)
                ? eventId
                : createUUID(),

            event_name: eventName,

            visitor_id: visitorId,

            session_id: sessionId,

            page_path: cleanPath(
                options.page_path ||
                window.location.href
            ),
            previous_path: cleanPath(
                Object.prototype.hasOwnProperty.call(
                    options,
                    "previous_path"
                )
                    ? options.previous_path
                    : currentPath
            ),

            referrer: cleanReferrer(),

            source: source.source,

            medium: source.medium,

            campaign: source.campaign,

            product_id: options.product_id || null,

            category_id: options.category_id || null,

            placement: cleanText(
                options.placement,
                100
            ),

            event_data: normalizeEventData(
                options.event_data
            )

        };

    }

    function cleanReferrer() {

        if (!document.referrer) return null;

        try {

            const url = new URL(document.referrer);

            if (
                !["http:", "https:"].includes(url.protocol)
            ) {

                return null;

            }

            return (
                url.origin +
                url.pathname
            ).slice(0, 1000);

        } catch (error) {

            return null;

        }

    }

    /* =====================================================
       9. إدارة قائمة الإرسال
    ===================================================== */

    function loadQueue() {

        const saved = readJSON(
            CONFIG.queueKey,
            []
        );

        if (!Array.isArray(saved)) {

            queue = [];

            return;

        }

        const cutoff = now() - CONFIG.maxEventAge;

        queue = saved.filter(function (item) {

            return (
                isValidObject(item) &&
                validUUID(item.event_id) &&
                validUUID(item.visitor_id) &&
                validUUID(item.session_id) &&
                ALLOWED_EVENTS.has(item.event_name) &&
                Number.isFinite(item._createdAt) &&
                item._createdAt >= cutoff &&
                Number.isInteger(item._attempts) &&
                item._attempts >= 0 &&
                item._attempts <= CONFIG.maxRetries
            );

        }).slice(-CONFIG.maxQueue);

    }

    function saveQueue() {

        return writeJSON(
            CONFIG.queueKey,
            queue
        );

    }

    /* =====================================================
       10. تسجيل الأحداث
    ===================================================== */


    function track(eventName, details, eventId) {

        if (!consentGranted) {

            return false;

        }

        if (!ALLOWED_EVENTS.has(eventName)) {

            warn("Unsupported event:", eventName);

            return false;

        }

        touchSession();

        if (!visitorId || !sessionId) {

            return false;

        }

        const event = buildEvent(
            eventName,
            details,
            eventId
        );

        event._createdAt = now();

        event._attempts = 0;

        queue.push(event);

        if (queue.length > CONFIG.maxQueue) {

            queue = queue.slice(-CONFIG.maxQueue);

        }

        saveQueue();

        log("Event queued:", eventName);

        flush();

        return true;

    }

    /* =====================================================
       11. إرسال الأحداث
    ===================================================== */

    async function sendEvent(event, controller, generation) {

        if (
            !consentGranted ||
            generation !== consentGeneration
        ) {

            throw new Error(
                "Analytics consent is no longer active."
            );

        }

        const payload = {

            event_id: event.event_id,

            event_name: event.event_name,

            visitor_id: event.visitor_id,

            session_id: event.session_id,

            page_path: event.page_path,

            previous_path: event.previous_path,

            referrer: event.referrer,

            source: event.source,

            medium: event.medium,

            campaign: event.campaign,

            product_id: event.product_id,

            category_id: event.category_id,

            placement: event.placement,

            event_data: event.event_data

        };

        const requestOptions = {

            method: "POST",

            headers: {

                "Content-Type": "application/json",

                "apikey": getPublishableKey()

            },

            body: JSON.stringify(payload),

            credentials: "omit",

            cache: "no-store"

        };

        if (controller) {
            requestOptions.signal = controller.signal;
        }

        if (
            !consentGranted ||
            generation !== consentGeneration
        ) {

            throw new Error(
                "Analytics consent changed before sending."
            );

        }

        try {

            const response = await fetch(
                CONFIG.endpoint,
                requestOptions
            );

            // لا نعالج نتيجة طلب من دورة موافقة قديمة.
            if (
                !consentGranted ||
                generation !== consentGeneration
            ) {

                throw new Error(
                    "Analytics consent changed during delivery."
                );

            }

            if (!response.ok) {

                throw new Error(
                    "Analytics HTTP " + response.status
                );

            }

            const result = await response.json();

            if (
                !consentGranted ||
                generation !== consentGeneration
            ) {

                throw new Error(
                    "Analytics consent changed after response."
                );

            }

            if (!result.success) {

                throw new Error(
                    "Analytics event was not accepted."
                );

            }

            return result;

        } finally {

            if (
                controller &&
                activeController === controller
            ) {

                activeController = null;

            }

        }

    }

    function getPublishableKey() {

        const client =
            window.supabaseClient ||
            window.client;

        if (
            client &&
            client.supabaseKey
        ) {

            return client.supabaseKey;

        }

        return "";

    }
    async function flush() {

        if (
            sending ||
            !consentGranted ||
            queue.length === 0
        ) {

            return false;

        }

        if (flushPromise) {

            return flushPromise;

        }

        sending = true;

        // نحتفظ برقم دورة الموافقة التي بدأ فيها الإرسال.
        const generation = consentGeneration;

        flushPromise = (async function () {

            try {

                while (
                    queue.length > 0 &&
                    consentGranted &&
                    generation === consentGeneration
                ) {

                    const event = queue[0];

                    let controller = null;

                    if (
                        typeof window.AbortController ===
                        "function"
                    ) {

                        controller =
                            new window.AbortController();

                        activeController = controller;

                    }

                    try {

                        await sendEvent(
                            event,
                            controller,
                            generation
                        );

                        // إذا تغيرت الموافقة فلا نلمس قائمة
                        // الانتظار التابعة للدورة الجديدة.
                        if (
                            !consentGranted ||
                            generation !== consentGeneration
                        ) {

                            break;

                        }

                        // نحذف الحدث الذي نجح إرساله فقط.
                        if (
                            queue[0] &&
                            queue[0].event_id === event.event_id
                        ) {

                            queue.shift();

                            saveQueue();

                        }

                    } catch (error) {

                        // الإلغاء بسبب سحب الموافقة ليس فشلاً
                        // عادياً، ولا ينبغي زيادة عدد المحاولات.
                        if (
                            !consentGranted ||
                            generation !== consentGeneration
                        ) {

                            break;

                        }

                        event._attempts++;

                        if (
                            event._attempts >
                            CONFIG.maxRetries
                        ) {

                            warn(
                                "Event removed after retries:",
                                event.event_name
                            );

                            if (
                                queue[0] &&
                                queue[0].event_id === event.event_id
                            ) {

                                queue.shift();

                                saveQueue();

                            }

                            continue;

                        }

                        saveQueue();

                        warn(
                            "Event delivery postponed:",
                            error.message
                        );

                        break;

                    }

                }

                return (
                    consentGranted &&
                    generation === consentGeneration &&
                    queue.length === 0
                );

            } finally {

                sending = false;

                flushPromise = null;

                // إذا تغيرت الموافقة أثناء الإرسال ثم أعيدت،
                // نبدأ دورة جديدة بعد إنهاء الدورة القديمة.
                if (
                    consentGranted &&
                    generation !== consentGeneration &&
                    queue.length > 0
                ) {

                    Promise.resolve().then(function () {

                        flush();

                    });

                }

            }

        })();

        return flushPromise;

    }
    /* =====================================================
       12. تسجيل زيارات الصفحات
    ===================================================== */

    function recordPageView() {

        if (
            !consentGranted ||
            pageViewRecorded
        ) {

            return false;

        }

        const path = cleanPath(
            window.location.href
        );

        if (!path) return false;

        currentPath = path;

        pageViewRecorded = true;

        return track(
            "page_view",
            {

                page_path: path,

                previous_path: null,

                event_data: {}

            }
        );

    }

    /* =====================================================
       13. مشاهدات المنتجات
    ===================================================== */

    const viewedProducts = new Set();

    function recordProductView(product) {

        if (!isValidObject(product)) return false;

        const productId = product.id;

        if (!validUUID(productId)) return false;

        if (viewedProducts.has(productId)) {

            return false;

        }

        viewedProducts.add(productId);

        return track(
            "product_view",
            {

                product_id: productId,

                category_id:
                    validUUID(product.category_id)
                        ? product.category_id
                        : null

            }
        );

    }

    /* =====================================================
       14. مشاهدات التصنيفات
    ===================================================== */

    const viewedCategories = new Set();

    function recordCategoryView(category) {

        const categoryId =
            typeof category === "string"
                ? category
                : category && category.id;

        if (!validUUID(categoryId)) return false;

        if (viewedCategories.has(categoryId)) {

            return false;

        }

        viewedCategories.add(categoryId);

        return track(
            "category_view",
            {

                category_id: categoryId

            }
        );

    }

    /* =====================================================
       15. البحث
    ===================================================== */

    function recordSearch(query, resultCount) {

        const value = cleanText(
            String(query || ""),
            500
        );

        if (!value) return false;

        return track(
            "search",
            {

                event_data: {

                    query_length: value.length,

                    result_count:
                        Number.isInteger(resultCount) &&
                            resultCount >= 0
                            ? resultCount
                            : 0

                }

            }
        );

    }

    /* =====================================================
       16. التوصيات
    ===================================================== */

    function recordRecommendationShown(
        product,
        placement,
        position
    ) {

        if (!isValidObject(product)) return false;

        if (!validUUID(product.id)) return false;

        return track(
            "recommendation_shown",
            {

                product_id: product.id,

                category_id:
                    validUUID(product.category_id)
                        ? product.category_id
                        : null,

                placement: placement,

                event_data: {

                    position:
                        Number.isInteger(position) &&
                            position >= 0
                            ? position
                            : 0

                }

            }
        );

    }

    function recordRecommendationClick(
        product,
        placement,
        position
    ) {

        if (!isValidObject(product)) return false;

        if (!validUUID(product.id)) return false;

        return track(
            "recommendation_click",
            {

                product_id: product.id,

                category_id:
                    validUUID(product.category_id)
                        ? product.category_id
                        : null,

                placement: placement,

                event_data: {

                    position:
                        Number.isInteger(position) &&
                            position >= 0
                            ? position
                            : 0

                }

            }
        );

    }

    /* =====================================================
       17. المفضلة
    ===================================================== */

    function recordFavorite(product) {

        if (!isValidObject(product)) return false;

        if (!validUUID(product.id)) return false;

        return track(
            "favorite",
            {

                product_id: product.id,

                category_id:
                    validUUID(product.category_id)
                        ? product.category_id
                        : null

            }
        );

    }

    /* =====================================================
       18. السلة
    ===================================================== */

    function recordAddToCart(product, quantity) {

        if (!isValidObject(product)) return false;

        if (!validUUID(product.id)) return false;

        return track(
            "add_to_cart",
            {

                product_id: product.id,

                category_id:
                    validUUID(product.category_id)
                        ? product.category_id
                        : null,

                event_data: {

                    item_count:
                        Number.isInteger(quantity) &&
                            quantity > 0
                            ? quantity
                            : 1

                }

            }
        );

    }

    /* =====================================================
       19. بدء إتمام الطلب
    ===================================================== */

    function recordCheckoutStarted(itemCount) {

        const quantity =
            Number.isInteger(itemCount) && itemCount >= 0
                ? itemCount
                : 0;

        return track(
            "checkout_started",
            {
                event_data: {
                    item_count: quantity
                }
            }
        );

    }

    /* =====================================================
       20. إرسال الاستفسار
    ===================================================== */

    function recordInquirySubmitted() {

        return track(
            "inquiry_submitted",
            {}
        );

    }

    /* =====================================================
       21. إتمام الطلب
    ===================================================== */

    async function recordOrderCompleted(itemCount, idempotencyKey) {

        const quantity =
            Number.isInteger(itemCount) &&
                itemCount >= 0
                ? itemCount
                : 0;

        if (
            !validUUID(idempotencyKey) ||
            !window.crypto ||
            !window.crypto.subtle ||
            typeof window.crypto.subtle.digest !== "function"
        ) {

            warn(
                "Cannot create a stable order analytics event ID."
            );

            return false;

        }

        try {

            // تحويل مفتاح المحاولة إلى بصمة SHA-256
            // المفتاح الأصلي لا يغادر المتصفح.

            const encoded = new TextEncoder().encode(
                "IBR20-ORDER-COMPLETED:" + idempotencyKey
            );

            const hashBuffer = await window.crypto.subtle.digest(
                "SHA-256",
                encoded
            );

            const bytes = new Uint8Array(hashBuffer).slice(0, 16);

            // إنشاء معرّف حدث ثابت بصيغة UUID باستخدام SHA-256
            // لضمان استخدام event_id نفسه عند إعادة إرسال الطلب بالمفتاح نفسه.

            bytes[6] = (bytes[6] & 0x0f) | 0x50;

            bytes[8] = (bytes[8] & 0x3f) | 0x80;

            const hex = Array.from(bytes, function (byte) {

                return byte.toString(16).padStart(2, "0");

            }).join("");

            const eventId = (
                hex.slice(0, 8) + "-" +
                hex.slice(8, 12) + "-" +
                hex.slice(12, 16) + "-" +
                hex.slice(16, 20) + "-" +
                hex.slice(20)
            );

            return track(
                "order_completed",
                {
                    event_data: {
                        item_count: quantity
                    }
                },
                eventId
            );

        } catch (error) {

            warn(
                "Failed to generate order event ID:",
                error
            );

            return false;

        }

    }

    /* =====================================================
       22. مراقبة نشاط المستخدم
    ===================================================== */

    function addListener(target, eventName, callback, options) {

        target.addEventListener(
            eventName,
            callback,
            options
        );

        listeners.push({

            target: target,

            eventName: eventName,

            callback: callback,

            options: options

        });

    }

    function setupActivityTracking() {

        addListener(
            document,
            "visibilitychange",
            function () {

                if (
                    document.visibilityState === "visible"
                ) {

                    touchSession();

                    flush();

                }

            }
        );

        addListener(
            window,
            "online",
            function () {

                flush();

            }
        );

        addListener(
            window,
            "pagehide",
            function () {

                saveQueue();

            }
        );

    }

    /* =====================================================
       23. التهيئة
    ===================================================== */

    function initialize() {

        if (initialized) return;

        consentGranted = hasConsent();

        if (!consentGranted) {

            log(
                "Waiting for analytics consent."
            );

            return;

        }

        // لا نعتبر النظام مهيأً إلا بعد وجود الموافقة.
        initialized = true;

        initializeIdentity();

        initializeSession();

        loadQueue();

        setupActivityTracking();

        recordPageView();

        flush();

        log(
            "Analytics engine initialized.",
            CONFIG.version
        );

    }


    /* =====================================================
       24. إعادة ضبط المحرك
    ===================================================== */

    function reset() {

        queue = [];

        pageEvents.clear();

        viewedProducts.clear();

        viewedCategories.clear();

        pageViewRecorded = false;

        currentPath = null;

        saveQueue();

        return true;

    }

    /* =====================================================
       25. معلومات المحرك
    ===================================================== */

    function getStatus() {

        return {

            version: CONFIG.version,

            initialized: initialized,

            consentGranted: consentGranted,

            visitorId: visitorId,

            sessionId: sessionId,

            queuedEvents: queue.length,

            sending: sending,

            currentPath: currentPath

        };

    }

    /* =====================================================
       26. الواجهة العامة
    ===================================================== */

    const API = Object.freeze({

        initialize: initialize,

        setConsent: setConsent,

        hasConsent: hasConsent,

        track: track,

        recordPageView: recordPageView,

        recordProductView: recordProductView,

        recordCategoryView: recordCategoryView,

        recordSearch: recordSearch,

        recordRecommendationShown:
            recordRecommendationShown,

        recordRecommendationClick:
            recordRecommendationClick,

        recordFavorite: recordFavorite,

        recordAddToCart: recordAddToCart,

        recordCheckoutStarted:
            recordCheckoutStarted,

        recordInquirySubmitted:
            recordInquirySubmitted,

        recordOrderCompleted:
            recordOrderCompleted,

        flush: flush,

        reset: reset,

        getStatus: getStatus

    });

    window.IBRAnalytics = API;

    /* =====================================================
       27. التشغيل التلقائي
    ===================================================== */

    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );

    } else {

        initialize();

    }

})(window, document);
