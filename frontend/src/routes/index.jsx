import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/layouts/app-layout'
import { UserLayout } from '@/layouts/user-layout'
import { PharmacyLayout } from '@/layouts/pharmacy-layout'
import { AdminProtectedRoute, UserProtectedRoute, PharmacyProtectedRoute, PublicRoute } from '@/routes/protected-route'
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
const Governance = lazy(() => import('@/pages/Governance'))
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
const Availability = lazy(() => import('@/pages/Availability'))
const MedicineDetail = lazy(() => import('@/pages/MedicineDetail'))
const UserSaved = lazy(() => import('@/pages/UserSaved'))
const UserSignal = lazy(() => import('@/pages/UserSignal'))
const UserProfile = lazy(() => import('@/pages/UserProfile'))
const UserSettings = lazy(() => import('@/pages/UserSettings'))

// Pharmacy Portal page chunks
const PharmacyDashboard = lazy(() => import('@/pages/pharmacy/PharmacyDashboard'))
const PharmacyInventory = lazy(() => import('@/pages/pharmacy/PharmacyInventory'))
const PharmacyAvailability = lazy(() => import('@/pages/pharmacy/PharmacyAvailability'))
const PharmacyUpload = lazy(() => import('@/pages/pharmacy/PharmacyUpload'))
const PharmacyIntegration = lazy(() => import('@/pages/pharmacy/PharmacyIntegration'))
const PharmacyParticipation = lazy(() => import('@/pages/pharmacy/PharmacyParticipation'))
const PharmacyReports = lazy(() => import('@/pages/pharmacy/PharmacyReports'))
const PharmacyNotifications = lazy(() => import('@/pages/pharmacy/PharmacyNotifications'))
const PharmacyProfile = lazy(() => import('@/pages/pharmacy/PharmacyProfile'))
const PharmacySettings = lazy(() => import('@/pages/pharmacy/PharmacySettings'))

const Login = lazy(() => import('@/pages/Login'))
const Register = lazy(() => import('@/pages/Register'))
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword'))
const NotFound = lazy(() => import('@/pages/NotFound'))

export const router = createBrowserRouter([
  // Public routes (only accessible when not logged in)
  {
    element: <PublicRoute />,
    children: [
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
      { path: 'forgot-password', element: <ForgotPassword /> },
      { path: 'reset-password', element: <ResetPassword /> },
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
          { path: 'governance', element: <Governance /> },
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
          { path: 'availability', element: <Availability /> },
          { path: 'medicine/:id', element: <MedicineDetail /> },
          { path: 'saved', element: <UserSaved /> },
          { path: 'signal', element: <UserSignal /> },
          // Legacy alerts route now lives inside ZoikoSignal.
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
          { path: 'settings', element: <PharmacySettings /> },
        ],
      },
    ],
  },
  // Fallback route
  { path: '*', element: <NotFound /> },
])
