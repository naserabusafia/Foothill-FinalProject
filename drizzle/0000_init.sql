CREATE TYPE "public"."plan_scope" AS ENUM('account', 'user');--> statement-breakpoint
CREATE TYPE "public"."rejection_rule" AS ENUM('max_units_per_request', 'monthly_limit');--> statement-breakpoint
CREATE TYPE "public"."rejection_scope" AS ENUM('account', 'user');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "account_monthly_usage" (
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_monthly_usage_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "account_monthly_usage_month_ck" CHECK ("account_monthly_usage"."month" = date_trunc('month', "account_monthly_usage"."month")::date),
	CONSTRAINT "account_monthly_usage_used_units_ck" CHECK ("account_monthly_usage"."used_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_scope" "plan_scope" DEFAULT 'account' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_plan_scope_ck" CHECK ("accounts"."plan_scope" = 'account')
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"key_hash" char(64) NOT NULL,
	"key_prefix" varchar(12) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_uk" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "consumption_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" varchar(255) NOT NULL,
	"units" bigint NOT NULL,
	"month" date NOT NULL,
	"status" "request_status" NOT NULL,
	"rejection_rule" "rejection_rule",
	"rejection_scope" "rejection_scope",
	"account_plan_id" uuid,
	"user_plan_id" uuid,
	"account_monthly_limit" bigint,
	"user_monthly_limit" bigint,
	"account_max_per_request" bigint,
	"user_max_per_request" bigint,
	"account_used_before" bigint,
	"user_used_before" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "consumption_requests_idempotency_uk" UNIQUE("account_id","request_id"),
	CONSTRAINT "consumption_requests_units_ck" CHECK ("consumption_requests"."units" > 0),
	CONSTRAINT "consumption_requests_month_ck" CHECK ("consumption_requests"."month" = date_trunc('month', "consumption_requests"."month")::date),
	CONSTRAINT "consumption_requests_rejection_ck" CHECK (("consumption_requests"."status" = 'rejected' AND "consumption_requests"."rejection_rule" IS NOT NULL AND "consumption_requests"."rejection_scope" IS NOT NULL)
       OR ("consumption_requests"."status" <> 'rejected' AND "consumption_requests"."rejection_rule" IS NULL AND "consumption_requests"."rejection_scope" IS NULL)),
	CONSTRAINT "consumption_requests_decided_ck" CHECK ("consumption_requests"."status" = 'pending' OR (
        "consumption_requests"."decided_at" IS NOT NULL
        AND "consumption_requests"."account_plan_id" IS NOT NULL AND "consumption_requests"."user_plan_id" IS NOT NULL
        AND "consumption_requests"."account_monthly_limit" IS NOT NULL AND "consumption_requests"."user_monthly_limit" IS NOT NULL
        AND "consumption_requests"."account_max_per_request" IS NOT NULL AND "consumption_requests"."user_max_per_request" IS NOT NULL
        AND "consumption_requests"."account_used_before" IS NOT NULL AND "consumption_requests"."user_used_before" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"scope" "plan_scope" NOT NULL,
	"owner_account_id" uuid,
	"monthly_limit" bigint NOT NULL,
	"max_units_per_request" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_id_scope_uk" UNIQUE("id","scope"),
	CONSTRAINT "plans_monthly_limit_ck" CHECK ("plans"."monthly_limit" > 0),
	CONSTRAINT "plans_max_units_per_request_ck" CHECK ("plans"."max_units_per_request" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_monthly_usage" (
	"user_id" uuid NOT NULL,
	"month" date NOT NULL,
	"used_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_monthly_usage_pk" PRIMARY KEY("user_id","month"),
	CONSTRAINT "user_monthly_usage_month_ck" CHECK ("user_monthly_usage"."month" = date_trunc('month', "user_monthly_usage"."month")::date),
	CONSTRAINT "user_monthly_usage_used_units_ck" CHECK ("user_monthly_usage"."used_units" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" varchar(255),
	"name" varchar(200) NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_scope" "plan_scope" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_account_id_uk" UNIQUE("account_id","id"),
	CONSTRAINT "users_external_id_uk" UNIQUE("account_id","external_id"),
	CONSTRAINT "users_plan_scope_ck" CHECK ("users"."plan_scope" = 'user')
);
--> statement-breakpoint
ALTER TABLE "account_monthly_usage" ADD CONSTRAINT "account_monthly_usage_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plan_fk" FOREIGN KEY ("plan_id","plan_scope") REFERENCES "public"."plans"("id","scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumption_requests" ADD CONSTRAINT "consumption_requests_user_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."users"("account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_monthly_usage" ADD CONSTRAINT "user_monthly_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_plan_fk" FOREIGN KEY ("plan_id","plan_scope") REFERENCES "public"."plans"("id","scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_account_idx" ON "api_keys" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "consumption_requests_account_created_idx" ON "consumption_requests" USING btree ("account_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "consumption_requests_user_created_idx" ON "consumption_requests" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plans_owner_account_idx" ON "plans" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "users_plan_idx" ON "users" USING btree ("plan_id");