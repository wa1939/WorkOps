import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CommunicationsManager } from "@/components/admin/communications-manager";

export default async function CommunicationsPage() {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
        redirect("/dashboard");
    }

    return (
        <div className="space-y-6 animate-fade-in">
            <CommunicationsManager />
        </div>
    );
}
