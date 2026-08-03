import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from '@/providers/theme-provider'
import { QueryProvider } from '@/providers/query-provider'
import { AuthProvider } from '@/providers/auth-provider'
import { LanguageProvider } from '@/providers/language-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppErrorBoundary } from '@/components/shared/error-boundary'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <QueryProvider>
            <TooltipProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </TooltipProvider>
          </QueryProvider>
        </LanguageProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>
)

