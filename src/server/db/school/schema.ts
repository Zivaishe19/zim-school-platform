/**
 * Schema shared by EVERY school database (school_0001, school_0002, ...).
 * One migration history in /drizzle/school is applied to all of them.
 *
 * Milestone 1 contains identity, roles, a minimal student/guardian model
 * (enough to prove isolation and parent-ownership rules) and the audit log.
 * Academic structure, admissions, attendance etc. arrive in later milestones.
 */
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Exactly one row: which school this database belongs to. Checked on every new connection. */
export const schoolIdentity = pgTable("school_identity", {
  schoolId: uuid("school_id").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A human known to this school. Linked to a platform login when they have one. */
export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformUserId: uuid("platform_user_id"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("person_platform_user_uq").on(t.platformUserId)],
);

/** Role keys are defined in code (src/server/rbac/roles.ts); stored here per person. */
export const personRole = pgTable(
  "person_role",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    grantedBy: uuid("granted_by"),
  },
  (t) => [primaryKey({ columns: [t.personId, t.roleKey] })],
);

export const studentStatus = pgEnum("student_status", [
  "applicant",
  "registered",
  "enrolled",
  "transferred_out",
  "graduated",
  "withdrawn",
]);

export const student = pgTable(
  "student",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set when the student has their own login. */
    personId: uuid("person_id").references(() => person.id, { onDelete: "set null" }),
    admissionNumber: text("admission_number").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    gender: text("gender"),
    status: studentStatus("status").notNull().default("registered"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("student_admission_number_uq").on(t.admissionNumber),
    index("student_name_idx").on(t.lastName, t.firstName),
  ],
);

/** Parent/guardian link. A parent may see ONLY students linked here. */
export const studentGuardian = pgTable(
  "student_guardian",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    guardianPersonId: uuid("guardian_person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.guardianPersonId] }),
    index("student_guardian_guardian_idx").on(t.guardianPersonId),
  ],
);

/** Append-only. The school app role has INSERT/SELECT only (see tenancy/grants.ts). */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    context: jsonb("context").$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_event_at_idx").on(t.at), index("audit_event_target_idx").on(t.targetType, t.targetId)],
);

// ===========================================================================
// Milestone 2+: everything below. Conventions: UUID keys, history kept as rows,
// money in integer cents + currency, missing marks are NULL with a status.
// ===========================================================================

const fk = (name: string) => uuid(name);

/** Single-row school profile and settings (row id is always 1). */
export const schoolProfile = pgTable("school_profile", {
  id: integer("id").primaryKey().default(1),
  displayName: text("display_name").notNull(),
  motto: text("motto"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  studentLoanLimit: integer("student_loan_limit").notNull().default(1),
  staffLoanLimit: integer("staff_loan_limit").notNull().default(5),
  loanDays: integer("loan_days").notNull().default(14),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const yearStatus = pgEnum("year_status", ["planned", "open", "closed"]);

export const academicYear = pgTable("academic_year", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }).notNull(),
  status: yearStatus("status").notNull().default("planned"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const term = pgTable(
  "term",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    academicYearId: fk("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    status: yearStatus("status").notNull().default("planned"),
  },
  (t) => [uniqueIndex("term_year_number_uq").on(t.academicYearId, t.number)],
);

/** Forms 1-6 (level). Schools may offer fewer. */
export const form = pgTable("form", {
  id: uuid("id").primaryKey().defaultRandom(),
  level: integer("level").notNull().unique(),
  name: text("name").notNull(),
});

export const room = pgTable("room", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  capacity: integer("capacity"),
  kind: text("kind").notNull().default("classroom"),
});

/** Administrative class (home class) for one academic year. Arbitrary names. */
export const schoolClass = pgTable(
  "class",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    academicYearId: fk("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    formId: fk("form_id").notNull().references(() => form.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    stream: text("stream"),
    roomId: fk("room_id").references(() => room.id, { onDelete: "set null" }),
    classTeacherPersonId: fk("class_teacher_person_id").references(() => person.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("class_year_name_uq").on(t.academicYearId, t.name), index("class_teacher_idx").on(t.classTeacherPersonId)],
);

export const examBoard = pgEnum("exam_board", ["zimsec", "cambridge", "internal"]);

export const subject = pgTable(
  "subject",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    examBoard: examBoard("exam_board").notNull().default("zimsec"),
    isPractical: boolean("is_practical").notNull().default(false),
  },
  (t) => [uniqueIndex("subject_code_board_uq").on(t.code, t.examBoard)],
);

/** Who is taught together for one subject in one year (whole class, set, or practical group). */
export const teachingGroup = pgTable(
  "teaching_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    academicYearId: fk("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    subjectId: fk("subject_id").notNull().references(() => subject.id, { onDelete: "restrict" }),
    formId: fk("form_id").references(() => form.id, { onDelete: "set null" }),
    classId: fk("class_id").references(() => schoolClass.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    teacherPersonId: fk("teacher_person_id").references(() => person.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("group_year_name_uq").on(t.academicYearId, t.name), index("group_teacher_idx").on(t.teacherPersonId)],
);

export const groupMember = pgTable(
  "group_member",
  {
    teachingGroupId: fk("teaching_group_id").notNull().references(() => teachingGroup.id, { onDelete: "cascade" }),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teachingGroupId, t.studentId] }), index("group_member_student_idx").on(t.studentId)],
);

