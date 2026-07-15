import { useState, useEffect } from 'react'
import { matchMedicines } from '@/services/medicine-api'

/**
 * Debounced live MediBase™ autocomplete. Backed by /medibase/match — no mock
 * data. Returns governed identity candidates plus loading/error state so the
 * caller can render the full lifecycle.
 */
export function useMedicineSuggestions(query, { limit = 7, debounceMs = 200 } = {}) {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const q = (query || '').trim()
    if (!q) {
      setSuggestions([])
      setLoading(false)
      setError(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(false)
    const t = setTimeout(() => {
      matchMedicines(q, limit)
        .then((rows) => { if (alive) { setSuggestions(rows); setLoading(false) } })
        .catch(() => { if (alive) { setSuggestions([]); setError(true); setLoading(false) } })
    }, debounceMs)
    return () => { alive = false; clearTimeout(t) }
  }, [query, limit, debounceMs])

  return { suggestions, loading, error }
}
