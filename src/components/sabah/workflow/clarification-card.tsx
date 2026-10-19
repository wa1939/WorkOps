"use client";

import React, { useState } from "react";

export type ClarificationOption = { id: string; label: string };
export type ClarificationCardData = {
    id: string;
    question: string;
    options: ClarificationOption[];
    multiSelect: boolean;
};

export function ClarificationCard({ clarification, onAnswer }: { clarification: ClarificationCardData; onAnswer: (clarificationId: string, optionIds: string[]) => void }) {
    const [selected, setSelected] = useState<string[]>([]);

    const toggle = (id: string) => {
        if (clarification.multiSelect) {
            setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
        } else {
            setSelected([id]);
        }
    };

    return (
        <section aria-label={`Clarification: ${clarification.question}`} className="rounded-xl border border-sky-500/40 bg-sky-500/5 p-3">
            <h3 className="text-sm font-semibold">{clarification.question}</h3>
            <fieldset className="mt-2">
                <legend className="sr-only">{clarification.multiSelect ? "Select all that apply" : "Select one option"}</legend>
                <div className="space-y-1.5">
                    {clarification.options.map((option) =>
                        clarification.multiSelect ? (
                            <label key={option.id} className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={selected.includes(option.id)}
                                    onChange={() => toggle(option.id)}
                                    className="h-4 w-4 rounded border-border"
                                />
                                {option.label}
                            </label>
                        ) : (
                            <label key={option.id} className="flex items-center gap-2 text-sm">
                                <input
                                    type="radio"
                                    name={`clar-${clarification.id}`}
                                    checked={selected.includes(option.id)}
                                    onChange={() => toggle(option.id)}
                                    className="h-4 w-4 border-border"
                                />
                                {option.label}
                            </label>
                        )
                    )}
                </div>
            </fieldset>
            <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => onAnswer(clarification.id, selected)}
                className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
                Answer
            </button>
        </section>
    );
}
