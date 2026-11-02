import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { studentAttendance } from "@/modules/attendance/service";
import { studentResults } from "@/modules/assessments/service";
import { studentActivities } from "@/modules/comms/service";
import { INCIDENT_CATEGORIES, studentIncidents } from "@/modules/discipline/service";
import { studentLoans } from "@/modules/library/service";
import { guardiansOf, listPeople } from "@/modules/people/service";
import { publishedReportsFor } from "@/modules/reports/service";
import { currentClassOf, currentTerm, listTerms } from "@/modules/setup/service";
import { getStudent } from "@/modules/students/service";
import { can, ForbiddenError } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Details, Flash, fmtDate, Grid, Input, Section, Select, SubmitButton, Table, Tabs, TextArea, today } from "@/ui/kit";
import { reportIncident } from "../../_actions/admin";
import { createStudentLogin, linkGuardian, unlinkGuardian, updateStudentAction } from "../../_actions/people";
import { load, str } from "../../_lib";

export const metadata: Metadata = { title: "Student" };

export default async function StudentPage(props: PageProps<"/s/[schoolSlug]/students/[studentId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  let s;
  try {
    s = await getStudent(ctx, params.studentId);
  } catch (e) {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  }
  if (!s) notFound(); // same response for "doesn't exist" and "not yours"
  const here = `${base}/students/${s.id}`;
  const tab = str(sp.tab, "overview");
  const tabs = [
    { href: here, label: "Overview" },
    { href: `${here}?tab=attendance`, label: "Attendance" },
    { href: `${here}?tab=results`, label: "Progress" },
    { href: `${here}?tab=reports`, label: "Report cards" },
    { href: `${here}?tab=discipline`, label: "Discipline" },
    { href: `${here}?tab=library`, label: "Library" },
  ];
  const current = tab === "overview" ? here : `${here}?tab=${tab}`;
  const back = current;

  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/students`} className="text-brand-700 underline">← Students</Link></p>
      <PageHeader title={`${s.firstName} ${s.lastName}`} description={`Admission number ${s.admissionNumber}`} actions={<Link href={`${base}/fees/student/${s.id}`} className="text-sm text-brand-700 underline">Fees statement</Link>} />
      <Flash sp={sp} />
      <Tabs items={tabs} current={current} />
      {tab === "overview" ? <Overview /> : null}
      {tab === "attendance" ? <Attendance /> : null}
      {tab === "results" ? <Results /> : null}
      {tab === "reports" ? <Reports /> : null}
      {tab === "discipline" ? <Discipline /> : null}
      {tab === "library" ? <Library /> : null}
    </>
  );

  async function Overview() {
    const cls = await currentClassOf(ctx, s!.id);
    const guardians = await guardiansOf(ctx, s!.id);
    const acts = await studentActivities(ctx, s!.id);
    const parents = can(ctx, "users.manage") ? await listPeople(ctx, { role: "parent" }) : [];
    return (
      <>
        <Card className="mb-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Status</dt><dd><Badge>{s!.status}</Badge></dd></div>
            <div><dt className="text-slate-500">Class</dt><dd className="font-medium">{cls?.className ?? "Not placed"}</dd></div>
            <div><dt className="text-slate-500">Date of birth</dt><dd className="font-medium">{s!.dateOfBirth ?? "—"}</dd></div>
            <div><dt className="text-slate-500">Login</dt><dd className="font-medium">{s!.personId ? "Has a login" : "No login"}</dd></div>
          </dl>
        </Card>
        <Section title="Parents and guardians">
          <Table caption="Guardians" rows={guardians} rowKey={(g) => g.personId} empty="No guardian linked." columns={[
            { header: "Name", cell: (g) => `${g.firstName} ${g.lastName}` },
            { header: "Relationship", cell: (g) => g.relationship },
            ...(can(ctx, "users.manage") ? [{ header: "", cell: (g: (typeof guardians)[number]) => (
              <ActionForm action={unlinkGuardian.bind(null, slug)} back={back} className="inline">
                <input type="hidden" name="studentId" value={s!.id} /><input type="hidden" name="guardianPersonId" value={g.personId} />
                <SubmitButton variant="ghost" confirm="Unlink this guardian?">Unlink</SubmitButton>
              </ActionForm>
            ) }] : []),
          ]} />
        </Section>
        {acts.length ? (
          <Section title="Clubs and sports">
            <ul className="text-sm">{acts.map((a) => <li key={`${a.name}${a.joinedOn}`}>{a.name} ({a.kind}){a.role ? ` · ${a.role}` : ""} · since {a.joinedOn}{a.leftOn ? `, left ${a.leftOn}` : ""}</li>)}</ul>
          </Section>
        ) : null}
        {can(ctx, "users.manage") ? (
          <Details summary="Link a parent or guardian">
            <ActionForm action={linkGuardian.bind(null, slug)} back={back}>
              <input type="hidden" name="studentId" value={s!.id} />
              <Input label="Relationship" name="relationship" placeholder="mother, father, guardian…" required />
              <Select label="Existing parent account" name="existingPersonId" placeholder="— or create a new account below —" options={parents.map((p) => ({ value: p.id, label: `${p.lastName}, ${p.firstName}${p.login ? ` (${p.login})` : ""}` }))} />
              <p className="text-sm text-slate-600">New parent account (only if not chosen above):</p>
              <Grid>
                <Input label="First name" name="firstName" />
                <Input label="Last name" name="lastName" />
                <Input label="Email (or leave blank and use a username)" name="email" type="email" />
                <Input label="Username" name="username" />
                <Input label="Temporary password" name="password" type="text" autoComplete="off" hint="10+ characters. They must change it at first sign-in." />
              </Grid>
              <div><SubmitButton>Link guardian</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : null}
        {can(ctx, "users.manage") && !s!.personId ? (
          <Details summary="Create a student login (username, no email needed)">
            <ActionForm action={createStudentLogin.bind(null, slug)} back={back}>
              <input type="hidden" name="studentId" value={s!.id} />
              <Grid>
                <Input label="Username" name="username" required placeholder={`${s!.firstName}.${s!.lastName}`.toLowerCase()} />
                <Input label="Temporary password" name="password" type="text" autoComplete="off" required minLength={10} />
              </Grid>
              <div><SubmitButton>Create login</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : null}
        {can(ctx, "students.create") ? (
          <Details summary="Edit student details">
            <ActionForm action={updateStudentAction.bind(null, slug)} back={back}>
              <input type="hidden" name="studentId" value={s!.id} />
              <Grid>
                <Input label="First name" name="firstName" defaultValue={s!.firstName} required />
                <Input label="Last name" name="lastName" defaultValue={s!.lastName} required />
                <Input label="Date of birth" name="dateOfBirth" type="date" defaultValue={s!.dateOfBirth ?? ""} />
                <Select label="Gender" name="gender" defaultValue={s!.gender ?? ""} options={[{ value: "", label: "—" }, { value: "female", label: "Female" }, { value: "male", label: "Male" }]} />
                <Select label="Status" name="status" defaultValue={s!.status} options={["applicant", "registered", "enrolled", "transferred_out", "graduated", "withdrawn"].map((x) => ({ value: x, label: x.replace("_", " ") }))} />
              </Grid>
              <div><SubmitButton>Save</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : null}
        {can(ctx, "discipline.report") ? (
          <Details summary="Report a discipline incident">
            <ActionForm action={reportIncident.bind(null, slug)} back={back}>
              <input type="hidden" name="studentId" value={s!.id} />
              <Grid>
                <Select label="Category" name="category" options={INCIDENT_CATEGORIES.map((c) => ({ value: c, label: c.replace("_", " ") }))} />
                <Input label="Date" name="occurredOn" type="date" defaultValue={today()} required />
              </Grid>
              <TextArea label="What happened" name="description" required />
              <Input label="Recommended action (the headmaster decides)" name="recommendedAction" />
              <div><SubmitButton>Submit report</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : null}
      </>
    );
  }

  async function Attendance() {
    const a = await studentAttendance(ctx, s!.id);
    return (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[["Days recorded", a.summary.days], ["Present", a.summary.present], ["Late", a.summary.late], ["Absent", a.summary.absent], ["Approved absence", a.summary.approved]].map(([l, v]) => (
            <Card key={String(l)}><p className="text-xs text-slate-600">{l}</p><p className="text-xl font-semibold">{v}</p></Card>
          ))}
        </div>
        {can(ctx, "portal.guardian") ? <p className="mb-3 text-sm"><Link className="text-brand-700 underline" href={`${base}/attendance/explain?studentId=${s!.id}`}>Explain an absence</Link></p> : null}
        <Section title="Daily register">
          <Table caption="Daily attendance" rows={a.daily.slice(0, 60)} rowKey={(r) => `${r.date}`} empty="No registers yet." columns={[
            { header: "Date", cell: (r) => r.date },
            { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
            { header: "Note", cell: (r) => r.note ?? "" },
          ]} />
        </Section>
        <Section title="Lessons missed (not counted as full days)">
          <Table caption="Lesson absences" rows={a.lessonAbsences.slice(0, 60)} rowKey={(r) => `${r.date}${r.period}${r.groupName}`} empty="None." columns={[
            { header: "Date", cell: (r) => r.date },
            { header: "Lesson", cell: (r) => `${r.groupName ?? ""} ${r.period ?? ""}` },
            { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
          ]} />
        </Section>
      </>
    );
  }

  async function Results() {
    const terms = await listTerms(ctx);
    const t = str(sp.term) || (await currentTerm(ctx))?.id;
    const results = t ? await studentResults(ctx, s!.id, t) : [];
    const staff = can(ctx, "students.view_all") || can(ctx, "students.view_taught");
    return (
      <>
        <form className="mb-4 flex items-end gap-2" action={here}>
          <input type="hidden" name="tab" value="results" />
          <Select label="Term" name="term" defaultValue={t} options={terms.map((x) => ({ value: x.id, label: x.name + ` (${x.startsOn.slice(0, 4)})` }))} />
          <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
        </form>
        {!staff ? <p className="mb-3 text-sm text-slate-600">Only results the school has published are shown. Rankings and comparisons with other students are never shown.</p> : null}
        {results.map((r) => (
          <Card key={r.group} className="mb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{r.subject}</h3>
              <p className="text-sm">{r.percent === null ? <span className="text-slate-500">No weighted marks yet</span> : <><strong>{r.percent}%</strong> · grade <strong>{r.grade}</strong></>}{r.incomplete ? <span className="ml-2"><Badge tone="amber">incomplete</Badge></span> : null}</p>
            </div>
            <p className="mb-2 text-xs text-slate-500">{r.teacher ?? "No teacher assigned"}</p>
            <ul className="text-sm">{r.assessments.map((a, i) => <li key={i} className="flex justify-between gap-2 border-t border-slate-100 py-1"><span>{a.title} <span className="text-slate-500">({a.kind}{a.weight ? `, ${a.weight}%` : ", feedback only"})</span></span><span>{a.score !== null && a.score !== undefined ? `${a.score}/${a.max}` : <Badge>{a.status ?? "pending"}</Badge>}</span></li>)}</ul>
          </Card>
        ))}
        {!results.length ? <p className="text-sm text-slate-500">No subjects or results for this term.</p> : null}
      </>
    );
  }

  async function Reports() {
    const reps = await publishedReportsFor(ctx, s!.id);
    return <Table caption="Report cards" rows={reps} rowKey={(r) => r.id} empty="No report cards yet." columns={[
      { header: "Term", cell: (r) => <Link className="text-brand-700 underline" href={`${base}/reports/${r.id}`}>{r.termName}</Link> },
      { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
      { header: "Published", cell: (r) => fmtDate(r.publishedAt) },
    ]} />;
  }

  async function Discipline() {
    const rows = await studentIncidents(ctx, s!.id);
    return <Table caption="Discipline" rows={rows} rowKey={(r) => r.id} empty="No records you can see." columns={[
      { header: "Date", cell: (r) => r.occurredOn },
      { header: "Category", cell: (r) => r.category.replace("_", " ") },
      { header: "What happened", cell: (r) => r.description },
      { header: "Action", cell: (r) => r.approvedAction ?? (r.recommendedAction ? `Recommended: ${r.recommendedAction}` : "—") },
      { header: "Status", cell: (r) => <Badge>{r.status}</Badge> },
    ]} />;
  }

  async function Library() {
    const rows = await studentLoans(ctx, s!.id);
    const now = today();
    return <Table caption="Library loans" rows={rows} rowKey={(r) => `${r.title}${r.borrowedOn}`} empty="No library history." columns={[
      { header: "Book", cell: (r) => r.title },
      { header: "Borrowed", cell: (r) => r.borrowedOn },
      { header: "Due", cell: (r) => r.dueOn },
      { header: "Status", cell: (r) => <Badge>{r.returnedOn ? (r.outcome ?? "returned") : r.dueOn < now ? "overdue" : "on_loan"}</Badge> },
    ]} />;
  }
}
