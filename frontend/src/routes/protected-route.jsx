import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/providers/auth-provider'

export function AdminProtectedRoute() {
  const { isAuthenticated, user } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.role !== 'SUPER_ADMIN') {
    alert('Access Denied')
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

export function UserProtectedRoute() {
  const { isAuthenticated, user } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.role !== 'USER') {
    return <Navigate to="/admin" replace />
  }

  return <Outlet />
}

export function PublicRoute() {
  const { isAuthenticated, user } = useAuth()

  if (isAuthenticated) {
    if (user?.role === 'SUPER_ADMIN') {
      return <Navigate to="/admin" replace />
    }
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
