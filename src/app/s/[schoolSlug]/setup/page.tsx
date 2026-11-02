import type { Metadata } from "next";
import Link from "next/link";
import { listScales } from "@/modules/assessments/service";
import { listStaff } from "@/modules/people/service";
import { listProgression } from "@/modules/reports/service";
import * as setup from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Checkbox, Details, Flash, Grid, Input, Section, Select, SubmitButton, Table, Tabs } from "@/ui/kit";
import * as A from "../_actions/setup";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "Setup" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SetupPage(props: PageProps<"/s/[schoolSlug]/setup">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "settings.manage") || can(ctx, "progression.manage"));
  const tab = str(sp.tab, can(ctx, "settings.manage") ? "profile" : "progression");
  const here = `${base}/setup?tab=${tab}`;
  const items = [
    ...(can(ctx, "settings.manage") ? [["profile", "School"], ["years", "Years & terms"], ["structure", "Forms, rooms, subjects"], ["classes", "Classes"], ["groups", "Teaching groups"], ["periods", "Bell schedule"], ["grading", "Grading"]] : []),
    ...(can(ctx, "progression.manage") ? [["progression", "End of year"]] : []),
  ].map(([k, l]) => ({ href: `${base}/setup?tab=${k}`, label: l! }));
  const years = await setup.listYears(ctx);
  const yearOpts = years.map((y) => ({ value: y.id, label: `${y.name} (${y.status})` }));
  const cur = await setup.currentYear(ctx);

  return (
    <>
      <PageHeader title="Setup" description="School structure. Changes are recorded in the audit log." />
      <Flash sp={sp} />
      <Tabs items={items} current={here} />
      {tab === "profile" ? await Profile() : null}
      {tab === "years" ? await Years() : null}
      {tab === "structure" ? await Structure() : null}
      {tab === "classes" ? await Classes() : null}
      {tab === "groups" ? await Groups() : null}
      {tab === "periods" ? await Periods() : null}
      {tab === "grading" ? await Grading() : null}
      {tab === "progression" ? await Progression() : null}
    </>
  );

  async function Profile() {
    const p = await setup.getProfile(ctx);
    return (
      <Card className="max-w-2xl">
        <ActionForm action={A.saveProfile.bind(null, slug)} back={here}>
          <Grid>
            <Input label="School name (on reports)" name="displayName" defaultValue={p.displayName} required />
            <Input label="Motto" name="motto" defaultValue={p.motto ?? ""} />
            <Input label="Address" name="address" defaultValue={p.address ?? ""} />
            <Input label="Phone" name="phone" defaultValue={p.phone ?? ""} />
            <Input label="Email" name="email" defaultValue={p.email ?? ""} />
            <Select label="Default fee currency" name="defaultCurrency" defaultValue={p.defaultCurrency} options={[{ value: "USD", label: "USD" }, { value: "ZiG", label: "ZiG" }]} />
            <Input label="Library: books per student" name="studentLoanLimit" type="number" min={0} defaultValue={p.studentLoanLimit} />
            <Input label="Library: books per staff member" name="staffLoanLimit" type="number" min={0} defaultValue={p.staffLoanLimit} />
            <Input label="Library: loan period (days)" name="loanDays" type="number" min={1} defaultValue={p.loanDays} />
          </Grid>
          <div><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      </Card>
    );
  }

  async function Years() {
    const terms = await setup.listTerms(ctx);
    return (
      <>
        {years.map((y) => (
          <Card key={y.id} className="mb-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{y.name} <Badge>{y.status}</Badge></h2>
              {y.status === "planned" ? (
                <ActionForm action={A.openYear.bind(null, slug)} back={here} className="inline"><input type="hidden" name="yearId" value={y.id} /><SubmitButton variant="secondary">Make this the open year</SubmitButton></ActionForm>
              ) : null}
            </div>
            <p className="mb-2 text-sm text-slate-600">{y.startsOn} to {y.endsOn}</p>
            {terms.filter((t) => t.academicYearId === y.id).map((t) => (
              <ActionForm key={t.id} action={A.updateTerm.bind(null, slug)} back={here} className="mb-2 grid items-end gap-2 border-t border-slate-100 pt-2 sm:grid-cols-5">
                <input type="hidden" name="termId" value={t.id} />
                <Input label="Term" name="name" defaultValue={t.name} />
                <Input label="Starts" name="startsOn" type="date" defaultValue={t.startsOn} />
                <Input label="Ends" name="endsOn" type="date" defaultValue={t.endsOn} />
                <div className="pb-1"><Badge>{t.status}</Badge>{y.status !== "closed" ? <Checkbox label="Make current term" name="open" /> : null}</div>
                {y.status !== "closed" ? <SubmitButton variant="secondary">Save term</SubmitButton> : <span />}
              </ActionForm>
            ))}
          </Card>
        ))}
        <Details summary="Create an academic year" open={!years.length}>
          <ActionForm action={A.createYear.bind(null, slug)} back={here}>
            <Grid cols={4}>
              <Input label="Name" name="name" placeholder="2027" required />
              <Input label="Starts" name="startsOn" type="date" required />
              <Input label="Ends" name="endsOn" type="date" required />
              <Input label="Number of terms" name="terms" type="number" min={0} max={4} defaultValue={3} />
            </Grid>
            <p className="text-sm text-slate-600">Terms are created with equal lengths; adjust their dates afterwards.</p>
            <div><SubmitButton>Create year</SubmitButton></div>
          </ActionForm>
        </Details>
      </>
    );
  }

  async function Structure() {
    const [forms, rooms, subjects] = await Promise.all([setup.listForms(ctx), setup.listRooms(ctx), setup.listSubjects(ctx)]);
    return (
      <>
        <Section title="Forms offered">
          <Card>
            <ActionForm action={A.setForms.bind(null, slug)} back={here} className="flex flex-wrap items-center gap-4">
              {[1, 2, 3, 4, 5, 6].map((l) => <Checkbox key={l} label={setup.FORM_NAMES[l]!} name="levels" value={String(l)} defaultChecked={forms.some((f) => f.level === l)} />)}
              <SubmitButton variant="secondary">Save forms</SubmitButton>
            </ActionForm>
            <p className="mt-2 text-xs text-slate-500">Forms can be added later; removing a form that has classes is not possible.</p>
          </Card>
        </Section>
        <Section title="Subjects">
          <Table caption="Subjects" rows={subjects} rowKey={(r) => r.id} columns={[
            { header: "Code", cell: (r) => r.code }, { header: "Name", cell: (r) => r.name },
            { header: "Board", cell: (r) => r.examBoard.toUpperCase() }, { header: "Practical", cell: (r) => (r.isPractical ? "Yes" : "") },
          ]} />
          <Details summary="Add a subject">
            <ActionForm action={A.createSubject.bind(null, slug)} back={here}>
              <Grid cols={4}>
                <Input label="Code" name="code" placeholder="4004" required />
                <Input label="Name" name="name" placeholder="Mathematics" required />
                <Select label="Exam board" name="examBoard" options={[{ value: "zimsec", label: "ZIMSEC" }, { value: "cambridge", label: "Cambridge" }, { value: "internal", label: "Internal" }]} />
                <Checkbox label="Practical subject" name="isPractical" />
              </Grid>
              <div><SubmitButton>Add subject</SubmitButton></div>
            </ActionForm>
          </Details>
        </Section>
        <Section title="Rooms">
          <Table caption="Rooms" rows={rooms} rowKey={(r) => r.id} columns={[{ header: "Room", cell: (r) => r.name }, { header: "Kind", cell: (r) => r.kind }, { header: "Capacity", cell: (r) => r.capacity ?? "" }]} />
          <Details summary="Add a room">
            <ActionForm action={A.createRoom.bind(null, slug)} back={here}>
              <Grid cols={3}>
                <Input label="Name" name="name" required />
                <Select label="Kind" name="kind" options={["classroom", "laboratory", "workshop", "computer lab", "hall", "field", "other"].map((k) => ({ value: k, label: k }))} />
                <Input label="Capacity" name="capacity" type="number" min={0} />
              </Grid>
              <div><SubmitButton>Add room</SubmitButton></div>
            </ActionForm>
          </Details>
        </Section>
      </>
    );
  }

  async function Classes() {
    const yearId = str(sp.year) || cur?.id;
    const [classes, forms, rooms, staff] = await Promise.all([setup.listClasses(ctx, yearId), setup.listForms(ctx), setup.listRooms(ctx), listStaff(ctx)]);
    return (
      <>
        <form className="mb-4 flex items-end gap-2" action={`${base}/setup`}><input type="hidden" name="tab" value="classes" /><Select label="Year" name="year" defaultValue={yearId} options={yearOpts} /><button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button></form>
        <Table caption="Classes" rows={classes} rowKey={(r) => r.id} empty="No classes for this year." columns={[
          { header: "Class", cell: (c) => <Link className="font-medium text-brand-700 underline" href={`${base}/setup/classes/${c.id}`}>{c.name}</Link> },
          { header: "Form", cell: (c) => c.formName },
          { header: "Class teacher", cell: (c) => (c.teacherFirst ? `${c.teacherFirst} ${c.teacherLast}` : <span className="text-slate-500">none</span>) },
          { header: "Room", cell: (c) => c.roomName ?? "", hideOnMobile: true },
          { header: "Students", cell: (c) => c.size },
        ]} />
        {yearId ? (
          <Details summary="Create a class">
            <ActionForm action={A.createClass.bind(null, slug)} back={`${here}&year=${yearId}`}>
              <input type="hidden" name="academicYearId" value={yearId} />
              <Grid>
                <Select label="Form" name="formId" options={forms.map((f) => ({ value: f.id, label: f.name }))} />
                <Input label="Class name (any name)" name="name" placeholder="1 Blue, 4A, L6 Sciences" required />
                <Input label="Stream (optional)" name="stream" placeholder="Sciences" />
                <Select label="Home room" name="roomId" placeholder="—" options={rooms.map((r) => ({ value: r.id, label: r.name }))} />
                <Select label="Class teacher" name="classTeacherPersonId" placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} />
              </Grid>
              <div><SubmitButton>Create class</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : <p className="text-sm text-slate-600">Create an academic year first.</p>}
      </>
    );
  }

  async function Groups() {
    const yearId = str(sp.year) || cur?.id;
    const [groups, subjects, forms, classes, staff] = await Promise.all([setup.listGroups(ctx, { yearId }), setup.listSubjects(ctx), setup.listForms(ctx), setup.listClasses(ctx, yearId), listStaff(ctx)]);
    return (
      <>
        <p className="mb-3 text-sm text-slate-600">A teaching group is who is taught a subject together: a whole class (common classroom subject), a set, or a practical group drawn from several classes.</p>
        <Table caption="Teaching groups" rows={groups} rowKey={(r) => r.id} empty="No teaching groups yet." columns={[
          { header: "Group", cell: (g) => <Link className="font-medium text-brand-700 underline" href={`${base}/setup/groups/${g.id}`}>{g.name}</Link> },
          { header: "Subject", cell: (g) => `${g.subjectName} (${g.examBoard.toUpperCase()})` },
          { header: "Teacher", cell: (g) => (g.teacherFirst ? `${g.teacherFirst} ${g.teacherLast}` : <span className="text-slate-500">none</span>) },
          { header: "Students", cell: (g) => g.size },
        ]} />
        {yearId ? (
          <Details summary="Create a teaching group">
            <ActionForm action={A.createGroup.bind(null, slug)} back={`${here}&year=${yearId}`}>
              <input type="hidden" name="academicYearId" value={yearId} />
              <Grid>
                <Select label="Subject" name="subjectId" options={subjects.map((s) => ({ value: s.id, label: `${s.name} (${s.examBoard.toUpperCase()})` }))} />
                <Input label="Group name" name="name" placeholder="1 Blue Maths, Form 4 Chemistry Prac A" required />
                <Select label="Form" name="formId" placeholder="—" options={forms.map((f) => ({ value: f.id, label: f.name }))} />
                <Select label="Whole class (optional)" name="classId" placeholder="— not a whole class —" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
                <Select label="Teacher" name="teacherPersonId" placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} />
                <Checkbox label="Add all current students of the class" name="addClassMembers" defaultChecked />
              </Grid>
              <div><SubmitButton>Create group</SubmitButton></div>
            </ActionForm>
          </Details>
        ) : null}
      </>
    );
  }

  async function Periods() {
    const periods = await setup.listPeriods(ctx);
    const numbers = [...new Set(periods.map((p) => p.number))].sort((a, b) => a - b);
    return (
      <>
        <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Bell schedule</caption>
            <thead className="bg-slate-50"><tr><th className="px-3 py-2">#</th>{WEEKDAYS.slice(0, 5).map((d) => <th key={d} className="px-3 py-2">{d}</th>)}</tr></thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n} className="border-t border-slate-100">
                  <th className="px-3 py-2">{n}</th>
                  {[1, 2, 3, 4, 5].map((d) => {
                    const p = periods.find((x) => x.weekday === d && x.number === n);
                    return <td key={d} className="px-3 py-2">{p ? <><span className="font-medium">{p.label}</span><br /><span className="text-xs text-slate-500">{p.startsAt.slice(0, 5)}–{p.endsAt.slice(0, 5)} · {p.kind}</span></> : ""}</td>;
                  })}
                </tr>
              ))}
              {!numbers.length ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No periods yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Details summary="Add or change a period" open={!periods.length}>
          <ActionForm action={A.createPeriods.bind(null, slug)} back={here}>
            <div className="flex flex-wrap gap-3">{WEEKDAYS.map((d, i) => <Checkbox key={d} label={d} name="weekdays" value={String(i + 1)} defaultChecked={i < 5} />)}</div>
            <Grid cols={4}>
              <Input label="Number (order in the day)" name="number" type="number" min={0} required />
              <Input label="Label" name="label" placeholder="Period 1, Break, Assembly" required />
              <Input label="Starts" name="startsAt" type="time" required />
              <Input label="Ends" name="endsAt" type="time" required />
              <Select label="Kind" name="kind" options={["lesson", "break", "lunch", "assembly", "other"].map((k) => ({ value: k, label: k }))} />
            </Grid>
            <p className="text-sm text-slate-600">Saving a number that already exists on a day replaces it.</p>
            <div><SubmitButton>Save period</SubmitButton></div>
          </ActionForm>
        </Details>
      </>
    );
  }

  async function Grading() {
    const scales = await listScales(ctx);
    return (
      <>
        <p className="mb-3 text-sm text-slate-600">These are your school&apos;s conversion from percentage to grade, used for term results. They are starting values, not official exam-board boundaries. Enter bands as GRADE:MINIMUM%, highest first.</p>
        {scales.map((s) => (
          <Card key={s.id} className="mb-3">
            <ActionForm action={A.saveGradingScale.bind(null, slug)} back={here}>
              <input type="hidden" name="id" value={s.id} />
              <Input label={`${s.name} (${s.examBoard.toUpperCase()})`} name="bands" defaultValue={s.bands.map((b) => `${b.grade}:${b.min}`).join(", ")} />
              <div><SubmitButton variant="secondary">Save scale</SubmitButton></div>
            </ActionForm>
          </Card>
        ))}
      </>
    );
  }

  async function Progression() {
    const fromYearId = str(sp.from) || cur?.id;
    const rows = fromYearId ? await listProgression(ctx, fromYearId) : [];
    const to = rows[0]?.p.toYearId ?? str(sp.to);
    const toClasses = to ? await setup.listClasses(ctx, to) : [];
    const fromYear = years.find((y) => y.id === fromYearId);
    return (
      <>
        <Card className="mb-4">
          <h2 className="mb-2 font-semibold">1. Propose next-year placements</h2>
          <p className="mb-3 text-sm text-slate-600">Nobody is promoted automatically. This creates a proposal for every actively enrolled student; Upper Six students are proposed to graduate. You then choose a decision and a class for each student.</p>
          <ActionForm action={A.propose.bind(null, slug)} back={`${base}/setup?tab=progression&from=${fromYearId ?? ""}`} className="flex flex-wrap items-end gap-3">
            <Select label="From year" name="fromYearId" defaultValue={fromYearId} options={yearOpts} />
            <Select label="To year" name="toYearId" options={yearOpts.filter((y) => y.value !== fromYearId)} />
            <SubmitButton variant="secondary">Create proposal</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-sm">Need next year&apos;s classes first? Copy this year&apos;s classes and teaching groups (structure only, no student records):</p>
          <ActionForm action={A.copyStructure.bind(null, slug)} back={`${base}/setup?tab=progression&from=${fromYearId ?? ""}`} className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="fromYearId" value={fromYearId ?? ""} />
            <Select label="Copy into year" name="toYearId" options={yearOpts.filter((y) => y.value !== fromYearId)} />
            <SubmitButton variant="secondary">Copy structure</SubmitButton>
          </ActionForm>
        </Card>
        {rows.length ? (
          <Card className="mb-4">
            <h2 className="mb-2 font-semibold">2. Review decisions ({rows.filter((r) => r.p.appliedAt).length} of {rows.length} applied)</h2>
            <ActionForm action={A.decide.bind(null, slug)} back={`${base}/setup?tab=progression&from=${fromYearId}`}>
              <input type="hidden" name="fromYearId" value={fromYearId} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-slate-600"><th className="py-1">Student</th><th>From</th><th>Decision</th><th>Next class</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.p.id} className="border-t border-slate-100">
                        <td className="py-1 pr-2">{r.last}, {r.first}</td>
                        <td className="pr-2">{r.fromClass}</td>
                        <td className="pr-2">
                          {r.p.appliedAt ? <Badge>{r.p.decision}</Badge> : (
                            <select name={`decision_${r.p.id}`} defaultValue={r.p.decision} aria-label={`Decision for ${r.first} ${r.last}`} className="min-h-10 rounded border border-slate-300 bg-white px-2">
                              {["proposed", "promote", "repeat", "leave", "graduate"].map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          {r.p.appliedAt ? (toClasses.find((c) => c.id === r.p.toClassId)?.name ?? "") : (
                            <select name={`class_${r.p.id}`} defaultValue={r.p.toClassId ?? ""} aria-label={`Next class for ${r.first} ${r.last}`} className="min-h-10 rounded border border-slate-300 bg-white px-2">
                              <option value="">—</option>
                              {toClasses.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.formName})</option>)}
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div><SubmitButton variant="secondary">Save decisions</SubmitButton></div>
            </ActionForm>
          </Card>
        ) : null}
        {rows.length ? (
          <Card>
            <h2 className="mb-2 font-semibold">3. Apply, then close the year</h2>
            <p className="mb-3 text-sm text-slate-600">Applying creates next-year enrolments. Previous placements, marks, attendance and reports are kept. Closing the year locks its marks and registers.</p>
            <div className="flex flex-wrap gap-3">
              <ActionForm action={A.apply.bind(null, slug)} back={`${base}/setup?tab=progression&from=${fromYearId}`} className="inline"><input type="hidden" name="fromYearId" value={fromYearId} /><SubmitButton confirm="Apply all decisions now?">Apply placements</SubmitButton></ActionForm>
              {fromYear?.status !== "closed" ? <ActionForm action={A.close.bind(null, slug)} back={`${base}/setup?tab=progression&from=${fromYearId}`} className="inline"><input type="hidden" name="yearId" value={fromYearId} /><SubmitButton variant="secondary" confirm="Close this academic year? Marks and registers will be locked.">Close {fromYear?.name}</SubmitButton></ActionForm> : <Badge>closed</Badge>}
            </div>
          </Card>
        ) : null}
      </>
    );
  }
}
