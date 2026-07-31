import { Link } from 'react-router-dom'
import { ShieldCheck, Info, Search, ArrowRight, RefreshCw, Building2, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfidenceBadge } from '@/components/shared/status'
import { PageHeader } from '@/components/shared/page-header'
import { Seo } from '@/components/shared/seo'
import { AVAILABILITY, byConfidence, CONFIRM_NOTE, SCOPE_NOTE } from '@/lib/availability'
import { useLanguage } from '@/providers/language-provider'

const LEVELS = Object.keys(AVAILABILITY).sort(byConfidence)

const HOW_UPDATES_ITEMS = [
  { icon: Building2, titleKey: 'verifiedPharmaciesOnly', titleDefault: 'Verified pharmacies only', textKey: 'verifiedPharmaciesOnlyDesc', textDefault: 'Signals come from pharmacies whose licences have been verified and who opt in to participate.' },
  { icon: RefreshCw, titleKey: 'signalsNotStock', titleDefault: 'Signals, not stock counts', textKey: 'signalsNotStockDesc', textDefault: 'Pharmacies share availability signals — we never expose exact quantities on hand.' },
  { icon: Clock, titleKey: 'freshnessWeighted', titleDefault: 'Freshness-weighted', textKey: 'freshnessWeightedDesc', textDefault: 'ZoikoAvail™ weights each signal by how recent it is and the pharmacy’s reliability, then derives a confidence band.' },
]

const WHY_CHANGES_ITEMS = [
  { key: 'whyChange1', defaultText: 'Pharmacies dispense stock throughout the day, so what was available this morning may not be by evening.' },
  { key: 'whyChange2', defaultText: 'New deliveries and restocks arrive on different schedules for each pharmacy.' },
  { key: 'whyChange3', defaultText: 'Regional demand and supply pressure (e.g. seasonal illness) shifts availability quickly.' },
  { key: 'whyChange4', defaultText: 'A signal ages: the longer since a pharmacy last confirmed, the lower our confidence.' },
]

export default function Availability() {
  const { t } = useLanguage()

  const BAND_DETAIL = {
    high: t('likelyAvailableNowDesc', 'A verified pharmacy shared a recent signal indicating this medicine is likely available now.'),
    moderate: t('mayBeLimitedDesc', 'Signals suggest it may be available but could be limited. Confirm with the pharmacy before travelling.'),
    low: t('notRecentlyConfirmedDesc', 'Availability has not been confirmed recently. Treat this as uncertain and call ahead.'),
    unknown: t('noRecentSignalDesc', 'No recent signal from verified pharmacies nearby. We cannot indicate availability right now.'),
  }

  const BAND_TITLE = {
    high: t('likelyAvailableNow', 'Likely available now'),
    moderate: t('mayBeLimited', 'May be limited — confirm first'),
    low: t('notRecentlyConfirmed', 'Not recently confirmed'),
    unknown: t('noRecentSignal', 'No recent signal'),
  }

  // FAQPage structured data (approved schema type — no Drug/Pharmacy/Offer).
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: 'What is ZoikoAvail™?', acceptedAnswer: { '@type': 'Answer', text: 'ZoikoAvail™ is ZoikoMeds’ availability confidence engine. It turns verified-pharmacy signals into a High/Moderate/Low/Unknown confidence band — never exact stock.' } },
      { '@type': 'Question', name: 'Does availability mean the medicine is in stock?', acceptedAnswer: { '@type': 'Answer', text: CONFIRM_NOTE } },
      ...LEVELS.map((level) => ({
        '@type': 'Question',
        name: `What does "${AVAILABILITY[level].plain}" mean?`,
        acceptedAnswer: { '@type': 'Answer', text: BAND_DETAIL[level] },
      })),
    ],
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 pb-8">
      <Seo
        title="Understanding availability confidence — ZoikoMeds"
        description="ZoikoAvail™ shows medicine availability as a governed confidence signal from verified pharmacies — never exact stock. Learn what High, Moderate, Low, and Unknown mean."
        type="article"
        jsonLd={faqLd}
      />

      <PageHeader
        eyebrow="ZoikoAvail™"
        title={t('understandingAvailability', 'Understanding availability confidence')}
        subtitle={t('availabilitySubtitle', 'How ZoikoMeds shows whether a medicine is likely available near you — as a governed confidence signal, never a stock guarantee.')}
        breadcrumbs={[{ label: t('search', 'Search'), to: '/search' }, { label: t('availability', 'Availability') }]}
      />

      {/* What ZoikoAvail is */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">{t('whatIsZoikoAvail', 'What is ZoikoAvail™?')}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('whatIsZoikoAvailDesc', 'ZoikoAvail™ is the availability confidence engine behind ZoikoMeds. It takes availability signals shared by verified pharmacies and turns them into a simple confidence band, so you can judge how likely a medicine is to be available before you travel. It never exposes exact stock counts, and it never lets you reserve or buy — it is intelligence only.')}
        </p>
      </section>

      {/* Confidence bands */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">{t('confidenceLevels', 'Confidence levels')}</h2>
        <div className="flex flex-col gap-3">
          {LEVELS.map((level) => (
            <Card key={level} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:gap-4">
              <div className="shrink-0">
                <ConfidenceBadge level={level} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">{BAND_TITLE[level] || AVAILABILITY[level].plain}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{BAND_DETAIL[level]}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Why availability changes */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">{t('whyAvailabilityChanges', 'Why medicine availability changes')}</h2>
        <ul className="flex flex-col gap-2.5">
          {WHY_CHANGES_ITEMS.map((item) => (
            <li key={item.key} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <ArrowRight className="mt-1 size-3.5 shrink-0 text-primary" />
              {t(item.key, item.defaultText)}
            </li>
          ))}
        </ul>
      </section>

      {/* How verified pharmacies update */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">{t('howPharmaciesKeepCurrent', 'How verified pharmacies keep it current')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {HOW_UPDATES_ITEMS.map((h) => {
            const Icon = h.icon
            return (
              <Card key={h.titleKey} className="flex flex-col gap-2 p-5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-foreground">{t(h.titleKey, h.titleDefault)}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{t(h.textKey, h.textDefault)}</span>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Confirmation guidance */}
      <Card className="flex items-start gap-3 border-primary/20 bg-primary/5 p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-foreground">{t('confirmNote', CONFIRM_NOTE)}</p>
      </Card>

      {/* Disclaimer */}
      <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        {t('scopeNote', SCOPE_NOTE)}
      </p>

      {/* CTA back to search */}
      <div className="flex justify-center">
        <Button asChild>
          <Link to="/search">
            <Search className="size-4" />
            {t('searchMedicineAvailability', 'Search medicine availability')}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
