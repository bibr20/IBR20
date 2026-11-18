
(function () {
    "use strict";

    if (window.IBRSmartDiscovery) return;

    /* =========================================
       IBR SMART DISCOVERY ENGINE
       Version 2.0
       Personalization + Balanced Discovery
    ========================================= */

    const STORAGE_KEY = "ibr-smart-discovery-v1";

    const MAX_EVENTS = 350;
    const MAX_EVENT_AGE = 180 * 24 * 60 * 60 * 1000;
    const DAY = 24 * 60 * 60 * 1000;

    // نسبة التخصيص مقابل اكتشاف بقية المنتجات
    const PERSONALIZATION_RATIO = 0.65;
    const DISCOVERY_RATIO = 0.35;

    // الحد الأعلى لتكرار التصنيف الواحد
    const MAX_CATEGORY_RUN = 2;

    // أوزان التفاعل
    const WEIGHTS = {
        category: 2,
        subcategory: 3,
        search: 1,
        productView: 3,
        favorite: 7,
        cart: 9,
        purchase: 12
    };

    // تخفيف تأثير الاهتمامات القديمة
    const DECAY_PERIOD_DAYS = 30;

    // منع تسجيل الحدث نفسه بشكل متكرر خلال فترة قصيرة
    const DUPLICATE_WINDOW = 20 * 1000;

    // خرائط التصنيفات المعتمدة في متجر IBR
    const CATEGORY_ALIASES = {

        chairs: [
            "chairs",
            "chair",
            "الكراسي",
            "كرسي",
            "الكراسي الخشبية"
        ],

        desks: [
            "desks",
            "desk",
            "المكاتب",
            "مكاتب",
            "المكتب"
        ],

        "kids-corners": [
            "kids-corners",
            "kids corners",
            "kids",
            "زوايا الأطفال",
            "ركن الأطفال",
            "أركان الأطفال"
        ],

        "plant-stands": [
            "plant-stands",
            "plant stands",
            "حوامل النباتات",
            "حامل النباتات",
            "حوامل النبات"
        ],

        "table-chair-sets": [
            "table-chair-sets",
            "table chair sets",
            "أطقم الطاولات والكراسي",
            "طاولات وكراسي",
            "أطقم الطاولات",
            "مجموعات الطاولات والكراسي"
        ],

        tables: [
            "tables",
            "table",
            "الطاولات",
            "طاولات",
            "الطاولة"
        ]
    };

    let memory = loadMemory();


    /* =========================================
       1. أدوات النص والتصنيفات
    ========================================= */

    function normalizeText(value) {

        return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/[ً-ٰٟ]/g, "")
            .replace(/[أإآ]/g, "ا")
            .replace(/ى/g, "ي")
            .replace(/ة/g, "ه")
            .replace(/ـ/g, "")
            .replace(/\s+/g, " ");
    }


    function normalizeCategory(value) {

        const normalized = normalizeText(value);

        if (!normalized) return "";

        for (const slug in CATEGORY_ALIASES) {

            const aliases = CATEGORY_ALIASES[slug];

            if (
                aliases.some(alias =>
                    normalizeText(alias) === normalized
                )
            ) {
                return slug;
            }
        }

        return normalized
            .replace(/\s+/g, "-");
    }


    function getCategory(product) {

        if (!product) return "";

        const possibleValues = [
            product.categorySlug,
            product.category_slug,
            product.category,
            product.categoryName,
            product.category_name,
            product.subcategorySlug,
            product.subcategory_slug
        ];

        for (const value of possibleValues) {

            if (typeof value === "string" && value.trim()) {
                return normalizeCategory(value);
            }
        }

        if (
            product.categories &&
            typeof product.categories === "object"
        ) {

            return normalizeCategory(
                product.categories.slug ||
                product.categories.name ||
                ""
            );
        }

        return "";
    }


    function getProductId(product) {

        return String(
            product?.id ||
            product?.product_id ||
            product?.sku ||
            ""
        );
    }


    function getProductText(product) {

        return normalizeText([
            product?.name,
            product?.title,
            product?.desc,
            product?.description,
            product?.sku
        ].filter(Boolean).join(" "));
    }


    /* =========================================
       2. إدارة الذاكرة والتخزين
    ========================================= */

    function emptyMemory() {

        return {
            version: 2,
            events: [],
            updatedAt: Date.now()
        };
    }


    function loadMemory() {

        try {

            const saved = JSON.parse(
                localStorage.getItem(STORAGE_KEY) || "null"
            );

            // الاحتفاظ بسجل الإصدار السابق
            if (
                saved &&
                (saved.version === 1 || saved.version === 2) &&
                Array.isArray(saved.events)
            ) {

                return {
                    version: 2,
                    events: saved.events,
                    updatedAt: saved.updatedAt || Date.now()
                };
            }

        } catch (error) {

            console.warn(
                "[IBR Discovery] تعذر قراءة الذاكرة:",
                error
            );
        }

        return emptyMemory();
    }


    function saveMemory() {

        const now = Date.now();

        memory.version = 2;
        memory.updatedAt = now;

        memory.events = memory.events
            .filter(event => {

                return (
                    event &&
                    event.type &&
                    Number.isFinite(Number(event.createdAt)) &&
                    now - Number(event.createdAt) < MAX_EVENT_AGE
                );
            })
            .slice(-MAX_EVENTS);

        try {

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(memory)
            );

        } catch (error) {

            console.warn(
                "[IBR Discovery] تعذر حفظ الاهتمامات:",
                error
            );
        }
    }


    /* =========================================
       3. تسجيل التفاعلات
    ========================================= */

    function record(type, data = {}) {

        if (!WEIGHTS[type]) return;

        const now = Date.now();

        const category = normalizeCategory(
            data.category || ""
        );

        const productId = data.productId
            ? String(data.productId)
            : "";

        const value = String(data.value || "")
            .trim()
            .slice(0, 100);

        // منع تضخيم الاهتمام بسبب تكرار الحدث بسرعة
        const duplicate = memory.events.some(event => {

            return (
                event.type === type &&
                event.category === category &&
                event.productId === productId &&
                event.value === value &&
                now - event.createdAt < DUPLICATE_WINDOW
            );
        });

        if (duplicate) return;

        memory.events.push({

            type,
            createdAt: now,
            category,
            productId,
            value
        });

        saveMemory();
    }


    /* =========================================
       4. التراجع الزمني للاهتمامات
    ========================================= */

    function ageFactor(createdAt) {

        const ageDays = Math.max(
            0,
            (Date.now() - Number(createdAt)) / DAY
        );

        return Math.pow(
            0.5,
            ageDays / DECAY_PERIOD_DAYS
        );
    }


    /* =========================================
       5. حساب اهتمامات التصنيفات
    ========================================= */

    function getCategoryScores() {

        const scores = {};

        memory.events.forEach(event => {

            if (!event.category) return;

            const weight = WEIGHTS[event.type] || 0;

            scores[event.category] =
                (scores[event.category] || 0) +
                weight * ageFactor(event.createdAt);
        });

        return scores;
    }


    /* =========================================
       6. حساب اهتمامات المنتجات
    ========================================= */

    function getProductScores() {

        const scores = {};

        memory.events.forEach(event => {

            if (!event.productId) return;

            const weight = WEIGHTS[event.type] || 0;

            scores[event.productId] =
                (scores[event.productId] || 0) +
                weight * ageFactor(event.createdAt);
        });

        return scores;
    }


    /* =========================================
       7. تحليل كلمات البحث
    ========================================= */

    const SEARCH_STOP_WORDS = new Set([

        "من",
        "في",
        "على",
        "مع",
        "عن",
        "الى",
        "هذا",
        "هذه",
        "ذلك",
        "التي",
        "الذي",
        "و",
        "او",
        "the",
        "and",
        "for",
        "with"
    ]);


    function getSearchTokens(value) {

        return normalizeText(value)
            .split(/[\s،,؛;]+/)
            .filter(token => {

                return (
                    token.length >= 2 &&
                    !SEARCH_STOP_WORDS.has(token)
                );
            });
    }


    function getSearchScore(product) {

        const text = getProductText(product);

        if (!text) return 0;

        let total = 0;

        const searches = memory.events
            .filter(event => event.type === "search")
            .slice(-30);

        searches.forEach(event => {

            const tokens = getSearchTokens(event.value);

            if (!tokens.length) return;

            const matched = tokens.filter(token =>
                text.includes(token)
            ).length;

            if (!matched) return;

            const relevance = matched / tokens.length;

            total +=
                WEIGHTS.search *
                relevance *
                2 *
                ageFactor(event.createdAt);
        });

        return total;
    }


    /* =========================================
       8. اكتشاف المنتجات غير المشاهدة
    ========================================= */

    function getExplorationScore(product, productScores) {

        const id = getProductId(product);

        if (!id) return 0;

        // المنتجات التي لم يتفاعل معها العميل
        // تحصل على فرصة اكتشاف إضافية بسيطة
        if (!productScores[id]) {
            return 0.8;
        }

        return 0;
    }


    /* =========================================
       9. احتساب اهتمام التصنيف من المنتجات
    ========================================= */

    function buildEffectiveCategoryScores(
        products,
        categoryScores,
        productScores
    ) {

        const result = {
            ...categoryScores
        };

        products.forEach(product => {

            const category = getCategory(product);
            const id = getProductId(product);

            if (!category || !id) return;

            const productInterest = productScores[id] || 0;

            if (productInterest <= 0) return;

            // الاهتمام بالمنتج يرفع اهتمام تصنيفه أيضًا
            result[category] =
                (result[category] || 0) +
                productInterest * 0.7;
        });

        return result;
    }


    /* =========================================
       10. بناء توزيع التخصيص والاكتشاف
    ========================================= */

    function buildCategoryTargets(
        products,
        categoryScores
    ) {

        const inventory = {};

        products.forEach(product => {

            const category = getCategory(product);

            if (!category) return;

            inventory[category] =
                (inventory[category] || 0) + 1;
        });

        const categories = Object.keys(inventory);

        if (!categories.length) {
            return {};
        }

        const totalProducts = categories.reduce(
            (sum, category) => sum + inventory[category],
            0
        );

        const inventoryShares = {};
        const interestShares = {};

        let totalInterest = 0;

        categories.forEach(category => {

            inventoryShares[category] =
                inventory[category] / totalProducts;

            // الجذر التربيعي يمنع سيطرة اهتمام واحد
            // على التوزيع بالكامل
            const interest = Math.sqrt(
                Math.max(0, categoryScores[category] || 0)
            );

            interestShares[category] = interest;

            totalInterest += interest;
        });

        const targets = {};

        categories.forEach(category => {

            const inventoryShare =
                inventoryShares[category];

            const interestShare = totalInterest > 0
                ? interestShares[category] / totalInterest
                : inventoryShare;

            const personalizedTarget =
                PERSONALIZATION_RATIO * interestShare;

            const discoveryTarget =
                DISCOVERY_RATIO * inventoryShare;

            targets[category] =
                personalizedTarget + discoveryTarget;
        });

        // تصحيح مجموع النسب ليكون 100%
        const totalTargets = Object.values(targets)
            .reduce((sum, value) => sum + value, 0);

        if (totalTargets > 0) {

            Object.keys(targets).forEach(category => {

                targets[category] /= totalTargets;
            });
        }

        return targets;
    }


    /* =========================================
       11. تقييم المنتج داخل تصنيفه
    ========================================= */

    function scoreProduct(
        product,
        categoryScores,
        productScores
    ) {

        const id = getProductId(product);

        let score = 0;

        // اهتمام العميل بالمنتج نفسه
        score +=
            (productScores[id] || 0) * 1.2;

        // مطابقة البحث مع اسم المنتج ووصفه
        score += getSearchScore(product);

        // فرصة اكتشاف منتج جديد
        score += getExplorationScore(
            product,
            productScores
        );

        // دفعة بسيطة للاهتمامات الحديثة بالتصنيف
        const category = getCategory(product);

        const latestCategoryEvent = memory.events
            .filter(event => event.category === category)
            .reduce(
                (latest, event) =>
                    Math.max(latest, event.createdAt),
                0
            );

        if (latestCategoryEvent) {

            const days =
                (Date.now() - latestCategoryEvent) / DAY;

            score += Math.max(
                0,
                2 - days * 0.08
            );
        }

        return score;
    }


    /* =========================================
       12. اختيار التصنيف التالي
    ========================================= */

    function chooseNextCategory(
        groups,
        targets,
        selectedCounts,
        position,
        lastCategories
    ) {

        const available = Object.keys(groups)
            .filter(category =>
                groups[category].length > 0
            )
            .filter(category => {

                const recent = lastCategories
                    .slice(-MAX_CATEGORY_RUN);

                return !(
                    recent.length === MAX_CATEGORY_RUN &&
                    recent.every(value => value === category)
                );
            });

        if (!available.length) {

            return Object.keys(groups).find(category =>
                groups[category].length > 0
            ) || "";
        }

        let selectedCategory = "";
        let highestPriority = -Infinity;

        available.forEach(category => {

            const target = targets[category] || 0;

            const selected = selectedCounts[category] || 0;

            // مقدار النقص عن الحصة المستهدفة
            const deficit =
                target * (position + 1) - selected;

            // أولوية بسيطة للتصنيفات ذات الاهتمام الأعلى
            const preferenceBonus = target * 0.12;

            const priority =
                deficit + preferenceBonus;

            if (priority > highestPriority) {

                highestPriority = priority;
                selectedCategory = category;
            }
        });

        return selectedCategory;
    }


    /* =========================================
       13. محرك الترتيب الذكي الرئيسي
    ========================================= */

    function rank(products) {

        if (!Array.isArray(products) || products.length < 2) {
            return products || [];
        }

        const categoryScores = getCategoryScores();

        const productScores = getProductScores();

        const effectiveCategoryScores =
            buildEffectiveCategoryScores(
                products,
                categoryScores,
                productScores
            );

        const totalInterest =
            Object.values(effectiveCategoryScores)
                .reduce((sum, value) => sum + value, 0);

        const hasSearchHistory = memory.events.some(
            event => event.type === "search"
        );

        // لا نفرض التخصيص على الزائر الجديد
        if (
            totalInterest < 1 &&
            !hasSearchHistory
        ) {
            return products;
        }

        // بناء مجموعات المنتجات حسب التصنيف
        const groups = {};

        products.forEach((product, index) => {

            const category = getCategory(product);

            const key = category || "__uncategorized__";

            if (!groups[key]) {
                groups[key] = [];
            }

            groups[key].push({

                product,
                originalIndex: index,

                score: scoreProduct(
                    product,
                    effectiveCategoryScores,
                    productScores
                )
            });
        });

        // ترتيب المنتجات داخل كل تصنيف
        Object.keys(groups).forEach(category => {

            groups[category].sort((a, b) => {

                if (b.score !== a.score) {
                    return b.score - a.score;
                }

                return a.originalIndex - b.originalIndex;
            });
        });

        const targets = buildCategoryTargets(
            products,
            effectiveCategoryScores
        );

        const selectedCounts = {};

        const lastCategories = [];

        const result = [];

        // استخراج التصنيفات التي لها منتجات فعلية
        const availableCategories = Object.keys(groups)
            .filter(category =>
                category !== "__uncategorized__"
            );

        while (result.length < products.length) {

            const position = result.length;

            let selectedCategory = "";

            if (availableCategories.length) {

                selectedCategory = chooseNextCategory(
                    groups,
                    targets,
                    selectedCounts,
                    position,
                    lastCategories
                );
            }

            // معالجة المنتجات التي لا تحمل تصنيفًا
            if (!selectedCategory) {

                selectedCategory = Object.keys(groups).find(
                    category => groups[category].length > 0
                );
            }

            if (!selectedCategory) break;

            const selectedGroup = groups[selectedCategory];

            if (!selectedGroup || !selectedGroup.length) {
                break;
            }

            const selected = selectedGroup.shift();

            result.push(selected.product);

            selectedCounts[selectedCategory] =
                (selectedCounts[selectedCategory] || 0) + 1;

            lastCategories.push(selectedCategory);
        }

        // ضمان عدم فقدان أي منتج لأي سبب
        if (result.length !== products.length) {

            const includedIds = new Set(
                result.map(getProductId)
            );

            products.forEach(product => {

                const id = getProductId(product);

                if (!includedIds.has(id)) {
                    result.push(product);
                }
            });
        }

        return result;
    }


    /* =========================================
       14. واجهة تسجيل الاهتمامات
    ========================================= */

    function recordCategory(slug) {

        if (!slug) return;

        record("category", {
            category: slug
        });
    }


    function recordSubcategory(slug) {

        if (!slug) return;

        record("subcategory", {
            category: slug
        });
    }


    function recordSearch(value) {

        const query = String(value || "").trim();

        if (query.length < 2) return;

        record("search", {
            value: query.slice(0, 100)
        });
    }


    function recordProductView(product) {

        if (!product) return;

        record("productView", {
            productId: getProductId(product),
            category: getCategory(product)
        });
    }


    function recordFavorite(product) {

        if (!product) return;

        record("favorite", {
            productId: getProductId(product),
            category: getCategory(product)
        });
    }


    function recordCart(product) {

        if (!product) return;

        record("cart", {
            productId: getProductId(product),
            category: getCategory(product)
        });
    }


    // متاحة لربطها لاحقًا بتأكيد الطلب الفعلي
    function recordPurchase(product) {

        if (!product) return;

        record("purchase", {
            productId: getProductId(product),
            category: getCategory(product)
        });
    }


    /* =========================================
       15. قراءة تفضيلات العميل
    ========================================= */

    function getPreferences() {

        const categories = getCategoryScores();

        const products = getProductScores();

        const searchEvents = memory.events.filter(
            event => event.type === "search"
        );

        return {

            categories,
            products,

            eventsCount: memory.events.length,

            searchEventsCount: searchEvents.length,

            lastUpdated: memory.updatedAt
        };
    }


    /* =========================================
       16. إعادة ضبط الاهتمامات
    ========================================= */

    function reset() {

        memory = emptyMemory();

        try {

            localStorage.removeItem(STORAGE_KEY);

        } catch (error) {

            console.warn(
                "[IBR Discovery] تعذر إعادة ضبط الذاكرة:",
                error
            );
        }
    }


    /* =========================================
       17. إتاحة المحرك للمتجر
    ========================================= */

    window.IBRSmartDiscovery = {

        rank,

        recordCategory,
        recordSubcategory,
        recordSearch,

        recordProductView,
        recordFavorite,
        recordCart,
        recordPurchase,

        getPreferences,

        reset
    };


    console.log(
        "[IBR Discovery] محرك التخصيص والاكتشاف الذكي 2.0 جاهز."
    );

})();
