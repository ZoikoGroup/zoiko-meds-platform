import { useCallback, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Minimal, provider-free inline feedback. Replaces blocking `alert()` calls
 * with an accessible, self-dismissing status message rendered by <Flash>.
 *
 *   const [msg, flash] = useFlash()
 *   <Flash message={msg} />
 *   <Button onClick={() => flash('Preferences saved')}>Save</Button>
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useFlash(timeout = 2600) {
  const [message, setMessage] = useState('')
  const timer = useRef(null)

  const flash = useCallback(
    (msg) => {
      setMessage(msg)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setMessage(''), timeout)
    },
    [timeout],
  )

  return [message, flash]
}

export function Flash({ message, className }) {
  if (!message) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-sm font-medium text-success',
        className,
      )}
    >
      <CheckCircle2 className="size-4 shrink-0" aria-hidden />
      {message}
    </div>
  )
}
