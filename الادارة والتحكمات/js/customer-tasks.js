
/* =========================================================
   IBR20 - Customer Tasks Service
   File: assets/js/customer-tasks.js
   Version: 2.0.0

   إدارة مهام خدمة العملاء:
   - إنشاء المهام وتعديلها وحذفها.
   - ربط المهمة بالعميل والطلب والاستفسار.
   - حالات وأولويات وأنواع المهام.
   - المهام المتأخرة والقادمة والمكتملة.
   - البحث والتصفية والإحصائيات.
   - دعم موائم تخزين اختياري.
   - لا يفترض وجود جدول مهام في Supabase.
========================================================= */

(function (window) {
    "use strict";

    if (window.IBRCustomerTasks) {
        return;
    }

    const VERSION = "2.0.0";

    const STATUS = Object.freeze({
        PENDING: "pending",
        IN_PROGRESS: "in_progress",
        COMPLETED: "completed",
        CANCELLED: "cancelled"
    });

    const PRIORITY = Object.freeze({
        LOW: "low",
        NORMAL: "normal",
        HIGH: "high",
        URGENT: "urgent"
    });

    const TYPE = Object.freeze({
        CALL: "call",
        WHATSAPP: "whatsapp",
        FOLLOW_UP: "follow_up",
        ORDER: "order",
        MESSAGE: "message",
        REVIEW: "review",
        OTHER: "other"
    });

    const STATUS_LABELS = Object.freeze({
        pending: "معلقة",
        in_progress: "قيد التنفيذ",
        completed: "مكتملة",
        cancelled: "ملغاة"
    });

    const PRIORITY_LABELS = Object.freeze({
        low: "منخفضة",
        normal: "عادية",
        high: "مرتفعة",
        urgent: "عاجلة"
    });

    const TYPE_LABELS = Object.freeze({
        call: "اتصال هاتفي",
        whatsapp: "تواصل واتساب",
        follow_up: "متابعة عميل",
        order: "متابعة طلب",
        message: "متابعة استفسار",
        review: "متابعة تقييم",
        other: "أخرى"
    });

    const VALID_STATUSES = Object.values(STATUS);
    const VALID_PRIORITIES = Object.values(PRIORITY);
    const VALID_TYPES = Object.values(TYPE);

    let adapter = null;
    let tasks = new Map();
    let initialized = false;

    /* =====================================================
       أدوات عامة
    ===================================================== */

    function nowISO() {
        return new Date().toISOString();
    }

    function makeId() {
        if (
            window.crypto &&
            typeof window.crypto.randomUUID === "function"
        ) {
            return window.crypto.randomUUID();
        }

        return "task-" +
            Date.now().toString(36) +
            "-" +
            Math.random().toString(36).slice(2, 11);
    }

    function cleanText(value, maxLength) {
        if (value === null || value === undefined) {
            return "";
        }

        return String(value)
            .trim()
            .slice(0, maxLength || 2000);
    }

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

    function normalizePhone(value) {
        const service = window.IBRCustomersService;

        if (
            service &&
            typeof service.normalizePhone === "function"
        ) {
            return service.normalizePhone(value);
        }

        let digits = String(value || "")
            .replace(/[٠-٩]/g, function (digit) {
                return "٠١٢٣٤٥٦٧٨٩".indexOf(digit);
            })
            .replace(/[۰-۹]/g, function (digit) {
                return "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
            })
            .replace(/\D/g, "");

        if (digits.startsWith("00966")) {
            digits = digits.slice(5);
        } else if (digits.startsWith("966")) {
            digits = digits.slice(3);
        }

        if (digits.startsWith("0")) {
            digits = digits.slice(1);
        }

        return digits;
    }

    function normalizeStatus(value) {
        return VALID_STATUSES.includes(value)
            ? value
            : STATUS.PENDING;
    }

    function normalizePriority(value) {
        return VALID_PRIORITIES.includes(value)
            ? value
            : PRIORITY.NORMAL;
    }

    function normalizeType(value) {
        return VALID_TYPES.includes(value)
            ? value
            : TYPE.OTHER;
    }

    function isValidId(value) {
        return typeof value === "string" &&
            value.trim().length > 0;
    }

    function cloneTask(task) {
        return task ? { ...task } : null;
    }

    function toArray(value) {
        if (Array.isArray(value)) {
            return value;
        }

        if (value && typeof value === "object") {
            return [value];
        }

        return [];
    }

    /* =====================================================
       تطبيع المهمة
    ===================================================== */

    function normalizeTask(input) {
        const source = input || {};

        const createdAt =
            normalizeDate(
                source.createdAt ||
                source.created_at
            ) || nowISO();

        const status = normalizeStatus(
            source.status
        );

        const completedAt =
            normalizeDate(
                source.completedAt ||
                source.completed_at
            ) ||
            (
                status === STATUS.COMPLETED
                    ? createdAt
                    : null
            );

        return {
            id: cleanText(source.id, 120) || makeId(),

            title: cleanText(source.title, 200),

            description: cleanText(
                source.description,
                5000
            ),

            type: normalizeType(source.type),

            priority: normalizePriority(
                source.priority
            ),

            status: status,

            customerId:
                cleanText(
                    source.customerId ||
                    source.customer_id,
                    160
                ) || null,

            customerName: cleanText(
                source.customerName ||
                source.customer_name,
                200
            ),

            customerPhone: normalizePhone(
                source.customerPhone ||
                source.customer_phone
            ) || null,

            customerEmail: cleanText(
                source.customerEmail ||
                source.customer_email,
                254
            ) || null,

            relatedOrderId:
                cleanText(
                    source.relatedOrderId ||
                    source.related_order_id,
                    160
                ) || null,

            relatedMessageId:
                cleanText(
                    source.relatedMessageId ||
                    source.related_message_id,
                    160
                ) || null,

            assignedTo:
                cleanText(
                    source.assignedTo ||
                    source.assigned_to,
                    160
                ) || null,

            dueAt: normalizeDate(
                source.dueAt ||
                source.due_at
            ),

            reminderAt: normalizeDate(
                source.reminderAt ||
                source.reminder_at
            ),

            completedAt: completedAt,

            notes: cleanText(
                source.notes,
                5000
            ),

            tags: Array.isArray(source.tags)
                ? source.tags
                    .map(function (tag) {
                        return cleanText(tag, 40);
                    })
                    .filter(Boolean)
                    .slice(0, 20)
                : [],

            createdAt: createdAt,

            updatedAt:
                normalizeDate(
                    source.updatedAt ||
                    source.updated_at
                ) || createdAt
        };
    }

    /* =====================================================
       التحقق من البيانات
    ===================================================== */

    function validateTask(input, options) {
        const source = input || {};
        const errors = [];

        if (!cleanText(source.title, 200)) {
            errors.push("عنوان المهمة مطلوب.");
        }

        if (
            source.title &&
            String(source.title).trim().length > 200
        ) {
            errors.push(
                "عنوان المهمة يجب ألا يتجاوز 200 حرف."
            );
        }

        if (
            source.status &&
            !VALID_STATUSES.includes(source.status)
        ) {
            errors.push("حالة المهمة غير صحيحة.");
        }

        if (
            source.priority &&
            !VALID_PRIORITIES.includes(source.priority)
        ) {
            errors.push("أولوية المهمة غير صحيحة.");
        }

        if (
            source.type &&
            !VALID_TYPES.includes(source.type)
        ) {
            errors.push("نوع المهمة غير صحيح.");
        }

        const dueValue =
            source.dueAt ||
            source.due_at;

        if (dueValue && !normalizeDate(dueValue)) {
            errors.push("تاريخ استحقاق المهمة غير صالح.");
        }

        const reminderValue =
            source.reminderAt ||
            source.reminder_at;

        if (
            reminderValue &&
            !normalizeDate(reminderValue)
        ) {
            errors.push("تاريخ التذكير غير صالح.");
        }

        const settings = options || {};

        if (
            settings.requireCustomer &&
            !(
                source.customerPhone ||
                source.customer_phone ||
                source.customerId ||
                source.customer_id
            )
        ) {
            errors.push("يجب ربط المهمة بعميل.");
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /* =====================================================
       التخزين والموائم
    ===================================================== */

    function configure(options) {
        const settings = options || {};

        if (
            Object.prototype.hasOwnProperty.call(
                settings,
                "adapter"
            )
        ) {
            adapter = settings.adapter || null;
        }

        if (
            Object.prototype.hasOwnProperty.call(
                settings,
                "initialTasks"
            )
        ) {
            tasks.clear();

            toArray(settings.initialTasks).forEach(
                function (item) {
                    const task = normalizeTask(item);

                    if (task.title) {
                        tasks.set(task.id, task);
                    }
                }
            );

            initialized = true;
        }

        return getConfiguration();
    }

    function getConfiguration() {
        return {
            version: VERSION,
            adapterConfigured: Boolean(adapter),
            initialized: initialized,
            storageMode: adapter
                ? "adapter"
                : "memory"
        };
    }

    function validateAdapter(candidate) {
        if (!candidate) {
            return false;
        }

        return (
            typeof candidate.list === "function" &&
            typeof candidate.create === "function" &&
            typeof candidate.update === "function" &&
            typeof candidate.delete === "function"
        );
    }

    async function ensureLoaded() {
        if (initialized) {
            return;
        }

        if (adapter && typeof adapter.list === "function") {
            const result = await adapter.list();

            if (result && result.error) {
                throw new Error(
                    result.error.message ||
                    "تعذر تحميل المهام."
                );
            }

            const records =
                result && result.data !== undefined
                    ? result.data
                    : result;

            tasks.clear();

            toArray(records).forEach(function (item) {
                const task = normalizeTask(item);

                if (task.title) {
                    tasks.set(task.id, task);
                }
            });
        }

        initialized = true;
    }

    function unwrapAdapterResult(result) {
        if (result && result.error) {
            throw new Error(
                result.error.message ||
                "حدث خطأ أثناء تنفيذ العملية."
            );
        }

        if (
            result &&
            Object.prototype.hasOwnProperty.call(
                result,
                "data"
            )
        ) {
            return result.data;
        }

        return result;
    }

    /* =====================================================
       إنشاء مهمة
    ===================================================== */

    async function createTask(input, options) {
        const validation = validateTask(
            input,
            options
        );

        if (!validation.valid) {
            return {
                success: false,
                errors: validation.errors,
                task: null
            };
        }

        await ensureLoaded();

        const timestamp = nowISO();

        const task = normalizeTask({
            ...input,
            id: input && input.id
                ? input.id
                : makeId(),
            status: input && input.status
                ? input.status
                : STATUS.PENDING,
            createdAt: timestamp,
            updatedAt: timestamp
        });

        if (tasks.has(task.id)) {
            return {
                success: false,
                errors: ["معرّف المهمة مستخدم مسبقاً."],
                task: null
            };
        }

        if (adapter) {
            if (typeof adapter.create !== "function") {
                throw new Error(
                    "موائم التخزين لا يدعم إنشاء المهام."
                );
            }

            const result = unwrapAdapterResult(
                await adapter.create(cloneTask(task))
            );

            const savedTask = result
                ? normalizeTask(result)
                : task;

            tasks.set(savedTask.id, savedTask);

            return {
                success: true,
                task: cloneTask(savedTask),
                errors: []
            };
        }

        tasks.set(task.id, task);

        return {
            success: true,
            task: cloneTask(task),
            errors: []
        };
    }

    /* =====================================================
       قراءة المهام
    ===================================================== */

    async function getTasks(filters) {
        await ensureLoaded();

        const settings = filters || {};

        let result = Array.from(tasks.values());

        if (settings.status) {
            const statuses = Array.isArray(settings.status)
                ? settings.status
                : [settings.status];

            result = result.filter(function (task) {
                return statuses.includes(task.status);
            });
        }

        if (settings.priority) {
            const priorities = Array.isArray(
                settings.priority
            )
                ? settings.priority
                : [settings.priority];

            result = result.filter(function (task) {
                return priorities.includes(task.priority);
            });
        }

        if (settings.type) {
            result = result.filter(function (task) {
                return task.type === settings.type;
            });
        }

        if (settings.customerPhone) {
            const phone = normalizePhone(
                settings.customerPhone
            );

            result = result.filter(function (task) {
                return normalizePhone(
                    task.customerPhone
                ) === phone;
            });
        }

        if (settings.customerId) {
            result = result.filter(function (task) {
                return task.customerId ===
                    String(settings.customerId);
            });
        }

        if (settings.assignedTo) {
            result = result.filter(function (task) {
                return task.assignedTo ===
                    String(settings.assignedTo);
            });
        }

        if (settings.relatedOrderId) {
            result = result.filter(function (task) {
                return task.relatedOrderId ===
                    String(settings.relatedOrderId);
            });
        }

        if (settings.relatedMessageId) {
            result = result.filter(function (task) {
                return task.relatedMessageId ===
                    String(settings.relatedMessageId);
            });
        }

        if (settings.fromDate) {
            const from = new Date(
                settings.fromDate
            ).getTime();

            if (!Number.isNaN(from)) {
                result = result.filter(function (task) {
                    return new Date(
                        task.createdAt
                    ).getTime() >= from;
                });
            }
        }

        if (settings.toDate) {
            const to = new Date(
                settings.toDate
            ).getTime();

            if (!Number.isNaN(to)) {
                result = result.filter(function (task) {
                    return new Date(
                        task.createdAt
                    ).getTime() <= to;
                });
            }
        }

        if (settings.search) {
            const query = cleanText(
                settings.search,
                200
            ).toLocaleLowerCase("ar");

            result = result.filter(function (task) {
                const searchable = [
                    task.title,
                    task.description,
                    task.customerName,
                    task.customerPhone,
                    task.customerEmail,
                    task.notes
                ]
                    .join(" ")
                    .toLocaleLowerCase("ar");

                return searchable.includes(query);
            });
        }

        result.sort(function (a, b) {
            const priorityOrder = {
                urgent: 0,
                high: 1,
                normal: 2,
                low: 3
            };

            const priorityDifference =
                priorityOrder[a.priority] -
                priorityOrder[b.priority];

            if (
                settings.sortByPriority &&
                priorityDifference !== 0
            ) {
                return priorityDifference;
            }

            const dateA = a.dueAt
                ? new Date(a.dueAt).getTime()
                : Number.MAX_SAFE_INTEGER;

            const dateB = b.dueAt
                ? new Date(b.dueAt).getTime()
                : Number.MAX_SAFE_INTEGER;

            if (settings.sort === "oldest") {
                return new Date(a.createdAt) -
                    new Date(b.createdAt);
            }

            if (settings.sort === "newest") {
                return new Date(b.createdAt) -
                    new Date(a.createdAt);
            }

            if (settings.sort === "due_desc") {
                return dateB - dateA;
            }

            return dateA - dateB;
        });

        const total = result.length;

        const offset = Math.max(
            0,
            Number(settings.offset) || 0
        );

        const limit = settings.limit === undefined
            ? total
            : Math.max(0, Number(settings.limit) || 0);

        result = result.slice(
            offset,
            offset + limit
        );

        return {
            tasks: result.map(cloneTask),
            total: total,
            offset: offset,
            limit: limit
        };
    }

    async function getTaskById(id) {
        if (!isValidId(id)) {
            return null;
        }

        await ensureLoaded();

        return cloneTask(
            tasks.get(String(id).trim())
        );
    }

    async function getTasksByCustomer(identifier) {
        await ensureLoaded();

        const value = String(identifier || "").trim();

        if (!value) {
            return [];
        }

        const phone = normalizePhone(value);

        return Array.from(tasks.values())
            .filter(function (task) {
                return (
                    task.customerId === value ||
                    (
                        phone &&
                        normalizePhone(
                            task.customerPhone
                        ) === phone
                    )
                );
            })
            .sort(function (a, b) {
                return new Date(b.createdAt) -
                    new Date(a.createdAt);
            })
            .map(cloneTask);
    }

    /* =====================================================
       تعديل المهمة
    ===================================================== */

    async function updateTask(id, changes) {
        if (!isValidId(id)) {
            return {
                success: false,
                errors: ["معرّف المهمة غير صالح."],
                task: null
            };
        }

        await ensureLoaded();

        const taskId = String(id).trim();
        const existing = tasks.get(taskId);

        if (!existing) {
            return {
                success: false,
                errors: ["المهمة غير موجودة."],
                task: null
            };
        }

        const patch = changes || {};

        const merged = {
            ...existing,
            ...patch,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: nowISO()
        };

        if (
            patch.status === STATUS.COMPLETED &&
            existing.status !== STATUS.COMPLETED
        ) {
            merged.completedAt =
                normalizeDate(patch.completedAt) ||
                nowISO();
        }

        if (
            patch.status &&
            patch.status !== STATUS.COMPLETED
        ) {
            merged.completedAt = null;
        }

        const validation = validateTask(merged);

        if (!validation.valid) {
            return {
                success: false,
                errors: validation.errors,
                task: null
            };
        }

        const updated = normalizeTask(merged);

        if (adapter) {
            const result = unwrapAdapterResult(
                await adapter.update(
                    taskId,
                    cloneTask(updated)
                )
            );

            const savedTask = result
                ? normalizeTask(result)
                : updated;

            tasks.set(taskId, savedTask);

            return {
                success: true,
                task: cloneTask(savedTask),
                errors: []
            };
        }

        tasks.set(taskId, updated);

        return {
            success: true,
            task: cloneTask(updated),
            errors: []
        };
    }

    /* =====================================================
       تغيير الحالة والإكمال
    ===================================================== */

    async function setTaskStatus(id, status) {
        if (!VALID_STATUSES.includes(status)) {
            return {
                success: false,
                errors: ["حالة المهمة غير معتمدة."],
                task: null
            };
        }

        return updateTask(id, {
            status: status,
            completedAt: status === STATUS.COMPLETED
                ? nowISO()
                : null
        });
    }

    async function startTask(id) {
        return setTaskStatus(
            id,
            STATUS.IN_PROGRESS
        );
    }

    async function completeTask(id) {
        return setTaskStatus(
            id,
            STATUS.COMPLETED
        );
    }

    async function cancelTask(id) {
        return setTaskStatus(
            id,
            STATUS.CANCELLED
        );
    }

    async function reopenTask(id) {
        return setTaskStatus(
            id,
            STATUS.PENDING
        );
    }

    /* =====================================================
       حذف المهمة
    ===================================================== */

    async function deleteTask(id) {
        if (!isValidId(id)) {
            return {
                success: false,
                error: "معرّف المهمة غير صالح."
            };
        }

        await ensureLoaded();

        const taskId = String(id).trim();

        if (!tasks.has(taskId)) {
            return {
                success: false,
                error: "المهمة غير موجودة."
            };
        }

        if (adapter) {
            const result = unwrapAdapterResult(
                await adapter.delete(taskId)
            );

            if (
                result === false ||
                (
                    result &&
                    result.success === false
                )
            ) {
                return {
                    success: false,
                    error: "تعذر حذف المهمة."
                };
            }
        }

        tasks.delete(taskId);

        return {
            success: true,
            id: taskId
        };
    }

    /* =====================================================
       المهام المتأخرة والقادمة
    ===================================================== */

    function isOverdue(task, referenceDate) {
        if (
            !task ||
            !task.dueAt ||
            task.status === STATUS.COMPLETED ||
            task.status === STATUS.CANCELLED
        ) {
            return false;
        }

        const reference = referenceDate
            ? new Date(referenceDate).getTime()
            : Date.now();

        const due = new Date(task.dueAt).getTime();

        if (
            Number.isNaN(reference) ||
            Number.isNaN(due)
        ) {
            return false;
        }

        return due < reference;
    }

    async function getOverdueTasks(options) {
        const result = await getTasks(options);

        return result.tasks.filter(function (task) {
            return isOverdue(task);
        });
    }

    async function getUpcomingTasks(options) {
        const settings = options || {};
        const days = Math.max(
            0,
            Number(settings.days) || 7
        );

        const now = Date.now();
        const end = now + days * 86400000;

        const result = await getTasks(settings);

        return result.tasks.filter(function (task) {
            if (
                !task.dueAt ||
                task.status === STATUS.COMPLETED ||
                task.status === STATUS.CANCELLED
            ) {
                return false;
            }

            const due = new Date(
                task.dueAt
            ).getTime();

            return (
                due >= now &&
                due <= end
            );
        });
    }

    async function getTasksDueToday(options) {
        const settings = options || {};
        const now = new Date();

        const start = new Date(now);
        start.setHours(0, 0, 0, 0);

        const end = new Date(now);
        end.setHours(23, 59, 59, 999);

        const result = await getTasks(settings);

        return result.tasks.filter(function (task) {
            if (
                !task.dueAt ||
                task.status === STATUS.COMPLETED ||
                task.status === STATUS.CANCELLED
            ) {
                return false;
            }

            const due = new Date(task.dueAt);

            return (
                due >= start &&
                due <= end
            );
        });
    }

    /* =====================================================
       الإحصائيات
    ===================================================== */

    async function getTaskStats(filters) {
        const result = await getTasks(filters);
        const list = result.tasks;

        const stats = {
            total: list.length,
            pending: 0,
            inProgress: 0,
            completed: 0,
            cancelled: 0,
            overdue: 0,
            dueToday: 0,
            upcoming: 0,
            urgent: 0,
            high: 0,
            normal: 0,
            low: 0,
            completionRate: 0
        };

        list.forEach(function (task) {
            if (task.status === STATUS.PENDING) {
                stats.pending++;
            }

            if (task.status === STATUS.IN_PROGRESS) {
                stats.inProgress++;
            }

            if (task.status === STATUS.COMPLETED) {
                stats.completed++;
            }

            if (task.status === STATUS.CANCELLED) {
                stats.cancelled++;
            }

            if (task.priority === PRIORITY.URGENT) {
                stats.urgent++;
            }

            if (task.priority === PRIORITY.HIGH) {
                stats.high++;
            }

            if (task.priority === PRIORITY.NORMAL) {
                stats.normal++;
            }

            if (task.priority === PRIORITY.LOW) {
                stats.low++;
            }

            if (isOverdue(task)) {
                stats.overdue++;
            }
        });

        const today = await getTasksDueToday(filters);

        const upcoming = await getUpcomingTasks({
            ...(filters || {}),
            days: 7
        });

        stats.dueToday = today.length;
        stats.upcoming = upcoming.length;

        const eligible =
            stats.pending +
            stats.inProgress +
            stats.completed;

        stats.completionRate = eligible
            ? Math.round(
                stats.completed / eligible * 100
            )
            : 0;

        return stats;
    }

    /* =====================================================
       تصنيف المهام
    ===================================================== */

    async function getTasksGroupedByStatus(filters) {
        const result = await getTasks(filters);

        const grouped = {
            pending: [],
            in_progress: [],
            completed: [],
            cancelled: []
        };

        result.tasks.forEach(function (task) {
            grouped[task.status].push(task);
        });

        return grouped;
    }

    async function getTasksGroupedByPriority(filters) {
        const result = await getTasks(filters);

        const grouped = {
            urgent: [],
            high: [],
            normal: [],
            low: []
        };

        result.tasks.forEach(function (task) {
            grouped[task.priority].push(task);
        });

        return grouped;
    }

    /* =====================================================
       عمليات مساعدة
    ===================================================== */

    async function getCustomerTaskSummary(identifier) {
        const customerTasks =
            await getTasksByCustomer(identifier);

        const active = customerTasks.filter(
            function (task) {
                return (
                    task.status === STATUS.PENDING ||
                    task.status === STATUS.IN_PROGRESS
                );
            }
        );

        return {
            total: customerTasks.length,
            active: active.length,
            pending: customerTasks.filter(
                task => task.status === STATUS.PENDING
            ).length,
            inProgress: customerTasks.filter(
                task => task.status === STATUS.IN_PROGRESS
            ).length,
            completed: customerTasks.filter(
                task => task.status === STATUS.COMPLETED
            ).length,
            overdue: customerTasks.filter(
                task => isOverdue(task)
            ).length,
            latestTask: customerTasks[0] || null,
            tasks: customerTasks
        };
    }

    async function getTasksByOrder(orderId) {
        const result = await getTasks({
            relatedOrderId: orderId
        });

        return result.tasks;
    }

    async function getTasksByMessage(messageId) {
        const result = await getTasks({
            relatedMessageId: messageId
        });

        return result.tasks;
    }

    async function addTaskNote(id, note) {
        const task = await getTaskById(id);

        if (!task) {
            return {
                success: false,
                errors: ["المهمة غير موجودة."]
            };
        }

        const newNote = cleanText(note, 2000);

        if (!newNote) {
            return {
                success: false,
                errors: ["نص الملاحظة مطلوب."]
            };
        }

        const timestamp = nowISO();

        const entry =
            "[" + timestamp + "] " + newNote;

        const notes = task.notes
            ? task.notes + "\n" + entry
            : entry;

        return updateTask(id, {
            notes: notes
        });
    }

    async function clearCompletedTasks() {
        const result = await getTasks({
            status: STATUS.COMPLETED
        });

        const deleted = [];
        const failed = [];

        for (const task of result.tasks) {
            const response = await deleteTask(task.id);

            if (response.success) {
                deleted.push(task.id);
            } else {
                failed.push({
                    id: task.id,
                    error: response.error
                });
            }
        }

        return {
            success: failed.length === 0,
            deleted: deleted.length,
            failed: failed,
            deletedIds: deleted
        };
    }

    /* =====================================================
       التنسيق والعرض
    ===================================================== */

    function getStatusLabel(status) {
        return STATUS_LABELS[status] || "غير محددة";
    }

    function getPriorityLabel(priority) {
        return PRIORITY_LABELS[priority] || "عادية";
    }

    function getTypeLabel(type) {
        return TYPE_LABELS[type] || "أخرى";
    }

    function formatDate(value, options) {
        if (!value) {
            return "غير محدد";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "غير محدد";
        }

        return new Intl.DateTimeFormat(
            "ar-SA",
            {
                dateStyle: "medium",
                ...(options || {})
            }
        ).format(date);
    }

    function formatDateTime(value) {
        if (!value) {
            return "غير محدد";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "غير محدد";
        }

        return new Intl.DateTimeFormat(
            "ar-SA",
            {
                dateStyle: "medium",
                timeStyle: "short"
            }
        ).format(date);
    }

    function getTaskState(task) {
        if (!task) {
            return "unknown";
        }

        if (task.status === STATUS.COMPLETED) {
            return "completed";
        }

        if (task.status === STATUS.CANCELLED) {
            return "cancelled";
        }

        if (isOverdue(task)) {
            return "overdue";
        }

        if (task.status === STATUS.IN_PROGRESS) {
            return "in_progress";
        }

        return "pending";
    }

    function getTaskStateLabel(task) {
        const state = getTaskState(task);

        const labels = {
            completed: "مكتملة",
            cancelled: "ملغاة",
            overdue: "متأخرة",
            in_progress: "قيد التنفيذ",
            pending: "معلقة",
            unknown: "غير محددة"
        };

        return labels[state] || "غير محددة";
    }

    /* =====================================================
       إعادة التهيئة
    ===================================================== */

    async function refresh() {
        initialized = false;
        tasks.clear();

        await ensureLoaded();

        return {
            success: true,
            count: tasks.size
        };
    }

    function resetMemory() {
        tasks.clear();
        initialized = false;

        return {
            success: true,
            message: "تمت إعادة تهيئة الذاكرة المحلية."
        };
    }

    /* =====================================================
       الواجهة العامة
    ===================================================== */

    window.IBRCustomerTasks = Object.freeze({

        VERSION: VERSION,

        STATUS: STATUS,
        PRIORITY: PRIORITY,
        TYPE: TYPE,

        STATUS_LABELS: STATUS_LABELS,
        PRIORITY_LABELS: PRIORITY_LABELS,
        TYPE_LABELS: TYPE_LABELS,

        configure: configure,
        getConfiguration: getConfiguration,
        validateAdapter: validateAdapter,

        normalizeTask: normalizeTask,
        validateTask: validateTask,
        normalizePhone: normalizePhone,

        createTask: createTask,
        updateTask: updateTask,
        deleteTask: deleteTask,

        getTasks: getTasks,
        getTaskById: getTaskById,
        getTasksByCustomer: getTasksByCustomer,
        getTasksByOrder: getTasksByOrder,
        getTasksByMessage: getTasksByMessage,

        setTaskStatus: setTaskStatus,
        startTask: startTask,
        completeTask: completeTask,
        cancelTask: cancelTask,
        reopenTask: reopenTask,

        isOverdue: isOverdue,
        getOverdueTasks: getOverdueTasks,
        getUpcomingTasks: getUpcomingTasks,
        getTasksDueToday: getTasksDueToday,

        getTaskStats: getTaskStats,
        getTasksGroupedByStatus:
            getTasksGroupedByStatus,
        getTasksGroupedByPriority:
            getTasksGroupedByPriority,

        getCustomerTaskSummary:
            getCustomerTaskSummary,

        addTaskNote: addTaskNote,
        clearCompletedTasks: clearCompletedTasks,

        getStatusLabel: getStatusLabel,
        getPriorityLabel: getPriorityLabel,
        getTypeLabel: getTypeLabel,
        getTaskState: getTaskState,
        getTaskStateLabel: getTaskStateLabel,

        formatDate: formatDate,
        formatDateTime: formatDateTime,

        refresh: refresh,
        resetMemory: resetMemory

    });

    console.info(
        "IBR Customer Tasks Service v" +
        VERSION +
        " initialized."
    );

})(window);
