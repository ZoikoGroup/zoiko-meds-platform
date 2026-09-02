import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import { StatusBadge } from '@/components/shared/status'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PharmacyOnboardingState } from '@/components/shared/pharmacy-onboarding-state'
import { getDashboard } from '@/services/pharmacy-api'
import { STATUS_META } from '@/services/pharmacy-data'
import {
  Boxes, CheckCircle2, AlertTriangle, XCircle, Clock, Bell, Upload, Activity,
  ArrowRight, Loader2, Info,
} from 'lucide-react'

const STAT_META = [
  { key: 'total', label: 'Total medicines', icon: Boxes },
  { key: 'available', label: 'Available', icon: CheckCircle2, severity: 'good' },
  { key: 'limited', label: 'Limited stock', icon: AlertTriangle, severity: 'warning' },
  { key: 'outOfStock', label: 'Out of stock', icon: XCircle, severity: 'critical' },
  { key: 'pending', label: 'Pending updates', icon: Clock, severity: 'serious' },
]

const QUICK_ACTIONS = [
  { title: 'Update inventory', desc: 'Add, edit, or update availability.', icon: Boxes, to: '/pharmacy/inventory' },
  { title: 'Upload CSV', desc: 'Bulk-import your stock list.', icon: Upload, to: '/pharmacy/upload' },
  { title: 'Set availability', desc: 'Confirm status per medicine.', icon: Activity, to: '/pharmacy/availability' },
]

export default function PharmacyDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [notLinked, setNotLinked] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () => {
      getDashboard()
        .then((d) => {
          if (!alive) return
          setData(d)
          setNotLinked(false)
        })
        .catch((err) => {
          // No pharmacy linked yet: point at onboarding instead of leaving the
          // spinner up or showing demo stats as if they were the operator's.
          if (alive && err?.notLinked) setNotLinked(true)
        })
    }
    load()
    window.addEventListener('pharmacy-inventory-updated', load)
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('pharmacy-inventory-updated', load)
      window.removeEventListener('focus', load)
    }
  }, [])

  if (notLinked) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Pharmacy dashboard"
          subtitle="Your availability signals, stock health, and pending updates."
        />
        <PharmacyOnboardingState className="max-w-4xl" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading dashboard…
      </div>
    )
  }

  const { stats, recentUpdates, pendingUpdates, notifications } = data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pharmacy dashboard"
        subtitle="Your medicine availability at a glance — keep signals fresh to raise your reliability score."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {STAT_META.map((s) => (
          <StatTile key={s.key} label={s.label} value={stats[s.key] ?? 0} icon={s.icon} severity={s.severity} />
        ))}
      </div>

      {/* Quick actions */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.title}
              onClick={() => navigate(a.to)}
              className="group flex items-start gap-3.5 rounded-2xl border border-border bg-card p-5 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-card"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-sm font-bold text-foreground">
                  {a.title}
                  <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{a.desc}</span>
              </span>
            </button>
          )
        })}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent inventory updates */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Clock className="size-4 text-primary" />
            Recent inventory updates
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {recentUpdates.map((r) => {
              const meta = STATUS_META[r.status]
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.when} · {r.by}</span>
                  </div>
                  <StatusBadge tone={meta.tone} size="sm">{meta.label}</StatusBadge>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Pending updates */}
        <Card className="flex flex-col gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="size-4 text-warning" />
            Pending updates
          </h3>
          {pendingUpdates.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">You’re all caught up.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {pendingUpdates.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-foreground">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.reason}</span>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => navigate('/pharmacy/inventory')}>Update</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* System notifications */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Bell className="size-4 text-primary" />
            System notifications
          </h3>
          <button
            onClick={() => navigate('/pharmacy/notifications')}
            className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            View all <ArrowRight className="size-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {notifications.map((n) => (
            <Card key={n.id} className="flex items-start gap-3 p-4">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Info className="size-4" />
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground">{n.title}</span>
                <span className="truncate text-xs text-muted-foreground">{n.message}</span>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