export const enrolmentStatus = pgEnum("enrolment_status", ["active", "completed", "withdrawn", "transferred_out"]);

/** One row per student per year: history of placements is never overwritten. */
export const enrolment = pgTable(
  "enrolment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "restrict" }),
    academicYearId: fk("academic_year_id").notNull().references(() => academicYear.id, { onDelete: "restrict" }),
    classId: fk("class_id").notNull().references(() => schoolClass.id, { onDelete: "restrict" }),
    status: enrolmentStatus("status").notNull().default("active"),
    isRepeat: boolean("is_repeat").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("enrolment_student_year_uq").on(t.studentId, t.academicYearId), index("enrolment_class_idx").on(t.classId)],
);

export const staff = pgTable("staff", {
  personId: fk("person_id").primaryKey().references(() => person.id, { onDelete: "cascade" }),
  employeeNumber: text("employee_number").unique(),
  jobTitle: text("job_title"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
});

// ---------------------------------------------------------------- files
export const fileObject = pgTable("file_object", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  purpose: text("purpose").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- admissions
export const applicationStatus = pgEnum("application_status", ["draft", "submitted", "under_review", "info_required", "accepted", "rejected"]);
export const entryType = pgEnum("entry_type", ["form1", "form4", "lower6", "transfer"]);

export const application = pgTable(
  "application",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").notNull().unique(),
    entryType: entryType("entry_type").notNull(),
    applyingForLevel: integer("applying_for_level").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    gender: text("gender"),
    previousSchool: text("previous_school"),
    guardianName: text("guardian_name").notNull(),
    guardianPhone: text("guardian_phone").notNull(),
    guardianEmail: text("guardian_email"),
    source: text("source").notNull(), // online | walk_in
    status: applicationStatus("status").notNull().default("submitted"),
    staffNotes: text("staff_notes"),
    decisionNote: text("decision_note"),
    decidedBy: uuid("decided_by"),
    decidedAt: ts("decided_at"),
    studentId: fk("student_id").references(() => student.id, { onDelete: "set null" }),
    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("application_status_idx").on(t.status, t.createdAt)],
);

export const applicationDocument = pgTable("application_document", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: fk("application_id").notNull().references(() => application.id, { onDelete: "cascade" }),
  fileId: fk("file_id").notNull().references(() => fileObject.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  receivedPhysically: boolean("received_physically").notNull().default(false),
});

// ---------------------------------------------------------------- attendance
export const attendanceStatus = pgEnum("attendance_status", ["present", "absent", "late", "early_departure", "approved_absence"]);

export const attendanceSession = pgTable(
  "attendance_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // daily | lesson
    date: date("date", { mode: "string" }).notNull(),
    classId: fk("class_id").references(() => schoolClass.id, { onDelete: "restrict" }),
    teachingGroupId: fk("teaching_group_id").references(() => teachingGroup.id, { onDelete: "restrict" }),
    period: text("period"),
    takenBy: uuid("taken_by"),
    takenAt: ts("taken_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("att_daily_uq").on(t.kind, t.date, t.classId),
    uniqueIndex("att_lesson_uq").on(t.kind, t.date, t.teachingGroupId, t.period),
  ],
);

export const attendanceMark = pgTable(
  "attendance_mark",
  {
    sessionId: fk("session_id").notNull().references(() => attendanceSession.id, { onDelete: "cascade" }),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
    status: attendanceStatus("status").notNull(),
    note: text("note"),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.studentId] }), index("att_mark_student_idx").on(t.studentId)],
);

