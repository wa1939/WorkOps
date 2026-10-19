"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    ArrowLeft,
    Plus,
    GripVertical,
    Trash2,
    Type,
    Heading,
    Image as ImageIcon,
    Link2,
    LayoutGrid,
    TrendingUp,
    Minus,
    Columns2,
    Maximize,
    Info,
    Quote,
    ListChecks,
    Code,
    BarChart3,
    PieChart,
    ChevronRight,
    Images,
    Target,
    Folder,
    MessageCircle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { DEFAULT_VIEW_CHART_KIND, DEFAULT_VIEW_METRIC } from "@/lib/view-aggregate-client";
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from "@dnd-kit/core";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TextBlockEditor } from "./text-block-editor";
import { HeaderBlockEditor } from "./header-block-editor";
import { TaskViewBlockEditor } from "./task-view-block-editor";
import { ProgressBlockEditor } from "./progress-block-editor";
import { ImageBlockEditor } from "./image-block-editor";
import { EmbedBlockEditor } from "./embed-block-editor";
import { CalloutBlockEditor } from "./callout-block-editor";
import { QuoteBlockEditor } from "./quote-block-editor";
import { TodoBlockEditor } from "./todo-block-editor";
import { CodeBlockEditor } from "./code-block-editor";
import { StatTileBlockEditor } from "./stat-tile-block-editor";
import { ChartBlockEditor } from "./chart-block-editor";
import { ToggleBlockEditor } from "./toggle-block-editor";
import { GalleryBlockEditor } from "./gallery-block-editor";
import { KpiSnapshotBlockEditor } from "./kpi-snapshot-block-editor";
import { ProjectSnapshotBlockEditor } from "./project-snapshot-block-editor";
import { AssistantWorkspaceBlockEditor } from "./assistant-workspace-block-editor";
import { resolveCover } from "./cover-picker";
import { ViewEditorActions } from "./view-editor-actions";
import { SabahAvatar } from "@/components/sabah/sabah-avatar";
import { useToast } from "@/hooks/use-toast";
import { SAVED_VIEWS_REFRESH_EVENT } from "@/components/layout/saved-views-list";

export type BlockType =
    | "text"
    | "header"
    | "image"
    | "embed"
    | "taskView"
    | "progress"
    | "divider"
    | "callout"
    | "quote"
    | "todo"
    | "code"
    | "statTile"
    | "chart"
    | "toggle"
    | "gallery"
    | "kpiSnapshot"
    | "projectSnapshot"
    | "assistantWorkspace";

export interface Block {
    id: string;
    type: BlockType;
    content?: string;
    size?: "h1" | "h2" | "h3";
    url?: string;
    viewType?: "board" | "table" | "calendar" | "gallery" | "timeline";
    filters?: Record<string, unknown>;

    formula?: string;
    width?: "full" | "half" | "third";
    // Extended fields for new block types
    variant?: string;
    attribution?: string;
    items?: unknown;
    language?: string;
    metric?: string;
    label?: string;
    tone?: string;
    chartKind?: string;
    title?: string;
    urls?: string[];
    cols?: number;
    kpiId?: string;
    projectId?: string;
    projectSelectionRequired?: boolean;
    assistantLayout?: "context" | "focused";
    assistantAccent?: "sky" | "plum" | "ember" | "sage";

    // Deep task-view config
    projectIds?: string[];
    assigneeIds?: string[];
    tagIds?: string[];
    dueRange?: string;
    dueAfter?: string;
    dueBefore?: string;
    sortBy?: string;
    sortDir?: "asc" | "desc";
    groupBy?: string;
    columns?: string[];
}

interface BlockEditorProps {
    viewId: string;
    viewName: string;
    viewColor: string;
    viewIcon: string | null;
    initialBlocks: Block[];
    initialCover?: string | null;
}

const blockTypes: Array<{ type: BlockType; label: string; icon: typeof Type; description: string; category: string }> = [
    { type: "assistantWorkspace", label: "Sabah workspace", icon: MessageCircle, description: "Daily work, briefings, and AI actions", category: "Assistant" },
    { type: "text", label: "Text", icon: Type, description: "Rich markdown text", category: "Basic" },
    { type: "header", label: "Header", icon: Heading, description: "Section heading (H1/H2/H3)", category: "Basic" },
    { type: "callout", label: "Callout", icon: Info, description: "Info/warning/tip box", category: "Basic" },
    { type: "quote", label: "Quote", icon: Quote, description: "Memorable quote with attribution", category: "Basic" },
    { type: "todo", label: "To-do list", icon: ListChecks, description: "Personal checklist", category: "Basic" },
    { type: "code", label: "Code", icon: Code, description: "Monospace code block", category: "Basic" },
    { type: "divider", label: "Divider", icon: Minus, description: "Visual separator", category: "Basic" },
    { type: "toggle", label: "Toggle", icon: ChevronRight, description: "Collapsible section", category: "Basic" },

    { type: "statTile", label: "Stat tile", icon: BarChart3, description: "Big-number metric tile", category: "Data" },
    { type: "chart", label: "Chart", icon: PieChart, description: "Bar / pie / line chart", category: "Data" },
    { type: "kpiSnapshot", label: "KPI snapshot", icon: Target, description: "Show one KPI with progress", category: "Data" },
    { type: "projectSnapshot", label: "Project snapshot", icon: Folder, description: "Project status + progress", category: "Data" },
    { type: "taskView", label: "Task view", icon: LayoutGrid, description: "Filtered task list/board/calendar", category: "Data" },
    { type: "progress", label: "Progress widget", icon: TrendingUp, description: "Built-in progress tracker", category: "Data" },

    { type: "image", label: "Image", icon: ImageIcon, description: "Single image", category: "Media" },
    { type: "gallery", label: "Gallery", icon: Images, description: "Image grid", category: "Media" },
    { type: "embed", label: "Embed", icon: Link2, description: "Video, iframe, external site", category: "Media" },
];

