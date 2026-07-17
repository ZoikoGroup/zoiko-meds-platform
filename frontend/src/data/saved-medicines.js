// Static demo data for the Saved Medicines page.
//
// Shaped to mirror what a real API (e.g. GET /me/saved) would return, so this
// import can later be swapped for a fetched response without changing the
// component structure. Each entry is the minimal identity + alert preference —
// no pharmacy/availability data is stored here by design.
export const savedMedicines = [
  { id: 'dolo-650', name: 'Dolo 650', generic: 'Paracetamol', strength: '650 mg', alertsEnabled: true },
  { id: 'metformin-500', name: 'Metformin 500', generic: 'Metformin', strength: '500 mg', alertsEnabled: true },
  { id: 'thyronorm-75', name: 'Thyronorm 75', generic: 'Thyroxine', strength: '75 mcg', alertsEnabled: true },
  { id: 'pantoprazole-40', name: 'Pantoprazole 40', generic: 'Pantoprazole', strength: '40 mg', alertsEnabled: false },
  { id: 'augmentin-625', name: 'Augmentin 625', generic: 'Amoxicillin + Clavulanate', strength: '625 mg', alertsEnabled: true },
]
