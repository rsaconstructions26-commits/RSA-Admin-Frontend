import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ALLOW_CROSS_ROLE, extractRole, portalIdForRole, roleBelongsHere } from './portalSession.js';
import WrongPortalNotice from './components/common/WrongPortalNotice.jsx';
import Layout from './components/Layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './components/Dashboard/Dashboard.jsx';
import ManagerDashboard from './components/Dashboard/ManagerDashboard.jsx';
import DeliveryNoteList from './components/DeliveryNote/DeliveryNoteList.jsx';
import DeliveryNoteForm from './components/DeliveryNote/DeliveryNoteForm.jsx';
import DeliveryNotePrint from './components/DeliveryNote/DeliveryNotePrint.jsx';
import MaterialLedger from './components/MaterialLedger/MaterialLedger.jsx';
import LabourPage from './components/Labour/LabourPage.jsx';
import VoucherPage from './components/Voucher/VoucherPage.jsx';
import VoucherPrint from './components/Voucher/VoucherPrint.jsx';
import StockView from './components/MaterialLedger/StockView.jsx';
import Reports from './components/Reports/Reports.jsx';
// Item 2 (2026-09-15): Clients now has its own route, no longer a tab inside Reports.
import ClientsPage from './components/Clients/ClientsPage.jsx';
import SuperadminPanel from './components/Superadmin/SuperadminPanel.jsx';
import CustomModulePage from './components/CustomModule/CustomModulePage.jsx';

// Every authenticated route in this portal passes through here, so this is
// the one place that needs to enforce "these credentials belong to this
// portal". Previously it only checked that *someone* was logged in, which
// is why an account belonging to the other portal could sign in and be
// shown this one - the two portals' credentials effectively collapsed into
// whichever site the browser happened to be on.
//
// Set VITE_ALLOW_CROSS_ROLE=true to restore the old lenient behaviour,
// where a manager reaching the Admin portal is degraded to the
// Labour-only experience (DashboardRoute / AdminOnlyRoute below) instead
// of being turned away. Off by default.
function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const role = extractRole(user);
  if (!ALLOW_CROSS_ROLE && !roleBelongsHere(role)) {
    return <WrongPortalNotice role={role} belongsTo={portalIdForRole(role)} />;
  }

  return children;
}

// One app, two experiences by login role (see the matching nav restriction
// in Layout.jsx's useTabs()). A 'manager' account only ever gets Dashboard +
// Labour - hitting one of these routes directly by URL bounces to /dashboard
// exactly like the Superadmin guard below, so the restriction isn't just a
// hidden nav link. Every other role (admin, staff, or a superadmin) is
// unaffected and reaches these exactly as before. Frontend-only: this does
// not change what the backend accepts from a manager's token.
function AdminOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (portalIdForRole(extractRole(user)) === 'manager') return <Navigate to="/dashboard" replace />;
  return children;
}

// Superadmin is a hidden layer on top of PrivateRoute - reached only via the
// 5-click logo gesture in the sidebar, and only functional for the one flag
// (isSuperAdmin) set directly in the database. Anyone else hitting this URL
// directly gets bounced back to the dashboard with no error message, so the
// feature's existence isn't advertised.
function SuperadminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.isSuperAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

// Renders the Labour-focused dashboard for a manager login and the existing
// full billing/stock dashboard for everyone else. Dashboard.jsx itself is
// completely untouched - this just picks which sibling component mounts at
// /dashboard, based on role.
// NOTE: with the default settings a manager account no longer reaches this
// portal at all (PrivateRoute turns it away), so this branch and the
// AdminOnlyRoute redirect above are only live when VITE_ALLOW_CROSS_ROLE is
// set to true. They are kept intact so flipping that flag restores the old
// behaviour exactly, with no code change.
function DashboardRoute() {
  const { user } = useAuth();
  return portalIdForRole(extractRole(user)) === 'manager' ? <ManagerDashboard /> : <Dashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Print views render standalone (no nav chrome) so window.print()/Save-as-PDF is clean */}
      <Route
        path="/billing/:id/print"
        element={
          <PrivateRoute>
            <AdminOnlyRoute>
              <DeliveryNotePrint />
            </AdminOnlyRoute>
          </PrivateRoute>
        }
      />

      <Route
        path="/voucher/:id/print"
        element={
          <PrivateRoute>
            <AdminOnlyRoute>
              <VoucherPrint />
            </AdminOnlyRoute>
          </PrivateRoute>
        }
      />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardRoute />} />
        <Route
          path="billing"
          element={
            <AdminOnlyRoute>
              <DeliveryNoteList />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="billing/new"
          element={
            <AdminOnlyRoute>
              <DeliveryNoteForm />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="billing/:id/edit"
          element={
            <AdminOnlyRoute>
              <DeliveryNoteForm />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="materials"
          element={
            <AdminOnlyRoute>
              <MaterialLedger />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="voucher"
          element={
            <AdminOnlyRoute>
              <VoucherPage />
            </AdminOnlyRoute>
          }
        />
        <Route path="labour" element={<LabourPage />} />
        <Route
          path="stock"
          element={
            <AdminOnlyRoute>
              <StockView />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="reports"
          element={
            <AdminOnlyRoute>
              <Reports />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="clients"
          element={
            <AdminOnlyRoute>
              <ClientsPage />
            </AdminOnlyRoute>
          }
        />
        {/* Any tab created in the Superadmin Portal's Module Builder that isn't
            one of the built-in screens above renders here, driven entirely by
            that module's field definitions - no code change needed per tab. */}
        <Route path="m/:moduleKey" element={<CustomModulePage />} />
        <Route
          path="superadmin"
          element={
            <SuperadminRoute>
              <SuperadminPanel />
            </SuperadminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
