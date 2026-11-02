import { Select } from "./kit";

/** Audience picker shared by announcements and events (ids for form/class/group via checkboxes). */
export function AudienceFields({ kinds, forms, classes, groups }: { kinds: string[]; forms: { id: string; name: string }[]; classes: { id: string; name: string }[]; groups: { id: string; name: string }[] }) {
  const labels: Record<string, string> = { everyone: "Everyone", staff: "All staff", parents: "All parents", students: "All students", form: "Selected forms", class: "Selected classes", group: "Selected teaching groups" };
  const box = (items: { id: string; name: string }[], title: string) =>
    items.length ? (
      <fieldset className="rounded border border-slate-200 p-2">
        <legend className="px-1 text-xs text-slate-600">{title}</legend>
        <div className="flex max-h-40 flex-wrap gap-x-4 overflow-y-auto">{items.map((i) => <label key={i.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="audienceIds" value={i.id} className="size-4" />{i.name}</label>)}</div>
      </fieldset>
    ) : null;
  return (
    <>
      <Select label="Send to" name="audienceKind" options={kinds.map((k) => ({ value: k, label: labels[k] ?? k }))} />
      {kinds.includes("form") ? box(forms, "Forms (when 'Selected forms')") : null}
      {kinds.includes("class") ? box(classes, "Classes (when 'Selected classes')") : null}
      {kinds.includes("group") ? box(groups, "Teaching groups (when 'Selected teaching groups')") : null}
    </>
  );
}
