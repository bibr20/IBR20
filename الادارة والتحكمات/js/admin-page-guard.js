/* =========================================================
   IBR20 ADMIN — PAGE ACCESS GUARD
   حماية صفحات الإدارة بعد التحقق من صلاحية المدير

   Version: 2.0
========================================================= */

(() => {

    "use strict";


    /* =====================================================
       1. منع تشغيل الحماية أكثر من مرة
    ===================================================== */

    if (window.IBRAdminPageGuardInitialized) {

        return;

    }

    window.IBRAdminPageGuardInitialized = true;



    /* =====================================================
       2. بدء التحقق بعد تحميل الصفحة
    ===================================================== */

    document.addEventListener("DOMContentLoaded", async () => {


        /* -------------------------------------------------
           عناصر الصفحة الأساسية
        ------------------------------------------------- */

        const loading = document.querySelector(
            "[data-admin-loading]"
        );


        const content = document.querySelector(
            "[data-admin-content]"
        );


        const emailElement = document.querySelector(
            "[data-admin-email]"
        );



        /* =================================================
           3. إخفاء المحتوى المحمي
        ================================================= */

        function hideContent() {

            if (content) {

                content.hidden = true;

            }

        }



        /* =================================================
           4. عرض شاشة التحميل
        ================================================= */

        function showLoading(message = "جارٍ التحقق من صلاحية الدخول...") {

            if (!loading) {

                return;

            }


            loading.hidden = false;


            const paragraph = loading.querySelector("p");


            if (paragraph) {

                paragraph.textContent = message;

            } else {

                loading.textContent = message;

            }

        }



        /* =================================================
           5. عرض رسالة الخطأ
        ================================================= */

        function showError(message) {

            hideContent();


            if (loading) {

                loading.hidden = false;


                loading.innerHTML = `

                    <div class="admin-loading-content">

                        <div class="admin-loading-error-icon">
                            !
                        </div>

                        <h2>تعذر فتح صفحة الإدارة</h2>

                        <p>${escapeText(message)}</p>

                        <button
                            type="button"
                            class="admin-retry-button"
                            data-admin-retry>

                            إعادة المحاولة

                        </button>

                    </div>

                `;


                const retryButton = loading.querySelector(
                    "[data-admin-retry]"
                );


                if (retryButton) {

                    retryButton.addEventListener("click", () => {

                        window.location.reload();

                    });

                }

            }


            console.error(

                "IBR Admin Page Guard:",

                message

            );

        }



        /* =================================================
           6. حماية النصوص داخل رسائل الخطأ
        ================================================= */

        function escapeText(value) {

            return String(value ?? "").replace(/[&<>"']/g, character => ({

                "&": "&amp;",

                "<": "&lt;",

                ">": "&gt;",

                '"': "&quot;",

                "'": "&#039;"

            })[character]);

        }



        /* =================================================
           7. التحقق من عناصر الحماية
        ================================================= */

        try {

            // يجب توفر شاشة التحميل
            if (!loading) {

                throw new Error(
                    "عنصر شاشة تحميل الإدارة غير موجود في HTML."
                );

            }


            // يجب توفر محتوى الصفحة
            if (!content) {

                throw new Error(
                    "عنصر محتوى الإدارة غير موجود في HTML."
                );

            }


            // إخفاء الصفحة حتى اكتمال التحقق
            hideContent();


            showLoading();



            /* =============================================
               8. التأكد من تحميل نظام الإدارة المشترك
            ============================================== */

            if (!window.IBRAdmin) {

                throw new Error(
                    "لم يتم تحميل admin-common.js. تحقق من مسار الملف."
                );

            }



            /* =============================================
               9. التأكد من وجود اتصال Supabase
            ============================================== */

            if (!window.supabaseClient) {

                throw new Error(
                    "اتصال Supabase غير متوفر. تحقق من تحميل store.js."
                );

            }



            /* =============================================
               10. التحقق من صلاحية المدير
            ============================================== */

            const user = await window.IBRAdmin.requireAdmin({

                redirectTo: "admin.html"

            });



            // إذا لم يكن المستخدم مديراً
            // ستتولى requireAdmin إعادة توجيهه
            if (!user) {

                return;

            }



            /* =============================================
               11. التأكد من اعتماد صلاحية المدير
            ============================================== */

            if (!window.IBRAdmin.isAdminVerified()) {

                throw new Error(
                    "تعذر اعتماد صلاحية المدير."
                );

            }



            /* =============================================
               12. عرض بيانات المدير
            ============================================== */

            if (emailElement) {

                emailElement.textContent = user.email || "المدير";

            }



            /* =============================================
               13. إظهار المحتوى بعد نجاح التحقق
            ============================================== */

            content.hidden = false;

            loading.hidden = true;



            /* =============================================
               14. تسجيل حالة نجاح الحماية
            ============================================== */

            document.documentElement.setAttribute(

                "data-admin-authorized",

                "true"

            );


            console.info(

                "IBR Admin: Page access verified successfully."

            );



        } catch (error) {


            /* =============================================
               15. التعامل مع أخطاء التحقق
            ============================================== */

            console.error(

                "IBR Admin Page Guard Error:",

                error

            );


            document.documentElement.removeAttribute(

                "data-admin-authorized"

            );


            showError(

                error.message ||

                "تعذر تحميل صفحة الإدارة. يرجى تحديث الصفحة أو تسجيل الدخول مجدداً."

            );

        }

    });

})();