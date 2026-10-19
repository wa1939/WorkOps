/**
 * The capability ledger: every line is a real, codebase-evidenced feature —
 * no invented metrics, testimonials, or pricing. Typographic rows with
 * hairline dividers instead of card grids.
 */

const groups = [
    {
        heading: "Day-to-day work",
        framing: "The tasks, timelines, and plans a department actually executes.",
        items: [
            {
                name: "Tasks & board",
                description:
                    "A kanban board with todo, doing, blocked, waiting, and done states — plus priorities, due dates, dependencies, comments, and time logging.",
            },
            {
                name: "Projects & timelines",
                description:
                    "Per-project workspaces with Gantt timelines, their own task boards, and progress reporting.",
            },
            {
                name: "Planning",
                description:
                    "Weekly planning views and a quarter-focus view that keeps the current priority in front of the team.",
            },
        ],
    },
    {
        heading: "Shared visibility",
        framing: "What the department knows together, not what one person remembers.",
        items: [
            {
                name: "Department KPIs",
                description:
                    "Shared team-level KPIs with quarterly scoring and trend charts — scorecards the whole department owns, not individual ratings.",
            },
            {
                name: "Notes",
                description:
                    "A shared notebook for decisions, meeting notes, and reference material.",
            },
            {
                name: "Reports",
                description:
                    "Generated status reports, with optional AI-drafted summaries you enable with your own model key.",
            },
            {
                name: "Saved views",
                description:
                    "Personal home views and saved filters, so each person opens the page they actually need.",
            },
        ],
    },
    {
        heading: "Keeping people in sync",
        framing: "The quiet machinery that stops work from falling through the cracks.",
        items: [
            {
                name: "Announcements",
                description:
                    "Department-wide posts and scheduled communication digests.",
            },
            {
                name: "Team directory",
                description: "People, roles, and departments at a glance.",
            },
            {
                name: "Reminders",
                description:
                    "Overdue-task reminders, a notification inbox, and snooze control.",
            },
            {
                name: "Help & support",
                description:
                    "Request help, offer help, and claim support requests with clear owners.",
            },
            {
                name: "Search & commands",
                description:
                    "Global search, a command palette, and keyboard shortcuts for power users.",
            },
        ],
    },
] as const;

export function LandingCapabilities() {
    return (
        <section id="capabilities" className="scroll-mt-16">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
                <div className="max-w-2xl">
                    <h2 className="text-3xl font-semibold tracking-tight text-[hsl(210_20%_98%)] md:text-4xl">
                        What WorkOps does
                    </h2>
                    <p className="mt-4 text-lg leading-relaxed text-[hsl(218_11%_65%)]">
                        One hub for the whole operating rhythm of a department —
                        everything below ships in the source you can read today.
                    </p>
                </div>

                <div className="mt-14 space-y-16">
                    {groups.map((group) => (
                        <div key={group.heading}>
                            <h3 className="text-lg font-semibold tracking-tight text-[hsl(210_20%_98%)]">
                                {group.heading}
                            </h3>
                            <p className="mt-1 text-sm text-[hsl(218_11%_60%)]">
                                {group.framing}
                            </p>
                            <ul className="mt-6">
                                {group.items.map((item) => (
                                    <li
                                        key={item.name}
                                        className="grid gap-1 border-b border-[hsl(215_28%_17%)] py-5 md:grid-cols-[minmax(180px,240px)_1fr] md:gap-10"
                                    >
                                        <h4 className="text-[15px] font-semibold text-[hsl(210_20%_98%)]">
                                            {item.name}
                                        </h4>
                                        <p className="text-[15px] leading-relaxed text-[hsl(218_11%_65%)]">
                                            {item.description}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
