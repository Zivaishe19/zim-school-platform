import type { Metadata } from "next";
import { EVENT_KINDS, upcomingEvents } from "@/modules/comms/service";
import { currentYear, listClasses, listForms, listGroups } from "@/modules/setup/service";
import { can } from "@/server/tenancy/context";
import { Card, PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Checkbox, Details, Flash, fmtDateTime, Grid, Input, Select, SubmitButton, TextArea } from "@/ui/kit";
import { AudienceFields } from "@/ui/audience-fields";
import { createEvent, deleteEvent } from "../_actions/comms";
import { load } from "../_lib";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage(props: PageProps<"/s/[schoolSlug]/events">) {
  const { ctx, sp, base, slug } = await load(props);
  const events = await upcomingEvents(ctx, 100);
  const manage = can(ctx, "events.manage");
  const yr = await currentYear(ctx);
  const [forms, classes, groups] = manage ? await Promise.all([listForms(ctx), listClasses(ctx, yr?.id), listGroups(ctx, { yearId: yr?.id })]) : [[], [], []];
  return (
    <>
      <PageHeader title="Events" description="Upcoming school events you are invited to." />
      <Flash sp={sp} />
      {manage ? (
        <Details summary="Create an event">
          <ActionForm action={createEvent.bind(null, slug)} back={`${base}/events`}>
            <Grid>
              <Input label="Title" name="title" required />
              <Select label="Kind" name="kind" options={EVENT_KINDS.map((k) => ({ value: k, label: k.replace("_", " ") }))} />
              <Input label="Starts" name="startsAt" type="datetime-local" required />
              <Input label="Ends" name="endsAt" type="datetime-local" />
              <Input label="Location" name="location" />
            </Grid>
            <TextArea label="Details" name="description" />
            <AudienceFields kinds={["everyone", "staff", "parents", "students", "form", "class", "group"]} forms={forms.map((f) => ({ id: f.id, name: f.name }))} classes={classes.map((c) => ({ id: c.id, name: c.name }))} groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
            <Checkbox label="Also send an in-app notification" name="notifyAudience" />
            <div><SubmitButton>Create event</SubmitButton></div>
          </ActionForm>
        </Details>
      ) : null}
      <ul className="flex flex-col gap-3">
        {events.map((e) => (
          <li key={e.id}><Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{e.title}</h2><Badge tone="blue">{e.kind.replace("_", " ")}</Badge></div>
            <p className="text-sm text-slate-600">{fmtDateTime(e.startsAt)}{e.endsAt ? ` – ${fmtDateTime(e.endsAt)}` : ""}{e.location ? ` · ${e.location}` : ""}</p>
            {e.description ? <p className="mt-2 text-sm whitespace-pre-line">{e.description}</p> : null}
            {manage ? <ActionForm action={deleteEvent.bind(null, slug)} back={`${base}/events`} className="mt-2"><input type="hidden" name="eventId" value={e.id} /><div><SubmitButton variant="ghost" confirm="Remove this event?">Remove</SubmitButton></div></ActionForm> : null}
          </Card></li>
        ))}
        {!events.length ? <li className="text-sm text-slate-500">No upcoming events.</li> : null}
      </ul>
    </>
  );
}
