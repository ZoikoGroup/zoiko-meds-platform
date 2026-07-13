// Shared presentation metadata for ZoikoSignal™. Maps medicine-availability
// statuses and notification types to their icon, colour tone, and label so the
// page, home widget, and cards all render them identically. Tones align with
// the shared <StatusBadge> tones (good/warning/serious/critical/neutral).
import {
  TrendingDown,
  PackageCheck,
  AlertTriangle,
  MapPin,
  ShieldAlert,
  Siren,
  CheckCircle2,
  MinusCircle,
} from 'lucide-react'

// Saved-medicine availability status.
export const STATUS_META = {
  available: { label: 'Available', tone: 'good', dot: 'bg-success', icon: CheckCircle2 },
  limited: { label: 'Limited Stock', tone: 'warning', dot: 'bg-warning', icon: AlertTriangle },
  'running-low': { label: 'Running Low', tone: 'critical', dot: 'bg-danger', icon: TrendingDown },
  'out-of-stock': { label: 'Out of Stock', tone: 'neutral', dot: 'bg-muted-foreground', icon: MinusCircle },
}

// Notification / alert types.
export const NOTIF_META = {
  'running-low': {
    label: 'Running Low',
    icon: TrendingDown,
    tone: 'critical',
    chip: 'bg-danger/10 text-danger',
    text: 'text-danger',
    dot: 'bg-danger',
  },
  'back-in-stock': {
    label: 'Back in Stock',
    icon: PackageCheck,
    tone: 'good',
    chip: 'bg-success/10 text-success',
    text: 'text-success',
    dot: 'bg-success',
  },
  limited: {
    label: 'Limited Availability',
    icon: AlertTriangle,
    tone: 'warning',
    chip: 'bg-warning/12 text-warning',
    text: 'text-warning',
    dot: 'bg-warning',
  },
  'nearby-restock': {
    label: 'Nearby Restock',
    icon: MapPin,
    tone: 'serious',
    chip: 'bg-info/10 text-info',
    text: 'text-info',
    dot: 'bg-info',
  },
  recall: {
    label: 'Medicine Recall',
    icon: ShieldAlert,
    tone: 'critical',
    chip: 'bg-danger/10 text-danger',
    text: 'text-danger',
    dot: 'bg-danger',
  },
  safety: {
    label: 'Safety Advisory',
    icon: Siren,
    tone: 'serious',
    chip: 'bg-info/10 text-info',
    text: 'text-info',
    dot: 'bg-info',
  },
}

// Medicine priority (High / Medium / Low).
export const PRIORITY_META = {
  high: { label: 'High priority', variant: 'danger' },
  medium: { label: 'Medium priority', variant: 'warning' },
  low: { label: 'Low priority', variant: 'secondary' },
}

// Filter tabs for the notification feed.
export const NOTIF_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'running-low', label: 'Running Low' },
  { key: 'back-in-stock', label: 'Back in Stock' },
  { key: 'safety', label: 'Safety Alerts' },
]

// Notification preference toggles, grouped for the settings card.
export const SETTING_GROUPS = [
  {
    heading: 'Availability alerts',
    items: [
      { key: 'runningLow', title: 'Running low', desc: 'Notify me when a saved medicine is running low near me.' },
      { key: 'backInStock', title: 'Back in stock', desc: 'Notify me when a saved medicine is available again.' },
      { key: 'nearbyRestock', title: 'Nearby restock', desc: 'Notify me when a nearby pharmacy receives new stock.' },
    ],
  },
  {
    heading: 'Safety',
    items: [
      { key: 'recall', title: 'Medicine recall alerts', desc: 'Manufacturer or regulator recall notices for medicines you follow.' },
      { key: 'safety', title: 'Government safety alerts', desc: 'National health advisories for your saved medicine classes.' },
    ],
  },
  {
    heading: 'Channels',
    items: [
      { key: 'push', title: 'Push notifications', desc: 'Receive alerts on this device.' },
      { key: 'email', title: 'Email notifications', desc: 'Receive a summary by email.' },
      { key: 'sms', title: 'SMS notifications', desc: 'Receive urgent alerts by text message.' },
    ],
  },
]
