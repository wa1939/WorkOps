"use client";

import React, { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from "react";
import { sabahReducer, createInitialSabahState, type SabahState, type SabahAction } from "./sabah-reducer";

export type SabahHostRegistration = {
    id: string;
    element: HTMLElement;
    visible: boolean;
};

export type SabahContextValue = {
    state: SabahState;
    dispatch: React.Dispatch<SabahAction>;
    activeHost: SabahHostRegistration | null;
    registerHost: (id: string, element: HTMLElement) => () => void;
    setHostVisibility: (id: string, element: HTMLElement, visible: boolean) => void;
};

const SabahContext = createContext<SabahContextValue | null>(null);

export function SabahProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(sabahReducer, undefined, createInitialSabahState);
    const [hosts, setHosts] = useState<SabahHostRegistration[]>([]);
    const registerHost = useCallback((id: string, element: HTMLElement) => {
        setHosts((current) => [
            ...current.filter((host) => host.id !== id),
            { id, element, visible: false },
        ]);
        return () => {
            setHosts((current) => current.filter((host) => !(host.id === id && host.element === element)));
        };
    }, []);
    const setHostVisibility = useCallback((id: string, element: HTMLElement, visible: boolean) => {
        setHosts((current) => current.map((host) => (
            host.id === id && host.element === element ? { ...host, visible } : host
        )));
    }, []);
    const activeHost = hosts[hosts.length - 1] ?? null;
    const value = useMemo(() => ({ state, dispatch, activeHost, registerHost, setHostVisibility }), [state, activeHost, registerHost, setHostVisibility]);
    return <SabahContext.Provider value={value}>{children}</SabahContext.Provider>;
}

export function useSabah(): SabahContextValue {
    const ctx = useContext(SabahContext);
    if (!ctx) {
        throw new Error("useSabah must be used within a SabahProvider");
    }
    return ctx;
}

export function useSabahMaybe(): SabahContextValue | null {
    return useContext(SabahContext);
}
