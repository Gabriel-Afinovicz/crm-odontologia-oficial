export default function AgendaLoading() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between px-6 py-4 lg:px-8">
          <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
          <div className="h-9 w-28 animate-pulse rounded bg-gray-200" />
        </div>
      </header>
      <main className="p-4 lg:p-6">
        <div className="mb-4 flex gap-2">
          <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-8 w-20 animate-pulse rounded-lg bg-gray-100" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-gray-100" />
        </div>
        <div className="h-[520px] animate-pulse rounded-xl bg-gray-100" />
      </main>
    </div>
  );
}
