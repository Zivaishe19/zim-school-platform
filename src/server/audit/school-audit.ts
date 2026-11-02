import "server-only";
import { auditEvent } from "@/server/db/school/schema";
import type { SchoolDb } from "@/server/tenancy/client-cache";
import type { SchoolContext } from "@/server/tenancy/context";

type Tx = Parameters<Parameters<SchoolDb["transaction"]>[0]>[0];

/**
 * Writes to the school's append-only audit log. Pass the transaction so the audit row
 * commits (or rolls back) together with the change it records.
 * Context must not contain secrets; keep personal data to identifiers.
 */
export async function recordSchoolAudit(
  dbOrTx: SchoolDb | Tx,
  ctx: Pick<SchoolContext, "user">,
  action: string,
  target: { type: string; id: string },
  context?: Record<string, unknown>,
): Promise<void> {
  await dbOrTx.insert(auditEvent).values({
    actorUserId: ctx.user.id,
    action,
    targetType: target.type,
    targetId: target.id,
    context: context ?? null,
  });
}
