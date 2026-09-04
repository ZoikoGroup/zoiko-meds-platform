import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState } from '@/components/shared/states'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { getZoikoAvailSpec } from '@/services/admin-api'

/**
 * An interactive API explorer that works in production without publishing
 * Swagger to the internet.
 *
 * `SwaggerModule.setup('/api/docs')` is mounted outside production on purpose —
 * the full API surface, every admin and auth route included, is not something to
 * serve publicly. So the explorer was simply missing on the live deployment, and
 * the obvious fix, dropping that guard, would publish exactly what the guard
 * exists to withhold.
 *
 * Instead the specification is fetched through the same authenticated admin API
 * client the rest of the console uses, from a SUPER_ADMIN-guarded route, and
 * rendered here. A direct browser navigation to a guarded backend URL would not
 * have carried the Authorization header at all — a new tab sends cookies, not
 * the bearer token this app holds in memory — so the request has to come from
 * inside the application.
 *
 * What arrives is the filtered ZoikoAvail surface: /admin, /auth and the rest
 * are absent from the document itself, not merely hidden by the UI.
 */
export default function ZoikoAvailSwagger() {
  const navigate = useNavigate()
  const [spec, setSpec] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = () => {
    setLoading(true)
    setError(false)
    getZoikoAvailSpec()
      .then(setSpec)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  // The raw UI exists only where the backend mounts it. Read off the document's
  // own servers rather than this app's origin — the console runs on a different
  // port in development, which is what sent the old button to the SPA's 404.
  const localBase = spec?.servers?.find((s) => /localhost|127\.0\.0\.1/i.test(s.url))?.url
  const rawSwaggerUrl = import.meta.env.DEV && localBase ? `${localBase}/docs` : null

  const header = (
    <PageHeader
      eyebrow="Medicine Intelligence"
      title="API Explorer"
      subtitle="Interactive ZoikoAvail™ API reference, served from this deployment's own contract."
      breadcrumbs={[
        { label: 'ZoikoMeds', to: '/dashboard' },
        { label: 'ZoikoAvail™', to: '/admin/zoikoavail' },
        { label: 'API Explorer' },
      ]}
      actions={
        <>
          <Button
            variant="outline"
            onClick={() => navigate('/admin/zoikoavail/documentation')}
          >
            <ArrowLeft />
            Back to API Documentation
          </Button>
          {/* Secondary, and local only: production does not mount /api/docs and
              must not appear to offer it. */}
          {rawSwaggerUrl && (
            <Button
              variant="outline"
              onClick={() => window.open(rawSwaggerUrl, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink />
              Open raw Swagger UI
            </Button>
          )}
        </>
      }
    />
  )

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  // Never an empty explorer: a Swagger UI with no paths reads as an API with no
  // endpoints, which is a worse answer than saying the spec could not be read.
  if (error || !spec) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState
          title="Unable to load ZoikoAvail API specification."
          description="The governed contract could not be read from this deployment. Please try again."
          onRetry={load}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {/*
        `spec` rather than `url`: SwaggerUI fetching the URL itself would be an
        unauthenticated request from the library, which the SUPER_ADMIN guard
        would refuse. The document is already in hand, fetched by the app's own
        authenticated client.

        No token is passed in. The console's JWT is the operator's session, not
        an API credential, and seeding it into the Authorize box would turn a
        reference page into a way to replay an admin session against the API.
        Anyone testing a protected route authorizes explicitly.
      */}
      <Card className="zoikoavail-swagger overflow-x-auto p-2">
        <SwaggerUI spec={spec} docExpansion="list" defaultModelsExpandDepth={-1} />
      </Card>
    </div>
  )
}
