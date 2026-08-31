import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listSaved,
  saveMedicine,
  unsaveMedicine,
  updateSavedMedicineAlerts,
  getUserOverview,
} from '@/services/user-api'
import {
  getSignalSummary,
  listSavedStatus,
  listActiveAlerts,
  listNotifications,
  getNotificationSettings,
  updateNotificationSettings,
  markRead,
  markAllRead,
  dismissNotification,
  archiveNotification,
  setMedicinePriority,
} from '@/services/signal-api'
import { readUserLocation, userLocationParams } from '@/lib/user-location'

export const SAVED_MEDICINES_QUERY_KEY = ['saved-medicines']
export const SIGNAL_SUMMARY_QUERY_KEY = ['signal-summary']
export const SIGNAL_SAVED_STATUS_QUERY_KEY = ['signal-saved-status']
export const SIGNAL_ALERTS_QUERY_KEY = ['signal-alerts']
export const SIGNAL_NOTIFICATIONS_QUERY_KEY = ['signal-notifications']
export const SIGNAL_SETTINGS_QUERY_KEY = ['signal-settings']
export const USER_OVERVIEW_QUERY_KEY = ['user-overview']

export function useInvalidateUserQueries() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: SAVED_MEDICINES_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: SIGNAL_SUMMARY_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: SIGNAL_SAVED_STATUS_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: SIGNAL_ALERTS_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: SIGNAL_NOTIFICATIONS_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY })
  }
}

/**
 * Saved medicines, each carrying the verified pharmacies near the patient.
 *
 * The stored location is part of the query key: change it and this refetches,
 * because "near me" means something different from the new place. It is the
 * label rather than the resolved coordinates so the key stays stable across
 * renders.
 */
export function useSavedMedicines() {
  const location = readUserLocation()
  return useQuery({
    queryKey: [...SAVED_MEDICINES_QUERY_KEY, location],
    queryFn: () => listSaved(userLocationParams()),
    staleTime: 10_000,
  })
}

export function useSaveMedicine() {
  const invalidate = useInvalidateUserQueries()
  return useMutation({
    mutationFn: (medicineId) => saveMedicine(medicineId),
    onSuccess: () => invalidate(),
  })
}

export function useUnsaveMedicine() {
  const invalidate = useInvalidateUserQueries()
  return useMutation({
    mutationFn: (medicineId) => unsaveMedicine(medicineId),
    onSuccess: () => invalidate(),
  })
}

export function useToggleSavedAlerts() {
  const invalidate = useInvalidateUserQueries()
  return useMutation({
    mutationFn: ({ medicineId, alertsEnabled }) =>
      updateSavedMedicineAlerts(medicineId, alertsEnabled),
    onSuccess: () => invalidate(),
  })
}

export function useSignalSummary() {
  return useQuery({
    queryKey: SIGNAL_SUMMARY_QUERY_KEY,
    queryFn: getSignalSummary,
    staleTime: 10_000,
  })
}

export function useSignalSavedStatus() {
  return useQuery({
    queryKey: SIGNAL_SAVED_STATUS_QUERY_KEY,
    queryFn: listSavedStatus,
    staleTime: 10_000,
  })
}

export function useSignalAlerts() {
  return useQuery({
    queryKey: SIGNAL_ALERTS_QUERY_KEY,
    queryFn: listActiveAlerts,
    staleTime: 10_000,
  })
}

export function useSignalNotifications() {
  return useQuery({
    queryKey: SIGNAL_NOTIFICATIONS_QUERY_KEY,
    queryFn: listNotifications,
    staleTime: 10_000,
  })
}

export function useSignalSettings() {
  return useQuery({
    queryKey: SIGNAL_SETTINGS_QUERY_KEY,
    queryFn: getNotificationSettings,
    staleTime: 60_000,
  })
}

export function useUserOverview() {
  return useQuery({
    queryKey: USER_OVERVIEW_QUERY_KEY,
    queryFn: getUserOverview,
    staleTime: 10_000,
  })
}
