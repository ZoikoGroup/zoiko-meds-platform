import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from '@/providers/theme-provider'
import { QueryProvider } from '@/providers/query-provider'
import { AuthProvider } from '@/providers/auth-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <QueryProvider>
        <TooltipProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>
)

