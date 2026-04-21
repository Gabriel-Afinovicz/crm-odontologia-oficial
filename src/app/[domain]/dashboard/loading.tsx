export default function DashboardLoading() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="px-6 py-4 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />
              <div className="space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6 lg:p-8">
        <div className="mb-8">
          <div className="h-7 w-48 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-gray-100" />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>

        <div className="h-96 animate-pulse rounded-xl bg-gray-100" />
      </main>
    </div>
  );
}
