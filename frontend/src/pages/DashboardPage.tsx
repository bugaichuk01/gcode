import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import apiClient from "../api/client";

interface DashboardData {
  user: { username: string; role: string };
  organization: {
    id: string;
    name: string;
    inn: string | null;
    oms_id: string | null;
  } | null;
  codes: { total_orders: number; total_codes: number; active_orders: number };
  withdrawals: { total: number; month: number };
  cards: { total: number; published: number };
  kitu: { total_active: number };
  operations: { today: number; week: number; errors_week: number };
  activity_chart: { date: string; day: string; count: number }[];
  recent_operations: {
    id: string;
    type: string;
    status: string;
    description: string | null;
    codes_count: number | null;
    created_at: string;
  }[];
  token: {
    suz_expires_in_minutes: number | null;
    suz_is_expiring: boolean;
    true_api_expires_in_minutes: number | null;
    true_api_is_expiring: boolean;
    updated_at: string | null;
  } | null;
  pending_orders: {
    id: string;
    gtin: string | null;
    quantity: number;
    status: string;
    created_at: string;
  }[];
}

const OP_LABELS: Record<string, string> = {
  order_created: "Заказ СУЗ создан",
  codes_downloaded: "КМ скачаны",
  withdrawal_sent: "Вывод из оборота",
  utilisation_sent: "Ввод в оборот",
  aggregation_sent: "Агрегация КИТУ",
  return_sent: "Возврат в оборот",
  label_printed: "Печать этикеток",
  upd_created: "УПД создан",
  cis_checked: "Проверка КМ",
  token_updated: "Токен обновлён",
  card_created: "Карточка НК",
};

