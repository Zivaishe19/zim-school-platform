CREATE TYPE "public"."application_status" AS ENUM('draft', 'submitted', 'under_review', 'info_required', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."assessment_kind" AS ENUM('classwork', 'assignment', 'test', 'exam', 'coursework', 'cala', 'practical');--> statement-breakpoint
CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'absent', 'late', 'early_departure', 'approved_absence');--> statement-breakpoint
CREATE TYPE "public"."book_status" AS ENUM('available', 'on_loan', 'lost', 'damaged', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."enrolment_status" AS ENUM('active', 'completed', 'withdrawn', 'transferred_out');--> statement-breakpoint
CREATE TYPE "public"."entry_type" AS ENUM('form1', 'form4', 'lower6', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."exam_board" AS ENUM('zimsec', 'cambridge', 'internal');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('reported', 'approved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('charge', 'payment');--> statement-breakpoint
CREATE TYPE "public"."mark_status" AS ENUM('missing', 'pending', 'submitted', 'marked', 'approved', 'published');--> statement-breakpoint
CREATE TYPE "public"."message_category" AS ENUM('absence_explanation', 'academic_concern', 'meeting_request', 'discipline', 'document_request', 'fees', 'general');--> statement-breakpoint
CREATE TYPE "public"."period_kind" AS ENUM('lesson', 'break', 'lunch', 'assembly', 'other');--> statement-breakpoint
CREATE TYPE "public"."progression_decision" AS ENUM('proposed', 'promote', 'repeat', 'leave', 'graduate');--> statement-breakpoint
CREATE TYPE "public"."proof_status" AS ENUM('pending', 'verified', 'rejected', 'info_requested');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'submitted', 'approved', 'published');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."year_status" AS ENUM('planned', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "absence_explanation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"reason" text NOT NULL,
	"submitted_by" uuid NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academic_year" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "year_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_year_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"patron_person_id" uuid,
	"schedule" text,
	CONSTRAINT "activity_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "activity_member" (
	"activity_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"role" text,
	"joined_on" date NOT NULL,
	"left_on" date,
	CONSTRAINT "activity_member_activity_id_student_id_joined_on_pk" PRIMARY KEY("activity_id","student_id","joined_on")
);
--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb NOT NULL,
	"author_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"entry_type" "entry_type" NOT NULL,
	"applying_for_level" integer NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"previous_school" text,
	"guardian_name" text NOT NULL,
	"guardian_phone" text NOT NULL,
	"guardian_email" text,
	"source" text NOT NULL,
	"status" "application_status" DEFAULT 'submitted' NOT NULL,
	"staff_notes" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"student_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "application_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"received_physically" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teaching_group_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "assessment_kind" NOT NULL,
	"max_score" numeric(7, 2) NOT NULL,
	"weight" numeric(5, 2),
	"due_on" date,
	"instructions" text,
	"accepts_submissions" boolean DEFAULT false NOT NULL,
	"status" "assessment_status" DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_mark" (
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"note" text,
	CONSTRAINT "attendance_mark_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"class_id" uuid,
	"teaching_group_id" uuid,
	"period" text,
	"taken_by" uuid,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accession_number" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"isbn" text,
	"category" text,
	"status" "book_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_accession_number_unique" UNIQUE("accession_number")
);
--> statement-breakpoint
CREATE TABLE "discipline_incident" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"occurred_on" date NOT NULL,
	"reported_by" uuid NOT NULL,
	"recommended_action" text,
	"approved_action" text,
	"status" "incident_status" DEFAULT 'reported' NOT NULL,
	"visible_to_parent" boolean DEFAULT false NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duty_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"role" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"note" text,
	"assigned_by" uuid
);
--> statement-breakpoint
CREATE TABLE "enrolment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"status" "enrolment_status" DEFAULT 'active' NOT NULL,
	"is_repeat" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"description" text,
	"audience" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"term_id" uuid,
	"form_level" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"purpose" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_object_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "form" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"level" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "form_level_unique" UNIQUE("level")
);
--> statement-breakpoint
CREATE TABLE "grading_scale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"exam_board" "exam_board" NOT NULL,
	"bands" jsonb NOT NULL,
	CONSTRAINT "grading_scale_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"teaching_group_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	CONSTRAINT "group_member_teaching_group_id_student_id_pk" PRIMARY KEY("teaching_group_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "learning_material" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"teaching_group_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"file_id" uuid,
	"link" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"fee_item_id" uuid,
	"channel" text,
	"reference" text,
	"occurred_on" date NOT NULL,
	"recorded_by" uuid NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"borrower_person_id" uuid,
	"borrower_student_id" uuid,
	"borrowed_on" date NOT NULL,
	"due_on" date NOT NULL,
	"returned_on" date,
	"outcome" text,
	"note" text,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "mark" (
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"score" numeric(7, 2),
	"status" "mark_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"entered_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mark_assessment_id_student_id_pk" PRIMARY KEY("assessment_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" "message_category" NOT NULL,
	"subject" text NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_person_id" uuid NOT NULL,
	"staff_person_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"source" text NOT NULL,
	"sender_person_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proof" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"channel" text NOT NULL,
	"reference" text NOT NULL,
	"paid_on" date NOT NULL,
	"comment" text,
	"submitted_by" uuid NOT NULL,
	"status" "proof_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"weekday" integer NOT NULL,
	"number" integer NOT NULL,
	"label" text NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	"kind" "period_kind" DEFAULT 'lesson' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_year_id" uuid NOT NULL,
	"to_year_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"from_class_id" uuid NOT NULL,
	"to_class_id" uuid,
	"decision" "progression_decision" DEFAULT 'proposed' NOT NULL,
	"note" text,
	"decided_by" uuid,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"class_teacher_comment" text,
	"head_comment" text,
	"snapshot" jsonb,
	"approved_by" uuid,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"capacity" integer,
	"kind" text DEFAULT 'classroom' NOT NULL,
	CONSTRAINT "room_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stream" text,
	"room_id" uuid,
	"class_teacher_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "school_profile" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"display_name" text NOT NULL,
	"motto" text,
	"address" text,
	"phone" text,
	"email" text,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"student_loan_limit" integer DEFAULT 1 NOT NULL,
	"staff_loan_limit" integer DEFAULT 5 NOT NULL,
	"loan_days" integer DEFAULT 14 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"employee_number" text,
	"job_title" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "staff_employee_number_unique" UNIQUE("employee_number")
);
--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"time_in" time,
	"time_out" time,
	"note" text,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"exam_board" "exam_board" DEFAULT 'zimsec' NOT NULL,
	"is_practical" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"text" text,
	"file_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"form_id" uuid,
	"class_id" uuid,
	"name" text NOT NULL,
	"teacher_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "year_status" DEFAULT 'planned' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" text DEFAULT 'lesson' NOT NULL,
	"teaching_group_id" uuid,
	"room_id" uuid,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "timetable_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"period_id" uuid NOT NULL,
	"entry_id" uuid,
	"change" text NOT NULL,
	"kind" text,
	"teaching_group_id" uuid,
	"room_id" uuid,
	"substitute_teacher_person_id" uuid,
	"label" text,
	"reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "absence_explanation" ADD CONSTRAINT "absence_explanation_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_patron_person_id_person_id_fk" FOREIGN KEY ("patron_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_member" ADD CONSTRAINT "activity_member_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_member" ADD CONSTRAINT "activity_member_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_document" ADD CONSTRAINT "application_document_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_document" ADD CONSTRAINT "application_document_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_teaching_group_id_teaching_group_id_fk" FOREIGN KEY ("teaching_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_mark" ADD CONSTRAINT "attendance_mark_session_id_attendance_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_mark" ADD CONSTRAINT "attendance_mark_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_session" ADD CONSTRAINT "attendance_session_teaching_group_id_teaching_group_id_fk" FOREIGN KEY ("teaching_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline_incident" ADD CONSTRAINT "discipline_incident_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_assignment" ADD CONSTRAINT "duty_assignment_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_assignment" ADD CONSTRAINT "duty_assignment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrolment" ADD CONSTRAINT "enrolment_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_item" ADD CONSTRAINT "fee_item_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_teaching_group_id_teaching_group_id_fk" FOREIGN KEY ("teaching_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_material" ADD CONSTRAINT "learning_material_teaching_group_id_teaching_group_id_fk" FOREIGN KEY ("teaching_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_material" ADD CONSTRAINT "learning_material_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_fee_item_id_fee_item_id_fk" FOREIGN KEY ("fee_item_id") REFERENCES "public"."fee_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_borrower_person_id_person_id_fk" FOREIGN KEY ("borrower_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_borrower_student_id_student_id_fk" FOREIGN KEY ("borrower_student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_assessment_id_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_thread_id_message_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_person_id_person_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread" ADD CONSTRAINT "message_thread_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread" ADD CONSTRAINT "message_thread_guardian_person_id_person_id_fk" FOREIGN KEY ("guardian_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread" ADD CONSTRAINT "message_thread_staff_person_id_person_id_fk" FOREIGN KEY ("staff_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proof" ADD CONSTRAINT "payment_proof_ledger_entry_id_ledger_entry_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression" ADD CONSTRAINT "progression_from_year_id_academic_year_id_fk" FOREIGN KEY ("from_year_id") REFERENCES "public"."academic_year"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression" ADD CONSTRAINT "progression_to_year_id_academic_year_id_fk" FOREIGN KEY ("to_year_id") REFERENCES "public"."academic_year"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression" ADD CONSTRAINT "progression_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression" ADD CONSTRAINT "progression_from_class_id_class_id_fk" FOREIGN KEY ("from_class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression" ADD CONSTRAINT "progression_to_class_id_class_id_fk" FOREIGN KEY ("to_class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_term_id_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."term"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_card" ADD CONSTRAINT "report_card_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_class_teacher_person_id_person_id_fk" FOREIGN KEY ("class_teacher_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_assessment_id_assessment_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_subject_id_subject_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subject"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_group" ADD CONSTRAINT "teaching_group_teacher_person_id_person_id_fk" FOREIGN KEY ("teacher_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_teaching_group_id_teaching_group_id_fk" FOREIGN KEY ("teaching_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_override" ADD CONSTRAINT "timetable_override_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_override" ADD CONSTRAINT "timetable_override_entry_id_timetable_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timetable_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_override" ADD CONSTRAINT "timetable_override_teaching_group_id_teaching_group_id_fk" FOREIGN KEY ("teaching_group_id") REFERENCES "public"."teaching_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_override" ADD CONSTRAINT "timetable_override_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_override" ADD CONSTRAINT "timetable_override_substitute_teacher_person_id_person_id_fk" FOREIGN KEY ("substitute_teacher_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_status_idx" ON "application" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "assessment_group_term_idx" ON "assessment" USING btree ("teaching_group_id","term_id");--> statement-breakpoint
CREATE INDEX "att_mark_student_idx" ON "attendance_mark" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "att_daily_uq" ON "attendance_session" USING btree ("kind","date","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "att_lesson_uq" ON "attendance_session" USING btree ("kind","date","teaching_group_id","period");--> statement-breakpoint
CREATE INDEX "incident_student_idx" ON "discipline_incident" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "duty_class_idx" ON "duty_assignment" USING btree ("class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrolment_student_year_uq" ON "enrolment" USING btree ("student_id","academic_year_id");--> statement-breakpoint
CREATE INDEX "enrolment_class_idx" ON "enrolment" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "event_starts_idx" ON "event" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "group_member_student_idx" ON "group_member" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "ledger_student_idx" ON "ledger_entry" USING btree ("student_id","occurred_on");--> statement-breakpoint
CREATE INDEX "loan_student_idx" ON "loan" USING btree ("borrower_student_id");--> statement-breakpoint
CREATE INDEX "loan_open_idx" ON "loan" USING btree ("returned_on");--> statement-breakpoint
CREATE INDEX "mark_student_idx" ON "mark" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "thread_guardian_idx" ON "message_thread" USING btree ("guardian_person_id");--> statement-breakpoint
CREATE INDEX "thread_staff_idx" ON "message_thread" USING btree ("staff_person_id");--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "notification" USING btree ("recipient_person_id","created_at");--> statement-breakpoint
CREATE INDEX "proof_status_idx" ON "payment_proof" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "period_day_number_uq" ON "period" USING btree ("weekday","number");--> statement-breakpoint
CREATE UNIQUE INDEX "progression_uq" ON "progression" USING btree ("from_year_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_student_term_uq" ON "report_card" USING btree ("student_id","term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_year_name_uq" ON "class" USING btree ("academic_year_id","name");--> statement-breakpoint
CREATE INDEX "class_teacher_idx" ON "class" USING btree ("class_teacher_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_att_uq" ON "staff_attendance" USING btree ("person_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_code_board_uq" ON "subject" USING btree ("code","exam_board");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_uq" ON "submission" USING btree ("assessment_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_year_name_uq" ON "teaching_group" USING btree ("academic_year_id","name");--> statement-breakpoint
CREATE INDEX "group_teacher_idx" ON "teaching_group" USING btree ("teacher_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "term_year_number_uq" ON "term" USING btree ("academic_year_id","number");--> statement-breakpoint
CREATE INDEX "tt_period_idx" ON "timetable_entry" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "tt_override_date_idx" ON "timetable_override" USING btree ("date");