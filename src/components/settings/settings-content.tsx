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

const BASE_TABS = [
  { id: "pipeline", label: "Pipeline" },
  { id: "specialties", label: "Especialidades" },
  { id: "tags", label: "Tags" },
  { id: "sources", label: "Fontes de Lead" },
  { id: "custom-fields", label: "Campos Personalizados" },
] as const;

const OPERATORS_TAB = { id: "operators", label: "Operadores" } as const;

type TabId =
  | (typeof BASE_TABS)[number]["id"]
  | typeof OPERATORS_TAB.id;

interface SettingsContentProps {
  canManageOperators?: boolean;
}

export function SettingsContent({ canManageOperators = false }: SettingsContentProps) {
  const tabs = canManageOperators ? [...BASE_TABS, OPERATORS_TAB] : BASE_TABS;
  const [activeTab, setActiveTab] = useState<TabId>("pipeline");

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure pipeline, especialidades, tags, fontes e campos personalizados
          {canManageOperators ? ", e gerencie operadores" : ""}.
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors
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

      {activeTab === "pipeline" && <PipelineStagesManager />}
      {activeTab === "specialties" && <SpecialtiesManager />}
      {activeTab === "tags" && <TagsManager />}
      {activeTab === "sources" && <SourcesManager />}
      {activeTab === "custom-fields" && <CustomFieldsManager />}
      {activeTab === "operators" && canManageOperators && <OperatorsManager />}
    </div>
  );
}
