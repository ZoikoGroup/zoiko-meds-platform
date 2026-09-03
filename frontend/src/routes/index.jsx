import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/layouts/app-layout'
import { UserLayout } from '@/layouts/user-layout'
import { PharmacyLayout } from '@/layouts/pharmacy-layout'
import { AdminProtectedRoute, UserProtectedRoute, PharmacyProtectedRoute, PublicRoute } from '@/routes/protected-route'
import { navSections, routeMeta } from '@/routes/navigation'
import { lazyImport } from '@/lib/lazy-import'
import { RouteErrorBoundary } from '@/components/shared/error-boundary'

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
const Dashboard = lazyImport(() => import('@/pages/Dashboard'), 'Dashboard')
const Governance = lazyImport(() => import('@/pages/Governance'), 'Governance')
const PharmacyManagement = lazyImport(() => import('@/pages/PharmacyManagement'), 'PharmacyManagement')
const UsersRoles = lazyImport(() => import('@/pages/UsersRoles'), 'UsersRoles')
const VerificationCenter = lazyImport(() => import('@/pages/VerificationCenter'), 'VerificationCenter')
const ZoikoSignal = lazyImport(() => import('@/pages/ZoikoSignal'), 'ZoikoSignal')
const ZoikoAvail = lazyImport(() => import('@/pages/ZoikoAvail'), 'ZoikoAvail')
const ZoikoAvailSandbox = lazyImport(() => import('@/pages/ZoikoAvailSandbox'), 'ZoikoAvailSandbox')
const MediBase = lazyImport(() => import('@/pages/MediBase'), 'MediBase')
const MediBaseReview = lazyImport(() => import('@/pages/MediBaseReview'), 'MediBaseReview')
const Reports = lazyImport(() => import('@/pages/Reports'), 'Reports')
const Notifications = lazyImport(() => import('@/pages/Notifications'), 'Notifications')
const AuditLogs = lazyImport(() => import('@/pages/AuditLogs'), 'AuditLogs')
const Settings = lazyImport(() => import('@/pages/Settings'), 'Settings')
const Commercial = lazyImport(() => import('@/pages/Commercial'), 'Commercial')

// User Portal page chunks
const UserHome = lazyImport(() => import('@/pages/UserHome'), 'UserHome')
const UserSearch = lazyImport(() => import('@/pages/UserSearch'), 'UserSearch')
const Availability = lazyImport(() => import('@/pages/Availability'), 'Availability')
const MedicineDetail = lazyImport(() => import('@/pages/MedicineDetail'), 'MedicineDetail')
const UserSaved = lazyImport(() => import('@/pages/UserSaved'), 'UserSaved')
const UserSignal = lazyImport(() => import('@/pages/UserSignal'), 'UserSignal')
const UserNotifications = lazyImport(() => import('@/pages/UserNotifications'), 'UserNotifications')
const UserProfile = lazyImport(() => import('@/pages/UserProfile'), 'UserProfile')
const UserSettings = lazyImport(() => import('@/pages/UserSettings'), 'UserSettings')

// Pharmacy Portal page chunks
const PharmacyDashboard = lazyImport(() => import('@/pages/pharmacy/PharmacyDashboard'), 'PharmacyDashboard')
const PharmacyInventory = lazyImport(() => import('@/pages/pharmacy/PharmacyInventory'), 'PharmacyInventory')
const PharmacyAvailability = lazyImport(() => import('@/pages/pharmacy/PharmacyAvailability'), 'PharmacyAvailability')
const PharmacyUpload = lazyImport(() => import('@/pages/pharmacy/PharmacyUpload'), 'PharmacyUpload')
const PharmacyIntegration = lazyImport(() => import('@/pages/pharmacy/PharmacyIntegration'), 'PharmacyIntegration')
const PharmacyParticipation = lazyImport(() => import('@/pages/pharmacy/PharmacyParticipation'), 'PharmacyParticipation')
const PharmacyReports = lazyImport(() => import('@/pages/pharmacy/PharmacyReports'), 'PharmacyReports')
const PharmacyNotifications = lazyImport(() => import('@/pages/pharmacy/PharmacyNotifications'), 'PharmacyNotifications')
const PharmacyProfile = lazyImport(() => import('@/pages/pharmacy/PharmacyProfile'), 'PharmacyProfile')
const PharmacySettings = lazyImport(() => import('@/pages/pharmacy/PharmacySettings'), 'PharmacySettings')
const PharmacyBilling = lazyImport(() => import('@/pages/pharmacy/PharmacyBilling'), 'PharmacyBilling')

