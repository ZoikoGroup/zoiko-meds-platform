import { createContext, useCallback, useContext, useEffect, useMemo, useState, } from 'react';
const STORAGE_KEY = 'zoiko-theme';
const ThemeContext = createContext(null);
function getInitialTheme() {
    if (typeof document !== 'undefined') {
        if (document.documentElement.classList.contains('dark'))
            return 'dark';
        if (document.documentElement.classList.contains('light'))
            return 'light';
    }
    return 'light';
}
export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState(getInitialTheme);
    const applyTheme = useCallback((next) => {
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(next);
        root.style.colorScheme = next;
        try {
            localStorage.setItem(STORAGE_KEY, next);
        }
        catch {
            /* ignore storage errors */
        }
    }, []);
    useEffect(() => {
        applyTheme(theme);
    }, [theme, applyTheme]);
    const setTheme = useCallback((next) => setThemeState(next), []);
    const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);
    const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
    return <ThemeContext value={value}>{children}</ThemeContext>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx)
        throw new Error('useTheme must be used within a ThemeProvider');
    return ctx;
}
