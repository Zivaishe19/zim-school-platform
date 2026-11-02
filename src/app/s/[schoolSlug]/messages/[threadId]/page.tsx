import type { Metadata } from "next";
import Link from "next/link";
import { getThread } from "@/modules/comms/service";
import { PageHeader } from "@/ui/primitives";
import { ActionForm, Badge, Flash, fmtDateTime, SubmitButton, TextArea } from "@/ui/kit";
import { closeThread, reply } from "../../_actions/comms";
import { guard, load } from "../../_lib";

export const metadata: Metadata = { title: "Conversation" };

export default async function ThreadPage(props: PageProps<"/s/[schoolSlug]/messages/[threadId]">) {
  const { ctx, sp, base, slug, params } = await load(props);
  const t = await getThread(ctx, params.threadId);
  guard(t); // only the two participants can open a conversation
  const here = `${base}/messages/${t.thread.id}`;
  return (
    <>
      <p className="mb-2 text-sm"><Link href={`${base}/messages`} className="text-brand-700 underline">← Messages</Link></p>
      <PageHeader title={t.thread.subject} description={`About ${t.student?.first} ${t.student?.last} · ${t.thread.category.replace("_", " ")}`} actions={<Badge>{t.thread.status}</Badge>} />
      <Flash sp={sp} />
      <ol className="mb-4 flex flex-col gap-2">
        {t.messages.map((m) => (
          <li key={m.m.id} className={`max-w-xl rounded-lg px-3 py-2 ${m.m.authorPersonId === ctx.personId ? "self-end bg-brand-50" : "bg-white ring-1 ring-slate-200"}`}>
            <p className="text-xs text-slate-500">{m.first} {m.last} · {fmtDateTime(m.m.createdAt)}</p>
            <p className="text-sm whitespace-pre-line">{m.m.body}</p>
          </li>
        ))}
      </ol>
      {t.thread.status === "open" ? (
        <>
          <ActionForm action={reply.bind(null, slug)} back={here}>
            <input type="hidden" name="threadId" value={t.thread.id} />
            <TextArea label="Reply" name="body" required maxLength={1000} />
            <div><SubmitButton>Send reply</SubmitButton></div>
          </ActionForm>
          <ActionForm action={closeThread.bind(null, slug)} back={here} className="mt-3">
            <input type="hidden" name="threadId" value={t.thread.id} />
            <div><SubmitButton variant="ghost">Close conversation</SubmitButton></div>
          </ActionForm>
        </>
      ) : null}
    </>
  );
}
