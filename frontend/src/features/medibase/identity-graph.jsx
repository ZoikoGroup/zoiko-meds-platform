import { motion } from 'framer-motion'
import { FlaskConical, Globe2, Ruler, ShieldCheck, Tag } from 'lucide-react'
import { identityGraph } from '@/services/medibase-data'

const ICONS = {
  brand: Tag,
  strength: Ruler,
  form: FlaskConical,
  market: Globe2,
  quality: ShieldCheck,
}

const RX = 34
const RY = 38

/** Schematic radial identity graph: a governed generic root fanning out to its
 *  brand / strength / form / market / governance layers. */
export function MedicineIdentityGraph() {
  const points = identityGraph.branches.map((b) => {
    const rad = (b.angle * Math.PI) / 180
    return { ...b, x: 50 + RX * Math.cos(rad), y: 50 + RY * Math.sin(rad) }
  })

  return (
    <div className="relative h-[340px] w-full sm:h-[360px]">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {points.map((p) => (
          <line
            key={p.id}
            x1="50"
            y1="50"
            x2={p.x}
            y2={p.y}
            stroke="var(--chart-grid)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
        <div className="flex flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-br from-primary to-teal px-5 py-3 text-white shadow-elevated">
          <span className="text-[10px] uppercase tracking-wider opacity-80">
            Generic root
          </span>
          <span className="text-sm font-semibold">{identityGraph.root.label}</span>
        </div>
      </div>

      {points.map((p, i) => {
        const Icon = ICONS[p.kind]
        return (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.12 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
            className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-soft">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium">{p.label}</span>
                <span className="text-[11px] text-muted-foreground">{p.value}</span>
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
