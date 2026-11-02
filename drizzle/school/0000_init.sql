CREATE TYPE "public"."student_status" AS ENUM('applicant', 'registered', 'enrolled', 'transferred_out', 'graduated', 'withdrawn');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"context" jsonb
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_role" (
	"person_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "person_role_person_id_role_key_pk" PRIMARY KEY("person_id","role_key")
);
--> statement-breakpoint
CREATE TABLE "school_identity" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"admission_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"status" "student_status" DEFAULT 'registered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_guardian" (
	"student_id" uuid NOT NULL,
	"guardian_person_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_guardian_student_id_guardian_person_id_pk" PRIMARY KEY("student_id","guardian_person_id")
);
--> statement-breakpoint
ALTER TABLE "person_role" ADD CONSTRAINT "person_role_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_guardian" ADD CONSTRAINT "student_guardian_guardian_person_id_person_id_fk" FOREIGN KEY ("guardian_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_platform_user_uq" ON "person" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_admission_number_uq" ON "student" USING btree ("admission_number");--> statement-breakpoint
CREATE INDEX "student_name_idx" ON "student" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "student_guardian_guardian_idx" ON "student_guardian" USING btree ("guardian_person_id");