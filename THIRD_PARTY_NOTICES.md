# Third-Party Notices

## NousResearch/hermes-agent (MIT License)

WorkOps contains a bounded, source-mapped adaptation of interaction
logic from the MIT-licensed
[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)
repository.

- Inspected source revision: `245e48008fa814b3251f50755eb656bd9fb86cb1`.
- Source tree: [`apps/desktop/src/components/assistant-ui/`](https://github.com/NousResearch/hermes-agent/tree/245e48008fa814b3251f50755eb656bd9fb86cb1/apps/desktop/src/components/assistant-ui).
- `src/components/sabah/chat/tool-activity.tsx` adapts the donor
  `tool/fallback.tsx` `splitRunItems`, `ToolRun`, and `ToolGroupSlot` behavior:
  ordered run/card splitting, collapsed settled runs, and live activity kept
  visible. The host adapter uses `LiveToolActivity`, React state, and explicit
  action/failed/interrupted card boundaries instead of assistant-ui,
  Nanostores, desktop stores, or donor tool renderers.
- The donor package boundary was checked rather than assumed:
  `@nous-research/ui` is `0.18.2` and declares React/ReactDOM `^19.0.0` peers;
  WorkOps remains on React/ReactDOM `18.2.0`, so no donor package or
  dependency upgrade is included.
- `src/components/sabah/chat/inline-approval.tsx` is newly authored host code.
  The inspected donor `tool/approval.tsx` exports `ApprovalBar` and contains a
  local command disclosure, but does **not** export an `ApprovalDisclosure`
  component. WorkOps's `ApprovalDisclosure` helper is therefore not
  claimed as copied Hermes source; it only binds the host's persisted approval
  snapshot and callback.

No Hermes application shell, transport, authentication, gateway/session store,
raw tool payload renderer, or complete chat surface is copied or claimed here.

The Sabah persona/avatar (`public/sabah/sabah-avatar.svg`) is an original
WorkOps work and is not derived from hermes-agent.

### Hermes license notice

The following notice is reproduced verbatim from the donor revision's
[LICENSE](https://github.com/NousResearch/hermes-agent/blob/245e48008fa814b3251f50755eb656bd9fb86cb1/LICENSE):

```text
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts and other assets

The application UI uses system fonts; no operating-system fonts are bundled or relicensed.
The public homepage display face is Geist, distributed under the SIL Open Font
License 1.1. Its complete upstream notice is included at
[`public/fonts/geist/LICENSE`](public/fonts/geist/LICENSE). The unmodified Latin
variable WOFF2 asset is from `@fontsource-variable/geist` version `5.3.0`,
[published package](https://www.npmjs.com/package/@fontsource-variable/geist/v/5.3.0),
SHA-256 `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1`.
The previously bundled Thmanyah font binaries are excluded from redistribution.
The supplied WorkOps logo artwork and prepared derivatives are documented in
[BRAND.md](BRAND.md). Dependency packages retain their respective upstream
licenses; the root MIT license does not replace them.
