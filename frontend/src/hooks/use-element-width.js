import { useEffect, useRef, useState } from 'react'

/**
 * The rendered width of an element, tracked as it changes.
 *
 * For the cases a CSS container query cannot reach — a chart library that wants
 * a pixel number for its axis, not a class. Everything that can be expressed in
 * CSS should be, because this costs a ResizeObserver and a render.
 *
 * Returns [ref, width]. Width is 0 until the first measurement, so callers must
 * have a sensible answer for "not measured yet" rather than dividing by it.
 */
export function useElementWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    // Guard for environments without ResizeObserver (jsdom in the test suite):
    // the element simply stays unmeasured and the caller keeps its default.
    if (typeof ResizeObserver === 'undefined') {
      setWidth(node.getBoundingClientRect().width)
      return
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return [ref, width]
}
