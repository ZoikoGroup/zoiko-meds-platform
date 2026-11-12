import { Link } from 'react-router-dom'
import { KeyRound, LogIn, UserPlus } from 'lucide-react'
import { BrandMark } from '@/components/shared/brand'
import { cn } from '@/lib/utils'

/**
 * Shared pieces of the auth card on the sign-in, create-account and
 * reset-password pages, so the three read as one card whose form changes.
 *
 * Presentation only. The tabs move between the existing routes; the current
 * one stays a plain button, exactly as the segmented control it replaces did,
 * so nothing about how each page signs in, registers or resets changes.
 */

const TABS = [
  { id: 'sign-in', to: '/login', label: 'Sign In', icon: LogIn },
  { id: 'create-account', to: '/register', label: 'Create Account', icon: UserPlus },
  { id: 'reset-password', to: '/forgot-password', label: 'Reset Password', icon: KeyRound },
]

const TAB_BASE =
  'relative flex items-center justify-center gap-1.5 rounded-lg px-1.5 py-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors sm:text-xs'

/** Sign In | Create Account | Reset Password. `active` is one of the ids above. */
export function AuthTabs({ active }) {
  return (
    <nav
      aria-label="Account access"
      className="grid grid-cols-3 gap-1 rounded-xl border border-border/40 bg-muted/80 p-1 dark:border-slate-800/80 dark:bg-slate-900/60"
    >
      {TABS.map(({ id, to, label, icon: Icon }) =>
        id === active ? (
          <button
            key={id}
            type="button"
            aria-current="page"
            className={cn(
              TAB_BASE,
              'border border-transparent bg-card text-foreground shadow-xs dark:border-slate-700/50 dark:bg-slate-800 dark:text-slate-50',
            )}
          >
            <Icon className="hidden size-3.5 shrink-0 text-primary sm:block dark:text-teal" aria-hidden="true" />
            {label}
            <span
              aria-hidden="true"
              className="absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-[#2b4192] to-teal"
            />
          </button>
        ) : (
          <Link
            key={id}
            to={to}
            className={cn(
              TAB_BASE,
              'text-muted-foreground hover:bg-card/60 hover:text-foreground dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100',
            )}
          >
            <Icon className="hidden size-3.5 shrink-0 sm:block" aria-hidden="true" />
            {label}
          </Link>
        ),
      )}
    </nav>
  )
}

/** Brand mark, title and one line of context at the top of each form. */
export function AuthCardHeading({ title, description }) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <BrandMark size={40} />
      <div className="flex flex-col gap-1">
        <h2 className="text-xl leading-tight font-bold tracking-tight text-foreground">{title}</h2>
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  )
}
