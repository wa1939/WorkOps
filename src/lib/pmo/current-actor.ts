import { auth } from "@/lib/auth";
import type { PmoActor } from "./authorization";
import { PmoAuthenticationError, resolvePmoActor } from "./actor";

export async function getCurrentPmoActor(): Promise<PmoActor | null> {
    const session = await auth();
    try {
        return await resolvePmoActor(session?.user?.id);
    } catch (error) {
        if (error instanceof PmoAuthenticationError) return null;
        throw error;
    }
}