export const reviewStatus = pgEnum("review_status", ["pending", "approved", "rejected"]);

export const absenceExplanation = pgTable("absence_explanation", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateTo: date("date_to", { mode: "string" }).notNull(),
  reason: text("reason").notNull(),
  submittedBy: uuid("submitted_by").notNull(),
  status: reviewStatus("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- assessment
export const gradingScale = pgTable("grading_scale", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  examBoard: examBoard("exam_board").notNull(),
  /** Sorted bands: [{ grade: "A", min: 75 }, ...] (percent). */
  bands: jsonb("bands").$type<{ grade: string; min: number }[]>().notNull(),
});

export const assessmentKind = pgEnum("assessment_kind", ["classwork", "assignment", "test", "exam", "coursework", "cala", "practical"]);
export const assessmentStatus = pgEnum("assessment_status", ["draft", "open", "closed"]);

export const assessment = pgTable(
  "assessment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teachingGroupId: fk("teaching_group_id").notNull().references(() => teachingGroup.id, { onDelete: "restrict" }),
    termId: fk("term_id").notNull().references(() => term.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    kind: assessmentKind("kind").notNull(),
    maxScore: numeric("max_score", { precision: 7, scale: 2, mode: "number" }).notNull(),
    /** Percent of the term grade. NULL = feedback only. */
    weight: numeric("weight", { precision: 5, scale: 2, mode: "number" }),
    dueOn: date("due_on", { mode: "string" }),
    instructions: text("instructions"),
    acceptsSubmissions: boolean("accepts_submissions").notNull().default(false),
    status: assessmentStatus("status").notNull().default("open"),
    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("assessment_group_term_idx").on(t.teachingGroupId, t.termId)],
);

export const markStatus = pgEnum("mark_status", ["missing", "pending", "submitted", "marked", "approved", "published"]);

export const mark = pgTable(
  "mark",
  {
    assessmentId: fk("assessment_id").notNull().references(() => assessment.id, { onDelete: "cascade" }),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
    score: numeric("score", { precision: 7, scale: 2, mode: "number" }),
    status: markStatus("status").notNull().default("pending"),
    comment: text("comment"),
    enteredBy: uuid("entered_by"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.assessmentId, t.studentId] }), index("mark_student_idx").on(t.studentId)],
);

export const submission = pgTable(
  "submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: fk("assessment_id").notNull().references(() => assessment.id, { onDelete: "cascade" }),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
    text: text("text"),
    fileId: fk("file_id").references(() => fileObject.id, { onDelete: "set null" }),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("submission_uq").on(t.assessmentId, t.studentId)],
);

