import ClusterPage from './content/ClusterPage';
import DocumentationPage from './content/DocumentationPage';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './login/AuthContext';
import LoginPage from './login/LoginPage';
import RegisterPage from './login/RegisterPage';

import DashboardPage from './content/DashboardPage';
import ProjectDetailPage from './content/ProjectDetailPage';
import AdminPage from './content/AdminPage';
import Layout from './Layout';
import ProtectedRoute from './login/ProtectedRoute';
import AdminRoute from './login/AdminRoute';
import ToastProvider from './shared/ToastProvider';

export default function App() {
  const protectedLayout = (
    <ProtectedRoute>
      <Layout />
    </ProtectedRoute>
  );
  const clusterPage = (
    <AdminRoute>
      <ClusterPage />
    </AdminRoute>
  );
  const platformProjectsPage = (
    <AdminRoute>
      <AdminPage />
    </AdminRoute>
  );

  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={protectedLayout}>
              <Route index element={<DashboardPage />} />
              <Route path="documentacion" element={<DocumentationPage />} />
              <Route path="como-desplegar" element={<Navigate to="/documentacion" replace />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="admin" element={clusterPage} />
              <Route path="admin/projects" element={platformProjectsPage} />
            </Route>
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
