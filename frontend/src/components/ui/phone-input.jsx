import { useState, useEffect, useMemo, useRef } from 'react'
import { getCountries, getCountryCallingCode } from 'react-phone-number-input'
import { ChevronDown, Search, Check } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
// The length tables belong with the validation rules that read them. Re-exported
// here so the pages already importing them from this component keep working.
import { COUNTRY_MAX_DIGITS, COUNTRY_MIN_DIGITS } from '@/lib/phone'

export { COUNTRY_MAX_DIGITS, COUNTRY_MIN_DIGITS }

/** Convert ISO2 country code (e.g., 'IN') to Flag Emoji (🇮🇳). */
export function getCountryEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🌐'
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}

/** Automatically detect country ISO2 code from locale, timezone, or default fallback. */
export function detectUserCountry() {
  try {
    // 1. Check navigator language
    const lang = (navigator.language || (navigator.languages && navigator.languages[0]) || '').toUpperCase()
    if (lang.includes('-')) {
      const countryFromLang = lang.split('-')[1]
      if (countryFromLang && countryFromLang.length === 2 && getCountries().includes(countryFromLang)) {
        return countryFromLang
      }
    }

    // 2. Check browser TimeZone
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    if (tz.includes('Kolkata') || tz.includes('Calcutta') || tz.includes('India')) return 'IN'
    if (tz.includes('New_York') || tz.includes('Chicago') || tz.includes('Los_Angeles') || tz.includes('Denver')) return 'US'
    if (tz.includes('London')) return 'GB'
    if (tz.includes('Berlin') || tz.includes('Munich') || tz.includes('Frankfurt')) return 'DE'
    if (tz.includes('Dubai')) return 'AE'
    if (tz.includes('Kuala_Lumpur') || tz.includes('Malaysia')) return 'MY'
    if (tz.includes('Singapore')) return 'SG'
    if (tz.includes('Riyadh')) return 'SA'
    if (tz.includes('Sydney') || tz.includes('Melbourne')) return 'AU'
    if (tz.includes('Toronto') || tz.includes('Vancouver')) return 'CA'
  } catch {
    /* ignore detection errors */
  }
  return 'IN' // Default fallback
}

const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })

// Curated list of prominent countries (India, USA, UK, Dubai/UAE, Malaysia, Germany, Canada, Singapore, Saudi Arabia, Australia, etc.)
const PRIORITY_COUNTRIES = [
  'IN', // India (+91)
  'US', // USA (+1)
  'GB', // UK (+44)
  'AE', // UAE / Dubai (+971)
  'MY', // Malaysia (+60)
  'SG', // Singapore (+65)
  'SA', // Saudi Arabia (+966)
  'AU', // Australia (+61)
  'CA', // Canada (+1)
  'DE', // Germany (+49)
  'FR', // France (+33)
  'JP', // Japan (+81)
  'CN', // China (+86)
  'BR', // Brazil (+55)
  'MX', // Mexico (+52)
  'IT', // Italy (+39)
  'ES', // Spain (+34 font)
  'NL', // Netherlands (+31)
  'KR', // South Korea (+82)
  'ZA', // South Africa (+27)
  'NZ', // New Zealand (+64)
  'PK', // Pakistan (+92)
  'BD', // Bangladesh (+880)
  'LK', // Sri Lanka (+94)
  'ID', // Indonesia (+62)
]

