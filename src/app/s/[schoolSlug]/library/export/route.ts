import { notFound } from "next/navigation";
import { exportBooksCsv } from "@/modules/library/service";
import { can } from "@/server/tenancy/context";
import { requireSchoolContext } from "@/server/tenancy/require-context";

export async function GET(_req: Request, { params }: RouteContext<"/s/[schoolSlug]/library/export">) {
  const { schoolSlug } = await params;
  const ctx = await requireSchoolContext(schoolSlug);
  if (!can(ctx, "library.manage")) notFound();
  const csv = await exportBooksCsv(ctx);
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="library-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
