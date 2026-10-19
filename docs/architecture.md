# هيكل المشروع والقواعد المعتمدة

> هذا الملف هو **المرجع** لطريقة تنظيم الكود. أي ملف أو feature جديد يتبع هذه القواعد.
> تصميم الداتابيس: [database-design.md](database-design.md) · الخطة: [plan.md](plan.md)

---

## 1. الأدوات (Stack)

| الغرض | الأداة | النسخة |
|---|---|---|
| Runtime | Node.js | ≥ 22 (التطوير على 24) |
| اللغة | TypeScript | 7.x، `strict` |
| السيرفر | Express | 5.x |
| ORM | drizzle-orm + `pg` (node-postgres) | 0.45.x |
| Migrations | drizzle-kit | 0.31.x |
| التحقق | zod | 4.x |
| تشغيل TS بالتطوير | tsx | 4.x |
| الاختبارات | vitest + supertest | 5.x / 7.x |
| الداتابيس | PostgreSQL | 17 (Docker) |

**ليش Express 5؟** أي خطأ بـ `async` handler بيروح للـ error handler تلقائياً، فما بنحتاج `try/catch` أو `asyncHandler` بكل route.

**نظام الـ modules:** CommonJS (`module: nodenext` بدون `"type": "module"`)، فالـ imports النسبية **بدون** `.js`.

---

## 2. الهيكل

```
.
├─ docs/                     ← التصميم، الهيكل، الخطة
├─ drizzle/                  ← migrations مولّدة (لا تُعدَّل يدوياً)
├─ docker/postgres/init/     ← سكربتات أول تشغيل للداتابيس (quota_test)
├─ src/
│  ├─ app.ts                 ← يبني Express app (بدون listen)، يستخدمه supertest
│  ├─ server.ts              ← listen (ولاحقاً: migrate + seed عند البدء)
│  ├─ config.ts              ← env + zod، يوقف التشغيل إذا config ناقص
│  ├─ db/
│  │  ├─ schema.ts           ← كل الجداول والقيود (ملف واحد)
│  │  ├─ client.ts           ← Pool + drizzle + أنواع Db / Tx / DbOrTx
│  │  ├─ errors.ts           ← getPgError() + أكواد Postgres (SQLSTATE)
│  │  ├─ utils.ts            ← firstRow() لنتائج RETURNING
│  │  ├─ migrate.ts          ← runMigrations() (دالة فقط)
│  │  └─ seed.ts             ← PREDEFINED_PLAN_IDS + seedPredefinedPlans() (دالة فقط)
│  ├─ scripts/               ← نقاط تشغيل CLI: db-migrate.ts، db-seed.ts
│  ├─ types/express.d.ts     ← يضيف req.accountId لنوع Request
│  ├─ shared/                ← أدوات مشتركة فعلاً بين modules
│  │  ├─ errors.ts           ← AppError وأنواعه
│  │  ├─ validation.ts       ← validate(schema, data): يرجّع قيمة typed أو يرمي 400
│  │  ├─ apiKey.ts           ← generateApiKey، hashApiKey (sha256)، secretsEqual
│  │  ├─ month.ts            ← currentMonthUtc(), parseMonth()
│  │  └─ pagination.ts       ← cursor encode/decode
│  ├─ middleware/
│  │  ├─ apiKeyAuth.ts       ← x-api-key ← req.accountId، و getAccountId(req)
│  │  ├─ adminAuth.ts        ← x-admin-key (مقارنة constant-time)
│  │  └─ errorHandler.ts     ← notFoundHandler + errorHandler (آخر middleware)
│  └─ modules/
│     ├─ accounts/   accounts.routes.ts · accounts.service.ts · accounts.schemas.ts
│     ├─ plans/      plans.routes.ts    · plans.service.ts    · plans.schemas.ts
│     ├─ users/      users.routes.ts    · users.service.ts    · users.schemas.ts
│     ├─ usage/      usage.routes.ts    · usage.service.ts
│     └─ consumptions/
│        ├─ consumptions.routes.ts
│        ├─ consumptions.schemas.ts
│        ├─ consume.service.ts       ← يرتّب خطوات الـ transaction
│        ├─ consume.repository.ts    ← queries الأقفال (تأخذ tx إجبارياً)
│        └─ decide.ts                ← منطق القرار، pure function بدون DB
├─ tests/
│  ├─ setup/                 ← env.ts (يوجّه لـ quota_test)، global.ts (migrate مرة)، perFile.ts (يسكّر الـ pool)
│  ├─ helpers/               ← resetDb، createTestAccount، createTestPlan...
│  ├─ unit/                  ← decide, month...
│  └─ integration/           ← كل endpoint + التزامن (على Postgres حقيقي)
├─ client/                   ← الـ example client (CLI)
├─ loadtest/                 ← سيناريوهات autocannon
├─ docker-compose.yml
├─ drizzle.config.ts
└─ tsconfig.json / tsconfig.build.json
```

