import { oauthUrl } from '@/services/auth-api'
import { Button } from '@/components/ui/button'

// Brand marks kept inline (lucide has no brand logos). Small, theme-neutral.
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  )
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}

const PROVIDERS = [
  { id: 'google', label: 'Continue with Google', Mark: GoogleMark },
  { id: 'microsoft', label: 'Continue with Microsoft', Mark: MicrosoftMark },
]

/**
 * Social sign-in buttons. Each is a full-page navigation to the backend OAuth
 * endpoint (not a fetch), which redirects to the provider and back to
 * /auth/callback with a token.
 */
export function OAuthButtons({ label = 'Or continue with' }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid gap-2">
        {PROVIDERS.map(({ id, label: text, Mark }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            className="w-full gap-2 bg-card font-medium"
            onClick={() => {
              window.location.href = oauthUrl(id)
            }}
          >
            <Mark />
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}
