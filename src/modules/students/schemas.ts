import { z } from "zod";

export const studentIdSchema = z.string().uuid();

export const listStudentsInput = z.object({
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

export const createStudentInput = z.object({
  admissionNumber: z
    .string()
    .trim()
    .min(1, "Admission number is required")
    .max(30)
    .regex(/^[A-Za-z0-9/-]+$/, "Letters, digits, / and - only"),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type CreateStudentInput = z.input<typeof createStudentInput>;

export const PAGE_SIZE = 25;
