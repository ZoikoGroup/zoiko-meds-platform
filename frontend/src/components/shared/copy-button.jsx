import { useEffect, useRef, useState } from 'react'
import { Copy, Check, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Write text to the clipboard, or report that it could not be done.
 *
 * `navigator.clipboard` is unavailable outside a secure context and can be
 * refused by permission policy, so it cannot be the only route. The fallback is
 * the older selection-and-execCommand path, which works wherever the modern API
 * is merely absent. Returns false rather than throwing: the caller's job is to
 * tell the operator, not to crash.
 */
async function writeToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through — a refusal here does not mean the fallback will fail.
    }
  }

  try {
    const scratch = document.createElement('textarea')
    scratch.value = text
    // Off-screen rather than hidden: an element with display:none or
    // visibility:hidden cannot hold a selection, so the copy would silently
    // succeed against nothing.
    scratch.setAttribute('readonly', '')
    scratch.style.position = 'fixed'
    scratch.style.top = '-9999px'
    scratch.style.opacity = '0'
    document.body.appendChild(scratch)
    scratch.select()
    scratch.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(scratch)
    return ok
  } catch {
    return false
  }
}

/**
 * Copy-to-clipboard button for a value the operator has to paste elsewhere.
 *
 * Reports the outcome either way. A button that changes nothing when the copy
 * fails is indistinguishable from one that is not wired up at all — which is
 * exactly how this read on the settings page (MP-20).
 */
export function CopyButton({
  value,
  label = 'Copy',
  variant = 'outline',
  size = 'sm',
  className,
  iconOnly = false,
}) {
  const [state, setState] = useState('idle')
  const timer = useRef(null)

  // A copy that resolves after the button has gone would set state on an
  // unmounted component; clearing the timer is what stops that.
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    const ok = await writeToClipboard(String(value ?? ''))
    setState(ok ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), ok ? 1800 : 4000)
  }

  const Icon = state === 'copied' ? Check : state === 'failed' ? TriangleAlert : Copy
  const text = state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : label

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={copy}
      disabled={!value}
      // The label carries the outcome for anyone not watching the icon.
      aria-label={iconOnly ? `${label}${state === 'copied' ? ' — copied' : ''}` : undefined}
      title={
        state === 'failed'
          ? 'Your browser blocked clipboard access. Select the value and copy it manually.'
          : undefined
      }
    >
      <Icon className="size-4" />
      {!iconOnly && text}
      {/* Announced to screen readers without changing the visible button. */}
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </Button>
  )
}
