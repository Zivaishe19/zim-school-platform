import type { Metadata } from "next";
import { STUDENT_CSV_TEMPLATE } from "@/modules/imports/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Flash, SubmitButton } from "@/ui/kit";
import { importStudents } from "../../_actions/people";
import { guard, load } from "../../_lib";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportPage(props: PageProps<"/s/[schoolSlug]/students/import">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "students.import"));
  return (
    <>
      <PageHeader title="Import students from CSV" description="From Excel: File > Save As > CSV (comma delimited). Up to 3,000 rows per file." />
      <Flash sp={sp} />
      <Card className="mb-4 max-w-2xl">
        <h2 className="mb-2 font-semibold">Template</h2>
        <p className="mb-2 text-sm text-slate-600">Columns (first row must be these headers). Dates as YYYY-MM-DD; gender female, male or blank.</p>
        <pre className="overflow-x-auto rounded bg-slate-50 p-3 text-xs">{STUDENT_CSV_TEMPLATE}</pre>
        <a className="text-sm text-brand-700 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(STUDENT_CSV_TEMPLATE)}`} download="students-template.csv">Download template</a>
      </Card>
      <Card className="max-w-2xl">
        <ActionForm action={importStudents.bind(null, slug)} back={`${base}/students/import`} upload>
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" aria-label="CSV file" />
          <p className="text-sm text-slate-600">Every row is checked first. If any row has a problem or a duplicate admission number, <strong>nothing</strong> is imported and you get a list of the lines to fix.</p>
          <div className="flex gap-2">
            <button name="mode" value="check" className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Check only</button>
            <SubmitButton>Import</SubmitButton>
            <input type="hidden" name="mode" value="import" />
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
