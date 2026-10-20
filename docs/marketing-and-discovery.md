# Marketing page and discoverability

## What the public page is for

WorkOps includes a **signed-out product landing page at `/`**. It is the public front door for someone evaluating the application: what it does, who it helps, what self-hosting requires, and where to find the source and installation guide.

It is not a second application, a task dashboard, or a public demo account. A signed-in visitor still goes to their saved personal home. The repository does not maintain a separate standalone HTML site: the page's HTML is rendered by Next.js from `src/app/page.tsx` and `src/components/landing/`.

Shipping this source does not itself create an independently hosted public website. The page becomes reachable on an installation's domain when that installation is deployed. Local previews and screenshots are not public deployment or search-indexing evidence.

## Product content

The public catalogue and FAQ live in `src/lib/product-marketing.ts`; the landing page and structured data reuse them. This keeps feature names consistent without querying or exposing workspace records.

The page covers personal work, projects, workload and capacity, time/utilization, leave and handover, department KPIs, PMO commitments, custom views, collaboration and optional AI. Configuration-dependent features are labeled. See [Capabilities](capabilities.md), [Workload & capacity](features/workload-capacity.md) and [AI providers](ai-providers.md) for the detailed contracts and limitations.

Product screenshots use synthetic demo data. Do not substitute customer screenshots, invented testimonials, adoption counters or fabricated AI outputs.

## Search and sharing

- The title and description use clear product language: self-hosted task/project management, workload and capacity planning.
- Set `APP_BASE_URL` to the installation's actual canonical HTTP(S) origin, without credentials, a query or fragment. `NEXTAUTH_URL` is the fallback; supported Vercel production-alias configuration is documented in [deployment](deployment/vercel.md). Never point canonical metadata at a domain you do not operate.
- `/sitemap.xml` includes only the public root when a canonical URL is configured. It is empty for Vercel previews and omits a fictitious `lastModified` request timestamp.
- `/robots.txt` disallows application, authentication and API routes; preview deployments disallow crawling entirely. Private routes also carry noindex metadata. **Robots rules are not access control**: authentication and server-side permissions remain necessary.
- Open Graph and social-card metadata reuse the product identity. `src/app/opengraph-image.tsx` generates a share image from the actual licensed logo.
- JSON-LD distinguishes the software application from its source-code repository, describes the real features and MIT license, and does not invent ratings. Free source does not mean free hosting or provider usage.
- Crawlable FAQ content explains costs, optional AI, privacy boundaries and setup. It is useful content, not a promise of search-engine rich results.

The public GitHub README is also a discovery surface: keep the repository description and topics aligned with real capabilities, use descriptive headings and screenshot alt text, and link to working setup and feature guides. Do not keyword-stuff or advertise links that are not live.

Search engines decide what to crawl and rank. These measures improve accurate representation and technical discoverability; they do not guarantee indexing, ranking, traffic or user growth.
