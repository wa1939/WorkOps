"use client";

import { useEffect, useState } from "react";

export function TaskCompleteBurst({ trigger }: { trigger: boolean }) {
    const [particles, setParticles] = useState<
        Array<{ id: number; x: number; y: number; color: string; size: number }>
    >([]);

    useEffect(() => {
        if (!trigger) return;
        const colors = ["#8b5cf6", "#ec4899", "#22c55e", "#f59e0b", "#3b82f6", "#ef4444"];
        const newParticles = Array.from({ length: 10 }, (_, i) => ({
            id: i,
            x: (Math.random() - 0.5) * 120,
            y: (Math.random() - 0.5) * 120,
            color: colors[Math.floor(Math.random() * colors.length)],
            size: 4 + Math.random() * 4,
        }));
        setParticles(newParticles);
        const timer = setTimeout(() => setParticles([]), 700);
        return () => clearTimeout(timer);
    }, [trigger]);

    if (particles.length === 0) return null;

    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {particles.map((p) => (
                <span
                    key={p.id}
                    className="absolute left-1/2 top-1/2 rounded-full animate-burst"
                    style={{
                        width: p.size,
                        height: p.size,
                        backgroundColor: p.color,
                        "--burst-x": `${p.x}px`,
                        "--burst-y": `${p.y}px`,
                    } as React.CSSProperties}
                />
            ))}
        </div>
    );
}
