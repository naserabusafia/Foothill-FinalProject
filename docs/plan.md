# خطة التنفيذ

> المدة: 14/10/2026 → نهاية 20/10/2026.
> القاعدة: كل مرحلة تنتهي بشي **شغّال ومختبَر** + commit.
> الهيكل والقواعد: [architecture.md](architecture.md) · الداتابيس: [database-design.md](database-design.md)

---

## اليوم 0 (14/10): الأساس والداتابيس ✅

- [x] هيكل المجلدات، `package.json`، `tsconfig`، `.gitignore`، `.env.example`، `git init`
- [x] `docker-compose.yml`: Postgres 17 فقط، مع healthcheck و volume، وقاعدة `quota_test` تلقائياً
- [x] `src/config.ts`: تحقق من الـ env بـ zod
- [x] `src/db/schema.ts`: الجداول السبعة بكل القيود
- [x] `src/db/client.ts`: Pool + drizzle + أنواع `Tx` / `DbOrTx`
- [x] `drizzle/0000_init.sql`: مولّدة ومراجَعة
- [x] `migrate.ts` + `seed.ts`، والـ seed آمن للتكرار
- [x] تحقق يدوي: القيود العشرة الأساسية ترفض البيانات الخاطئة
- [x] `app.ts` / `server.ts` مع `GET /health`
- [x] commit (PR #1)

---

## اليوم 1 (15/10): البنية التحتية والحسابات

**`feat/error-handling`**
- [x] `shared/errors.ts`: `AppError(status, code, message, details?)` + 7 أنواع
- [x] `shared/validation.ts`: `validate(schema, data)`، helper وليس middleware (القيمة تضل typed، و `req.query` بـ Express 5 للقراءة فقط)
- [x] `middleware/errorHandler.ts`: شكل موحّد، zod ← 400، JSON خاطئ ← 400، body كبير ← 413، lock timeout / pool ← 503 + `Retry-After`، غير متوقع ← 500 بدون تفاصيل
- [x] `db/errors.ts`: `getPgError()` يقرأ الخطأ الأصلي من `DrizzleQueryError.cause`
- [x] `DB_POOL_MAX` و `DB_CONNECTION_TIMEOUT_MS` بالـ config
- [x] vitest + 16 اختبار للأخطاء

**`feat/auth-and-accounts`** (دمجنا الـ branchين لتعويض التأخير)
- [x] `shared/apiKey.ts`: مفتاح `uq_` + 32 بايت عشوائي، `sha256`، prefix، و `secretsEqual` (constant-time)
- [x] `middleware/apiKeyAuth.ts` (401 `MISSING_API_KEY` / `INVALID_API_KEY`) و `middleware/adminAuth.ts`
- [x] `POST /accounts` (admin، الافتراضي Starter، خطط جاهزة فقط، المفتاح يظهر مرة واحدة) و `GET /account`
- [x] `plans.service.ts`: `getAssignablePlanOrThrow()` + `toPlanResponse()` (أول جزء من module الخطط)
- [x] فصل `migrate` / `seed` عن سكربتات الـ CLI (`src/scripts/`)
- [x] بنية الاختبارات: `quota_test`، globalSetup، `resetDb`، factories
- [x] **اختبارات (29 جديدة، 45 المجموع):** مفتاح ناقص / خاطئ / طويل / ملغي / صحيح، hash فقط بالداتابيس، admin key، خطة بنوع خاطئ، خطة شركة أخرى (404)، تحقق المدخلات، عزل الحسابات

---

## اليوم 2 (16/10): الخطط والمستخدمين

- [ ] `GET /plans`، `GET /plans/:id`، `POST /plans`، `PATCH /plans/:id`
- [ ] `POST /users`، `GET /users`، `GET /users/:id`، `PATCH /users/:id/plan`
- [ ] `PATCH /account/plan`
- [ ] فحص الملكية: `owner_account_id IS NULL OR = accountId` + الـ scope
- [ ] **اختبارات:** خطة بنوع خاطئ، خطة أو مستخدم لشركة أخرى (404)، تعديل خطة جاهزة (403)، مستخدمين بنفس الخطة

---

## اليوم 3 (17/10): الاستهلاك ⭐

- [ ] `decide.ts` **مع اختباراته أولاً**: كل قاعدة، الحدود بالضبط، ترتيب الأسباب
- [ ] `consume.repository.ts`: reserve، ensureMonthRows، lock×2، loadPlans، increment، saveDecision
- [ ] `consume.service.ts`: الفلو الكامل + فرع الإعادة (القرار الأصلي / 409)
- [ ] `POST /consumptions`
- [ ] **اختبارات:** قبول وزيادة الطرفين، كل نوع رفض بدون خصم، الإعادة، 409، تغيير الخطة بدون تصفير، حد أقل من المستهلك

---

## اليوم 4 (18/10): التزامن والقراءات

- [ ] حد 100 + 200 طلب متزامن = 100 قبول بالضبط
- [ ] نفس `requestId` × 20 بالتزامن = خصم واحد
- [ ] تعديل خطة أثناء طلبات متزامنة
- [ ] استعلامات الثوابت بعد كل اختبار تزامن
- [ ] `SET LOCAL lock_timeout` + 503
- [ ] `GET /account/usage?month=`، `GET /users/:id/usage?month=`
- [ ] `GET /consumptions` (cursor + فلاتر `userId` و `status`)

---

## اليوم 5 (19/10): Docker والـ Client والقياس

- [ ] `Dockerfile` (multi-stage)
- [ ] compose كامل: `db` + `api` + `client`، و migrate + seed تلقائي عند البدء
- [ ] الـ example client (CLI): قبول، رفض مستخدم، رفض شركة، تعديل خطة، تغيّر النتيجة
- [ ] Load test: شركة ساخنة، موزّع، مختلط، قرب الحد، وتسجيل النتائج

---

## اليوم 6 (20/10): README والتسليم

- [ ] README: التشغيل، الـ API بأمثلة، الخطط الجاهزة، الافتراضات، القرارات، نتائج الأداء
- [ ] تنظيف وتوحيد
- [ ] تجربة من clone نظيف: `docker compose up --build` + الـ client + كل الاختبارات

---

## الأولويات إذا ضاق الوقت

| 🔴 لازم | 🟡 مهم | 🟢 إذا ضل وقت |
|---|---|---|
| الاستهلاك + idempotency + الأقفال | فلاتر السجل | حد تزامن لكل شركة |
| اختبارات التزامن | `lock_timeout` + 503 | دمج الاستعلامات لتقليل الرحلات |
| Docker + seed تلقائي | Load test بأرقام | صفحة HTML بدل CLI |
| README بالافتراضات | `external_id` | تدوير المفاتيح |

اليوم 3 و 4 هما جوهر المشروع. لو صار تأخير، نختصر من CRUD الخطط والمستخدمين، وما نختصر من الاستهلاك.
