import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudents } from "@/modules/students/service";
import { can, ForbiddenError } from "@/server/tenancy/context";
import { ButtonLink, PageHeader } from "@/ui/primitives";
import { Badge, Flash, Table } from "@/ui/kit";
import { load, str } from "../_lib";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage(props: PageProps<"/s/[schoolSlug]/students">) {
  const { ctx, sp, base } = await load(props);
  const q = str(sp.q) || undefined;
  let result;
  try {
    result = await listStudents(ctx, { q, page: str(sp.page, "1") });
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const link = (p: number) => `${base}/students?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader
        title="Students"
        description={`${result.total} ${result.total === 1 ? "student" : "students"}`}
        actions={can(ctx, "students.create") ? (
          <>
            <ButtonLink href={`${base}/students/import`} variant="secondary">Import CSV</ButtonLink>
            <ButtonLink href={`${base}/students/new`}>Add student</ButtonLink>
          </>
        ) : null}
      />
      <Flash sp={sp} />
      <form role="search" className="mb-4 flex gap-2" action={`${base}/students`}>
        <label htmlFor="q" className="sr-only">Search students</label>
        <input id="q" name="q" defaultValue={q} placeholder="Search by name or admission number" className="min-h-11 flex-1 rounded-md border border-slate-300 bg-white px-3" />
        <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Search</button>
      </form>
      <Table
        caption="Students"
        rows={result.rows}
        rowKey={(r) => r.id}
        empty="No students found."
        columns={[
          { header: "Name", cell: (s) => <Link href={`${base}/students/${s.id}`} className="font-medium text-brand-700 underline">{s.lastName}, {s.firstName}</Link> },
          { header: "Admission no.", cell: (s) => <span className="font-mono text-xs">{s.admissionNumber}</span> },
          { header: "Status", cell: (s) => <Badge>{s.status}</Badge>, hideOnMobile: true },
        ]}
      />
      {pages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          {result.page > 1 ? <Link href={link(result.page - 1)} className="text-brand-700 underline">Previous</Link> : <span />}
          <span className="text-slate-600">Page {result.page} of {pages}</span>
          {result.page < pages ? <Link href={link(result.page + 1)} className="text-brand-700 underline">Next</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}
