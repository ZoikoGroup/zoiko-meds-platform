import { Check, HelpCircle, Pill, ScanLine } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Compact selector for medicines read from a scanned prescription.
 *
 * A prescription usually lists several medicines, but availability is searched
 * one medicine at a time. Without this the user had to re-scan the
 * prescription for every medicine on it, because moving to the search view
 * unmounted the scan results.
 *
 * Purely presentational — the page owns the list and the active selection.
 */
export function DetectedMedicinesBar({
  medicines = [],
  activeName = '',
  onSelect,
  onScanAnother,
  onClear,
  t = (_key, fallback) => fallback,
}) {
  if (!medicines.length) return null

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <ScanLine className="size-3.5" />
          {t('detectedMedicines', 'Detected medicines')}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground">
            {medicines.length}
          </span>
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onScanAnother}>
            <ScanLine className="size-3.5" />
            {t('scanAnother', 'Scan another')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear}>
            {t('clear', 'Clear')}
          </Button>
        </div>
      </div>

      <ul className="flex flex-wrap gap-2">
        {medicines.map((medicine) => {
          const isActive = medicine.name === activeName
          const uncertain = medicine.needsConfirmation
          return (
            <li key={medicine.name}>
              <button
                type="button"
                onClick={() => onSelect?.(medicine)}
                aria-pressed={isActive}
                title={uncertain ? medicine.reason : medicine.detail}
                className={cn(
                  'flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? 'border-primary bg-primary/10 text-foreground'
                    : uncertain
                      ? 'border-warning/40 text-muted-foreground hover:border-warning/60 hover:text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {uncertain ? (
                  <HelpCircle className="size-3.5 shrink-0 text-warning" />
                ) : (
                  <Pill className="size-3.5 shrink-0 text-teal" />
                )}
                <span className="truncate">{medicine.name}</span>
                {medicine.strength && (
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">
                    {medicine.strength}
                  </span>
                )}
                {isActive && <Check className="size-3.5 shrink-0 text-primary" />}
              </button>
            </li>
          )
        })}
      </ul>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          'detectedMedicinesHelp',
          'Pick a medicine to check availability near you. Medicines marked with a “?” were read with lower certainty — check them against your prescription first.',
        )}
      </p>
    </Card>
  )
}
