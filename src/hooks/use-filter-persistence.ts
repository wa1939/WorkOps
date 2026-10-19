"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type FilterValue = string[] | string | boolean;
export type FilterSchema = Record<string, FilterValue>;
export type FilterState<T extends FilterSchema> = {
    [K in keyof T]: T[K];
};
export type FilterUpdate<T extends FilterSchema> = Partial<T> | ((current: T) => T);

function paramsFrom(source: URLSearchParams | string): URLSearchParams {
    return typeof source === "string" ? new URLSearchParams(source) : new URLSearchParams(source.toString());
}

function appendFilterValue(params: URLSearchParams, key: string, value: FilterValue): void {
    if (Array.isArray(value)) {
        value.forEach((item) => {
            if (item) params.append(key, item);
        });
        return;
    }
    if (typeof value === "boolean") {
        params.set(key, String(value));
        return;
    }
    if (value) params.set(key, value);
}

/** Serialize only filter values; empty strings and arrays are omitted. */
export function serializeFilterState(filters: FilterSchema): string {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => appendFilterValue(params, key, value));
    return params.toString();
}

/**
 * Parse filters using the supplied values as schema defaults. Arrays use
 * repeated query parameters; comma-separated values are also accepted for
 * compatibility with existing planner links.
 */
export function deserializeFilterState<T extends FilterSchema>(
    source: URLSearchParams | string,
    schema: T,
): FilterState<T> {
    const params = paramsFrom(source);
    const result: FilterSchema = {};

    Object.entries(schema).forEach(([key, defaultValue]) => {
        if (Array.isArray(defaultValue)) {
            const values: string[] = [];
            params.getAll(key).forEach((rawValue) => {
                rawValue.split(",").forEach((value) => {
                    if (value && !values.includes(value)) values.push(value);
                });
            });
            result[key] = values;
            return;
        }

        if (typeof defaultValue === "boolean") {
            const rawValue = params.get(key);
            result[key] = rawValue === "true"
                ? true
                : rawValue === "false"
                    ? false
                    : defaultValue;
            return;
        }

        result[key] = params.has(key) ? params.get(key) ?? "" : defaultValue;
    });

    return result as FilterState<T>;
}

function replaceFilterParams(
    params: URLSearchParams,
    schema: FilterSchema,
    filters: FilterSchema,
): void {
    Object.keys(schema).forEach((key) => params.delete(key));
    Object.entries(filters).forEach(([key, value]) => appendFilterValue(params, key, value));
}

/**
 * URL-first filter state. The URL is the source of truth, so refreshes,
 * navigation, and shared links preserve the active filters without a second
 * local state store.
 */
export function useFilterPersistence<T extends FilterSchema>(schema: T) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const rawSearchParams = searchParams.toString();

    const filters = useMemo(
        () => deserializeFilterState(rawSearchParams, schema),
        [rawSearchParams, schema],
    );

    const replaceFilters = useCallback((nextFilters: T) => {
        const params = new URLSearchParams(rawSearchParams);
        replaceFilterParams(params, schema, nextFilters);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, rawSearchParams, router, schema]);

    const setFilters = useCallback((update: FilterUpdate<T>) => {
        const current = deserializeFilterState(rawSearchParams, schema);
        const next = typeof update === "function"
            ? update(current)
            : { ...current, ...update } as T;
        replaceFilters(next);
    }, [rawSearchParams, replaceFilters, schema]);

    const setFilter = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
        setFilters((current) => ({ ...current, [key]: value }) as T);
    }, [setFilters]);

    const clearFilters = useCallback(() => replaceFilters(schema), [replaceFilters, schema]);

    // TODO(T4.4): add an optional Save view action backed by /api/saved-views;
    // keep the URL as the source of truth until SavedView loading is wired.
    return { filters, setFilters, setFilter, clearFilters };
}
