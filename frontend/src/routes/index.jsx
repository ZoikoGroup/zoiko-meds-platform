import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/layouts/app-layout'
import { UserLayout } from '@/layouts/user-layout'
import { AdminProtectedRoute, UserProtectedRoute, PublicRoute } from '@/routes/protected-route'
import { navSections, routeMeta } from '@/routes/navigation'

// Prefix all Super Admin sidebar links dynamically at runtime with '/admin'
navSections.forEach(section => {
  section.items.forEach(item => {
    if (item.to.startsWith('/') && !item.to.startsWith('/admin')) {
      item.to = `/admin${item.to}`;
    }
  });
});

// Prefix all routeMeta keys dynamically at runtime
Object.keys(routeMeta).forEach(key => {
  if (key.startsWith('/') && !key.startsWith('/admin')) {
    const val = routeMeta[key];
    delete routeMeta[key];
    routeMeta[`/admin${key}`] = val;
  }
});

// Super Admin page chunks
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const PharmacyManagement = lazy(() => import('@/pages/PharmacyManagement'))
const UsersRoles = lazy(() => import('@/pages/UsersRoles'))
const VerificationCenter = lazy(() => import('@/pages/VerificationCenter'))
const ZoikoSignal = lazy(() => import('@/pages/ZoikoSignal'))
const ZoikoAvail = lazy(() => import('@/pages/ZoikoAvail'))
const MediBase = lazy(() => import('@/pages/MediBase'))
const Reports = lazy(() => import('@/pages/Reports'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const AuditLogs = lazy(() => import('@/pages/AuditLogs'))
const Settings = lazy(() => import('@/pages/Settings'))

// User Portal page chunks
const UserHome = lazy(() => import('@/pages/UserHome'))
const UserSearch = lazy(() => import('@/pages/UserSearch'))
const UserSaved = lazy(() => import('@/pages/UserSaved'))
const UserAlerts = lazy(() => import('@/pages/UserAlerts'))
const UserProfile = lazy(() => import('@/pages/UserProfile'))
const UserSettings = lazy(() => import('@/pages/UserSettings'))

const Login = lazy(() => import('@/pages/Login'))
const Register = lazy(() => import('@/pages/Register'))
const NotFound = lazy(() => import('@/pages/NotFound'))

export const router = createBrowserRouter([
  // Public routes (only accessible when not logged in)
  {
    element: <PublicRoute />,
    children: [
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
    ],
  },
  // Super Admin routes (under /admin)
  {
    path: 'admin',
    element: <AdminProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'pharmacies', element: <PharmacyManagement /> },
          { path: 'users', element: <UsersRoles /> },
          { path: 'verification', element: <VerificationCenter /> },
          { path: 'zoikosignal', element: <ZoikoSignal /> },
          { path: 'zoikoavail', element: <ZoikoAvail /> },
          { path: 'medibase', element: <MediBase /> },
          { path: 'reports', element: <Reports /> },
          { path: 'notifications', element: <Notifications /> },
          { path: 'audit-logs', element: <AuditLogs /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
  // Root: the login page is the front door.
  // PublicRoute forwards an already-signed-in user on to their portal.
  {
    path: '/',
    element: <Navigate to="/login" replace />
  },
  // User Portal routes
  {
    element: <UserProtectedRoute />,
    children: [
      {
        element: <UserLayout />,
        children: [
          { path: 'dashboard', element: <UserHome /> },
          { path: 'search', element: <UserSearch /> },
          { path: 'saved', element: <UserSaved /> },
          { path: 'alerts', element: <UserAlerts /> },
          { path: 'profile', element: <UserProfile /> },
          { path: 'settings', element: <UserSettings /> },
        ],
      },
    ],
  },
  // Fallback route
  { path: '*', element: <NotFound /> },
])
