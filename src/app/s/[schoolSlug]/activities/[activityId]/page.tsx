import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { activityMembers } from "@/modules/comms/service";
import { ForbiddenError } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Flash, Grid, Input, SubmitButton, Table } from "@/ui/kit";
import { addMember, removeMember } from "../../_actions/comms";
import { load } from "../../_lib";

export const metadata: Metadata = { title: "Activity members" };

export default async function ActivityPage(props: PageProps<"/s/[schoolSlug]/activities/[activityId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  let rows;
  try { rows = await activityMembers(ctx, params.activityId); } catch (e) { if (e instanceof ForbiddenError) notFound(); throw e; }
  const here = `${base}/activities/${params.activityId}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/activities`} className="text-brand-700 underline">← Clubs and sports</Link></p>
      <PageHeader title="Members" description={`${rows.length} current members (past members are kept in history)`} />
      <Flash sp={sp} />
      <ActionForm action={addMember.bind(null, slug)} back={here} className="mb-4 flex flex-col gap-3">
        <input type="hidden" name="activityId" value={params.activityId} />
        <Grid><Input label="Student admission number" name="admissionNumber" required /><Input label="Role (captain, secretary…)" name="role" /></Grid>
        <div><SubmitButton>Add member</SubmitButton></div>
      </ActionForm>
      <Table caption="Members" rows={rows} rowKey={(r) => r.studentId} columns={[
        { header: "Name", cell: (r) => `${r.last}, ${r.first}` }, { header: "Admission no.", cell: (r) => r.adm },
        { header: "Role", cell: (r) => r.role ?? "" }, { header: "Since", cell: (r) => r.joinedOn },
        { header: "", cell: (r) => <ActionForm action={removeMember.bind(null, slug)} back={here} className="inline"><input type="hidden" name="activityId" value={params.activityId} /><input type="hidden" name="studentId" value={r.studentId} /><SubmitButton variant="ghost">Remove</SubmitButton></ActionForm> },
      ]} />
    </>
  );
}
