import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p>This page does not exist or is no longer available.</p>
      <Link href="/" className="underline">Return to overview</Link>
    </div>
  );
}
