import type { Metadata } from "next";
import { listBooks, openLoans } from "@/modules/library/service";
import { listStaff } from "@/modules/people/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Details, Flash, Grid, Input, Section, Select, SubmitButton, Table, today } from "@/ui/kit";
import { addBook, importBooks, lend, returnLoan } from "../_actions/admin";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage(props: PageProps<"/s/[schoolSlug]/library">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "library.manage"));
  const q = str(sp.q) || undefined;
  const [books, loans, staff] = await Promise.all([listBooks(ctx, q, str(sp.status) || undefined), openLoans(ctx), listStaff(ctx)]);
  const now = today();
  const here = `${base}/library`;
  return (
    <>
      <PageHeader title="Library" description={`${loans.length} books out · ${loans.filter((l) => l.l.dueOn < now).length} overdue`} actions={<a className="text-sm text-brand-700 underline" href={`${base}/library/export`}>Export CSV</a>} />
      <Flash sp={sp} />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-semibold">Lend a book</h2>
          <ActionForm action={lend.bind(null, slug)} back={here}>
            <Input label="Accession number" name="accessionNumber" required />
            <Input label="Student admission number" name="admissionNumber" />
            <Select label="…or staff member" name="staffPersonId" placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} />
            <div><SubmitButton>Lend</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-2 font-semibold">Add a book</h2>
          <ActionForm action={addBook.bind(null, slug)} back={here}>
            <Grid><Input label="Accession number" name="accessionNumber" required /><Input label="Title" name="title" required /><Input label="Author" name="author" /><Input label="ISBN" name="isbn" /><Input label="Category" name="category" /></Grid>
            <div><SubmitButton variant="secondary">Add book</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
      <Section title="Books out">
        <Table caption="Open loans" rows={loans} rowKey={(l) => l.l.id} empty="No books out." columns={[
          { header: "Book", cell: (l) => `${l.title} (${l.acc})` },
          { header: "Borrower", cell: (l) => (l.sFirst ? `${l.sLast}, ${l.sFirst} (${l.adm})` : `${l.pLast}, ${l.pFirst} (staff)`) },
          { header: "Due", cell: (l) => <>{l.l.dueOn} {l.l.dueOn < now ? <Badge tone="red">overdue</Badge> : null}</> },
          { header: "Return", cell: (l) => (
            <ActionForm action={returnLoan.bind(null, slug)} back={here} className="flex flex-wrap gap-1">
              <input type="hidden" name="loanId" value={l.l.id} />
              <button name="outcome" value="returned" className="rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white">Returned</button>
              <button name="outcome" value="damaged" className="rounded border border-slate-300 px-2 py-1 text-xs">Damaged</button>
              <button name="outcome" value="lost" className="rounded border border-red-300 px-2 py-1 text-xs text-red-800">Lost</button>
            </ActionForm>
          ) },
        ]} />
      </Section>
      <Section title="Catalogue">
        <form className="mb-3 flex flex-wrap items-end gap-2" action={here}>
          <Input label="Search" name="q" defaultValue={q} />
          <Select label="Status" name="status" defaultValue={str(sp.status)} placeholder="Any" options={["available", "on_loan", "lost", "damaged", "withdrawn"].map((s) => ({ value: s, label: s.replace("_", " ") }))} />
          <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Search</button>
        </form>
        <Table caption="Books" rows={books} rowKey={(b) => b.id} empty="No books." columns={[
          { header: "Accession", cell: (b) => b.accessionNumber }, { header: "Title", cell: (b) => b.title },
          { header: "Author", cell: (b) => b.author ?? "", hideOnMobile: true }, { header: "Category", cell: (b) => b.category ?? "", hideOnMobile: true },
          { header: "Status", cell: (b) => <Badge>{b.status}</Badge> },
        ]} />
        <Details summary="Import books (CSV)">
          <ActionForm action={importBooks.bind(null, slug)} back={here} upload>
            <p className="text-sm text-slate-600">Columns: <code>accession_number,title,author,isbn,category</code>. Existing accession numbers are skipped.</p>
            <input type="file" name="file" accept=".csv,text/csv" required aria-label="CSV file" className="text-sm" />
            <div><SubmitButton variant="secondary">Import</SubmitButton></div>
          </ActionForm>
        </Details>
      </Section>
    </>
  );
}
