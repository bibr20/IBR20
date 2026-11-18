
/* =========================================================
   IBR20 ANALYTICS CONSENT
   واجهة الموافقة على التحليلات وإعدادات الخصوصية
   Version: 1.0.0
========================================================= */

(function () {

    "use strict";

    if (window.IBRAnalyticsConsentLoaded) {
        return;
    }

    window.IBRAnalyticsConsentLoaded = true;

    const CONFIG = {
        consentKey: "ibr-analytics-consent-v1",
        metaKey: "ibr-analytics-consent-meta-v1",
        policyVersion: "1.0.0"
    };

    const ANALYTICS = window.IBRAnalytics;

    if (
        !ANALYTICS ||
        typeof ANALYTICS.setConsent !== "function"
    ) {
        console.error(
            "IBR20: Analytics engine must load before consent."
        );
        return;
    }

    let banner = null;
    let settingsButton = null;
    let detailsElement = null;

    /* =====================================================
       STORAGE
    ===================================================== */

    function storageGet(key) {

        try {
            return localStorage.getItem(key);
        } catch (error) {
            return null;
        }

    }

    function storageSet(key, value) {

        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            console.warn(
                "IBR20: Could not save privacy preference."
            );
            return false;
        }

    }

    function saveDecision(decision) {

        const metadata = {

            decision: decision,

            policyVersion: CONFIG.policyVersion,

            decidedAt: new Date().toISOString()

        };

        return storageSet(
            CONFIG.metaKey,
            JSON.stringify(metadata)
        );

    }



    function getDecision() {

        const value = storageGet(
            CONFIG.consentKey
        );

        const rawMetadata = storageGet(
            CONFIG.metaKey
        );

        if (!rawMetadata) {
            return null;
        }

        try {

            const metadata = JSON.parse(rawMetadata);

            if (
                !metadata ||
                metadata.policyVersion !== CONFIG.policyVersion ||
                (
                    metadata.decision !== "granted" &&
                    metadata.decision !== "denied"
                )
            ) {
                return null;
            }

            if (value !== metadata.decision) {
                return null;
            }

            return metadata.decision;

        } catch (error) {

            return null;

        }

    }


    /* =====================================================
       STYLES
    ===================================================== */

    function injectStyles() {

        if (
            document.getElementById(
                "ibr-privacy-styles"
            )
        ) {
            return;
        }

        const style = document.createElement("style");

        style.id = "ibr-privacy-styles";

        style.textContent = `

            .ibr-privacy-banner,
            .ibr-privacy-banner *,
            .ibr-privacy-settings,
            .ibr-privacy-settings * {
                box-sizing: border-box;
            }

            .ibr-privacy-banner {
                position: fixed;
                z-index: 999990;
                bottom: 0;
                right: 0;
                left: 0;
                width: 100%;
                padding: 22px 24px;
                background: #fbf8f2;
                color: #49382b;
                border-top: 1px solid #e8ded0;
                box-shadow: 0 -8px 35px rgba(50, 35, 22, .12);
                font-family: inherit;
                direction: rtl;
                animation: ibrPrivacyEnter .3s ease;
            }

            .ibr-privacy-inner {
                width: 100%;
                max-width: 1180px;
                margin: auto;
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 28px;
            }

            .ibr-privacy-content {
                flex: 1;
                min-width: 0;
            }

            .ibr-privacy-title {
                margin: 0 0 9px;
                color: #49382b;
                font-size: 17px;
                font-weight: 700;
                line-height: 1.6;
            }

            .ibr-privacy-description {
                margin: 0;
                color: #76695d;
                font-size: 13px;
                line-height: 1.9;
            }

            .ibr-privacy-details {
                margin-top: 10px;
            }

            .ibr-privacy-details summary {
                display: inline-block;
                cursor: pointer;
                color: #8a6748;
                font-size: 13px;
                font-weight: 700;
                text-decoration: underline;
                text-underline-offset: 4px;
            }

            .ibr-privacy-details-content {
                margin-top: 12px;
                padding: 13px 15px;
                background: #f4eee5;
                border: 1px solid #e8ded0;
                border-radius: 10px;
                color: #66584b;
                font-size: 12px;
                line-height: 2;
            }

            .ibr-privacy-details-content p {
                margin: 0 0 7px;
            }

            .ibr-privacy-details-content p:last-child {
                margin-bottom: 0;
            }

            .ibr-privacy-actions {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: flex-start;
                gap: 9px;
                min-width: 275px;
            }

            .ibr-privacy-btn {
                min-height: 43px;
                padding: 10px 17px;
                border-radius: 7px;
                border: 1px solid transparent;
                cursor: pointer;
                font-family: inherit;
                font-size: 12px;
                font-weight: 700;
                transition:
                    background .2s ease,
                    border-color .2s ease,
                    transform .2s ease;
            }

            .ibr-privacy-btn:hover {
                transform: translateY(-1px);
            }

            .ibr-privacy-btn:focus-visible,
            .ibr-privacy-settings:focus-visible,
            .ibr-privacy-details summary:focus-visible {
                outline: 3px solid #b58b61;
                outline-offset: 3px;
            }

            .ibr-privacy-allow {
                background: #634a35;
                color: #fff;
            }

            .ibr-privacy-allow:hover {
                background: #4f3928;
            }

            .ibr-privacy-reject {
                background: transparent;
                color: #634a35;
                border-color: #d9cabb;
            }

            .ibr-privacy-reject:hover {
                background: #f1e9df;
            }

            .ibr-privacy-settings {
                position: fixed;
                z-index: 999989;
                right: 18px;
                bottom: 16px;
                display: none;
                align-items: center;
                justify-content: center;
                min-height: 39px;
                padding: 9px 15px;
                border: 1px solid #d9cabb;
                border-radius: 25px;
                background: #fbf8f2;
                color: #634a35;
                box-shadow: 0 3px 15px rgba(50, 35, 22, .12);
                font-family: inherit;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                transition: background .2s ease;
            }

            .ibr-privacy-settings:hover {
                background: #f1e9df;
            }

            .ibr-privacy-settings.ibr-visible {
                display: inline-flex;
            }

            .ibr-privacy-banner button:disabled {
                opacity: .6;
                cursor: wait;
            }

            @keyframes ibrPrivacyEnter {
                from {
                    opacity: 0;
                    transform: translateY(15px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            @media (max-width: 700px) {

                .ibr-privacy-banner {
                    padding: 18px 15px;
                    max-height: 85vh;
                    overflow-y: auto;
                }

                .ibr-privacy-inner {
                    flex-direction: column;
                    gap: 17px;
                }

                .ibr-privacy-title {
                    font-size: 15px;
                }

                .ibr-privacy-description {
                    font-size: 12px;
                }

                .ibr-privacy-actions {
                    width: 100%;
                    min-width: 0;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                }

                .ibr-privacy-btn {
                    width: 100%;
                    padding: 11px 8px;
                    font-size: 11px;
                }

                .ibr-privacy-settings {
                    right: 12px;
                    bottom: 12px;
                }

            }

            @media (prefers-reduced-motion: reduce) {

                .ibr-privacy-banner {
                    animation: none;
                }

                .ibr-privacy-btn {
                    transition: none;
                }

            }

        `;

        document.head.appendChild(style);

    }

    /* =====================================================
       CREATE SETTINGS BUTTON
    ===================================================== */

    function createSettingsButton() {

        if (settingsButton) {
            return;
        }

        settingsButton = document.createElement("button");

        settingsButton.type = "button";

        settingsButton.className =
            "ibr-privacy-settings";

        settingsButton.textContent =
            "إعدادات الخصوصية";

        settingsButton.setAttribute(
            "aria-label",
            "تغيير إعدادات الخصوصية والتحليلات"
        );

        settingsButton.addEventListener(
            "click",
            function () {
                showBanner(true);
            }
        );

        document.body.appendChild(settingsButton);

    }

    /* =====================================================
       CREATE CONSENT BANNER
    ===================================================== */

    function createBanner() {

        if (banner) {
            return;
        }

        banner = document.createElement("section");

        banner.className = "ibr-privacy-banner";

        banner.id = "ibr-privacy-banner";

        banner.setAttribute(
            "aria-label",
            "إعدادات الخصوصية"
        );

        banner.setAttribute(
            "aria-live",
            "polite"
        );

        banner.innerHTML = `

            <div class="ibr-privacy-inner">

                <div class="ibr-privacy-content">

                    <h2 class="ibr-privacy-title">
                        خصوصيتك تهمنا في IBR
                    </h2>

                    <p class="ibr-privacy-description">
                        نستخدم التحليلات الاختيارية لفهم كيفية
                        استخدام المتجر وتحسين تجربة التصفح
                        واكتشاف المنتجات وتطوير خدماتنا.
                        يمكنك السماح بها أو رفضها.
                    </p>

                    <details class="ibr-privacy-details">

                        <summary>
                            تفاصيل استخدام البيانات
                        </summary>

                        <div class="ibr-privacy-details-content">

                            <p>
                                <strong>ما الذي نجمعه؟</strong>
                                أحداث التصفح ومشاهدة المنتجات
                                والتصنيفات والبحث والتفاعل مع
                                التوصيات والسلة وإتمام الطلبات
                                والاستفسارات بعد نجاح العمليات.
                            </p>

                            <p>
                                <strong>كيف نستخدمها؟</strong>
                                لفهم أداء المتجر وتحسين عرض
                                المنتجات وتجربة العملاء وقياس
                                فعالية التوصيات ومسار الشراء.
                            </p>

                            <p>
                                <strong>ما الذي لا نضعه في
                                أحداث التحليلات؟</strong>
                                لا نسجل نص البحث نفسه أو أسماء
                                العملاء أو أرقام هواتفهم أو
                                عناوين بريدهم ضمن أحداث التحليلات.
                                ولا نستخدم بصمة الجهاز لتعريف الزائر.
                            </p>

                            <p>
                                <strong>معرّفات التحليلات:</strong>
                                قد نستخدم معرّفاً عشوائياً للزائر
                                ومعرّفاً للجلسة لقياس الزيارات
                                والتفاعلات بصورة إحصائية.
                            </p>

                            <p>
                                <strong>مدة الاحتفاظ:</strong>
                                يجب أن تكون مدة الاحتفاظ بالبيانات
                                محددة ومعلنة في سياسة الخصوصية
                                المعتمدة قبل الإطلاق النهائي.
                            </p>

                            <p>
                                يمكنك رفض التحليلات الاختيارية
                                أو تغيير قرارك لاحقاً من زر
                                إعدادات الخصوصية.
                            </p>

                        </div>

                    </details>

                </div>

                <div class="ibr-privacy-actions">

                    <button
                        type="button"
                        class="ibr-privacy-btn ibr-privacy-allow"
                        data-ibr-consent="allow"
                    >
                        السماح بالتحليلات
                    </button>

                    <button
                        type="button"
                        class="ibr-privacy-btn ibr-privacy-reject"
                        data-ibr-consent="reject"
                    >
                        رفض التحليلات الاختيارية
                    </button>

                </div>

            </div>

        `;

        banner.addEventListener(
            "click",
            handleBannerClick
        );

        document.body.appendChild(banner);

    }

    /* =====================================================
       SHOW / HIDE
    ===================================================== */

    function showBanner(openSettings) {

        createBanner();

        createSettingsButton();

        banner.style.display = "block";

        settingsButton.classList.remove(
            "ibr-visible"
        );

        if (openSettings && detailsElement) {
            detailsElement.open = true;
        }

        detailsElement =
            banner.querySelector(
                ".ibr-privacy-details"
            );

        if (openSettings && detailsElement) {
            detailsElement.open = true;
        }

        const firstButton =
            banner.querySelector(
                '[data-ibr-consent="allow"]'
            );

        if (firstButton) {
            firstButton.focus();
        }

    }

    function hideBanner() {

        if (banner) {
            banner.style.display = "none";
        }

        if (settingsButton) {
            settingsButton.classList.add(
                "ibr-visible"
            );
        }

    }

    /* =====================================================
       SAVE CONSENT DECISION
    ===================================================== */


    function chooseConsent(granted) {

        const decision = granted
            ? "granted"
            : "denied";

        // نحفظ القرار وبيانات السياسة أولاً.
        const savedDecision = storageSet(
            CONFIG.consentKey,
            decision
        );

        const savedMetadata = saveDecision(
            decision
        );

        // لا نفعّل التحليلات إذا تعذر حفظ الموافقة.
        if (!savedDecision || !savedMetadata) {

            storageRemove(CONFIG.consentKey);

            storageRemove(CONFIG.metaKey);

            console.error(
                "تعذر حفظ إعداد الخصوصية."
            );

            return;

        }

        // تطبيق القرار على محرك التحليلات.
        try {

            const applied = ANALYTICS.setConsent(
                granted === true
            );

            if (applied !== true) {

                storageRemove(CONFIG.consentKey);

                storageRemove(CONFIG.metaKey);

                console.error(
                    "تعذر تطبيق إعداد الخصوصية."
                );

                return;

            }

        } catch (error) {

            storageRemove(CONFIG.consentKey);

            storageRemove(CONFIG.metaKey);

            console.error(
                "IBR20 Analytics Consent Error:",
                error
            );

            return;

        }

        // إخفاء الشريط بعد نجاح الحفظ والتطبيق.
        hideBanner();

    }

    /* =====================================================
       BANNER ACTIONS
    ===================================================== */

    function handleBannerClick(event) {

        const button = event.target.closest(
            "[data-ibr-consent]"
        );

        if (!button) {
            return;
        }

        const action = button.getAttribute(
            "data-ibr-consent"
        );

        if (action === "allow") {
            chooseConsent(true);
        }

        if (action === "reject") {
            chooseConsent(false);
        }

    }

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    function initialize() {

        injectStyles();

        createSettingsButton();

        const decision = getDecision();

        if (decision === "granted") {

            ANALYTICS.setConsent(true);

            hideBanner();

            return;

        }

        if (decision === "denied") {

            ANALYTICS.setConsent(false);

            hideBanner();

            return;

        }

        // لا توجد موافقة سابقة:
        // لا نفعّل التحليلات، ونعرض خيارات الزائر.
        showBanner(false);

    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.IBRAnalyticsConsent = Object.freeze({

        openSettings: function () {
            showBanner(true);
        },

        getDecision: getDecision,

        getPolicyVersion: function () {
            return CONFIG.policyVersion;
        }

    });

    if (document.readyState === "loading") {

        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );

    } else {

        initialize();

    }

})();
