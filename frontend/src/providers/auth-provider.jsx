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
  // The app always starts at the login page: the persisted session is NOT
  // auto-restored on load, so opening / (which routes to /login) shows login
  // every time. Login still holds the session in memory for the active session.
  const [user, setUserState] = useState(null)

  const login = useCallback(async (email, password) => {
    // Simulate API request delay
    await new Promise((resolve) => setTimeout(resolve, 800))

    if (!email || !password) {
      throw new Error('Email and password are required')
    }

    const normEmail = email.toLowerCase()
    let authUser

    // Demo Credentials check
    if (normEmail === 'super@zoikogroup.com') {
      if (password !== 'Super@123') {
        throw new Error('Invalid credentials')
      }
      authUser = {
        name: 'Platform Super Administrator',
        email: 'super@zoikogroup.com',
        role: 'SUPER_ADMIN',
        initials: 'PS'
      }
    } else if (normEmail === 'john@example.com') {
      if (password !== 'User@123') {
        throw new Error('Invalid credentials')
      }
      authUser = {
        name: 'Naveen',
        email: 'john@example.com',
        role: 'USER',
        roleType: 'Patient / Caregiver',
        initials: 'N',
        memberSince: 'July 2026',
        accountType: 'Personal',
        location: 'Gandimaisamma, Hyderabad',
        language: 'English',
        notifications: 'Enabled',
        locationAccess: 'Allowed',
        theme: 'Light',
        lastLogin: 'Today • 10:42 AM'
      }
    } else {
      // Mock other users logging in
      const name = email.split('@')[0]
      const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
      authUser = {
        name: capitalized,
        email: email,
        role: 'USER',
        initials: getInitials(capitalized)
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
      role: 'USER',
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
