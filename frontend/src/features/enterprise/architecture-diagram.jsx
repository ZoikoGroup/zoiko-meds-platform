import { motion } from 'framer-motion'
import { ArrowDown } from 'lucide-react'
import { architectureLayers } from '@/services/sector-data'

/** Layered data-flow diagram: governed sources → identity → intelligence → delivery. */
export function ArchitectureDiagram() {
  return (
    <div className="flex flex-col items-center">
      {architectureLayers.map((layer, i) => (
        <div key={layer.id} className="w-full">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: i * 0.06 }}
            className="flex flex-col gap-3 rounded-xl border border-border bg-gradient-to-r from-muted/50 to-card p-4 sm:flex-row sm:items-center"
          >
            <div className="flex items-center gap-2.5 sm:w-60 sm:shrink-0">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="text-sm font-semibold">{layer.label}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {layer.nodes.map((n) => (
                <span
                  key={n}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-xs"
                >
                  {n}
                </span>
              ))}
            </div>
          </motion.div>
          {i < architectureLayers.length - 1 && (
            <div className="flex justify-center py-1.5">
              <ArrowDown className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
