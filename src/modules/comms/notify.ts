import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { notification, person, personRole, studentGuardian, student } from "@/server/db/school/schema";
import type { SchoolDb } from "@/server/tenancy/client-cache";

type Tx = Parameters<Parameters<SchoolDb["transaction"]>[0]>[0];

/**
 * The ONE way to create in-app notifications. In-app only (no SMS/email provider yet).
 * Quiet by design: nothing here pushes to phones.
 */
export async function notify(
  db: SchoolDb | Tx,
  recipients: string[],
  n: { title: string; body?: string; link?: string; source: string; senderPersonId?: string | null },
) {
  const unique = [...new Set(recipients.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    if (chunk.length)
      await db.insert(notification).values(
        chunk.map((recipientPersonId) => ({ recipientPersonId, title: n.title.slice(0, 200), body: n.body?.slice(0, 2000) ?? null, link: n.link ?? null, source: n.source, senderPersonId: n.senderPersonId ?? null })),
      );
  }
  return unique.length;
}

/** Guardians (person ids) of the given students. */
export async function guardianIds(db: SchoolDb | Tx, studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const rows = await db.select({ id: studentGuardian.guardianPersonId }).from(studentGuardian).where(inArray(studentGuardian.studentId, studentIds));
  return rows.map((r) => r.id);
}

/** Student logins (person ids) for the given students. */
export async function studentPersonIds(db: SchoolDb | Tx, studentIds: string[]): Promise<string[]> {
  if (!studentIds.length) return [];
  const rows = await db.select({ id: student.personId }).from(student).where(inArray(student.id, studentIds));
  return rows.map((r) => r.id).filter((x): x is string => Boolean(x));
}

export async function peopleWithRoles(db: SchoolDb | Tx, roles: string[]): Promise<string[]> {
  const rows = await db.select({ id: personRole.personId }).from(personRole).where(inArray(personRole.roleKey, roles));
  return rows.map((r) => r.id);
}

export async function personExists(db: SchoolDb, id: string) {
  const r = await db.select({ id: person.id }).from(person).where(and(eq(person.id, id)));
  return r.length === 1;
}
