export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--canvas)] p-6 text-[var(--ink)]">
      <section className="surface max-w-lg p-8 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-4 text-3xl font-semibold">
          페이지를 찾을 수 없습니다.
        </h1>
        <a className="button-primary mx-auto mt-6" href="./">
          대시보드로 돌아가기
        </a>
      </section>
    </main>
  );
}
