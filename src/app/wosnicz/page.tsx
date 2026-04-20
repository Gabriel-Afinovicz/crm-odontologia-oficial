import { WosniczLoginForm } from "@/components/wosnicz/wosnicz-login-form";

export default function WosniczLoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500 text-xl font-bold text-slate-900 shadow-lg">
            W
          </div>
          <h1 className="text-2xl font-bold text-white">Painel Master</h1>
          <p className="mt-1 text-sm text-slate-300">
            Acesso exclusivo do Super Admin
          </p>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/80 p-6 shadow-2xl backdrop-blur">
          <WosniczLoginForm />
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          CRM Odontológico · Wosnicz
        </p>
      </div>
    </div>
  );
}
