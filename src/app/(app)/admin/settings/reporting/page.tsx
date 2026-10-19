import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ReportingSettingsForm } from "@/components/admin/reporting-settings-form";
import { configuredInternalDomains } from "@/lib/communications/domains";

export default async function ReportingSettingsPage() {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
        redirect("/dashboard");
    }

    const row = await prisma.appConfig.findUnique({
        where: { key: "SUNDAY_DIGEST_TO" },
    });

    return (
        <div className="max-w-2xl space-y-6 animate-fade-in">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Reporting</h1>
                <p className="text-muted-foreground">
                    Configure recipients for the Sunday executive digest. Delivery requires an explicitly configured email-domain policy.
                </p>
            </div>

            <ReportingSettingsForm initialRecipients={row?.value ?? ""} internalDomains={configuredInternalDomains()} />
        </div>
    );
}
