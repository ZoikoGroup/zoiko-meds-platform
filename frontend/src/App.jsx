import { RouterProvider } from 'react-router-dom'
import { router } from '@/routes'
import { initNative } from '@/lib/native'

// Back button, deep links and the splash screen in the Android app; a no-op on
// the web. Runs once, outside React, because it wires the router itself.
initNative(router)

export default function App() {
  return <RouterProvider router={router} />
}
