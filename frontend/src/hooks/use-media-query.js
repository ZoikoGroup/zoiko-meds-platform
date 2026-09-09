import { useEffect, useState } from 'react';
/**
 * Reactive media-query hook.
 *
 * Defaults to false, and treats a missing `matchMedia` as "does not match"
 * rather than throwing. Server rendering is one environment without it; a test
 * environment is the other, and jsdom does not implement it at all — a hook
 * that threw there would take down every component that consulted the
 * viewport, which is how this was found. `a11y-preferences.js` guards the same
 * way for the same reason.
 *
 * False is the right default for both: a layout that starts narrow and widens
 * when the query answers renders a mobile arrangement briefly, where the
 * reverse would flash a desktop one onto a phone.
 */
export function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
            return false;
        return window.matchMedia(query).matches;
    });
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
            return undefined;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        onChange();
        // `addListener` is the only form Safari below 14 has, and it is what
        // this falls back to rather than silently never updating.
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
        mql.addListener(onChange);
        return () => mql.removeListener(onChange);
    }, [query]);
    return matches;
}
export function useIsDesktop() {
    return useMediaQuery('(min-width: 1024px)');
}