const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  created: { label: "Создан", color: "bg-slate-100 text-slate-600" },
  pending: { label: "В обработке", color: "bg-amber-100 text-amber-700" },
  available: { label: "Готов", color: "bg-emerald-100 text-emerald-700" },
  exhausted: { label: "Исчерпан", color: "bg-blue-100 text-blue-700" },
  closed: { label: "Закрыт", color: "bg-slate-100 text-slate-500" },
  rejected: { label: "Отклонён", color: "bg-red-100 text-red-700" },
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<DashboardData>("/dashboard/")
      .then((r) => setData(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Загрузка...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-slate-400">Не удалось загрузить дашборд</div>
    );
  }

  const maxActivity = Math.max(...data.activity_chart.map((d) => d.count), 1);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Добро пожаловать, {data.user.username}!
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {data.organization
              ? `Организация: ${data.organization.name}`
              : "Создайте организацию в Настройках для начала работы"}
          </p>
        </div>
        <div className="text-sm text-slate-400">
          {new Date().toLocaleDateString("ru-RU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
      </div>

      {!data.organization && (
        <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 flex items-center justify-between">
          <span>
            ⚠️ Организация не настроена — большинство функций недоступны
          </span>
          <Link
            to="/settings"
            className="px-3 py-1 bg-amber-600 text-white rounded text-xs hover:bg-amber-700"
          >
            Настроить
          </Link>
        </div>
      )}

      {data.token &&
        (data.token.suz_is_expiring || data.token.true_api_is_expiring) && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center justify-between">
            <span>
              🔑 Токен истекает:{" "}
              {data.token.suz_is_expiring &&
                `СУЗ через ${data.token.suz_expires_in_minutes} мин`}
              {data.token.suz_is_expiring &&
                data.token.true_api_is_expiring &&
                ", "}
              {data.token.true_api_is_expiring &&
                `True API через ${data.token.true_api_expires_in_minutes} мин`}
            </span>
            <Link
              to="/settings"
              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
            >
              Обновить
            </Link>
          </div>
        )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: "Кодов маркировки",
            value: data.codes.total_codes,
            sub: `${data.codes.total_orders} заказов`,
            color: "text-blue-600",
            bg: "bg-blue-50",
            link: "/operations",
            icon: "🏷️",
          },
          {
            label: "Карточек в НК",
            value: data.cards.total,
            sub: `${data.cards.published} опубликовано`,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
            link: "/catalog",
            icon: "📋",
          },
          {
            label: "Выводов из оборота",
            value: data.withdrawals.total,
            sub: `${data.withdrawals.month} за месяц`,
            color: "text-red-600",
            bg: "bg-red-50",
            link: "/operations",
            icon: "📦",
          },
          {
            label: "Упаковок КИТУ",
            value: data.kitu.total_active,
            sub: "активных агрегаций",
            color: "text-indigo-600",
            bg: "bg-indigo-50",
            link: "/operations",
            icon: "📫",
          },
        ].map((card) => (
          <Link
            key={card.label}
            to={card.link}
            className={`${card.bg} rounded-xl p-5 border border-slate-200 hover:shadow-md transition-shadow`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500">{card.label}</p>
                <p className={`text-3xl font-bold mt-1 ${card.color}`}>
                  {card.value.toLocaleString("ru-RU")}
                </p>
                <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
              </div>
              <span className="text-2xl">{card.icon}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-700">Активность за 7 дней</h3>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>
                Сегодня:{" "}
                <strong className="text-slate-700">{data.operations.today}</strong>
              </span>
              <span>
                Неделя:{" "}
                <strong className="text-slate-700">{data.operations.week}</strong>
              </span>
              {data.operations.errors_week > 0 && (
                <span className="text-red-500">
                  Ошибок: <strong>{data.operations.errors_week}</strong>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-2 h-32">
            {data.activity_chart.map((day) => {
              const height = (day.count / maxActivity) * 100;
              return (
                <div
                  key={day.date}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <span className="text-xs text-slate-400">
                    {day.count || ""}
                  </span>
                  <div
                    className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                    style={{
                      height: `${height}%`,
                      minHeight: day.count > 0 ? "4px" : "0",
                    }}
                    title={`${day.date}: ${day.count} операций`}
                  />
                  <span className="text-xs text-slate-400">{day.date}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-4">Токены ЧЗ</h3>
          {data.token ? (
            <div className="space-y-3">
              {[
                {
                  label: "СУЗ (clientToken)",
                  mins: data.token.suz_expires_in_minutes,
                  expiring: data.token.suz_is_expiring,
                },
                {
                  label: "True API (JWT)",
                  mins: data.token.true_api_expires_in_minutes,
                  expiring: data.token.true_api_is_expiring,
                },
              ].map((t) => (
                <div
                  key={t.label}
                  className={`px-3 py-2 rounded-lg text-xs ${
                    t.expiring
                      ? "bg-red-50 border border-red-200"
                      : "bg-emerald-50 border border-emerald-200"
                  }`}
                >
                  <p className="font-medium text-slate-700">{t.label}</p>
                  <p
                    className={
                      t.expiring ? "text-red-600" : "text-emerald-600"
                    }
                  >
                    {t.mins === null
                      ? "Не настроен"
                      : t.mins <= 0
                        ? "⛔ Истёк"
                        : t.expiring
                          ? `⚠️ ${t.mins} мин`
                          : `✓ ${t.mins} мин`}
                  </p>
                </div>
              ))}
              {data.token.updated_at && (
                <p className="text-xs text-slate-400">
                  Обновлён:{" "}
                  {new Date(data.token.updated_at).toLocaleString("ru-RU")}
                </p>
              )}
              <Link
                to="/settings"
                className="block text-center text-xs text-blue-600 hover:underline mt-2"
              >
                Обновить токен →
              </Link>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-slate-400 mb-3">Токены не настроены</p>
              <Link
                to="/settings"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
              >
                Настроить
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {data.pending_orders.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-700">
                Активные заказы СУЗ
              </h3>
              <Link
                to="/orders"
                className="text-xs text-blue-600 hover:underline"
              >
                Все заказы →
              </Link>
            </div>
            <div className="space-y-2">
              {data.pending_orders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg text-sm"
                >
                  <div>
                    <p className="font-mono text-xs text-slate-500">
                      {order.id.slice(0, 8)}...
                    </p>
                    <p className="text-xs text-slate-600">
                      GTIN: {order.gtin || "—"} · {order.quantity} шт
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      ORDER_STATUS_LABELS[order.status]?.color || ""
                    }`}
                  >
                    {ORDER_STATUS_LABELS[order.status]?.label || order.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-slate-700">Последние операции</h3>
            <Link
              to="/journal"
              className="text-xs text-blue-600 hover:underline"
            >
              Весь журнал →
            </Link>
          </div>
          {data.recent_operations.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-400">Операций пока нет</p>
              <p className="text-xs text-slate-300 mt-1">
                Начните с создания карточки товара или заказа КМ
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.recent_operations.map((op) => (
                <div
                  key={op.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
                    op.status === "error" ? "bg-red-50" : "bg-slate-50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-700 truncate">
                      {OP_LABELS[op.type] || op.type}
                    </p>
                    {op.description && (
                      <p className="text-slate-400 truncate">{op.description}</p>
                    )}
                  </div>
                  <div className="ml-3 text-right shrink-0">
                    <span
                      className={`${
                        op.status === "success"
                          ? "text-emerald-600"
                          : "text-red-500"
                      }`}
                    >
                      {op.status === "success" ? "✓" : "✕"}
                    </span>
                    <p className="text-slate-300 mt-0.5">
                      {new Date(op.created_at).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-4">Быстрые действия</h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            {
              label: "Создать карточку НК",
              link: "/catalog",
              icon: "📋",
              color: "hover:bg-emerald-50 hover:border-emerald-200",
            },
            {
              label: "Заказать КМ",
              link: "/orders",
              icon: "📤",
              color: "hover:bg-blue-50 hover:border-blue-200",
            },
            {
              label: "Печать этикеток",
              link: "/labels",
              icon: "🖨️",
              color: "hover:bg-purple-50 hover:border-purple-200",
            },
            {
              label: "Вывести из оборота",
              link: "/operations",
              icon: "📦",
              color: "hover:bg-red-50 hover:border-red-200",
            },
            {
              label: "Создать УПД",
              link: "/upd",
              icon: "📄",
              color: "hover:bg-amber-50 hover:border-amber-200",
            },
          ].map((action) => (
            <Link
              key={action.label}
              to={action.link}
              className={`flex flex-col items-center gap-2 p-4 border border-slate-200 rounded-xl text-center text-sm text-slate-600 transition-colors ${action.color}`}
            >
              <span className="text-2xl">{action.icon}</span>
              <span className="text-xs leading-tight">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
