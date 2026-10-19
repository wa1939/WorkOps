"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Board } from "./board/Board";
import { TaskGrid } from "./grid/TaskGrid";

type TasksView = "list" | "board";
const TASKS_VIEW_STORAGE_KEY = "tasks-view";

function isTasksView(value: string | null): value is TasksView {
    return value === "list" || value === "board";
}

export function TaskViewSwitcher() {
    const [view, setView] = useState<TasksView>("list");

    useEffect(() => {
        try {
            const storedView = window.localStorage.getItem(TASKS_VIEW_STORAGE_KEY);
            if (isTasksView(storedView)) {
                setView(storedView);
                return;
            }
            const queryView = new URLSearchParams(window.location.search).get("view");
            if (queryView === "board") setView("board");
        } catch {
            // Storage can be unavailable in private browsing; list remains usable.
        }
    }, []);

    const selectView = (nextView: TasksView) => {
        setView(nextView);
        try {
            window.localStorage.setItem(TASKS_VIEW_STORAGE_KEY, nextView);
        } catch {
            // Storage can be unavailable in private browsing; the current view still changes.
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <div role="group" aria-label="Tasks view" className="flex items-center rounded-lg border bg-muted/30 p-1">
                    <Button
                        type="button"
                        variant={view === "list" ? "secondary" : "ghost"}
                        size="sm"
                        aria-pressed={view === "list"}
                        onClick={() => selectView("list")}
                    >
                        <List className="mr-2 h-4 w-4" />
                        List
                    </Button>
                    <Button
                        type="button"
                        variant={view === "board" ? "secondary" : "ghost"}
                        size="sm"
                        aria-pressed={view === "board"}
                        onClick={() => selectView("board")}
                    >
                        <LayoutGrid className="mr-2 h-4 w-4" />
                        Board
                    </Button>
                </div>
            </div>
            {view === "board" ? <Board /> : <TaskGrid />}
        </div>
    );
}

export default TaskViewSwitcher;
