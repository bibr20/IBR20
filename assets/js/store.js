/* =========================================================
   IBR20 — STORE ENGINE
   Supabase + Products + Cart + Orders
   Views + Interests + Recommendations
   Arabic RTL | Responsive Store
========================================================= */


/* =========================================================
   1. SUPABASE
========================================================= */

const SUPABASE_URL =
    "https://edttlagqjrcqccxnbcej.supabase.co";

const SUPABASE_KEY =
    "sb_publishable_ZFylCAWI8yKbPG-sbOJg8g_Sviml6bh";

if (!window.supabase) {
    console.error("لم يتم تحميل مكتبة Supabase قبل store.js");
}

const supabaseClient = window.supabase
    ? window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    )
    : null;

window.supabaseClient = supabaseClient;


/* =========================================================
   2. STORE
========================================================= */

const IBR = (() => {

    let currentProducts = [];

    let interactionSettingsReady = Promise.resolve();

    let productsLoadPromise = null;

    let productsLoaded = false;

    const recordedPageViews = new Set();

    let lastRemovedCartItem = null;

    let feedbackTimer = null;


    const sample = [
        {
            id: "kids-chair",
            name: "كرسي أطفال خشبي",
            category: "كراسي الأطفال",
            categorySlug: "kids-chairs",
            price: 180,
            desc: "كرسي خشبي عملي بتصميم بسيط يناسب الاستخدام اليومي."
        },
        {
            id: "kids-table",
            name: "طاولة أطفال",
            category: "طاولات",
            categorySlug: "tables",
            price: 260,
            desc: "طاولة أطفال للمذاكرة والرسم والأنشطة."
        },
        {
            id: "chair-set",
            name: "طاولة مع كرسيين",
            category: "جلسات",
            categorySlug: "sessions",
            price: 420,
            desc: "مجموعة خشبية للاستخدام المنزلي."
        }
    ];


    /* =====================================================
       3. GENERAL HELPERS
    ===================================================== */

    function escapeHTML(value) {

        return String(value ?? "").replace(
            /[&<>"']/g,
            char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[char]
        );
    }


    function safeImage(url) {

        if (typeof url !== "string") return "";

        const value = url.trim();

        if (
            value.startsWith("https://") ||
            value.startsWith("http://")
        ) {
            return value;
        }

        return "";
    }


    function money(price) {

        const number = Number(price);

        if (!Number.isFinite(number)) {
            return "—";
        }

        return number.toLocaleString("ar-SA", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }) + " ر.س";
    }


    function getCategoryData(product) {

        if (!product) return {};

        let category = product.category || "";

        let categorySlug = product.categorySlug || "";

        const categories = product.categories;

        const categoryData = Array.isArray(categories)
            ? categories[0]
            : categories;

        if (categoryData) {

            category = category ||
                categoryData.name ||
                "";

            categorySlug = categorySlug ||
                categoryData.slug ||
                "";
        }

        return {
            category,
            categorySlug
        };
    }


    function getProductUrl(product) {

        return "product.html?id=" +
            encodeURIComponent(product.id);
    }


    function getProductStock(product) {

        if (
            product.inventory_quantity === null ||
            product.inventory_quantity === undefined ||
            product.inventory_quantity === ""
        ) {
            return null;
        }

        const stock = Number(product.inventory_quantity);

        return Number.isFinite(stock)
            ? Math.max(0, Math.floor(stock))
            : null;
    }


    function isProductAvailable(product) {

        if (!product) return false;

        if (product.is_available === false) return false;

        const stock = getProductStock(product);

        if (stock !== null && stock <= 0) {
            return false;
        }

        return true;
    }


    function showCartFeedback(message, undo = false) {

        const element = document.getElementById(
            "cart-feedback"
        );

        if (!element) return;

        clearTimeout(feedbackTimer);

        element.innerHTML = `
            <div class="cart-feedback-message">
                ${escapeHTML(message)}

                ${undo
                ? `
                            <button
                                type="button"
                                class="cart-undo-button"
                                id="cart-undo-remove"
                            >
                                تراجع
                            </button>
                        `
                : ""
            }
            </div>
        `;

        if (undo) {

            document.getElementById(
                "cart-undo-remove"
            )?.addEventListener("click", undoRemoveCartItem);
        }

        feedbackTimer = setTimeout(() => {

            if (element) {
                element.innerHTML = "";
            }

        }, 7000);
    }


    function clearCartFeedback() {

        const element = document.getElementById(
            "cart-feedback"
        );

        if (element) {
            element.innerHTML = "";
        }

        clearTimeout(feedbackTimer);
    }


    /* =====================================================
       4. INTERACTION STORAGE
    ===================================================== */

    const INTERACTION_KEYS = {

        views: "ibr-product-views-v1",

        interests: "ibr-product-interests-v1",

        recommendationHistory:
            "ibr-recommendation-history-v1",

        preferences:
            "ibr-category-preferences-v1",

        viewsVersion:
            "ibr-views-reset-version",

        recommendationsVersion:
            "ibr-recommendations-reset-version"
    };


    const MAX_RECENT_VIEWS = 8;

    const MAX_INTERESTS = 100;

    const MAX_RECOMMENDATION_HISTORY = 40;


    function readInteractionData(key) {

        try {

            const value = JSON.parse(
                localStorage.getItem(key) || "[]"
            );

            return Array.isArray(value)
                ? value
                : [];

        } catch (error) {

            console.warn(
                "تعذرت قراءة بيانات التفاعل:",
                error
            );

            return [];
        }
    }


    function saveInteractionData(key, data) {

        try {

            localStorage.setItem(
                key,
                JSON.stringify(data)
            );

        } catch (error) {

            console.warn(
                "تعذر حفظ بيانات التفاعل:",
                error
            );
        }
    }


    function findInteractionProduct(id) {

        const activeProduct = currentProducts.find(
            product =>
                String(product.id) === String(id)
        );

        if (activeProduct) {
            return activeProduct;
        }

        return loadCachedProducts().find(
            product =>
                String(product.id) === String(id)
        ) || null;
    }


    function normalizeInteractionProduct(source) {

        if (!source || !source.id) {
            return null;
        }

        const categoryData = getCategoryData(source);

        let image = safeImage(source.image);

        if (
            !image &&
            Array.isArray(source.product_images)
        ) {

            const images = source.product_images
                .slice()
                .sort((a, b) => {

                    if (a.is_primary !== b.is_primary) {
                        return a.is_primary ? -1 : 1;
                    }

                    return Number(a.sort_order || 0) -
                        Number(b.sort_order || 0);
                });

            const primary = images.find(item =>
                item.is_primary &&
                safeImage(item.image_url)
            );

            const first = images.find(item =>
                safeImage(item.image_url)
            );

            image = safeImage(
                primary?.image_url ||
                first?.image_url
            );
        }

        if (!image && Array.isArray(source.images)) {

            image = safeImage(
                source.images.find(Boolean)
            );
        }

        return {

            id: source.id,

            name: source.name || "",

            category:
                categoryData.category || "منتجات أخرى",

            categorySlug:
                categoryData.categorySlug || "",

            image,

            slug: source.slug || ""
        };
    }


    /* =====================================================
       5. SYNC INTERACTION SETTINGS
    ===================================================== */

    async function syncInteractionSettings() {

        if (!supabaseClient) return;

        try {

            const { data, error } = await supabaseClient
                .from("store_recommendation_settings")
                .select(
                    "views_reset_version,recommendations_reset_version"
                )
                .eq("id", 1)
                .maybeSingle();

            if (error) throw error;

            if (!data) return;

            const savedViewsVersion =
                localStorage.getItem(
                    INTERACTION_KEYS.viewsVersion
                );

            const savedRecommendationsVersion =
                localStorage.getItem(
                    INTERACTION_KEYS.recommendationsVersion
                );


            if (
                savedViewsVersion !== null &&
                savedViewsVersion !==
                String(data.views_reset_version)
            ) {

                localStorage.removeItem(
                    INTERACTION_KEYS.views
                );
            }


            if (
                savedRecommendationsVersion !== null &&
                savedRecommendationsVersion !==
                String(data.recommendations_reset_version)
            ) {

                localStorage.removeItem(
                    INTERACTION_KEYS.interests
                );

                localStorage.removeItem(
                    INTERACTION_KEYS.recommendationHistory
                );

                localStorage.removeItem(
                    INTERACTION_KEYS.preferences
                );
            }


            localStorage.setItem(
                INTERACTION_KEYS.viewsVersion,
                String(data.views_reset_version)
            );

            localStorage.setItem(
                INTERACTION_KEYS.recommendationsVersion,
                String(data.recommendations_reset_version)
            );

        } catch (error) {

            console.warn(
                "تعذرت مزامنة إعدادات التوصيات:",
                error
            );
        }
    }


    /* =====================================================
       6. RECORD PRODUCT VIEWS
    ===================================================== */

    function recordView(id, productData = null) {

        let product = productData
            ? normalizeInteractionProduct(productData)
            : findInteractionProduct(id);

        if (!product && id && typeof id === "object") {

            product = normalizeInteractionProduct(id);
        }

        if (!product) return false;

        const pageViewKey = String(product.id);

        if (recordedPageViews.has(pageViewKey)) {
            return false;
        }

        recordedPageViews.add(pageViewKey);

        const views = readInteractionData(
            INTERACTION_KEYS.views
        );

        const updated = views.filter(
            item =>
                String(item.id) !== String(product.id)
        );

        updated.unshift({

            id: product.id,

            categorySlug:
                product.categorySlug || "",

            name: product.name || "",

            image: product.image || "",

            viewedAt: new Date().toISOString()
        });

        saveInteractionData(
            INTERACTION_KEYS.views,
            updated.slice(0, MAX_RECENT_VIEWS)
        );

        return true;
    }


    function recordViewProduct(productData) {

        if (!productData) return false;

        return recordView(
            productData.id,
            productData
        );
    }


    /* =====================================================
       7. RECORD CUSTOMER INTEREST
    ===================================================== */

    function recordInterest(
        id,
        type,
        productData = null
    ) {

        const product = productData
            ? normalizeInteractionProduct(productData)
            : findInteractionProduct(id);

        if (!product) return false;

        const interests = readInteractionData(
            INTERACTION_KEYS.interests
        );

        interests.unshift({

            id: product.id,

            categorySlug:
                product.categorySlug || "",

            type: type || "interest",

            createdAt: new Date().toISOString()
        });

        saveInteractionData(
            INTERACTION_KEYS.interests,
            interests.slice(0, MAX_INTERESTS)
        );

        return true;
    }


    function recordSaved(id, productData = null) {

        return recordInterest(
            id,
            "saved",
            productData
        );
    }


    function getRecentViews(
        limit = MAX_RECENT_VIEWS
    ) {

        const safeLimit = Math.max(
            0,
            Math.min(
                MAX_RECENT_VIEWS,
                Number(limit) || MAX_RECENT_VIEWS
            )
        );

        return readInteractionData(
            INTERACTION_KEYS.views
        ).slice(0, safeLimit);
    }


    /* =====================================================
       8. CATEGORY PREFERENCES
    ===================================================== */

    function getCategoryPreferences() {

        try {

            const saved = JSON.parse(
                localStorage.getItem(
                    INTERACTION_KEYS.preferences
                ) || "{}"
            );

            return saved &&
                typeof saved === "object" &&
                !Array.isArray(saved)
                ? saved
                : {};

        } catch (error) {

            console.warn(
                "تعذرت قراءة تفضيلات التصنيفات:",
                error
            );

            return {};
        }
    }


    function setCategoryPreference(
        categorySlug,
        preference
    ) {

        const slug = String(
            categorySlug || ""
        ).trim();

        if (!slug) return false;

        if (
            !["more", "less", "normal"].includes(preference)
        ) {
            return false;
        }

        const preferences = getCategoryPreferences();

        if (preference === "normal") {

            delete preferences[slug];

        } else {

            preferences[slug] = preference;
        }

        try {

            localStorage.setItem(
                INTERACTION_KEYS.preferences,
                JSON.stringify(preferences)
            );

        } catch (error) {

            console.warn(
                "تعذر حفظ تفضيلات التصنيفات:",
                error
            );

            return false;
        }

        refreshRecommendations();

        return true;
    }


    /* =====================================================
       9. RECOMMENDATION ENGINE
    ===================================================== */

    function dailyProductScore(product, day) {

        const value =
            String(product.id) + "-" + day;

        let hash = 0;

        for (
            let index = 0;
            index < value.length;
            index++
        ) {

            hash =
                ((hash << 5) - hash) +
                value.charCodeAt(index);

            hash |= 0;
        }

        return Math.abs(hash);
    }


    function getRecommendationHistory() {

        return readInteractionData(
            INTERACTION_KEYS.recommendationHistory
        );
    }


    function saveRecommendationHistory(productsList) {

        const history = getRecommendationHistory();

        const now = new Date().toISOString();

        const updated = productsList
            .map(product => ({

                id: product.id,

                categorySlug:
                    product.categorySlug || "",

                recommendedAt: now

            }))
            .concat(history);

        const unique = [];

        const seen = new Set();

        updated.forEach(item => {

            const id = String(item.id || "");

            if (!id || seen.has(id)) return;

            seen.add(id);

            unique.push(item);
        });

        saveInteractionData(
            INTERACTION_KEYS.recommendationHistory,
            unique.slice(0, MAX_RECOMMENDATION_HISTORY)
        );
    }


    function getCategoryScores() {

        const interests = readInteractionData(
            INTERACTION_KEYS.interests
        );

        const views = readInteractionData(
            INTERACTION_KEYS.views
        );

        const preferences = getCategoryPreferences();

        const scores = {};


        interests.forEach(item => {

            const slug = item.categorySlug;

            if (!slug) return;

            const weight =
                item.type === "cart" ? 6 :
                    item.type === "saved" ? 5 :
                        item.type === "purchase" ? 8 :
                            1;

            scores[slug] =
                (scores[slug] || 0) + weight;
        });


        views.forEach(item => {

            const slug = item.categorySlug;

            if (!slug) return;

            scores[slug] =
                (scores[slug] || 0) + 1;
        });


        Object.entries(preferences).forEach(
            ([slug, preference]) => {

                if (preference === "more") {

                    scores[slug] =
                        (scores[slug] || 0) + 8;
                }

                if (preference === "less") {

                    scores[slug] =
                        (scores[slug] || 0) - 12;
                }
            }
        );

        return scores;
    }


    function getRecommendations(limit = 8) {

        const safeLimit = Math.max(
            1,
            Math.min(30, Number(limit) || 8)
        );

        const all = currentProducts.filter(
            product =>
                product.id &&
                product.categorySlug &&
                isProductAvailable(product)
        );

        if (!all.length) return [];

        const views = getRecentViews(
            MAX_RECENT_VIEWS
        );

        const viewedIds = new Set(
            views.map(item => String(item.id))
        );

        const categoryScores = getCategoryScores();

        const preferences = getCategoryPreferences();

        const history = getRecommendationHistory();

        const historyMap = new Map(
            history.map(item => [
                String(item.id),
                item
            ])
        );

        const day = new Date()
            .toISOString()
            .slice(0, 10);


        let candidates = all.filter(
            product =>
                !viewedIds.has(String(product.id))
        );

        if (!candidates.length) {
            candidates = all.slice();
        }


        const ranked = candidates.map(product => {

            const categorySlug =
                product.categorySlug;

            const categoryScore =
                categoryScores[categorySlug] || 0;

            const preference =
                preferences[categorySlug];

            const previousRecommendation =
                historyMap.get(String(product.id));

            let historyPenalty = 0;

            if (previousRecommendation) {

                const recommendedAt = new Date(
                    previousRecommendation.recommendedAt
                ).getTime();

                const daysSince =
                    (Date.now() - recommendedAt) /
                    (1000 * 60 * 60 * 24);

                if (daysSince < 1) {

                    historyPenalty = 1000;

                } else if (daysSince < 3) {

                    historyPenalty = 500;

                } else if (daysSince < 7) {

                    historyPenalty = 200;

                } else if (daysSince < 14) {

                    historyPenalty = 50;
                }
            }

            const featuredBonus =
                product.is_featured ? 2 : 0;

            const diversityScore =
                dailyProductScore(product, day) % 1000;

            return {

                product,

                categorySlug,

                score:
                    categoryScore +
                    featuredBonus -
                    historyPenalty,

                diversityScore,

                preference
            };
        });


        ranked.sort((a, b) => {

            if (
                a.preference === "less" &&
                b.preference !== "less"
            ) {
                return 1;
            }

            if (
                b.preference === "less" &&
                a.preference !== "less"
            ) {
                return -1;
            }

            if (a.score !== b.score) {
                return b.score - a.score;
            }

            return a.diversityScore -
                b.diversityScore;
        });


        const selected = [];

        const categoryCounts = {};

        const maxPerCategory = Math.max(
            2,
            Math.ceil(safeLimit / 2)
        );


        ranked.forEach(item => {

            if (selected.length >= safeLimit) {
                return;
            }

            const count =
                categoryCounts[item.categorySlug] || 0;

            if (count >= maxPerCategory) {
                return;
            }

            selected.push(item.product);

            categoryCounts[item.categorySlug] =
                count + 1;
        });


        if (selected.length < safeLimit) {

            const selectedIds = new Set(
                selected.map(item => String(item.id))
            );

            ranked.forEach(item => {

                if (selected.length >= safeLimit) {
                    return;
                }

                if (
                    selectedIds.has(
                        String(item.product.id)
                    )
                ) {
                    return;
                }

                selected.push(item.product);

                selectedIds.add(
                    String(item.product.id)
                );
            });
        }

        return selected;
    }


    /* =====================================================
       10. PRODUCT RECOMMENDATION CARD
    ===================================================== */

    function recommendationCard(product) {

        const id = encodeURIComponent(product.id);

        const name = escapeHTML(product.name);

        const image = safeImage(product.image);

        const description = escapeHTML(
            product.desc || product.description || ""
        );

        const categorySlug = escapeHTML(
            product.categorySlug || ""
        );

        const pricing = getProductPricing(product);

        return `
            <article class="product-card recommendation-card">

                <a href="${getProductUrl(product)}">

                    <div class="product-photo">

                        ${image
                ? `
                                    <img
                                        src="${escapeHTML(image)}"
                                        alt="${name}"
                                        loading="lazy"
                                        onerror="this.style.display='none'"
                                    >
                                `
                : `
                                    <div class="empty">
                                        الصورة غير متاحة
                                    </div>
                                `
            }

                    </div>

                </a>

                <div class="product-info">

                    <h3>
                        <a href="product.html?id=${id}">
                            ${name}
                        </a>
                    </h3>

                    ${description
                ? `<p>${description}</p>`
                : ""
            }

                    <span class="price">
                        ${pricing.mode === "quote"
                ? "حسب الاتفاق"
                : pricing.mode === "from"
                    ? "يبدأ من " + money(pricing.finalPrice)
                    : money(pricing.finalPrice)
            }
                    </span>

                    <div class="home-product-preferences">

                        <button
                            type="button"
                            class="home-preference-button"
                            data-category-preference="more"
                            data-category="${categorySlug}"
                        >
                            أرني المزيد من هذا النوع
                        </button>

                        <button
                            type="button"
                            class="home-preference-button home-preference-less"
                            data-category-preference="less"
                            data-category="${categorySlug}"
                        >
                            قلّل هذا النوع
                        </button>

                    </div>

                </div>

            </article>
        `;
    }


    /* =====================================================
       11. RECENT VIEWS
    ===================================================== */

    function renderRecentViews() {

        const section = document.getElementById(
            "home-recent-views"
        );

        const list = document.getElementById(
            "home-recent-views-list"
        );

        if (!section || !list) return;

        const views = getRecentViews(
            MAX_RECENT_VIEWS
        );

        if (!views.length) {

            section.hidden = true;

            return;
        }

        list.innerHTML = views.map(view => {

            const product =
                findInteractionProduct(view.id);

            const name = escapeHTML(
                product?.name ||
                view.name ||
                "منتج خشبي"
            );

            const image = safeImage(
                product?.image || view.image
            );

            const href = product
                ? getProductUrl(product)
                : "product.html?id=" +
                encodeURIComponent(view.id);

            return `
               <article class="product-card recent-view-card">

                    <a href="${href}">

                        <div class="product-photo">

                            ${image
                    ? `
                                        <img
                                            src="${escapeHTML(image)}"
                                            alt="${name}"
                                            loading="lazy"
                                            onerror="this.style.display='none'"
                                        >
                                    `
                    : `
                                        <div class="empty">
                                            الصورة غير متاحة
                                        </div>
                                    `
                }

                        </div>

                        <div class="product-info">
                            <h3>${name}</h3>
                        </div>

                    </a>

                </article> 
            `;

        }).join("");

        section.hidden = false;
    }


    /* =====================================================
       12. REFRESH RECOMMENDATIONS
    ===================================================== */

    function refreshRecommendations(limit = 8) {

        renderRecentViews();

        const section = document.getElementById(
            "home-recommendations"
        );

        const list = document.getElementById(
            "home-recommendations-list"
        );

        if (!section || !list) {

            document.dispatchEvent(
                new CustomEvent(
                    "ibr:recommendations-updated"
                )
            );

            return [];
        }

        const recommendations =
            getRecommendations(limit);

        if (!recommendations.length) {

            list.innerHTML = `
                <div class="home-recommendations-empty">
                    ستظهر اقتراحات المنتجات هنا بعد تصفح المتجر.
                </div>
            `;

            section.hidden = false;

            return [];
        }

        list.innerHTML = recommendations
            .map(recommendationCard)
            .join("");

        section.hidden = false;

        saveRecommendationHistory(
            recommendations
        );

        document.dispatchEvent(
            new CustomEvent(
                "ibr:recommendations-updated",
                {
                    detail: {
                        recommendations
                    }
                }
            )
        );

        return recommendations;
    }


    /* =====================================================
       13. RECOMMENDATION PREFERENCES
    ===================================================== */

    function setupRecommendationPreferences() {

        document.addEventListener("click", event => {

            const button = event.target.closest(
                "[data-category-preference]"
            );

            if (!button) return;

            const preference =
                button.dataset.categoryPreference;

            const category =
                button.dataset.category;

            if (
                !category ||
                !["more", "less"].includes(preference)
            ) {
                return;
            }

            const saved = setCategoryPreference(
                category,
                preference
            );

            if (!saved) return;

            const originalText =
                button.textContent;

            button.textContent =
                preference === "more"
                    ? "سيظهر لك المزيد من هذا النوع"
                    : "سنقلّل ظهور هذا النوع";

            button.disabled = true;

            setTimeout(() => {

                button.textContent = originalText;

                button.disabled = false;

            }, 2200);
        });


        document.getElementById(
            "home-discover-more"
        )?.addEventListener("click", () => {

            const recommendations =
                refreshRecommendations(8);

            if (!recommendations.length) {
                return;
            }

            document.getElementById(
                "home-recommendations-list"
            )?.scrollIntoView({
                behavior: "smooth",
                block: "nearest"
            });
        });
    }


    /* =====================================================
       14. PRODUCTS
    ===================================================== */

    function products() {

        // إذا لم تكن المنتجات موجودة في الذاكرة،
        // نحاول استعادتها من النسخة المحفوظة محلياً.
        if (
            !Array.isArray(currentProducts) ||
            currentProducts.length === 0
        ) {

            const cachedProducts = loadCachedProducts();

            if (cachedProducts.length > 0) {
                currentProducts = cachedProducts;
            }
        }

        return currentProducts;
    }

    function loadCachedProducts() {

        try {

            const saved = JSON.parse(
                localStorage.getItem(
                    "ibr-products"
                ) || "[]"
            );

            return Array.isArray(saved)
                ? saved
                : [];

        } catch (error) {

            console.error(
                "خطأ في قراءة المنتجات المحفوظة:",
                error
            );

            return [];
        }
    }


    /* =====================================================
       15. PRICE AND DISCOUNT ENGINE
    ===================================================== */

    function getProductPricing(product) {

        const basePrice = Number(
            product?.price ?? 0
        );

        const mode =
            product?.price_mode || "fixed";

        const result = {

            mode,

            basePrice,

            finalPrice: basePrice,

            discountAmount: 0,

            discountPercent: 0,

            isDiscounted: false,

            badge: ""
        };

        if (
            mode === "quote" ||
            !Number.isFinite(basePrice) ||
            basePrice <= 0
        ) {
            return result;
        }

        // توحيد قيمة تفعيل الخصم
        const discountEnabled = [
            true,
            1,
            "1",
            "true",
            "yes"
        ].includes(
            typeof product.discount_enabled === "string"
                ? product.discount_enabled.toLowerCase().trim()
                : product.discount_enabled
        );

        if (
            !discountEnabled ||
            !["percentage", "fixed"].includes(
                product.discount_type
            )
        ) {
            return result;
        }

        const now = Date.now();

        const startsAt = product.discount_starts_at
            ? Date.parse(product.discount_starts_at)
            : null;

        const endsAt = product.discount_ends_at
            ? Date.parse(product.discount_ends_at)
            : null;

        if (
            startsAt !== null &&
            (
                !Number.isFinite(startsAt) ||
                now < startsAt
            )
        ) {
            return result;
        }

        if (
            endsAt !== null &&
            (
                !Number.isFinite(endsAt) ||
                now > endsAt
            )
        ) {
            return result;
        }

        const value = Number(
            product.discount_value ?? 0
        );

        if (
            !Number.isFinite(value) ||
            value <= 0
        ) {
            return result;
        }

        let discountAmount = 0;

        if (product.discount_type === "percentage") {

            const percentage = Math.min(100, value);

            discountAmount =
                basePrice * percentage / 100;

        } else {

            discountAmount = Math.min(
                basePrice,
                value
            );
        }

        discountAmount = Math.round(
            discountAmount * 100
        ) / 100;

        if (discountAmount <= 0) {
            return result;
        }

        const finalPrice = Math.round(
            (basePrice - discountAmount) * 100
        ) / 100;

        const discountPercent = Math.round(
            (discountAmount / basePrice) * 100
        );

        return {

            mode,

            basePrice,

            finalPrice,

            discountAmount,

            discountPercent,

            isDiscounted: true,

            badge:
                product.discount_badge ||
                (
                    product.discount_type === "percentage"
                        ? `خصم ${discountPercent}%`
                        : "عرض خاص"
                )
        };
    }


    /* =====================================================
       16. LOAD PRODUCTS FROM SUPABASE
    ===================================================== */

    async function loadProductsInternal() {

        await interactionSettingsReady;

        const grid = document.querySelector(
            "#products-grid"
        );

        if (grid) {

            grid.innerHTML =
                '<div class="empty">جارٍ تحميل المنتجات...</div>';
        }


        if (!supabaseClient) {

            console.error(
                "اتصال Supabase غير متوفر."
            );

            currentProducts =
                loadCachedProducts();

            if (!currentProducts.length) {
                currentProducts = sample;
            }

            productsLoaded = true;

            renderProducts();
            renderDetail();
            renderCart();
            updateCount();
            refreshRecommendations();

            return currentProducts;
        }


        try {

            const { data, error } =
                await supabaseClient
                    .from("products")
                    .select(`
                        id,
                        name,
                        slug,
                        description,
                        price,
                        compare_at_price,
                        price_mode,
                        discount_enabled,
                        discount_type,
                        discount_value,
                        discount_starts_at,
                        discount_ends_at,
                        discount_badge,
                        sku,
                        inventory_quantity,
                        is_active,
                        is_available,
                        is_featured,
                        specifications,
                        created_at,
                        categories (
                            name,
                            slug
                        ),
                        product_images (
                            image_url,
                            is_primary,
                            sort_order
                        )
                    `)
                    .eq("is_active", true)
                    .eq("is_available", true)
                    .order(
                        "created_at",
                        {
                            ascending: false
                        }
                    );

            if (error) throw error;

            if (!Array.isArray(data)) {

                throw new Error(
                    "لم تصل بيانات المنتجات بالشكل المتوقع."
                );
            }


            currentProducts = data.map(product => {

                const images =
                    Array.isArray(product.product_images)
                        ? product.product_images
                            .slice()
                            .sort((a, b) => {

                                if (
                                    a.is_primary !==
                                    b.is_primary
                                ) {
                                    return a.is_primary
                                        ? -1
                                        : 1;
                                }

                                return Number(
                                    a.sort_order || 0
                                ) - Number(
                                    b.sort_order || 0
                                );
                            })
                        : [];


                const primaryImage = images.find(
                    image =>
                        image.is_primary &&
                        safeImage(image.image_url)
                );

                const firstImage = images.find(
                    image =>
                        safeImage(image.image_url)
                );

                const categoryData =
                    Array.isArray(product.categories)
                        ? product.categories[0]
                        : product.categories;


                return {

                    id: product.id,

                    name: product.name || "",

                    slug: product.slug || "",

                    category:
                        categoryData?.name ||
                        "منتجات أخرى",

                    categorySlug:
                        categoryData?.slug || "",

                    price: Number(
                        product.price || 0
                    ),

                    compare_at_price:
                        product.compare_at_price === null
                            ? null
                            : Number(
                                product.compare_at_price
                            ),

                    price_mode:
                        product.price_mode || "fixed",

                    discount_enabled:
                        product.discount_enabled === true,

                    discount_type:
                        product.discount_type || null,

                    discount_value:
                        Number(
                            product.discount_value || 0
                        ),

                    discount_starts_at:
                        product.discount_starts_at || null,

                    discount_ends_at:
                        product.discount_ends_at || null,

                    discount_badge:
                        product.discount_badge || "",

                    desc:
                        product.description || "",

                    image: safeImage(
                        primaryImage?.image_url ||
                        firstImage?.image_url
                    ),

                    images: images
                        .map(image =>
                            safeImage(image.image_url)
                        )
                        .filter(Boolean),

                    sku: product.sku || "",

                    inventory_quantity:
                        product.inventory_quantity,

                    is_active:
                        product.is_active,

                    is_available:
                        product.is_available,

                    is_featured:
                        product.is_featured,

                    specifications:
                        product.specifications || {}
                };
            });


            try {

                localStorage.setItem(
                    "ibr-products",
                    JSON.stringify(currentProducts)
                );

            } catch (storageError) {

                console.warn(
                    "تعذر حفظ نسخة المنتجات محلياً:",
                    storageError
                );
            }


            productsLoaded = true;

            console.log(
                "تم تحميل المنتجات بنجاح:",
                currentProducts.length
            );


            renderProducts();
            renderDetail();
            renderCart();
            updateCount();
            refreshRecommendations();

            return currentProducts;

        } catch (error) {

            console.error(
                "تعذر تحميل المنتجات من Supabase:",
                error
            );

            currentProducts =
                loadCachedProducts();

            if (!currentProducts.length) {
                currentProducts = sample;
            }

            productsLoaded = true;

            renderProducts();
            renderDetail();
            renderCart();
            updateCount();
            refreshRecommendations();

            return currentProducts;
        }
    }

    async function loadProducts() {

        if (productsLoadPromise) {
            return productsLoadPromise;
        }

        if (
            productsLoaded &&
            currentProducts.length
        ) {

            renderProducts();
            renderDetail();
            renderCart();
            updateCount();
            refreshRecommendations();

            return currentProducts;
        }


        productsLoadPromise =
            loadProductsInternal();

        try {

            return await productsLoadPromise;

        } finally {

            productsLoadPromise = null;
        }
    }

    /* =====================================================
       17. CART STORAGE
    ===================================================== */

    function cart() {

        try {

            const saved = JSON.parse(
                localStorage.getItem(
                    "ibr-cart"
                ) || "[]"
            );

            return Array.isArray(saved)
                ? saved
                : [];

        } catch (error) {

            console.error(
                "خطأ في قراءة السلة:",
                error
            );

            return [];
        }
    }


    function saveCart(items) {

        try {

            localStorage.setItem(
                "ibr-cart",
                JSON.stringify(items)
            );

        } catch (error) {

            console.error(
                "تعذر حفظ السلة:",
                error
            );

            showCartFeedback(
                "تعذر حفظ التغيير في السلة. تحقق من مساحة التخزين في المتصفح."
            );

            return false;
        }

        updateCount();

        return true;
    }


    function updateCount() {

        const count = cart().reduce(
            (sum, item) => {

                const quantity = Number(
                    item.qty || 0
                );

                return sum +
                    (
                        Number.isFinite(quantity)
                            ? Math.max(0, quantity)
                            : 0
                    );
            },
            0
        );

        document.querySelectorAll(
            ".cart-count"
        ).forEach(element => {

            element.textContent = count;
        });
    }


    /* =====================================================
       18. ADD TO CART
    ===================================================== */

    function add(id) {

        const allProducts = products();

        const product = allProducts.find(
            item =>
                String(item.id) === String(id)
        );

        if (!product) {

            alert(
                "تعذر العثور على المنتج. يرجى تحديث الصفحة."
            );

            return;
        }


        const uuidPattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        if (
            !uuidPattern.test(
                String(product.id)
            )
        ) {

            alert(
                "معرّف المنتج غير صالح، يرجى تحديث الصفحة."
            );

            return;
        }


        if (!isProductAvailable(product)) {

            alert(
                "عذراً، هذا المنتج غير متاح حالياً."
            );

            return;
        }


        const items = cart().filter(item => {

            const itemId = String(
                item.id || ""
            );

            return (
                uuidPattern.test(itemId) &&
                allProducts.some(
                    product =>
                        String(product.id) === itemId
                )
            );
        });


        const existing = items.find(
            item =>
                String(item.id) ===
                String(product.id)
        );


        const currentQuantity = existing
            ? Number(existing.qty || 0)
            : 0;

        const stock = getProductStock(product);


        if (
            stock !== null &&
            currentQuantity >= stock
        ) {

            alert(
                `الكمية المتاحة من هذا المنتج هي ${stock} فقط.`
            );

            return;
        }


        if (existing) {

            existing.qty =
                currentQuantity + 1;

        } else {

            items.push({

                id: product.id,

                qty: 1
            });
        }


        if (!saveCart(items)) return;

        // تسجيل الإضافة الناجحة في تحليلات IBR المركزية
        if (
            window.IBRAnalytics &&
            typeof window.IBRAnalytics.recordAddToCart === "function"
        ) {
            try {
                window.IBRAnalytics.recordAddToCart(product);
            } catch (error) {
                console.warn(
                    "تعذر تسجيل إضافة المنتج في التحليلات:",
                    error
                );
            }
        }

        recordInterest(
            product.id,
            "cart"
        );


        refreshRecommendations();

        renderCart();

        alert(
            "أضيف المنتج إلى السلة بنجاح."
        );
    }


    /* =====================================================
       19. PRODUCT CARD
    ===================================================== */

    function card(product) {

        const id = encodeURIComponent(
            product.id
        );

        const name = escapeHTML(
            product.name
        );

        const description = escapeHTML(
            product.desc
        );

        const image = safeImage(
            product.image
        );

        const pricing =
            getProductPricing(product);

        const priceHTML =
            pricing.mode === "quote"
                ? "حسب الاتفاق"
                : pricing.mode === "from"
                    ? "يبدأ من " +
                    money(pricing.finalPrice)
                    : money(pricing.finalPrice);


        return `
          
        `;
    }



    /* =====================================================
       20. RENDER PRODUCTS
    ===================================================== */

    function renderProducts() {

        const grid = document.querySelector(
            "#products-grid"
        );

        if (!grid) return;

        const all = products();

        const searchInput =
            document.querySelector("#search");

        const categorySelect =
            document.querySelector("#category");

        const query =
            searchInput?.value?.trim().toLowerCase() || "";

        const category =
            categorySelect?.value || "";


        const filtered = all.filter(product => {

            const matchesName =
                String(product.name || "")
                    .toLowerCase()
                    .includes(query);

            const matchesCategory =
                !category ||
                product.category === category ||
                product.categorySlug === category;

            return (
                matchesName &&
                matchesCategory
            );
        });


        grid.innerHTML = filtered.length
            ? filtered.map(card).join("")
            : `
                <div class="empty">
                    لا توجد منتجات تطابق البحث.
                </div>
            `;
    }


    /* =====================================================
       21. PRODUCT DETAILS
    ===================================================== */

    function renderDetail() {

        const element = document.querySelector(
            "#product-detail"
        );

        if (!element) return;

        const id = new URLSearchParams(
            location.search
        ).get("id");

        const product = products().find(
            item =>
                String(item.id) === String(id)
        );


        if (!product) {

            element.innerHTML = `
                <div class="empty">
                    المنتج غير موجود.
                    <a href="products.html">
                        العودة للمنتجات
                    </a>
                </div>
            `;

            return;
        }


        recordView(product.id);

        const name = escapeHTML(
            product.name
        );

        const description = escapeHTML(
            product.desc
        );

        const category = escapeHTML(
            product.category
        );

        const image = safeImage(
            product.image
        );

        const productId = escapeHTML(
            product.id
        );

        const pricing =
            getProductPricing(product);

        const priceHTML =
            pricing.mode === "quote"
                ? "حسب الاتفاق"
                : pricing.mode === "from"
                    ? "يبدأ من " +
                    money(pricing.finalPrice)
                    : pricing.isDiscounted
                        ? `
                            <span class="cart-old-price">
                                ${money(pricing.basePrice)}
                            </span>
                            <strong>
                                ${money(pricing.finalPrice)}
                            </strong>
                            <span class="cart-discount-badge">
                                ${escapeHTML(pricing.badge)}
                            </span>
                        `
                        : money(pricing.finalPrice);


        element.innerHTML = `
            <div class="detail-layout">

                <div class="detail-photo">

                    ${image
                ? `
                                <img
                                    src="${escapeHTML(image)}"
                                    alt="${name}"
                                    loading="eager"
                                    onerror="this.style.display='none'"
                                >
                            `
                : `
                                <p>الصورة غير متاحة حالياً</p>
                            `
            }

                </div>

                <div>

                    <p class="eyebrow">
                        ${category}
                    </p>

                    <h1>${name}</h1>

                    <p>${description}</p>

                    <div class="detail-price">
                        ${priceHTML}
                    </div>

                    <p class="muted">
                        يمكن مناقشة المقاسات والألوان المتاحة
                        قبل اعتماد الطلب.
                    </p>

                    <button
                        class="btn btn-primary"
                        type="button"
                        onclick="IBR.add('${productId}')"
                    >
                        أضف إلى السلة
                    </button>

                    <a
                        class="btn btn-outline"
                        href="contact.html?product_id=${encodeURIComponent(product.id)}&product_name=${encodeURIComponent(product.name || "")}&product_sku=${encodeURIComponent(product.sku || "")}&product_image=${encodeURIComponent(product.image || "")}&product_price=${encodeURIComponent(product.price ?? "")}"
                    >
                        استفسر عن هذا المنتج
                    </a>

                </div>

            </div>
        `;
    }


    /* =====================================================
       22. CART RECOMMENDATIONS
    ===================================================== */

    function renderCartRecommendations() {

        const section = document.getElementById(
            "cart-recommendations"
        );

        const list = document.getElementById(
            "cart-recommendations-list"
        );

        if (!section || !list) return;

        const cartIds = new Set(
            cart().map(item => String(item.id))
        );

        const cartProducts = currentProducts.filter(
            product =>
                cartIds.has(String(product.id))
        );

        if (!cartProducts.length) {

            section.hidden = true;

            list.innerHTML = "";

            return;
        }


        const categorySlugs = new Set(
            cartProducts
                .map(product => product.categorySlug)
                .filter(Boolean)
        );


        const candidates = currentProducts.filter(
            product => {

                if (
                    cartIds.has(String(product.id))
                ) {
                    return false;
                }

                if (!isProductAvailable(product)) {
                    return false;
                }

                return true;
            }
        );


        candidates.sort((a, b) => {

            const aMatch =
                categorySlugs.has(a.categorySlug)
                    ? 1
                    : 0;

            const bMatch =
                categorySlugs.has(b.categorySlug)
                    ? 1
                    : 0;

            if (aMatch !== bMatch) {
                return bMatch - aMatch;
            }

            const aFeatured =
                a.is_featured ? 1 : 0;

            const bFeatured =
                b.is_featured ? 1 : 0;

            return bFeatured - aFeatured;
        });

        console.log("IBR - تشخيص توصيات السلة:", {

            totalProducts: currentProducts.length,

            cartProducts: cartProducts.map(product => ({
                name: product.name,
                category: product.categorySlug
            })),

            candidatesCount: candidates.length,

            candidates: candidates.map(product => ({
                name: product.name,
                category: product.categorySlug,
                featured: product.is_featured
            }))

        });


        const recommendations =
            candidates.slice(0, 4);


        if (!recommendations.length) {

            section.hidden = true;

            list.innerHTML = "";

            return;
        }


        list.innerHTML = recommendations.map(
            product => {

                const name = escapeHTML(
                    product.name
                );

                const image = safeImage(
                    product.image
                );

                const pricing =
                    getProductPricing(product);

                const priceText =
                    pricing.mode === "quote"
                        ? "حسب الاتفاق"
                        : pricing.mode === "from"
                            ? "يبدأ من " +
                            money(pricing.finalPrice)
                            : money(pricing.finalPrice);

                return `
                    <article class="cart-recommendation-card">

                        <a
                            class="cart-recommendation-image-link"
                            href="${getProductUrl(product)}"
                        >

                            ${image
                        ? `
                                        <img
                                            class="cart-recommendation-image"
                                            src="${escapeHTML(image)}"
                                            alt="${name}"
                                            loading="lazy"
                                        >
                                    `
                        : `
                                        <div class="cart-recommendation-image">
                                            الصورة غير متاحة
                                        </div>
                                    `
                    }

                        </a>

                        <div class="cart-recommendation-info">

                            <h3>
                                <a href="${getProductUrl(product)}">
                                    ${name}
                                </a>
                            </h3>

                            <span class="cart-recommendation-price">
                                ${priceText}
                            </span>

                            <button
                                class="btn btn-primary"
                                type="button"
                                onclick="IBR.add('${escapeHTML(product.id)}')"
                            >
                                أضف للسلة
                            </button>

                        </div>

                    </article>
                `;
            }
        ).join("");

        section.hidden = false;
    }


    /* =====================================================
       23. CART EMPTY STATE
    ===================================================== */

    function renderEmptyCart(element) {

        element.innerHTML = `
            <div class="empty cart-empty-state">

                <div style="font-size:42px;margin-bottom:12px">
                    🛒
                </div>

                <h3>سلتك فارغة حالياً</h3>

                <p>
                    لم تضف أي منتجات إلى سلتك بعد.
                    تصفح منتجات IBR واختر ما يناسبك.
                </p>

                <a
                    class="btn btn-primary"
                    href="products.html"
                    style="display:inline-block;margin-top:12px"
                >
                    اكتشف المنتجات
                </a>

            </div>
        `;
    }


    /* =====================================================
       24. RENDER CART
    ===================================================== */


    function renderCart() {

        const element = document.querySelector(
            "#cart-items"
        );

        if (!element) return;

        const items = cart();

        const allProducts = products();

        const totalElement = document.querySelector(
            "#cart-total"
        );

        const discountSummary = document.querySelector(
            "#cart-discount-summary"
        );

        const savingsBanner = document.getElementById(
            "cart-savings-banner"
        );

        const savingsTotal = document.getElementById(
            "cart-savings-total"
        );

        const checkoutForm = document.getElementById(
            "checkout-form"
        );


        if (!items.length) {

            renderEmptyCart(element);

            if (totalElement) {
                totalElement.textContent = money(0);
            }

            if (discountSummary) {
                discountSummary.innerHTML = "";
            }

            if (savingsBanner) {
                savingsBanner.hidden = true;
            }

            if (checkoutForm) {
                checkoutForm.querySelector(
                    'button[type="submit"]'
                )?.setAttribute("disabled", "disabled");
            }

            const recommendations =
                document.getElementById(
                    "cart-recommendations"
                );

            if (recommendations) {
                recommendations.hidden = true;
            }

            return;
        }


        if (checkoutForm) {

            checkoutForm.querySelector(
                'button[type="submit"]'
            )?.removeAttribute("disabled");
        }


        const validItems = items.filter(item =>
            allProducts.some(
                product =>
                    String(product.id) ===
                    String(item.id)
            )
        );


        if (!validItems.length) {

            element.innerHTML = `
            <div class="empty">
                لم نتمكن من مطابقة منتجات السلة.
                يرجى تحديث الصفحة والمحاولة مرة أخرى.
                <br>
                <a href="products.html">
                    العودة إلى المنتجات
                </a>
            </div>
        `;

            if (totalElement) {
                totalElement.textContent = money(0);
            }

            if (discountSummary) {
                discountSummary.innerHTML = "";
            }

            if (savingsBanner) {
                savingsBanner.hidden = true;
            }

            return;
        }


        let subtotal = 0;

        let totalSavings = 0;

        let finalTotal = 0;

        let hasUnavailableItem = false;


        element.innerHTML = validItems.map(item => {

            const product = allProducts.find(
                p =>
                    String(p.id) ===
                    String(item.id)
            );

            if (!product) return "";

            const quantity = Math.max(
                1,
                Math.floor(
                    Number(item.qty || 1)
                )
            );

            const pricing =
                getProductPricing(product);

            const originalPrice =
                pricing.basePrice;

            const currentPrice =
                pricing.finalPrice;

            const itemSubtotal =
                originalPrice * quantity;

            const itemFinal =
                currentPrice * quantity;

            const itemSavings =
                pricing.discountAmount * quantity;


            subtotal += itemSubtotal;

            finalTotal += itemFinal;

            totalSavings += itemSavings;


            const productUrl =
                getProductUrl(product);

            const image = safeImage(
                product.image
            );

            const stock =
                getProductStock(product);

            const available =
                isProductAvailable(product);


            if (!available) {
                hasUnavailableItem = true;
            }


            let priceHTML = "";

            if (pricing.mode === "quote") {

                priceHTML = `
                <span class="cart-current-price">
                    حسب الاتفاق
                </span>
            `;

            } else if (pricing.mode === "from") {

                priceHTML = `
                <span class="cart-current-price">
                 ${money(currentPrice)}
                </span>
            `;

            } else if (pricing.isDiscounted) {

                priceHTML = `
                <div>
                    <span class="cart-old-price">
                        ${money(originalPrice)}
                    </span>

                    <span class="cart-current-price">
                        ${money(currentPrice)}
                    </span>
                </div>

                <span class="cart-discount-badge">
                    ${escapeHTML(pricing.badge)}
                </span>

                <div class="cart-item-saving">
                    وفّرت ${money(itemSavings)}
                    على هذه الكمية
                </div>
            `;

            } else {

                priceHTML = `
                <span class="cart-current-price">
                    ${money(currentPrice)}
                </span>
            `;
            }


            let stockHTML = "";

            if (!available) {

                stockHTML = `
                <div class="cart-stock-warning">
                   هذا المنتج غير متاح حالياً.
                   يمكنك تقليل الكمية إلى صفر لإزالته من السلة,
                  أو التواصل مع المتجر.
                   </div>
            `;

            } else if (stock !== null) {

                stockHTML = `
                <div class="cart-stock-note">
                    المتاح في المخزون: ${stock}
                </div>
            `;
            }


            const increaseDisabled =
                stock !== null &&
                quantity >= stock;

            const lineTotal =
                pricing.mode === "quote"
                    ? "حسب الاتفاق"
                    : money(itemFinal);


            return `
            <div
                class="cart-row"
                data-cart-product="${escapeHTML(product.id)}"
            >

                <div class="cart-product-info">

                    <a
                     class="cart-product-link"
                     href="${productUrl}"
                      aria-label="عرض تفاصيل ${escapeHTML(product.name)}"
                    >

                    ${pricing.isDiscounted
                    ? `
                               <span class="cart-product-discount-badge">
                               تخفيض ${pricing.discountPercent}%
                               </span>
                            `
                    : ""
                }

                        ${image
                    ? `
                                    <img
                                        class="cart-product-image"
                                        src="${escapeHTML(image)}"
                                        alt="${escapeHTML(product.name)}"
                                        loading="lazy"
                                        onerror="this.style.display='none'"
                                    >
                                `
                    : `
                                    <div class="cart-product-image"></div>
                                `
                }

                    </a>

                    <span class="cart-product-meta">

                        <b class="cart-product-name">
                            ${escapeHTML(product.name)}
                        </b>

                    </span>

                    <div class="cart-price-area">
                        ${priceHTML}
                    </div>

                    ${stockHTML}

                </div>


                <div>

                    <div class="cart-quantity-control">

                        <button
                            type="button"
                            onclick="IBR.change('${escapeHTML(product.id)}',-1)"
                            aria-label="تقليل الكمية"
                        >
                            −
                        </button>

                        <span class="cart-quantity-value">
                            ${quantity}
                        </span>

                        <button
                            type="button"
                            onclick="IBR.change('${escapeHTML(product.id)}',1)"
                            aria-label="زيادة الكمية"
                            ${increaseDisabled || !available ? "disabled" : ""}
                        >
                            +
                        </button>

                    </div>

                </div>


                <b class="cart-line-total">
                    ${lineTotal}
                </b>

            </div>
        `;

        }).join("");


        if (totalElement) {

            totalElement.textContent =
                money(finalTotal);
        }


        if (discountSummary) {

            discountSummary.innerHTML = `
            <div class="cart-discount-line">
             <strong>الإجمالي قبل الخصم</strong>
             <b>${money(subtotal)}</b>
            </div>

            <div class="cart-discount-line cart-final-total">
             <strong>الإجمالي بعد الخصم</strong>
             <b>${money(finalTotal)}</b>
            </div>

        `;
        }


        if (savingsBanner && savingsTotal) {

            savingsBanner.hidden =
                totalSavings <= 0;

            savingsTotal.textContent =
                money(totalSavings);
        }


        if (
            hasUnavailableItem &&
            checkoutForm
        ) {

            const submitButton =
                checkoutForm.querySelector(
                    'button[type="submit"]'
                );

            if (submitButton) {
                submitButton.disabled = true;
            }

        } else if (checkoutForm) {

            checkoutForm.querySelector(
                'button[type="submit"]'
            )?.removeAttribute("disabled");
        }


        renderCartRecommendations();
    }



    /* =====================================================
       25. REMOVE ITEM + UNDO
    ===================================================== */

    function remove(id) {

        const items = cart();

        const removed = items.find(
            item =>
                String(item.id) === String(id)
        );

        if (!removed) return;

        lastRemovedCartItem = {
            item: { ...removed },
            removedAt: Date.now()
        };

        const updated = items.filter(
            item =>
                String(item.id) !== String(id)
        );

        if (!saveCart(updated)) return;

        renderCart();

        showCartFeedback(
            "تم حذف المنتج من السلة.",
            true
        );
    }


    function undoRemoveCartItem() {

        if (!lastRemovedCartItem) return;

        const removed = lastRemovedCartItem;

        if (
            Date.now() - removed.removedAt >
            7000
        ) {

            lastRemovedCartItem = null;

            showCartFeedback(
                "انتهت مدة التراجع عن الحذف."
            );

            return;
        }


        const product = currentProducts.find(
            item =>
                String(item.id) ===
                String(removed.item.id)
        );

        if (!product) {

            showCartFeedback(
                "تعذر استعادة المنتج لأنه لم يعد متاحاً."
            );

            lastRemovedCartItem = null;

            return;
        }


        if (!isProductAvailable(product)) {

            showCartFeedback(
                "لا يمكن استعادة المنتج لأنه غير متاح حالياً."
            );

            lastRemovedCartItem = null;

            return;
        }


        const items = cart();

        const existing = items.find(
            item =>
                String(item.id) ===
                String(removed.item.id)
        );

        if (existing) {

            existing.qty += Number(
                removed.item.qty || 1
            );

        } else {

            items.push(removed.item);
        }


        const stock =
            getProductStock(product);

        const restoredItem = items.find(
            item =>
                String(item.id) ===
                String(product.id)
        );

        if (
            stock !== null &&
            restoredItem &&
            restoredItem.qty > stock
        ) {

            restoredItem.qty = stock;
        }


        if (!saveCart(items)) return;

        lastRemovedCartItem = null;

        clearCartFeedback();

        renderCart();

        showCartFeedback(
            "تمت استعادة المنتج إلى السلة."
        );
    }


    /* =====================================================
       26. CHANGE QUANTITY
       حذف المنتج تلقائياً عند وصول الكمية إلى صفر
    ===================================================== */

    function change(id, amount) {

        const items = cart();

        const product = currentProducts.find(
            item =>
                String(item.id) === String(id)
        );

        if (!product) {

            showCartFeedback(
                "تعذر العثور على المنتج."
            );

            return;
        }

        const existingItem = items.find(
            item =>
                String(item.id) === String(id)
        );

        if (!existingItem) {

            showCartFeedback(
                "المنتج غير موجود في السلة."
            );

            return;
        }

        const currentQuantity = Math.max(
            1,
            Math.floor(
                Number(existingItem.qty || 1)
            )
        );

        let quantity =
            currentQuantity + Number(amount);

        /*
           إذا وصلت الكمية إلى صفر:
           نحذف المنتج تلقائياً ونتيح التراجع.
        */

        if (quantity <= 0) {

            const updated = items.filter(
                item =>
                    String(item.id) !== String(id)
            );

            if (!saveCart(updated)) return;

            lastRemovedCartItem = {
                item: {
                    ...existingItem,
                    qty: currentQuantity
                },
                removedAt: Date.now()
            };

            renderCart();

            showCartFeedback(
                "تمت إزالة المنتج من السلة.",
                true
            );

            return;
        }


        /*
           التأكد من عدم تجاوز المخزون
        */

        const stock =
            getProductStock(product);

        if (
            stock !== null &&
            quantity > stock
        ) {

            quantity = stock;

            showCartFeedback(
                `الكمية القصوى المتاحة من هذا المنتج هي ${stock}.`
            );
        }


        /*
           تحديث كمية المنتج فقط
        */

        const updated = items.map(item => {

            if (
                String(item.id) !== String(id)
            ) {
                return item;
            }

            return {
                ...item,
                qty: quantity
            };
        });


        if (!saveCart(updated)) return;

        clearCartFeedback();

        renderCart();
    }


    /* =====================================================
       27. CREATE UUID
    ===================================================== */

    function createUUID() {

        const cryptoObject = window.crypto;

        /*
           استخدام المولد الأصلي إذا كان متاحاً
        */

        if (
            cryptoObject &&
            typeof cryptoObject.randomUUID === "function"
        ) {
            return cryptoObject.randomUUID();
        }


        /*
           إنشاء UUID احتياطي
        */

        const values = new Uint8Array(16);

        if (
            cryptoObject &&
            typeof cryptoObject.getRandomValues === "function"
        ) {

            cryptoObject.getRandomValues(values);

        } else {

            for (let index = 0; index < values.length; index++) {

                values[index] = Math.floor(
                    Math.random() * 256
                );
            }
        }


        /*
           ضبط إصدار UUID إلى الإصدار الرابع
        */

        values[6] =
            (values[6] & 0x0f) | 0x40;

        values[8] =
            (values[8] & 0x3f) | 0x80;


        const hex = Array.from(values)
            .map(value =>
                value.toString(16).padStart(2, "0")
            )
            .join("");


        return [
            hex.substring(0, 8),
            hex.substring(8, 12),
            hex.substring(12, 16),
            hex.substring(16, 20),
            hex.substring(20, 32)
        ].join("-");
    }


    /* =====================================================
       28. ORDER SUCCESS VIEW
    ===================================================== */

    function showOrderSuccess(
        formElement,
        orderNumber
    ) {

        const successCard =
            document.createElement("section");

        successCard.className =
            "order-success-card";


        successCard.innerHTML = `

            <div class="order-success-icon">
                ✓
            </div>

            <h2>تم استلام طلبك بنجاح</h2>

            <p>
                شكراً لثقتك بمتجر IBR.
                تم تسجيل طلبك في النظام،
                وسيتواصل معك فريق المتجر لتأكيد التفاصيل والتوصيل.
            </p>

            <div class="order-number-box">

                <strong>رقم طلبك</strong>

                <div class="order-number-value">
                    ${escapeHTML(orderNumber)}
                </div>

            </div>

            <div class="order-success-actions">

                <button
                    type="button"
                    class="btn btn-outline"
                    id="copy-order-number"
                >
                    نسخ رقم الطلب
                </button>

                <a
                    class="btn btn-primary"
                    href="track-order.html?order=${encodeURIComponent(orderNumber)}"
                >
                    تتبّع طلبك
                </a>

            </div>

            <div
                class="order-copy-message"
                id="order-copy-message"
                aria-live="polite"
            ></div>

            <p>
                طريقة الدفع: الدفع عند الاستلام.
            </p>
        `;


        formElement.hidden = true;

        formElement.insertAdjacentElement(
            "afterend",
            successCard
        );


        const copyButton =
            successCard.querySelector(
                "#copy-order-number"
            );

        const copyMessage =
            successCard.querySelector(
                "#order-copy-message"
            );


        copyButton.addEventListener(
            "click",
            async () => {

                try {

                    await navigator.clipboard.writeText(
                        String(orderNumber)
                    );

                    copyMessage.textContent =
                        "تم نسخ رقم الطلب بنجاح.";

                } catch (error) {

                    const textArea =
                        document.createElement("textarea");

                    textArea.value =
                        String(orderNumber);

                    textArea.style.position =
                        "fixed";

                    textArea.style.opacity = "0";

                    document.body.appendChild(
                        textArea
                    );

                    textArea.select();

                    const copied =
                        document.execCommand("copy");

                    textArea.remove();

                    copyMessage.textContent =
                        copied
                            ? "تم نسخ رقم الطلب بنجاح."
                            : "يرجى نسخ رقم الطلب يدوياً.";
                }
            }
        );


        successCard.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });
    }


    /* =====================================================
       29. SUBMIT ORDER
    ===================================================== */

    async function orderWhatsApp(event) {

        event.preventDefault();

        const formElement = event.target;

        const submitButton =
            event.submitter ||
            formElement.querySelector(
                'button[type="submit"], button:not([type])'
            );


        const items = cart();

        const allProducts = products();


        if (!supabaseClient) {

            alert(
                "تعذر الاتصال بقاعدة البيانات."
            );

            return;
        }


        if (!items.length) {

            alert("السلة فارغة.");

            return;
        }


        if (submitButton?.disabled) {
            return;
        }


        if (submitButton) {

            submitButton.disabled = true;

            submitButton.dataset.oldText =
                submitButton.textContent;

            submitButton.textContent =
                "جارٍ تسجيل طلبك...";
        }

        // تسجيل بدء إتمام الطلب في نظام التحليلات
        if (
            window.IBRAnalytics &&
            typeof window.IBRAnalytics.recordCheckoutStarted === "function"
        ) {
            try {
                window.IBRAnalytics.recordCheckoutStarted(
                    items.reduce(
                        (total, item) => total + Number(item.qty || 0),
                        0
                    )
                );
            } catch (analyticsError) {
                console.warn(
                    "تعذر تسجيل بدء إتمام الطلب:",
                    analyticsError
                );
            }
        }

        try {

            const form =
                new FormData(formElement);


            const customerName =
                String(form.get("name") || "").trim();

            const customerPhone =
                String(form.get("phone") || "").trim();

            const city =
                String(form.get("city") || "").trim();

            const neighborhood =
                String(form.get("neighborhood") || "").trim();

            const address =
                String(form.get("address") || "").trim();

            const notes =
                String(form.get("notes") || "").trim();


            if (
                !customerName ||
                !customerPhone ||
                !city
            ) {

                throw new Error(
                    "يرجى إدخال الاسم ورقم الجوال والمدينة."
                );
            }


            const uuidPattern =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


            const orderItems = items.map(item => {

                const product = allProducts.find(
                    p =>
                        String(p.id) ===
                        String(item.id)
                );


                if (!product) {

                    throw new Error(
                        "أحد المنتجات في السلة غير موجود."
                    );
                }


                if (!isProductAvailable(product)) {

                    throw new Error(
                        `المنتج "${product.name}" غير متاح حالياً.`
                    );
                }


                const productId =
                    String(item.id);


                if (!uuidPattern.test(productId)) {

                    throw new Error(
                        "معرّف أحد المنتجات غير صحيح."
                    );
                }


                const quantity =
                    Number(item.qty);


                if (
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 100
                ) {

                    throw new Error(
                        "كمية أحد المنتجات غير صحيحة."
                    );
                }


                const stock =
                    getProductStock(product);


                if (
                    stock !== null &&
                    quantity > stock
                ) {

                    throw new Error(
                        `الكمية المطلوبة من "${product.name}" تتجاوز المخزون المتاح (${stock}).`
                    );
                }


                return {

                    product_id: productId,

                    quantity
                };
            });


            let idempotencyKey =
                localStorage.getItem(
                    "ibr-order-idempotency-key"
                );


            if (!idempotencyKey) {

                idempotencyKey = createUUID();

                localStorage.setItem(
                    "ibr-order-idempotency-key",
                    idempotencyKey
                );
            }


            const { data, error } =
                await supabaseClient.rpc(
                    "submit_ibr_order",
                    {

                        p_customer_name:
                            customerName,

                        p_customer_phone:
                            customerPhone,

                        p_city:
                            city,

                        p_neighborhood:
                            neighborhood,

                        p_address:
                            address,

                        p_customer_note:
                            notes,

                        p_items:
                            orderItems,

                        p_idempotency_key:
                            idempotencyKey
                    }
                );


            if (error) throw error;


            const orderNumber =
                data?.order_number;


            if (!orderNumber) {

                throw new Error(
                    "لم يصلنا رقم الطلب من قاعدة البيانات."
                );
            }


            // تسجيل إتمام الطلب بعد نجاح قاعدة البيانات

            if (
                window.IBRAnalytics &&
                typeof window.IBRAnalytics.recordOrderCompleted === "function"
            ) {

                try {

                    await window.IBRAnalytics.recordOrderCompleted(

                        orderItems.reduce(
                            (total, item) =>
                                total + Number(item.quantity || 0),
                            0
                        ),

                        idempotencyKey

                    );

                } catch (analyticsError) {

                    console.warn(
                        "تعذر تسجيل إتمام الطلب:",
                        analyticsError
                    );

                }

            }

            localStorage.setItem(
                "ibr-last-order-number",
                orderNumber
            );


            saveCart([]);

            localStorage.removeItem(
                "ibr-order-idempotency-key"
            );


            renderCart();

            showOrderSuccess(
                formElement,
                orderNumber
            );


        } catch (error) {

            console.error(
                "خطأ في إرسال الطلب:",
                error
            );

            alert(
                "لم نتمكن من تسجيل الطلب.\n\n" +
                (
                    error.message ||
                    "حدث خطأ غير متوقع."
                ) +
                "\n\nلم يتم حذف المنتجات من سلتك."
            );


            if (submitButton) {

                submitButton.disabled = false;

                submitButton.textContent =
                    submitButton.dataset.oldText ||
                    "أرسل طلبك";
            }
        }
    }


    /* =====================================================
       30. SETUP
    ===================================================== */

    function setup() {

        updateCount();


        /* قائمة الجوال */

        document.querySelectorAll(
            ".menu-toggle"
        ).forEach(button => {

            button.addEventListener(
                "click",
                () => {

                    const nav =
                        document.querySelector(".nav");

                    if (!nav) return;

                    nav.classList.toggle("open");

                    button.setAttribute(
                        "aria-expanded",
                        nav.classList.contains("open")
                    );
                }
            );
        });


        /* البحث */

        document.querySelector(
            "#search"
        )?.addEventListener(
            "input",
            renderProducts
        );


        /* التصنيف */

        document.querySelector(
            "#category"
        )?.addEventListener(
            "change",
            renderProducts
        );


        /* مربعات التصنيفات */

        document.querySelectorAll(
            ".category-tile"
        ).forEach(tile => {

            tile.addEventListener(
                "click",
                () => {

                    const category =
                        tile.dataset.category || "";

                    const select =
                        document.querySelector("#category");

                    if (select) {

                        select.value = category;

                        select.dispatchEvent(
                            new Event("change")
                        );
                    }


                    document.querySelectorAll(
                        ".category-tile"
                    ).forEach(item => {

                        item.classList.toggle(
                            "is-active",
                            item === tile
                        );
                    });
                }
            );
        });


        /* نموذج الطلب */

        document.querySelector(
            "#checkout-form"
        )?.addEventListener(
            "submit",
            orderWhatsApp
        );


        /* تفضيلات التوصيات */

        setupRecommendationPreferences();


        /* مزامنة إعدادات الإدارة */

        interactionSettingsReady =
            syncInteractionSettings();


        /* تحميل المنتجات */
        const isProductsCatalogPage =
            document.getElementById("products-grid") &&
            document.getElementById("category-tiles") &&
            document.getElementById("subcategory-panel");

        if (!isProductsCatalogPage) {
            loadProducts();
        }
    }


    /* =====================================================
       31. START
    ===================================================== */

    if (
        document.readyState === "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            setup
        );

    } else {

        setup();
    }


    /* =====================================================
       32. PUBLIC API
    ===================================================== */

    return {

        add,

        remove,

        change,

        products,

        loadProducts,

        renderProducts,

        renderDetail,

        renderCart,

        updateCount,

        money,

        getProductPricing,

        recordView,

        recordViewProduct,

        getRecentViews,

        recordInterest,

        recordSaved,

        getRecommendations,

        refreshRecommendations,

        setCategoryPreference,

        getCategoryPreferences,

        syncInteractionSettings
    };

})();