export const learningMaterial = pgTable("learning_material", {
  id: uuid("id").primaryKey().defaultRandom(),
  teachingGroupId: fk("teaching_group_id").notNull().references(() => teachingGroup.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  fileId: fk("file_id").references(() => fileObject.id, { onDelete: "set null" }),
  link: text("link"),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reportStatus = pgEnum("report_status", ["draft", "submitted", "approved", "published"]);

export const reportCard = pgTable(
  "report_card",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "restrict" }),
    termId: fk("term_id").notNull().references(() => term.id, { onDelete: "restrict" }),
    classId: fk("class_id").notNull().references(() => schoolClass.id, { onDelete: "restrict" }),
    status: reportStatus("status").notNull().default("draft"),
    classTeacherComment: text("class_teacher_comment"),
    headComment: text("head_comment"),
    /** Frozen snapshot of subjects, grades and attendance when approved. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    approvedBy: uuid("approved_by"),
    publishedAt: ts("published_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("report_student_term_uq").on(t.studentId, t.termId)],
);

export const progressionDecision = pgEnum("progression_decision", ["proposed", "promote", "repeat", "leave", "graduate"]);

export const progression = pgTable(
  "progression",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromYearId: fk("from_year_id").notNull().references(() => academicYear.id),
    toYearId: fk("to_year_id").notNull().references(() => academicYear.id),
    studentId: fk("student_id").notNull().references(() => student.id),
    fromClassId: fk("from_class_id").notNull().references(() => schoolClass.id),
    toClassId: fk("to_class_id").references(() => schoolClass.id),
    decision: progressionDecision("decision").notNull().default("proposed"),
    note: text("note"),
    decidedBy: uuid("decided_by"),
    appliedAt: ts("applied_at"),
  },
  (t) => [uniqueIndex("progression_uq").on(t.fromYearId, t.studentId)],
);

// ---------------------------------------------------------------- communication
export type Audience = { kind: "everyone" | "staff" | "parents" | "students" | "form" | "class" | "group" | "people"; ids?: string[] };

export const announcement = pgTable("announcement", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: jsonb("audience").$type<Audience>().notNull(),
  authorPersonId: fk("author_person_id").references(() => person.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientPersonId: fk("recipient_person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    source: text("source").notNull(),
    senderPersonId: uuid("sender_person_id"),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("notification_recipient_idx").on(t.recipientPersonId, t.createdAt)],
);

export const messageCategory = pgEnum("message_category", [
  "absence_explanation",
  "academic_concern",
  "meeting_request",
  "discipline",
  "document_request",
  "fees",
  "general",
]);

/** Structured parent-school conversation about ONE student (not open chat). */
export const messageThread = pgTable(
  "message_thread",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: messageCategory("category").notNull(),
    subject: text("subject").notNull(),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
    guardianPersonId: fk("guardian_person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    staffPersonId: fk("staff_person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("thread_guardian_idx").on(t.guardianPersonId), index("thread_staff_idx").on(t.staffPersonId)],
);

export const message = pgTable("message", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: fk("thread_id").notNull().references(() => messageThread.id, { onDelete: "cascade" }),
  authorPersonId: fk("author_person_id").notNull().references(() => person.id),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const event = pgTable(
  "event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    kind: text("kind").notNull(), // sports_day, club, competition, trip, meeting, assembly, exam, other
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at"),
    location: text("location"),
    description: text("description"),
    audience: jsonb("audience").$type<Audience>().notNull(),
    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("event_starts_idx").on(t.startsAt)],
);

export const activity = pgTable("activity", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  kind: text("kind").notNull(), // club | sport
  patronPersonId: fk("patron_person_id").references(() => person.id, { onDelete: "set null" }),
  schedule: text("schedule"),
});

export const activityMember = pgTable(
  "activity_member",
  {
    activityId: fk("activity_id").notNull().references(() => activity.id, { onDelete: "cascade" }),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
    role: text("role"),
    joinedOn: date("joined_on", { mode: "string" }).notNull(),
    leftOn: date("left_on", { mode: "string" }),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.studentId, t.joinedOn] })],
);

// ---------------------------------------------------------------- fees
export const feeItem = pgTable("fee_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  termId: fk("term_id").references(() => term.id, { onDelete: "set null" }),
  formLevel: integer("form_level"),
  active: boolean("active").notNull().default(true),
});

export const ledgerEntryKind = pgEnum("ledger_kind", ["charge", "payment"]);

/** Append-mostly ledger: corrections are reversals, never edits or deletes. */
export const ledgerEntry = pgTable(
  "ledger_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "restrict" }),
    kind: ledgerEntryKind("kind").notNull(),
    description: text("description").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    feeItemId: fk("fee_item_id").references(() => feeItem.id, { onDelete: "set null" }),
    channel: text("channel"), // bank | ecocash | cash | other
    reference: text("reference"),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    reversedAt: ts("reversed_at"),
    reversedBy: uuid("reversed_by"),
    reversalReason: text("reversal_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_student_idx").on(t.studentId, t.occurredOn)],
);

export const proofStatus = pgEnum("proof_status", ["pending", "verified", "rejected", "info_requested"]);

