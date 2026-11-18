
/* =========================================================
   IBR ADMIN STORE
   إدارة المنتجات والتصنيفات والصور والبنرات
   يعتمد على Supabase Client الموجود مسبقاً في store.js.
   لا ينشئ اتصالاً جديداً ولا يحذف ملفات Storage القديمة.
========================================================= */

(() => {
    "use strict";

    const CONFIG = {
        tables: {
            products: "products",
            categories: "categories",
            productImages: "product_images",
            banners: "banner_images",
            homeFeature: "home_feature_image"
        },

        buckets: {
            productImages: "product-images",
            siteMedia: "ibr20-site-media"
        },

        limits: {
            products: 500,
            categories: 200,
            fileSize: 5 * 1024 * 1024
        }
    };

    const state = {
        client: null,
        products: [],
        categories: [],
        productImages: [],
        banners: [],
        homeFeature: null,
        filteredProducts: [],
        initialized: false,
        eventsBound: false,
        loading: false
    };

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const $$ = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

    const api = {

        /* =================================================
           أدوات عامة
        ================================================= */

        getClient() {
            return (
                state.client ||
                window.supabaseClient ||
                window.client ||
                null
            );
        },

        getData() {
            return {
                products: [...state.products],
                categories: [...state.categories],
                productImages: [...state.productImages],
                banners: [...state.banners],
                filteredProducts: [...state.filteredProducts]
            };
        },

        escapeHTML(value) {
            if (window.IBRAdmin?.escapeHTML) {
                return window.IBRAdmin.escapeHTML(value);
            }

            return String(value ?? "").replace(/[&<>"']/g, char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            })[char]);
        },

        notify(message, type = "info") {
            if (window.IBRAdmin?.notify) {
                window.IBRAdmin.notify(message, type);
                return;
            }

            if (type === "error") {
                console.error(message);
            } else {
                console.log(message);
            }
        },

        feedback(selector, message, type = "info") {
            const element = $(selector);

            if (!element) return;

            element.textContent = message || "";
            element.dataset.type = type;
            element.hidden = !message;
        },

        slugify(value) {
            const slug = String(value || "")
                .trim()
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, "-")
                .replace(/^-+|-+$/g, "");

            return slug || `ibr-${Date.now()}`;
        },

        formatPrice(value) {
            const number = Number(value);

            if (!Number.isFinite(number)) {
                return "—";
            }

            return number.toLocaleString("ar-SA", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }) + " ر.س";
        },

        getProductName(productId) {
            return (
                state.products.find(
                    product => product.id === productId
                )?.name || "منتج"
            );
        },

        getCategoryName(categoryId) {
            return (
                state.categories.find(
                    category => category.id === categoryId
                )?.name || "بدون تصنيف"
            );
        },

        getPrimaryImage(productId) {
            const images = state.productImages
                .filter(image => image.product_id === productId)
                .sort((a, b) => {
                    if (a.is_primary !== b.is_primary) {
                        return a.is_primary ? -1 : 1;
                    }

                    return Number(a.sort_order || 0) -
                        Number(b.sort_order || 0);
                });

            return images[0]?.image_url || "";
        },

        ensureReady() {
            if (!state.initialized || !this.getClient()) {
                throw new Error(
                    "إدارة المتجر غير مهيأة أو اتصال Supabase غير متاح."
                );
            }
        },

        toDateTimeLocal(value) {
            if (!value) return "";

            const date = new Date(value);

            if (Number.isNaN(date.getTime())) {
                return "";
            }

            const localDate = new Date(
                date.getTime() - date.getTimezoneOffset() * 60000
            );

            return localDate.toISOString().slice(0, 16);
        },

        getProductPricing(product, now = new Date()) {
            const priceMode = product.price_mode || "fixed";
            const price = Number(product.price || 0);
            const compareAtPrice =
                product.compare_at_price === null ||
                product.compare_at_price === undefined ||
                product.compare_at_price === ""
                    ? null
                    : Number(product.compare_at_price);

            if (priceMode === "quote") {
                return {
                    priceMode,
                    isQuote: true,
                    discountActive: false,
                    price,
                    finalPrice: null,
                    saving: 0,
                    compareAtPrice
                };
            }

            const discountEnabled =
                product.discount_enabled === true;

            const start = product.discount_starts_at
                ? new Date(product.discount_starts_at)
                : null;

            const end = product.discount_ends_at
                ? new Date(product.discount_ends_at)
                : null;

            const startValid =
                !start || !Number.isNaN(start.getTime());

            const endValid =
                !end || !Number.isNaN(end.getTime());

            const withinStart =
                !start || (startValid && now >= start);

            const withinEnd =
                !end || (endValid && now < end);

            const discountActive =
                discountEnabled &&
                startValid &&
                endValid &&
                withinStart &&
                withinEnd;

            let saving = 0;
            let finalPrice = price;

            if (discountActive) {
                const discountValue =
                    Number(product.discount_value);

                if (
                    Number.isFinite(discountValue) &&
                    discountValue > 0
                ) {
                    if (product.discount_type === "percentage") {
                        saving = price * discountValue / 100;
                    } else if (product.discount_type === "fixed") {
                        saving = discountValue;
                    }

                    saving = Number(saving.toFixed(2));
                    finalPrice = Number((price - saving).toFixed(2));

                    if (finalPrice <= 0) {
                        saving = 0;
                        finalPrice = price;
                    }
                }
            }

            return {
                priceMode,
                isQuote: false,
                discountActive: discountActive && saving > 0,
                price,
                finalPrice,
                saving,
                compareAtPrice
            };
        },

        /* =================================================
           التهيئة
        ================================================= */

        async init() {
            state.client = this.getClient();

            if (
                !state.client ||
                typeof state.client.from !== "function"
            ) {
                this.notify(
                    "لم يتم العثور على Supabase Client. تأكد من تحميل store.js قبل admin-store.js.",
                    "error"
                );

                return false;
            }

            state.initialized = true;

            this.bindEvents();

            await this.loadAll();

            return true;
        },

        /* =================================================
           تحميل جميع البيانات
        ================================================= */

        async loadAll() {
            this.ensureReady();

            state.loading = true;

            try {
                const results = await Promise.all([
                    this.loadCategories(),
                    this.loadProducts(),
                    this.loadBanners(),
                    this.loadHomeFeature()
                ]);

                this.renderCategories();
                this.renderProducts();
                this.populateProductSelects();
                this.renderBanners();
                this.renderHomeFeature();

                return results.every(Boolean);

            } catch (error) {
                console.error("[IBR Admin Store]", error);

                this.notify(
                    error.message || "تعذر تحميل بيانات المتجر.",
                    "error"
                );

                return false;

            } finally {
                state.loading = false;
            }
        },

        /* =================================================
           تحميل التصنيفات
        ================================================= */

        async loadCategories() {
            const { data, error } = await this.getClient()
                .from(CONFIG.tables.categories)
                .select("*")
                .order("sort_order", { ascending: true })
                .limit(CONFIG.limits.categories);

            if (error) throw error;

            state.categories = Array.isArray(data) ? data : [];

            this.renderCategories();
            this.populateCategoryFilters();
            this.populateProductSelects();

            return true;
        },

        /* =================================================
           تحميل المنتجات والصور
        ================================================= */

        async loadProducts() {
            const { data, error } = await this.getClient()
                .from(CONFIG.tables.products)
                .select("*")
                .order("created_at", { ascending: false })
                .limit(CONFIG.limits.products);

            if (error) throw error;

            state.products = Array.isArray(data) ? data : [];

            const productIds = state.products
                .map(product => product.id)
                .filter(Boolean);

            if (productIds.length) {
                const {
                    data: images,
                    error: imageError
                } = await this.getClient()
                    .from(CONFIG.tables.productImages)
                    .select("*")
                    .in("product_id", productIds)
                    .order("sort_order", { ascending: true });

                if (imageError) throw imageError;

                state.productImages = Array.isArray(images)
                    ? images
                    : [];

            } else {
                state.productImages = [];
            }

            this.applyProductFilters();
            this.renderProducts();
            this.populateProductSelects();

            return true;
        },

        /* =================================================
           تحميل البنرات
        ================================================= */

        async loadBanners() {
            const { data, error } = await this.getClient()
                .from(CONFIG.tables.banners)
                .select("*")
                .order("sort_order", { ascending: true });

            if (error) throw error;

            state.banners = Array.isArray(data) ? data : [];

            this.renderBanners();

            return true;
        },

        /* =================================================
           تحميل صورة الرئيسية
        ================================================= */

        async loadHomeFeature() {
            const { data, error } = await this.getClient()
                .from(CONFIG.tables.homeFeature)
                .select("*")
                .eq("id", 1)
                .maybeSingle();

            if (error) throw error;

            state.homeFeature = data || null;

            this.renderHomeFeature();

            return true;
        },

        /* =================================================
           تعبئة قوائم التصنيفات
        ================================================= */

        populateCategoryFilters() {
            const filter = $("[data-store-category-filter]");

            if (!filter) return;

            const current = filter.value;

            filter.innerHTML =
                '<option value="all">جميع التصنيفات</option>' +

                state.categories.map(category => `
                    <option value="${this.escapeHTML(category.id)}">
                        ${this.escapeHTML(category.name)}
                    </option>
                `).join("");

            if (
                [...filter.options].some(
                    option => option.value === current
                )
            ) {
                filter.value = current;
            }
        },

        /* =================================================
           تعبئة قوائم اختيار المنتجات والتصنيفات
        ================================================= */

        populateProductSelects() {
            const options =
                '<option value="">اختر منتجاً</option>' +

                state.products.map(product => `
                    <option value="${this.escapeHTML(product.id)}">
                        ${this.escapeHTML(product.name)}
                    </option>
                `).join("");

            [
                "[data-banner-product]",
                "[data-home-feature-product]"
            ].forEach(selector => {
                const select = $(selector);

                if (!select) return;

                const current = select.value;

                select.innerHTML = options;

                if (
                    [...select.options].some(
                        option => option.value === current
                    )
                ) {
                    select.value = current;
                }
            });

            const categorySelect = $("[data-product-category]");

            if (categorySelect) {
                const currentCategory = categorySelect.value;

                categorySelect.innerHTML =
                    '<option value="">اختر التصنيف</option>' +

                    state.categories.map(category => `
                        <option value="${this.escapeHTML(category.id)}">
                            ${this.escapeHTML(category.name)}
                        </option>
                    `).join("");

                if (
                    [...categorySelect.options].some(
                        option => option.value === currentCategory
                    )
                ) {
                    categorySelect.value = currentCategory;
                }
            }
        },

        /* =================================================
           عرض التصنيفات
        ================================================= */

        renderCategories() {
            const container = $("[data-store-categories]");

            if (!container) return;

            if (!state.categories.length) {
                container.innerHTML = `
                    <p class="admin-empty-state">
                        لا توجد تصنيفات حتى الآن.
                    </p>
                `;

                return;
            }

            container.innerHTML = state.categories.map(category => `
                <article class="admin-store-category-card">

                    <div class="admin-store-category-info">

                        <strong>
                            ${this.escapeHTML(category.name)}
                        </strong>

                        <small>
                            ${this.escapeHTML(category.slug || "")}
                        </small>

                        <span>
                            ${category.is_active ? "نشط" : "غير نشط"}
                        </span>

                    </div>

                    <div class="admin-store-card-actions">

                        <button
                            type="button"
                            data-category-edit="${this.escapeHTML(category.id)}">
                            تعديل
                        </button>

                        <button
                            type="button"
                            data-category-toggle="${this.escapeHTML(category.id)}"
                            data-active="${category.is_active ? "1" : "0"}">

                            ${category.is_active ? "إيقاف" : "تفعيل"}

                        </button>

                    </div>

                </article>
            `).join("");
        },

        /* =================================================
           البحث والتصفية
        ================================================= */

        applyProductFilters() {
            const search = String(
                $("[data-store-product-search]")?.value || ""
            ).trim().toLowerCase();

            const category =
                $("[data-store-category-filter]")?.value || "all";

            const status =
                $("[data-store-status-filter]")?.value || "";

            state.filteredProducts = state.products.filter(product => {

                const matchesSearch =
                    !search ||
                    String(product.name || "").toLowerCase().includes(search) ||
                    String(product.sku || "").toLowerCase().includes(search);

                const matchesCategory =
                    category === "all" ||
                    String(product.category_id || "") === String(category);

                let matchesStatus = true;

                if (status === "active") {
                    matchesStatus = product.is_active === true;
                }

                if (status === "inactive") {
                    matchesStatus = product.is_active === false;
                }

                return (
                    matchesSearch &&
                    matchesCategory &&
                    matchesStatus
                );
            });

            return state.filteredProducts;
        },

        /* =================================================
           عرض المنتجات والأسعار والخصومات
        ================================================= */

        renderProducts() {
            const container = $("[data-store-products]");

            if (!container) return;

            const products = this.applyProductFilters();

            if (!products.length) {
                container.innerHTML = `
                    <p class="admin-empty-state">
                        لا توجد منتجات مطابقة لخيارات البحث والتصفية.
                    </p>
                `;

                return;
            }

            container.innerHTML = products.map(product => {

                const image = this.getPrimaryImage(product.id);

                const imageMarkup = image
                    ? `
                        <img
                            src="${this.escapeHTML(image)}"
                            alt="${this.escapeHTML(product.name)}"
                            loading="lazy">
                    `
                    : `
                        <div class="admin-store-no-image">
                            لا توجد صورة
                        </div>
                    `;

                const pricing = this.getProductPricing(product);

                let priceMarkup = "";

                if (pricing.isQuote) {
                    priceMarkup = `
                        <b>السعر عند الاستفسار</b>
                    `;
                } else if (pricing.discountActive) {
                    const referencePrice =
                        pricing.compareAtPrice &&
                        pricing.compareAtPrice > pricing.finalPrice
                            ? pricing.compareAtPrice
                            : pricing.price;

                    priceMarkup = `
                        <div class="admin-store-product-pricing">

                            <del>
                                ${this.formatPrice(referencePrice)}
                            </del>

                            <b>
                                ${this.formatPrice(pricing.finalPrice)}
                            </b>

                            <small>
                                توفير ${this.formatPrice(pricing.saving)}
                            </small>

                        </div>
                    `;
                } else {
                    priceMarkup = `
                        <div class="admin-store-product-pricing">

                            ${
                                pricing.compareAtPrice &&
                                pricing.compareAtPrice > pricing.price
                                    ? `
                                        <del>
                                            ${this.formatPrice(pricing.compareAtPrice)}
                                        </del>
                                    `
                                    : ""
                            }

                            <b>
                                ${
                                    pricing.priceMode === "from"
                                        ? "يبدأ من "
                                        : ""
                                }
                                ${this.formatPrice(pricing.price)}
                            </b>

                        </div>
                    `;
                }

                let discountStatus = "";

                if (product.discount_enabled) {
                    const start = product.discount_starts_at
                        ? new Date(product.discount_starts_at)
                        : null;

                    const end = product.discount_ends_at
                        ? new Date(product.discount_ends_at)
                        : null;

                    const now = new Date();

                    if (start && now < start) {
                        discountStatus = "العرض مجدول";
                    } else if (end && now >= end) {
                        discountStatus = "انتهى العرض";
                    } else if (pricing.discountActive) {
                        discountStatus = "الخصم ساري";
                    } else {
                        discountStatus = "إعدادات الخصم";
                    }
                }

                return `
                    <article class="admin-store-product-card">

                        <div class="admin-store-product-image">
                            ${imageMarkup}
                        </div>

                        <div class="admin-store-product-info">

                            <strong>
                                ${this.escapeHTML(product.name)}
                            </strong>

                            <span>
                                ${this.escapeHTML(
                                    this.getCategoryName(product.category_id)
                                )}
                            </span>

                            <span>
                                SKU:
                                ${this.escapeHTML(product.sku || "—")}
                            </span>

                            ${priceMarkup}

                            ${
                                discountStatus
                                    ? `
                                        <small>
                                            ${this.escapeHTML(discountStatus)}
                                        </small>
                                    `
                                    : ""
                            }

                            <small>
                                ${product.is_active ? "نشط" : "غير نشط"}
                                · المخزون:
                                ${Number(product.inventory_quantity || 0)}
                            </small>

                        </div>

                        <div class="admin-store-card-actions">

                            <button
                                type="button"
                                data-product-edit="${this.escapeHTML(product.id)}">
                                تعديل
                            </button>

                            <button
                                type="button"
                                data-product-toggle="${this.escapeHTML(product.id)}"
                                data-active="${product.is_active ? "1" : "0"}">

                                ${product.is_active ? "إيقاف" : "تفعيل"}

                            </button>

                        </div>

                    </article>
                `;
            }).join("");
        },

        /* =================================================
           فتح محرر المنتج
        ================================================= */

        showProductEditor(product = null) {
            const editor = $("[data-store-product-editor]");
            const form = $("[data-store-product-form]");

            if (!editor || !form) return;

            form.reset();

            const set = (name, value) => {
                const field = form.elements.namedItem(name);

                if (!field) return;

                if (field.type === "checkbox") {
                    field.checked = Boolean(value);
                } else {
                    field.value = value ?? "";
                }
            };

            /* البيانات الأساسية */
            set("name", product?.name || "");
            set("category_id", product?.category_id || "");
            set("price", product?.price ?? "");
            set("stock_quantity", product?.inventory_quantity ?? 0);
            set("description", product?.description || "");
            set("is_active", product ? product.is_active : true);

            /* إعدادات التسعير */
            set("price_mode", product?.price_mode || "fixed");
            set("compare_at_price", product?.compare_at_price ?? "");

            /* إعدادات الخصم */
            set("discount_enabled", product?.discount_enabled ?? false);
            set("discount_type", product?.discount_type || "percentage");
            set("discount_value", product?.discount_value ?? "");
            set("discount_badge", product?.discount_badge || "");

            /* تواريخ العرض */
            set(
                "discount_starts_at",
                this.toDateTimeLocal(product?.discount_starts_at)
            );

            set(
                "discount_ends_at",
                this.toDateTimeLocal(product?.discount_ends_at)
            );

            /* إظهار أو إخفاء إعدادات الخصم */
            const discountEnabled = $("[data-product-discount-enabled]");
            const discountFields = $("[data-discount-fields]");

            if (discountEnabled && discountFields) {
                discountFields.hidden = !discountEnabled.checked;
            }

            /* رقم المنتج */
            const productIdField = form.querySelector(
                "[data-product-id]"
            );

            if (productIdField) {
                productIdField.value = product?.id || "";
            }

            /* صور المنتج */
            const preview = $("[data-product-images-preview]");

            if (preview) {
                const images = state.productImages.filter(
                    image => image.product_id === product?.id
                );

                preview.innerHTML = images.map(image => `
                    <div class="admin-store-image-preview">

                        <img
                            src="${this.escapeHTML(image.image_url)}"
                            alt="${this.escapeHTML(
                                image.alt_text || product?.name || "صورة المنتج"
                            )}">

                        ${
                            image.is_primary
                                ? "<small>الصورة الأساسية</small>"
                                : `
                                    <button
                                        type="button"
                                        data-image-primary="${this.escapeHTML(image.id)}"
                                        data-product-id="${this.escapeHTML(product.id)}">
                                        تعيين كأساسية
                                    </button>
                                `
                        }

                    </div>
                `).join("");
            }

            /* معاينة السعر */
            this.updatePricePreview();

            editor.hidden = false;

            editor.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        },

        hideProductEditor() {
            const editor = $("[data-store-product-editor]");

            if (editor) {
                editor.hidden = true;
            }

            const form = $("[data-store-product-form]");

            if (form) {
                form.reset();
            }

            const preview = $("[data-product-images-preview]");

            if (preview) {
                preview.innerHTML = "";
            }

            const discountFields = $("[data-discount-fields]");

            if (discountFields) {
                discountFields.hidden = true;
            }

            this.feedback("[data-product-form-feedback]", "");
        },

        /* =================================================
           فتح محرر التصنيف
        ================================================= */

        showCategoryEditor(category = null) {
            const editor = $("[data-category-editor]");
            const form = $("[data-category-form]");

            if (!editor || !form) return;

            form.reset();

            const set = (name, value) => {
                const field = form.elements.namedItem(name);

                if (field) {
                    field.value = value ?? "";
                }
            };

            set("name", category?.name || "");
            set("slug", category?.slug || "");
            set("description", category?.description || "");
            set("sort_order", category?.sort_order ?? 0);

            const categoryIdField = form.querySelector(
                "[data-category-id]"
            );

            if (categoryIdField) {
                categoryIdField.value = category?.id || "";
            }

            editor.hidden = false;

            editor.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        },

        hideCategoryEditor() {
            const editor = $("[data-category-editor]");

            if (editor) {
                editor.hidden = true;
            }

            const form = $("[data-category-form]");

            if (form) {
                form.reset();
            }

            this.feedback("[data-category-feedback]", "");
        },

        /* =================================================
           حفظ المنتج وإعدادات السعر والخصم
        ================================================= */

        async saveProduct(form) {
            this.ensureReady();

            const formData = new FormData(form);

            const id = String(
                form.querySelector("[data-product-id]")?.value ||
                formData.get("id") ||
                ""
            ).trim();

            const name = String(
                formData.get("name") || ""
            ).trim();

            if (!name) {
                throw new Error("يرجى إدخال اسم المنتج.");
            }

            /* البيانات الأساسية */
            const existing = state.products.find(
                product => product.id === id
            );

            const rawPrice = Number(formData.get("price"));

            if (!Number.isFinite(rawPrice) || rawPrice < 0) {
                throw new Error("يرجى إدخال سعر صحيح للمنتج.");
            }

            const rawStock = Number(
                formData.get("stock_quantity") || 0
            );

            if (!Number.isInteger(rawStock) || rawStock < 0) {
                throw new Error(
                    "كمية المخزون يجب أن تكون رقماً صحيحاً غير سالب."
                );
            }

            /* نمط التسعير */
            const priceMode = String(
                formData.get("price_mode") || "fixed"
            );

            const allowedPriceModes = [
                "fixed",
                "from",
                "quote"
            ];

            if (!allowedPriceModes.includes(priceMode)) {
                throw new Error("نمط التسعير المحدد غير صحيح.");
            }

            /* السعر السابق */
            const compareRaw = String(
                formData.get("compare_at_price") ?? ""
            ).trim();

            let compareAtPrice = null;

            if (compareRaw !== "") {
                compareAtPrice = Number(compareRaw);

                if (
                    !Number.isFinite(compareAtPrice) ||
                    compareAtPrice <= 0
                ) {
                    throw new Error("يرجى إدخال سعر سابق صحيح.");
                }
            }

            /* إعدادات الخصم */
            const discountEnabled =
                form.elements.namedItem("discount_enabled")?.checked === true;

            let discountType = null;
            let discountValue = null;
            let discountBadge = null;
            let discountStartsAt = null;
            let discountEndsAt = null;

            let finalPrice = rawPrice;

            if (discountEnabled) {

                if (priceMode === "quote") {
                    throw new Error(
                        "لا يمكن تفعيل الخصم لمنتج سعره عند الاستفسار."
                    );
                }

                discountType = String(
                    formData.get("discount_type") || ""
                );

                if (!["percentage", "fixed"].includes(discountType)) {
                    throw new Error("يرجى اختيار نوع خصم صحيح.");
                }

                const rawDiscountValue = Number(
                    formData.get("discount_value")
                );

                if (
                    !Number.isFinite(rawDiscountValue) ||
                    rawDiscountValue <= 0
                ) {
                    throw new Error("يرجى إدخال قيمة خصم أكبر من صفر.");
                }

                discountValue = rawDiscountValue;

                if (
                    discountType === "percentage" &&
                    discountValue > 100
                ) {
                    throw new Error(
                        "نسبة الخصم لا يمكن أن تتجاوز 100%."
                    );
                }

                if (
                    discountType === "fixed" &&
                    discountValue >= rawPrice
                ) {
                    throw new Error(
                        "قيمة الخصم يجب أن تكون أقل من السعر الأساسي."
                    );
                }

                const discountAmount =
                    discountType === "percentage"
                        ? rawPrice * discountValue / 100
                        : discountValue;

                finalPrice = Number(
                    (rawPrice - discountAmount).toFixed(2)
                );

                if (finalPrice <= 0) {
                    throw new Error(
                        "السعر النهائي بعد الخصم يجب أن يكون أكبر من صفر."
                    );
                }

                discountBadge = String(
                    formData.get("discount_badge") || ""
                ).trim() || null;

                /* تواريخ العرض */
                const startRaw = String(
                    formData.get("discount_starts_at") || ""
                ).trim();

                const endRaw = String(
                    formData.get("discount_ends_at") || ""
                ).trim();

                if (startRaw) {
                    const startDate = new Date(startRaw);

                    if (Number.isNaN(startDate.getTime())) {
                        throw new Error("تاريخ بداية العرض غير صحيح.");
                    }

                    discountStartsAt = startDate.toISOString();
                }

                if (endRaw) {
                    const endDate = new Date(endRaw);

                    if (Number.isNaN(endDate.getTime())) {
                        throw new Error("تاريخ نهاية العرض غير صحيح.");
                    }

                    discountEndsAt = endDate.toISOString();
                }

                if (
                    discountStartsAt &&
                    discountEndsAt &&
                    new Date(discountEndsAt) <=
                    new Date(discountStartsAt)
                ) {
                    throw new Error(
                        "نهاية العرض يجب أن تكون بعد بداية العرض."
                    );
                }
            }

            /* التحقق من السعر السابق */
            if (compareAtPrice !== null) {
                const comparisonPrice = discountEnabled
                    ? finalPrice
                    : rawPrice;

                if (compareAtPrice <= comparisonPrice) {
                    throw new Error(
                        "السعر السابق يجب أن يكون أعلى من السعر الحالي أو النهائي بعد الخصم."
                    );
                }
            }

            /* تجهيز بيانات قاعدة البيانات */
            const payload = {
                name,

                slug: existing?.slug || this.slugify(name),

                category_id:
                    String(formData.get("category_id") || "") || null,

                price: rawPrice,

                compare_at_price: compareAtPrice,

                price_mode: priceMode,

                discount_enabled: discountEnabled,

                discount_type: discountType,

                discount_value: discountValue,

                discount_starts_at: discountStartsAt,

                discount_ends_at: discountEndsAt,

                discount_badge: discountBadge,

                inventory_quantity: rawStock,

                description:
                    String(formData.get("description") || "").trim() || null,

                is_active:
                    form.elements.namedItem("is_active")?.checked ?? true,

                is_available:
                    existing?.is_available ?? true,

                is_featured:
                    existing?.is_featured ?? false,

                specifications:
                    existing?.specifications || {},

                sku:
                    existing?.sku || null,

                updated_at: new Date().toISOString()
            };

            /* الحفظ في Supabase */
            let result;

            if (id) {
                result = await this.getClient()
                    .from(CONFIG.tables.products)
                    .update(payload)
                    .eq("id", id)
                    .select("*")
                    .single();

            } else {
                result = await this.getClient()
                    .from(CONFIG.tables.products)
                    .insert(payload)
                    .select("*")
                    .single();
            }

            if (result.error) {
                throw result.error;
            }

            const product = result.data;

            /* رفع صور المنتج */
            const files = Array.from(
                $("[data-product-images-input]")?.files || []
            );

            try {
                for (let index = 0; index < files.length; index++) {
                    await this.uploadProductImage(
                        files[index],
                        product.id,
                        {
                            isPrimary:
                                !this.getPrimaryImage(product.id) &&
                                index === 0,

                            sortOrder:
                                state.productImages.filter(
                                    image => image.product_id === product.id
                                ).length + 1,

                            altText: product.name
                        }
                    );
                }

            } catch (imageError) {
                try {
                    await this.loadProducts();
                } catch (refreshError) {
                    console.error(
                        "[IBR Admin Store] refresh after image error:",
                        refreshError
                    );
                }

                throw new Error(
                    `تم حفظ بيانات المنتج، لكن تعذر رفع إحدى الصور: ${imageError.message || "خطأ غير معروف"}`
                );
            }

            /* تحديث البيانات بعد الحفظ */
            await this.loadProducts();

            this.notify(
                id
                    ? "تم تحديث المنتج وإعدادات السعر والخصم بنجاح."
                    : "تمت إضافة المنتج وإعدادات السعر والخصم بنجاح.",
                "success"
            );

            this.hideProductEditor();

            return product;
        },

        /* =================================================
           حفظ التصنيف
        ================================================= */

        async saveCategory(form) {
            this.ensureReady();

            const data = new FormData(form);

            const id = String(
                form.querySelector("[data-category-id]")?.value ||
                data.get("id") ||
                ""
            ).trim();

            const name = String(
                data.get("name") || ""
            ).trim();

            if (!name) {
                throw new Error("يرجى إدخال اسم التصنيف.");
            }

            const existing = state.categories.find(
                category => category.id === id
            );

            const sortOrder = Number(data.get("sort_order") || 0);

            if (!Number.isInteger(sortOrder)) {
                throw new Error(
                    "ترتيب التصنيف يجب أن يكون رقماً صحيحاً."
                );
            }

            const payload = {
                name,

                slug:
                    String(data.get("slug") || "").trim() ||
                    existing?.slug ||
                    this.slugify(name),

                description:
                    String(data.get("description") || "").trim() || null,

                sort_order: sortOrder,

                is_active:
                    existing?.is_active ?? true,

                updated_at: new Date().toISOString()
            };

            let result;

            if (id) {
                result = await this.getClient()
                    .from(CONFIG.tables.categories)
                    .update(payload)
                    .eq("id", id)
                    .select("*")
                    .single();

            } else {
                result = await this.getClient()
                    .from(CONFIG.tables.categories)
                    .insert(payload)
                    .select("*")
                    .single();
            }

            if (result.error) {
                throw result.error;
            }

            await this.loadCategories();

            this.renderProducts();

            this.hideCategoryEditor();

            this.notify(
                id
                    ? "تم تحديث التصنيف."
                    : "تمت إضافة التصنيف.",
                "success"
            );

            return result.data;
        },

        /* =================================================
           تفعيل وإيقاف المنتجات
        ================================================= */

        async setProductActive(productId, active) {
            const { error } = await this.getClient()
                .from(CONFIG.tables.products)
                .update({
                    is_active: Boolean(active),
                    updated_at: new Date().toISOString()
                })
                .eq("id", productId);

            if (error) throw error;

            await this.loadProducts();

            this.notify(
                active
                    ? "تم تفعيل المنتج."
                    : "تم إيقاف المنتج.",
                "success"
            );
        },

        /* =================================================
           تفعيل وإيقاف التصنيفات
        ================================================= */

        async setCategoryActive(categoryId, active) {
            const { error } = await this.getClient()
                .from(CONFIG.tables.categories)
                .update({
                    is_active: Boolean(active),
                    updated_at: new Date().toISOString()
                })
                .eq("id", categoryId);

            if (error) throw error;

            await this.loadCategories();

            this.notify("تم تحديث حالة التصنيف.", "success");
        },

        /* =================================================
           رفع الملفات إلى Supabase Storage
        ================================================= */

        async uploadFile(bucket, file, folder) {
            if (
                typeof File === "undefined" ||
                !(file instanceof File)
            ) {
                throw new Error("يرجى اختيار صورة أولاً.");
            }

            if (!file.type.startsWith("image/")) {
                throw new Error("الملف المحدد ليس صورة.");
            }

            if (file.size > CONFIG.limits.fileSize) {
                throw new Error(
                    "حجم الصورة يتجاوز 5 ميجابايت."
                );
            }

            const extension = (
                file.name.split(".").pop() || "jpg"
            ).toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";

            const uniqueId =
                window.crypto?.randomUUID
                    ? window.crypto.randomUUID()
                    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

            const path =
                `${folder}/${Date.now()}-${uniqueId}.${extension}`;

            const { data, error } = await this.getClient()
                .storage
                .from(bucket)
                .upload(path, file, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: file.type
                });

            if (error) throw error;

            const { data: publicData } = this.getClient()
                .storage
                .from(bucket)
                .getPublicUrl(data.path);

            if (!publicData?.publicUrl) {
                throw new Error(
                    "تم رفع الصورة، لكن تعذر الحصول على رابطها العام."
                );
            }

            return {
                bucket,
                path: data.path,
                imageUrl: publicData.publicUrl
            };
        },

        /* =================================================
           رفع صورة المنتج وربطها بجدول product_images
        ================================================= */

        async uploadProductImage(file, productId, options = {}) {
            const uploaded = await this.uploadFile(
                CONFIG.buckets.productImages,
                file,
                `products/${productId}`
            );

            const currentImages = state.productImages.filter(
                image => image.product_id === productId
            );

            const sortOrder = Number(
                options.sortOrder || currentImages.length + 1
            );

            /*
               نحدد الصورة الأساسية قبل الإضافة.
               وبعد كل عملية ناجحة نحدّث state حتى لا تصبح
               جميع الصور المضافة أساسية بالخطأ.
            */
            const shouldBePrimary =
                options.isPrimary === true ||
                currentImages.length === 0;

            const { data, error } = await this.getClient()
                .from(CONFIG.tables.productImages)
                .insert({
                    product_id: productId,
                    image_url: uploaded.imageUrl,
                    alt_text:
                        options.altText || this.getProductName(productId),
                    sort_order: sortOrder,
                    is_primary: false
                })
                .select("*")
                .single();

            if (error) throw error;

            if (shouldBePrimary) {
                const { error: resetError } = await this.getClient()
                    .from(CONFIG.tables.productImages)
                    .update({ is_primary: false })
                    .eq("product_id", productId);

                if (resetError) throw resetError;

                const { error: primaryError } = await this.getClient()
                    .from(CONFIG.tables.productImages)
                    .update({ is_primary: true })
                    .eq("id", data.id)
                    .eq("product_id", productId);

                if (primaryError) throw primaryError;
            }

            /* تحديث الصور محلياً بعد نجاح الإضافة */
            state.productImages = state.productImages.map(image => ({
                ...image,
                is_primary: shouldBePrimary
                    ? false
                    : image.is_primary
            }));

            state.productImages.push({
                ...data,
                is_primary: shouldBePrimary
            });

            return {
                ...uploaded,
                image: {
                    ...data,
                    is_primary: shouldBePrimary
                }
            };
        },

        /* =================================================
           تعيين الصورة الأساسية
        ================================================= */

        async setPrimaryImage(productId, imageId) {
            const targetImage = state.productImages.find(
                image =>
                    image.id === imageId &&
                    image.product_id === productId
            );

            if (!targetImage) {
                throw new Error("الصورة المحددة غير موجودة لهذا المنتج.");
            }

            const { error: resetError } = await this.getClient()
                .from(CONFIG.tables.productImages)
                .update({ is_primary: false })
                .eq("product_id", productId);

            if (resetError) throw resetError;

            const { error } = await this.getClient()
                .from(CONFIG.tables.productImages)
                .update({ is_primary: true })
                .eq("id", imageId)
                .eq("product_id", productId);

            if (error) throw error;

            state.productImages = state.productImages.map(image => ({
                ...image,
                is_primary: image.id === imageId
            }));

            await this.loadProducts();

            this.notify(
                "تم تعيين الصورة الأساسية.",
                "success"
            );
        },

        /* =================================================
           حفظ البنر
        ================================================= */

        async saveBanner() {
            const productId =
                $("[data-banner-product]")?.value || "";

            const file =
                $("[data-banner-upload]")?.files?.[0] || null;

            const description = String(
                $("[data-banner-description]")?.value || ""
            ).trim();

            let imageUrl = "";
            let storagePath = "";

            let altText =
                description || "أثاث IBR الخشبي";

            if (file) {
                const uploaded = await this.uploadFile(
                    CONFIG.buckets.siteMedia,
                    file,
                    "banners"
                );

                imageUrl = uploaded.imageUrl;
                storagePath = uploaded.path;

            } else if (productId) {
                const product = state.products.find(
                    item => item.id === productId
                );

                if (!product) {
                    throw new Error(
                        "تعذر العثور على المنتج المحدد."
                    );
                }

                imageUrl = this.getPrimaryImage(productId);

                if (!imageUrl) {
                    throw new Error(
                        "المنتج المحدد لا يحتوي على صورة."
                    );
                }

                storagePath =
                    `product-image:${product.id}:${imageUrl}`;

                altText = description || product.name;

            } else {
                throw new Error(
                    "اختر صورة أو منتجاً لاستخدامه كبنر."
                );
            }

            const nextOrder = state.banners.reduce(
                (max, item) =>
                    Math.max(max, Number(item.sort_order || 0)),
                0
            ) + 1;

            const { error } = await this.getClient()
                .from(CONFIG.tables.banners)
                .insert({
                    image_url: imageUrl,
                    storage_path: storagePath,
                    alt_text: altText,
                    sort_order: nextOrder,
                    is_active: true,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;

            await this.loadBanners();

            const upload = $("[data-banner-upload]");

            if (upload) {
                upload.value = "";
            }

            const desc = $("[data-banner-description]");

            if (desc) {
                desc.value = "";
            }

            this.feedback(
                "[data-banner-feedback]",
                "تم حفظ البنر بنجاح.",
                "success"
            );
        },

        /* =================================================
           حذف سجل البنر دون حذف ملف التخزين
        ================================================= */

        async deleteBanner(bannerId) {
            const banner = state.banners.find(
                item => item.id === bannerId
            );

            if (!banner) return;

            const { error } = await this.getClient()
                .from(CONFIG.tables.banners)
                .delete()
                .eq("id", bannerId);

            if (error) throw error;

            await this.loadBanners();

            this.notify(
                "تم حذف سجل البنر. لم يتم حذف ملف الصورة من التخزين.",
                "success"
            );
        },

        /* =================================================
           حفظ صورة الصفحة الرئيسية
        ================================================= */

        async saveHomeFeature() {
            const productId =
                $("[data-home-feature-product]")?.value || "";

            const file =
                $("[data-home-feature-upload]")?.files?.[0] || null;

            let imageUrl = "";
            let storagePath = null;
            let sourceType = "upload";

            if (file) {
                const uploaded = await this.uploadFile(
                    CONFIG.buckets.siteMedia,
                    file,
                    "home"
                );

                imageUrl = uploaded.imageUrl;
                storagePath = uploaded.path;
                sourceType = "upload";

            } else if (productId) {
                const product = state.products.find(
                    item => item.id === productId
                );

                if (!product) {
                    throw new Error(
                        "تعذر العثور على المنتج المحدد."
                    );
                }

                imageUrl = this.getPrimaryImage(productId);

                if (!imageUrl) {
                    throw new Error(
                        "المنتج المحدد لا يحتوي على صورة."
                    );
                }

                storagePath =
                    `product-image:${product.id}:${imageUrl}`;

                sourceType = "product";

            } else {
                throw new Error(
                    "اختر صورة أو منتجاً لصورة الرئيسية."
                );
            }

            let updatedBy = null;

            const { data: authData, error: authError } =
                await this.getClient().auth.getUser();

            if (authError) {
                console.warn(
                    "[IBR Admin Store] تعذر قراءة المستخدم الحالي:",
                    authError
                );
            }

            updatedBy = authData?.user?.id || null;

            const { error } = await this.getClient()
                .from(CONFIG.tables.homeFeature)
                .upsert({
                    id: 1,
                    image_url: imageUrl,
                    storage_path: storagePath,
                    source_type: sourceType,
                    updated_at: new Date().toISOString(),
                    updated_by: updatedBy
                }, {
                    onConflict: "id"
                });

            if (error) throw error;

            await this.loadHomeFeature();

            const upload = $("[data-home-feature-upload]");

            if (upload) {
                upload.value = "";
            }

            this.feedback(
                "[data-home-feature-feedback]",
                "تم حفظ صورة الرئيسية بنجاح.",
                "success"
            );
        },

        /* =================================================
           عرض البنرات
        ================================================= */

        renderBanners() {
            const container = $("[data-store-banners]");

            if (!container) return;

            if (!state.banners.length) {
                container.innerHTML = `
                    <p class="admin-empty-state">
                        لا توجد بنرات محفوظة حالياً.
                    </p>
                `;

                return;
            }

            container.innerHTML = state.banners.map(banner => `
                <article class="admin-store-banner-card">

                    <img
                        src="${this.escapeHTML(banner.image_url)}"
                        alt="${this.escapeHTML(banner.alt_text || "بنر IBR")}"
                        loading="lazy">

                    <div>
                        <strong>
                            ${this.escapeHTML(banner.alt_text || "بنر")}
                        </strong>

                        <small>
                            ${banner.is_active ? "نشط" : "غير نشط"}
                        </small>
                    </div>

                    <button
                        type="button"
                        data-banner-delete="${this.escapeHTML(banner.id)}">
                        حذف السجل
                    </button>

                </article>
            `).join("");
        },

        /* =================================================
           عرض صورة الرئيسية الحالية
        ================================================= */

        renderHomeFeature() {
            const preview = $("[data-home-feature-preview]");

            if (!preview) return;

            if (!state.homeFeature?.image_url) {
                preview.innerHTML = `
                    <span>لا توجد صورة محفوظة.</span>
                `;

                return;
            }

            preview.innerHTML = `
                <img
                    src="${this.escapeHTML(state.homeFeature.image_url)}"
                    alt="صورة الرئيسية الحالية">

                <small>
                    المصدر:
                    ${
                        state.homeFeature.source_type === "product"
                            ? "صورة منتج"
                            : "ملف مرفوع"
                    }
                </small>
            `;
        },

        /* =================================================
           المعاينة المباشرة للسعر والخصم
        ================================================= */

        updatePricePreview() {
            const form = $("[data-store-product-form]");
            const preview = $("[data-price-preview]");

            if (!form || !preview) return;

            const getValue = name => {
                const field = form.elements.namedItem(name);
                return field ? field.value : "";
            };

            const getChecked = name => {
                const field = form.elements.namedItem(name);
                return field ? field.checked : false;
            };

            const originalElement = $(
                "[data-preview-original]",
                preview
            );

            const finalElement = $(
                "[data-preview-final]",
                preview
            );

            const savingElement = $(
                "[data-preview-saving]",
                preview
            );

            const statusElement = $(
                "[data-preview-status]",
                preview
            );

            const setText = (element, text) => {
                if (element) {
                    element.textContent = text;
                }
            };

            const priceMode = getValue("price_mode") || "fixed";
            const price = Number(getValue("price"));

            const compareRaw = getValue("compare_at_price");
            const comparePrice = compareRaw === ""
                ? null
                : Number(compareRaw);

            const discountEnabled =
                getChecked("discount_enabled");

            const discountType = getValue("discount_type");
            const discountValue = Number(
                getValue("discount_value")
            );

            if (priceMode === "quote") {
                setText(
                    originalElement,
                    "السعر: عند الاستفسار"
                );

                setText(
                    finalElement,
                    "السعر النهائي: عند الاستفسار"
                );

                setText(
                    savingElement,
                    "قيمة التوفير: غير محددة"
                );

                setText(
                    statusElement,
                    "سيظهر للعميل زر الاستفسار عن السعر."
                );

                return;
            }

            if (!Number.isFinite(price) || price < 0) {
                setText(originalElement, "السعر الأساسي: —");
                setText(finalElement, "السعر النهائي: —");
                setText(savingElement, "قيمة التوفير: —");
                setText(statusElement, "أدخل السعر لمعاينة النتيجة.");
                return;
            }

            const priceLabel = priceMode === "from"
                ? "يبدأ السعر من: "
                : "السعر الأساسي: ";

            setText(
                originalElement,
                `${priceLabel}${this.formatPrice(price)}`
            );

            if (
                comparePrice !== null &&
                Number.isFinite(comparePrice) &&
                comparePrice > 0
            ) {
                setText(
                    originalElement,
                    `${originalElement.textContent} · السعر السابق: ${this.formatPrice(comparePrice)}`
                );
            }

            if (!discountEnabled) {
                setText(
                    finalElement,
                    `السعر النهائي: ${this.formatPrice(price)}`
                );

                setText(
                    savingElement,
                    "قيمة التوفير: 0.00 ر.س"
                );

                if (
                    comparePrice !== null &&
                    Number.isFinite(comparePrice) &&
                    comparePrice <= price
                ) {
                    setText(
                        statusElement,
                        "تنبيه: السعر السابق يجب أن يكون أعلى من السعر الحالي."
                    );
                } else {
                    setText(
                        statusElement,
                        "لا يوجد خصم مفعّل."
                    );
                }

                return;
            }

            if (priceMode === "quote") {
                setText(
                    statusElement,
                    "لا يمكن تفعيل الخصم مع نمط السعر عند الاستفسار."
                );

                return;
            }

            if (
                !Number.isFinite(discountValue) ||
                discountValue <= 0
            ) {
                setText(finalElement, "السعر النهائي: —");
                setText(savingElement, "قيمة التوفير: —");
                setText(
                    statusElement,
                    "أدخل قيمة الخصم لمعاينة السعر."
                );

                return;
            }

            if (
                discountType === "percentage" &&
                discountValue > 100
            ) {
                setText(finalElement, "السعر النهائي: —");
                setText(savingElement, "قيمة التوفير: —");
                setText(
                    statusElement,
                    "نسبة الخصم لا يمكن أن تتجاوز 100%."
                );

                return;
            }

            if (!["percentage", "fixed"].includes(discountType)) {
                setText(finalElement, "السعر النهائي: —");
                setText(savingElement, "قيمة التوفير: —");
                setText(statusElement, "اختر نوع الخصم.");

                return;
            }

            const saving = discountType === "percentage"
                ? price * discountValue / 100
                : discountValue;

            const roundedSaving = Number(saving.toFixed(2));

            const finalPrice = Number(
                (price - roundedSaving).toFixed(2)
            );

            if (finalPrice <= 0) {
                setText(finalElement, "السعر النهائي: —");
                setText(savingElement, "قيمة التوفير: —");

                setText(
                    statusElement,
                    "قيمة الخصم يجب أن تكون أقل من السعر الأساسي."
                );

                return;
            }

            setText(
                finalElement,
                `السعر بعد الخصم: ${this.formatPrice(finalPrice)}`
            );

            setText(
                savingElement,
                `قيمة التوفير: ${this.formatPrice(roundedSaving)}`
            );

            /* التحقق من السعر السابق */
            if (
                comparePrice !== null &&
                Number.isFinite(comparePrice) &&
                comparePrice <= finalPrice
            ) {
                setText(
                    statusElement,
                    "تنبيه: السعر السابق يجب أن يكون أعلى من السعر النهائي بعد الخصم."
                );

                return;
            }

            /* حالة العرض حسب التواريخ */
            const startRaw = getValue("discount_starts_at");
            const endRaw = getValue("discount_ends_at");

            const now = new Date();

            const start = startRaw
                ? new Date(startRaw)
                : null;

            const end = endRaw
                ? new Date(endRaw)
                : null;

            if (start && Number.isNaN(start.getTime())) {
                setText(
                    statusElement,
                    "تاريخ بداية العرض غير صحيح."
                );

                return;
            }

            if (end && Number.isNaN(end.getTime())) {
                setText(
                    statusElement,
                    "تاريخ نهاية العرض غير صحيح."
                );

                return;
            }

            if (start && end && end <= start) {
                setText(
                    statusElement,
                    "نهاية العرض يجب أن تكون بعد بدايته."
                );

                return;
            }

            if (start && now < start) {
                setText(
                    statusElement,
                    "الخصم محفوظ وسيبدأ في الموعد المحدد."
                );

            } else if (end && now >= end) {
                setText(
                    statusElement,
                    "انتهى موعد العرض؛ لن يكون الخصم صالحاً حالياً."
                );

            } else {
                setText(
                    statusElement,
                    "الخصم مفعّل وصالح حسب المواعيد المحددة."
                );
            }
        },

        /* =================================================
           معاينة الصور المختارة
        ================================================= */

        renderSelectedImagePreviews(files, preview) {
            if (!preview) return;

            preview.innerHTML = "";

            Array.from(files || []).forEach(file => {
                if (!file.type.startsWith("image/")) {
                    return;
                }

                const url = URL.createObjectURL(file);

                const wrapper = document.createElement("div");
                wrapper.className = "admin-store-image-preview";

                const image = document.createElement("img");
                image.src = url;
                image.alt = file.name;

                const label = document.createElement("small");
                label.textContent = file.name;

                wrapper.append(image, label);
                preview.appendChild(wrapper);

                image.addEventListener("load", () => {
                    URL.revokeObjectURL(url);
                }, { once: true });

                image.addEventListener("error", () => {
                    URL.revokeObjectURL(url);
                }, { once: true });
            });
        },

        /* =================================================
           ربط أحداث الصفحة
        ================================================= */

        bindEvents() {
            if (state.eventsBound) return;

            state.eventsBound = true;

            /* البحث */
            document.addEventListener("input", event => {

                if (
                    event.target.matches(
                        "[data-store-product-search]"
                    )
                ) {
                    this.renderProducts();
                    return;
                }

                /* تحديث معاينة السعر مباشرة */
                if (
                    event.target.closest(
                        "[data-store-product-form]"
                    ) &&
                    event.target.matches(
                        '[name="price"], ' +
                        '[name="compare_at_price"], ' +
                        '[name="discount_value"]'
                    )
                ) {
                    this.updatePricePreview();
                }
            });

            /* التصفية ومعاينة الصور والخصم */
            document.addEventListener("change", event => {

                /* تصفية المنتجات */
                if (
                    event.target.matches(
                        "[data-store-category-filter]"
                    ) ||
                    event.target.matches(
                        "[data-store-status-filter]"
                    )
                ) {
                    this.renderProducts();
                }

                /* معاينة صور المنتج */
                if (
                    event.target.matches(
                        "[data-product-images-input]"
                    )
                ) {
                    const preview = $(
                        "[data-product-images-preview]"
                    );

                    this.renderSelectedImagePreviews(
                        event.target.files,
                        preview
                    );
                }

                /* تفعيل وإخفاء حقول الخصم */
                if (
                    event.target.matches(
                        "[data-product-discount-enabled]"
                    )
                ) {
                    const fields = $("[data-discount-fields]");

                    if (fields) {
                        fields.hidden = !event.target.checked;
                    }

                    this.updatePricePreview();
                }

                /* تحديث المعاينة عند تغيير إعداد سعري */
                if (
                    event.target.closest(
                        "[data-store-product-form]"
                    ) &&
                    event.target.matches(
                        '[name="price_mode"], ' +
                        '[name="discount_type"], ' +
                        '[name="discount_badge"], ' +
                        '[name="discount_starts_at"], ' +
                        '[name="discount_ends_at"], ' +
                        '[name="price"], ' +
                        '[name="compare_at_price"], ' +
                        '[name="discount_value"]'
                    )
                ) {
                    this.updatePricePreview();
                }
            });

            /* حفظ النماذج */
            document.addEventListener("submit", async event => {

                if (
                    event.target.matches(
                        "[data-store-product-form]"
                    )
                ) {
                    event.preventDefault();

                    const button = event.target.querySelector(
                        '[type="submit"]'
                    );

                    if (button) {
                        button.disabled = true;
                    }

                    this.feedback(
                        "[data-product-form-feedback]",
                        "جارٍ حفظ بيانات المنتج...",
                        "info"
                    );

                    try {
                        await this.saveProduct(event.target);

                        this.feedback(
                            "[data-product-form-feedback]",
                            ""
                        );

                    } catch (error) {
                        console.error(error);

                        this.feedback(
                            "[data-product-form-feedback]",
                            error.message || "تعذر حفظ المنتج.",
                            "error"
                        );

                    } finally {
                        if (button) {
                            button.disabled = false;
                        }
                    }
                }

                if (
                    event.target.matches(
                        "[data-category-form]"
                    )
                ) {
                    event.preventDefault();

                    const button = event.target.querySelector(
                        '[type="submit"]'
                    );

                    if (button) {
                        button.disabled = true;
                    }

                    this.feedback(
                        "[data-category-feedback]",
                        "جارٍ حفظ التصنيف...",
                        "info"
                    );

                    try {
                        await this.saveCategory(event.target);

                        this.feedback(
                            "[data-category-feedback]",
                            ""
                        );

                    } catch (error) {
                        console.error(error);

                        this.feedback(
                            "[data-category-feedback]",
                            error.message || "تعذر حفظ التصنيف.",
                            "error"
                        );

                    } finally {
                        if (button) {
                            button.disabled = false;
                        }
                    }
                }
            });

            /* الأزرار */
            document.addEventListener("click", async event => {

                const target = event.target;

                /* إضافة منتج */
                if (target.closest("[data-product-add]")) {
                    this.showProductEditor();
                    return;
                }

                /* إضافة تصنيف */
                if (target.closest("[data-category-add]")) {
                    this.showCategoryEditor();
                    return;
                }

                /* إغلاق محرر التصنيف */
                if (target.closest("[data-category-editor-close]")) {
                    this.hideCategoryEditor();
                    return;
                }

                /* إغلاق محرر المنتج */
                if (target.closest("[data-product-editor-close]")) {
                    this.hideProductEditor();
                    return;
                }

                /* تعديل منتج */
                const editProduct = target.closest(
                    "[data-product-edit]"
                );

                if (editProduct) {
                    const product = state.products.find(
                        item =>
                            item.id === editProduct.dataset.productEdit
                    );

                    if (product) {
                        this.showProductEditor(product);
                    }

                    return;
                }

                /* تعديل تصنيف */
                const editCategory = target.closest(
                    "[data-category-edit]"
                );

                if (editCategory) {
                    const category = state.categories.find(
                        item =>
                            item.id === editCategory.dataset.categoryEdit
                    );

                    if (category) {
                        this.showCategoryEditor(category);
                    }

                    return;
                }

                /* تفعيل وإيقاف منتج */
                const toggleProduct = target.closest(
                    "[data-product-toggle]"
                );

                if (toggleProduct) {
                    const active =
                        toggleProduct.dataset.active === "1";

                    if (
                        window.confirm(
                            active
                                ? "هل تريد إيقاف هذا المنتج؟"
                                : "هل تريد تفعيل هذا المنتج؟"
                        )
                    ) {
                        try {
                            await this.setProductActive(
                                toggleProduct.dataset.productToggle,
                                !active
                            );

                        } catch (error) {
                            this.notify(
                                error.message || "تعذر تحديث حالة المنتج.",
                                "error"
                            );
                        }
                    }

                    return;
                }

                /* تفعيل وإيقاف تصنيف */
                const toggleCategory = target.closest(
                    "[data-category-toggle]"
                );

                if (toggleCategory) {
                    const active =
                        toggleCategory.dataset.active === "1";

                    try {
                        await this.setCategoryActive(
                            toggleCategory.dataset.categoryToggle,
                            !active
                        );

                    } catch (error) {
                        this.notify(
                            error.message || "تعذر تحديث حالة التصنيف.",
                            "error"
                        );
                    }

                    return;
                }

                /* تعيين الصورة الأساسية */
                const primaryImage = target.closest(
                    "[data-image-primary]"
                );

                if (primaryImage) {
                    try {
                        await this.setPrimaryImage(
                            primaryImage.dataset.productId,
                            primaryImage.dataset.imagePrimary
                        );

                        const product = state.products.find(
                            item =>
                                item.id === primaryImage.dataset.productId
                        );

                        if (product) {
                            this.showProductEditor(product);
                        }

                    } catch (error) {
                        this.notify(
                            error.message || "تعذر تغيير الصورة الأساسية.",
                            "error"
                        );
                    }

                    return;
                }

                /* حذف سجل البنر */
                const deleteBannerButton = target.closest(
                    "[data-banner-delete]"
                );

                if (deleteBannerButton) {
                    if (
                        window.confirm(
                            "هل تريد حذف سجل هذا البنر؟ لن يتم حذف ملف الصورة من التخزين."
                        )
                    ) {
                        try {
                            await this.deleteBanner(
                                deleteBannerButton.dataset.bannerDelete
                            );

                        } catch (error) {
                            this.notify(
                                error.message || "تعذر حذف البنر.",
                                "error"
                            );
                        }
                    }

                    return;
                }

                /* حفظ البنر */
                const bannerSaveButton = target.closest(
                    "[data-banner-save]"
                );

                if (bannerSaveButton) {
                    bannerSaveButton.disabled = true;

                    this.feedback(
                        "[data-banner-feedback]",
                        "جارٍ حفظ البنر...",
                        "info"
                    );

                    try {
                        await this.saveBanner();

                    } catch (error) {
                        console.error(error);

                        this.feedback(
                            "[data-banner-feedback]",
                            error.message || "تعذر حفظ البنر.",
                            "error"
                        );

                    } finally {
                        bannerSaveButton.disabled = false;
                    }

                    return;
                }

                /* حفظ صورة الرئيسية */
                const homeFeatureSaveButton = target.closest(
                    "[data-home-feature-save]"
                );

                if (homeFeatureSaveButton) {
                    homeFeatureSaveButton.disabled = true;

                    this.feedback(
                        "[data-home-feature-feedback]",
                        "جارٍ حفظ صورة الرئيسية...",
                        "info"
                    );

                    try {
                        await this.saveHomeFeature();

                    } catch (error) {
                        console.error(error);

                        this.feedback(
                            "[data-home-feature-feedback]",
                            error.message || "تعذر حفظ صورة الرئيسية.",
                            "error"
                        );

                    } finally {
                        homeFeatureSaveButton.disabled = false;
                    }
                }
            });
        }
    };

    /* =====================================================
       إتاحة API العامة
    ===================================================== */

    window.IBRAdminStore = api;

    /* =====================================================
       التشغيل التلقائي بعد تحميل الصفحة
    ===================================================== */

    const start = () => {
        if (window.IBRAdminStore && !state.initialized) {
            api.init().catch(error => {
                console.error(
                    "[IBR Admin Store] initialization:",
                    error
                );

                api.notify(
                    error.message || "تعذر تشغيل إدارة المتجر.",
                    "error"
                );
            });
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            start,
            { once: true }
        );
    } else {
        start();
    }

})();
