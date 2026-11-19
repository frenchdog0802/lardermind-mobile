import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

/** Default staleness window: refetch on focus only if the data is older than this. */
export const FOCUS_STALE_MS = 60_000;

/**
 * Fetch when a screen gains focus, but at most once per `staleMs`.
 * Also exposes `refresh` / `refreshing` for pull-to-refresh (always forces a fetch).
 */
export function useFocusRefresh(fetcher: () => Promise<unknown>, staleMs: number = FOCUS_STALE_MS) {
    const lastFetchedRef = useRef(0);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;
    const [refreshing, setRefreshing] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

    const run = useCallback(
        async (force: boolean) => {
            if (!force && Date.now() - lastFetchedRef.current < staleMs) return;
            lastFetchedRef.current = Date.now();
            try {
                await fetcherRef.current();
            } catch {
                // Let the next focus retry right away.
                lastFetchedRef.current = 0;
            } finally {
                setHasLoadedOnce(true);
            }
        },
        [staleMs],
    );

    useFocusEffect(
        useCallback(() => {
            void run(false);
        }, [run]),
    );

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await run(true);
        } finally {
            setRefreshing(false);
        }
    }, [run]);

    return { refresh, refreshing, hasLoadedOnce };
}
