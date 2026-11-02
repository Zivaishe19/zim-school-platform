import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md flex-1 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-slate-600">It may not exist, or your account may not have access to it.</p>
      <p className="mt-6">
        <Link href="/schools" className="text-sm text-brand-700 underline">
          Back to your schools
        </Link>
      </p>
    </main>
  );
}
