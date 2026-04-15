import { LoginForm } from "@/components/login-form";

interface LoginPageProps {
  params: Promise<{ domain: string }>;
}

export default async function LoginPage({ params }: LoginPageProps) {
  const { domain } = await params;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white shadow-lg">
            O
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            CRM Odontológico
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Acesse sua conta com ramal e senha
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <LoginForm domain={domain} />
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Clínica: {domain}
        </p>
      </div>
    </div>
  );
}