export function PhoneInput({
  value = '',
  onChange,
  onCountryChange,
  countryProp,
  disabled = false,
  error = false,
  className,
  id = 'phone',
  onBlur,
  onFocus,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
}) {
  const [country, setCountry] = useState(() => countryProp || detectUserCountry())
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef(null)

  // Synchronize country prop if passed externally
  useEffect(() => {
    if (countryProp && countryProp !== country) {
      setCountry(countryProp)
    }
  }, [countryProp])

  // Notify parent of initial country on mount
  useEffect(() => {
    onCountryChange && onCountryChange(country)
  }, [])

  // Build full country list with localized names, flag emoji, and dial code
  const countryList = useMemo(() => {
    const allCodes = getCountries()
    const mapped = allCodes
      .map((iso2) => {
        let name = iso2
        try {
          name = displayNames.of(iso2) || iso2
        } catch {
          name = iso2
        }
        let dialCode = ''
        try {
          dialCode = getCountryCallingCode(iso2)
        } catch {
          dialCode = ''
        }
        return {
          iso2,
          name,
          dialCode: `+${dialCode}`,
          emoji: getCountryEmoji(iso2),
          isPriority: PRIORITY_COUNTRIES.includes(iso2),
        }
      })
      .filter((c) => Boolean(c.dialCode))

    // Sort priority countries first, then rest alphabetically
    return mapped.sort((a, b) => {
      const aP = PRIORITY_COUNTRIES.indexOf(a.iso2)
      const bP = PRIORITY_COUNTRIES.indexOf(b.iso2)
      if (aP !== -1 && bP !== -1) return aP - bP
      if (aP !== -1) return -1
      if (bP !== -1) return 1
      return a.name.localeCompare(b.name)
    })
  }, [])

  // Filter countries by search term
  const filteredCountries = useMemo(() => {
    if (!search.trim()) return countryList
    const q = search.toLowerCase().trim()
    return countryList.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.iso2.toLowerCase().includes(q) ||
        c.dialCode.includes(q)
    )
  }, [countryList, search])

  // Current country dial code (e.g. +91)
  const currentDialCode = useMemo(() => {
    try {
      return `+${getCountryCallingCode(country)}`
    } catch {
      return '+91'
    }
  }, [country])

  // Local phone digits state
  const [localNumber, setLocalNumber] = useState(() => {
    if (value && value.startsWith('+')) {
      if (value.startsWith(currentDialCode)) {
        return value.slice(currentDialCode.length).replace(/\D/g, '')
      }
      return value.replace(/\D/g, '')
    }
    return (value || '').replace(/\D/g, '')
  })

  // Sync state if value changes externally
  useEffect(() => {
    if (!value) {
      setLocalNumber('')
      return
    }
    if (value.startsWith('+')) {
      if (value.startsWith(currentDialCode)) {
        setLocalNumber(value.slice(currentDialCode.length).replace(/\D/g, ''))
      }
    }
  }, [value, currentDialCode])

  const maxDigits = COUNTRY_MAX_DIGITS[country] || 15

  // Handle local number input changes (strictly digits only and capped at country maxDigits)
  const handleNumberChange = (e) => {
    const rawVal = e.target.value
    const digitsOnly = rawVal.replace(/\D/g, '').slice(0, maxDigits)
    setLocalNumber(digitsOnly)

    if (!digitsOnly) {
      onChange && onChange('')
      return
    }

    const fullE164 = `${currentDialCode}${digitsOnly}`
    onChange && onChange(fullE164)
  }

  // Prevent non-digit keystrokes (letters, special characters, symbols)
  const handleKeyDown = (e) => {
    const allowedControlKeys = [
      'Backspace',
      'Delete',
      'Tab',
      'Escape',
      'Enter',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Home',
      'End',
    ]

    // Allow Ctrl/Cmd shortcut key combinations (Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X)
    if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) {
      return
    }

    if (allowedControlKeys.includes(e.key)) {
      return
    }

    // Block non-digits 0-9
    if (!/^[0-9]$/.test(e.key)) {
      e.preventDefault()
    }
  }

  // Handle Paste Event (sanitize clipboard text to digits only and capped at country maxDigits)
  const handlePaste = (e) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData('text') || ''
    const digitsOnly = pastedText.replace(/\D/g, '')
    if (!digitsOnly) return

    const combined = `${localNumber}${digitsOnly}`.slice(0, maxDigits)
    setLocalNumber(combined)
    const fullE164 = `${currentDialCode}${combined}`
    onChange && onChange(fullE164)
  }

  // Handle country selection
  const handleSelectCountry = (iso2) => {
    setCountry(iso2)
    onCountryChange && onCountryChange(iso2)
    setOpen(false)
    setSearch('')

    let newDialCode = '+91'
    try {
      newDialCode = `+${getCountryCallingCode(iso2)}`
    } catch {
      newDialCode = '+91'
    }

    const countryMax = COUNTRY_MAX_DIGITS[iso2] || 15
    const truncatedLocal = localNumber.slice(0, countryMax)
    setLocalNumber(truncatedLocal)

    if (truncatedLocal) {
      const fullE164 = `${newDialCode}${truncatedLocal}`
      onChange && onChange(fullE164)
    } else {
      onChange && onChange('')
    }
  }

  const selectedEmoji = useMemo(() => getCountryEmoji(country), [country])

  return (
    <div
      className={cn(
        'group flex h-10 w-full items-center rounded-xl border border-input bg-background text-foreground transition-all shadow-xs',
        'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
        error && 'border-red-500 focus-within:border-red-500 focus-within:ring-red-500/20',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      {/* Country Code Selector Trigger */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            className="flex h-full items-center gap-1.5 rounded-l-xl px-3 text-xs font-semibold text-foreground hover:bg-muted/60 transition-colors outline-none cursor-pointer shrink-0"
            aria-label="Select country code"
          >
            {/* Flag Emoji with line-height reset for vertical centering */}
            <span className="inline-flex items-center text-base leading-none">{selectedEmoji}</span>
            {/* Dial Code with mono font and flex alignment */}
            <span className="inline-flex items-center font-mono text-xs font-semibold leading-none">{currentDialCode}</span>
            {/* Chevron Icon vertically centered */}
            <ChevronDown className="size-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-72 p-0 shadow-xl rounded-xl border border-border bg-popover text-popover-foreground z-50"
        >
          {/* Country Search Bar */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search country or dial code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 focus-visible:outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* Country Dropdown List */}
          <div className="max-h-60 overflow-y-auto p-1 text-xs">
            {filteredCountries.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matching country found
              </div>
            ) : (
              filteredCountries.map((c) => {
                const isSelected = c.iso2 === country
                return (
                  <button
                    key={c.iso2}
                    type="button"
                    onClick={() => handleSelectCountry(c.iso2)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors cursor-pointer text-left',
                      isSelected ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted/60 text-foreground'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-base leading-none">{c.emoji}</span>
                      <span className="truncate text-xs font-medium">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-xs text-muted-foreground">{c.dialCode}</span>
                      {isSelected && <Check className="size-3.5 text-primary" />}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Vertically Centered Divider Line (Exact 20px height, centered in 40px container) */}
      <span className="h-5 w-px bg-border shrink-0 self-center" aria-hidden="true" />

      {/* Local Phone Number Input Field (Matched h-full & flex alignment) */}
      <Input
        id={id}
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={maxDigits}
        autoComplete="tel-local"
        disabled={disabled}
        placeholder={country === 'IN' ? '9876543210' : '9876543210'}
        value={localNumber}
        onChange={handleNumberChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={onBlur}
        onFocus={onFocus}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        className="h-full w-full border-none bg-transparent px-3 text-sm font-medium leading-none text-foreground placeholder:text-muted-foreground/60 shadow-none outline-none focus-visible:ring-0 focus-visible:outline-none"
      />
    </div>
  )
}
