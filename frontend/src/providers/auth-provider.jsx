import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const STORAGE_KEY = 'zoiko-user'
const AuthContext = createContext(null)

const DEFAULT_USER = {
  name: 'Dr. Amara Okafor',
  email: 'a.okafor@zoikomeds.io',
  role: 'Intelligence Director',
  initials: 'AO',
}

function getInitials(name) {
  if (!name) return 'U'
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .substring(0, 2)
}

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  const login = useCallback(async (email, password) => {
    // Simulate API request delay
    await new Promise((resolve) => setTimeout(resolve, 800))

    if (!email || !password) {
      throw new Error('Email and password are required')
    }

    let authUser
    // Default admin user check
    if (email.toLowerCase() === DEFAULT_USER.email.toLowerCase()) {
      authUser = DEFAULT_USER
    } else {
      // Mock logging in any user
      const name = email.split('@')[0]
      const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
      authUser = {
        name: capitalized,
        email: email,
        role: 'Enterprise Partner',
        initials: getInitials(capitalized),
      }
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser))
    } catch {
      /* ignore storage errors */
    }

    setUserState(authUser)
    return authUser
  }, [])

  const register = useCallback(async (formData) => {
    // Simulate API request delay
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const { name, email, phone, password } = formData
    if (!name || !email || !password) {
      throw new Error('Name, email, and password are required')
    }

    const authUser = {
      name,
      email,
      phone,
      role: 'Enterprise Partner',
      initials: getInitials(name),
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser))
    } catch {
      /* ignore storage errors */
    }

    setUserState(authUser)
    return authUser
  }, [])

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore storage errors */
    }
    setUserState(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      login,
      register,
      logout,
    }),
    [user, login, register, logout]
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
