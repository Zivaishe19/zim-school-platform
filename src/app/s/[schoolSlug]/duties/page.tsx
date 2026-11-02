import type { Metadata } from "next";
import { classDuties, myClassesLed } from "@/modules/discipline/service";
import { classMembers } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Checkbox, Flash, Grid, Input, Select, SubmitButton, Table, today } from "@/ui/kit";
import { assignDuty, endDuty, rotateDuty } from "../_actions/admin";
import { guard, load, str } from "../_lib";

export const metadata: Metadata = { title: "Class duties" };

export default async function DutiesPage(props: PageProps<"/s/[schoolSlug]/duties">) {
  const { ctx, sp, base, slug } = await load(props);
  guard(can(ctx, "duties.manage") || can(ctx, "settings.manage"));
  const classes = await myClassesLed(ctx);
  const classId = str(sp.classId) || classes[0]?.id;
  const history = str(sp.history) === "1";
  const [duties, members] = classId ? await Promise.all([classDuties(ctx, classId, history), classMembers(ctx, classId)]) : [[], []];
  const here = `${base}/duties?classId=${classId ?? ""}${history ? "&history=1" : ""}`;
  return (
    <>
      <PageHeader title="Class duties and responsibilities" description="Monitors, prefects, cleaning rotas. Past assignments are kept." />
      <Flash sp={sp} />
      <form className="mb-4 flex flex-wrap items-end gap-2" action={`${base}/duties`}>
        <Select label="Class" name="classId" defaultValue={classId} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
        <Checkbox label="Include ended" name="history" value="1" defaultChecked={history} />
        <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold">Show</button>
      </form>
      {classId ? (
        <>
          <Table caption="Duties" rows={duties} rowKey={(d) => d.d.id} empty="No duties assigned." columns={[
            { header: "Student", cell: (d) => `${d.last}, ${d.first}` }, { header: "Role", cell: (d) => d.d.role },
            { header: "From", cell: (d) => d.d.startsOn }, { header: "To", cell: (d) => d.d.endsOn ?? "ongoing" },
            { header: "", cell: (d) => (!d.d.endsOn || d.d.endsOn >= today() ? <ActionForm action={endDuty.bind(null, slug)} back={here} className="inline"><input type="hidden" name="dutyId" value={d.d.id} /><SubmitButton variant="ghost">End</SubmitButton></ActionForm> : null) },
          ]} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 font-semibold">Assign a role</h2>
              <ActionForm action={assignDuty.bind(null, slug)} back={here}>
                <input type="hidden" name="classId" value={classId} />
                <Select label="Student" name="studentId" options={members.map((m) => ({ value: m.id, label: `${m.lastName}, ${m.firstName}` }))} />
                <Grid><Input label="Role" name="role" placeholder="Class monitor" required /><Input label="From" name="startsOn" type="date" defaultValue={today()} required /><Input label="To (optional)" name="endsOn" type="date" /></Grid>
                <div><SubmitButton>Assign</SubmitButton></div>
              </ActionForm>
            </Card>
            <Card>
              <h2 className="mb-2 font-semibold">Create a rotating rota</h2>
              <ActionForm action={rotateDuty.bind(null, slug)} back={here}>
                <input type="hidden" name="classId" value={classId} />
                <Grid><Input label="Duty" name="role" placeholder="Cleaning" required /><Input label="Starting" name="startsOn" type="date" defaultValue={today()} required /><Input label="Days per turn" name="days" type="number" min={1} defaultValue={5} /><Input label="Students per turn" name="perSlot" type="number" min={1} defaultValue={4} /></Grid>
                <p className="text-xs text-slate-500">Every student in the class gets a turn, in alphabetical order.</p>
                <div><SubmitButton variant="secondary">Create rota</SubmitButton></div>
              </ActionForm>
            </Card>
          </div>
        </>
      ) : <p className="text-sm text-slate-600">You are not class teacher of any class.</p>}
    </>
  );
}
