import { ExternalLink, LogOut, MonitorSmartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth-provider'
import { openExternal } from '@/lib/native'
import { WEB_ORIGIN } from '@/lib/platform'

/**
 * Shown in the Android app wherever the Super Admin console would be: a super
 * admin's portal home, or an /admin link opened from an email. The console is
 * a web-only surface in the app build, so this says so plainly and offers the
 * way there, instead of a menu that leads nowhere.
 */
export default function WebOnlyConsole() {
  const { isAuthenticated, logout } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <MonitorSmartphone className="size-7" />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">The admin console is on the web</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The ZoikoMeds app covers the patient and pharmacy portals. Platform administration is
        available in your browser at {new URL(WEB_ORIGIN).host}.
      </p>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <Button onClick={() => openExternal(`${WEB_ORIGIN}/admin/dashboard`)}>
          <ExternalLink />
          Open the admin console
        </Button>
        {isAuthenticated && (
          <Button variant="outline" onClick={logout}>
            <LogOut />
            Sign out
          </Button>
        )}
      </div>
    </div>
  )
}