export const paymentProof = pgTable(
  "payment_proof",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "restrict" }),
    fileId: fk("file_id").notNull().references(() => fileObject.id, { onDelete: "restrict" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    channel: text("channel").notNull(),
    reference: text("reference").notNull(),
    paidOn: date("paid_on", { mode: "string" }).notNull(),
    comment: text("comment"),
    submittedBy: uuid("submitted_by").notNull(),
    status: proofStatus("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by"),
    reviewNote: text("review_note"),
    ledgerEntryId: fk("ledger_entry_id").references(() => ledgerEntry.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("proof_status_idx").on(t.status, t.createdAt)],
);

// ---------------------------------------------------------------- library
export const bookStatus = pgEnum("book_status", ["available", "on_loan", "lost", "damaged", "withdrawn"]);

export const book = pgTable("book", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessionNumber: text("accession_number").notNull().unique(),
  title: text("title").notNull(),
  author: text("author"),
  isbn: text("isbn"),
  category: text("category"),
  status: bookStatus("status").notNull().default("available"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const loan = pgTable(
  "loan",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: fk("book_id").notNull().references(() => book.id, { onDelete: "restrict" }),
    borrowerPersonId: fk("borrower_person_id").references(() => person.id),
    borrowerStudentId: fk("borrower_student_id").references(() => student.id),
    borrowedOn: date("borrowed_on", { mode: "string" }).notNull(),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    returnedOn: date("returned_on", { mode: "string" }),
    outcome: text("outcome"), // returned | lost | damaged
    note: text("note"),
    recordedBy: uuid("recorded_by"),
  },
  (t) => [index("loan_student_idx").on(t.borrowerStudentId), index("loan_open_idx").on(t.returnedOn)],
);

// ---------------------------------------------------------------- discipline and duties
export const incidentStatus = pgEnum("incident_status", ["reported", "approved", "dismissed"]);

export const disciplineIncident = pgTable(
  "discipline_incident",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    occurredOn: date("occurred_on", { mode: "string" }).notNull(),
    reportedBy: uuid("reported_by").notNull(),
    recommendedAction: text("recommended_action"),
    approvedAction: text("approved_action"),
    status: incidentStatus("status").notNull().default("reported"),
    visibleToParent: boolean("visible_to_parent").notNull().default(false),
    decidedBy: uuid("decided_by"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("incident_student_idx").on(t.studentId)],
);

export const dutyAssignment = pgTable(
  "duty_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    classId: fk("class_id").notNull().references(() => schoolClass.id, { onDelete: "cascade" }),
    studentId: fk("student_id").notNull().references(() => student.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // class monitor, cleaning, prefect, ...
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    note: text("note"),
    assignedBy: uuid("assigned_by"),
  },
  (t) => [index("duty_class_idx").on(t.classId)],
);

// ---------------------------------------------------------------- staff
export const staffAttendance = pgTable(
  "staff_attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: fk("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").notNull(), // present | late | absent | leave | early_departure
    timeIn: time("time_in"),
    timeOut: time("time_out"),
    note: text("note"),
    recordedBy: uuid("recorded_by"),
  },
  (t) => [uniqueIndex("staff_att_uq").on(t.personId, t.date)],
);

export const leaveRequest = pgTable("leave_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: fk("person_id").notNull().references(() => person.id, { onDelete: "cascade" }),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateTo: date("date_to", { mode: "string" }).notNull(),
  kind: text("kind").notNull(),
  reason: text("reason"),
  status: reviewStatus("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------- timetable
export const periodKind = pgEnum("period_kind", ["lesson", "break", "lunch", "assembly", "other"]);

/** Bell schedule: one row per weekday x period. */
export const period = pgTable(
  "period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    weekday: integer("weekday").notNull(), // 1 = Monday
    number: integer("number").notNull(),
    label: text("label").notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    kind: periodKind("kind").notNull().default("lesson"),
  },
  (t) => [uniqueIndex("period_day_number_uq").on(t.weekday, t.number)],
);

/** The baseline timetable. Temporary changes go in timetable_override, never here. */
export const timetableEntry = pgTable(
  "timetable_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    academicYearId: fk("academic_year_id").notNull().references(() => academicYear.id),
    periodId: fk("period_id").notNull().references(() => period.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("lesson"), // lesson | sport | exam | meeting | activity
    teachingGroupId: fk("teaching_group_id").references(() => teachingGroup.id, { onDelete: "cascade" }),
    roomId: fk("room_id").references(() => room.id, { onDelete: "set null" }),
    label: text("label"),
  },
  (t) => [index("tt_period_idx").on(t.periodId)],
);

export const timetableOverride = pgTable(
  "timetable_override",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    periodId: fk("period_id").notNull().references(() => period.id, { onDelete: "cascade" }),
    entryId: fk("entry_id").references(() => timetableEntry.id, { onDelete: "cascade" }),
    change: text("change").notNull(), // cancelled | changed | added
    kind: text("kind"),
    teachingGroupId: fk("teaching_group_id").references(() => teachingGroup.id),
    roomId: fk("room_id").references(() => room.id),
    substituteTeacherPersonId: fk("substitute_teacher_person_id").references(() => person.id),
    label: text("label"),
    reason: text("reason"),
    createdBy: uuid("created_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("tt_override_date_idx").on(t.date)],
);
