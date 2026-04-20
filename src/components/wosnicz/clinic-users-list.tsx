interface ClinicUser {
  id: string;
  name: string;
  extension_number: string;
  role: string;
  is_active: boolean | null;
  email: string;
}

interface ClinicUsersListProps {
  users: ClinicUser[];
}

const roleLabels: Record<string, { label: string; className: string }> = {
  admin: {
    label: "Administrador",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  operator: {
    label: "Operador",
    className: "bg-gray-50 text-gray-700 border-gray-200",
  },
  super_admin: {
    label: "Super Admin",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

export function ClinicUsersList({ users }: ClinicUsersListProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
        Nenhum usuário cadastrado nesta clínica.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Nome
            </th>
            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Ramal
            </th>
            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Papel
            </th>
            <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map((u) => {
            const roleCfg = roleLabels[u.role] ?? roleLabels.operator;
            return (
              <tr key={u.id}>
                <td className="px-5 py-3">
                  <p className="text-sm font-medium text-gray-900">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </td>
                <td className="px-5 py-3">
                  <code className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    {u.extension_number}
                  </code>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${roleCfg.className}`}
                  >
                    {roleCfg.label}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {u.is_active ? (
                    <span className="text-xs text-green-700">Ativo</span>
                  ) : (
                    <span className="text-xs text-gray-400">Inativo</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
