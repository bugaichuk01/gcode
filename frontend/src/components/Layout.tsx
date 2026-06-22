import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import apiClient from "../api/client";
import { useAuth } from "../contexts/AuthContext";
import {
  Archive,
  ClipboardList,
  Download,
  FileText,
  Layers,
  LayoutDashboard,
  Menu,
  Package,
  Printer,
  ScanLine,
  Settings,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { OrganicBlob } from "./ui/FloralDecor";

const operationsPaths = [
  "/operations",
  "/codes",
  "/utilisation",
  "/withdrawal",
  "/aggregation",
  "/returns",
];

const homePaths = ["/", "/dashboard"];

const primaryNav = [
  { path: "/", label: "Главная", icon: LayoutDashboard, shortLabel: "Главная" },
  { path: "/catalog", label: "Национальный каталог", icon: Layers, shortLabel: "Каталог" },
  { path: "/orders", label: "Управление заказами", icon: Package, shortLabel: "Заказы" },
  { path: "/labels", label: "Печать этикеток", icon: Printer, shortLabel: "Этикетки" },
  { path: "/operations", label: "Операции с КИЗами", icon: ScanLine, shortLabel: "КИЗы" },
];

const secondaryNav = [
  { path: "/marketplace", label: "Маркетплейсы", icon: ShoppingBag },
  { path: "/remains", label: "Маркировка остатков", icon: Archive },
  { path: "/label-designer", label: "Конструктор этикеток", icon: Layers },
  { path: "/journal", label: "Журнал операций", icon: ClipboardList },
  { path: "/upd", label: "Документы УПД", icon: FileText },
  { path: "/incoming-upd", label: "Приёмка УПД", icon: Download },
  { path: "/extra-fields", label: "Доп. поля", icon: Sparkles },
  { path: "/products", label: "Товары и Ozon", icon: ShoppingBag },
  { path: "/settings", label: "Настройки ЧЗ", icon: Settings },
];

function UserPanel() {
  const { user, isAdmin, logout } = useAuth();

  return (
    <div className="flex items-center gap-3">
      {isAdmin && (
        <Link
          to="/admin"
          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
        >
          Админ
        </Link>
      )}
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
          {user?.username[0].toUpperCase()}
        </span>
        <span className="hidden sm:inline">{user?.username}</span>
      </div>
      <button
        type="button"
        onClick={logout}
        className="text-xs text-slate-400 hover:text-slate-600"
      >
        Выйти
      </button>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    const interceptor = apiClient.interceptors.response.use(
      (res) => res,
      (err) => {
        const msg = err?.response?.data?.detail;
        if (msg && typeof msg === "string") {
          setGlobalError(msg);
          setTimeout(() => setGlobalError(null), 8000);
        }
        return Promise.reject(err);
      },
    );
    return () => apiClient.interceptors.response.eject(interceptor);
  }, []);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? "nav-link-active" : "nav-link";

  return (
    <div className="relative min-h-screen bg-surface-muted print:min-h-0">
      <OrganicBlob className="-left-32 -top-32 hidden bg-forest-200/25 lg:block" />
      <OrganicBlob className="-right-24 top-1/3 hidden bg-mint-200/15 lg:block" />

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-forest-950/20 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Закрыть меню"
        />
      ) : null}

      <aside
        className={`glass-panel fixed inset-y-0 left-0 z-50 flex w-[min(100vw-3rem,280px)] flex-col shadow-glass transition-transform duration-300 print:hidden lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative overflow-hidden border-b border-sage-200/80 px-5 py-5">
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-forest-100/60 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-forest-600 to-forest-800 shadow-soft">
                <span className="text-xs font-bold tracking-tight text-white">GC</span>
              </div>
              <div>
                <span className="block text-base font-bold tracking-tight text-sage-900">
                  G-CODE
                </span>
                <span className="text-xs text-sage-500">Маркировка и Честный знак</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg p-2 text-sage-500 hover:bg-sage-100 lg:hidden"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Основная навигация">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sage-400">
            Рабочие разделы
          </p>
          {primaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={navLinkClass}
                isActive={(_, location) =>
                  item.path === "/operations"
                    ? operationsPaths.includes(location.pathname)
                    : item.path === "/"
                      ? homePaths.includes(location.pathname)
                      : location.pathname === item.path
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}

          <div className="divider my-4" />

          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sage-400">
            Дополнительно
          </p>
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} className={navLinkClass}>
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-sage-200/80 p-4">
          <div className="rounded-xl bg-gradient-to-br from-forest-50 to-sage-50 p-3">
            <p className="text-xs font-medium text-forest-800">Баланс ЧЗ</p>
            <p className="mt-0.5 text-lg font-bold text-sage-900">—</p>
            <p className="mt-1 text-[11px] text-sage-500">Подключите API для отображения</p>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[280px] print:pl-0">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-sage-200/80 bg-white/85 px-4 backdrop-blur-xl print:hidden">
          <div className="flex items-center gap-3 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="btn-ghost btn-sm !min-h-[40px] !px-2.5"
              aria-label="Открыть меню"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-bold tracking-tight text-sage-900">
              G-CODE
            </span>
          </div>
          <div className="hidden lg:block" />
          <UserPanel />
        </div>

        <nav
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-sage-200/80 bg-white/90 backdrop-blur-xl lg:hidden print:hidden"
          aria-label="Мобильная навигация"
        >
          <div className="flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
            {primaryNav.map((item) => {
              const Icon = item.icon;
              const active =
                item.path === "/operations"
                  ? operationsPaths.includes(location.pathname)
                  : item.path === "/"
                    ? homePaths.includes(location.pathname)
                    : location.pathname === item.path;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`relative flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition ${
                    active ? "text-forest-700" : "text-sage-500"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${active ? "text-forest-600" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.shortLabel}</span>
                  {active ? (
                    <span className="absolute bottom-1 h-0.5 w-8 rounded-full bg-forest-600" />
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        </nav>

        <main className="flex-1 overflow-auto pb-20 lg:pb-0 print:overflow-visible print:pb-0">
          <div className="print:p-0">
            <Outlet />
          </div>
        </main>
      </div>

      {globalError && (
        <div
          className="fixed bottom-4 right-4 z-50 max-w-md px-4 py-3
            bg-red-50 border border-red-200 rounded-lg shadow-lg text-sm text-red-700
            flex items-start gap-2"
        >
          <span>⚠️</span>
          <div className="flex-1">{globalError}</div>
          <button
            type="button"
            onClick={() => setGlobalError(null)}
            className="text-red-400 hover:text-red-600 ml-2"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
