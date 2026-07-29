import React from 'react'
import { useRouteError, useNavigate } from 'react-router-dom'
import { AlertTriangle, RefreshCw, Home, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Class-based Error Boundary for component subtrees and uncaught errors.
 */
export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] Uncaught application error:', error, errorInfo)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const isImportError =
        this.state.error?.message?.includes('Failed to fetch dynamically imported module') ||
        this.state.error?.name === 'TypeError'

      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md border-border/80 bg-card shadow-2xl">
            <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
                <AlertTriangle className="size-7" />
              </div>

              <div className="flex flex-col gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {isImportError ? 'Page update detected' : 'Something went wrong'}
                </h1>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isImportError
                    ? 'A new version of this page is available. Reloading will fetch the latest module updates.'
                    : 'An unexpected application error occurred. You can reload the page or return home.'}
                </p>
              </div>

              <div className="flex w-full flex-col gap-2.5 sm:flex-row">
                <Button onClick={this.handleReload} variant="teal" className="flex-1">
                  <RefreshCw className="size-4" />
                  Reload page
                </Button>
                <Button onClick={() => (window.location.href = '/')} variant="outline" className="flex-1">
                  <Home className="size-4" />
                  Go to home
                </Button>
              </div>

              {import.meta.env.DEV && this.state.error && (
                <div className="mt-2 w-full rounded-xl border border-border/60 bg-muted/40 p-3 text-left">
                  <p className="font-mono text-[11px] text-red-400 break-all">
                    {this.state.error.toString()}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Functional Route Error Element for React Router createBrowserRouter.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  const isImportError =
    error?.message?.includes('Failed to fetch dynamically imported module') ||
    error?.name === 'TypeError'

  const handleReload = () => {
    window.location.reload()
  }

  return (
    <div className="flex min-h-[70vh] w-full items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/80 bg-card shadow-2xl">
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
            <ShieldAlert className="size-7" />
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {isImportError ? 'Module update required' : 'Unable to load route'}
            </h1>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isImportError
                ? 'The application module was updated. Reloading will refresh your browser session.'
                : error?.message || 'An error occurred while rendering this page route.'}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2.5 sm:flex-row">
            <Button onClick={handleReload} variant="teal" className="flex-1">
              <RefreshCw className="size-4" />
              Reload page
            </Button>
            <Button onClick={() => navigate('/login')} variant="outline" className="flex-1">
              <Home className="size-4" />
              Sign in
            </Button>
          </div>

          {import.meta.env.DEV && error && (
            <div className="mt-2 w-full rounded-xl border border-border/60 bg-muted/40 p-3 text-left">
              <p className="font-mono text-[11px] text-red-400 break-all">
                {error.status ? `[HTTP ${error.status}] ` : ''}
                {error.statusText || error.message || error.toString()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