**المبدأ:** تقسيم حسب الميزة من برا (`modules/<feature>`)، وطبقات من جوّا (routes ← service ← db). هذا المتّبع في Node.js Best Practices (1.1 و 1.2).

---

## 3. الطبقات: مين يعمل شو

| الطبقة | الملف | مسموح | ممنوع |
|---|---|---|---|
| **Routes** | `*.routes.ts` | قراءة `req`، التحقق (zod)، استدعاء service، إرسال الرد | منطق أعمال، queries |
| **Service** | `*.service.ts` | منطق الأعمال، queries الـ CRUD، رمي `AppError` | لمس `req` / `res` |
| **Repository** | `consume.repository.ts` فقط | queries الاستهلاك والأقفال | منطق القرار |
| **Domain** | `decide.ts` | حسابات نقية | أي I/O (DB، شبكة) |

- الـ service **يأخذ `accountId` كباراميتر** دائماً، فالعزل بين الشركات واضح بكل دالة.
- ما في repository لـ CRUD العادي: Drizzle أصلاً query builder رفيع، والطبقة الإضافية تكرار بدون فائدة.

---

## 4. وين تُكتب الـ queries

**القاعدة: ملف لكل module، و function لكل عملية. مش ملف لكل query.**

| الشي | المكان |
|---|---|
| تعريف الجداول والقيود | `src/db/schema.ts` |
| الـ migrations | `drizzle/`، تُولَّد بـ `npm run db:generate` |
| queries الـ CRUD | داخل `modules/<name>/<name>.service.ts` |
| queries الاستهلاك والأقفال | `modules/consumptions/consume.repository.ts` |

**ملكية الجداول:** كل جدول له module "صاحب"، والـ modules الأخرى تستدعي دواله ولا تكرر الـ query.

| الجدول | الصاحب |
|---|---|
| `accounts`, `api_keys` | `accounts` |
| `plans` | `plans` |
| `users` | `users` |
| `account_monthly_usage`, `user_monthly_usage` | `usage` (قراءة) |
| `consumption_requests` + الكتابة على العدّادات | `consumptions` |

الاستثناء: `consume.repository.ts` يلمس عدة جداول، لأن كل شي لازم يصير بنفس الـ transaction.

**مثال:**
```ts
// modules/users/users.service.ts
export async function getUserOrThrow(accountId: string, userId: string, conn: DbOrTx = db) { ... }

// modules/usage/usage.service.ts
import { getUserOrThrow } from "../users/users.service";
```

---

## 5. قواعد الداتابيس

1. **تعديل الجداول = تعديل `schema.ts` ثم `npm run db:generate`.** لا تعدّل ملفات `drizzle/` يدوياً، وراجع الـ SQL المولّد قبل الـ commit.
2. **الأسماء camelCase بالـ TS، و snake_case بالداتابيس** تلقائياً (`casing: "snake_case"` في `client.ts` و `drizzle.config.ts`).
3. **أسماء القيود صريحة** (`accounts_plan_fk`، `..._ck`، `..._uk`)، حتى نقدر نترجم أخطاء الداتابيس لرسائل واضحة.
4. **داخل الـ transaction: `tx` دائماً، ولا `db` أبداً.** دوال `consume.repository.ts` تأخذ `Tx` (مش `DbOrTx`)، فـ TypeScript يمنع استدعاءها برا الـ transaction.
5. **ترتيب الأقفال ثابت:** عدّاد الشركة ثم عدّاد المستخدم.
6. **لا اتصالات خارجية داخل الـ transaction.**
7. **الزيادة بالـ SQL** (`used_units + n`)، وليست قيمة محسوبة بالكود.
8. **`bigint` بـ `mode: "number"`** و **`date` بـ `mode: "string"`** (`"2026-10-01"`).