import Login from '@/pages/Login'
import Register from '@/pages/Register'
const ForgotPassword = lazyImport(() => import('@/pages/ForgotPassword'), 'ForgotPassword')
const ResetPassword = lazyImport(() => import('@/pages/ResetPassword'), 'ResetPassword')
const AuthCallback = lazyImport(() => import('@/pages/AuthCallback'), 'AuthCallback')
const VerifyLogin = lazyImport(() => import('@/pages/VerifyLogin'), 'VerifyLogin')
const NotFound = lazyImport(() => import('@/pages/NotFound'), 'NotFound')

export const router = createBrowserRouter([
  // Public routes (only accessible when not logged in)
  {
    element: <PublicRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
    ],
  },
  // Password recovery — always reachable, session or not. These are the landing
  // pages for emailed reset/invite links, so a stale session in the browser must
  // not bounce the visitor to a portal before they can set a new password.
  { path: 'forgot-password', element: <ForgotPassword />, errorElement: <RouteErrorBoundary /> },
  { path: 'reset-password', element: <ResetPassword />, errorElement: <RouteErrorBoundary /> },
  // Super Admin routes (under /admin)
  {
    path: 'admin',
    element: <AdminProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <Dashboard /> },
          { path: 'governance', element: <Governance /> },
          { path: 'pharmacies', element: <PharmacyManagement /> },
          { path: 'users', element: <UsersRoles /> },
          { path: 'verification', element: <VerificationCenter /> },
          { path: 'zoikosignal', element: <ZoikoSignal /> },
          { path: 'zoikoavail', element: <ZoikoAvail /> },
          { path: 'zoikoavail/sandbox', element: <ZoikoAvailSandbox /> },
          { path: 'medibase', element: <MediBase /> },
          { path: 'medibase/review', element: <MediBaseReview /> },
          { path: 'reports', element: <Reports /> },
          { path: 'notifications', element: <Notifications /> },
          { path: 'audit-logs', element: <AuditLogs /> },
          { path: 'commercial', element: <Commercial /> },
          { path: 'settings', element: <Settings /> },
        ],
      },
    ],
  },
  // OAuth landing
  { path: 'auth/callback', element: <AuthCallback />, errorElement: <RouteErrorBoundary /> },
  // Where an emailed sign-in link lands. Public, because it is the call that
  // produces the session — requiring one to reach it would be circular (MSA-42).
  { path: 'auth/verify-login', element: <VerifyLogin />, errorElement: <RouteErrorBoundary /> },
  { path: '/', element: <Navigate to="/login" replace /> },
  // User Portal routes
  {
    element: <UserProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <UserLayout />,
        children: [
          { path: 'dashboard', element: <UserHome /> },
          { path: 'search', element: <UserSearch /> },
          { path: 'availability', element: <Availability /> },
          { path: 'medicine/:id', element: <MedicineDetail /> },
          { path: 'saved', element: <UserSaved /> },
          { path: 'signal', element: <UserSignal /> },
          { path: 'notifications', element: <UserNotifications /> },
          { path: 'alerts', element: <Navigate to="/signal" replace /> },
          { path: 'profile', element: <UserProfile /> },
          { path: 'settings', element: <UserSettings /> },
        ],
      },
    ],
  },
  // Pharmacy Portal routes (under /pharmacy)
  {
    path: 'pharmacy',
    element: <PharmacyProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <PharmacyLayout />,
        children: [
          { index: true, element: <Navigate to="dashboard" replace /> },
          { path: 'dashboard', element: <PharmacyDashboard /> },
          { path: 'inventory', element: <PharmacyInventory /> },
          { path: 'availability', element: <PharmacyAvailability /> },
          { path: 'upload', element: <PharmacyUpload /> },
          { path: 'integration', element: <PharmacyIntegration /> },
          { path: 'participation', element: <PharmacyParticipation /> },
          { path: 'reports', element: <PharmacyReports /> },
          { path: 'notifications', element: <PharmacyNotifications /> },
          { path: 'profile', element: <PharmacyProfile /> },
          { path: 'billing', element: <PharmacyBilling /> },
          { path: 'settings', element: <PharmacySettings /> },
        ],
      },
    ],
  },
  // Fallback route
  { path: '*', element: <NotFound />, errorElement: <RouteErrorBoundary /> },
])
