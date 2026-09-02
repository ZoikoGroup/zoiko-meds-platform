/**
 * Matching key for a medicine name.
 *
 * Mirrors `normalizeMedicineName` in the API (backend:
 * modules/saved-link/saved-medicine-link.service.ts) so the client decides
 * "is this saved?" exactly as the server decides "is this the same medicine?".
 *
 * Lower-cases and drops every non-alphanumeric character, so "Volini Gel",
 * "volini-gel" and "VOLINI  GEL" share a key. Deliberately conservative: it
 * absorbs formatting, never spelling.
 */
export function normalizeMedicineKey(name) {
  return (name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Is `medicine` present in the patient's saved list?
 *
 * Prefers the governed MediBase id when both sides have one; falls back to the
 * normalized name so a medicine saved before the catalog knew about it still
 * reads as saved — and continues to once a pharmacy links it.
 */
export function isMedicineSaved(savedMedicines, medicine) {
  if (!medicine?.name && !medicine?.id) return false
  const key = normalizeMedicineKey(medicine.name)
  return (savedMedicines ?? []).some((saved) => {
    if (medicine.id && saved.id) return saved.id === medicine.id
    return !!key && normalizeMedicineKey(saved.name) === key
  })
}
