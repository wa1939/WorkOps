import { brand, getOptionalSiteUrl } from "./brand";

/** Public product copy only: never populate this catalogue with workspace data. */
export const productCapabilities = [
    {
        heading: "Personal tasks and project delivery",
        framing: "A clear daily queue, with the structure to deliver larger work.",
        items: [
            { name: "Tasks, your way", description: "Work in a spreadsheet-style grid or Kanban board. Find My tasks, work related to you, or a specific person; keep search, status, priority and due-date filters when switching views." },
            { name: "Projects & timelines", description: "Connect tasks to project objectives, outputs, risks, stages and members. Follow progress and dependencies on a project roadmap." },
            { name: "Shared and recurring work", description: "Claim unassigned tasks from the floating pool. Define recurring work and reminder rules; automated processing requires a configured scheduler." },
        ],
    },
    {
        heading: "Workload management and capacity planning",
        framing: "See the effort behind the task count before assigning more work.",
        items: [
            { name: "Workload planner", description: "Review assignments, estimated effort and available capacity across a planning window. Spot overloaded people and capacity gaps before redistributing work." },
            { name: "Time tracking & utilization", description: "Use task timers and time entries, compare estimated versus actual effort, and review utilization reports. Recorded time is not a complete measure of someone's contribution." },
            { name: "Leave & handover", description: "Manage leave requests, task handover plans and return reports. Approved leave and configured working patterns inform planning capacity." },
        ],
    },
    {
        heading: "Department goals and shared visibility",
        framing: "Connect daily execution to the department's operating rhythm.",
        items: [
            { name: "Department KPIs", description: "Maintain a shared scorecard with updates, status and quarterly scoring. These are department-level goals, not individual performance ratings." },
            { name: "Reports & work briefs", description: "Review weekly progress, time, utilization and project reports. Optional AI can help draft executive summaries and project-scoped briefs." },
            { name: "Custom views & personal home", description: "Compose saved pages from task lists, charts, stat tiles, notes, KPI/project snapshots and embeds. Make a custom home personal and reversible." },
            { name: "Notes & case studies", description: "Keep tagged Markdown notes, decisions and reference material alongside case-study requests, participants and report output." },
        ],
    },
    {
        heading: "Coordination beyond the task list",
        framing: "Keep ownership and follow-through visible across people and commitments.",
        items: [
            { name: "PMO & external actions", description: "Track commitments outside the team with accountable owners, deadlines, evidence and follow-up history. Review portfolio and timeline views and export the results." },
            { name: "Announcements & notifications", description: "Publish department updates and manage an in-app inbox with notification preferences. Email, web push and scheduled digests need explicit configuration." },
            { name: "Help & support", description: "Request help, offer help and claim support requests with a clear owner." },
            { name: "Roles & workspaces", description: "Use admin, manager, member and viewer roles with server-side permissions and scoped workspace membership." },
            { name: "Search & commands", description: "Find work across modules using global search, a command palette and keyboard shortcuts. Install the responsive web app as a PWA." },
        ],
    },
    {
        heading: "Optional AI, under your control",
        framing: "Choose the provider; keep operational permissions and approvals in the application.",
        items: [
            { name: "Chat, intake & field assistance", description: "Ask questions with authorized workspace context, draft tasks from natural language, and get help editing fields or preparing reports." },
            { name: "Bring your own provider", description: "Configure OpenAI, native Anthropic Claude, or a custom OpenAI-compatible endpoint such as Nuha. Legacy GLM remains supported. Provider and model capabilities determine which tools and image features are available." },
            { name: "Reviewable workflows", description: "Review assistant-proposed actions through permission and approval gates. Advanced jobs, monitors, connectors and model assignments require administrator configuration." },
        ],
    },
] as const;

export const productFaqs = [
    { question: "Who is WorkOps for?", answer: "Departments and small teams that need personal task management, project delivery, workload planning and shared reporting in one self-hosted application. Members can focus on their daily work while managers coordinate capacity and commitments." },
    { question: "How does workload planning differ from a task board?", answer: "A board shows work moving through statuses. The workload planner adds assignments, estimated effort and configured capacity across time; time entries and utilization reports provide a separate view of recorded work. The quality of the picture depends on estimates, calendar settings and time-entry completeness." },
    { question: "Is WorkOps free?", answer: "The source is free to use and modify under the MIT license. You provide hosting and PostgreSQL; infrastructure, email and any AI provider usage can have their own costs. The repository is the self-hosted product, not a hosted subscription or public demo." },
    { question: "Do I need an AI API key?", answer: "No. Task, project, workload, KPI and other core features work without AI. AI is optional: configure OpenAI, native Claude or a custom OpenAI-compatible provider when you want it. Prompts and authorized context are sent to that provider." },
    { question: "Does self-hosting make every page public?", answer: "No. The signed-out product page is public. The application requires authentication, enforces role/workspace permissions, and excludes private routes from the sitemap and search indexing metadata. Robots rules are not a substitute for access control." },
    { question: "How do I get started?", answer: "Use the installation guide to configure PostgreSQL and a signing secret, initialize a new database, and create the first administrator. Demo data is an explicit local-only option. Existing installations are upgraded with reviewed migrations, never a database reset." },
] as const;

type StructuredNode = Record<string, unknown> & { "@type": string };

export function createProductStructuredData(siteUrl: string | null = getOptionalSiteUrl()) {
    const publicUrl = siteUrl ? `${siteUrl.replace(/\/+$/, "")}/` : null;
    const entityBase = publicUrl ?? `${brand.repository.url}/`;
    const author = { "@type": "Person", name: brand.author.name };
    const nodes: StructuredNode[] = [
        {
            "@type": "SoftwareApplication",
            "@id": `${entityBase}#application`,
            name: brand.name,
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web (self-hosted)",
            description: brand.description,
            ...(publicUrl ? { url: publicUrl } : {}),
            sameAs: brand.repository.url,
            author,
            license: brand.license.url,
            isAccessibleForFree: true,
            featureList: productCapabilities.flatMap(group => group.items.map(item => item.name)),
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "MIT-licensed source; hosting and optional provider services are separate." },
        },
        {
            "@type": "SoftwareSourceCode",
            "@id": `${entityBase}#source`,
            name: `${brand.name} source code`,
            codeRepository: brand.repository.url,
            license: brand.license.url,
            author,
            programmingLanguage: "TypeScript",
            targetProduct: { "@id": `${entityBase}#application` },
        },
    ];
    return { "@context": "https://schema.org", "@graph": nodes };
}