/* =========================================================
   33. GLOBAL STORE API
========================================================= */

window.IBR = IBR;


/* =========================================================
   34. HOME FEATURE IMAGE
========================================================= */

async function loadHomeFeatureImage() {

    const image = document.getElementById(
        "home-feature-image"
    );

    const placeholder = document.getElementById(
        "home-feature-placeholder"
    );

    if (!image || !placeholder) return;


    if (!supabaseClient) {

        console.error(
            "Supabase غير متصل، تعذر تحميل صورة IBR · WOOD."
        );

        return;
    }


    try {

        const { data, error } =
            await supabaseClient
                .from("home_feature_image")
                .select("image_url")
                .eq("id", 1)
                .maybeSingle();


        if (error) throw error;


        if (!data || !data.image_url) {

            console.warn(
                "لا توجد صورة محفوظة لقسم IBR · WOOD."
            );

            return;
        }


        image.onload = () => {

            image.style.display = "block";

            placeholder.style.display = "none";
        };


        image.onerror = () => {

            image.style.display = "none";

            placeholder.style.display = "block";

            console.error(
                "تعذر تحميل صورة IBR · WOOD."
            );
        };


        image.src = data.image_url;


    } catch (error) {

        console.error(
            "خطأ تحميل صورة IBR · WOOD:",
            error
        );
    }
}


document.addEventListener(
    "DOMContentLoaded",
    () => {
        loadHomeFeatureImage();
    }
); 