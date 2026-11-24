"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg space-y-4 p-8">
      <h1 className="text-xl font-semibold">Unable to load this page</h1>
      <p>Something went wrong. Try again; if the problem continues, contact your administrator.</p>
      <button onClick={reset} className="rounded bg-primary px-4 py-2 text-primary-foreground">Try again</button>
    </div>
  );
}
