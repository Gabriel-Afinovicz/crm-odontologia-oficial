"use client";

import { useState } from "react";
import { TagsManager } from "./tags-manager";
import { SourcesManager } from "./sources-manager";
import { CustomFieldsManager } from "./custom-fields-manager";

const TABS = [
  { id: "tags", label: "Tags" },
  { id: "sources", label: "Fontes de Lead" },
  { id: "custom-fields", label: "Campos Personalizados" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsContent() {
  const [activeTab, setActiveTab] = useState<TabId>("tags");

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
        <p className="mt-1 text-sm text-gray-500">
          Gerencie tags, fontes de lead e campos personalizados
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors
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

      {activeTab === "tags" && <TagsManager />}
      {activeTab === "sources" && <SourcesManager />}
      {activeTab === "custom-fields" && <CustomFieldsManager />}
    </div>
  );
}
