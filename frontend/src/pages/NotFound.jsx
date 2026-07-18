import { Link } from 'react-router-dom'
import { ArrowLeft, Radar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/providers/auth-provider'

export default function NotFound() {
  const { homePath } = useAuth()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Radar className="size-7" />
      </span>
      <p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-primary">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        This intelligence surface was not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you are looking for may have moved, or the link is no longer
        governed within your workspace.
      </p>
      <Button asChild className="mt-6">
        <Link to={homePath || '/dashboard'}>
          <ArrowLeft />
          Back to dashboard
        </Link>
      </Button>
    </div>
  )
}
