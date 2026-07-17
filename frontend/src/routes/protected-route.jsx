import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'

// Route auth guards. Set to `true` only for local development when you need
// the app reachable without a working login; `false` enforces role protection
// (production default).
const BYPASS_AUTH = false

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Restoring your session…
    </div>
  )
}

// Super Admin console (/admin/*) — requires an authenticated SUPER_ADMIN.
export function AdminProtectedRoute() {
  const { isAuthenticated, isSuperAdmin, homePath, bootstrapping } = useAuth()

  if (BYPASS_AUTH) return <Outlet />
  if (bootstrapping) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isSuperAdmin) return <Navigate to={homePath} replace />

  return <Outlet />
}

// Pharmacy portal (/pharmacy/*) — requires an authenticated pharmacy user.
export function PharmacyProtectedRoute() {
  const { isAuthenticated, isPharmacy, homePath, bootstrapping } = useAuth()

  if (BYPASS_AUTH) return <Outlet />
  if (bootstrapping) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isPharmacy) return <Navigate to={homePath} replace />

  return <Outlet />
}

// Patient portal (/dashboard, /search, …) — authenticated PUBLIC patients only.
// Super-admin and pharmacy users are sent to their own portal.
export function UserProtectedRoute() {
  const { isAuthenticated, homePath, bootstrapping } = useAuth()

  if (BYPASS_AUTH) return <Outlet />
  if (bootstrapping) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (homePath !== '/dashboard') return <Navigate to={homePath} replace />

  return <Outlet />
}

// Login / register — redirect an already-signed-in user to their portal.
export function PublicRoute() {
  const { isAuthenticated, homePath, bootstrapping } = useAuth()

  if (BYPASS_AUTH) return <Outlet />
  if (bootstrapping) return <AuthLoading />
  if (isAuthenticated) return <Navigate to={homePath} replace />

  return <Outlet />
}
