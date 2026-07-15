/**
 * Per-route SEO metadata + structured data for the React + Vite SPA.
 *
 * React 19 natively hoists <title>, <meta>, and <link> rendered anywhere in the
 * component tree into <head>, so no head-manager dependency (react-helmet, etc.)
 * is required. JSON-LD is rendered inline; crawlers read `application/ld+json`
 * wherever it appears in the DOM.
 *
 * Governance (per the frontend build plan): use only approved schema types such
 * as WebPage / FAQPage / Organization. Never emit Drug, Pharmacy, or Offer.
 */

const SITE_NAME = 'ZoikoMeds'

// Absolute URL for canonical/OG. Defaults to the current location for the SPA.
function resolveUrl(canonical) {
  if (canonical) return canonical
  if (typeof window === 'undefined') return undefined
  return window.location.origin + window.location.pathname
}

export function Seo({ title, description, canonical, image, jsonLd, type = 'website' }) {
  const url = resolveUrl(canonical)
  const fullTitle = title ?? `${SITE_NAME} · Medicine Availability Intelligence`

  return (
    <>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {url && <link rel="canonical" href={url} />}

      {/* Open Graph */}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      {url && <meta property="og:url" content={url} />}
      {image && <meta property="og:image" content={image} />}

      {/* Twitter */}
      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={fullTitle} />
      {description && <meta name="twitter:description" content={description} />}
      {image && <meta name="twitter:image" content={image} />}

      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  )
}
