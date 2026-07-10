import { Navigate, Outlet } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/providers/auth-provider'

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
  const { isAuthenticated, isSuperAdmin, bootstrapping } = useAuth()

  if (bootstrapping) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />

  return <Outlet />
}

// User portal (/dashboard, /search, …) — any authenticated non-super-admin.
export function UserProtectedRoute() {
  const { isAuthenticated, isSuperAdmin, bootstrapping } = useAuth()

  if (bootstrapping) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isSuperAdmin) return <Navigate to="/admin" replace />

  return <Outlet />
}

// Login / register — redirect an already-signed-in user to their portal.
export function PublicRoute() {
  const { isAuthenticated, isSuperAdmin, bootstrapping } = useAuth()

  if (bootstrapping) return <AuthLoading />
  if (isAuthenticated) {
    return <Navigate to={isSuperAdmin ? '/admin' : '/dashboard'} replace />
  }

  return <Outlet />
}
