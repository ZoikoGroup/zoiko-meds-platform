import {
  Bell,
  Building2,
  Ellipsis,
  Heart,
  House,
  MapPin,
  Search,
  UserRound,
} from 'lucide-react'
import { BrandMark } from '@/components/shared/brand'
import { cn } from '@/lib/utils'

/**
 * Phone and laptop showing the ZoikoMeds patient experience, drawn in markup
 * rather than shipped as a screenshot so they stay sharp at every size.
 * Purely decorative: hidden from assistive tech, nothing inside is interactive.
 *
 * Every dimension is in em, so the whole pair scales from one font-size. The
 * showcase sets that font-size from the space it has left (see
 * .zm-showcase__devices in login-showcase.css); at 10px the pair is 61em × 31.5em,
 * i.e. 610 × 315 px. Text sizes are set on leaf elements only, so containers
 * keep measuring in the root em.
 */

const PHONE_NAV = [
  { icon: House, label: 'Home' },
  { icon: Search, label: 'Find a medicine' },
  { icon: MapPin, label: 'Nearby pharmacies' },
  { icon: Bell, label: 'Availability alerts' },
  { icon: Heart, label: 'Saved medicines' },
  { icon: UserRound, label: 'My account' },
]

const PHONE_TABS = [
  { icon: House, label: 'Home' },
  { icon: Search, label: 'Search' },
  { icon: Bell, label: 'Alerts' },
  { icon: Ellipsis, label: 'More' },
]

const LAPTOP_TILES = [
  { icon: Search, title: 'Find a Medicine', sub: 'Search globally' },
  { icon: MapPin, title: 'Nearby Pharmacies', sub: 'Verified locations' },
  { icon: Bell, title: 'Set Alerts', sub: 'Get availability updates' },
  { icon: Building2, title: 'For Pharmacies', sub: 'Partner with us' },
]

function Wordmark({ className }) {
  return (
    <span className={cn('font-extrabold leading-none tracking-tight text-[#0b2a4a]', className)}>
      Zoiko<span className="text-teal-600">Meds</span>
    </span>
  )
}

function Capsule({ className }) {
  return (
    <span
      className={cn(
        'flex h-[1.9em] w-[5.2em] overflow-hidden rounded-full shadow-[0_0.3em_0.8em_rgba(0,0,0,0.35)]',
        className,
      )}
    >
      <span className="h-full w-1/2 bg-gradient-to-b from-white to-slate-200" />
      <span className="h-full w-1/2 bg-gradient-to-b from-teal-300 to-teal-600" />
    </span>
  )
}

