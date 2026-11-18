
/* =========================================================
   IBR SMART RECOMMENDATIONS
   Version: 1.0.0

   نظام التوصيات الذكي المستقل لمتجر IBR20

   يعتمد على:
   - IBRSmartDiscovery 2.0
   - بيانات المنتجات المحملة في المتجر
   - اهتمامات العميل وسلوكه
   - تشابه المنتجات والعلاقات المكملة
   - تنويع النتائج ومنع التكرار

   لا يستبدل محرك التخصيص الحالي.
========================================================= */

(function (window, document) {
    "use strict";

    if (window.IBRSmartRecommendations) return;

    const VERSION = "1.0.0";

    const CONFIG = {
        maxResults: 12,
        maxCategoryRun: 2,
        recentProductsLimit: 30,
        minSimilarityScore: 1,
        storageKey: "ibr-smart-recommendations-v1",

        weights: {
            category: 5,
            subcategory: 4,
            nameSimilarity: 5,
            descriptionSimilarity: 2,
            priceSimilarity: 2,
            customerInterest: 6,
            complementary: 5,
            discovery: 2,
            recency: 1
        }
    };

    const STOP_WORDS = new Set([
        "من", "في", "على", "الى", "إلى", "عن", "مع",
        "هذا", "هذه", "ذلك", "تلك", "هو", "هي",
        "و", "او", "أو", "ثم", "الذي", "التي",
        "لل", "منها", "عليه", "عليها",
        "the", "and", "for", "with", "from",
        "this", "that", "wood", "wooden"
    ]);

    /*
       علاقات المنتجات المكملة.

       هذه العلاقات قابلة للتوسع تلقائيًا عند إضافة
       تصنيفات جديدة، ويمكن إضافة علاقات خاصة لاحقًا.
    */

    const COMPLEMENTARY_CATEGORIES = {
        chairs: [
            "tables",
            "desks",
            "table-chair-sets",
            "kids-corners"
        ],

        tables: [
            "chairs",
            "plant-stands",
            "table-chair-sets"
        ],

        desks: [
            "chairs",
            "kids-corners",
            "tables"
        ],

        "kids-corners": [
            "desks",
            "chairs",
            "tables"
        ],

        "plant-stands": [
            "tables"
        ],

        "table-chair-sets": [
            "chairs",
            "tables"
        ]
    };

    const PLACEMENTS = {
        similar: "similar",
        complementary: "complementary",
        cart: "cart",
        home: "home",
        wishlist: "wishlist"
    };

    let recommendationEvents = loadEvents();

    /* =====================================================
       أدوات عامة
    ===================================================== */

    function normalizeText(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[أإآ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/ة/g, "ه")
            .replace(/[ًٌٍَُِّْـ]/g, "")
            .replace(/[^\p{L}\p{N}\s-]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function tokenize(value) {
        return normalizeText(value)
            .split(/[\s-]+/)
            .filter(function (word) {
                return word.length > 1 && !STOP_WORDS.has(word);
            });
    }

    function unique(values) {
        return Array.from(new Set(values.filter(Boolean)));
    }

    function getProductId(product) {
        if (!product) return "";

        return String(
            product.id ||
            product.product_id ||
            product.sku ||
            ""
        );
    }

    function getProductCategory(product) {
        if (!product) return "";

        const category = product.category ||
            product.categorySlug ||
            product.category_slug ||
            product.categoryName ||
            product.category_name ||
            product.subcategorySlug ||
            product.subcategory_slug ||
            "";

        if (typeof category === "string") {
            return normalizeText(category).replace(/\s+/g, "-");
        }

        if (typeof category === "object") {
            return normalizeText(
                category.slug ||
                category.name ||
                ""
            ).replace(/\s+/g, "-");
        }

        if (product.categories) {
            const relation = Array.isArray(product.categories)
                ? product.categories[0]
                : product.categories;

            if (relation) {
                return normalizeText(
                    relation.slug || relation.name || ""
                ).replace(/\s+/g, "-");
            }
        }

        return "";
    }

    function getProductName(product) {
        return String(
            product && (
                product.name ||
                product.title ||
                product.product_name ||
                ""
            )
        );
    }

    function getProductDescription(product) {
        return String(
            product && (
                product.description ||
                product.desc ||
                product.details ||
                ""
            )
        );
    }

    function getProductPrice(product) {
        if (!product) return 0;

        const values = [
            product.sale_price,
            product.price,
            product.base_price,
            product.compare_at_price
        ];

        for (let i = 0; i < values.length; i++) {
            const value = Number(values[i]);

            if (Number.isFinite(value) && value > 0) {
                return value;
            }
        }

        return 0;
    }

    function isProductAvailable(product) {
        if (!product) return false;

        if (
            product.is_active === false ||
            product.active === false ||
            product.is_available === false ||
            product.available === false
        ) {
            return false;
        }

        if (
            product.status &&
            ["inactive", "archived", "deleted", "unavailable"]
                .includes(String(product.status).toLowerCase())
        ) {
            return false;
        }

        return true;
    }

    function getProductText(product) {
        return normalizeText([
            getProductName(product),
            getProductDescription(product),
            product && product.sku,
            product && product.category,
            product && product.category_name
        ].join(" "));
    }

    function getProductTokens(product) {
        return unique(tokenize(getProductText(product)));
    }

    function getCurrentTime() {
        return Date.now();
    }

    /* =====================================================
       تخزين أحداث التوصيات
    ===================================================== */

    function loadEvents() {
        try {
            const stored = JSON.parse(
                localStorage.getItem(CONFIG.storageKey) || "[]"
            );

            if (!Array.isArray(stored)) return [];

            return stored
                .filter(function (event) {
                    return event &&
                        event.type &&
                        event.timestamp &&
                        getCurrentTime() - event.timestamp <
                            180 * 24 * 60 * 60 * 1000;
                })
                .slice(-500);

        } catch (error) {
            return [];
        }
    }

    function saveEvents() {
        try {
            localStorage.setItem(
                CONFIG.storageKey,
                JSON.stringify(recommendationEvents.slice(-500))
            );
        } catch (error) {
            // استمرار عمل النظام حتى عند تعذر التخزين.
        }
    }

    function recordEvent(type, product, extra) {
        const id = getProductId(product);

        const event = {
            type: String(type),
            productId: id,
            category: getProductCategory(product),
            timestamp: getCurrentTime(),
            extra: extra || {}
        };

        recommendationEvents.push(event);

        if (recommendationEvents.length > 500) {
            recommendationEvents =
                recommendationEvents.slice(-500);
        }

        saveEvents();

        return true;
    }

    /* =====================================================
       قراءة اهتمامات محرك التخصيص الحالي
    ===================================================== */

    function getDiscoveryPreferences() {
        const discovery = window.IBRSmartDiscovery;

        if (
            !discovery ||
            typeof discovery.getPreferences !== "function"
        ) {
            return {
                categories: {},
                products: {}
            };
        }

        try {
            return discovery.getPreferences() || {
                categories: {},
                products: {}
            };
        } catch (error) {
            return {
                categories: {},
                products: {}
            };
        }
    }

    function getInterestScore(product) {
        const preferences = getDiscoveryPreferences();

        const category = getProductCategory(product);
        const id = getProductId(product);

        const categoryScore = Number(
            preferences.categories &&
            preferences.categories[category]
        ) || 0;

        const productScore = Number(
            preferences.products &&
            preferences.products[id]
        ) || 0;

        const localProductEvents = recommendationEvents.filter(
            function (event) {
                return event.productId === id;
            }
        );

        const recentBonus = localProductEvents.reduce(
            function (total, event) {
                const ageDays = (
                    getCurrentTime() - event.timestamp
                ) / 86400000;

                return total + Math.max(
                    0,
                    2 - ageDays / 30
                );
            },
            0
        );

        return categoryScore * 0.7 +
            productScore +
            recentBonus;
    }

    /* =====================================================
       تحليل التشابه بين المنتجات
    ===================================================== */

    function calculateTokenSimilarity(productA, productB) {
        const tokensA = getProductTokens(productA);
        const tokensB = getProductTokens(productB);

        if (!tokensA.length || !tokensB.length) return 0;

        const setB = new Set(tokensB);

        let common = 0;

        tokensA.forEach(function (token) {
            if (setB.has(token)) common++;
        });

        const union = new Set(tokensA.concat(tokensB)).size;

        return union ? common / union : 0;
    }

    function calculatePriceSimilarity(productA, productB) {
        const priceA = getProductPrice(productA);
        const priceB = getProductPrice(productB);

        if (!priceA || !priceB) return 0;

        const difference = Math.abs(priceA - priceB);
        const average = (priceA + priceB) / 2;

        if (!average) return 0;

        return Math.max(
            0,
            1 - difference / average
        );
    }

    function calculateSimilarity(productA, productB) {
        if (!productA || !productB) return 0;

        const categoryA = getProductCategory(productA);
        const categoryB = getProductCategory(productB);

        const categoryScore =
            categoryA && categoryA === categoryB ? 1 : 0;

        const tokenScore = calculateTokenSimilarity(
            productA,
            productB
        );

        const priceScore = calculatePriceSimilarity(
            productA,
            productB
        );

        return (
            categoryScore * CONFIG.weights.category +
            tokenScore * CONFIG.weights.nameSimilarity +
            priceScore * CONFIG.weights.priceSimilarity
        );
    }

    /* =====================================================
       المنتجات المكملة
    ===================================================== */

    function getComplementaryScore(product, referenceProducts) {
        const category = getProductCategory(product);

        if (!category || !referenceProducts.length) return 0;

        let score = 0;

        referenceProducts.forEach(function (reference) {
            const referenceCategory =
                getProductCategory(reference);

            if (!referenceCategory) return;

            const related =
                COMPLEMENTARY_CATEGORIES[referenceCategory] || [];

            if (related.includes(category)) {
                score += CONFIG.weights.complementary;
            }
        });

        return score;
    }

    function getSimilarityToReferences(product, references) {
        if (!references.length) return 0;

        let bestScore = 0;

        references.forEach(function (reference) {
            const score = calculateSimilarity(product, reference);

            if (score > bestScore) {
                bestScore = score;
            }
        });

        return bestScore;
    }

    /* =====================================================
       ترتيب المنتجات عبر محرك التخصيص الحالي
    ===================================================== */

    function getDiscoveryRankedProducts(products) {
        const discovery = window.IBRSmartDiscovery;

        if (
            !discovery ||
            typeof discovery.rank !== "function"
        ) {
            return products.slice();
        }

        try {
            const ranked = discovery.rank(products.slice());

            if (Array.isArray(ranked)) {
                return ranked;
            }
        } catch (error) {
            // استخدام الترتيب الأصلي عند تعذر المحرك.
        }

        return products.slice();
    }

    function getDiscoveryPositionMap(products) {
        const ranked = getDiscoveryRankedProducts(products);
        const positions = new Map();

        ranked.forEach(function (product, index) {
            positions.set(getProductId(product), index);
        });

        return positions;
    }

    /* =====================================================
       سجل المنتجات التي تم عرضها مؤخرًا
    ===================================================== */

    function getRecentlyRecommendedIds() {
        return recommendationEvents
            .filter(function (event) {
                return event.type === "recommendation_shown" &&
                    getCurrentTime() - event.timestamp <
                        24 * 60 * 60 * 1000;
            })
            .map(function (event) {
                return event.productId;
            })
            .filter(Boolean);
    }

    function recordRecommendationShown(products, placement) {
        const now = getCurrentTime();

        products.forEach(function (product) {
            const id = getProductId(product);

            if (!id) return;

            recommendationEvents.push({
                type: "recommendation_shown",
                productId: id,
                category: getProductCategory(product),
                timestamp: now,
                extra: {
                    placement: placement
                }
            });
        });

        if (recommendationEvents.length > 500) {
            recommendationEvents =
                recommendationEvents.slice(-500);
        }

        saveEvents();
    }

    /* =====================================================
       التنويع ومنع سيطرة تصنيف واحد
    ===================================================== */

    function diversifyProducts(scoredProducts, limit) {
        const remaining = scoredProducts.slice();
        const selected = [];
        const categoryCounts = {};

        let previousCategory = "";

        while (
            remaining.length &&
            selected.length < limit
        ) {
            let selectedIndex = -1;

            for (let i = 0; i < remaining.length; i++) {
                const product = remaining[i].product;
                const category = getProductCategory(product) ||
                    "__uncategorized__";

                const count = categoryCounts[category] || 0;

                const wouldRepeatTooMuch =
                    category === previousCategory &&
                    count >= CONFIG.maxCategoryRun;

                if (!wouldRepeatTooMuch) {
                    selectedIndex = i;
                    break;
                }
            }

            if (selectedIndex === -1) {
                selectedIndex = 0;
            }

            const chosen = remaining.splice(
                selectedIndex,
                1
            )[0];

            const category = getProductCategory(
                chosen.product
            ) || "__uncategorized__";

            selected.push(chosen.product);

            categoryCounts[category] =
                (categoryCounts[category] || 0) + 1;

            previousCategory = category;
        }

        return selected;
    }

    /* =====================================================
       تحديد المنتجات المرجعية حسب الصفحة
    ===================================================== */

    function getReferenceProducts(options) {
        const references = [];

        if (options.currentProduct) {
            references.push(options.currentProduct);
        }

        if (Array.isArray(options.cartItems)) {
            references.push.apply(
                references,
                options.cartItems
            );
        }

        if (Array.isArray(options.wishlistItems)) {
            references.push.apply(
                references,
                options.wishlistItems
            );
        }

        if (Array.isArray(options.referenceProducts)) {
            references.push.apply(
                references,
                options.referenceProducts
            );
        }

        return unique(
            references.map(getProductId)
        ).map(function (id) {
            return references.find(function (product) {
                return getProductId(product) === id;
            });
        }).filter(Boolean);
    }

    /* =====================================================
       حساب نتيجة كل منتج
    ===================================================== */

    function scoreProduct(product, options, references, positions) {
        const placement = options.placement || "home";

        const category = getProductCategory(product);
        const id = getProductId(product);

        let score = 0;

        const interestScore = getInterestScore(product);

        score += interestScore *
            CONFIG.weights.customerInterest;

        const discoveryPosition =
            positions.has(id)
                ? positions.get(id)
                : 999;

        const discoveryBonus = Math.max(
            0,
            12 - discoveryPosition / 8
        );

        score += discoveryBonus *
            CONFIG.weights.discovery;

        if (references.length) {
            score += getSimilarityToReferences(
                product,
                references
            );
        }

        if (
            placement === "complementary" ||
            placement === "cart"
        ) {
            score += getComplementaryScore(
                product,
                references
            );
        }

        if (
            placement === "similar" &&
            options.currentProduct
        ) {
            score += calculateSimilarity(
                product,
                options.currentProduct
            ) * 1.5;
        }

        if (
            placement === "wishlist" &&
            references.length
        ) {
            score += getSimilarityToReferences(
                product,
                references
            ) * 1.25;
        }

        if (placement === "home") {
            score += Math.random() *
                CONFIG.weights.discovery;
        }

        const createdAt = product.created_at
            ? new Date(product.created_at).getTime()
            : 0;

        if (
            createdAt &&
            Number.isFinite(createdAt)
        ) {
            const ageDays = Math.max(
                0,
                (getCurrentTime() - createdAt) / 86400000
            );

            score += Math.max(
                0,
                5 - ageDays / 30
            ) * CONFIG.weights.recency;
        }

        return {
            product: product,
            score: score,
            category: category,
            id: id
        };
    }

    /* =====================================================
       محرك التوصيات الرئيسي
    ===================================================== */

    function recommend(allProducts, options) {
        options = options || {};

        if (!Array.isArray(allProducts)) {
            return [];
        }

        const placement = PLACEMENTS[options.placement]
            ? options.placement
            : "home";

        const limit = Math.max(
            1,
            Math.min(
                Number(options.limit) || CONFIG.maxResults,
                50
            )
        );

        const references = getReferenceProducts(options);

        const excludedIds = new Set(
            (options.excludeIds || []).map(String)
        );

        const referenceIds = new Set(
            references.map(getProductId)
        );

        if (options.excludeReferenceProducts !== false) {
            referenceIds.forEach(function (id) {
                excludedIds.add(id);
            });
        }

        if (Array.isArray(options.cartItems)) {
            options.cartItems.forEach(function (product) {
                excludedIds.add(getProductId(product));
            });
        }

        if (Array.isArray(options.wishlistItems)) {
            options.wishlistItems.forEach(function (product) {
                excludedIds.add(getProductId(product));
            });
        }

        const recentIds = new Set(
            getRecentlyRecommendedIds()
        );

        const positions = getDiscoveryPositionMap(
            allProducts
        );

        const candidates = allProducts.filter(
            function (product) {
                const id = getProductId(product);

                if (!id) return false;
                if (!isProductAvailable(product)) return false;
                if (excludedIds.has(id)) return false;

                if (
                    options.excludeRecentlyShown &&
                    recentIds.has(id)
                ) {
                    return false;
                }

                if (
                    options.category &&
                    getProductCategory(product) !==
                        normalizeText(options.category)
                            .replace(/\s+/g, "-")
                ) {
                    return false;
                }

                return true;
            }
        );

        const scored = candidates.map(function (product) {
            return scoreProduct(
                product,
                {
                    placement: placement,
                    currentProduct: options.currentProduct
                },
                references,
                positions
            );
        });

        scored.sort(function (a, b) {
            return b.score - a.score;
        });

        const minimumScore = Number.isFinite(
            options.minScore
        )
            ? options.minScore
            : CONFIG.minSimilarityScore;

        let filtered = scored.filter(function (item) {
            return item.score >= minimumScore;
        });

        /*
           إذا كانت المنتجات قليلة أو سجل الاهتمام فارغًا،
           نسمح بمنتجات الاستكشاف حتى لا يظهر مربع فارغ.
        */

        if (filtered.length < limit) {
            const included = new Set(
                filtered.map(function (item) {
                    return item.id;
                })
            );

            scored.forEach(function (item) {
                if (
                    filtered.length < limit &&
                    !included.has(item.id)
                ) {
                    filtered.push(item);
                    included.add(item.id);
                }
            });
        }

        const results = diversifyProducts(
            filtered,
            limit
        );

        if (options.recordImpressions === true) {
            recordRecommendationShown(
                results,
                placement
            );
        }

        return results;
    }

    /* =====================================================
       واجهات مختصرة لكل صفحة
    ===================================================== */

    function getSimilarProducts(products, currentProduct, options) {
        return recommend(products, Object.assign({}, options, {
            placement: "similar",
            currentProduct: currentProduct,
            excludeReferenceProducts: true
        }));
    }

    function getComplementaryProducts(products, referenceProducts, options) {
        return recommend(products, Object.assign({}, options, {
            placement: "complementary",
            referenceProducts: Array.isArray(referenceProducts)
                ? referenceProducts
                : [referenceProducts],
            excludeReferenceProducts: true
        }));
    }

    function getCartRecommendations(products, cartItems, options) {
        return recommend(products, Object.assign({}, options, {
            placement: "cart",
            cartItems: cartItems || [],
            excludeReferenceProducts: true
        }));
    }

    function getHomeRecommendations(products, options) {
        return recommend(products, Object.assign({}, options, {
            placement: "home"
        }));
    }

    function getWishlistRecommendations(products, wishlistItems, options) {
        return recommend(products, Object.assign({}, options, {
            placement: "wishlist",
            wishlistItems: wishlistItems || [],
            excludeReferenceProducts: true
        }));
    }

    /* =====================================================
       تسجيل السلوك وربطه بمحرك التخصيص
    ===================================================== */

    function forwardToDiscovery(method, product, extra) {
        const discovery = window.IBRSmartDiscovery;

        if (
            discovery &&
            typeof discovery[method] === "function"
        ) {
            try {
                discovery[method](product, extra);
            } catch (error) {
                // لا نوقف النظام عند فشل تسجيل حدث.
            }
        }
    }

    function recordView(product) {
        recordEvent("product_view", product);
        forwardToDiscovery("recordProductView", product);
    }

    function recordFavorite(product) {
        recordEvent("favorite", product);
        forwardToDiscovery("recordFavorite", product);
    }

    function recordCart(product) {
        recordEvent("cart", product);
        forwardToDiscovery("recordCart", product);
    }

    function recordPurchase(product) {
        recordEvent("purchase", product);
        forwardToDiscovery("recordPurchase", product);
    }

    function recordSearch(query) {
        const value = String(query || "").trim();

        if (!value) return false;

        recommendationEvents.push({
            type: "search",
            productId: "",
            category: "",
            timestamp: getCurrentTime(),
            extra: {
                query: value
            }
        });

        saveEvents();

        forwardToDiscovery("recordSearch", value);

        return true;
    }

    function recordRecommendationClick(product, placement) {
        recordEvent("recommendation_click", product, {
            placement: placement || ""
        });

        recordView(product);
    }

    /* =====================================================
       معلومات النظام وإدارة الذاكرة
    ===================================================== */

    function getStats() {
        const counts = {};

        recommendationEvents.forEach(function (event) {
            counts[event.type] =
                (counts[event.type] || 0) + 1;
        });

        return {
            version: VERSION,
            eventsCount: recommendationEvents.length,
            eventTypes: counts,
            placements: Object.assign({}, PLACEMENTS),
            complementaryCategories: Object.keys(
                COMPLEMENTARY_CATEGORIES
            )
        };
    }

    function clearLocalRecommendationEvents() {
        recommendationEvents = [];
        saveEvents();

        return true;
    }

    /* =====================================================
       واجهة النظام العامة
    ===================================================== */

    window.IBRSmartRecommendations = {
        version: VERSION,

        recommend: recommend,

        getSimilarProducts: getSimilarProducts,
        getComplementaryProducts: getComplementaryProducts,
        getCartRecommendations: getCartRecommendations,
        getHomeRecommendations: getHomeRecommendations,
        getWishlistRecommendations: getWishlistRecommendations,

        calculateSimilarity: calculateSimilarity,
        getProductCategory: getProductCategory,

        recordView: recordView,
        recordFavorite: recordFavorite,
        recordCart: recordCart,
        recordPurchase: recordPurchase,
        recordSearch: recordSearch,
        recordRecommendationClick: recordRecommendationClick,

        recordRecommendationShown: recordRecommendationShown,

        getStats: getStats,
        clearLocalRecommendationEvents:
            clearLocalRecommendationEvents,

        config: CONFIG
    };

    document.dispatchEvent(
        new CustomEvent("ibr:recommendations-ready", {
            detail: {
                version: VERSION
            }
        })
    );

})(window, document);
