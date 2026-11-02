import { z } from "zod";
import { authorizeFile } from "@/server/files/access";
import { readStored } from "@/server/files/storage";
import { recordSchoolAudit } from "@/server/audit/school-audit";
import { requireSchoolContext } from "@/server/tenancy/require-context";

/** Authorized, audited, private file download. Never cached by shared caches. */
export async function GET(_req: Request, { params }: RouteContext<"/s/[schoolSlug]/files/[fileId]">) {
  const { schoolSlug, fileId } = await params;
  const ctx = await requireSchoolContext(schoolSlug);
  if (!z.string().uuid().safeParse(fileId).success) return new Response("Not found", { status: 404 });
  const f = await authorizeFile(ctx, fileId);
  if (!f) return new Response("Not found", { status: 404 });
  const body = await readStored(ctx, f.storageKey);
  await recordSchoolAudit(ctx.db, ctx, "file.downloaded", { type: "file", id: f.id }, { purpose: f.purpose });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${f.originalName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
