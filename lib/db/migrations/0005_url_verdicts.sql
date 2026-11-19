CREATE TABLE "url_verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"categoria" text NOT NULL,
	"status" text NOT NULL,
	"categoria_sugerida" text,
	"reason" text,
	"source" text NOT NULL,
	"veiculo" text,
	"impressoes" integer,
	"reviewed" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "url_verdicts_url_cat_source" ON "url_verdicts" USING btree ("url","categoria","source");