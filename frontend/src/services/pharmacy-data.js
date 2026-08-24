// Static demo data for the Pharmacy Portal.
//
// The backend has NO pharmacy self-service endpoints yet (the `pharmacy` module
// is public read-only; `admin/pharmacy` is admin-scoped). This file is the
// single source of demo data — replace each export with a real API response
// (see services/pharmacy-api.js TODOs) without touching the pages.

// status ∈ available | limited | out-of-stock
export const INVENTORY = [
  { id: 'inv-1', name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg', dosageForm: 'Tablet', status: 'available', confidence: 'high', updated: '8 minutes ago' },
  { id: 'inv-2', name: 'Metformin 500', generic: 'Metformin', strength: '500 mg', dosageForm: 'Extended-release tablet', status: 'available', confidence: 'high', updated: 'just now' },
  { id: 'inv-3', name: 'Thyronorm 75', generic: 'Thyroxine', strength: '75 mcg', dosageForm: 'Tablet', status: 'limited', confidence: 'moderate', updated: '22 minutes ago' },
  { id: 'inv-4', name: 'Augmentin 625', generic: 'Amoxicillin + Clavulanate', strength: '625 mg', dosageForm: 'Tablet', status: 'out-of-stock', confidence: 'unknown', updated: '1 hour ago' },
  { id: 'inv-5', name: 'Pantoprazole 40', generic: 'Pantoprazole', strength: '40 mg', dosageForm: 'Gastro-resistant tablet', status: 'available', confidence: 'high', updated: '35 minutes ago' },
  { id: 'inv-6', name: 'Azithromycin 500', generic: 'Azithromycin', strength: '500 mg', dosageForm: 'Tablet', status: 'limited', confidence: 'moderate', updated: '2 hours ago' },
  { id: 'inv-7', name: 'Cetirizine 10', generic: 'Cetirizine', strength: '10 mg', dosageForm: 'Tablet', status: 'available', confidence: 'high', updated: '12 minutes ago' },
  { id: 'inv-8', name: 'Amlodipine 5', generic: 'Amlodipine', strength: '5 mg', dosageForm: 'Tablet', status: 'available', confidence: 'high', updated: '40 minutes ago' },
  { id: 'inv-9', name: 'Insulin Glargine', generic: 'Insulin glargine', strength: '100 U/mL', dosageForm: 'Injection pen', status: 'out-of-stock', confidence: 'unknown', updated: '3 hours ago' },
  { id: 'inv-10', name: 'Losartan 50', generic: 'Losartan', strength: '50 mg', dosageForm: 'Tablet', status: 'available', confidence: 'high', updated: '18 minutes ago' },
  { id: 'inv-11', name: 'Omeprazole 20', generic: 'Omeprazole', strength: '20 mg', dosageForm: 'Capsule', status: 'limited', confidence: 'moderate', updated: '1 hour ago' },
  { id: 'inv-12', name: 'Doxycycline 100', generic: 'Doxycycline', strength: '100 mg', dosageForm: 'Capsule', status: 'available', confidence: 'high', updated: '55 minutes ago' },
  { id: 'inv-13', name: 'Montelukast 10', generic: 'Montelukast', strength: '10 mg', dosageForm: 'Tablet', status: 'available', confidence: 'high', updated: '5 minutes ago' },
  { id: 'inv-14', name: 'Pregabalin 75', generic: 'Pregabalin', strength: '75 mg', dosageForm: 'Capsule', status: 'limited', confidence: 'moderate', updated: '2 hours ago' },
]

export const AVAILABILITY_STATUSES = [
  { value: 'available', label: 'Available' },
  { value: 'limited', label: 'Limited Stock' },
  { value: 'out-of-stock', label: 'Out of Stock' },
]

// status → <StatusBadge> tone + label (tones defined in components/shared/status).
export const STATUS_META = {
  available: { tone: 'good', label: 'Available' },
  limited: { tone: 'warning', label: 'Limited stock' },
  'out-of-stock': { tone: 'critical', label: 'Out of stock' },
}

// Dashboard recent inventory updates + pending queue.
export const RECENT_UPDATES = [
  { id: 'r1', name: 'Dolo 650', status: 'available', when: '8 minutes ago', by: 'Keiko Tanaka' },
  { id: 'r2', name: 'Metformin 500', status: 'available', when: 'just now', by: 'Auto sync' },
  { id: 'r3', name: 'Thyronorm 75', status: 'limited', when: '22 minutes ago', by: 'Keiko Tanaka' },
  { id: 'r4', name: 'Augmentin 625', status: 'out-of-stock', when: '1 hour ago', by: 'Lena Hoffmann' },
]

export const PENDING_UPDATES = [
  { id: 'p1', name: 'Cetirizine 10', reason: 'Signal older than 24h — reconfirm availability' },
  { id: 'p2', name: 'Insulin Glargine', reason: 'Marked out of stock 3h ago — update if restocked' },
  { id: 'p3', name: 'Pregabalin 75', reason: 'Limited stock — confirm quantity band' },
]

// type ∈ inventory | verification | upload | system
export const NOTIFICATIONS = [
  { id: 'n1', type: 'inventory', title: 'Augmentin 625 marked out of stock', message: 'Availability dropped below the confidence threshold for your network.', when: '1 hour ago', unread: true },
  { id: 'n2', type: 'verification', title: 'Verification renewed', message: 'Your pharmacy licence verification was renewed for 12 months.', when: 'Yesterday', unread: true },
  { id: 'n3', type: 'upload', title: 'CSV upload completed', message: '128 rows processed, 3 skipped (invalid strength).', when: 'Yesterday', unread: false },
  { id: 'n4', type: 'system', title: 'Scheduled maintenance', message: 'Partner APIs may be briefly unavailable Sunday 02:00–03:00 UTC.', when: '2 days ago', unread: false },
  { id: 'n5', type: 'upload', title: 'Upload failed', message: 'A CSV upload failed validation: missing required “name” column.', when: '3 days ago', unread: false },
]

// Participation + data-quality metrics (0–100 unless noted).
export const PARTICIPATION = {
  reliabilityScore: 92,
  participationScore: 87,
  updateFrequencyPerWeek: 34,
  dataQuality: 95,
  freshnessHours: 0.4,
  coverage: 89,
}

// Pharmacy profile (would come from GET /pharmacy/:id or a /pharmacy/me endpoint).
export const PROFILE = {
  name: 'Apollo Pharmacy',
  licenseNumber: 'LIC-HYD-01',
  verificationStatus: 'VERIFIED',
  phone: '+91 40 2345 6789',
  email: 'kompally@apollopharmacy.in',
  addressLine1: 'Kompally Main Rd',
  city: 'Hyderabad',
  region: 'Telangana',
  country: 'India',
  postalCode: '500014',
  is24x7: true,
  hours: [
    { day: 'Mon–Fri', open: '08:00', close: '22:00' },
    { day: 'Saturday', open: '08:00', close: '22:00' },
    { day: 'Sunday', open: '09:00', close: '21:00' },
  ],
}

// Reports & analytics (simple series for the charts).
export const REPORTS = {
  statusBreakdown: [
    { label: 'Available', value: 9 },
    { label: 'Limited', value: 4 },
    { label: 'Out of stock', value: 2 },
  ],
  availabilityTrend: [
    { label: 'Mon', value: 86 }, { label: 'Tue', value: 88 }, { label: 'Wed', value: 84 },
    { label: 'Thu', value: 90 }, { label: 'Fri', value: 92 }, { label: 'Sat', value: 89 }, { label: 'Sun', value: 91 },
  ],
  frequentlyRequested: [
    { name: 'Dolo 650', requests: 412 },
    { name: 'Metformin 500', requests: 289 },
    { name: 'Augmentin 625', requests: 254 },
    { name: 'Pantoprazole 40', requests: 176 },
    { name: 'Cetirizine 10', requests: 132 },
  ],
  updateActivity: [
    { label: 'Mon', value: 6 }, { label: 'Tue', value: 8 }, { label: 'Wed', value: 5 },
    { label: 'Thu', value: 9 }, { label: 'Fri', value: 7 }, { label: 'Sat', value: 4 }, { label: 'Sun', value: 3 },
  ],
}
