"use client";

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { isInternalWorkflowHref, isSafeWorkflowHref } from "@/lib/sabah/workflows/schemas";

const MARKDOWN_CLASSES =
    "[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:ps-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:ps-4 " +
    "[&_li]:my-0.5 [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold " +
    "[&_code]:rounded [&_code]:bg-foreground/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] " +
    "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-foreground/[0.06] [&_pre]:p-2 " +
    "[&_h1]:my-1.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:my-1.5 [&_h2]:text-sm [&_h2]:font-semibold " +
    "[&_h3]:my-1 [&_h3]:font-semibold [&_h4]:my-1 [&_h4]:font-semibold [&_h5]:my-1 [&_h5]:font-semibold [&_h6]:my-1 [&_h6]:font-semibold " +
    "[&_blockquote]:my-1 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-2";

const MARKDOWN_AST = unified().use(remarkParse).use(remarkGfm);
const DISPLAY_HEADING = /[ \t]*#{1,6}[ \t]+(?=\S)/g;

type MarkdownNode = {
    type?: string;
    children?: MarkdownNode[];
    position?: {
        start?: { offset?: number };
        end?: { offset?: number };
    };
};

function headingInsertionOffsets(node: MarkdownNode, source: string, offsets: number[]): void {
    if (node.type === "text" && node.position?.start?.offset !== undefined && node.position.end?.offset !== undefined) {
        const start = node.position.start.offset;
        const end = node.position.end.offset;
        const text = source.slice(start, end);
        DISPLAY_HEADING.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = DISPLAY_HEADING.exec(text)) !== null) {
            const beforeMarker = text.slice(0, match.index).replace(/[ \t]+$/g, "");
            const precedingWord = beforeMarker.match(/[A-Za-z0-9][A-Za-z0-9_-]*$/)?.[0];
            const textBeforePrecedingWord = precedingWord ? beforeMarker.slice(0, -precedingWord.length) : "";
            // A one-letter word immediately before `# ` is ordinary prose
            // such as C#; require a longer word and an earlier word boundary
            // for this display-only repair. Real Markdown headings are already
            // heading AST nodes.
            if (precedingWord && precedingWord.length >= 2 && /\s/.test(textBeforePrecedingWord) && !beforeMarker.endsWith("\n")) {
                offsets.push(start + match.index);
            }
        }
        DISPLAY_HEADING.lastIndex = 0;
    }
    for (const child of node.children ?? []) headingInsertionOffsets(child, source, offsets);
}

/** Normalize only unprotected Markdown text nodes; persisted/copy text is unchanged. */
export function normalizeAssistantMarkdown(value: string): string {
    try {
        const tree = MARKDOWN_AST.parse(value) as unknown as MarkdownNode;
        const offsets: number[] = [];
        headingInsertionOffsets(tree, value, offsets);
        let result = value;
        for (const offset of Array.from(new Set(offsets)).sort((a, b) => b - a)) {
            result = `${result.slice(0, offset)}\n${result.slice(offset)}`;
        }
        return result;
    } catch {
        // Display repair is best effort; never replace the original response
        // with a parser error or mutate it more broadly than the AST rule.
        return value;
    }
}

const MARKDOWN_COMPONENTS: Components = {
    table: ({ children }) => (
        <div className="my-2 max-w-full overflow-x-auto rounded-lg border border-border">
            <table aria-label="Assistant response table" className="min-w-full border-collapse text-start text-xs">
                {children}
            </table>
        </div>
    ),
    th: ({ children }) => (
        <th scope="col" className="border-b border-border bg-muted/60 px-2 py-1.5 text-start font-semibold text-foreground">
            {children}
        </th>
    ),
    td: ({ children }) => <td className="border-b border-border/70 px-2 py-1.5 align-top text-start text-foreground">{children}</td>,
};

/** Anchor boundary: syntactic safety is required for every href, and internal
 *  entity links must additionally be grounded in a verified tool result for
 *  this conversation. Ungrounded internal links degrade to plain text — the
 *  raw markdown, persisted text, and copy text are never rewritten. */
function markdownComponents(verifiedHrefs: ReadonlySet<string> | undefined): Components {
    return {
        ...MARKDOWN_COMPONENTS,
        a: ({ href, children }) => {
            if (!isSafeWorkflowHref(href)) return <span>{children}</span>;
            const origin = typeof location === "undefined" ? undefined : location.origin;
            if (isInternalWorkflowHref(href, origin)) {
                const absolute = href.startsWith("/") ? null : new URL(href, origin ?? "https://sabah.invalid");
                const key = absolute ? absolute.pathname + absolute.search + absolute.hash : href;
                if (!(verifiedHrefs?.has(key) ?? false)) return <span>{children}</span>;
            }
            return (
                <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/80">
                    {children}
                </a>
            );
        },
    };
}

export function AssistantMarkdown({ content, verifiedHrefs }: { content: string; verifiedHrefs?: ReadonlySet<string> }) {
    const components = React.useMemo(() => markdownComponents(verifiedHrefs), [verifiedHrefs]);
    return (
        <div className={`break-words ${MARKDOWN_CLASSES}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={components}
                urlTransform={(url) => (isSafeWorkflowHref(url) ? url : "")}
            >
                {normalizeAssistantMarkdown(content)}
            </ReactMarkdown>
        </div>
    );
}