---

## 6. قواعد الـ API

**تركيب الـ routers:** أي router بيستخدم `router.use(apiKeyAuth)` لازم يتركّب تحت prefix خاص فيه (`app.use("/users", usersRouter)`). لو تركّب على الجذر، الـ auth تبعه بيشتغل على **كل** الطلبات اللي بتمر فيه، حتى `POST /accounts` والمسارات غير الموجودة. `accountsRouter` على الجذر لأنه بيخدم `/accounts` و `/account`، فالـ auth فيه لكل route لحاله.

| الحالة | الكود | الشكل |
|---|---|---|
| نجاح | 200 / 201 | الكائن مباشرة |
| قرار رفض استهلاك | **200** | `{ accepted: false, rejection: { rule, scope }, ... }` |
| بيانات غير صالحة | 400 | `{ error: { code, message, details? } }` |
| مفتاح ناقص أو خاطئ | 401 | |
| تعديل خطة جاهزة | 403 | |
| غير موجود أو لشركة أخرى | **404** | ما نكشف إنه موجود عند غيرك |
| JSON خاطئ / body أكبر من 100kb | 400 / 413 | `INVALID_JSON` / `PAYLOAD_TOO_LARGE` |
| خطأ غير متوقع | 500 | `INTERNAL_ERROR` فقط، والتفاصيل بالـ log |
| `requestId` مكرر ببيانات مختلفة | 409 | |
| انتهاء مهلة القفل | 503 + `Retry-After` | خطأ مؤقت، مش قرار |

- الهيدر: `x-api-key` للشركات و `x-admin-key` لإنشاء الحسابات.
- القوائم بـ **cursor pagination**: `?limit=&cursor=` ← `{ items, nextCursor }`.
- الشهر بالـ query بصيغة `YYYY-MM`، والافتراضي الشهر الحالي UTC.

---

## 7. الاختبارات

- **Integration على Postgres حقيقي** (`quota_test`)، بدون mocks للداتابيس، لأن الأقفال والقيود هي اللي بنختبرها.
- `tests/setup/env.ts` يغيّر `DATABASE_URL` لـ `TEST_DATABASE_URL` **قبل** أي import من `src`، فقاعدة التطوير لا تُلمس أبداً.
- الـ migrations تُطبَّق مرة واحدة قبل كل الاختبارات (`globalSetup`).
- `resetDb()` في `beforeEach`: `TRUNCATE ... CASCADE` ثم seed، فكل اختبار يبدأ من حالة نظيفة.
- الملفات تشتغل **واحد ورا الثاني** (`fileParallelism: false`) لأنها تشارك نفس القاعدة.
- الـ factories (`createTestAccount`...) تستخدم الـ services الحقيقية، مش inserts يدوية، إلا لما الـ API لسه مش موجود.
- **Unit** للمنطق النقي (`decide`، `month`).
- بعد اختبارات التزامن: استعلامات الثوابت من `database-design.md` (القسم 7).

---

## 8. أوامر التطوير

**تشغيل كل شي بـ Docker** (زي المقيّم):
```bash
docker compose up --build    # db + api، migrate + seed تلقائي، http://localhost:3000
docker compose down          # إيقاف (البيانات بتضل)
docker compose down -v       # إيقاف + مسح الداتابيس
```

**تطوير محلي** (السيرفر برا Docker، مع إعادة تحميل تلقائية):
```bash
cp .env.example .env
docker compose up -d --wait db   # الداتابيس بس، لأن api بياخد المنفذ 3000
npm run dev                      # migrate + seed عند البدء، http://localhost:3000
npm test
npm run typecheck
npm run db:generate              # بعد أي تعديل على schema.ts
npm run db:studio                # واجهة لتصفح الداتابيس
```

Postgres مكشوف على المنفذ **5433** (وليس 5432) لتجنب التعارض مع أي Postgres محلي.

**ملاحظة:** سكربت إنشاء `quota_test` بيشتغل **مرة وحدة** عند إنشاء الـ volume. إذا الاختبارات اشتكت إن القاعدة مش موجودة: `docker compose down -v` ثم `up` من جديد.

---

## 9. Git

- commit بنهاية كل مرحلة من [plan.md](plan.md).
- أي قرار أو افتراض جديد يُكتب فوراً في `database-design.md` (القسم 9) أو الـ README.
