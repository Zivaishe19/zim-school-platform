import type { Metadata } from "next";
import Link from "next/link";
import { listActivities } from "@/modules/comms/service";
import { listStaff } from "@/modules/people/service";
import { can } from "@/server/tenancy/context";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Details, Flash, Grid, Input, Select, SubmitButton, Table } from "@/ui/kit";
import { createActivity } from "../_actions/comms";
import { load } from "../_lib";

export const metadata: Metadata = { title: "Clubs and sports" };

export default async function ActivitiesPage(props: PageProps<"/s/[schoolSlug]/activities">) {
  const { ctx, sp, base, slug } = await load(props);
  const rows = await listActivities(ctx);
  const manage = can(ctx, "activities.manage");
  const staff = manage ? await listStaff(ctx) : [];
  return (
    <>
      <PageHeader title="Clubs and sports" />
      <Flash sp={sp} />
      <Table caption="Activities" rows={rows} rowKey={(r) => r.a.id} empty="No clubs or sports yet." columns={[
        { header: "Name", cell: (r) => (manage || r.a.patronPersonId === ctx.personId ? <Link className="font-medium text-brand-700 underline" href={`${base}/activities/${r.a.id}`}>{r.a.name}</Link> : r.a.name) },
        { header: "Kind", cell: (r) => r.a.kind },
        { header: "Patron", cell: (r) => (r.first ? `${r.first} ${r.last}` : "—") },
        { header: "When", cell: (r) => r.a.schedule ?? "", hideOnMobile: true },
        { header: "Members", cell: (r) => r.members },
      ]} />
      {manage ? (
        <Details summary="Add a club or sport">
          <ActionForm action={createActivity.bind(null, slug)} back={`${base}/activities`}>
            <Grid>
              <Input label="Name" name="name" required />
              <Select label="Kind" name="kind" options={[{ value: "club", label: "Club" }, { value: "sport", label: "Sport" }]} />
              <Input label="When" name="schedule" placeholder="Wednesdays 14:30" />
              <Select label="Patron (teacher in charge)" name="patronPersonId" placeholder="—" options={staff.map((s) => ({ value: s.id, label: `${s.lastName}, ${s.firstName}` }))} />
            </Grid>
            <div><SubmitButton>Add</SubmitButton></div>
          </ActionForm>
        </Details>
      ) : null}
    </>
  );
}
