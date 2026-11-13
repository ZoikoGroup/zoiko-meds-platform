import { Link } from 'react-router-dom'
import { KeyRound, LogIn, UserPlus } from 'lucide-react'
import { Brand } from '@/components/shared/brand'
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

/**
 * Sign In | Create Account | Reset Password. `active` is one of the ids above.
 *
 * The card is always light (AuthLayout's zm-auth-light scope), so the tabs
 * are drawn from its tokens alone: a light-grey track, the current tab a white
 * surface with dark navy text and the blue-to-teal underline.
 */
export function AuthTabs({ active }) {
  return (
    <nav
      aria-label="Account access"
      className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted p-1"
    >
      {TABS.map(({ id, to, label, icon: Icon }) =>
        id === active ? (
          <button
            key={id}
            type="button"
            aria-current="page"
            className={cn(
              TAB_BASE,
              'border border-border/80 bg-card font-bold text-foreground shadow-sm',
            )}
          >
            <Icon className="hidden size-3.5 shrink-0 text-teal sm:block" aria-hidden="true" />
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
              'text-muted-foreground hover:bg-card/70 hover:text-foreground',
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

/**
 * ZoikoMeds logo, title and one line of context at the top of each form. On
 * short desktop windows the logo steps aside so the whole card fits on
 * screen; the page's own logo stays in view either way.
 */
export function AuthCardHeading({ title, description }) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <Brand size="large" className="zm-auth-logo lg:[@media(max-height:700px)]:hidden" />
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl leading-tight font-extrabold tracking-tight text-foreground">{title}</h2>
        {description && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  )
}
