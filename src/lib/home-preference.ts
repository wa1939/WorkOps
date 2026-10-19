import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/capabilities/contracts";
import { canReadSavedView } from "@/lib/saved-views/authorization";

export const HOME_PREFERENCE_PREFIX = "custom-view-home:";
const homeViewIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

type HomePreferenceDb = {
    appConfig: {
        findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null>;
        upsert: (args: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) => Promise<unknown>;
        deleteMany: (args: { where: { key: string; value?: string } }) => Promise<unknown>;
    };
    savedView: {
        findUnique: (args: { where: { id: string } }) => Promise<{ id: string; scope?: string | null; ownerId?: string | null } | null>;
    };
};

export class HomePreferenceError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
        this.name = "HomePreferenceError";
    }
}

function keyFor(actorId: string): string {
    return `${HOME_PREFERENCE_PREFIX}${actorId}`;
}

function parseViewId(value: string): string {
    const parsed = homeViewIdSchema.safeParse(value);
    if (!parsed.success) throw new HomePreferenceError("Invalid saved view id", 400, "INVALID_INPUT");
    return parsed.data;
}

async function accessibleView(viewId: string, actor: SabahActor, db: HomePreferenceDb) {
    const view = await db.savedView.findUnique({ where: { id: viewId } });
    if (!view || !canReadSavedView(view, actor)) {
        throw new HomePreferenceError("Saved view not found", 404, "NOT_FOUND");
    }
    return view;
}

export async function getHomePreference(actor: SabahActor, db: HomePreferenceDb = prisma): Promise<string | null> {
    const key = keyFor(actor.id);
    const stored = await db.appConfig.findUnique({ where: { key } });
    if (!stored) return null;
    const originalValue = stored.value;

    const parsed = homeViewIdSchema.safeParse(originalValue);
    if (!parsed.success) {
        await db.appConfig.deleteMany({ where: { key, value: originalValue } });
        return null;
    }

    const view = await db.savedView.findUnique({ where: { id: parsed.data } });
    if (!view || !canReadSavedView(view, actor)) {
        await db.appConfig.deleteMany({ where: { key, value: originalValue } });
        return null;
    }
    return view.id;
}

export async function setHomePreference(viewId: string, actor: SabahActor, db: HomePreferenceDb = prisma): Promise<{ viewId: string }> {
    const parsedViewId = parseViewId(viewId);
    await accessibleView(parsedViewId, actor, db);
    const key = keyFor(actor.id);
    await db.appConfig.upsert({
        where: { key },
        update: { value: parsedViewId },
        create: { key, value: parsedViewId },
    });
    return { viewId: parsedViewId };
}

export async function clearHomePreference(actor: SabahActor, db: HomePreferenceDb = prisma): Promise<{ viewId: null }> {
    await db.appConfig.deleteMany({ where: { key: keyFor(actor.id) } });
    return { viewId: null };
}

export async function getHomePath(actor: SabahActor, db: HomePreferenceDb = prisma): Promise<string> {
    const viewId = await getHomePreference(actor, db);
    return viewId ? `/views/${encodeURIComponent(viewId)}` : "/dashboard";
}
