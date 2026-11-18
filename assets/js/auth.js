/* =========================================================
   IBR CUSTOMER AUTHENTICATION
   File: assets/js/auth.js
   Version: 2.0.0
   يعتمد على window.supabaseClient
   لا ينشئ اتصال Supabase جديداً.
========================================================= */

(function () {
    "use strict";

    if (window.IBRAuth) {
        return;
    }

    /* =====================================================
       1. الإعدادات
    ===================================================== */

    const CONFIG = {
        loginPage: "login.html",
        accountPage: "account.html",
        homePage: "index.html",

        ordersRpc: "get_my_ibr_orders",
        inquiriesRpc: "get_my_customer_inquiries",

        protectedPages: [
            "account.html"
        ],

        welcomeSessionKey: "ibr-welcome-shown-v2",

        welcomeExcludedPages: [
            "login.html",
            "account.html"
        ]
    };

    /* =====================================================
       2. الحالة الداخلية
    ===================================================== */

    let supabase = null;
    let currentUser = null;
    let currentSession = null;

    let initialized = false;
    let initPromise = null;
    let authSubscription = null;

    let recoveryMode = false;
    let welcomeModal = null;

    const listeners = new Set();

    /* =====================================================
       3. أدوات عامة
    ===================================================== */

    function getClient() {
        return window.supabaseClient || null;
    }

    function getCurrentPage() {
        return window.location.pathname
            .split("/")
            .pop() || "index.html";
    }

    function getRedirectUrl(page) {
        return new URL(
            page || CONFIG.homePage,
            window.location.href
        ).toString();
    }

    function isProtectedPage() {
        return CONFIG.protectedPages.includes(
            getCurrentPage()
        );
    }

    function isLoginPage() {
        return getCurrentPage() === CONFIG.loginPage;
    }

    function getCustomerName(user = currentUser) {
        if (!user) return "عميل IBR";

        return (
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email ||
            "عميل IBR"
        );
    }

    function cleanRedirect(value) {
        if (!value) {
            return CONFIG.accountPage;
        }

        try {
            const url = new URL(
                value,
                window.location.origin
            );

            if (url.origin !== window.location.origin) {
                return CONFIG.accountPage;
            }

            const path = url.pathname;

            if (
                !path ||
                path === "/" ||
                path.includes("..")
            ) {
                return CONFIG.accountPage;
            }

            return path.split("/").pop() +
                url.search +
                url.hash;

        } catch (error) {
            return CONFIG.accountPage;
        }
    }

    function getCurrentReturnUrl() {
        return (
            window.location.pathname +
            window.location.search +
            window.location.hash
        );
    }

    function buildLoginUrl(mode = "login", redirect = null) {
        const url = new URL(
            CONFIG.loginPage,
            window.location.href
        );

        url.searchParams.set("mode", mode);

        if (redirect) {
            url.searchParams.set(
                "redirect",
                cleanRedirect(redirect)
            );
        }

        return url.toString();
    }

    function getSafeError(error) {
        if (!error) {
            return "حدث خطأ غير متوقع. حاول مرة أخرى.";
        }

        const message = String(
            error.message || error
        );

        const translations = [
            {
                test: /invalid login credentials/i,
                text: "البريد الإلكتروني أو كلمة المرور غير صحيحة."
            },
            {
                test: /email not confirmed/i,
                text: "يرجى تأكيد بريدك الإلكتروني أولاً."
            },
            {
                test: /user already registered/i,
                text: "تعذر إنشاء الحساب بهذه البيانات. تحقق من البريد الإلكتروني أو حاول تسجيل الدخول."
            },
            {
                test: /password should be at least/i,
                text: "كلمة المرور قصيرة جداً."
            },
            {
                test: /rate limit/i,
                text: "تم تجاوز عدد المحاولات. يرجى الانتظار قليلاً."
            },
            {
                test: /network|fetch failed/i,
                text: "تعذر الاتصال بالإنترنت. تحقق من اتصالك."
            },
            {
                test: /email address/i,
                text: "يرجى التأكد من صحة البريد الإلكتروني."
            },
            {
                test: /session.*missing|auth session missing/i,
                text: "انتهت جلسة التحقق. أعد فتح رابط الرسالة وحاول مرة أخرى."
            },
            {
                test: /weak password/i,
                text: "كلمة المرور ضعيفة. اختر كلمة مرور أقوى."
            }
        ];

        const found = translations.find(item =>
            item.test.test(message)
        );

        return found ? found.text : message;
    }

    /* =====================================================
       4. حالة المصادقة والمستمعون
    ===================================================== */

    function getState() {
        return {
            initialized,
            isAuthenticated: Boolean(currentUser),
            user: currentUser,
            session: currentSession,
            userId: currentUser?.id || null,
            email: currentUser?.email || null,
            name: getCustomerName(),
            isRecovery: recoveryMode
        };
    }

    function getUser() {
        return currentUser;
    }

    function getSession() {
        return currentSession;
    }

    function isLoggedIn() {
        return Boolean(currentUser);
    }

    function subscribe(callback) {
        if (typeof callback !== "function") {
            return function () {};
        }

        listeners.add(callback);

        try {
            callback(getState());
        } catch (error) {
            console.error("IBR Auth Listener Error:", error);
        }

        return function unsubscribe() {
            listeners.delete(callback);
        };
    }

    function notifyListeners() {
        const state = getState();

        listeners.forEach(callback => {
            try {
                callback(state);
            } catch (error) {
                console.error(
                    "IBR Auth Listener Error:",
                    error
                );
            }
        });

        document.dispatchEvent(
            new CustomEvent("ibr:auth-change", {
                detail: state
            })
        );

        updateHeader();
    }

    /* =====================================================
       5. تحديث الجلسة
    ===================================================== */

    async function refreshSession() {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        const { data, error } =
            await supabase.auth.getSession();

        if (error) throw error;

        currentSession = data.session || null;
        currentUser = currentSession?.user || null;
        initialized = true;

        return getState();
    }

    /* =====================================================
       6. إنشاء حساب
    ===================================================== */

    async function signUp(options = {}) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        const email = String(
            options.email || ""
        ).trim().toLowerCase();

        const password = String(
            options.password || ""
        );

        const fullName = String(
            options.fullName || options.name || ""
        ).trim();

        if (!email) {
            throw new Error(
                "يرجى إدخال البريد الإلكتروني."
            );
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error(
                "صيغة البريد الإلكتروني غير صحيحة."
            );
        }

        if (password.length < 8) {
            throw new Error(
                "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل."
            );
        }

        if (fullName.length < 2) {
            throw new Error(
                "يرجى إدخال الاسم الكامل."
            );
        }

        const redirect = getRedirectUrl(
            CONFIG.accountPage
        );

        const { data, error } =
            await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName
                    },
                    emailRedirectTo: redirect
                }
            });

        if (error) {
            throw new Error(getSafeError(error));
        }

        currentSession = data.session || null;
        currentUser = data.user || null;
        initialized = true;

        notifyListeners();

        return {
            user: data.user,
            session: data.session,
            needsEmailConfirmation: !data.session
        };
    }

    /* =====================================================
       7. تسجيل الدخول
    ===================================================== */

    async function signIn(options = {}) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        const email = String(
            options.email || ""
        ).trim().toLowerCase();

        const password = String(
            options.password || ""
        );

        if (!email || !password) {
            throw new Error(
                "يرجى إدخال البريد الإلكتروني وكلمة المرور."
            );
        }

        const { data, error } =
            await supabase.auth.signInWithPassword({
                email,
                password
            });

        if (error) {
            throw new Error(getSafeError(error));
        }

        currentUser = data.user || null;
        currentSession = data.session || null;
        initialized = true;

        notifyListeners();

        return {
            user: currentUser,
            session: currentSession
        };
    }

    /* =====================================================
       8. تسجيل الخروج
    ===================================================== */

    async function signOut(options = {}) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        const { error } = await supabase.auth.signOut();

        if (error) {
            throw new Error(getSafeError(error));
        }

        currentUser = null;
        currentSession = null;
        recoveryMode = false;

        notifyListeners();

        if (options.redirect !== false) {
            window.location.href =
                options.redirectTo || CONFIG.homePage;
        }

        return true;
    }

    /* =====================================================
       9. استعادة كلمة المرور
    ===================================================== */

    async function resetPassword(email) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        email = String(email || "")
            .trim()
            .toLowerCase();

        if (!email) {
            throw new Error(
                "يرجى إدخال البريد الإلكتروني."
            );
        }

        const { error } =
            await supabase.auth.resetPasswordForEmail(
                email,
                {
                    redirectTo: getRedirectUrl(
                        CONFIG.loginPage
                    )
                }
            );

        if (error) {
            throw new Error(getSafeError(error));
        }

        return true;
    }

    /* =====================================================
       10. تحديث كلمة المرور
    ===================================================== */

    async function updatePassword(password) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        if (!currentUser) {
            throw new Error(
                "يرجى تسجيل الدخول أو فتح رابط الاستعادة أولاً."
            );
        }

        password = String(password || "");

        if (password.length < 8) {
            throw new Error(
                "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل."
            );
        }

        const { data, error } =
            await supabase.auth.updateUser({
                password
            });

        if (error) {
            throw new Error(getSafeError(error));
        }

        currentUser = data.user || currentUser;
        recoveryMode = false;

        notifyListeners();

        return data.user;
    }

    /* =====================================================
       11. تحديث بيانات العميل
    ===================================================== */

    async function updateProfile(options = {}) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        if (!currentUser) {
            throw new Error(
                "يرجى تسجيل الدخول أولاً."
            );
        }

        const fullName = String(
            options.fullName || options.name || ""
        ).trim();

        if (fullName.length < 2) {
            throw new Error(
                "يرجى إدخال الاسم الكامل."
            );
        }

        const { data, error } =
            await supabase.auth.updateUser({
                data: {
                    ...currentUser.user_metadata,
                    full_name: fullName
                }
            });

        if (error) {
            throw new Error(getSafeError(error));
        }

        currentUser = data.user || currentUser;

        notifyListeners();

        return currentUser;
    }

        /* =====================================================
       12. طلبات العميل
    ===================================================== */

    async function getMyOrders(options = {}) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        if (!currentUser) {
            throw new Error(
                "يرجى تسجيل الدخول لعرض طلباتك."
            );
        }

        const limit = Math.min(
            Math.max(Number(options.limit) || 20, 1),
            100
        );

        const offset = Math.max(
            Number(options.offset) || 0,
            0
        );

        const { data, error } = await supabase.rpc(
            CONFIG.ordersRpc,
            {
                p_limit: limit,
                p_offset: offset
            }
        );

        if (error) {
            throw new Error(getSafeError(error));
        }

        // الدالة ترجع JSON بالشكل { total, orders }.
        // نحافظ على واجهة getMyOrders الحالية التي تعيد مصفوفة.
        if (Array.isArray(data)) return data;

        return Array.isArray(data?.orders)
            ? data.orders
            : [];
    }

    /* =====================================================
       13. استفسارات العميل
    ===================================================== */

    async function getMyInquiries(options = {}) {
        if (!supabase) {
            throw new Error(
                "اتصال المتجر بقاعدة البيانات غير جاهز."
            );
        }

        if (!currentUser) {
            throw new Error(
                "يرجى تسجيل الدخول لعرض استفساراتك."
            );
        }

        const limit = Math.min(
            Math.max(Number(options.limit) || 20, 1),
            50
        );

        const offset = Math.max(
            Number(options.offset) || 0,
            0
        );

        const { data, error } = await supabase.rpc(
            CONFIG.inquiriesRpc,
            {
                p_limit: limit,
                p_offset: offset
            }
        );

        if (error) {
            throw new Error(getSafeError(error));
        }

        return {
            total: Number(data?.total) || 0,
            inquiries: Array.isArray(data?.inquiries)
                ? data.inquiries
                : []
        };
    }

    /* =====================================================
       14. حماية الصفحات الخاصة
    ===================================================== */

    async function requireAuth(options = {}) {
        await refreshSession();

        if (currentUser) {
            return currentUser;
        }

        const redirect = cleanRedirect(
            options.redirect || getCurrentReturnUrl()
        );

        window.location.replace(
            buildLoginUrl("login", redirect)
        );

        return null;
    }

    /* =====================================================
       15. معالجة روابط المصادقة
    ===================================================== */

    async function handleAuthCallback() {
        if (!supabase) return false;

        const url = new URL(window.location.href);

        const hasCode = url.searchParams.has("code");

        const hash = url.hash || "";

        if (
            url.searchParams.get("type") === "recovery" ||
            hash.includes("type=recovery")
        ) {
            recoveryMode = true;
        }

        if (hasCode) {
            const { data, error } =
                await supabase.auth.exchangeCodeForSession(
                    window.location.href
                );

            if (error) {
                throw new Error(getSafeError(error));
            }

            currentSession = data.session || null;
            currentUser = data.user || null;
            initialized = true;
        }

        return hasCode;
    }

    /* =====================================================
       16. إنشاء عنصر الحساب في الهيدر
    ===================================================== */

    function createAccountHeaderItem() {
        const nav = document.querySelector(".nav");

        if (!nav) return;

        let link = nav.querySelector(
            "[data-ibr-account-link]"
        );

        if (!link) {
            link = document.createElement("a");

            link.setAttribute(
                "data-ibr-account-link",
                ""
            );

            link.className = "ibr-account-nav";

            nav.appendChild(link);
        }

        link.href = currentUser
            ? CONFIG.accountPage
            : buildLoginUrl("login", getCurrentReturnUrl());

        link.classList.toggle(
            "is-authenticated",
            Boolean(currentUser)
        );

        link.innerHTML = "";

        const icon = document.createElement("span");

        icon.className = "ibr-account-icon";

        icon.setAttribute("aria-hidden", "true");

        icon.innerHTML = `
            <svg viewBox="0 0 24 24"
                 width="19"
                 height="19"
                 fill="none"
                 stroke="currentColor"
                 stroke-width="1.7"
                 stroke-linecap="round"
                 stroke-linejoin="round">
                <circle cx="12" cy="8" r="3.5"></circle>
                <path d="M5 20c.5-3.7 3.1-5.7 7-5.7s6.5 2 7 5.7"></path>
            </svg>
        `;

        const text = document.createElement("span");

        text.className = "ibr-account-label";

        if (currentUser) {
            const greeting = document.createElement("small");

            greeting.className = "ibr-account-greeting";
            greeting.textContent = "أهلاً بك";

            const name = document.createElement("strong");

            name.className = "ibr-account-name";
            name.textContent = getCustomerName();

            text.append(greeting, name);

        } else {
            const label = document.createElement("strong");

            label.textContent = "تسجيل الدخول";

            text.appendChild(label);
        }

        link.append(icon, text);

        link.setAttribute(
            "aria-label",
            currentUser
                ? "حساب العميل " + getCustomerName()
                : "تسجيل الدخول إلى حسابك"
        );
    }

    /* =====================================================
       17. تحديث عناصر الهيدر الموجودة
    ===================================================== */

    function updateHeader() {
        createAccountHeaderItem();

        document.querySelectorAll(
            "[data-ibr-login-only]"
        ).forEach(element => {
            element.hidden = !currentUser;
        });

        document.querySelectorAll(
            "[data-ibr-guest-only]"
        ).forEach(element => {
            element.hidden = Boolean(currentUser);
        });

        document.querySelectorAll(
            "[data-ibr-user-name]"
        ).forEach(element => {
            element.textContent = getCustomerName();
        });

        document.querySelectorAll(
            "[data-ibr-account-link]"
        ).forEach(link => {
            link.href = currentUser
                ? CONFIG.accountPage
                : buildLoginUrl(
                    "login",
                    getCurrentReturnUrl()
                );
        });
    }

    /* =====================================================
       18. نافذة الترحيب
    ===================================================== */

    function canShowWelcome() {
        if (currentUser) return false;

        if (
            CONFIG.welcomeExcludedPages.includes(
                getCurrentPage()
            )
        ) {
            return false;
        }

        try {
            return !sessionStorage.getItem(
                CONFIG.welcomeSessionKey
            );
        } catch (error) {
            return true;
        }
    }

    function closeWelcomeModal() {
        if (!welcomeModal) return;

        document.removeEventListener(
            "keydown",
            handleWelcomeKeydown
        );

        welcomeModal.classList.remove("is-visible");

        document.body.classList.remove(
            "ibr-welcome-open"
        );

        const modalToRemove = welcomeModal;

        welcomeModal = null;

        setTimeout(() => {
            modalToRemove.remove();
        }, 220);
    }

    function showWelcomeModal() {
        if (!canShowWelcome()) return;

        if (welcomeModal) return;

        try {
            sessionStorage.setItem(
                CONFIG.welcomeSessionKey,
                "1"
            );
        } catch (error) {
            // يستمر العرض دون تخزين إذا كان التخزين محظوراً.
        }

        const overlay = document.createElement("div");

        overlay.className = "ibr-welcome-overlay";

        overlay.setAttribute("role", "presentation");

        overlay.innerHTML = `
            <section
                class="ibr-welcome-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ibrWelcomeTitle"
                aria-describedby="ibrWelcomeDescription">

                <button
                    type="button"
                    class="ibr-welcome-close"
                    aria-label="إغلاق نافذة الترحيب">
                    ×
                </button>

                <div class="ibr-welcome-brand">
                    <div class="ibr-welcome-logo">IBR20</div>
                    <div class="ibr-welcome-brand-caption">
                        للأثاث الخشبي
                    </div>
                </div>

                <div class="ibr-welcome-divider"></div>

                <h2 id="ibrWelcomeTitle">
                    أهلاً بك في عالم IBR
                </h2>

                <p id="ibrWelcomeDescription">
                    نسعد بوجودك معنا. أنشئ حسابك واستمتع بتجربة تسوق أكثر سهولة.
                </p>

                <div class="ibr-welcome-actions">

                    <a
                        class="ibr-welcome-button ibr-welcome-login"
                        data-welcome-mode="login">
                        تسجيل الدخول
                    </a>

                    <a
                        class="ibr-welcome-button ibr-welcome-signup"
                        data-welcome-mode="signup">
                        إنشاء حساب جديد
                    </a>

                </div>

                <button
                    type="button"
                    class="ibr-welcome-guest">
                    أو متابعة تصفح المتجر كزائر
                </button>

            </section>
        `;

        document.body.appendChild(overlay);

        welcomeModal = overlay;

        const returnUrl = getCurrentReturnUrl();

        overlay.querySelectorAll(
            "[data-welcome-mode]"
        ).forEach(link => {
            const mode = link.dataset.welcomeMode;

            link.href = buildLoginUrl(
                mode,
                returnUrl
            );
        });

        overlay.querySelector(
            ".ibr-welcome-close"
        ).addEventListener("click", closeWelcomeModal);

        overlay.querySelector(
            ".ibr-welcome-guest"
        ).addEventListener("click", closeWelcomeModal);

        overlay.addEventListener("click", event => {
            if (event.target === overlay) {
                closeWelcomeModal();
            }
        });

        document.addEventListener(
            "keydown",
            handleWelcomeKeydown
        );

        document.body.classList.add(
            "ibr-welcome-open"
        );

        requestAnimationFrame(() => {
            overlay.classList.add("is-visible");

            overlay.querySelector(
                ".ibr-welcome-login"
            )?.focus();
        });
    }

    function handleWelcomeKeydown(event) {
        if (!welcomeModal) return;

        if (event.key === "Escape") {
            closeWelcomeModal();

            document.removeEventListener(
                "keydown",
                handleWelcomeKeydown
            );
        }
    }

        /* =====================================================
       19. توقيت ظهور النافذة
    ===================================================== */

    function updateWelcomeExperience() {
        if (currentUser) {
            closeWelcomeModal();
            return;
        }

        showWelcomeModal();
    }

    /* =====================================================
       20. الاستماع لتغيرات المصادقة
    ===================================================== */

    function setupAuthListener() {
        if (!supabase || authSubscription) return;

        const { data } =
            supabase.auth.onAuthStateChange(
                (event, session) => {
                    currentSession = session || null;
                    currentUser = session?.user || null;
                    initialized = true;

                    if (event === "PASSWORD_RECOVERY") {
                        recoveryMode = true;
                    }

                    if (
                        event === "SIGNED_OUT" ||
                        event === "SIGNED_IN"
                    ) {
                        if (event === "SIGNED_OUT") {
                            recoveryMode = false;
                        }
                    }

                    notifyListeners();

                    document.dispatchEvent(
                        new CustomEvent("ibr:auth-event", {
                            detail: {
                                event,
                                user: currentUser
                            }
                        })
                    );

                    updateWelcomeExperience();
                }
            );

        authSubscription =
            data?.subscription || null;
    }

    /* =====================================================
       21. التهيئة الموحدة
    ===================================================== */

    async function init() {
        if (initialized) {
            return getState();
        }

        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            supabase = getClient();

            if (!supabase) {
                console.error(
                    "IBR Auth: window.supabaseClient غير موجود. " +
                    "تأكد من تحميل store.js قبل auth.js."
                );

                return null;
            }

            try {
                // نبدأ الاستماع قبل فحص الجلسة حتى لا نفقد أحداث المصادقة.
                setupAuthListener();

                await handleAuthCallback();

                await refreshSession();

                updateHeader();

                if (isProtectedPage() && !currentUser) {
                    const redirect = cleanRedirect(
                        getCurrentReturnUrl()
                    );

                    window.location.replace(
                        buildLoginUrl("login", redirect)
                    );

                    return getState();
                }

                updateWelcomeExperience();

                return getState();

            } catch (error) {
                console.error(
                    "IBR Auth Initialization Error:",
                    error
                );

                return null;
            }
        })();

        return initPromise;
    }

    /* =====================================================
       22. الواجهة العامة
    ===================================================== */

    const IBRAuth = {
        version: "2.0.0",

        init,
        getState,
        getUser,
        getSession,
        isLoggedIn,
        subscribe,

        signUp,
        signIn,
        signOut,

        resetPassword,
        updatePassword,
        updateProfile,

        getMyOrders,
        getMyInquiries,
        getMyCustomerInquiries: getMyInquiries,

        requireAuth,

        updateHeader,
        getSafeError,

        handleAuthCallback,

        showWelcomeModal,
        closeWelcomeModal,

        getCustomerName
    };

    /* =====================================================
       23. ربط النظام بالصفحة
    ===================================================== */

    window.IBRAuth = IBRAuth;

    /* =====================================================
       24. التشغيل التلقائي
    ===================================================== */

    function start() {
        init();
    }

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