function Phone() {
  return (
    <div className="relative z-10 h-[31.5em] w-[16em] shrink-0 rounded-[2.6em] border-[0.35em] border-slate-800 bg-slate-950 p-[0.3em] shadow-[0_2.4em_4.5em_-1.2em_rgba(0,0,0,0.85)] ring-1 ring-white/15">
      <div className="flex h-full flex-col overflow-hidden rounded-[2.2em] bg-white text-slate-600">
        <div className="flex items-center justify-between px-[1.5em] pt-[0.7em]">
          <span className="text-[0.75em] font-semibold text-slate-900">9:41</span>
          <span className="h-[0.95em] w-[3.6em] rounded-full bg-slate-900" />
          <span className="flex items-end gap-[0.18em]">
            <span className="h-[0.4em] w-[0.2em] rounded-sm bg-slate-900" />
            <span className="h-[0.55em] w-[0.2em] rounded-sm bg-slate-900" />
            <span className="h-[0.7em] w-[0.2em] rounded-sm bg-slate-900" />
          </span>
        </div>
        <div className="flex items-center gap-[0.45em] px-[1.3em] pt-[1.1em]">
          <BrandMark className="size-[1.5em]" />
          <Wordmark className="text-[1.1em]" />
        </div>
        <ul className="mt-[0.9em] flex flex-1 flex-col gap-[0.25em] px-[0.8em]">
          {PHONE_NAV.map(({ icon: Icon, label }, i) => (
            <li
              key={label}
              className={cn(
                'flex items-center gap-[0.7em] rounded-[0.7em] px-[0.8em] py-[0.62em] text-[0.82em] font-medium',
                i === 0 ? 'bg-teal-50 text-teal-700' : 'text-slate-600',
              )}
            >
              <Icon className="size-[1.25em] shrink-0" strokeWidth={2} />
              {label}
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-4 border-t border-slate-100 px-[0.5em] pt-[0.55em] pb-[0.8em]">
          {PHONE_TABS.map(({ icon: Icon, label }, i) => (
            <span
              key={label}
              className={cn(
                'flex flex-col items-center gap-[0.15em] text-[0.62em] font-medium',
                i === 0 ? 'text-teal-600' : 'text-slate-400',
              )}
            >
              <Icon className="size-[1.7em]" strokeWidth={2} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Laptop() {
  return (
    <div className="relative w-[44em] shrink-0">
      <div className="rounded-t-[1.1em] border border-slate-500/60 bg-slate-900 p-[0.55em] pb-[0.8em] shadow-[0_2.4em_5em_-1.6em_rgba(0,0,0,0.85)]">
        <div className="aspect-[16/10] overflow-hidden rounded-[0.35em] bg-slate-50 text-slate-600">
          <div className="flex h-full flex-col gap-[0.8em] p-[1.1em]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-[0.4em]">
                <BrandMark className="size-[1.45em]" />
                <Wordmark className="text-[1.05em]" />
              </span>
              <span className="flex gap-[1.4em] text-[0.62em] font-medium text-slate-500">
                <span>Search</span>
                <span>Pharmacies</span>
                <span>Alerts</span>
              </span>
            </div>
            <div className="flex h-[2.7em] items-center gap-[0.6em] overflow-hidden rounded-[0.6em] border border-slate-200 bg-white pl-[0.9em] shadow-sm">
              <Search className="size-[1.1em] shrink-0 text-slate-500" strokeWidth={2.2} />
              <span className="flex-1 truncate text-[0.74em] text-slate-500">
                Search for a medicine (e.g. Lisinopril, Metformin)
              </span>
              <span className="flex h-full w-[3.6em] shrink-0 items-center justify-center bg-teal-600 text-white">
                <Search className="size-[1.15em]" strokeWidth={2.4} />
              </span>
            </div>
            <div className="relative flex-1 overflow-hidden rounded-[0.8em] bg-gradient-to-br from-[#0b2f55] via-[#0d4f70] to-[#0f8a8a] p-[1.2em] text-white">
              <p className="text-[1.3em] leading-tight font-bold">Medicine Availability</p>
              <p className="mt-[0.4em] max-w-[54%] text-[0.7em] leading-[1.45] text-white/80">
                Check availability at verified pharmacies near you or in other countries.
              </p>
              <span className="absolute top-1/2 right-[1.8em] flex -translate-y-1/2 -rotate-[22deg] flex-col gap-[0.6em]">
                <Capsule />
                <Capsule className="translate-x-[1.6em]" />
              </span>
            </div>
            <div className="grid grid-cols-4 gap-[0.6em]">
              {LAPTOP_TILES.map(({ icon: Icon, title, sub }) => (
                <div
                  key={title}
                  className="flex flex-col items-center rounded-[0.6em] border border-slate-200 bg-white px-[0.3em] py-[0.6em] text-center"
                >
                  <Icon className="size-[1.4em] text-teal-600" strokeWidth={2} />
                  <span className="mt-[0.35em] text-[0.66em] leading-tight font-semibold text-slate-800">
                    {title}
                  </span>
                  <span className="mt-[0.1em] text-[0.54em] leading-tight text-slate-400">{sub}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="relative -mx-[2.4em] h-[1.15em] rounded-t-[0.2em] rounded-b-[1.1em] bg-gradient-to-b from-slate-200 via-slate-400 to-slate-600 shadow-[0_1.6em_2.6em_-0.8em_rgba(0,0,0,0.7)]">
        <div className="mx-auto h-[0.4em] w-[16%] rounded-b-[0.6em] bg-slate-500/80" />
      </div>
    </div>
  )
}

export function DeviceMockups({ className }) {
  return (
    <div aria-hidden="true" className={cn('flex items-end', className)}>
      <Phone />
      <div className="-ml-[1.5em] mb-[0.3em]">
        <Laptop />
      </div>
    </div>
  )
}
