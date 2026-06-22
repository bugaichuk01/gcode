import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute, AdminRoute } from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import AdminPage from "./pages/AdminPage";
import CardsPage from "./pages/CardsPage";
import CodesPage from "./pages/CodesPage";
import ExtraFieldsPage from "./pages/ExtraFieldsPage";
import LabelsPage from "./pages/LabelsPage";
import LabelDesignerPage from "./pages/LabelDesignerPage";
import OrdersPage from "./pages/OrdersPage";
import ProductsPage from "./pages/ProductsPage";
import SettingsPage from "./pages/SettingsPage";
import UpdPage from "./pages/UpdPage";
import UtilisationPage from "./pages/UtilisationPage";
import WithdrawalPage from "./pages/WithdrawalPage";
import ReturnPage from "./pages/ReturnPage";
import AggregationPage from "./pages/AggregationPage";
import OperationsPage from "./pages/OperationsPage";
import JournalPage from "./pages/JournalPage";
import DashboardPage from "./pages/DashboardPage";
import RemainsPage from "./pages/RemainsPage";
import IncomingUPDPage from "./pages/IncomingUPDPage";
import MarketplacePage from "./pages/MarketplacePage";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="catalog" element={<CardsPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="labels" element={<LabelsPage />} />
            <Route path="label-designer" element={<LabelDesignerPage />} />
            <Route path="codes" element={<CodesPage />} />
            <Route path="operations" element={<OperationsPage />} />
            <Route path="upd" element={<UpdPage />} />
            <Route path="incoming-upd" element={<IncomingUPDPage />} />
            <Route path="utilisation" element={<UtilisationPage />} />
            <Route path="withdrawal" element={<WithdrawalPage />} />
            <Route path="returns" element={<ReturnPage />} />
            <Route path="remains" element={<RemainsPage />} />
            <Route path="aggregation" element={<AggregationPage />} />
            <Route path="extra-fields" element={<ExtraFieldsPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="marketplace" element={<MarketplacePage />} />
          </Route>

          <Route
            path="/admin/*"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
