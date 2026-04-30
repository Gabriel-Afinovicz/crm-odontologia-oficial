"use client";

import { useState } from "react";
import dynamic from "next/dynamic";

const TabSkeleton = () => (
  <div className="space-y-3">
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
    ))}
  </div>
);

const TagsManager = dynamic(
  () => import("./tags-manager").then((m) => m.TagsManager),
  { loading: () => <TabSkeleton /> }
);
const SourcesManager = dynamic(
  () => import("./sources-manager").then((m) => m.SourcesManager),
  { loading: () => <TabSkeleton /> }
);
const CustomFieldsManager = dynamic(
  () => import("./custom-fields-manager").then((m) => m.CustomFieldsManager),
  { loading: () => <TabSkeleton /> }
);
const OperatorsManager = dynamic(
  () => import("./operators-manager").then((m) => m.OperatorsManager),
  { loading: () => <TabSkeleton /> }
);
const PipelineStagesManager = dynamic(
  () =>
    import("./pipeline-stages-manager").then((m) => m.PipelineStagesManager),
  { loading: () => <TabSkeleton /> }
);
const SpecialtiesManager = dynamic(
  () => import("./specialties-manager").then((m) => m.SpecialtiesManager),
  { loading: () => <TabSkeleton /> }
);
const RoomsManager = dynamic(
  () => import("./rooms-manager").then((m) => m.RoomsManager),
  { loading: () => <TabSkeleton /> }
);
const ProcedureTypesManager = dynamic(
  () =>
    import("./procedure-types-manager").then((m) => m.ProcedureTypesManager),
  { loading: () => <TabSkeleton /> }
);
const ClinicHoursManager = dynamic(
  () => import("./clinic-hours-manager").then((m) => m.ClinicHoursManager),
  { loading: () => <TabSkeleton /> }
);
const ClinicHolidaysManager = dynamic(
  () =>
    import("./clinic-holidays-manager").then((m) => m.ClinicHolidaysManager),
  { loading: () => <TabSkeleton /> }
);
const AgendaBlocksManager = dynamic(
  () => import("./agenda-blocks-manager").then((m) => m.AgendaBlocksManager),
  { loading: () => <TabSkeleton /> }
);
const MessageTemplatesManager = dynamic(
  () =>
    import("./message-templates-manager").then(
      (m) => m.MessageTemplatesManager
    ),
  { loading: () => <TabSkeleton /> }
);
const UserRoleTagsManager = dynamic(
  () =>
    import("./user-role-tags-manager").then((m) => m.UserRoleTagsManager),
  { loading: () => <TabSkeleton /> }
);
const WhatsAppInstanceManager = dynamic(
  () =>
    import("./whatsapp-instance-manager").then(
      (m) => m.WhatsAppInstanceManager
    ),
  { loading: () => <TabSkeleton /> }
);

const TAB_GROUPS = [
  {
    id: "pipeline" as const,
    label: "Pipeline & Leads",
    tabs: [
      { id: "pipeline", label: "Pipeline" },
      { id: "specialties", label: "Especialidades" },
      { id: "tags", label: "Tags" },
      { id: "sources", label: "Fontes" },
      { id: "custom-fields", label: "Campos personalizados" },
    ],
  },
  {
    id: "agenda" as const,
    label: "Agenda",
    tabs: [
      { id: "rooms", label: "Salas" },
      { id: "procedures", label: "Procedimentos" },
      { id: "hours", label: "Horários" },
      { id: "holidays", label: "Feriados" },
      { id: "blocks", label: "Bloqueios" },
      { id: "templates", label: "Mensagens" },
    ],
  },
];

const OPERATORS_TAB = { id: "operators", label: "Membros" } as const;
const ROLE_TAGS_TAB = { id: "role-tags", label: "Funções" } as const;
const WHATSAPP_TAB = { id: "whatsapp", label: "WhatsApp" } as const;

type TabId =
  | "pipeline"
  | "specialties"
  | "tags"
  | "sources"
  | "custom-fields"
  | "rooms"
  | "procedures"
  | "hours"
  | "holidays"
  | "blocks"
  | "templates"
  | "operators"
  | "role-tags"
  | "whatsapp";

const VALID_TABS: TabId[] = [
  "pipeline",
  "specialties",
  "tags",
  "sources",
  "custom-fields",
  "rooms",
  "procedures",
  "hours",
  "holidays",
  "blocks",
  "templates",
  "operators",
  "role-tags",
  "whatsapp",
];

interface SettingsContentProps {
  canManageOperators?: boolean;
  initialTab?: string;
}

export function SettingsContent({
  canManageOperators = false,
  initialTab,
}: SettingsContentProps) {
  const resolvedInitial =
    initialTab && (VALID_TABS as string[]).includes(initialTab)
      ? (initialTab as TabId)
      : "pipeline";

  const [activeTab, setActiveTab] = useState<TabId>(resolvedInitial);

  const groups = canManageOperators
    ? [
        ...TAB_GROUPS,
        {
          id: "team" as const,
          label: "Equipe",
          tabs: [
            { id: OPERATORS_TAB.id, label: OPERATORS_TAB.label },
            { id: ROLE_TAGS_TAB.id, label: ROLE_TAGS_TAB.label },
          ],
        },
        {
          id: "integrations" as const,
          label: "Integrações",
          tabs: [{ id: WHATSAPP_TAB.id, label: WHATSAPP_TAB.label }],
        },
      ]
    : TAB_GROUPS;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure pipeline, especialidades, salas, procedimentos, horários,
          feriados, bloqueios e templates de mensagem
          {canManageOperators ? ", e gerencie operadores" : ""}.
        </p>
      </div>

      <div className="mb-6 space-y-3">
        {groups.map((group) => (
          <div key={group.id}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-1 border-b border-gray-200">
              {group.tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors
                    ${
                      activeTab === tab.id
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {activeTab === "pipeline" && <PipelineStagesManager />}
      {activeTab === "specialties" && <SpecialtiesManager />}
      {activeTab === "tags" && <TagsManager />}
      {activeTab === "sources" && <SourcesManager />}
      {activeTab === "custom-fields" && <CustomFieldsManager />}
      {activeTab === "rooms" && <RoomsManager />}
      {activeTab === "procedures" && <ProcedureTypesManager />}
      {activeTab === "hours" && <ClinicHoursManager />}
      {activeTab === "holidays" && <ClinicHolidaysManager />}
      {activeTab === "blocks" && <AgendaBlocksManager />}
      {activeTab === "templates" && <MessageTemplatesManager />}
      {activeTab === "operators" && canManageOperators && <OperatorsManager />}
      {activeTab === "role-tags" && canManageOperators && (
        <UserRoleTagsManager />
      )}
      {activeTab === "whatsapp" && canManageOperators && (
        <WhatsAppInstanceManager />
      )}
    </div>
  );
}
