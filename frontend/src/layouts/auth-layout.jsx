import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sun, Moon, ArrowRight, ShieldCheck } from 'lucide-react'
import { useTheme } from '@/providers/theme-provider'
import { Brand } from '@/components/shared/brand'
import { Button } from '@/components/ui/button'

export function AuthLayout({
  children,
  title,
  description,
  pills = [],
  listItems = [],
}) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground transition-colors duration-300">
      {/* Dynamic Background Gradients */}
      <div className="absolute inset-0 -z-10 bg-radial-[circle_at_top_right] from-primary/5 via-transparent to-transparent opacity-80" />
      <div className="absolute -top-40 -left-40 -z-10 size-96 rounded-full bg-teal/10 blur-3xl" />
      
      {/* Top Header Navigation (Back to Site & Theme Toggle) */}
      <header className="absolute top-4 right-4 z-50 flex items-center gap-3 px-4 sm:top-6 sm:right-6">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground">
          <Link to="/" className="flex items-center gap-1">
            Back to site
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          {isDark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
        </Button>
      </header>

      {/* Main Container */}
      <div className="grid min-h-screen w-full grid-cols-1 lg:grid-cols-12">
        {/* Left Side Showcase (Logo & Pitch) */}
        <section className="relative flex flex-col justify-between p-8 sm:p-12 lg:col-span-7 xl:col-span-8 lg:p-20">
          {/* Logo */}
          <div className="flex items-center">
            <Brand className="scale-110" />
          </div>

          {/* Core Content */}
          <div className="my-auto max-w-2xl py-12 lg:py-0">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="flex flex-col gap-6"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-teal/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-teal">
                  Secure ZoikoMeds Access
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 text-teal" />
                  MFA Protected
                </span>
              </div>

              <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl leading-tight">
                {title}
              </h1>

              <p className="text-base text-muted-foreground sm:text-lg leading-relaxed max-w-xl">
                {description}
              </p>

              {/* Feature List (Registration Screen) */}
              {listItems.length > 0 && (
                <div className="mt-4 flex flex-col gap-4">
                  {listItems.map((item, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 + 0.2 }}
                      className="flex items-start gap-3"
                    >
                      <div className="mt-1 flex size-6.5 shrink-0 items-center justify-center rounded-lg bg-teal/10 text-teal">
                        {item.icon}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {item.title}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Badges/Pills (Login & Register Screen bottom) */}
              {pills.length > 0 && (
                <div className="mt-6 flex flex-wrap gap-2.5">
                  {pills.map((pill, idx) => (
                    <span
                      key={idx}
                      className="flex items-center gap-2 rounded-full border border-border/80 bg-card/45 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-xs"
                    >
                      <span className="shrink-0">{pill.icon}</span>
                      {pill.label}
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          </div>

          {/* Footer Copyright inside left section */}
          <div className="text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} ZoikoMeds. All rights reserved.
          </div>
        </section>

        {/* Right Side (Form Card Container) */}
        <section className="relative flex flex-col items-center justify-center bg-muted/20 p-6 sm:p-12 lg:col-span-5 xl:col-span-4 lg:border-l lg:border-border/30 lg:bg-card/20 lg:backdrop-blur-md">
          {/* Decorative Backdrops */}
          <div className="absolute top-1/2 left-1/2 -z-10 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
          
          <div className="w-full max-w-[420px]">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  )
}
