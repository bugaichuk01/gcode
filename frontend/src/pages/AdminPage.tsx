import { useEffect, useState } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import apiClient from "../api/client";
import { useAuth } from "../contexts/AuthContext";

// ========================
// ДАШБОРД
// ========================

function AdminDashboard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get("/admin/dashboard")
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-slate-400">Загрузка...</div>;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Дашборд</h2>

      {/* Карточки статистики */}
      <div className="grid grid-cols-4 gap-4">
        {[
          {
            label: "Всего пользователей",
            value: data.users.total,
            sub: `${data.users.active} активных`,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: "Организаций",
            value: data.organizations.total,
            sub: `${data.organizations.active} активных`,
            color: "text-emerald-600",
            bg: "bg-emerald-50",
          },
          {
            label: "Операций сегодня",
            value: data.operations.today,
            sub: `${data.operations.errors_today} ошибок`,
            color: "text-indigo-600",
            bg: "bg-indigo-50",
          },
          {
            label: "Операций за месяц",
            value: data.operations.month,
            sub: `${data.operations.week} за неделю`,
            color: "text-amber-600",
            bg: "bg-amber-50",
          },
        ].map(card => (
          <div
            key={card.label}
            className={`${card.bg} rounded-xl p-5 border border-slate-200`}
          >
            <p className="text-xs text-slate-500">{card.label}</p>
            <p className={`text-3xl font-bold mt-1 ${card.color}`}>
              {card.value}
            </p>
            <p className="text-xs text-slate-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* График активности */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-700 mb-4">
          Активность за 7 дней
        </h3>
        <div className="flex items-end gap-2 h-32">
          {data.activity_chart.map((day: any) => {
            const max = Math.max(...data.activity_chart.map((d: any) => d.count), 1);
            const height = (day.count / max) * 100;
            return (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-slate-500">{day.count}</span>
                <div
                  className="w-full bg-blue-500 rounded-t"
                  style={{ height: `${height}%`, minHeight: day.count > 0 ? "4px" : "0" }}
                />
                <span className="text-xs text-slate-400">{day.date}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Топ операций */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-3">
            Топ операций (30 дней)
          </h3>
          <div className="space-y-2">
            {data.top_operations.map((op: any) => (
              <div key={op.type} className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  {OP_LABELS[op.type] || op.type}
                </span>
                <span className="text-sm font-medium text-slate-800">
                  {op.count}
                </span>
              </div>
            ))}
            {data.top_operations.length === 0 && (
              <p className="text-sm text-slate-400">Нет операций</p>
            )}
          </div>
        </div>

        {/* Последние ошибки */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-700 mb-3">
            Последние ошибки
          </h3>
          <div className="space-y-2">
            {data.recent_errors.map((err: any) => (
              <div
                key={err.id}
                className="text-xs p-2 bg-red-50 rounded border border-red-100"
              >
                <div className="font-medium text-red-700">
                  {OP_LABELS[err.operation_type] || err.operation_type}
                </div>
                <div
                  className="text-red-500 truncate cursor-help"
                  title={err.error_message}
                >
                  {err.error_message}
                </div>
                <div className="text-slate-400 mt-0.5">
                  {new Date(err.created_at).toLocaleString("ru-RU")}
                </div>
              </div>
            ))}
            {data.recent_errors.length === 0 && (
              <p className="text-sm text-slate-400">Ошибок нет 🎉</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const OP_LABELS: Record<string, string> = {
  order_created: "Заказ СУЗ",
  codes_downloaded: "Скачивание КМ",
  withdrawal_sent: "Вывод из оборота",
  utilisation_sent: "Ввод в оборот",
  aggregation_sent: "Агрегация КИТУ",
  return_sent: "Возврат в оборот",
  label_printed: "Печать этикеток",
  upd_created: "УПД",
  cis_checked: "Проверка КМ",
  token_updated: "Обновление токена",
};

// ========================
// ПОЛЬЗОВАТЕЛИ
// ========================

function AdminUsers() {
  const [users, setUsers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // Создание пользователя
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newEmail, setNewEmail] = useState("");

  async function load() {
    setLoading(true);
    const params: any = { limit: 50, offset: 0 };
    if (search) params.search = search;
    if (filterRole) params.role = filterRole;
    if (filterStatus) params.status = filterStatus;
    const res = await apiClient.get("/admin/users", { params });
    setUsers(res.data.items);
    setTotal(res.data.total);
    setLoading(false);
  }

  useEffect(() => { load(); }, [filterRole, filterStatus]);

  async function handleStatusToggle(user: any) {
    const newStatus = user.status === "active" ? "blocked" : "active";
    await apiClient.patch(`/admin/users/${user.id}/status`, { status: newStatus });
    load();
  }

  async function handleRoleChange(user: any, role: string) {
    await apiClient.patch(`/admin/users/${user.id}/role`, { role });
    load();
  }

  async function handleDelete(userId: string) {
    if (!confirm("Удалить пользователя? Все его данные будут удалены.")) return;
    await apiClient.delete(`/admin/users/${userId}`);
    load();
  }

  async function handleCreate() {
    if (!newUsername || !newPassword) return;
    await apiClient.post("/admin/users", {
      username: newUsername,
      password: newPassword,
      email: newEmail || null,
      role: newRole,
    });
    setShowCreate(false);
    setNewUsername(""); setNewPassword(""); setNewEmail(""); setNewRole("user");
    load();
  }

  async function loadUserDetail(userId: string) {
    const res = await apiClient.get(`/admin/users/${userId}`);
    setSelectedUser(res.data);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800">
          Пользователи ({total})
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          + Создать пользователя
        </button>
      </div>

      {/* Форма создания */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
          <h3 className="font-semibold mb-4">Новый пользователь</h3>
          <div className="grid grid-cols-4 gap-3">
            <input
              placeholder="Логин *"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              type="password"
              placeholder="Пароль *"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <input
              placeholder="Email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <option value="user">Пользователь</option>
              <option value="admin">Администратор</option>
            </select>
          </div>
          <div className="flex gap-3 mt-3">
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
            >
              Создать
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Фильтры */}
      <div className="flex gap-3 mb-4">
        <input
          placeholder="Поиск по логину или email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">Все роли</option>
          <option value="admin">Администратор</option>
          <option value="user">Пользователь</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">Все статусы</option>
          <option value="active">Активные</option>
          <option value="blocked">Заблокированные</option>
        </select>
        <button
          onClick={load}
          className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm"
        >
          Найти
        </button>
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Логин</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Роль</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Статус</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Орг.</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Последний вход</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Действия</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Загрузка...
                </td>
              </tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">
                  <button
                    onClick={() => loadUserDetail(u.id)}
                    className="text-blue-600 hover:underline"
                  >
                    {u.username}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-500">{u.email || "—"}</td>
                <td className="px-4 py-3">
                  <select
                    value={u.role}
                    onChange={e => handleRoleChange(u, e.target.value)}
                    className="text-xs px-2 py-1 border border-slate-300 rounded"
                  >
                    <option value="user">Пользователь</option>
                    <option value="admin">Администратор</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    u.status === "active"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}>
                    {u.status === "active" ? "Активен" : "Заблокирован"}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">{u.org_count}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {u.last_login_at
                    ? new Date(u.last_login_at).toLocaleString("ru-RU")
                    : "Не входил"
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleStatusToggle(u)}
                      className={`px-2 py-1 text-xs rounded ${
                        u.status === "active"
                          ? "bg-red-50 text-red-600 hover:bg-red-100"
                          : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      }`}
                    >
                      {u.status === "active" ? "Блок" : "Разблок"}
                    </button>
                    <button
                      onClick={() => handleDelete(u.id)}
                      className="px-2 py-1 text-xs text-red-400 hover:bg-red-50 rounded"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Детали пользователя (модальное окно) */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-10 overflow-auto">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl shadow-2xl mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">
                Профиль: {selectedUser.username}
              </h3>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 hover:text-slate-600 text-xl"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
              <div>
                <p className="text-slate-500">Роль</p>
                <p className="font-medium">{selectedUser.role}</p>
              </div>
              <div>
                <p className="text-slate-500">Статус</p>
                <p className="font-medium">{selectedUser.status}</p>
              </div>
              <div>
                <p className="text-slate-500">Email</p>
                <p className="font-medium">{selectedUser.email || "—"}</p>
              </div>
              <div>
                <p className="text-slate-500">Последний вход</p>
                <p className="font-medium">
                  {selectedUser.last_login_at
                    ? new Date(selectedUser.last_login_at).toLocaleString("ru-RU")
                    : "Не входил"
                  }
                </p>
              </div>
            </div>

            <h4 className="font-semibold mb-2">
              Организации ({selectedUser.organizations?.length || 0})
            </h4>
            <div className="space-y-1 mb-4">
              {selectedUser.organizations?.map((org: any) => (
                <div
                  key={org.id}
                  className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded"
                >
                  <span className="text-sm">{org.name}</span>
                  <span className="text-xs text-slate-400">ИНН: {org.inn || "—"}</span>
                  <span className={`text-xs ${
                    org.is_active ? "text-emerald-600" : "text-red-500"
                  }`}>
                    {org.is_active ? "Активна" : "Неактивна"}
                  </span>
                </div>
              ))}
            </div>

            <h4 className="font-semibold mb-2">
              Последние операции
            </h4>
            <div className="space-y-1 max-h-48 overflow-auto">
              {selectedUser.recent_operations?.map((op: any) => (
                <div
                  key={op.id}
                  className="flex items-center justify-between px-3 py-1.5 bg-slate-50 rounded text-xs"
                >
                  <span>{OP_LABELS[op.type] || op.type}</span>
                  <span className={
                    op.status === "success"
                      ? "text-emerald-600"
                      : "text-red-600"
                  }>
                    {op.status}
                  </span>
                  <span className="text-slate-400">
                    {new Date(op.created_at).toLocaleString("ru-RU")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ========================
// ОРГАНИЗАЦИИ
// ========================

function AdminOrganizations() {
  const [orgs, setOrgs] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  async function load() {
    const params: any = {};
    if (search) params.search = search;
    const res = await apiClient.get("/admin/organizations", { params });
    setOrgs(res.data.items);
  }

  useEffect(() => { load(); }, []);

  async function toggleStatus(org: any) {
    await apiClient.patch(
      `/admin/organizations/${org.id}/status`,
      { is_active: !org.is_active }
    );
    load();
  }

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-slate-800 mb-6">Организации</h2>
      <div className="flex gap-3 mb-4">
        <input
          placeholder="Поиск по названию или ИНН..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()}
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
        <button
          onClick={load}
          className="px-4 py-2 bg-slate-600 text-white rounded-lg text-sm"
        >
          Найти
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Название</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">ИНН</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">OMS ID</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Владелец</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Статус</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Действия</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map(org => (
              <tr key={org.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{org.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{org.inn || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {org.oms_id
                    ? org.oms_id.slice(0, 8) + "..."
                    : "—"
                  }
                </td>
                <td className="px-4 py-3 text-blue-600">{org.owner_username}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    org.is_active
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}>
                    {org.is_active ? "Активна" : "Неактивна"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleStatus(org)}
                    className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
                  >
                    {org.is_active ? "Деактивировать" : "Активировать"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ========================
// ТОКЕНЫ
// ========================

function AdminTokens() {
  const [tokens, setTokens] = useState<any[]>([]);

  useEffect(() => {
    apiClient.get("/admin/tokens").then(r => setTokens(r.data));
  }, []);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-slate-800 mb-6">
        Статус токенов
      </h2>
      <div className="space-y-3">
        {tokens.map(t => (
          <div
            key={t.id}
            className={`bg-white rounded-xl border p-4 ${
              t.suz_is_expired ? "border-red-300" : "border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">
                  {t.oms_connection_id
                    ? `Соединение: ${t.oms_connection_id.slice(0, 8)}...`
                    : "Токен"}
                </p>
                <p className="text-xs text-slate-400">
                  Обновлён:{" "}
                  {t.updated_at
                    ? new Date(t.updated_at).toLocaleString("ru-RU")
                    : "—"
                  }
                </p>
              </div>
              <div className="text-right text-xs space-y-1">
                <div className={
                  t.suz_is_expired ? "text-red-600" :
                  (t.suz_expires_in_minutes ?? 999) < 60
                    ? "text-amber-600"
                    : "text-emerald-600"
                }>
                  СУЗ:{" "}
                  {t.suz_expires_in_minutes !== null
                    ? `${t.suz_expires_in_minutes} мин`
                    : "не задан"
                  }
                </div>
                <div className={
                  t.true_api_configured
                    ? (t.true_api_expires_in_minutes ?? 999) < 60
                      ? "text-amber-600"
                      : "text-emerald-600"
                    : "text-red-600"
                }>
                  True API:{" "}
                  {t.true_api_configured
                    ? t.true_api_expires_in_minutes !== null
                      ? `${t.true_api_expires_in_minutes} мин`
                      : "настроен"
                    : "не настроен"
                  }
                </div>
              </div>
            </div>
          </div>
        ))}
        {tokens.length === 0 && (
          <p className="text-slate-400 text-center py-8">
            Нет настроенных токенов
          </p>
        )}
      </div>
    </div>
  );
}

// ========================
// ЖУРНАЛ (ADMIN)
// ========================

function AdminJournal() {
  const [entries, setEntries] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get("/admin/users", { params: { limit: 200 } })
      .then(r => setUsers(r.data.items));
  }, []);

  async function load() {
    setLoading(true);
    const params: any = { limit: 100 };
    if (filterUser) params.user_id = filterUser;
    if (filterType) params.operation_type = filterType;
    if (filterStatus) params.status = filterStatus;
    const res = await apiClient.get("/admin/journal", { params });
    setEntries(res.data.items);
    setLoading(false);
  }

  useEffect(() => { load(); }, [filterUser, filterType, filterStatus]);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-slate-800 mb-6">
        Журнал всех операций
      </h2>

      <div className="flex gap-3 mb-4">
        <select
          value={filterUser}
          onChange={e => setFilterUser(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">Все пользователи</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">Все операции</option>
          {Object.entries(OP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
        >
          <option value="">Все статусы</option>
          <option value="success">Успешно</option>
          <option value="error">Ошибка</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Дата</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Операция</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Статус</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Описание</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Кодов</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Загрузка...
                </td>
              </tr>
            ) : entries.map(e => (
              <tr
                key={e.id}
                className={`border-b border-slate-100 hover:bg-slate-50 ${
                  e.status === "error" ? "bg-red-50/30" : ""
                }`}
              >
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {new Date(e.created_at).toLocaleString("ru-RU")}
                </td>
                <td className="px-4 py-3 text-xs font-medium">
                  {OP_LABELS[e.operation_type] || e.operation_type}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    e.status === "success"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}>
                    {e.status === "success" ? "OK" : "Ошибка"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">
                  <div>{e.description}</div>
                  {e.error_message && (
                    <div className="text-red-500 text-xs truncate max-w-xs">
                      {e.error_message}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-xs">
                  {e.codes_count ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ========================
// ГЛАВНЫЙ КОМПОНЕНТ ADMINPAGE
// ========================

const ADMIN_NAV = [
  { path: "", label: "Дашборд", icon: "📊" },
  { path: "users", label: "Пользователи", icon: "👥" },
  { path: "organizations", label: "Организации", icon: "🏢" },
  { path: "journal", label: "Журнал операций", icon: "📋" },
  { path: "tokens", label: "Токены", icon: "🔑" },
];

export default function AdminPage() {
  const { user } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Боковая панель */}
      <div className="w-56 bg-slate-900 text-white flex flex-col">
        <div className="p-4 border-b border-slate-700">
          <h1 className="font-bold text-sm">G-CODE Admin</h1>
          <p className="text-xs text-slate-400 mt-0.5">{user?.username}</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {ADMIN_NAV.map(item => {
            const href = `/admin${item.path ? "/" + item.path : ""}`;
            const isActive = item.path === ""
              ? location.pathname === "/admin"
              : location.pathname.startsWith(href);
            return (
              <Link
                key={item.path}
                to={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-700">
          <Link
            to="/"
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
          >
            ← Вернуться в систему
          </Link>
        </div>
      </div>

      {/* Контент */}
      <div className="flex-1 overflow-auto">
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="organizations" element={<AdminOrganizations />} />
          <Route path="journal" element={<AdminJournal />} />
          <Route path="tokens" element={<AdminTokens />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </div>
    </div>
  );
}
