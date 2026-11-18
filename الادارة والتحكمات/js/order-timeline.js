
/* =========================================================
   IBR20 ORDER TIMELINE
   نظام الخط الزمني لمراحل الطلب
   Version: 2.0.0

   المسؤوليات:
   1. بناء الخط الزمني لمراحل الطلب.
   2. تحديد المرحلة الحالية والمرحلة السابقة والقادمة.
   3. عرض حالة الطلب بشكل واضح.
   4. احتساب مدة الطلب ومواعيد التسليم.
   5. دعم الملاحظات الإدارية.
   6. تجهيز سجل زمني موحد للعرض في لوحة الإدارة.
   7. دعم تحديث حالة الطلب بعد نجاح عملية الحفظ.

   يعتمد على حالات الطلب المعتمدة في IBR20.
   لا ينشئ جداول أو سياسات جديدة.
========================================================= */

(() => {

    "use strict";


    if (window.IBROrderTimeline) {
        return;
    }


    /* =====================================================
       الإعدادات
    ===================================================== */

    const CONFIG = {

        version: "2.0.0",

        locale: "ar-SA",

        timezone: "Asia/Riyadh",

        currency: "SAR",

        statuses: [

            "new",

            "contacting",

            "confirmed",

            "preparing",

            "shipped",

            "delivered",

            "cancelled"

        ],

        statusLabels: {

            new: "طلب جديد",

            contacting: "جاري التواصل",

            confirmed: "تم تأكيد الطلب",

            preparing: "قيد التجهيز",

            shipped: "تم الشحن",

            delivered: "تم التسليم",

            cancelled: "ملغي"

        },

        statusDescriptions: {

            new: "تم استلام الطلب بنجاح.",

            contacting: "يجري التواصل مع العميل لمراجعة تفاصيل الطلب.",

            confirmed: "تم تأكيد تفاصيل الطلب.",

            preparing: "يجري تجهيز الطلب.",

            shipped: "تم شحن الطلب.",

            delivered: "تم تسليم الطلب بنجاح.",

            cancelled: "تم إلغاء الطلب."

        },

        statusIcons: {

            new: "inbox",

            contacting: "phone",

            confirmed: "check-circle",

            preparing: "package",

            shipped: "truck",

            delivered: "check-check",

            cancelled: "x-circle"

        },

        terminalStatuses: [

            "delivered",

            "cancelled"

        ]

    };


    /* =====================================================
       أدوات عامة
    ===================================================== */

    function isObject(value) {

        return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        );

    }


    function cleanText(value, maxLength = 5000) {

        if (value === null || value === undefined) {
            return "";
        }


        return String(value)
            .replace(/\u0000/g, "")
            .trim()
            .slice(0, maxLength);

    }


    function toNumber(value, fallback = 0) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return fallback;
        }


        const number = Number(value);


        return Number.isFinite(number)
            ? number
            : fallback;

    }


    function getTimestamp(value) {

        if (!value) {
            return null;
        }


        const timestamp = new Date(value).getTime();


        return Number.isFinite(timestamp)
            ? timestamp
            : null;

    }


    function getField(object, ...keys) {

        if (!isObject(object)) {
            return undefined;
        }


        for (const key of keys) {

            if (
                key &&
                object[key] !== undefined &&
                object[key] !== null
            ) {
                return object[key];
            }

        }


        return undefined;

    }


    function getNow() {

        return new Date();

    }


    /* =====================================================
       التعامل مع التواريخ
    ===================================================== */

    function normalizeDate(value) {

        if (!value) {
            return null;
        }


        const date = new Date(value);


        if (Number.isNaN(date.getTime())) {
            return null;
        }


        return date.toISOString();

    }


    function formatDate(value, options = {}) {

        const date = new Date(value);


        if (!value || Number.isNaN(date.getTime())) {
            return "—";
        }


        try {

            return new Intl.DateTimeFormat(
                options.locale || CONFIG.locale,
                {

                    timeZone: options.timezone || CONFIG.timezone,

                    year: "numeric",

                    month: "long",

                    day: "numeric",

                    ...(options.includeTime
                        ? {
                            hour: "2-digit",
                            minute: "2-digit"
                        }
                        : {})

                }
            ).format(date);

        } catch {

            return date.toLocaleString("ar-SA");

        }

    }


    function getDuration(start, end = getNow()) {

        const startTime = getTimestamp(start);

        const endTime = getTimestamp(end);


        if (
            startTime === null ||
            endTime === null
        ) {
            return null;
        }


        const difference = Math.max(
            0,
            endTime - startTime
        );


        const totalMinutes = Math.floor(
            difference / 60000
        );


        const days = Math.floor(
            totalMinutes / 1440
        );


        const hours = Math.floor(
            (totalMinutes % 1440) / 60
        );


        const minutes = totalMinutes % 60;


        return {

            totalMilliseconds: difference,

            totalMinutes,

            totalHours: Math.floor(
                totalMinutes / 60
            ),

            totalDays: Math.floor(
                totalMinutes / 1440
            ),

            days,

            hours,

            minutes,

            label: formatDuration(
                days,
                hours,
                minutes
            )

        };

    }


    function formatDuration(days, hours, minutes) {

        const parts = [];


        if (days > 0) {

            parts.push(
                `${days} ${days === 1 ? "يوم" : "أيام"}`
            );

        }


        if (hours > 0) {

            parts.push(
                `${hours} ${hours === 1 ? "ساعة" : "ساعات"}`
            );

        }


        if (minutes > 0 || parts.length === 0) {

            parts.push(
                `${minutes} دقيقة`
            );

        }


        return parts.join(" و ");

    }


    function getElapsedDays(start, end = getNow()) {

        const duration = getDuration(start, end);


        return duration
            ? duration.totalDays
            : null;

    }


    /* =====================================================
       حالات الطلب
    ===================================================== */

    function normalizeStatus(status) {

        return cleanText(
            status,
            50
        ).toLowerCase();

    }


    function isValidStatus(status) {

        return CONFIG.statuses.includes(
            normalizeStatus(status)
        );

    }


    function getStatusLabel(status) {

        const normalized = normalizeStatus(status);


        return CONFIG.statusLabels[normalized] ||
            "حالة غير محددة";

    }


    function getStatusDescription(status) {

        const normalized = normalizeStatus(status);


        return CONFIG.statusDescriptions[normalized] ||
            "لا توجد تفاصيل إضافية لهذه الحالة.";

    }


    function getStatusIcon(status) {

        const normalized = normalizeStatus(status);


        return CONFIG.statusIcons[normalized] ||
            "circle";

    }


    function isTerminalStatus(status) {

        return CONFIG.terminalStatuses.includes(
            normalizeStatus(status)
        );

    }


    function getStatusIndex(status) {

        return CONFIG.statuses.indexOf(
            normalizeStatus(status)
        );

    }


    function getStatusColor(status) {

        const colors = {

            new: "info",

            contacting: "warning",

            confirmed: "success",

            preparing: "info",

            shipped: "primary",

            delivered: "success",

            cancelled: "danger"

        };


        return colors[normalizeStatus(status)] || "neutral";

    }


    /* =====================================================
       تحديد تقدم الطلب
    ===================================================== */

    function getProgress(status) {

        const normalized = normalizeStatus(status);


        if (normalized === "cancelled") {

            return {

                percentage: 0,

                completedSteps: 0,

                currentStep: null,

                remainingSteps: 0,

                isCancelled: true,

                isCompleted: false

            };

        }


        const index = getStatusIndex(normalized);


        if (index < 0) {

            return {

                percentage: 0,

                completedSteps: 0,

                currentStep: null,

                remainingSteps: CONFIG.statuses.length,

                isCancelled: false,

                isCompleted: false

            };

        }


        const normalStatuses = CONFIG.statuses.filter(
            item => item !== "cancelled"
        );


        const normalIndex = normalStatuses.indexOf(
            normalized
        );


        const percentage = Math.round(
            ((normalIndex + 1) / normalStatuses.length) * 100
        );


        return {

            percentage,

            completedSteps: normalIndex,

            currentStep: normalized,

            remainingSteps:
                normalStatuses.length - normalIndex - 1,

            isCancelled: false,

            isCompleted: normalized === "delivered"

        };

    }


    /* =====================================================
       الخطوات الأساسية
    ===================================================== */

    function getSteps() {

        return CONFIG.statuses
            .filter(status => status !== "cancelled")
            .map((status, index) => ({

                id: status,

                status,

                label: getStatusLabel(status),

                description: getStatusDescription(status),

                icon: getStatusIcon(status),

                color: getStatusColor(status),

                index

            }));

    }


    /* =====================================================
       تطبيع الطلب
    ===================================================== */

    function normalizeOrder(order) {

        if (!isObject(order)) {
            return null;
        }


        return {

            ...order,

            id: getField(order, "id") || null,

            orderNumber: cleanText(
                getField(
                    order,
                    "orderNumber",
                    "order_number"
                ),
                100
            ),

            status: normalizeStatus(
                getField(order, "status")
            ),

            createdAt: normalizeDate(
                getField(
                    order,
                    "createdAt",
                    "created_at"
                )
            ),

            updatedAt: normalizeDate(
                getField(
                    order,
                    "updatedAt",
                    "updated_at"
                )
            ),

            expectedDeliveryDate: normalizeDate(
                getField(
                    order,
                    "expectedDeliveryDate",
                    "expected_delivery_date"
                )
            ),

            deliveredAt: normalizeDate(
                getField(
                    order,
                    "deliveredAt",
                    "delivered_at"
                )
            ),

            adminNote: cleanText(
                getField(
                    order,
                    "adminNote",
                    "admin_note"
                ),
                5000
            )

        };

    }


    /* =====================================================
       إنشاء أحداث الخط الزمني
    ===================================================== */

    function createTimelineEvent(status, date, options = {}) {

        const normalized = normalizeStatus(status);


        return {

            id: options.id || normalized,

            status: normalized,

            label: getStatusLabel(normalized),

            description:
                options.description ||
                getStatusDescription(normalized),

            icon: getStatusIcon(normalized),

            color: getStatusColor(normalized),

            date: normalizeDate(date),

            formattedDate: formatDate(
                date,
                {
                    includeTime: true
                }
            ),

            completed: Boolean(options.completed),

            current: Boolean(options.current),

            upcoming: Boolean(options.upcoming),

            cancelled: normalized === "cancelled",

            source: options.source || "system"

        };

    }


    /* =====================================================
       بناء الخط الزمني الأساسي
    ===================================================== */

    function buildTimeline(order, options = {}) {

        const normalizedOrder = normalizeOrder(order);


        if (!normalizedOrder) {
            return [];
        }


        const currentStatus = normalizedOrder.status;

        const currentIndex = getStatusIndex(
            currentStatus
        );


        const steps = getSteps();

        const timeline = [];


        const createdAt = normalizedOrder.createdAt;


        steps.forEach((step, index) => {

            const isCurrent = step.status === currentStatus;

            const isCompleted = (
                currentIndex >= 0 &&
                index < currentIndex
            );


            const isUpcoming = (
                currentIndex >= 0 &&
                index > currentIndex
            );


            let date = null;


            if (isCurrent) {

                date = normalizedOrder.updatedAt ||
                    normalizedOrder.createdAt;

            }


            if (
                step.status === "new" &&
                createdAt
            ) {

                date = createdAt;

            }


            if (
                step.status === "delivered" &&
                normalizedOrder.deliveredAt
            ) {

                date = normalizedOrder.deliveredAt;

            }


            timeline.push({

                id: step.id,

                status: step.status,

                label: step.label,

                description: step.description,

                icon: step.icon,

                color: step.color,

                date,

                formattedDate: date
                    ? formatDate(date, {
                        includeTime: true
                    })
                    : "بانتظار التحديث",

                completed: isCompleted,

                current: isCurrent,

                upcoming: isUpcoming,

                cancelled: false,

                source: "order"

            });

        });


        if (currentStatus === "cancelled") {

            timeline.push(
                createTimelineEvent(
                    "cancelled",
                    normalizedOrder.updatedAt ||
                    normalizedOrder.createdAt,
                    {

                        completed: false,

                        current: true,

                        description:
                            "تم إلغاء الطلب."

                    }
                )
            );

        }


        if (Array.isArray(options.extraEvents)) {

            options.extraEvents.forEach(event => {

                const normalizedEvent = normalizeCustomEvent(event);


                if (normalizedEvent) {
                    timeline.push(normalizedEvent);
                }

            });

        }


        return timeline.sort((a, b) => {

            const aDate = getTimestamp(a.date);

            const bDate = getTimestamp(b.date);


            if (aDate === null && bDate === null) {
                return 0;
            }


            if (aDate === null) {
                return 1;
            }


            if (bDate === null) {
                return -1;
            }


            return aDate - bDate;

        });

    }


    /* =====================================================
       الأحداث الإضافية
    ===================================================== */

    function normalizeCustomEvent(event) {

        if (!isObject(event)) {
            return null;
        }


        const title = cleanText(
            getField(
                event,
                "title",
                "label"
            ),
            200
        );


        if (!title) {
            return null;
        }


        const date = normalizeDate(
            getField(
                event,
                "date",
                "createdAt",
                "created_at"
            )
        );


        return {

            id: getField(event, "id") ||
                `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,

            status: "custom",

            label: title,

            description: cleanText(
                event.description,
                2000
            ),

            icon: cleanText(
                event.icon,
                50
            ) || "activity",

            color: cleanText(
                event.color,
                30
            ) || "neutral",

            date,

            formattedDate: date
                ? formatDate(date, {
                    includeTime: true
                })
                : "—",

            completed: true,

            current: false,

            upcoming: false,

            cancelled: false,

            source: "custom"

        };

    }


    /* =====================================================
       المرحلة الحالية
    ===================================================== */

    function getCurrentStep(order) {

        const normalizedOrder = normalizeOrder(order);


        if (!normalizedOrder) {
            return null;
        }


        const status = normalizedOrder.status;


        return {

            status,

            label: getStatusLabel(status),

            description: getStatusDescription(status),

            icon: getStatusIcon(status),

            color: getStatusColor(status),

            index: getStatusIndex(status),

            isTerminal: isTerminalStatus(status),

            isCancelled: status === "cancelled",

            isCompleted: status === "delivered"

        };

    }


    /* =====================================================
       المرحلة القادمة
    ===================================================== */

    function getNextStep(order) {

        const normalizedOrder = normalizeOrder(order);


        if (!normalizedOrder) {
            return null;
        }


        if (isTerminalStatus(normalizedOrder.status)) {
            return null;
        }


        const index = getStatusIndex(
            normalizedOrder.status
        );


        const steps = getSteps();

        const next = steps[index + 1];


        if (!next) {
            return null;
        }


        return {

            ...next,

            description:
                `المرحلة التالية المتوقعة: ${next.label}`

        };

    }


    /* =====================================================
       المرحلة السابقة
    ===================================================== */

    function getPreviousStep(order) {

        const normalizedOrder = normalizeOrder(order);


        if (!normalizedOrder) {
            return null;
        }


        const index = getStatusIndex(
            normalizedOrder.status
        );


        if (index <= 0) {
            return null;
        }


        const steps = getSteps();


        return steps[index - 1] || null;

    }


    /* =====================================================
       مدة معالجة الطلب
    ===================================================== */

    function getOrderDuration(order, options = {}) {

        const normalized = normalizeOrder(order);


        if (!normalized || !normalized.createdAt) {
            return null;
        }


        const endDate = normalized.deliveredAt ||
            options.endDate ||
            getNow();


        return getDuration(
            normalized.createdAt,
            endDate
        );

    }


    /* =====================================================
       حساب مدة بقاء الطلب في حالته الحالية
    ===================================================== */

    function getStatusDuration(order, options = {}) {

        const normalized = normalizeOrder(order);


        if (!normalized) {
            return null;
        }


        const startDate = normalized.updatedAt ||
            normalized.createdAt;


        if (!startDate) {
            return null;
        }


        return getDuration(
            startDate,
            options.endDate || getNow()
        );

    }


    /* =====================================================
       الموعد المتوقع للتسليم
    ===================================================== */

    function getDeliveryInfo(order, options = {}) {

        const normalized = normalizeOrder(order);


        if (!normalized) {
            return null;
        }


        const expected = normalized.expectedDeliveryDate;

        const delivered = normalized.deliveredAt;


        if (normalized.status === "delivered") {

            return {

                status: "delivered",

                label: "تم التسليم",

                expectedDate: expected,

                deliveredDate: delivered,

                isLate: false,

                remainingDays: 0,

                differenceDays: expected && delivered
                    ? getElapsedDays(expected, delivered)
                    : null

            };

        }


        if (normalized.status === "cancelled") {

            return {

                status: "cancelled",

                label: "الطلب ملغي",

                expectedDate: expected,

                deliveredDate: null,

                isLate: false,

                remainingDays: null,

                differenceDays: null

            };

        }


        if (!expected) {

            return {

                status: "unknown",

                label: "لم يحدد موعد التسليم",

                expectedDate: null,

                deliveredDate: null,

                isLate: false,

                remainingDays: null,

                differenceDays: null

            };

        }


        const expectedTime = getTimestamp(expected);

        const now = getTimestamp(
            options.referenceDate || getNow()
        );


        if (
            expectedTime === null ||
            now === null
        ) {
            return null;
        }


        const difference = expectedTime - now;

        const remainingDays = Math.ceil(
            difference / 86400000
        );


        const isLate = difference < 0;


        return {

            status: isLate ? "late" : "upcoming",

            label: isLate
                ? "تجاوز الموعد المتوقع"
                : "موعد التسليم المتوقع",

            expectedDate: expected,

            deliveredDate: null,

            isLate,

            remainingDays,

            differenceDays: Math.abs(
                Math.ceil(difference / 86400000)
            )

        };

    }


    /* =====================================================
       ملخص الخط الزمني
    ===================================================== */

    function getTimelineSummary(order, options = {}) {

        const normalized = normalizeOrder(order);


        if (!normalized) {
            return null;
        }


        const current = getCurrentStep(normalized);

        const next = getNextStep(normalized);

        const previous = getPreviousStep(normalized);

        const progress = getProgress(normalized.status);

        const duration = getOrderDuration(
            normalized,
            options
        );

        const statusDuration = getStatusDuration(
            normalized,
            options
        );

        const delivery = getDeliveryInfo(
            normalized,
            options
        );


        return {

            orderId: normalized.id,

            orderNumber: normalized.orderNumber,

            status: normalized.status,

            statusLabel: getStatusLabel(
                normalized.status
            ),

            statusDescription: getStatusDescription(
                normalized.status
            ),

            statusColor: getStatusColor(
                normalized.status
            ),

            statusIcon: getStatusIcon(
                normalized.status
            ),

            currentStep: current,

            previousStep: previous,

            nextStep: next,

            progress,

            duration,

            statusDuration,

            delivery,

            createdAt: normalized.createdAt,

            updatedAt: normalized.updatedAt,

            deliveredAt: normalized.deliveredAt

        };

    }


    /* =====================================================
       التحقق من انتقال الحالة
    ===================================================== */

    function canTransition(fromStatus, toStatus, options = {}) {

        const from = normalizeStatus(fromStatus);

        const to = normalizeStatus(toStatus);


        if (!isValidStatus(from) || !isValidStatus(to)) {

            return {

                allowed: false,

                reason: "حالة الطلب غير صحيحة."

            };

        }


        if (from === to) {

            return {

                allowed: false,

                reason: "الطلب موجود بالفعل في هذه الحالة."

            };

        }


        if (isTerminalStatus(from)) {

            return {

                allowed: false,

                reason: "لا يمكن تغيير حالة طلب نهائي."

            };

        }


        if (to === "new") {

            return {

                allowed: false,

                reason: "لا يمكن إعادة الطلب إلى حالة الطلب الجديد."

            };

        }


        if (
            to === "cancelled" &&
            options.allowCancellation === false
        ) {

            return {

                allowed: false,

                reason: "إلغاء الطلب غير مسموح في العملية الحالية."

            };

        }


        if (
            from === "shipped" &&
            to === "preparing"
        ) {

            return {

                allowed: false,

                reason: "لا يمكن إعادة الطلب المشحون إلى مرحلة التجهيز."

            };

        }


        if (
            from === "delivered" ||
            from === "cancelled"
        ) {

            return {

                allowed: false,

                reason: "لا يمكن تعديل طلب مكتمل أو ملغي."

            };

        }


        return {

            allowed: true,

            reason: null

        };

    }


    /* =====================================================
       تجهيز بيانات انتقال الحالة
    ===================================================== */

    function prepareStatusTransition(order, newStatus, options = {}) {

        const normalized = normalizeOrder(order);


        if (!normalized) {

            throw new Error(
                "بيانات الطلب غير صالحة."
            );

        }


        const nextStatus = normalizeStatus(
            newStatus
        );


        const validation = canTransition(
            normalized.status,
            nextStatus,
            options
        );


        if (!validation.allowed) {

            throw new Error(
                validation.reason
            );

        }


        const now = getNow().toISOString();


        const update = {

            status: nextStatus,

            updated_at: now

        };


        if (nextStatus === "delivered") {

            update.delivered_at = now;

        }


        if (
            nextStatus === "cancelled" &&
            options.clearDeliveredAt === true
        ) {

            update.delivered_at = null;

        }


        return {

            orderId: normalized.id,

            orderNumber: normalized.orderNumber,

            previousStatus: normalized.status,

            newStatus: nextStatus,

            previousStatusLabel: getStatusLabel(
                normalized.status
            ),

            newStatusLabel: getStatusLabel(
                nextStatus
            ),

            update,

            changedAt: now,

            description: getStatusDescription(
                nextStatus
            )

        };

    }


    /* =====================================================
       تجهيز وصف حالة الطلب
    ===================================================== */

    function getStatusPresentation(status) {

        const normalized = normalizeStatus(status);


        return {

            status: normalized,

            label: getStatusLabel(normalized),

            description: getStatusDescription(normalized),

            icon: getStatusIcon(normalized),

            color: getStatusColor(normalized),

            valid: isValidStatus(normalized),

            terminal: isTerminalStatus(normalized),

            progress: getProgress(normalized)

        };

    }


    /* =====================================================
       الحصول على بيانات الخط الزمني الكاملة
    ===================================================== */

    function getOrderTimeline(order, options = {}) {

        const normalized = normalizeOrder(order);


        if (!normalized) {
            return null;
        }


        const events = buildTimeline(
            normalized,
            options
        );


        const summary = getTimelineSummary(
            normalized,
            options
        );


        return {

            order: normalized,

            events,

            steps: getSteps(),

            summary,

            generatedAt: getNow().toISOString(),

            version: CONFIG.version

        };

    }


    /* =====================================================
       مقارنة الطلبات زمنياً
    ===================================================== */

    function compareOrderTimelines(first, second) {

        const firstOrder = normalizeOrder(first);

        const secondOrder = normalizeOrder(second);


        if (!firstOrder || !secondOrder) {
            return null;
        }


        const firstCreated = getTimestamp(
            firstOrder.createdAt
        );


        const secondCreated = getTimestamp(
            secondOrder.createdAt
        );


        return {

            firstOrderNumber: firstOrder.orderNumber,

            secondOrderNumber: secondOrder.orderNumber,

            firstCreatedAt: firstOrder.createdAt,

            secondCreatedAt: secondOrder.createdAt,

            creationDifferenceMilliseconds:
                firstCreated !== null &&
                secondCreated !== null
                    ? firstCreated - secondCreated
                    : null,

            firstStatus: firstOrder.status,

            secondStatus: secondOrder.status

        };

    }


    /* =====================================================
       التصدير
    ===================================================== */

    window.IBROrderTimeline = Object.freeze({

        version: CONFIG.version,


        // الإعدادات والحالات

        getConfig: () => ({
            ...CONFIG,
            statuses: [...CONFIG.statuses],
            terminalStatuses: [...CONFIG.terminalStatuses],
            statusLabels: { ...CONFIG.statusLabels },
            statusDescriptions: { ...CONFIG.statusDescriptions },
            statusIcons: { ...CONFIG.statusIcons }
        }),


        // تطبيع الحالات

        normalizeStatus,

        isValidStatus,

        isTerminalStatus,

        getStatusIndex,

        getStatusLabel,

        getStatusDescription,

        getStatusIcon,

        getStatusColor,

        getStatusPresentation,


        // مراحل الطلب

        getSteps,

        getProgress,

        getCurrentStep,

        getPreviousStep,

        getNextStep,


        // الخط الزمني

        normalizeOrder,

        createTimelineEvent,

        buildTimeline,

        getOrderTimeline,

        getTimelineSummary,

        normalizeCustomEvent,


        // المدد والتواريخ

        normalizeDate,

        formatDate,

        getDuration,

        getElapsedDays,

        getOrderDuration,

        getStatusDuration,

        formatDuration,


        // التسليم

        getDeliveryInfo,


        // انتقال الحالات

        canTransition,

        prepareStatusTransition,


        // المقارنة

        compareOrderTimelines

    });


})();
