import { memo, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Check,
  CirclePlay,
  Layers,
  Lock,
  Network,
  Search,
  ShieldCheck,
  ShieldPlus,
} from 'lucide-react'
import { Brand } from '@/components/shared/brand'
import { cn } from '@/lib/utils'
import { NetworkGlobe } from './network-globe'
import { GlowArcs } from './glow-arcs'
import { DeviceMockups } from './device-mockups'
import careTeamArt from './assets/care-team-globe.webp'
import './login-showcase.css'

/**
 * Left-hand panel of the auth pages (sign in, create account, reset password):
 * the platform pitch over the care-team and globe artwork, with the product on
 * a phone and laptop below.
 *
 * It fills the same grid column AuthLayout's default panel does and nothing
 * else — the auth card beside it is the page's own. Every link goes somewhere
 * that exists today: the platform overview on zoikomeds.com, the in-app
 * privacy page, and the site's legal and support pages.
 *
 * Desktop (xl and up) shows the full composition; the copy column is held to
 * the left 58% so it never runs over a face in the artwork. Narrower layouts
 * swap the artwork for the drawn network globe, which reads well behind text.
 */

const SITE = 'https://zoikomeds.com'

const FEATURES = [
  { icon: Search, label: 'Find Medicines Globally' },
  { icon: ShieldCheck, label: 'Verified Pharmacies', accent: true },
  { icon: Layers, label: 'Real-Time Availability Signals' },
  { icon: Network, label: 'Multi-Country & Scalable' },
  { icon: ShieldPlus, label: 'Secure, Compliant & Private' },
]

const AUDIENCES = [
  'Patients & Caregivers',
  'Pharmacy Partners',
  'Healthcare Providers',
  'Enterprises & Governments',
]

const FOOTER_LINKS = [
  { label: 'Privacy', to: '/privacy', icon: Lock },
  { label: 'Terms', href: `${SITE}/terms-of-use` },
  { label: 'Security', href: `${SITE}/security` },
  { label: 'Accessibility', href: `${SITE}/accessibility` },
  { label: 'Help', href: `${SITE}/contact` },
]

function ExternalLink({ href, className, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

// The copy fades in on the first auth page of a visit only. Each auth page is
// its own route, so switching tabs mounts this panel afresh; replaying the
// entrance then would make the whole page flash when only the form changed.
let introPlayed = false

// Memoised: the panel takes no props, and without this every keystroke in the
// form beside it (state in the page, the parent) would re-render the artwork
// and the device mockups for nothing.
export const LoginShowcase = memo(function LoginShowcase() {
  const [playIntro] = useState(() => !introPlayed)
  useEffect(() => {
    introPlayed = true
  }, [])

  return (
    <section
      aria-labelledby="login-showcase-title"
      // On desktop the panel is one window tall and pinned while the page
      // scrolls, so moving between the auth forms (the sign-up form is the
      // tallest) never resizes it.
      className="zm-showcase dark relative isolate flex flex-col overflow-hidden text-white lg:sticky lg:top-0 lg:col-span-6 lg:min-h-screen lg:self-start xl:col-span-7"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <NetworkGlobe className="zm-showcase__globe" />
        <div className="zm-showcase__art">
          <div className="zm-showcase__team" style={{ backgroundImage: `url(${careTeamArt})` }} />
          <GlowArcs className="zm-showcase__arcs" />
        </div>
        <div className="zm-showcase__horizon" />
        <div className="zm-showcase__scrim" />
      </div>

      <div className="flex flex-1 flex-col px-6 pt-7 pb-5 sm:px-12 sm:pt-8 lg:px-10 xl:px-14 2xl:px-20">
        <Brand className="origin-left scale-110 sm:scale-125" />

        <motion.div
          initial={playIntro ? { opacity: 0, y: 15 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="zm-showcase__copy my-auto flex max-w-[38rem] flex-col py-5 lg:py-4"
        >
          <p className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.14em] whitespace-nowrap text-teal-200/90 uppercase sm:text-xs sm:tracking-[0.22em]">
            Global medicine-availability platform
            <span aria-hidden="true" className="hidden h-0.5 w-14 shrink-0 rounded-full bg-gradient-to-r from-teal-300 to-teal-300/0 sm:block" />
          </p>

          <h1
            id="login-showcase-title"
            className="zm-showcase__title mt-3.5 text-[28px] leading-[1.1] font-extrabold tracking-tight text-white sm:text-[40px] lg:text-[36px]"
          >
            Medicine Availability <br className="hidden lg:inline" />
            Intelligence for a <br className="hidden lg:inline" />
            <span className="bg-gradient-to-r from-teal-300 via-emerald-300 to-cyan-300 bg-clip-text whitespace-nowrap text-transparent">
              Healthier World.
            </span>
          </h1>

          <p className="mt-4 max-w-[34rem] text-sm leading-relaxed text-slate-200/85 sm:text-base">
            A global platform that connects patients, pharmacies and healthcare ecosystems with
            real-time, trusted medicine-availability signals.
          </p>

          <ul className="mt-5 grid grid-cols-5 divide-x divide-white/15 sm:mt-6 lg:mt-5">
            {FEATURES.map(({ icon: Icon, label, accent }) => (
              <li key={label} className="flex flex-col items-center gap-2 px-1 text-center sm:px-2">
                <Icon
                  className={cn('size-7 sm:size-8 xl:size-9', accent ? 'text-teal-300' : 'text-white')}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="text-[10px] leading-tight font-semibold text-slate-100 sm:text-xs xl:text-[clamp(11px,1.2cqw,13px)]">
                  {label}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex sm:mt-6 lg:mt-5">
            <ExternalLink
              href={`${SITE}/overview`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/5 px-4.5 py-3 text-[13px] font-semibold text-white backdrop-blur-sm transition hover:border-white/45 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 sm:text-sm"
            >
              <CirclePlay className="size-[18px] shrink-0" aria-hidden="true" />
              See How It Works
            </ExternalLink>
          </div>
        </motion.div>

        <div className="zm-showcase__stage hidden lg:flex">
          <div className="zm-showcase__device-slot">
            <DeviceMockups className="zm-showcase__devices" />
          </div>
          <div className="zm-showcase__infra">
            <h2 className="zm-showcase__infra-title border-l-[3px] border-teal-300 pl-3 font-bold text-white">
              A Trusted <br className="zm-showcase__infra-break" />
              Healthcare <br className="zm-showcase__infra-break" />
              Infrastructure
            </h2>
            <ul className="zm-showcase__audiences">
              {AUDIENCES.map((audience) => (
                <li key={audience} className="flex items-center gap-2.5 text-slate-100">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-teal-400 text-[#05283f]">
                    <Check className="size-3" strokeWidth={3.2} aria-hidden="true" />
                  </span>
                  {audience}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <footer className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-3 text-[11px] text-slate-300/80 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-start xl:flex-row xl:items-center">
          <nav aria-label="Legal and support">
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {FOOTER_LINKS.map(({ label, to, href, icon: Icon }, i) => (
                <li key={label} className="flex items-center gap-3">
                  {i > 0 && <span aria-hidden="true" className="h-3 w-px bg-white/20" />}
                  {to ? (
                    <Link to={to} className="inline-flex items-center gap-1 transition-colors hover:text-white">
                      {Icon && <Icon className="size-3" aria-hidden="true" />}
                      {label}
                    </Link>
                  ) : (
                    <ExternalLink href={href} className="transition-colors hover:text-white">
                      {label}
                    </ExternalLink>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <p>&copy; {new Date().getFullYear()} ZoikoMeds. All rights reserved.</p>
        </footer>
      </div>
    </section>
  )
})