function SortableBlock({
    block,
    onUpdate,
    onDelete,
}: {
    block: Block;
    onUpdate: (block: Block) => void;
    onDelete: () => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: block.id,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "group relative transition-all duration-200",
                block.width === "half" ? "col-span-12 sm:col-span-6" :
                    block.width === "third" ? "col-span-12 sm:col-span-4" :
                        "col-span-12",
                isDragging && "opacity-50 z-50"
            )}
        >
            <Card className="h-full border-2 border-dashed hover:border-solid hover:border-primary/50 transition-all">
                <div className="absolute left-0 top-0 bottom-0 flex items-center px-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10 [@media(pointer:coarse)]:top-2 [@media(pointer:coarse)]:bottom-auto [@media(pointer:coarse)]:opacity-100">
                    <button
                        {...attributes}
                        {...listeners}
                        aria-label="Reorder block"
                        className="p-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                    >
                        <GripVertical className="h-4 w-4" />
                    </button>
                </div>
                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-1 z-10 [@media(pointer:coarse)]:opacity-100">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Change block width" className="h-7 w-7 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11">
                                <Columns2 className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="[@media(pointer:coarse)]:[&_[role=menuitem]]:min-h-11">
                            <DropdownMenuItem onClick={() => onUpdate({ ...block, width: "full" })}>
                                <Maximize className="mr-2 h-4 w-4" /> Full Width
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onUpdate({ ...block, width: "half" })}>
                                <Columns2 className="mr-2 h-4 w-4" /> Half Width (1/2)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onUpdate({ ...block, width: "third" })}>
                                <Columns2 className="mr-2 h-4 w-4" /> Third Width (1/3)
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove block"
                        className="h-7 w-7 text-destructive hover:text-destructive [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                        onClick={onDelete}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
                <CardContent className="p-4 pl-8 h-full [@media(pointer:coarse)]:pt-16 [@media(pointer:coarse)]:pl-4 [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_button]:min-w-11 [@media(pointer:coarse)]:[&_input]:text-base [@media(pointer:coarse)]:[&_textarea]:text-base [@media(pointer:coarse)]:[&_select]:text-base">
                    {block.type === "text" && (
                        <TextBlockEditor block={block} onUpdate={onUpdate} />
                    )}
                    {block.type === "header" && (
                        <HeaderBlockEditor block={block} onUpdate={onUpdate} />
                    )}
                    {block.type === "taskView" && (
                        <TaskViewBlockEditor block={block} onUpdate={onUpdate} />
                    )}
                    {block.type === "progress" && (
                        <ProgressBlockEditor block={block} onUpdate={onUpdate} />
                    )}
                    {block.type === "divider" && (
                        <div className="py-2">
                            <hr className="border-t-2 border-dashed" />
                        </div>
                    )}
                    {block.type === "image" && (
                        <ImageBlockEditor block={block} onUpdate={onUpdate} />
                    )}
                    {block.type === "embed" && (
                        <EmbedBlockEditor block={block} onUpdate={onUpdate} />
                    )}
                    {block.type === "callout" && <CalloutBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "quote" && <QuoteBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "todo" && <TodoBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "code" && <CodeBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "statTile" && <StatTileBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "chart" && <ChartBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "toggle" && <ToggleBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "gallery" && <GalleryBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "kpiSnapshot" && <KpiSnapshotBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "projectSnapshot" && <ProjectSnapshotBlockEditor block={block} onUpdate={onUpdate} />}
                    {block.type === "assistantWorkspace" && <AssistantWorkspaceBlockEditor block={block} onUpdate={onUpdate} />}
                </CardContent>
            </Card>
        </div>
    );
}

