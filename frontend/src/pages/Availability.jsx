import { Link } from 'react-router-dom'
import { ShieldCheck, Info, Search, ArrowRight, RefreshCw, Building2, Clock } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConfidenceBadge } from '@/components/shared/status'
import { PageHeader } from '@/components/shared/page-header'
import { Seo } from '@/components/shared/seo'
import { AVAILABILITY, byConfidence } from '@/lib/availability'
import { useLanguage } from '@/providers/language-provider'

const LEVELS = Object.keys(AVAILABILITY).sort(byConfidence)

export default function Availability() {
  const { t } = useLanguage()

  const bandDetails = {
    high: {
      title: t('likelyAvailableNow', 'Likely available now'),
      desc: t('likelyAvailableNowDesc', 'A verified pharmacy shared a recent signal indicating this medicine is likely available now.'),
    },
    moderate: {
      title: t('mayBeLimited', 'May be limited — confirm first'),
      desc: t('mayBeLimitedDesc', 'Signals suggest it may be available but could be limited. Confirm with the pharmacy before travelling.'),
    },
    low: {
      title: t('notRecentlyConfirmed', 'Not recently confirmed'),
      desc: t('notRecentlyConfirmedDesc', 'Availability has not been confirmed recently. Treat this as uncertain and call ahead.'),
    },
    unknown: {
      title: t('noRecentSignal', 'No recent signal'),
      desc: t('noRecentSignalDesc', 'No recent signal from verified pharmacies nearby. We cannot indicate availability right now.'),
    },
  }

  const whyChanges = [
    t('whyChange1', 'Pharmacies dispense stock throughout the day, so what was available this morning may not be by evening.'),
    t('whyChange2', 'New deliveries and restocks arrive on different schedules for each pharmacy.'),
    t('whyChange3', 'Regional demand and supply pressure (e.g. seasonal illness) shifts availability quickly.'),
    t('whyChange4', 'A signal ages: the longer since a pharmacy last confirmed, the lower our confidence.'),
  ]

  const howUpdates = [
    {
      icon: Building2,
      title: t('verifiedPharmaciesOnly', 'Verified pharmacies only'),
      text: t('verifiedPharmaciesOnlyDesc', 'Signals come from pharmacies whose licences have been verified and who opt in to participate.'),
    },
    {
      icon: RefreshCw,
      title: t('signalsNotStock', 'Signals, not stock counts'),
      text: t('signalsNotStockDesc', 'Pharmacies share availability signals — we never expose exact quantities on hand.'),
    },
    {
      icon: Clock,
      title: t('freshnessWeighted', 'Freshness-weighted'),
      text: t('freshnessWeightedDesc', 'ZoikoAvail™ weights each signal by how recent it is and the pharmacy’s reliability, then derives a confidence band.'),
    },
  ]

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: t('whatIsZoikoAvail', 'What is ZoikoAvail™?'),
        acceptedAnswer: {
          '@type': 'Answer',
          text: t('whatIsZoikoAvailDesc', 'ZoikoAvail™ is the availability confidence engine behind ZoikoMeds. It takes availability signals shared by verified pharmacies and turns them into a simple confidence band, so you can judge how likely a medicine is to be available before you travel. It never exposes exact stock counts, and it never lets you reserve or buy — it is intelligence only.'),
        },
      },
      {
        '@type': 'Question',
        name: t('doesAvailabilityMeanInStock', 'Does availability mean the medicine is in stock?'),
        acceptedAnswer: {
          '@type': 'Answer',
          text: t('confirmNote', 'Availability is a governed confidence signal from verified pharmacies — not exact stock. Please confirm with the pharmacy before visiting.'),
        },
      },
      ...LEVELS.map((level) => ({
        '@type': 'Question',
        name: `What does "${bandDetails[level]?.title}" mean?`,
        acceptedAnswer: { '@type': 'Answer', text: bandDetails[level]?.desc || '' },
      })),
    ],
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 pb-8">
      <Seo
        title={`${t('understandingAvailability', 'Understanding availability confidence')} — ZoikoMeds`}
        description={t('availabilitySubtitle', 'How ZoikoMeds shows whether a medicine is likely available near you — as a governed confidence signal, never a stock guarantee.')}
        type="article"
        jsonLd={faqLd}
      />

      <PageHeader
        eyebrow="ZoikoAvail™"
        title={t('understandingAvailability', 'Understanding availability confidence')}
        subtitle={t('availabilitySubtitle', 'How ZoikoMeds shows whether a medicine is likely available near you — as a governed confidence signal, never a stock guarantee.')}
        breadcrumbs={[{ label: t('search', 'Search'), to: '/search' }, { label: t('howAvailabilityWorks', 'Availability') }]}
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
          {LEVELS.map((level) => {
            const detail = bandDetails[level]
            return (
              <Card key={level} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:gap-4">
                <div className="shrink-0">
                  <ConfidenceBadge level={level} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-foreground">{detail?.title}</span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{detail?.desc}</span>
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Why availability changes */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">{t('whyAvailabilityChanges', 'Why medicine availability changes')}</h2>
        <ul className="flex flex-col gap-2.5">
          {whyChanges.map((tText) => (
            <li key={tText} className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
              <ArrowRight className="mt-1 size-3.5 shrink-0 text-primary" />
              {tText}
            </li>
          ))}
        </ul>
      </section>

      {/* How verified pharmacies update */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold text-foreground">{t('howPharmaciesKeepCurrent', 'How verified pharmacies keep it current')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {howUpdates.map((h) => {
            const Icon = h.icon
            return (
              <Card key={h.title} className="flex flex-col gap-2 p-5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="text-sm font-semibold text-foreground">{h.title}</span>
                <span className="text-xs leading-relaxed text-muted-foreground">{h.text}</span>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Confirmation guidance */}
      <Card className="flex items-start gap-3 border-primary/20 bg-primary/5 p-5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-sm leading-relaxed text-foreground">
          {t('confirmNote', 'Availability is a governed confidence signal from verified pharmacies — not exact stock. Please confirm with the pharmacy before visiting.')}
        </p>
      </Card>

      {/* Disclaimer */}
      <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        {t('scopeNote', 'ZoikoMeds shows where medicines may be available. It is not a pharmacy, marketplace, dispensing, or delivery service and does not provide medical advice.')}{' '}
        {t('disclaimerDetails', 'ZoikoMeds provides medicine availability intelligence only and does not guarantee that any medicine is in stock. Always confirm with the pharmacy before visiting.')}
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
