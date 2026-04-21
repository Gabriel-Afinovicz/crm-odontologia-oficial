export default function LeadDetailLoading() {
  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center gap-4">
        <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200" />
        <div>
          <div className="h-7 w-56 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-4 w-20 animate-pulse rounded bg-gray-100" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <div className="h-72 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-56 animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
    </div>
  );
}
