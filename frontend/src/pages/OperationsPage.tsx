import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import CodesPage from "./CodesPage";
import UtilisationPage from "./UtilisationPage";
import WithdrawalPage from "./WithdrawalPage";
import AggregationPage from "./AggregationPage";
import ReturnPage from "./ReturnPage";

export type OperationsTab =
  | "codes"
  | "utilisation"
  | "withdrawal"
  | "aggregation"
  | "returns";

export const OPERATIONS_TAB_STORAGE_KEY = "operationsTab";

const TABS: { id: OperationsTab; label: string }[] = [
  { id: "codes", label: "Реестр КМ" },
  { id: "utilisation", label: "Ввод в оборот" },
  { id: "withdrawal", label: "Вывод из оборота" },
  { id: "aggregation", label: "Агрегация КИТУ" },
  { id: "returns", label: "Возврат в оборот" },
];

export default function OperationsPage() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<OperationsTab>("codes");

  useEffect(() => {
    const stored = sessionStorage.getItem(OPERATIONS_TAB_STORAGE_KEY);
    if (!stored) return;
    sessionStorage.removeItem(OPERATIONS_TAB_STORAGE_KEY);
    if (TABS.some((tab) => tab.id === stored)) {
      setActiveTab(stored as OperationsTab);
    }
  }, [location.key]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-6">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {activeTab === "codes" && <CodesPage />}
        {activeTab === "utilisation" && <UtilisationPage />}
        {activeTab === "withdrawal" && <WithdrawalPage />}
        {activeTab === "aggregation" && <AggregationPage />}
        {activeTab === "returns" && <ReturnPage />}
      </div>
    </div>
  );
}
