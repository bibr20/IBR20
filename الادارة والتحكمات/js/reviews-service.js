
/* =========================================================
   IBR20 REVIEWS SERVICE
   الخدمة المركزية لتقييمات المنتجات
   Version: 1.0.0

   المسؤوليات:
   - قراءة التقييمات المعتمدة من الواجهات العامة الآمنة.
   - قراءة صور التقييمات المعتمدة من الواجهة العامة.
   - إنشاء روابط مؤقتة لعرض الصور الخاصة.
   - حساب متوسط التقييمات وتوزيع النجوم.
   - البحث والفرز والتصفية.
   - تمرير عمليات الإدارة إلى Edge Function آمنة.

   يعتمد على:
   window.supabaseClient
   public.public_product_reviews
   public.public_review_images
   Storage bucket: ibr20-review-images

   لا ينشئ اتصال Supabase جديدًا.
   لا يغيّر قاعدة البيانات.
========================================================= */

(() => {
    "use strict";

    if (window.IBRReviewsService) {
        console.warn("IBRReviewsService is already initialized.");
        return;
    }

    const CONFIG = Object.freeze({
        reviewsView: "public_product_reviews",
        imagesView: "public_review_images",
        storageBucket: "ibr20-review-images",

        adminFunction: "ibr-admin-product-reviews",

        defaultLimit: 20,
        maximumLimit: 100,
        maximumPageSize: 100,

        signedUrlExpiry: 3600,
        signedUrlCacheTime: 3300000,

        maximumReviewTextLength: 2000,
        maximumCustomerNameLength: 120,

        ratings: [1, 2, 3, 4, 5],
        sortOptions: [
            "newest",
            "oldest",
            "rating",
            "rating_ascending",
            "highest",
            "lowest"
        ]
    });

    let configuredClient = null;

    const signedUrlCache = new Map();

    /* =====================================================
       1. الاتصال والإعدادات
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

        if (!client || typeof client.from !== "function") {
            throw new Error(
                "اتصال Supabase غير متاح. تحقق من تحميل store.js."
            );
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
        console.error("[IBRReviewsService]", error);

        const message =
            error?.message ||
            error?.details ||
            error?.hint;

        throw new Error(
            message ||
            fallbackMessage ||
            "حدث خطأ أثناء تنفيذ العملية."
        );
    }

    /* =====================================================
       2. أدوات التحقق والتطبيع
    ===================================================== */

    function isValidUuid(value) {
        return (
            typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                .test(value.trim())
        );
    }

    function validateUuid(value, label = "المعرف") {
        if (!isValidUuid(value)) {
            throw new Error(`${label} غير صالح.`);
        }

        return value.trim();
    }

    function toNumber(value) {
        if (typeof value === "string") {
            value = value
                .replace(/[٬,]/g, "")
                .replace(/[٫]/g, ".");
        }

        const number = Number(value);

        return Number.isFinite(number) ? number : 0;
    }

    function normalizeText(value) {
        return String(value ?? "")
            .normalize("NFKC")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeArabicDigits(value) {
        return String(value ?? "").replace(/[٠-٩۰-۹]/g, digit => {
            const code = digit.charCodeAt(0);

            return String(
                code >= 0x06F0 && code <= 0x06F9
                    ? code - 0x06F0
                    : code - 0x0660
            );
        });
    }

    function normalizeSearchText(value) {
        return normalizeArabicDigits(value)
            .toLowerCase()
            .replace(/[أإآ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/[ًٌٍَُِّْـ]/g, "")
            .trim();
    }

    function validateRating(rating) {
        const value = Number(rating);

        if (!Number.isInteger(value) || value < 1 || value > 5) {
            throw new Error("التقييم يجب أن يكون من نجمة واحدة إلى خمس نجوم.");
        }

        return value;
    }

    function getLimit(value) {
        if (
            value === undefined ||
            value === null ||
            value === ""
        ) {
            return CONFIG.defaultLimit;
        }

        const number = Number(value);

        if (!Number.isFinite(number)) {
            return CONFIG.defaultLimit;
        }

        return Math.min(
            Math.max(Math.floor(number), 1),
            CONFIG.maximumLimit
        );
    }

    function getPageSize(value) {
        const number = Number(value) || CONFIG.defaultLimit;

        return Math.min(
            Math.max(Math.floor(number), 1),
            CONFIG.maximumPageSize
        );
    }

    /* =====================================================
       3. تطبيع بيانات التقييم
    ===================================================== */

    function normalizeReview(review) {
        if (!review || typeof review !== "object") {
            return null;
        }

        return {
            id: review.id || null,

            productId: review.product_id || null,

            customerName:
                normalizeText(review.customer_name) ||
                "عميل",

            rating: validateRating(review.rating),

            reviewText:
                review.review_text === null ||
                    review.review_text === undefined
                    ? ""
                    : String(review.review_text),

            createdAt: review.created_at || null,

            images: [],

            imagesCount: 0,

            verifiedPurchase: false
        };
    }

    function normalizeImage(image) {
        if (!image || typeof image !== "object") {
            return null;
        }

        return {
            id: image.id || null,
            reviewId: image.review_id || null,
            imagePath: image.image_path || null,
            sortOrder: Number(image.sort_order) || 1,
            createdAt: image.created_at || null,
            signedUrl: null
        };
    }

    /* =====================================================
       4. روابط الصور المؤقتة
    ===================================================== */

    function getCachedSignedUrl(path) {
        const cached = signedUrlCache.get(path);

        if (!cached) return null;

        if (Date.now() >= cached.expiresAt) {
            signedUrlCache.delete(path);
            return null;
        }

        return cached.url;
    }

    function saveSignedUrl(path, url) {
        signedUrlCache.set(path, {
            url,
            expiresAt: Date.now() + CONFIG.signedUrlCacheTime
        });
    }

    async function createSignedUrl(imagePath, options = {}) {
        const path = normalizeText(imagePath);

        if (!path) {
            throw new Error("مسار الصورة غير صالح.");
        }

        const cached = getCachedSignedUrl(path);

        if (cached && options.refresh !== true) {
            return cached;
        }

        const client = getClient();

        const { data, error } = await client.storage
            .from(CONFIG.storageBucket)
            .createSignedUrl(
                path,
                CONFIG.signedUrlExpiry
            );

        if (error) {
            handleError(
                error,
                "تعذر إنشاء رابط عرض صورة التقييم."
            );
        }

        if (!data?.signedUrl) {
            throw new Error("لم يتم إنشاء رابط الصورة.");
        }

        saveSignedUrl(path, data.signedUrl);

        return data.signedUrl;
    }

    async function createSignedUrls(images, options = {}) {
        const list = Array.isArray(images) ? images : [];

        const results = await Promise.all(
            list.map(async image => {
                const normalized = normalizeImage(image);

                if (!normalized) return null;

                try {
                    normalized.signedUrl = await createSignedUrl(
                        normalized.imagePath,
                        options
                    );

                    return normalized;
                } catch (error) {
                    console.warn(
                        "[IBRReviewsService] تعذر تحميل صورة تقييم:",
                        error
                    );

                    normalized.signedUrl = null;

                    return normalized;
                }
            })
        );

        return results.filter(Boolean);
    }

    function clearSignedUrlCache() {
        signedUrlCache.clear();
        return true;
    }

    /* =====================================================
       5. جلب صور التقييمات
    ===================================================== */

    async function fetchReviewImages(reviewIds, options = {}) {
        const ids = [
            ...new Set(
                (Array.isArray(reviewIds) ? reviewIds : [])
                    .filter(isValidUuid)
                    .map(id => id.trim())
            )
        ];

        if (!ids.length) return [];

        const client = getClient();

        let query = client
            .from(CONFIG.imagesView)
            .select(
                "id,review_id,image_path,sort_order,created_at"
            )
            .in("review_id", ids)
            .order("sort_order", { ascending: true });

        const { data, error } = await query;

        if (error) {
            handleError(
                error,
                "تعذر تحميل صور التقييمات."
            );
        }

        const images = Array.isArray(data)
            ? data.map(normalizeImage).filter(Boolean)
            : [];

        if (options.includeSignedUrls === false) {
            return images;
        }

        return createSignedUrls(images, options);
    }

    function attachImagesToReviews(reviews, images) {
        const imageMap = new Map();

        (Array.isArray(images) ? images : []).forEach(image => {
            if (!image?.reviewId) return;

            if (!imageMap.has(image.reviewId)) {
                imageMap.set(image.reviewId, []);
            }

            imageMap.get(image.reviewId).push(image);
        });

        return (Array.isArray(reviews) ? reviews : []).map(review => {
            const reviewImages = imageMap.get(review.id) || [];

            return {
                ...review,
                images: reviewImages,
                imagesCount: reviewImages.length
            };
        });
    }

    /* =====================================================
       6. جلب تقييمات منتج
    ===================================================== */

    async function fetchProductReviews(productId, options = {}) {
        const id = validateUuid(productId, "معرف المنتج");

        const limit = getLimit(options.limit);

        const client = getClient();

        let query = client
            .from(CONFIG.reviewsView)
            .select(
                "id,product_id,customer_name,rating,review_text,created_at",
                { count: "exact" }
            )
            .eq("product_id", id);

        if (options.rating !== undefined && options.rating !== null) {
            query = query.eq(
                "rating",
                validateRating(options.rating)
            );
        }

        if (options.withText === true) {
            query = query
                .not("review_text", "is", null)
                .neq("review_text", "");
        }

        if (options.withImages === true) {
            const imageRows = await fetchReviewImages(
                await getReviewIdsWithImages(id),
                { includeSignedUrls: false }
            );

            const ids = [...new Set(
                imageRows.map(image => image.reviewId)
            )];

            if (!ids.length) {
                return {
                    data: [],
                    total: 0,
                    limit
                };
            }

            query = query.in("id", ids);
        }

        const sort = CONFIG.sortOptions.includes(options.sort)
            ? options.sort
            : "newest";

        const sortConfig = {
            newest: {
                column: "created_at",
                ascending: false
            },
            oldest: {
                column: "created_at",
                ascending: true
            },
            highest: {
                column: "rating",
                ascending: false
            },
            lowest: {
                column: "rating",
                ascending: true
            }
        }[sort];

        query = query
            .order(sortConfig.column, {
                ascending: sortConfig.ascending
            })
            .order("id", { ascending: false })
            .limit(limit);

        if (options.fromDate) {
            query = query.gte("created_at", options.fromDate);
        }

        if (options.toDate) {
            query = query.lte("created_at", options.toDate);
        }

        const { data, error, count } = await query;

        if (error) {
            handleError(
                error,
                "تعذر تحميل تقييمات هذا المنتج."
            );
        }

        let reviews = Array.isArray(data)
            ? data.map(normalizeReview).filter(Boolean)
            : [];

        if (options.includeImages !== false && reviews.length) {
            const images = await fetchReviewImages(
                reviews.map(review => review.id),
                {
                    includeSignedUrls: options.includeSignedUrls !== false
                }
            );

            reviews = attachImagesToReviews(reviews, images);
        }

        return {
            data: reviews,
            total: Number.isFinite(count) ? count : reviews.length,
            limit,
            sort
        };
    }

    /* =====================================================
       7. جلب معرفات التقييمات التي تحتوي على صور
    ===================================================== */

    async function getReviewIdsWithImages(productId) {
        const id = validateUuid(productId, "معرف المنتج");

        const client = getClient();

        const { data: reviews, error: reviewsError } = await client
            .from(CONFIG.reviewsView)
            .select("id")
            .eq("product_id", id);

        if (reviewsError) {
            handleError(
                reviewsError,
                "تعذر التحقق من صور التقييمات."
            );
        }

        const ids = (Array.isArray(reviews) ? reviews : [])
            .map(review => review.id)
            .filter(isValidUuid);

        if (!ids.length) return [];

        const { data, error } = await client
            .from(CONFIG.imagesView)
            .select("review_id")
            .in("review_id", ids);

        if (error) {
            handleError(
                error,
                "تعذر تحميل قائمة صور التقييمات."
            );
        }

        return [
            ...new Set(
                (Array.isArray(data) ? data : [])
                    .map(row => row.review_id)
                    .filter(isValidUuid)
            )
        ];
    }

    /* =====================================================
       8. التقييمات مع الصفحات
    ===================================================== */

    async function fetchProductReviewsPage(productId, options = {}) {
        const id = validateUuid(productId, "معرف المنتج");

        const page = Math.max(
            1,
            Math.floor(Number(options.page) || 1)
        );

        const pageSize = getPageSize(options.pageSize);

        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        const client = getClient();

        let query = client
            .from(CONFIG.reviewsView)
            .select(
                "id,product_id,customer_name,rating,review_text,created_at",
                { count: "exact" }
            )
            .eq("product_id", id);

        if (options.rating !== undefined && options.rating !== null) {
            query = query.eq(
                "rating",
                validateRating(options.rating)
            );
        }

        const sort = CONFIG.sortOptions.includes(options.sort)
            ? options.sort
            : "newest";

        const sortConfig = {
            newest: ["created_at", false],
            oldest: ["created_at", true],
            highest: ["rating", false],
            lowest: ["rating", true]
        }[sort];

        query = query
            .order(sortConfig[0], {
                ascending: sortConfig[1]
            })
            .order("id", { ascending: false })
            .range(from, to);

        const { data, error, count } = await query;

        if (error) {
            handleError(
                error,
                "تعذر تحميل صفحة التقييمات."
            );
        }

        let reviews = Array.isArray(data)
            ? data.map(normalizeReview).filter(Boolean)
            : [];

        if (options.includeImages !== false && reviews.length) {
            const images = await fetchReviewImages(
                reviews.map(review => review.id),
                {
                    includeSignedUrls: options.includeSignedUrls !== false
                }
            );

            reviews = attachImagesToReviews(reviews, images);
        }

        const total = Number.isFinite(count) ? count : reviews.length;

        return {
            data: reviews,
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
            hasMore: from + reviews.length < total
        };
    }

    /* =====================================================
       9. إحصائيات تقييمات المنتج
    ===================================================== */

    async function getProductReviewStats(productId) {
        const id = validateUuid(productId, "معرف المنتج");

        const client = getClient();

        const { data, error } = await client
            .from(CONFIG.reviewsView)
            .select("rating")
            .eq("product_id", id);

        if (error) {
            handleError(
                error,
                "تعذر حساب إحصائيات تقييمات المنتج."
            );
        }

        const rows = Array.isArray(data) ? data : [];

        const distribution = {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0
        };

        let totalRating = 0;

        rows.forEach(row => {
            const rating = Number(row.rating);

            if (
                Number.isInteger(rating) &&
                rating >= 1 &&
                rating <= 5
            ) {
                distribution[rating]++;
                totalRating += rating;
            }
        });

        const total = rows.length;

        const average = total
            ? Number((totalRating / total).toFixed(2))
            : 0;

        const percentages = {};

        CONFIG.ratings.forEach(rating => {
            percentages[rating] = total
                ? Number(
                    (
                        distribution[rating] /
                        total *
                        100
                    ).toFixed(1)
                )
                : 0;
        });

        return {
            productId: id,
            total,
            average,
            distribution,
            percentages,
            hasReviews: total > 0,
            roundedAverage: Math.round(average)
        };
    }

    /* =====================================================
       10. إحصائيات مجموعة تقييمات محملة
    ===================================================== */

    function calculateStats(reviews) {
        const list = Array.isArray(reviews) ? reviews : [];

        const distribution = {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0
        };

        let sum = 0;

        list.forEach(review => {
            const rating = Number(review.rating);

            if (
                Number.isInteger(rating) &&
                rating >= 1 &&
                rating <= 5
            ) {
                distribution[rating]++;
                sum += rating;
            }
        });

        return {
            total: list.length,
            average: list.length
                ? Number((sum / list.length).toFixed(2))
                : 0,
            distribution
        };
    }

    /* =====================================================
       11. البحث والتصفية محليًا
    ===================================================== */

    function searchReviews(reviews, searchTerm) {
        const list = Array.isArray(reviews) ? reviews : [];

        const term = normalizeSearchText(searchTerm);

        if (!term) return list;

        return list.filter(review => {
            const values = [
                review.customerName,
                review.reviewText,
                review.rating,
                review.createdAt
            ];

            return values.some(value =>
                normalizeSearchText(value).includes(term)
            );
        });
    }

    function filterReviews(reviews, filters = {}) {
        let result = Array.isArray(reviews) ? [...reviews] : [];

        if (filters.rating !== undefined && filters.rating !== null && filters.rating !== "") {
            const rating = validateRating(filters.rating);

            result = result.filter(review =>
                Number(review.rating) === rating
            );
        }

        if (filters.withText === true) {
            result = result.filter(review =>
                Boolean(normalizeText(review.reviewText))
            );
        }

        if (filters.withImages === true) {
            result = result.filter(review =>
                Array.isArray(review.images) &&
                review.images.length > 0
            );
        }

        if (filters.search) {
            result = searchReviews(result, filters.search);
        }

        return result;
    }

    /* =====================================================
       12. أدوات تنسيق
    ===================================================== */

    function formatDate(dateValue, options = {}) {
        if (!dateValue) return "—";

        const date = new Date(dateValue);

        if (Number.isNaN(date.getTime())) return "—";

        return new Intl.DateTimeFormat("ar-SA", {
            timeZone: "Asia/Riyadh",
            year: "numeric",
            month: options.month || "long",
            day: "numeric",
            ...(options.withTime
                ? {
                    hour: "2-digit",
                    minute: "2-digit"
                }
                : {})
        }).format(date);
    }

    function formatRating(rating) {
        const value = Number(rating);

        if (!Number.isFinite(value)) return "0.0";

        return value.toFixed(1);
    }

    function getRatingLabel(rating) {
        const labels = {
            1: "سيئ جدًا",
            2: "سيئ",
            3: "متوسط",
            4: "جيد جدًا",
            5: "ممتاز"
        };

        return labels[Number(rating)] || "غير محدد";
    }

    /* =====================================================
       13. عمليات الإدارة عبر Edge Function
       
       هذه الدوال تعتمد على إنشاء ونشر:
       ibr-admin-product-reviews

       لا تنفذ تعديلات مباشرة على الجداول من المتصفح.
    ===================================================== */

    async function invokeAdminAction(action, payload = {}) {
        if (!normalizeText(action)) {
            throw new Error("نوع العملية الإدارية غير محدد.");
        }

        const client = getClient();

        const { data, error } = await client.functions.invoke(
            CONFIG.adminFunction,
            {
                body: {
                    action,
                    ...payload
                }
            }
        );

        if (error) {
            handleError(
                error,
                "تعذر تنفيذ العملية الإدارية للتقييمات."
            );
        }

        if (data?.error) {
            throw new Error(data.error);
        }

        return data;
    }


    async function fetchAdminReviews(options = {}) {
        const sortMap = {
            newest: "newest",
            oldest: "oldest",
            rating: "rating",
            rating_ascending: "rating_ascending",
            highest: "rating",
            lowest: "rating_ascending"
        };

        const requestedSort = options.sort || "newest";

        return invokeAdminAction("list", {
            page: Math.max(1, Number(options.page) || 1),
            pageSize: getPageSize(options.pageSize),
            status: options.status || "all",
            rating: options.rating || null,
            search: normalizeText(options.search),
            productId: options.productId || null,
            sort: sortMap[requestedSort] || "newest"
        });
    }


    async function getAdminReview(reviewId) {
        const id = validateUuid(reviewId, "معرف التقييم");

        return invokeAdminAction("details", {
            reviewId: id
        });
    }

    async function updateReviewStatus(reviewId, status, options = {}) {
        const id = validateUuid(reviewId, "معرف التقييم");

        const allowedStatuses = [
            "pending",
            "approved",
            "rejected"
        ];

        if (!allowedStatuses.includes(status)) {
            throw new Error("حالة التقييم غير معتمدة.");
        }

        return invokeAdminAction("update_status", {
            reviewId: id,
            status,
            reason: normalizeText(options.reason)
        });
    }

    async function updateAdminNote(reviewId, note) {
        const id = validateUuid(reviewId, "معرف التقييم");

        if (
            note !== null &&
            note !== undefined &&
            typeof note !== "string"
        ) {
            throw new Error("الملاحظة الإدارية يجب أن تكون نصًا.");
        }

        const value = String(note ?? "").trim();

        if (value.length > 4000) {
            throw new Error("الملاحظة الإدارية طويلة جدًا.");
        }

        return invokeAdminAction("update_note", {
            reviewId: id,
            note: value || null
        });
    }

    async function deleteReview(reviewId, options = {}) {
        const id = validateUuid(reviewId, "معرف التقييم");

        if (options.confirmed !== true) {
            throw new Error(
                "يجب تأكيد حذف التقييم قبل تنفيذ العملية."
            );
        }

        return invokeAdminAction("delete", {
            reviewId: id
        });
    }

    /* =====================================================
       14. تنظيف البيانات المؤقتة
    ===================================================== */

    function destroy() {
        clearSignedUrlCache();
        return true;
    }

    /* =====================================================
       15. الواجهة العامة للخدمة
    ===================================================== */

    window.IBRReviewsService = Object.freeze({
        version: "1.0.0",

        configure,
        getClient,

        fetchProductReviews,
        fetchProductReviewsPage,
        fetchReviewImages,
        getReviewIdsWithImages,

        getProductReviewStats,
        calculateStats,

        searchReviews,
        filterReviews,

        createSignedUrl,
        createSignedUrls,
        clearSignedUrlCache,

        normalizeReview,
        normalizeImage,
        normalizeSearchText,

        formatDate,
        formatRating,
        getRatingLabel,

        fetchAdminReviews,
        getAdminReview,
        updateReviewStatus,
        updateAdminNote,
        deleteReview,

        destroy,

        config: CONFIG
    });

    console.info(
        "IBRReviewsService v1.0.0 initialized successfully."
    );

})();
