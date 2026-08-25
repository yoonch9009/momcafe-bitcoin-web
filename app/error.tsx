"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] p-6 text-[var(--ink)]">
      <section className="surface max-w-lg p-8 text-center">
        <p className="eyebrow">APPLICATION ERROR</p>
        <h1 className="mt-4 text-3xl font-semibold">
          대시보드를 표시하지 못했습니다.
        </h1>
        <p className="mt-3 text-[var(--muted)]">잠시 후 다시 시도해 주세요.</p>
        <button
          className="button-primary mx-auto mt-6"
          onClick={reset}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} /> 다시 시도
        </button>
      </section>
    </main>
  );
}
