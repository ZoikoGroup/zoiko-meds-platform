import { lazy } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/layouts/app-layout'

// Route-level code-splitting — each page ships as its own chunk.
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const ZoikoSignal = lazy(() => import('@/pages/ZoikoSignal'))
const ZoikoAvail = lazy(() => import('@/pages/ZoikoAvail'))
const MediBase = lazy(() => import('@/pages/MediBase'))
const HealthSystems = lazy(() => import('@/pages/HealthSystems'))
const Government = lazy(() => import('@/pages/Government'))
const Enterprise = lazy(() => import('@/pages/Enterprise'))
const Reports = lazy(() => import('@/pages/Reports'))
const Settings = lazy(() => import('@/pages/Settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'zoikosignal', element: <ZoikoSignal /> },
      { path: 'zoikoavail', element: <ZoikoAvail /> },
      { path: 'medibase', element: <MediBase /> },
      { path: 'health-systems', element: <HealthSystems /> },
      { path: 'government', element: <Government /> },
      { path: 'enterprise', element: <Enterprise /> },
      { path: 'reports', element: <Reports /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