export function BlockEditor({
    viewId,
    viewName,
    viewColor,
    viewIcon,
    initialBlocks,
    initialCover,
}: BlockEditorProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
    const [cover, setCover] = useState<string | null>(initialCover ?? null);
    const [saving, setSaving] = useState(false);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setBlocks((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const addBlock = (type: Block["type"]) => {
        if (type === "assistantWorkspace" && blocks.some((block) => block.type === "assistantWorkspace")) {
            toast({ title: "Sabah workspace already added", description: "Keep one Sabah workspace per view so the conversation stays continuous." });
            return;
        }
        const newBlock: Block = {
            id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type,
            content: type === "text" ? "Click to edit..." : type === "header" ? "New Section" : undefined,
            size: type === "header" ? "h2" : undefined,
            viewType: type === "taskView" ? "board" : undefined,
            filters: type === "taskView" ? {} : undefined,
            metric: type === "statTile" ? DEFAULT_VIEW_METRIC : undefined,
            chartKind: type === "chart" ? DEFAULT_VIEW_CHART_KIND : undefined,
            width: type === "assistantWorkspace" ? "full" : undefined,
            assistantLayout: type === "assistantWorkspace" ? "context" : undefined,
            assistantAccent: type === "assistantWorkspace" ? "sky" : undefined,
        };
        setBlocks((current) => [...current, newBlock]);
    };

    const updateBlock = (updatedBlock: Block) => {
        setBlocks(blocks.map((b) => (b.id === updatedBlock.id ? updatedBlock : b)));
    };

    const deleteBlock = (id: string) => {
        setBlocks(blocks.filter((b) => b.id !== id));
    };

    const saveView = async () => {
        setSaving(true);
        try {
            // Store cover as a sentinel "_meta" key in blocksJson wrapper
            const payload = { __meta: { cover }, blocks };
            const res = await fetch(`/api/saved-views/${viewId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ blocksJson: JSON.stringify(payload) }),
            });
            if (res.ok) {
                window.dispatchEvent(new CustomEvent(SAVED_VIEWS_REFRESH_EVENT));
                router.push(`/views/${viewId}`);
                router.refresh();
            } else {
                const errData = await res.json();
                console.error("Save error:", errData);
                toast({ title: "Error", description: `Failed to save: ${errData.error || "Unknown error"}`, variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error saving: Network or client issue", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const colorClasses: Record<string, string> = {
        blue: "from-blue-500 to-blue-600",
        green: "from-green-500 to-green-600",
        purple: "from-purple-500 to-purple-600",
        orange: "from-orange-500 to-orange-600",
        red: "from-red-500 to-red-600",
        pink: "from-pink-500 to-pink-600",
        cyan: "from-cyan-500 to-cyan-600",
        yellow: "from-yellow-500 to-yellow-600",
    };

    const resolvedCover = resolveCover(cover);

    return (
        <div className="space-y-6">
            {/* Cover banner */}
            {resolvedCover && (
                <div
                    className="relative w-full h-40 rounded-xl overflow-hidden border border-border"
                    style={resolvedCover.isGradient ? { background: resolvedCover.css } : { backgroundImage: `url(${resolvedCover.css})`, backgroundSize: "cover", backgroundPosition: "center" }}
                />
            )}

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2 sm:items-center sm:gap-4">
                    <Button variant="ghost" asChild className="shrink-0">
                        <Link href={`/views/${viewId}`}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Back
                        </Link>
                    </Button>
                    <div className="flex min-w-0 items-center gap-3">
                        {viewIcon === "sabah" ? (
                            <SabahAvatar size="sm" />
                        ) : (
                            <div
                                className={cn(
                                    "w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white text-lg",
                                    colorClasses[viewColor] || colorClasses.blue
                                )}
                            >
                                {viewIcon || "📊"}
                            </div>
                        )}
                        <div className="min-w-0">
                            <h1 className="truncate text-xl font-bold">Editing: {viewName}</h1>
                            <p className="text-sm text-muted-foreground">
                                Drag blocks to reorder, click to edit · type <kbd className="px-1 rounded bg-muted text-[10px]">/</kbd> to add a block
                            </p>
                        </div>
                    </div>
                </div>
                <ViewEditorActions viewId={viewId} cover={cover} saving={saving} onCoverChange={setCover} onSave={saveView} />
            </div>

            {/* Blocks */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                    <div className="grid grid-cols-12 gap-4">
                        {blocks.map((block) => (
                            <SortableBlock
                                key={block.id}
                                block={block}
                                onUpdate={updateBlock}
                                onDelete={() => deleteBlock(block.id)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            {/* Add Block Button */}
            <div className="flex justify-center">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="gap-2">
                            <Plus className="h-4 w-4" />
                            Add Block
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-72 max-h-96 overflow-y-auto">
                        {["Assistant", "Basic", "Data", "Media"].map((cat) => (
                            <div key={cat}>
                                <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                                    {cat}
                                </div>
                                {blockTypes.filter((bt) => bt.category === cat).map((bt) => (
                                    <DropdownMenuItem
                                        key={bt.type}
                                        onClick={() => addBlock(bt.type as BlockType)}
                                        className="py-2"
                                    >
                                        <bt.icon className="mr-2 h-4 w-4 flex-shrink-0" />
                                        <div className="min-w-0">
                                            <p className="font-medium text-sm">{bt.label}</p>
                                            <p className="text-xs text-muted-foreground truncate">{bt.description}</p>
                                        </div>
                                    </DropdownMenuItem>
                                ))}
                            </div>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
