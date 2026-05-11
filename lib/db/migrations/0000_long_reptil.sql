CREATE TABLE IF NOT EXISTS "file_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_session_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "file_exports" ADD CONSTRAINT "file_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "file_exports" ADD CONSTRAINT "file_exports_chat_session_id_chat_sessions_id_fk" FOREIGN KEY ("chat_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
