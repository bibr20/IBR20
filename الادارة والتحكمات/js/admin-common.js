/* =========================================================
   IBR20 ADMIN — COMMON JAVASCRIPT
   الوظائف المشتركة والحماية لجميع صفحات الإدارة
   Version: 2.0
========================================================= */

(() => {

    "use strict";


    /* =====================================================
       1. الإعدادات العامة
    ===================================================== */

    const CONFIG = Object.freeze({

        loginPage: "admin.html",

        roleTable: "user_roles",

        requiredRole: "admin",

        sessionCheckTimeout: 12000

    });


    let currentAdmin = null;

    let currentRoleVerified = false;

    let authSubscription = null;



    /* =====================================================
       2. الوصول إلى Supabase
    ===================================================== */

    function getClient() {

        const client = window.supabaseClient;

        if (
            !client ||
            !client.auth ||
            typeof client.from !== "function" ||
            typeof client.rpc !== "function"
        ) {

            throw new Error(
                "لم يتم العثور على اتصال Supabase. تأكد من تحميل store.js وتهيئته بشكل صحيح."
            );

        }

        return client;

    }



    /* =====================================================
       3. أدوات عامة
    ===================================================== */

    function escapeHTML(value) {

        return String(value ?? "").replace(/[&<>"']/g, character => ({

            "&": "&amp;",

            "<": "&lt;",

            ">": "&gt;",

            '"': "&quot;",

            "'": "&#039;"

        })[character]);

    }



    function formatCurrency(value) {

        const amount = Number(value);

        if (!Number.isFinite(amount)) {

            return "—";

        }

        return new Intl.NumberFormat("ar-SA", {

            style: "currency",

            currency: "SAR",

            maximumFractionDigits: 2

        }).format(amount);

    }



    function formatDate(value, includeTime = true) {

        if (!value) {

            return "—";

        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {

            return "—";

        }

        return new Intl.DateTimeFormat("ar-SA", {

            year: "numeric",

            month: "long",

            day: "numeric",

            ...(includeTime ? {

                hour: "2-digit",

                minute: "2-digit"

            } : {})

        }).format(date);

    }



    function debounce(callback, delay = 300) {

        let timeout = null;

        return (...args) => {

            clearTimeout(timeout);

            timeout = setTimeout(() => {

                callback(...args);

            }, delay);

        };

    }



    function getElement(id) {

        return document.getElementById(id);

    }



    /* =====================================================
       4. رسائل التنبيه
    ===================================================== */

    function showAlert(elementOrId, message, type = "info") {

        const element = typeof elementOrId === "string"

            ? getElement(elementOrId)

            : elementOrId;


        if (!element) {

            return;

        }


        const allowedTypes = [

            "success",

            "error",

            "warning",

            "info"

        ];


        const safeType = allowedTypes.includes(type)

            ? type

            : "info";


        element.textContent = message || "";

        element.className = `admin-alert admin-alert-${safeType}`;

        element.hidden = !message;

        element.setAttribute("role", "status");

        element.setAttribute("aria-live", "polite");

    }



    function clearAlert(elementOrId) {

        const element = typeof elementOrId === "string"

            ? getElement(elementOrId)

            : elementOrId;


        if (!element) {

            return;

        }


        element.textContent = "";

        element.hidden = true;

        element.removeAttribute("role");

        element.removeAttribute("aria-live");

    }



    /* =====================================================
       5. التحقق من جلسة Supabase
    ===================================================== */

    async function getCurrentUser() {

        const client = getClient();

        let timeoutId;


        try {

            const result = await Promise.race([

                client.auth.getUser(),


                new Promise((_, reject) => {

                    timeoutId = setTimeout(() => {

                        reject(

                            new Error(
                                "انتهت مهلة التحقق من جلسة تسجيل الدخول."
                            )

                        );

                    }, CONFIG.sessionCheckTimeout);

                })

            ]);


            if (result.error) {

                throw result.error;

            }


            return result.data?.user || null;


        } finally {

            clearTimeout(timeoutId);

        }

    }



    /* =====================================================
       6. التحقق من صلاحية المدير
    ===================================================== */

    async function verifyAdmin() {

        currentAdmin = null;

        currentRoleVerified = false;


        const client = getClient();


        // التحقق من المستخدم الحالي
        const user = await getCurrentUser();


        if (!user) {

            return {

                authorized: false,

                reason: "not_logged_in",

                user: null

            };

        }


        try {

            // التحقق من صلاحية المدير عبر دالة قاعدة البيانات
            const { data, error } = await client.rpc("is_admin");


            if (error) {

                console.error(

                    "IBR Admin RPC verification failed:",

                    error

                );


                return {

                    authorized: false,

                    reason: "role_check_failed",

                    user: null

                };

            }


            // يجب أن تكون النتيجة true بشكل صريح
            if (data !== true) {

                return {

                    authorized: false,

                    reason: "not_admin",

                    user: null

                };

            }


            // حفظ المستخدم بعد نجاح التحقق
            currentAdmin = user;

            currentRoleVerified = true;


            return {

                authorized: true,

                reason: null,

                user: user

            };


        } catch (error) {

            console.error(

                "IBR Admin verification error:",

                error

            );


            currentAdmin = null;

            currentRoleVerified = false;


            return {

                authorized: false,

                reason: "role_check_failed",

                user: null

            };

        }

    }



    /* =====================================================
       7. حماية صفحات الإدارة الداخلية
    ===================================================== */

    async function requireAdmin(options = {}) {

        const redirectTo = options.redirectTo ?? CONFIG.loginPage;

        const feedbackId = options.feedbackId || null;


        try {

            const result = await verifyAdmin();


            if (result.authorized) {

                return result.user;

            }


            if (feedbackId) {

                showAlert(

                    feedbackId,

                    result.reason === "not_admin"

                        ? "هذا الحساب لا يمتلك صلاحية إدارة المتجر."

                        : result.reason === "role_check_failed"

                            ? "تعذر التحقق من صلاحيات المدير. يرجى المحاولة مجدداً."

                            : "يرجى تسجيل الدخول بحساب المدير.",

                    "warning"

                );

            }


            if (redirectTo) {

                redirectToPage(redirectTo);

            }


            return null;


        } catch (error) {

            console.error(

                "IBR Admin access verification error:",

                error

            );


            if (feedbackId) {

                showAlert(

                    feedbackId,

                    "تعذر التحقق من صلاحيات الإدارة. يرجى تسجيل الدخول مجدداً.",

                    "error"

                );

            }


            if (redirectTo) {

                redirectToPage(redirectTo);

            }


            return null;

        }

    }



    /* =====================================================
       8. الانتقال الآمن بين صفحات الإدارة
    ===================================================== */

    function redirectToPage(destination) {

        try {

            const target = new URL(

                destination,

                window.location.href

            );


            // منع الانتقال إلى نطاق خارجي
            if (target.origin !== window.location.origin) {

                console.error(

                    "IBR Admin: External redirect blocked."

                );

                return;

            }


            // منع إعادة تحميل الصفحة نفسها
            if (target.href === window.location.href) {

                return;

            }


            window.location.replace(target.href);


        } catch (error) {

            console.error(

                "IBR Admin redirect error:",

                error

            );

        }

    }



    /* =====================================================
       9. تسجيل الدخول
    ===================================================== */

    async function signIn(email, password) {

        const client = getClient();


        const cleanEmail = String(email || "").trim();


        if (!cleanEmail || !password) {

            throw new Error(

                "يرجى إدخال البريد الإلكتروني وكلمة المرور."

            );

        }


        // تسجيل الدخول
        const { data, error } = await client.auth.signInWithPassword({

            email: cleanEmail,

            password: password

        });


        if (error) {

            throw error;

        }


        if (!data.user) {

            throw new Error(

                "لم يتم العثور على بيانات المستخدم بعد تسجيل الدخول."

            );

        }


        // التحقق من صلاحية المدير
        const verification = await verifyAdmin();


        if (!verification.authorized) {

            await client.auth.signOut();


            currentAdmin = null;

            currentRoleVerified = false;


            throw new Error(

                verification.reason === "role_check_failed"

                    ? "تعذر التحقق من صلاحيات المدير. حاول مرة أخرى."

                    : "تم رفض الدخول: الحساب لا يمتلك صلاحية المدير."

            );

        }


        return {

            user: verification.user,

            session: data.session

        };

    }



    /* =====================================================
       10. تسجيل الخروج
    ===================================================== */

    async function signOut(options = {}) {

        const client = getClient();


        const redirectTo = options.redirectTo ?? CONFIG.loginPage;


        const { error } = await client.auth.signOut();


        if (error) {

            throw error;

        }


        currentAdmin = null;

        currentRoleVerified = false;


        if (redirectTo) {

            redirectToPage(redirectTo);

        }

    }



    /* =====================================================
       11. بيانات المدير الحالي
    ===================================================== */

    function getAdmin() {

        if (

            !currentRoleVerified ||

            !currentAdmin

        ) {

            return null;

        }


        return currentAdmin;

    }



    function isAdminVerified() {

        return (

            currentRoleVerified &&

            Boolean(currentAdmin)

        );

    }



    /* =====================================================
       12. القائمة الجانبية للجوال
    ===================================================== */

    function setupSidebar() {

        const sidebar =

            getElement("admin-sidebar") ||

            document.querySelector(".admin-sidebar");


        const menuButton =

            getElement("admin-mobile-menu") ||

            document.querySelector("[data-admin-menu-toggle]");


        const overlay =

            getElement("admin-sidebar-overlay") ||

            document.querySelector(

                "[data-admin-sidebar-overlay], .admin-sidebar-overlay"

            );


        if (!sidebar || !menuButton) {

            console.warn(

                "IBR Admin: Sidebar elements were not found."

            );

            return;

        }


        // منع تكرار ربط الأحداث
        if (menuButton.dataset.sidebarReady === "true") {

            return;

        }


        menuButton.dataset.sidebarReady = "true";


        // إغلاق القائمة
        function closeSidebar() {

            sidebar.classList.remove("open");

            document.body.classList.remove("admin-menu-open");


            menuButton.setAttribute(

                "aria-expanded",

                "false"

            );


            if (overlay) {

                overlay.hidden = true;

                overlay.setAttribute(

                    "aria-hidden",

                    "true"

                );

            }

        }


        // فتح القائمة
        function openSidebar() {

            sidebar.classList.add("open");

            document.body.classList.add("admin-menu-open");


            menuButton.setAttribute(

                "aria-expanded",

                "true"

            );


            if (overlay) {

                overlay.hidden = false;

                overlay.setAttribute(

                    "aria-hidden",

                    "false"

                );

            }

        }


        // الحالة الابتدائية
        closeSidebar();


        // زر فتح وإغلاق القائمة
        menuButton.addEventListener("click", () => {

            if (sidebar.classList.contains("open")) {

                closeSidebar();

            } else {

                openSidebar();

            }

        });


        // الضغط على الخلفية يغلق القائمة
        if (overlay) {

            overlay.addEventListener(

                "click",

                closeSidebar

            );

        }


        // الضغط على رابط يغلق القائمة
        sidebar.querySelectorAll(".admin-nav-link").forEach(link => {

            link.addEventListener("click", closeSidebar);

        });


        // زر Escape
        document.addEventListener("keydown", event => {

            if (event.key === "Escape") {

                closeSidebar();

            }

        });


        // إغلاق القائمة عند الانتقال إلى شاشة الكمبيوتر
        window.addEventListener("resize", () => {

            if (window.innerWidth > 760) {

                closeSidebar();

            }

        });

    }



    /* =====================================================
       13. تفعيل رابط الصفحة الحالية
    ===================================================== */

    function setActiveNavigation() {

        const currentFile = window.location.pathname

            .split("/")

            .pop()

            .toLowerCase();


        document.querySelectorAll(".admin-nav-link").forEach(link => {

            let linkFile = "";


            try {

                linkFile = new URL(

                    link.href,

                    window.location.href

                ).pathname

                    .split("/")

                    .pop()

                    .toLowerCase();

            } catch (error) {

                return;

            }


            const active = linkFile === currentFile;


            link.classList.toggle(

                "active",

                active

            );


            if (active) {

                link.setAttribute(

                    "aria-current",

                    "page"

                );

            } else {

                link.removeAttribute("aria-current");

            }

        });

    }



    /* =====================================================
       14. أزرار تسجيل الخروج
    ===================================================== */

    function setupLogoutButtons() {

        const buttons = document.querySelectorAll(

            "[data-admin-logout]"

        );


        buttons.forEach(button => {

            if (button.dataset.logoutReady === "true") {

                return;

            }


            button.dataset.logoutReady = "true";


            button.addEventListener("click", async () => {

                const originalText = button.textContent;


                if (button.disabled) {

                    return;

                }


                button.disabled = true;

                button.textContent = "جارٍ تسجيل الخروج...";


                try {

                    await signOut();


                } catch (error) {

                    console.error(

                        "IBR Admin logout error:",

                        error

                    );


                    button.disabled = false;

                    button.textContent = originalText;


                    alert(

                        "تعذر تسجيل الخروج. يرجى المحاولة مرة أخرى."

                    );

                }

            });

        });

    }



    /* =====================================================
       15. التحكم في المحتوى المحمي
    ===================================================== */

    function hideProtectedContent() {

        document.querySelectorAll(

            "[data-admin-protected]"

        ).forEach(element => {

            element.hidden = true;

        });

    }



    function showProtectedContent() {

        if (!isAdminVerified()) {

            return;

        }


        document.querySelectorAll(

            "[data-admin-protected]"

        ).forEach(element => {

            element.hidden = false;

        });

    }



    /* =====================================================
       16. مراقبة تغيّر جلسة الدخول
    ===================================================== */

    function watchAuthChanges(callback) {

        const client = getClient();


        // إلغاء الاشتراك السابق إن وجد
        if (authSubscription) {

            authSubscription.unsubscribe();

            authSubscription = null;

        }


        const result = client.auth.onAuthStateChange(

            (event, session) => {


                if (event === "SIGNED_OUT") {

                    currentAdmin = null;

                    currentRoleVerified = false;

                }


                if (typeof callback === "function") {

                    callback(event, session);

                }

            }

        );


        authSubscription = result.data?.subscription || null;


        return result;

    }



    /* =====================================================
       17. فحص الاتصال
    ===================================================== */

    async function checkConnection() {

        try {

            const client = getClient();


            const { data, error } = await client.auth.getSession();


            if (error) {

                throw error;

            }


            return {

                connected: true,

                hasSession: Boolean(data.session),

                error: null

            };


        } catch (error) {

            console.error(

                "IBR Supabase connection check:",

                error

            );


            return {

                connected: false,

                hasSession: false,

                error: error.message

            };

        }

    }



    /* =====================================================
       18. واجهة الاستخدام المشتركة
    ===================================================== */

    window.IBRAdmin = Object.freeze({

        config: CONFIG,


        // Supabase
        getClient,

        getCurrentUser,


        // الحماية
        verifyAdmin,

        requireAdmin,

        isAdminVerified,


        // الحساب
        signIn,

        signOut,

        getAdmin,


        // الأدوات
        escapeHTML,

        formatCurrency,

        formatDate,

        debounce,

        getElement,


        // التنبيهات
        showAlert,

        clearAlert,


        // القائمة والتنقل
        setupSidebar,

        setActiveNavigation,

        setupLogoutButtons,


        // المحتوى المحمي
        hideProtectedContent,

        showProtectedContent,


        // الجلسة والاتصال
        watchAuthChanges,

        checkConnection

    });



    /* =====================================================
       19. تهيئة الوظائف المشتركة
    ===================================================== */

    document.addEventListener("DOMContentLoaded", () => {

        setupSidebar();

        setActiveNavigation();

        setupLogoutButtons();

    });


})();