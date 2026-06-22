import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import apiClient from "../api/client";

interface User {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  status: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(
    localStorage.getItem("auth_token"),
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (token) {
      apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      apiClient
        .get("/auth/me")
        .then((res) => setUser(res.data))
        .catch(() => {
          localStorage.removeItem("auth_token");
          setToken(null);
          delete apiClient.defaults.headers.common["Authorization"];
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [token]);

  async function login(username: string, password: string) {
    const res = await apiClient.post("/auth/login", { username, password });
    const { access_token } = res.data;
    localStorage.setItem("auth_token", access_token);
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
    setToken(access_token);
    const me = await apiClient.get("/auth/me");
    setUser(me.data);
  }

  async function register(username: string, password: string, email?: string) {
    const res = await apiClient.post("/auth/register", {
      username,
      password,
      email,
    });
    const { access_token } = res.data;
    localStorage.setItem("auth_token", access_token);
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
    setToken(access_token);
    const me = await apiClient.get("/auth/me");
    setUser(me.data);
  }

  function logout() {
    localStorage.removeItem("auth_token");
    delete apiClient.defaults.headers.common["Authorization"];
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAdmin: user?.role === "admin",
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
