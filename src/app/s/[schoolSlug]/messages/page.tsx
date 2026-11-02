import type { Metadata } from "next";
import Link from "next/link";
import { contactableStaff, MESSAGE_CATEGORIES, myThreads } from "@/modules/comms/service";
import { guardiansOf } from "@/modules/people/service";
import { listStudents } from "@/modules/students/service";
import { can } from "@/server/tenancy/context";
import { myChildren } from "@/server/tenancy/scope";
import { PageHeader, Card } from "@/ui/primitives";
import { ActionForm, Badge, Details, Flash, fmtDateTime, Grid, Input, Select, SubmitButton, Table, TextArea } from "@/ui/kit";
import { startThread } from "../_actions/comms";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage(props: PageProps<"/s/[schoolSlug]/messages">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "messages.staff") || can(ctx, "portal.guardian"));
  const threads = await myThreads(ctx);
  const children = can(ctx, "portal.guardian") ? await myChildren(ctx) : [];
  const forStudent = str(sp.studentId);
  const staffOpts = forStudent && children.some((c) => c.id === forStudent) ? await contactableStaff(ctx, forStudent) : [];
  const guardianOpts = forStudent && can(ctx, "messages.staff") ? await guardiansOf(ctx, forStudent).catch(() => []) : [];
  const staffStudents = can(ctx, "messages.staff") ? (await listStudents(ctx, { q: str(sp.q) || undefined }).catch(() => ({ rows: [] }))).rows : [];
  const cats = MESSAGE_CATEGORIES.map((c) => ({ value: c, label: c.replace("_", " ") }));
  return (
    <>
      <PageHeader title="Messages" description="Structured conversations between parents and the school about one student. Not an open chat." />
      <Flash sp={sp} />
      <Table caption="Conversations" rows={threads} rowKey={(t) => t.t.id} empty="No conversations yet." columns={[
        { header: "Subject", cell: (t) => <Link className="font-medium text-brand-700 underline" href={`${base}/messages/${t.t.id}`}>{t.t.subject}</Link> },
        { header: "About", cell: (t) => `${t.first} ${t.last}` },
        { header: "Category", cell: (t) => t.t.category.replace("_", " "), hideOnMobile: true },
        { header: "Last message", cell: (t) => fmtDateTime(t.last_at ? new Date(t.last_at) : null), hideOnMobile: true },
        { header: "Status", cell: (t) => <Badge>{t.t.status}</Badge> },
      ]} />
      <Details summary="Start a conversation" open={Boolean(forStudent)}>
        <form className="mb-3 flex flex-wrap items-end gap-2" action={`${base}/messages`}>
          {children.length ? <Select label="About my child" name="studentId" defaultValue={forStudent} options={children.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))} /> : (
            <>
              <Input label="Find student" name="q" defaultValue={str(sp.q)} />
              <Select label="Student" name="studentId" defaultValue={forStudent} placeholder="—" options={staffStudents.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName} (${s.admissionNumber})` }))} />
            </>
          )}
          <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Continue</button>
        </form>
        {forStudent && (staffOpts.length || guardianOpts.length) ? (
          <Card>
            <ActionForm action={startThread.bind(null, slug)} back={`${base}/messages?studentId=${forStudent}`}>
              <input type="hidden" name="studentId" value={forStudent} />
              <Grid>
                {staffOpts.length ? <Select label="To" name="staffPersonId" options={staffOpts.map((s) => ({ value: s.id, label: s.label }))} /> : <Select label="To parent/guardian" name="guardianPersonId" options={guardianOpts.map((g) => ({ value: g.personId, label: `${g.firstName} ${g.lastName} (${g.relationship})` }))} />}
                <Select label="Category" name="category" options={cats} />
                <Input label="Subject" name="subject" required maxLength={120} />
              </Grid>
              <TextArea label="Message (up to 1000 characters)" name="body" required maxLength={1000} />
              <div><SubmitButton>Send</SubmitButton></div>
            </ActionForm>
          </Card>
        ) : forStudent ? <p className="text-sm text-slate-600">No one to message about this student yet (no guardian linked, or no staff assigned).</p> : null}
      </Details>
    </>
  );
}
