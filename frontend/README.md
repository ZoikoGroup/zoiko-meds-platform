# ZoikoMeds — Medicine Availability Intelligence

An enterprise **healthcare intelligence platform** front end that visualizes
governed medicine-availability intelligence: availability confidence, shortage
pressure, and access risk across regions, jurisdictions, and partner networks.

The design language draws from Palantir Foundry, Stripe, Vercel, Datadog, and
Azure Portal — minimal, dense-but-calm, enterprise-grade — with premium
healthcare branding.

> This is an **intelligence dashboard**, not a pharmacy system, inventory
> tracker, EMR, or ordering app. All data is **synthetic, aggregate
> enterprise-intelligence metrics** — no patient data, no specific-medicine
> stock, no clinical claims.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | **React 19** (JSX) |
| Build | **Vite 8** |
| Styling | **Tailwind CSS v4** (CSS-first `@theme`, class-based dark mode) |
| Components | **shadcn/ui**-style primitives on **Radix UI** |
| Motion | **Framer Motion** |
| Routing | **React Router 7** (lazy, code-split routes) |
| Charts | **Recharts** |
| Data | **TanStack React Query** (mock data services) |
| Icons | **Lucide** |
| Fonts | **Inter** (self-hosted via `@fontsource-variable/inter`) |

---

## Getting started

```bash
cd frontend
npm install        # (use --legacy-peer-deps if your npm is strict about React 19 peers)
npm run dev        # start the dev server (http://localhost:5173)
npm run build      # production build to dist/
npm run preview    # preview the production build
npm run lint       # ESLint
```

---

## Features

- **App shell** — collapsible animated sidebar (icon-rail with tooltips),
  glassmorphic sticky top bar, global search, notifications, dark-mode toggle,
  workspace switcher, and profile menu.
- **⌘K command palette** — fuzzy navigation and quick actions (`cmdk`).
- **Dashboard** — hero header, 8 KPI cards (icon · trend · sparkline · status),
  and 10 visualizations: interactive availability map, regional access-risk
  heatmap, availability & shortage-pressure trends, signal-freshness timeline,
  confidence distribution, top categories, jurisdiction comparison, API usage,
  and partner participation.
- **ZoikoSignal™** — shortage intelligence, demand movement, restock signals
  with a filter bar (date range · medicine group · country · region · category)
  and export.
- **ZoikoAvail™ API** — health strip, latency/throughput charts, endpoint cards,
  request/response viewer, security status, auth flow, and rate limits.
- **MediBase™** — schematic medicine-identity graph, identifier mapping,
  normalization/governance status, quality tiers, and a searchable identity table.
- **Health Systems / Government / Enterprise** — sector solution pages with a
  layered architecture diagram, use cases, procurement readiness, and an
  implementation timeline.
- **Reports** — saved / scheduled reports, downloads, and an export center
  (client-side JSON/CSV export).
- **Settings** — deep-linkable tabs: organization, members, roles & permissions,
  security, audit log, API keys, integrations, and billing.
- **Light & dark themes**, responsive down to mobile, loading skeletons, empty
  and error states, and page/route transitions.

---

## Design system

- **Tokens** live as CSS custom properties in [`src/index.css`](src/index.css)
  and are mapped into Tailwind via `@theme inline`, so every semantic utility
  (`bg-card`, `text-muted-foreground`, `border-border`, …) swaps by theme.
- **Dark mode** is class-based (`<html class="dark">`), applied before paint to
  avoid a flash, and persisted to `localStorage`.
- **Chart palette** — the categorical series colors were validated for
  colour-vision-deficiency separation and surface contrast in **both** light and
  dark modes (charts reference `var(--chart-1..8)` so they recolor instantly on
  theme toggle). Legends are always present and identity is never conveyed by
  color alone.
- **Accessibility (WCAG 2.2)** — visible focus rings, status conveyed with
  icon + text + color, accessible dialog/menu semantics via Radix, keyboard
  support, and `prefers-reduced-motion` handling.

---

## Project structure

```
src/
  components/
    ui/          shadcn-style primitives (button, card, dialog, table, …)
    charts/      Recharts wrappers (trend, bar, donut, heatmap, radial, sparkline)
    shared/      KpiCard, ChartCard, DataTable, PageHeader, status, states, …
  features/      page-specific composite visuals (availability map, identity graph, architecture)
  layouts/       AppLayout, Sidebar, Topbar, CommandPalette
  pages/         one file per route
  providers/     ThemeProvider, QueryProvider
  hooks/         useMediaQuery
  services/      mock intelligence datasets + React Query hooks
  utils/         formatting, chart tokens, export helpers
  routes/        router + navigation config
```

---

## Routes

`/dashboard` · `/zoikosignal` · `/zoikoavail` · `/medibase` ·
`/health-systems` · `/government` · `/enterprise` · `/reports` · `/settings`
(`/` redirects to `/dashboard`).

---

## Notes

- The project is authored in **JSX/JavaScript** with a `jsconfig.json` providing
  the `@/*` path alias for editor tooling. The `@` alias resolves to `src/` at
  build time via [`vite.config.js`](vite.config.js).
- All datasets are mock/synthetic and generated deterministically so charts are
  stable across reloads. Swap the modules in `src/services/` for a real,
  governed API when wiring a backend.
