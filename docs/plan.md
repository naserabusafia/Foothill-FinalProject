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

## اليوم 2 (16/10): الخطط والمستخدمين ✅

**`feat/plans-and-users`**
- [x] `GET /plans` (جاهزة + خاصة، `?scope=`)، `GET /plans/:id`، `POST /plans`، `PATCH /plans/:id`
- [x] `POST /users` (Basic افتراضياً)، `GET /users` (cursor + `?externalId=`)، `GET /users/:id`، `PATCH /users/:id/plan`
- [x] `PATCH /account/plan`
- [x] فحص الملكية بمكان واحد: `getPlanOrThrow` / `getAssignablePlanOrThrow`
- [x] `shared/pagination.ts`: cursor بدقة الميكروثانية
- [x] `maxUnitsPerRequest > monthlyLimit` ← 400، والتعديل الجزئي يُفحص مع القيمة المخزّنة (تحت قفل)
- [x] **اختبارات (53 جديدة، 98 المجموع):** نوع خطة خاطئ، خطة أو مستخدم لشركة أخرى (404)، تعديل خطة جاهزة (403)، تغيير الـ scope، `externalId` مكرر (409)، pagination كامل بدون تكرار، تعديل خطة مشتركة يظهر عند كل مستخدميها

---

## اليوم 3 + 4 (19/10): الاستهلاك والتزامن ⭐ ✅

**`feat/consumption`**
- [x] `shared/month.ts`: الشهر الحالي UTC + صيغة `YYYY-MM`
- [x] `decide.ts` + `remaining()`: pure، مع اختبارات كل قاعدة والحدود بالضبط وترتيب الأسباب
- [x] `consume.repository.ts`: setLockTimeout، reserve، findRequest، ensureUsageRows، lock×2، loadCurrentPlans، increment، saveDecision
- [x] `consume.service.ts`: الفلو الكامل + فرع الإعادة (القرار الأصلي + هيدر `Idempotent-Replayed` / 409)
- [x] `POST /consumptions` (القبول والرفض الاثنين 200)
- [x] `SET LOCAL lock_timeout` (`CONSUME_LOCK_TIMEOUT_MS`، افتراضي 2 ثانية) ← 503
- [x] **اختبارات سلوك:** قبول وزيادة الطرفين، كل نوع رفض بدون خصم، الحد بالضبط، الإعادة حرفياً، إعادة رفض بعد ترقية الخطة، 409، requestId لكل شركة، تغيير الخطة بدون تصفير، حد أقل من المستهلك، شهر جديد
- [x] **اختبارات تزامن:** حد 100 + 200 طلب = 100 قبول بالضبط؛ حد مستخدم 50 + 100 طلب = 50؛ نفس `requestId` × 20 = خصم واحد؛ تعديل خطة أثناء 100 طلب
- [x] `tests/helpers/invariants.ts`: الثوابت الخمسة بعد كل اختبار تزامن
- [x] **إثبات:** بإزالة `FOR UPDATE` مؤقتاً، اختبار الـ 200 طلب فشل (103 قبول بدل 100)
- 140 اختبار بالمجموع

**`feat/usage-and-history`** ✅
- [x] `GET /account/usage?month=`، `GET /users/:id/usage?month=`: الشهر الحالي فيه الخطة والمتبقي، والشهر القديم `used` فقط، والشهر بالمستقبل 400
- [x] `GET /consumptions`: cursor + فلاتر `userId` و `status` و `month`، وكل عنصر بنفس شكل رد `POST`
- [x] 20 اختبار جديد (160 بالمجموع)

---

## اليوم 5 (19/10): Docker والـ Client والقياس

**`chore/docker-full-stack`** ✅
- [x] `Dockerfile`: multi-stage (build ← runtime)، مكتبات التشغيل فقط، يوزر `node` مش root، `HEALTHCHECK` على `/health`
- [x] `.dockerignore`: `.env` و `node_modules` و `.git` ما بيدخلوا الـ image
- [x] `server.ts`: migrate + seed عند البدء (`RUN_MIGRATIONS_ON_START`)، وإيقاف آمن عند `SIGTERM`
- [x] compose: `db` + `api` (بيستنى `db` healthy)
- [x] تحقق: `down -v` ثم `up --build` من الصفر ← healthy، حساب + مستخدم + استهلاك، `restart` والبيانات ضلت، `stop` بيسكّر بأمان

**باقي اليوم 5**
**`feat/example-client`** ✅
- [x] `client/demo.ts`: بدون مكتبات (Node 24 بيشغّل TS مباشرة + `fetch`)، 10 خطوات: حساب، خطط خاصة، مستخدمين بخطط مختلفة، قبول، رفض بحد المستخدم، رفض بحد الشركة رغم رصيد المستخدم، إعادة `requestId`، رفع الخطة عبر الـ API والنتيجة بتتغيّر، الاستهلاك، السجل
- [x] service `client` بالـ compose: بيستنى `api` healthy، بيشغّل السيناريو مرة وبيطلع؛ وإعادته بـ `docker compose run --rm client`
- [x] `npm run demo` للتشغيل المحلي
- [x] تحقق: `down -v` ثم `up --build` ← الـ client خلّص بـ exit code 0
- [ ] Load test: شركة ساخنة، موزّع، مختلط، قرب الحد، وتسجيل النتائج

---

## اليوم 6 (20/10): README والتسليم

**`docs/readme`** ✅
- [x] README بالإنجليزي: التشغيل، مثال كامل، الـ API والأخطاء، الخطط الجاهزة، الافتراضات، التصميم، التزامن (مع تجربة إزالة القفل)، الأداء، الاختبارات، الإعدادات، التحسينات المستقبلية
- [x] تجربة من clone نظيف من GitHub: `docker compose up --build` بدون أي إعداد ← الـ client خلّص بـ exit 0؛ `npm ci` + typecheck + 160 اختبار ✅
- [ ] Load test: ما لحقنا، ومكتوب بالـ README كتحسين مستقبلي

---

## الأولويات إذا ضاق الوقت

| 🔴 لازم | 🟡 مهم | 🟢 إذا ضل وقت |
|---|---|---|
| الاستهلاك + idempotency + الأقفال | فلاتر السجل | حد تزامن لكل شركة |
| اختبارات التزامن | `lock_timeout` + 503 | دمج الاستعلامات لتقليل الرحلات |
| Docker + seed تلقائي | Load test بأرقام | صفحة HTML بدل CLI |
| README بالافتراضات | `external_id` | تدوير المفاتيح |

اليوم 3 و 4 هما جوهر المشروع. لو صار تأخير، نختصر من CRUD الخطط والمستخدمين، وما نختصر من الاستهلاك.
