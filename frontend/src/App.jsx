import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import MembersPage from './pages/MembersPage';
import PlansPage from './pages/PlansPage';
import ClassesPage from './pages/ClassesPage';
import TrainersPage from './pages/TrainersPage';
import AttendancePage from './pages/AttendancePage';
import PaymentsPage from './pages/PaymentsPage';
import EquipmentPage from './pages/EquipmentPage';
import SettingsPage from './pages/SettingsPage';
import TrialsPage from './pages/TrialsPage';
import FinancePage from './pages/FinancePage';
import CheckInPage from './pages/CheckInPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/check-in/:slug" element={<CheckInPage />} />

          {/* Authenticated App Shell */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route
              path="/members"
              element={
                <ProtectedRoute roles={['admin', 'staff']}>
                  <MembersPage />
                </ProtectedRoute>
              }
            />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/classes" element={<ClassesPage />} />
            <Route path="/trainers" element={<TrainersPage />} />
            <Route
              path="/attendance"
              element={
                <ProtectedRoute roles={['admin', 'staff', 'trainer']}>
                  <AttendancePage />
                </ProtectedRoute>
              }
            />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/settings" element={<ProtectedRoute roles={['admin']}><SettingsPage /></ProtectedRoute>} />
            <Route path="/trials" element={<ProtectedRoute roles={['admin','staff']}><TrialsPage /></ProtectedRoute>} />
            <Route path="/finance" element={<ProtectedRoute roles={['admin','staff']}><FinancePage /></ProtectedRoute>} />
            <Route
              path="/equipment"
              element={
                <ProtectedRoute roles={['admin', 'staff', 'trainer']}>
                  <EquipmentPage />
                </ProtectedRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
