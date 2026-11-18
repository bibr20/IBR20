
/* =========================================================
   IBR ADMIN REVIEWS
   إدارة تقييمات المنتجات داخل لوحة إدارة العملاء
   Version: 1.0.0
   يعتمد على: IBRReviewsService + window.supabaseClient
========================================================= */

(function (window, document) {
    "use strict";

    if (window.IBRAdminReviews) return;

    const CONFIG = {
        container: "[data-customers-reviews]",
        count: '[data-customers-count="reviews"]',
        tabs: "[data-customers-tab]",
        pageSize: 10,
        functionName: "IBRReviewsService"
    };

    const state = {
        page: 1,
        pageSize: CONFIG.pageSize,
        status: "all",
        rating: "all",
        search: "",
        sort: "newest",
        reviews: [],
        pagination: {
            page: 1,
            pageSize: CONFIG.pageSize,
            total: 0,
            totalPages: 0
        },
        loading: false,
        initialized: false,
        requestNumber: 0
    };

    const service = () => window.IBRReviewsService;

    const element = (selector, root = document) =>
        root.querySelector(selector);

    const escapeHTML = (value) => {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    };

    const formatDate = (value) => {
        if (!value) return "غير محدد";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "غير محدد";
        }

        return new Intl.DateTimeFormat("ar-SA", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        }).format(date);
    };

    const statusInfo = (status) => {
        const statuses = {
            pending: {
                label: "قيد المراجعة",
                className: "pending"
            },
            approved: {
                label: "معتمد",
                className: "approved"
            },
            rejected: {
                label: "مرفوض",
                className: "rejected"
            }
        };

        return statuses[status] || {
            label: "غير معروف",
            className: "unknown"
        };
    };

    const renderStars = (rating) => {
        const value = Math.max(
            0,
            Math.min(5, Number(rating) || 0)
        );

        return `
            <span class="ibr-review-stars" aria-label="${value} من 5">
                ${Array.from({ length: 5 }, (_, index) => `
                    <span class="${index < value ? "is-filled" : ""}">★</span>
                `).join("")}
            </span>
        `;
    };

    const getContainer = () => element(CONFIG.container);

    const setCount = (count) => {
        const node = element(CONFIG.count);

        if (node) {
            node.textContent = Number(count || 0).toLocaleString("ar-SA");
        }
    };

    const injectStyles = () => {
        if (element("#ibr-admin-reviews-styles")) return;

        const style = document.createElement("style");
        style.id = "ibr-admin-reviews-styles";

        style.textContent = `
            .ibr-reviews-manager {
                direction: rtl;
                width: 100%;
                color: var(--text-color, #33291f);
            }

            .ibr-reviews-toolbar {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 10px;
                margin-bottom: 18px;
            }

            .ibr-reviews-toolbar input,
            .ibr-reviews-toolbar select {
                min-height: 42px;
                border: 1px solid #e5ded4;
                border-radius: 10px;
                background: #fff;
                color: #33291f;
                padding: 8px 12px;
                font: inherit;
                max-width: 100%;
            }

            .ibr-reviews-toolbar input {
                flex: 1 1 220px;
            }

            .ibr-reviews-toolbar select {
                flex: 0 1 165px;
            }

            .ibr-reviews-refresh,
            .ibr-review-action,
            .ibr-reviews-page-button {
                border: 0;
                border-radius: 9px;
                padding: 9px 13px;
                cursor: pointer;
                font: inherit;
                transition: opacity .2s ease, transform .2s ease;
            }

            .ibr-reviews-refresh:hover,
            .ibr-review-action:hover,
            .ibr-reviews-page-button:hover {
                opacity: .85;
                transform: translateY(-1px);
            }

            .ibr-reviews-refresh {
                background: #6b5138;
                color: #fff;
            }

            .ibr-reviews-list {
                display: grid;
                gap: 14px;
            }

            .ibr-review-card {
                background: #fff;
                border: 1px solid #e9e2d9;
                border-radius: 14px;
                padding: 17px;
                box-shadow: 0 3px 12px rgba(55, 40, 25, .035);
            }

            .ibr-review-card-head {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                flex-wrap: wrap;
                gap: 12px;
                margin-bottom: 12px;
            }

            .ibr-review-customer {
                font-weight: 700;
                font-size: 15px;
            }

            .ibr-review-date {
                color: #897e72;
                font-size: 12px;
                margin-top: 5px;
            }

            .ibr-review-status {
                display: inline-flex;
                align-items: center;
                border-radius: 20px;
                padding: 5px 10px;
                font-size: 12px;
                white-space: nowrap;
            }

            .ibr-review-status.pending {
                background: #fff4dc;
                color: #8a5a00;
            }

            .ibr-review-status.approved {
                background: #e7f5eb;
                color: #26723c;
            }

            .ibr-review-status.rejected {
                background: #fbe9e7;
                color: #a43b32;
            }

            .ibr-review-stars {
                display: inline-flex;
                direction: ltr;
                gap: 2px;
                color: #d8d0c5;
                font-size: 19px;
                margin: 5px 0;
            }

            .ibr-review-stars .is-filled {
                color: #c18a37;
            }

            .ibr-review-text {
                line-height: 1.9;
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                margin: 8px 0 12px;
            }

            .ibr-review-meta {
                color: #766b60;
                font-size: 12px;
                line-height: 1.9;
                overflow-wrap: anywhere;
            }

            .ibr-review-images {
                display: flex;
                flex-wrap: wrap;
                gap: 9px;
                margin: 12px 0;
            }

            .ibr-review-images a {
                display: block;
                width: 88px;
                height: 88px;
                border-radius: 10px;
                overflow: hidden;
                border: 1px solid #e9e2d9;
                background: #f7f3ed;
            }

            .ibr-review-images img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }

            .ibr-review-note {
                width: 100%;
                min-height: 75px;
                resize: vertical;
                border: 1px solid #e5ded4;
                border-radius: 10px;
                padding: 10px;
                font: inherit;
                margin-top: 12px;
                box-sizing: border-box;
            }

            .ibr-review-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 12px;
            }

            .ibr-review-action {
                font-size: 12px;
            }

            .ibr-review-action.approve {
                background: #e7f5eb;
                color: #26723c;
            }

            .ibr-review-action.reject {
                background: #fbe9e7;
                color: #a43b32;
            }

            .ibr-review-action.pending {
                background: #fff4dc;
                color: #8a5a00;
            }

            .ibr-review-action.note {
                background: #eee8df;
                color: #5e4935;
            }

            .ibr-review-action.delete {
                background: #8e3029;
                color: #fff;
            }

            .ibr-reviews-pagination {
                display: flex;
                align-items: center;
                justify-content: center;
                flex-wrap: wrap;
                gap: 12px;
                margin-top: 18px;
            }

            .ibr-reviews-page-button {
                background: #eee8df;
                color: #5e4935;
            }

            .ibr-reviews-page-button:disabled {
                opacity: .4;
                cursor: not-allowed;
                transform: none;
            }

            .ibr-reviews-page-info {
                color: #766b60;
                font-size: 13px;
            }

            .ibr-reviews-message {
                border: 1px dashed #d9cfc2;
                border-radius: 12px;
                padding: 25px 15px;
                text-align: center;
                color: #766b60;
                background: #fcfaf7;
                line-height: 1.9;
            }

            .ibr-reviews-error {
                color: #a43b32;
                background: #fff1ef;
                border: 1px solid #f1d0cb;
            }

            @media (max-width: 600px) {
                .ibr-review-card {
                    padding: 13px;
                }

                .ibr-review-actions > button {
                    flex: 1 1 calc(50% - 8px);
                }

                .ibr-reviews-toolbar select {
                    flex: 1 1 130px;
                }
            }
        `;

        document.head.appendChild(style);
    };

    const renderToolbar = () => `
        <div class="ibr-reviews-toolbar">
            <input
                type="search"
                data-ibr-review-search
                value="${escapeHTML(state.search)}"
                placeholder="ابحث باسم العميل أو نص التقييم..."
                aria-label="البحث في التقييمات"
            >

            <select data-ibr-review-status aria-label="تصفية حسب الحالة">
                <option value="all" ${state.status === "all" ? "selected" : ""}>كل الحالات</option>
                <option value="pending" ${state.status === "pending" ? "selected" : ""}>قيد المراجعة</option>
                <option value="approved" ${state.status === "approved" ? "selected" : ""}>معتمدة</option>
                <option value="rejected" ${state.status === "rejected" ? "selected" : ""}>مرفوضة</option>
            </select>

            <select data-ibr-review-rating aria-label="تصفية حسب التقييم">
                <option value="all" ${state.rating === "all" ? "selected" : ""}>كل النجوم</option>
                <option value="5" ${state.rating === "5" ? "selected" : ""}>5 نجوم</option>
                <option value="4" ${state.rating === "4" ? "selected" : ""}>4 نجوم</option>
                <option value="3" ${state.rating === "3" ? "selected" : ""}>3 نجوم</option>
                <option value="2" ${state.rating === "2" ? "selected" : ""}>نجمتان</option>
                <option value="1" ${state.rating === "1" ? "selected" : ""}>نجمة واحدة</option>
            </select>

            <select data-ibr-review-sort aria-label="ترتيب التقييمات">
                <option value="newest" ${state.sort === "newest" ? "selected" : ""}>الأحدث أولاً</option>
                <option value="oldest" ${state.sort === "oldest" ? "selected" : ""}>الأقدم أولاً</option>
                <option value="rating" ${state.sort === "rating" ? "selected" : ""}>حسب النجوم</option>
            </select>

            <button type="button" class="ibr-reviews-refresh" data-ibr-review-refresh>
                تحديث
            </button>
        </div>
    `;

    const renderImages = (images) => {
        if (!Array.isArray(images) || !images.length) return "";

        return `
            <div class="ibr-review-images">
                ${images.map((image) => {
            const url = image.image_url || image.signed_url || "";

            if (!url) return "";

            return `
                        <a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">
                            <img
                                src="${escapeHTML(url)}"
                                alt="صورة مرفقة بتقييم العميل"
                                loading="lazy"
                            >
                        </a>
                    `;
        }).join("")}
            </div>
        `;
    };

    const renderReview = (review) => {
        const status = statusInfo(review.status);
        const order = review.order || {};
        const item = review.order_item || {};

        return `
            <article class="ibr-review-card" data-review-card="${escapeHTML(review.id)}">
                <div class="ibr-review-card-head">
                    <div>
                        <div class="ibr-review-customer">
                            ${escapeHTML(review.customer_name || "عميل المتجر")}
                        </div>
                        <div class="ibr-review-date">
                            ${escapeHTML(formatDate(review.created_at))}
                        </div>
                    </div>

                    <span class="ibr-review-status ${status.className}">
                        ${status.label}
                    </span>
                </div>

                <div>
                    ${renderStars(review.rating)}
                </div>

                <div class="ibr-review-text">
                    ${review.review_text
                ? escapeHTML(review.review_text)
                : "لم يكتب العميل تعليقًا نصيًا."}
                </div>

                <div class="ibr-review-meta">
                    <div>معرّف المنتج: ${escapeHTML(review.product_id || "—")}</div>
                    <div>المنتج: ${escapeHTML(item.product_name || "غير متوفر")}</div>
                    <div>رقم الطلب: ${escapeHTML(order.order_number || "غير متوفر")}</div>
                    <div>عدد القطع: ${escapeHTML(item.quantity ?? "—")}</div>
                </div>

                ${renderImages(review.images)}

                <textarea
                    maxlength="4000"
                    class="ibr-review-note"
                    data-review-note
                    placeholder="ملاحظة إدارية داخلية، لا تظهر للزوار..."
                    aria-label="الملاحظة الإدارية"
                >${escapeHTML(review.admin_note || "")}</textarea>

                <div class="ibr-review-actions">
                    <button
                        type="button"
                        class="ibr-review-action approve"
                        data-review-status="approved"
                        data-review-id="${escapeHTML(review.id)}"
                    >اعتماد التقييم</button>

                    <button
                        type="button"
                        class="ibr-review-action reject"
                        data-review-status="rejected"
                        data-review-id="${escapeHTML(review.id)}"
                    >رفض التقييم</button>

                    <button
                        type="button"
                        class="ibr-review-action pending"
                        data-review-status="pending"
                        data-review-id="${escapeHTML(review.id)}"
                    >إعادته للمراجعة</button>

                    <button
                        type="button"
                        class="ibr-review-action note"
                        data-review-save-note="${escapeHTML(review.id)}"
                    >حفظ الملاحظة</button>

                    <button
                        type="button"
                        class="ibr-review-action delete"
                        data-review-delete="${escapeHTML(review.id)}"
                    >حذف التقييم</button>
                </div>
            </article>
        `;
    };

    const renderPagination = () => {
        const pagination = state.pagination;
        const totalPages = Math.max(1, pagination.totalPages || 1);

        return `
            <div class="ibr-reviews-pagination">
                <button
                    type="button"
                    class="ibr-reviews-page-button"
                    data-ibr-review-page="previous"
                    ${state.page <= 1 ? "disabled" : ""}
                >السابق</button>

                <span class="ibr-reviews-page-info">
                    صفحة ${state.page.toLocaleString("ar-SA")}
                    من ${totalPages.toLocaleString("ar-SA")}
                    — ${Number(pagination.total || 0).toLocaleString("ar-SA")} تقييم
                </span>

                <button
                    type="button"
                    class="ibr-reviews-page-button"
                    data-ibr-review-page="next"
                    ${state.page >= totalPages ? "disabled" : ""}
                >التالي</button>
            </div>
        `;
    };

    const render = () => {
        const container = getContainer();

        if (!container) return;

        if (state.loading && !state.reviews.length) {
            container.innerHTML = `
                <div class="ibr-reviews-manager">
                    ${renderToolbar()}
                    <div class="ibr-reviews-message">جارٍ تحميل التقييمات...</div>
                </div>
            `;
            return;
        }

        const list = state.reviews.length
            ? state.reviews.map(renderReview).join("")
            : `<div class="ibr-reviews-message">لا توجد تقييمات مطابقة لخيارات البحث والتصفية.</div>`;

        container.innerHTML = `
            <div class="ibr-reviews-manager">
                ${renderToolbar()}
                <div class="ibr-reviews-list">${list}</div>
                ${state.reviews.length ? renderPagination() : ""}
            </div>
        `;

        setCount(state.pagination.total || 0);
    };

    const load = async () => {
        const api = service();

        if (!api || typeof api.fetchAdminReviews !== "function") {
            const container = getContainer();

            if (container) {
                container.innerHTML = `
                    <div class="ibr-reviews-message ibr-reviews-error">
                        لم يتم تحميل خدمة التقييمات.
                        تأكد من تحميل reviews-service.js قبل admin-reviews.js.
                    </div>
                `;
            }

            return;
        }

        const requestNumber = ++state.requestNumber;
        state.loading = true;
        render();

        try {
            const result = await api.fetchAdminReviews({
                page: state.page,
                pageSize: state.pageSize,
                status: state.status,
                rating: state.rating,
                search: state.search,
                sort: state.sort
            });

            if (requestNumber !== state.requestNumber) return;

            if (!result || result.success === false) {
                throw new Error(result?.error || "تعذر تحميل التقييمات.");
            }

            state.reviews = Array.isArray(result.data)
                ? result.data
                : [];

            state.pagination = result.pagination || {
                page: state.page,
                pageSize: state.pageSize,
                total: state.reviews.length,
                totalPages: 1
            };

            state.page = Number(state.pagination.page || state.page);
            state.loading = false;
            render();

        } catch (error) {
            if (requestNumber !== state.requestNumber) return;

            state.loading = false;

            const container = getContainer();

            if (container) {
                container.innerHTML = `
                    <div class="ibr-reviews-manager">
                        ${renderToolbar()}
                        <div class="ibr-reviews-message ibr-reviews-error">
                            ${escapeHTML(error.message || "حدث خطأ أثناء تحميل التقييمات.")}
                        </div>
                    </div>
                `;
            }

            console.error("[IBR Admin Reviews] Load error:", error);
        }
    };

    const updateStatus = async (reviewId, status) => {
        const api = service();

        const labels = {
            approved: "اعتماد هذا التقييم ونشره للزوار؟",
            rejected: "رفض هذا التقييم؟",
            pending: "إعادة هذا التقييم إلى قائمة المراجعة؟"
        };

        if (!window.confirm(labels[status] || "تأكيد تغيير حالة التقييم؟")) {
            return;
        }

        try {
            const result = await api.updateReviewStatus(reviewId, status);

            if (result?.success === false) {
                throw new Error(result.error || "تعذر تحديث الحالة.");
            }

            await load();

        } catch (error) {
            console.error(error);
            window.alert(error.message || "تعذر تحديث حالة التقييم.");
        }
    };

    const saveNote = async (reviewId, button) => {
        const card = button.closest("[data-review-card]");
        const textarea = card?.querySelector("[data-review-note]");

        if (!textarea) return;

        try {
            button.disabled = true;

            const result = await service().updateAdminNote(
                reviewId,
                textarea.value
            );

            if (result?.success === false) {
                throw new Error(result.error || "تعذر حفظ الملاحظة.");
            }

            window.alert("تم حفظ الملاحظة الإدارية.");

        } catch (error) {
            console.error(error);
            window.alert(error.message || "تعذر حفظ الملاحظة.");
        } finally {
            button.disabled = false;
        }
    };

    const deleteReview = async (reviewId, button) => {
        const confirmed = window.confirm(
            "هل تريد حذف هذا التقييم نهائيًا؟\nسيتم حذف الصور المرتبطة به أيضًا."
        );

        if (!confirmed) return;

        try {
            button.disabled = true;

            const result = await service().deleteReview(
                reviewId,
                { confirmed: true }
            );

            if (result?.success === false) {
                throw new Error(result.error || "تعذر حذف التقييم.");
            }

            await load();

        } catch (error) {
            console.error(error);
            window.alert(error.message || "تعذر حذف التقييم.");
            button.disabled = false;
        }
    };

    const bindEvents = () => {
        const container = getContainer();

        if (!container || container.dataset.ibrReviewsBound === "true") {
            return;
        }

        container.dataset.ibrReviewsBound = "true";

        container.addEventListener("click", async (event) => {
            const statusButton = event.target.closest("[data-review-status]");

            if (statusButton) {
                await updateStatus(
                    statusButton.dataset.reviewId,
                    statusButton.dataset.reviewStatus
                );
                return;
            }

            const noteButton = event.target.closest("[data-review-save-note]");

            if (noteButton) {
                await saveNote(
                    noteButton.dataset.reviewSaveNote,
                    noteButton
                );
                return;
            }

            const deleteButton = event.target.closest("[data-review-delete]");

            if (deleteButton) {
                await deleteReview(
                    deleteButton.dataset.reviewDelete,
                    deleteButton
                );
                return;
            }

            if (event.target.closest("[data-ibr-review-refresh]")) {
                state.page = 1;
                await load();
                return;
            }

            const pageButton = event.target.closest("[data-ibr-review-page]");

            if (pageButton) {
                if (pageButton.dataset.ibrReviewPage === "previous") {
                    state.page = Math.max(1, state.page - 1);
                } else {
                    state.page += 1;
                }

                await load();
            }
        });

        container.addEventListener("change", async (event) => {
            const target = event.target;

            if (target.matches("[data-ibr-review-status]")) {
                state.status = target.value;
                state.page = 1;
                await load();
            }

            if (target.matches("[data-ibr-review-rating]")) {
                state.rating = target.value;
                state.page = 1;
                await load();
            }

            if (target.matches("[data-ibr-review-sort]")) {
                state.sort = target.value;
                state.page = 1;
                await load();
            }
        });

        container.addEventListener("keydown", async (event) => {
            if (
                event.target.matches("[data-ibr-review-search]") &&
                event.key === "Enter"
            ) {
                state.search = event.target.value.trim();
                state.page = 1;
                await load();
            }
        });

        container.addEventListener("click", (event) => {
            if (event.target.closest("[data-ibr-review-search]")) return;
        });

        container.addEventListener("focusout", async (event) => {
            if (event.target.matches("[data-ibr-review-search]")) {
                const value = event.target.value.trim();

                if (value !== state.search) {
                    state.search = value;
                    state.page = 1;
                    await load();
                }
            }
        });
    };

    const bindTabRefresh = () => {
        document.addEventListener("click", (event) => {
            const tab = event.target.closest(CONFIG.tabs);

            if (!tab) return;

            const tabValue = (
                tab.dataset.customersTab ||
                tab.getAttribute("aria-controls") ||
                ""
            ).toLowerCase();

            if (tabValue.includes("review")) {
                window.setTimeout(load, 0);
            }
        });
    };

    const init = () => {
        if (state.initialized) return;

        const container = getContainer();

        if (!container) {
            console.warn(
                "[IBR Admin Reviews] لم يتم العثور على",
                CONFIG.container
            );
            return;
        }

        state.initialized = true;

        injectStyles();
        bindEvents();
        bindTabRefresh();
        load();

        console.log("[IBR Admin Reviews] Initialized.");
    };

    window.IBRAdminReviews = {
        init,
        load,
        refresh: load,
        getState: () => ({
            ...state,
            reviews: [...state.reviews]
        })
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }

})(window, document);
