
/* =========================================================
   IBR20 WISHLIST
   Version: 2.0.0
   Local-first wishlist management
   Multiple lists / Compare / Alerts / Share / Bulk actions
========================================================= */

(() => {
    "use strict";

    if (window.IBRWishlist) return;

    const STORAGE_KEY = "ibr20_wishlist_v2";
    const LEGACY_KEYS = ["ibr20_wishlist_v1", "ibr-favorites"];
    const RECENT_KEY = "ibr20_recent_views";
    const CART_KEY = "ibr-cart";
    const MAX_COMPARE = 4;
    const MAX_LISTS = 30;
    const MAX_SHARED_ITEMS = 100;

    const $ = (id) => document.getElementById(id);

    const state = {
        data: null,
        products: [],
        filter: "all",
        search: "",
        sort: "newest",
        selected: new Set(),
        compare: new Set(),
        activeListId: "default",
        dialogAction: null,
        toastTimer: null,
        initialized: false
    };

    const safeParse = (value, fallback = null) => {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    };

    const uid = () => {
        if (window.crypto && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }

        return "wl-" + Date.now().toString(36) +
            Math.random().toString(36).slice(2, 9);
    };

    const cleanText = (value, max = 500) =>
        String(value ?? "").trim().slice(0, max);

    const escapeHTML = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);

    const validImage = (value) => {
        const url = cleanText(value, 2000);

        if (!url) return "";

        if (/^(https?:\/\/|\/)/i.test(url)) return url;

        return "";
    };

    const numberValue = (value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    };

    const formatMoney = (value) => {
        const amount = numberValue(value);

        try {
            return new Intl.NumberFormat("ar-SA", {
                style: "currency",
                currency: "SAR",
                maximumFractionDigits: 2
            }).format(amount);
        } catch {
            return amount.toFixed(2) + " ر.س";
        }
    };

    const toast = (message) => {
        const element = $("wlToast");
        if (!element) return;

        element.textContent = message;
        element.classList.add("is-visible");

        clearTimeout(state.toastTimer);

        state.toastTimer = setTimeout(() => {
            element.classList.remove("is-visible");
        }, 2600);
    };

    const defaultData = () => ({
        version: 2,
        lists: [{
            id: "default",
            name: "قائمتي المفضلة",
            description: "المنتجات التي اخترتها بعناية",
            createdAt: Date.now(),
            items: []
        }],
        alerts: {},
        compare: []
    });

    function normalizeSnapshot(product) {
        if (!product || !product.id) return null;

        const images = Array.isArray(product.product_images)
            ? product.product_images
            : Array.isArray(product.images)
                ? product.images
                : [];

        const sortedImages = [...images].sort((a, b) => {
            if (a.is_primary !== b.is_primary) {
                return a.is_primary ? -1 : 1;
            }

            return numberValue(a.sort_order) - numberValue(b.sort_order);
        });

        const primaryImage = sortedImages.find(image => image.image_url);

        const category = product.categories?.name ||
            product.category?.name ||
            product.category_name ||
            "";

        return {
            id: String(product.id),
            name: cleanText(product.name || "منتج محفوظ سابقًا", 200),
            slug: cleanText(product.slug, 200),
            sku: cleanText(product.sku, 100),
            description: cleanText(product.description, 1500),
            price: numberValue(product.price),
            compare_at_price: numberValue(product.compare_at_price),
            category: cleanText(category, 150),
            image: validImage(
                product.image ||
                product.image_url ||
                primaryImage?.image_url ||
                sortedImages[0]?.image_url
            ),
            images: sortedImages
                .map(image => validImage(image.image_url))
                .filter(Boolean)
                .slice(0, 12),
            is_active: product.is_active !== false,
            is_available: product.is_available !== false &&
                numberValue(product.inventory_quantity) !== 0,
            inventory_quantity: numberValue(product.inventory_quantity),
            savedAt: Date.now()
        };
    }

    function normalizeData(raw) {
        const base = defaultData();

        if (!raw || typeof raw !== "object") return base;

        if (Array.isArray(raw.lists)) {
            base.lists = raw.lists
                .slice(0, MAX_LISTS)
                .map(list => ({
                    id: cleanText(list.id || uid(), 100),
                    name: cleanText(list.name || "قائمة جديدة", 80),
                    description: cleanText(list.description, 200),
                    createdAt: numberValue(list.createdAt) || Date.now(),
                    items: Array.isArray(list.items)
                        ? list.items.map(item => ({
                            ...normalizeSnapshot(item),
                            savedAt: numberValue(item.savedAt) || Date.now()
                        })).filter(Boolean).slice(0, 500)
                        : []
                }));
        }

        if (!base.lists.length) {
            base.lists = defaultData().lists;
        }

        if (!base.lists.some(list => list.id === "default")) {
            base.lists.unshift(defaultData().lists[0]);
        }

        base.alerts = raw.alerts && typeof raw.alerts === "object"
            ? raw.alerts
            : {};

        base.compare = Array.isArray(raw.compare)
            ? raw.compare.map(String).slice(0, MAX_COMPARE)
            : [];

        return base;
    }

    function migrateLegacy() {
        let legacy = [];

        for (const key of LEGACY_KEYS) {
            const value = safeParse(localStorage.getItem(key), null);
            if (!value) continue;

            if (Array.isArray(value)) {
                legacy = legacy.concat(value);
            } else if (Array.isArray(value.items)) {
                legacy = legacy.concat(value.items);
            }
        }

        if (!legacy.length) return;

        const defaultList = state.data.lists.find(
            list => list.id === "default"
        );

        legacy.forEach(item => {
            const id = typeof item === "object"
                ? item.id || item.product_id
                : item;

            if (!id) return;

            const exists = defaultList.items.some(
                saved => saved.id === String(id)
            );

            if (exists) return;

            const cached = state.products.find(
                product => String(product.id) === String(id)
            );

            const snapshot = cached
                ? normalizeSnapshot(cached)
                : normalizeSnapshot({
                    id: String(id),
                    name: "منتج محفوظ سابقًا",
                    price: 0,
                    is_available: false,
                    is_active: false
                });

            if (snapshot) defaultList.items.push(snapshot);
        });
    }

    function loadData() {
        const raw = safeParse(localStorage.getItem(STORAGE_KEY), null);
        state.data = normalizeData(raw);
    }

    function persist() {
        try {
            state.data.version = 2;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
            updateCounters();
            window.dispatchEvent(new CustomEvent("ibr:wishlist-updated", {
                detail: {
                    count: count(),
                    listId: state.activeListId
                }
            }));
        } catch (error) {
            console.error("IBR wishlist storage error:", error);
            toast("تعذر حفظ التغييرات. مساحة التخزين قد تكون ممتلئة.");
        }
    }

    function getActiveList() {
        return state.data.lists.find(
            list => list.id === state.activeListId
        ) || state.data.lists[0];
    }

    function findSaved(productId, listId = null) {
        const id = String(productId);

        const lists = listId
            ? state.data.lists.filter(list => list.id === listId)
            : state.data.lists;

        for (const list of lists) {
            const item = list.items.find(saved => saved.id === id);

            if (item) return { list, item };
        }

        return null;
    }

    function count() {
        return state.data.lists.reduce(
            (total, list) => total + list.items.length,
            0
        );
    }

    function isSaved(productId) {
        return Boolean(findSaved(productId));
    }

    function listCount() {
        return state.data.lists.length;
    }

    function getProduct(productId) {
        return state.products.find(
            product => String(product.id) === String(productId)
        ) || null;
    }

    function updateCounters() {
        const total = count();
        const listTotal = listCount();
        const compareTotal = state.data.compare.length;

        if ($("wlTotalCount")) $("wlTotalCount").textContent = total;
        if ($("wlListCount")) $("wlListCount").textContent = listTotal;
        if ($("wlCompareCount")) $("wlCompareCount").textContent = compareTotal;
        if ($("wlCompareButtonCount")) {
            $("wlCompareButtonCount").textContent = compareTotal;
        }

        if ($("wlCartCount")) {
            let cartCount = 0;

            try {
                const cart = safeParse(localStorage.getItem(CART_KEY), []);
                if (Array.isArray(cart)) {
                    cartCount = cart.reduce(
                        (sum, item) => sum + numberValue(item.quantity || 1),
                        0
                    );
                }
            } catch {}

            $("wlCartCount").textContent = cartCount;
        }
    }

    function addProduct(product, listId = state.activeListId) {
        const snapshot = normalizeSnapshot(product);

        if (!snapshot) {
            toast("تعذر حفظ المنتج.");
            return false;
        }

        const list = state.data.lists.find(item => item.id === listId);

        if (!list) return false;

        if (list.items.some(item => item.id === snapshot.id)) {
            toast("المنتج موجود بالفعل في هذه القائمة.");
            return false;
        }

        snapshot.savedAt = Date.now();
        list.items.unshift(snapshot);

        persist();
        render();

        toast("تمت إضافة المنتج إلى المحفوظات.");
        return true;
    }

    function removeProduct(productId, listId = state.activeListId) {
        const list = state.data.lists.find(item => item.id === listId);
        if (!list) return false;

        const before = list.items.length;

        list.items = list.items.filter(
            item => item.id !== String(productId)
        );

        if (before === list.items.length) return false;

        const stillSaved = findSaved(productId);

        if (!stillSaved) {
            delete state.data.alerts[String(productId)];
            state.data.compare = state.data.compare.filter(
                id => id !== String(productId)
            );
        }

        state.selected.delete(String(productId));

        persist();
        render();

        toast("تم حذف المنتج من القائمة.");
        return true;
    }

    function toggle(product) {
        const id = String(product?.id || "");
        if (!id) return false;

        const existing = findSaved(id, state.activeListId);

        if (existing) {
            removeProduct(id, state.activeListId);
            return false;
        }

        addProduct(product);
        return true;
    }

    async function loadProducts() {
        let products = [];

        const client = window.supabaseClient ||
            window.supabase ||
            null;

        if (client && typeof client.from === "function") {
            try {
                const { data, error } = await client
                    .from("products")
                    .select(`
                        id,
                        name,
                        slug,
                        sku,
                        price,
                        compare_at_price,
                        description,
                        is_active,
                        is_available,
                        inventory_quantity,
                        categories(name),
                        product_images(
                            id,
                            image_url,
                            alt_text,
                            sort_order,
                            is_primary
                        )
                    `)
                    .eq("is_active", true)
                    .eq("is_available", true)
                    .order("created_at", { ascending: false });

                if (!error && Array.isArray(data)) {
                    products = data;
                }
            } catch (error) {
                console.warn("Wishlist products query:", error);
            }
        }

        if (!products.length) {
            const cached = safeParse(
                localStorage.getItem("ibr-products"),
                []
            );

            if (Array.isArray(cached)) {
                products = cached;
            } else if (Array.isArray(window.IBR?.products)) {
                products = window.IBR.products;
            }
        }

        state.products = products
            .map(normalizeSnapshot)
            .filter(Boolean);

        refreshSnapshots();
    }

    function refreshSnapshots() {
        let changed = false;

        state.data.lists.forEach(list => {
            list.items.forEach(saved => {
                const current = getProduct(saved.id);

                if (!current) return;

                saved.name = current.name || saved.name;
                saved.slug = current.slug || saved.slug;
                saved.description = current.description || saved.description;
                saved.price = current.price;
                saved.compare_at_price = current.compare_at_price;
                saved.category = current.category || saved.category;

                if (current.image) saved.image = current.image;
                if (current.images.length) saved.images = current.images;

                saved.is_active = current.is_active;
                saved.is_available = current.is_available;
                saved.inventory_quantity = current.inventory_quantity;

                changed = true;
            });
        });

        if (changed) persist();
    }

    function filteredItems() {
        const list = getActiveList();
        if (!list) return [];

        let items = [...list.items];

        if (state.filter === "available") {
            items = items.filter(item =>
                item.is_active && item.is_available
            );
        }

        if (state.filter === "unavailable") {
            items = items.filter(item =>
                !item.is_active || !item.is_available
            );
        }

        if (state.filter === "discount") {
            items = items.filter(item =>
                item.compare_at_price > item.price && item.price > 0
            );
        }

        if (state.search) {
            const query = state.search.toLowerCase();

            items = items.filter(item =>
                [
                    item.name,
                    item.category,
                    item.description,
                    item.sku
                ].join(" ").toLowerCase().includes(query)
            );
        }

        switch (state.sort) {
            case "name":
                items.sort((a, b) => a.name.localeCompare(b.name, "ar"));
                break;

            case "price-low":
                items.sort((a, b) => a.price - b.price);
                break;

            case "price-high":
                items.sort((a, b) => b.price - a.price);
                break;

            case "discount":
                items.sort((a, b) => {
                    const da = a.compare_at_price - a.price;
                    const db = b.compare_at_price - b.price;
                    return db - da;
                });
                break;

            default:
                items.sort((a, b) => b.savedAt - a.savedAt);
        }

        return items;
    }

    function productCard(product, options = {}) {
        const id = escapeHTML(product.id);
        const image = validImage(product.image);
        const available = product.is_active && product.is_available;
        const hasDiscount =
            product.compare_at_price > product.price &&
            product.price > 0;

        const selected = state.selected.has(String(product.id));
        const compareSelected = state.data.compare.includes(String(product.id));

        const productUrl = product.slug
            ? "product.html?slug=" + encodeURIComponent(product.slug)
            : "product.html?id=" + encodeURIComponent(product.id);

        return `
            <article class="wl-product-card" data-product-id="${id}">
                
                <div class="wl-product-image-wrap">
                    <a class="wl-image-link"
                      href="${productUrl}"
                      aria-label="عرض تفاصيل ${escapeHTML(product.name)}">

                     ${
                      image
                 ?     `<img class="wl-product-image"
                       src="${escapeHTML(image)}"
                       alt="${escapeHTML(product.name)}"
                       loading="lazy">`
                     : `<div class="wl-no-image">الصورة غير متاحة</div>`
                      }

                    </a>

                    ${
                        options.selectable !== false
                            ? `<label class="wl-card-check">
                                   <input type="checkbox"
                                          data-action="select"
                                          data-id="${id}"
                                          ${selected ? "checked" : ""}>
                               </label>`
                            : ""
                    }

                    ${
                        options.showHeart !== false
                            ? `<button class="wl-heart"
                                       type="button"
                                       data-action="remove"
                                       data-id="${id}"
                                       aria-label="إزالة من المحفوظات">♥</button>`
                            : ""
                    }
                </div>

                <div class="wl-card-body">
                    <p class="wl-product-category">
                        ${escapeHTML(product.category || "أثاث خشبي")}
                    </p>

                    <a class="wl-product-link" href="${productUrl}">
                        <h3 class="wl-product-name">
                            ${escapeHTML(product.name)}
                        </h3>
                    </a>

                    <div class="wl-product-price">
                        ${formatMoney(product.price)}
                        ${
                            hasDiscount
                                ? `<span class="wl-old-price">
                                       ${formatMoney(product.compare_at_price)}
                                   </span>`
                                : ""
                        }
                    </div>

                    <p class="wl-stock ${available ? "available" : "unavailable"}">
                        ${available ? "متوفر حاليًا" : "غير متوفر حاليًا"}
                    </p>

                    <div class="wl-card-actions">
                        ${
                            available
                                ? `<button class="wl-btn wl-btn-primary"
                                           type="button"
                                           data-action="cart"
                                           data-id="${id}">
                                       أضف للسلة
                                   </button>`
                                : `<button class="wl-btn wl-btn-soft"
                                           type="button"
                                           disabled>
                                       غير متوفر
                                   </button>`
                        }

                        <button class="wl-btn wl-btn-outline"
                                type="button"
                                data-action="compare"
                                data-id="${id}">
                            ${compareSelected ? "إلغاء المقارنة" : "قارن"}
                        </button>
                    </div>

                    <div class="wl-card-more">
                        <button type="button"
                                data-action="alert"
                                data-id="${id}">
                            ${state.data.alerts[id] ? "إلغاء التنبيه" : "تنبيه السعر والتوفر"}
                        </button>

                        <button type="button"
                                data-action="move"
                                data-id="${id}">
                            نقل للقائمة
                        </button>
                    </div>
                </div>
            </article>
        `;
    }

    function render() {
        renderListSelect();
        renderProducts();
        renderAlerts();
        renderRecent();
        renderRecommendations();
        renderBulkBar();
        updateCounters();
    }

    function renderListSelect() {
        const select = $("wlListSelect");
        if (!select) return;

        select.innerHTML = state.data.lists.map(list => `
            <option value="${escapeHTML(list.id)}"
                ${list.id === state.activeListId ? "selected" : ""}>
                ${escapeHTML(list.name)} (${list.items.length})
            </option>
        `).join("");

        const active = getActiveList();

        if ($("wlCurrentListTitle")) {
            $("wlCurrentListTitle").textContent = active.name;
        }

        if ($("wlCurrentListDescription")) {
            $("wlCurrentListDescription").textContent =
                active.description || "المنتجات التي اخترتها بعناية";
        }

        const canDelete = active.id !== "default";

        if ($("wlDeleteListBtn")) {
            $("wlDeleteListBtn").disabled = !canDelete;
        }

        if ($("wlRenameListBtn")) {
            $("wlRenameListBtn").disabled = !canDelete;
        }
    }

    function renderProducts() {
        const container = $("wlProducts");
        const empty = $("wlEmpty");

        if (!container || !empty) return;

        const items = filteredItems();

        container.innerHTML = items.map(item => productCard(item)).join("");

        empty.hidden = items.length !== 0;

        if ($("wlStatus")) {
            $("wlStatus").textContent =
                items.length ? `عدد المنتجات المعروضة: ${items.length}` : "";
        }
    }

    function renderBulkBar() {
        const bar = $("wlBulkBar");
        if (!bar) return;

        const selectedCount = state.selected.size;
        bar.hidden = selectedCount === 0;

        if ($("wlSelectedCount")) {
            $("wlSelectedCount").textContent = selectedCount;
        }

        const visible = filteredItems();
        const allSelected = visible.length > 0 &&
            visible.every(item => state.selected.has(item.id));

        if ($("wlSelectAll")) {
            $("wlSelectAll").checked = allSelected;
        }
    }

    function renderAlerts() {
        const container = $("wlAlerts");
        if (!container) return;

        const entries = Object.entries(state.data.alerts);

        if (!entries.length) {
            container.innerHTML = `
                <p class="wl-muted">لم تقم بإعداد أي تنبيهات بعد.</p>
            `;
            return;
        }

        container.innerHTML = entries.map(([id, alert]) => {
            const product = findSaved(id)?.item ||
                getProduct(id) || {
                    id,
                    name: "منتج محفوظ"
                };

            return `
                <div class="wl-alert-row">
                    <label>
                        <input type="checkbox"
                               data-action="alert-toggle"
                               data-id="${escapeHTML(id)}"
                               checked>
                        <span>${escapeHTML(product.name)}</span>
                    </label>
                    <span class="wl-muted">
                        ${alert.price ? "تنبيه السعر" : ""}
                        ${alert.availability ? " • تنبيه التوفر" : ""}
                    </span>
                </div>
            `;
        }).join("");
    }

    function getRecentProducts() {
        if (window.IBR && typeof window.IBR.getRecentViews === "function") {
            try {
                const result = window.IBR.getRecentViews(8);
                if (Array.isArray(result)) return result;
            } catch {}
        }

        const recent = safeParse(
            localStorage.getItem(RECENT_KEY),
            []
        );

        if (!Array.isArray(recent)) return [];

        return recent.map(item => {
            if (typeof item === "string") return getProduct(item);
            return item;
        }).filter(Boolean);
    }

    function renderRecent() {
        const container = $("wlRecent");
        if (!container) return;

        const items = getRecentProducts().slice(0, 8);

        if (!items.length) {
            container.innerHTML =
                '<p class="wl-muted">ستظهر هنا المنتجات التي تشاهدها.</p>';
            return;
        }

        container.innerHTML = items.map(item => {
            const product = normalizeSnapshot(item);
            if (!product) return "";

            const url = product.slug
                ? "product.html?slug=" + encodeURIComponent(product.slug)
                : "product.html?id=" + encodeURIComponent(product.id);

            return `
                <a class="wl-mini-item" href="${url}">
                    ${
                        product.image
                            ? `<img src="${escapeHTML(product.image)}"
                                   alt="${escapeHTML(product.name)}"
                                   loading="lazy">`
                            : `<span class="wl-no-image">لا توجد صورة</span>`
                    }
                    <span>${escapeHTML(product.name)}</span>
                </a>
            `;
        }).join("");
    }

    function renderRecommendations() {
        const container = $("wlRecommendations");
        if (!container) return;

        const savedIds = new Set(
            state.data.lists.flatMap(list =>
                list.items.map(item => item.id)
            )
        );

        let recommendations = state.products.filter(product =>
            product.is_active &&
            product.is_available &&
            !savedIds.has(product.id)
        );

        const savedCategories = state.data.lists
            .flatMap(list => list.items)
            .map(item => item.category)
            .filter(Boolean);

        if (savedCategories.length) {
            recommendations.sort((a, b) => {
                const aMatch = savedCategories.includes(a.category) ? 1 : 0;
                const bMatch = savedCategories.includes(b.category) ? 1 : 0;
                return bMatch - aMatch;
            });
        }

        recommendations = recommendations.slice(0, 4);

        container.innerHTML = recommendations.length
            ? recommendations.map(item =>
                productCard(item, {
                    selectable: false,
                    showHeart: false
                })
            ).join("")
            : '<p class="wl-muted">لا توجد اقتراحات إضافية حاليًا.</p>';
    }

    function openDialog(title, body, action) {
        const dialog = $("wlDialog");
        if (!dialog) return;

        $("wlDialogTitle").textContent = title;
        $("wlDialogBody").innerHTML = body;
        state.dialogAction = action;

        if (typeof dialog.showModal === "function") {
            dialog.showModal();
        } else {
            dialog.setAttribute("open", "");
        }

        const input = dialog.querySelector("input, select");
        if (input) input.focus();
    }

    function closeDialog() {
        const dialog = $("wlDialog");
        if (!dialog) return;

        if (typeof dialog.close === "function") {
            dialog.close();
        } else {
            dialog.removeAttribute("open");
        }

        state.dialogAction = null;
    }

    function createList() {
        if (state.data.lists.length >= MAX_LISTS) {
            toast("وصلت إلى الحد الأقصى للقوائم.");
            return;
        }

        openDialog(
            "إنشاء قائمة جديدة",
            `
                <label for="wlListName">اسم القائمة</label>
                <input id="wlListName" maxlength="80"
                       placeholder="مثال: أثاث غرفة المعيشة" required>

                <label for="wlListDescription">وصف القائمة (اختياري)</label>
                <input id="wlListDescription" maxlength="200"
                       placeholder="وصف مختصر">
            `,
            () => {
                const name = cleanText($("wlListName")?.value, 80);
                const description = cleanText(
                    $("wlListDescription")?.value,
                    200
                );

                if (!name) {
                    toast("اكتب اسم القائمة.");
                    return false;
                }

                const list = {
                    id: uid(),
                    name,
                    description,
                    createdAt: Date.now(),
                    items: []
                };

                state.data.lists.push(list);
                state.activeListId = list.id;

                persist();
                render();

                toast("تم إنشاء القائمة.");
                return true;
            }
        );
    }

    function renameList() {
        const list = getActiveList();

        if (!list || list.id === "default") {
            toast("لا يمكن إعادة تسمية القائمة الافتراضية.");
            return;
        }

        openDialog(
            "إعادة تسمية القائمة",
            `
                <label for="wlListName">اسم القائمة الجديد</label>
                <input id="wlListName" maxlength="80"
                       value="${escapeHTML(list.name)}" required>
            `,
            () => {
                const name = cleanText($("wlListName")?.value, 80);

                if (!name) {
                    toast("اسم القائمة مطلوب.");
                    return false;
                }

                list.name = name;
                persist();
                render();
                toast("تم تحديث اسم القائمة.");
                return true;
            }
        );
    }

    function deleteList() {
        const list = getActiveList();

        if (!list || list.id === "default") {
            toast("لا يمكن حذف القائمة الافتراضية.");
            return;
        }

        openDialog(
            "حذف القائمة",
            `
                <p>هل تريد حذف قائمة
                <strong>${escapeHTML(list.name)}</strong>؟
                سيتم حذف المنتجات من هذه القائمة فقط.</p>
            `,
            () => {
                state.data.lists = state.data.lists.filter(
                    item => item.id !== list.id
                );

                state.activeListId = "default";
                state.selected.clear();

                persist();
                render();
                toast("تم حذف القائمة.");
                return true;
            }
        );
    }

    function moveItem(productId) {
        const source = getActiveList();

        const targets = state.data.lists.filter(
            list => list.id !== source.id
        );

        if (!targets.length) {
            toast("أنشئ قائمة أخرى أولًا.");
            return;
        }

        openDialog(
            "نقل المنتج",
            `
                <label for="wlTargetList">اختر القائمة المستهدفة</label>
                <select id="wlTargetList">
                    ${targets.map(list => `
                        <option value="${escapeHTML(list.id)}">
                            ${escapeHTML(list.name)}
                        </option>
                    `).join("")}
                </select>
            `,
            () => {
                const targetId = $("wlTargetList")?.value;
                const target = state.data.lists.find(
                    list => list.id === targetId
                );

                const item = source.items.find(
                    saved => saved.id === String(productId)
                );

                if (!target || !item) return false;

                if (target.items.some(saved => saved.id === item.id)) {
                    toast("المنتج موجود بالفعل في القائمة الأخرى.");
                    return false;
                }

                target.items.push(item);
                source.items = source.items.filter(
                    saved => saved.id !== item.id
                );

                persist();
                render();
                toast("تم نقل المنتج.");
                return true;
            }
        );
    }

    function moveSelected() {
        const ids = [...state.selected];

        if (!ids.length) return;

        const source = getActiveList();
        const targets = state.data.lists.filter(
            list => list.id !== source.id
        );

        if (!targets.length) {
            toast("أنشئ قائمة أخرى أولًا.");
            return;
        }

        openDialog(
            "نقل المنتجات المحددة",
            `
                <p>سيتم نقل ${ids.length} منتج.</p>
                <label for="wlTargetList">القائمة المستهدفة</label>
                <select id="wlTargetList">
                    ${targets.map(list => `
                        <option value="${escapeHTML(list.id)}">
                            ${escapeHTML(list.name)}
                        </option>
                    `).join("")}
                </select>
            `,
            () => {
                const target = state.data.lists.find(
                    list => list.id === $("wlTargetList")?.value
                );

                if (!target) return false;

                ids.forEach(id => {
                    const item = source.items.find(
                        saved => saved.id === id
                    );

                    if (!item) return;

                    if (!target.items.some(saved => saved.id === id)) {
                        target.items.push(item);
                    }

                    source.items = source.items.filter(
                        saved => saved.id !== id
                    );
                });

                state.selected.clear();
                persist();
                render();
                toast("تم نقل المنتجات المحددة.");
                return true;
            }
        );
    }

    function toggleCompare(productId) {
        const id = String(productId);
        const current = state.data.compare;

        if (current.includes(id)) {
            state.data.compare = current.filter(item => item !== id);
            toast("تمت إزالة المنتج من المقارنة.");
        } else {
            if (current.length >= MAX_COMPARE) {
                toast("يمكنك مقارنة أربعة منتجات كحد أقصى.");
                return;
            }

            if (!findSaved(id)) {
                toast("احفظ المنتج أولًا لإضافته للمقارنة.");
                return;
            }

            current.push(id);
            toast("تمت إضافة المنتج للمقارنة.");
        }

        persist();
        render();
    }

    function showComparison() {
        const items = state.data.compare
            .map(id => findSaved(id)?.item || getProduct(id))
            .filter(Boolean);

        if (items.length < 2) {
            toast("اختر منتجين على الأقل للمقارنة.");
            return;
        }

        const rows = [
            ["المنتج", ...items.map(item => escapeHTML(item.name))],
            ["السعر", ...items.map(item => formatMoney(item.price))],
            ["التصنيف", ...items.map(item => escapeHTML(item.category || "—"))],
            ["التوفر", ...items.map(item =>
                item.is_active && item.is_available
                    ? "متوفر"
                    : "غير متوفر"
            )],
            ["الوصف", ...items.map(item =>
                escapeHTML(item.description || "—")
            )]
        ];

        const header = `
            <tr>
                <th>المقارنة</th>
                ${items.map(item =>
                    `<th>${escapeHTML(item.name)}</th>`
                ).join("")}
            </tr>
        `;

        const body = rows.slice(1).map(row => `
            <tr>
                <th>${row[0]}</th>
                ${row.slice(1).map(value => `<td>${value}</td>`).join("")}
            </tr>
        `).join("");

        openDialog(
            "مقارنة المنتجات",
            `
                <div style="overflow-x:auto">
                    <table class="wl-compare-table">
                        ${header}
                        ${body}
                    </table>
                </div>
                <p class="wl-muted">يمكنك مقارنة أربعة منتجات كحد أقصى.</p>
                <button class="wl-btn wl-btn-soft" type="button"
                        id="wlClearCompare">مسح المقارنة</button>
            `,
            () => true
        );

        $("wlClearCompare")?.addEventListener("click", () => {
            state.data.compare = [];
            persist();
            render();
            closeDialog();
            toast("تم مسح المقارنة.");
        });
    }

    function toggleAlert(productId) {
        const id = String(productId);
        const current = state.data.alerts[id];

        if (current) {
            delete state.data.alerts[id];
            toast("تم إلغاء التنبيه.");
        } else {
            const product = findSaved(id)?.item || getProduct(id);

            if (!product) return;

            state.data.alerts[id] = {
                price: true,
                availability: true,
                baselinePrice: numberValue(product.price),
                baselineAvailable: Boolean(
                    product.is_active && product.is_available
                ),
                createdAt: Date.now()
            };

            toast("تم تفعيل تنبيه السعر والتوفر.");
        }

        persist();
        renderAlerts();
        renderProducts();
    }

    function checkAlerts() {
        let changed = false;

        Object.entries(state.data.alerts).forEach(([id, alert]) => {
            const current = getProduct(id);
            if (!current) return;

            const currentAvailable =
                current.is_active && current.is_available;

            const oldPrice = numberValue(alert.baselinePrice);
            const newPrice = numberValue(current.price);

            const priceChanged =
                alert.price &&
                oldPrice > 0 &&
                newPrice > 0 &&
                oldPrice !== newPrice;

            const availabilityChanged =
                alert.availability &&
                Boolean(alert.baselineAvailable) !== currentAvailable;

            if (priceChanged || availabilityChanged) {
                const messages = [];

                if (priceChanged) {
                    messages.push(
                        `تغير السعر من ${formatMoney(oldPrice)} إلى ${formatMoney(newPrice)}`
                    );
                }

                if (availabilityChanged) {
                    messages.push(
                        currentAvailable
                            ? "أصبح المنتج متوفرًا"
                            : "أصبح المنتج غير متوفر"
                    );
                }

                toast(messages.join(" • "));

                alert.baselinePrice = newPrice;
                alert.baselineAvailable = currentAvailable;
                alert.lastChecked = Date.now();

                changed = true;

                if ("Notification" in window &&
                    Notification.permission === "granted") {
                    try {
                        new Notification("تنبيه من IBR20", {
                            body: `${current.name}: ${messages.join(" • ")}`
                        });
                    } catch {}
                }
            }
        });

        if (changed) persist();
    }

    async function requestNotifications() {
        if (!("Notification" in window)) {
            toast("المتصفح لا يدعم إشعارات التنبيه.");
            return;
        }

        if (Notification.permission === "granted") {
            toast("إشعارات المتصفح مفعلة بالفعل.");
            return;
        }

        if (Notification.permission === "denied") {
            toast("تم رفض الإشعارات. يمكنك تغيير الإذن من إعدادات المتصفح.");
            return;
        }

        const permission = await Notification.requestPermission();

        toast(
            permission === "granted"
                ? "تم تفعيل إذن إشعارات المتصفح."
                : "لم يتم السماح بالإشعارات."
        );
    }

    function addToCart(productId) {
        const id = String(productId);
        const product = getProduct(id) || findSaved(id)?.item;

        if (!product) {
            toast("بيانات المنتج غير متاحة.");
            return;
        }

        if (!product.is_active || !product.is_available) {
            toast("هذا المنتج غير متوفر حاليًا.");
            return;
        }

        if (window.IBR && typeof window.IBR.add === "function") {
            try {
                window.IBR.add(id);
                updateCounters();
                toast("تم إرسال المنتج إلى السلة.");
                return;
            } catch (error) {
                console.error(error);
            }
        }

        try {
            const cart = safeParse(localStorage.getItem(CART_KEY), []);
            const items = Array.isArray(cart) ? cart : [];

            const existing = items.find(item =>
                String(item.id || item.product_id) === id
            );

            if (existing) {
                existing.quantity = numberValue(existing.quantity || 1) + 1;
            } else {
                items.push({
                    id,
                    name: product.name,
                    price: product.price,
                    image: product.image,
                    quantity: 1
                });
            }

            localStorage.setItem(CART_KEY, JSON.stringify(items));
            updateCounters();
            toast("تمت إضافة المنتج إلى السلة.");
        } catch {
            toast("تعذر إضافة المنتج إلى السلة.");
        }
    }

    function addSelectedToCart() {
        const ids = [...state.selected];

        if (!ids.length) return;

        let added = 0;

        ids.forEach(id => {
            const product = getProduct(id) || findSaved(id)?.item;

            if (product?.is_active && product?.is_available) {
                addToCart(id);
                added++;
            }
        });

        toast(`تمت معالجة ${added} منتج متاح.`);
    }

    function removeSelected() {
        const ids = [...state.selected];
        if (!ids.length) return;

        const list = getActiveList();

        list.items = list.items.filter(
            item => !state.selected.has(item.id)
        );

        ids.forEach(id => {
            if (!findSaved(id)) {
                delete state.data.alerts[id];
                state.data.compare = state.data.compare.filter(
                    item => item !== id
                );
            }
        });

        state.selected.clear();

        persist();
        render();

        toast("تم حذف المنتجات المحددة.");
    }

    async function shareList() {
        const list = getActiveList();

        if (!list.items.length) {
            toast("القائمة فارغة.");
            return;
        }

        const payload = {
            version: 1,
            name: list.name,
            items: list.items.slice(0, MAX_SHARED_ITEMS).map(item => ({
                id: item.id,
                name: item.name,
                slug: item.slug,
                price: item.price,
                compare_at_price: item.compare_at_price,
                category: item.category,
                image: item.image,
                is_available: item.is_available,
                is_active: item.is_active
            }))
        };

        const encoded = btoa(
            unescape(encodeURIComponent(JSON.stringify(payload)))
        );

        const url = new URL(window.location.href);
        url.search = "";
        url.searchParams.set("shared", encoded);

        if (url.href.length > 7000) {
            const text = list.items.map(item =>
                `${item.name} - ${formatMoney(item.price)}`
            ).join("\n");

            await copyText(
                `${list.name}\n${text}\n${window.location.origin}`
            );

            toast("القائمة طويلة؛ تم نسخ ملخصها بدل رابط المشاركة.");
            return;
        }

        if (navigator.share) {
            try {
                await navigator.share({
                    title: `قائمة ${list.name} - IBR20`,
                    text: "شاهد المنتجات التي اخترتها من متجر IBR20",
                    url: url.href
                });
                return;
            } catch {}
        }

        await copyText(url.href);
        toast("تم نسخ رابط مشاركة القائمة.");
    }

    async function copyText(value) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(value);
                return true;
            }

            const input = document.createElement("textarea");
            input.value = value;
            input.style.position = "fixed";
            input.style.opacity = "0";
            document.body.appendChild(input);
            input.select();

            const success = document.execCommand("copy");
            input.remove();

            if (!success) throw new Error("Copy failed");
            return true;
        } catch {
            toast("تعذر النسخ تلقائيًا.");
            return false;
        }
    }

    function importSharedList() {
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get("shared");

        if (!encoded) return;

        try {
            if (encoded.length > 100000) {
                throw new Error("Shared list too large");
            }

            const decoded = decodeURIComponent(
                escape(atob(encoded))
            );

            const payload = JSON.parse(decoded);

            if (!payload || !Array.isArray(payload.items)) {
                throw new Error("Invalid shared list");
            }

            const list = {
                id: uid(),
                name: cleanText(payload.name || "قائمة مشتركة", 80),
                description: "قائمة مستوردة من مشاركة",
                createdAt: Date.now(),
                items: payload.items
                    .slice(0, MAX_SHARED_ITEMS)
                    .map(item => normalizeSnapshot(item))
                    .filter(Boolean)
            };

            if (!list.items.length) {
                throw new Error("Empty list");
            }

            if (state.data.lists.length >= MAX_LISTS) {
                toast("وصلت إلى الحد الأقصى للقوائم.");
                return;
            }

            openDialog(
                "استيراد قائمة مشتركة",
                `
                    <p>هل تريد استيراد قائمة
                    <strong>${escapeHTML(list.name)}</strong>؟</p>
                    <p class="wl-muted">
                        عدد المنتجات: ${list.items.length}
                    </p>
                `,
                () => {
                    state.data.lists.push(list);
                    state.activeListId = list.id;

                    persist();
                    render();

                    const cleanUrl = new URL(window.location.href);
                    cleanUrl.searchParams.delete("shared");
                    history.replaceState({}, "", cleanUrl);

                    toast("تم استيراد القائمة.");
                    return true;
                }
            );
        } catch (error) {
            console.warn("Invalid shared wishlist:", error);
            toast("رابط القائمة المشتركة غير صالح.");
        }
    }

    function handleProductAction(event) {
        const button = event.target.closest("[data-action]");
        if (!button) return;

        const action = button.dataset.action;
        const id = button.dataset.id;

        if (action === "select") {
            if (button.checked) {
                state.selected.add(id);
            } else {
                state.selected.delete(id);
            }

            renderBulkBar();
            return;
        }

        if (action === "remove") {
            removeProduct(id);
            return;
        }

        if (action === "cart") {
            addToCart(id);
            return;
        }

        if (action === "compare") {
            toggleCompare(id);
            return;
        }

        if (action === "alert") {
            toggleAlert(id);
            return;
        }

        if (action === "move") {
            moveItem(id);
        }
    }

    function bindEvents() {
        $("wlListSelect")?.addEventListener("change", event => {
            state.activeListId = event.target.value;
            state.selected.clear();
            render();
        });

        $("wlNewListBtn")?.addEventListener("click", createList);
        $("wlRenameListBtn")?.addEventListener("click", renameList);
        $("wlDeleteListBtn")?.addEventListener("click", deleteList);

        $("wlSearch")?.addEventListener("input", event => {
            state.search = cleanText(event.target.value, 100);
            renderProducts();
        });

        $("wlSort")?.addEventListener("change", event => {
            state.sort = event.target.value;
            renderProducts();
        });

        document.querySelectorAll(".wl-chip").forEach(button => {
            button.addEventListener("click", () => {
                document.querySelectorAll(".wl-chip").forEach(item =>
                    item.classList.remove("is-active")
                );

                button.classList.add("is-active");
                state.filter = button.dataset.filter || "all";

                renderProducts();
            });
        });

        $("wlProducts")?.addEventListener("click", handleProductAction);
        $("wlRecommendations")?.addEventListener("click", handleProductAction);

        $("wlProducts")?.addEventListener("change", handleProductAction);

        $("wlSelectAll")?.addEventListener("change", event => {
            const items = filteredItems();

            items.forEach(item => {
                if (event.target.checked) {
                    state.selected.add(item.id);
                } else {
                    state.selected.delete(item.id);
                }
            });

            renderProducts();
            renderBulkBar();
        });

        $("wlRemoveSelectedBtn")?.addEventListener("click", removeSelected);
        $("wlAddSelectedBtn")?.addEventListener("click", addSelectedToCart);
        $("wlMoveSelectedBtn")?.addEventListener("click", moveSelected);

        $("wlCompareBtn")?.addEventListener("click", showComparison);
        $("wlShareBtn")?.addEventListener("click", shareList);

        $("wlNotifyPermissionBtn")?.addEventListener(
            "click",
            requestNotifications
        );

        $("wlAlerts")?.addEventListener("change", event => {
            const input = event.target.closest(
                '[data-action="alert-toggle"]'
            );

            if (!input) return;

            const id = input.dataset.id;

            if (!input.checked) {
                delete state.data.alerts[id];
                persist();
                renderAlerts();
                renderProducts();
            }
        });

        $("wlDialogForm")?.addEventListener("submit", event => {
            event.preventDefault();

            if (!state.dialogAction) {
                closeDialog();
                return;
            }

            const result = state.dialogAction();

            if (result !== false) closeDialog();
        });

        $("wlDialogClose")?.addEventListener("click", closeDialog);
        $("wlDialogCancel")?.addEventListener("click", closeDialog);

        window.addEventListener("storage", event => {
            if (event.key !== STORAGE_KEY) return;

            loadData();

            if (!state.data.lists.some(
                list => list.id === state.activeListId
            )) {
                state.activeListId = "default";
            }

            render();
        });

        window.addEventListener("ibr:products-updated", async () => {
            await loadProducts();
            render();
            checkAlerts();
        });
    }

    function publicAPI() {
        return {
            add(product, listId) {
                return addProduct(product, listId);
            },

            remove(productId, listId) {
                return removeProduct(productId, listId);
            },

            toggle,

            has: isSaved,

            count,

            lists() {
                return state.data.lists.map(list => ({
                    id: list.id,
                    name: list.name,
                    count: list.items.length
                }));
            },

            getData() {
                return JSON.parse(JSON.stringify(state.data));
            },

            getList(listId) {
                const list = state.data.lists.find(
                    item => item.id === listId
                );

                return list
                    ? JSON.parse(JSON.stringify(list))
                    : null;
            },

            refresh: async () => {
                await loadProducts();
                render();
            }
        };
    }

    async function init() {
        if (state.initialized) return;
        state.initialized = true;

        loadData();

        await loadProducts();

        migrateLegacy();

        if (!state.data.lists.some(
            list => list.id === state.activeListId
        )) {
            state.activeListId = "default";
        }

        state.data.compare = state.data.compare
            .filter(id => Boolean(findSaved(id)))
            .slice(0, MAX_COMPARE);

        persist();

        bindEvents();
        render();
        checkAlerts();
        importSharedList();
    }

    window.IBRWishlist = publicAPI();

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

})();
