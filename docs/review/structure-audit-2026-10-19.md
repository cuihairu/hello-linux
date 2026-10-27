# hello-linux Documentation Structure Audit (2026-10-19)

Scope: read-only inspection of the repository's existing documentation and navigation; no changes to the existing structure. Counts are based on the Markdown source files in the repository, and line counts are `splitlines()` results. `docs/.vitepress` and `docs/public` are build configuration/static assets and are not counted as content topic directories.

## Quantitative Facts

### Topic directories one level under docs

The table counts `.md` files and total lines recursively per directory; there are 4 root-level Markdown files (`index.md`, `SUMMARY.md`, `knowledge.md`, `glossary.md`), plus 143 files across the topic directories. The site's source files total 147 files and 41,034 lines.

| Next-level directory | Markdown count | Total lines |
|---|---:|---:|
| basic | 38 | 6,818 |
| commands | 20 | 7,286 |
| hardware | 7 | 1,855 |
| network | 10 | 6,066 |
| research | 6 | 806 |
| script | 10 | 1,988 |
| security | 8 | 2,468 |
| server | 21 | 5,562 |
| source | 14 | 4,377 |
| system-management | 9 | 3,172 |
| Root level (no directory) | 4 | 636 |
| **Total** | **147** | **41,034** |

### Organization axes

Grouped by how readers find content, there are currently **3 parallel organization axes**. The first two organize the content; the third carries the navigation index. They broadly reconcile with one another and are not three unrelated classifications.

| Directory / carrier | Entry count | Naming convention | Numbered? | Numbering continuity |
|---|---:|---|---|---|
| `docs/{basic,commands,hardware,network,research,script,security,server,source,system-management}/` | 10 topic directories, 143 Markdown files (including 10 directory READMEs) | English lowercase directory names; topic pages mostly English lowercase kebab-case, with README as the topic entry | No number prefix | Not applicable; 0 files with numeric prefixes repo-wide |
| Subdirectory levels inside the topic directories above | 21 subdirectories; concentrated in `basic` (9), `commands` (5), `server` (7) | topic first, subtopic after; directory names mostly English lowercase, document names mostly kebab-case with a little snake_case | No number prefix | Not applicable; hierarchy is not chapter numbering |
| `docs/.vitepress/config.mts` sidebar + `docs/SUMMARY.md` | sidebar config references 145 content pages; SUMMARY lists 145 entries; plus 13 nav items | sidebar uses collapsible groups by topic; SUMMARY uses Chinese titles and relative paths; the two are the in-site navigation and the hand-edited table of contents respectively | No numbering | Not applicable; the same topic's content is presented through two navigation entries |

The repository has no separate top-level organizing directories for "numbered chapters", "guides", "API" or "history". Words like `history` appear in page titles/body text and do not constitute an independent organizing axis. The numeric-prefix scan covered `docs/**/*.md` (excluding `.vitepress`): 0 matches, so there are no gaps, skips or duplicate numbering to list.

### Sidebar and file reconciliation

Extract every internal `link` field (nav and sidebar) from `docs/.vitepress/config.mts`, map them onto source files using VitePress's `.md`/README path rules, then reconcile file coverage against `docs/SUMMARY.md`:

| Reconciliation item | Count | Result |
|---|---:|---|
| Configured in sidebar but source file missing | 0 | No entries |
| Source Markdown exists but not in sidebar | 0 | No entries (the front page and SUMMARY are navigation entries/contents, not sidebar content pages) |
| Listed in SUMMARY but source file missing | 0 | No entries |
| Source file not collected by SUMMARY | 0 | No orphan pages |

The first 10 entries of each group: both empty (no listable entries). This result also agrees with the `index` statistics of `scripts/check_links.py`: `entries=145, listed=145, orphan=0, sidebar_ok=145, unlisted=0`.

## Issue List (by severity)

### Medium: topic overlap means readers may search twice; the boundary has to be recognized by the reader

- `docs/security/firewall.md:3,11` explicitly positions itself as the security-policy view and points readers to `docs/network/firewall.md`; the latter (`docs/network/firewall.md:9-12`) covers the same topic from connectivity and troubleshooting. The two pages state their division of labour clearly and this is deliberate cross-coverage, but sidebar/SUMMARY both currently show the same title "Firewall", so the difference in viewpoint is invisible at the contents level. Paths: `docs/security/firewall.md`, `docs/network/firewall.md`, `docs/SUMMARY.md:129,141`, `docs/.vitepress/config.mts:556,599`.
- Boot and logging also repeat across topics: basics' `docs/basic/boot.md` and `docs/basic/log.md` correspond to system-management's `docs/system-management/boot-process.md` and `docs/system-management/logging.md`. The latter two titles emphasize operations troubleshooting/management while the first two are basic-concept entry points; the current naming distinguishes them, but users have to compare across directories. Paths: `docs/basic/boot.md`, `docs/system-management/boot-process.md`, `docs/basic/log.md`, `docs/system-management/logging.md`; navigation lists them at `docs/SUMMARY.md:19,86-87` and `docs/.vitepress/config.mts:112-122,374-403`.
- Qualification: this is a "cross-topic discoverability" problem, not a proven content conflict; the duplication rate across the four page pairs has not been compared section by section, and the degree of overlap is unverified.

### Low: a few file-name style exceptions

- Most content pages use lowercase kebab-case, e.g. `docs/system-management/backup-and-recovery.md`, `docs/network/network-configuration.md`; a few use snake_case, e.g. `docs/basic/installation/choose_distribution.md`, `docs/basic/users/account_management.md`, `docs/commands/system/system_info.md`; mixed case has so far only been seen in content names around `docs/basic/packages/yum.md`, and no other anomalies were found (the scanned terms are mostly lowercase).
- English paths and Chinese titles intentionally coexist, so URLs stay stable while the pages address Chinese readers; this is not an error. The root `README.md`/`README.zh.md` is a clear language version pair, and each of the 10 topic directories under `docs/` has a `README.md` as its contents page -- these are not misplaced duplicate READMEs.
- Paths: the examples above; contents pages: `docs/basic/README.md`, `docs/commands/README.md` and so on. The full file list comes from `docs/**/*.md`.

### Candidate problems not found (recorded explicitly)

- Numbering gaps, skips, duplicates: not found; the entire docs content tree has no numeric-prefix Markdown files.
- Sidebar dead paths / orphan Markdown: not found; both differences are 0.
- Source-level dead links: not found (see the tool results below).
- Temporary root-level Markdown, duplicate READMEs: no temporary files found. The root level has `README.md` and `README.zh.md`, cross-linked by a language switch on their first line; they are the English/Chinese versions and should not be merged. `.pytest_cache/README.md` is a tool cache, not project documentation, and is git-ignored / not in the tracked list.

### Dead-link verification results and limits

- Ran `npm run docs:check`: returned `issues: 0`, `RESULT pass=33181 fail=0 total=33181 rate=100.0000%`. Source links, anchors and index checks all passed.
- The check also read the existing `docs/.vitepress/dist` (directory timestamp 2026-10-13); the HTML/sitemap totals showed 147 reachable locs with every page on the register. Since this is a historical build artifact, artifact-level results cannot prove that HTML rebuilt from the current source files would be identical; the current rebuild result is unverified.
- `npm run docs:build` failed to start: `sh: 1: vitepress: not found`. So no new build result from the current source files was obtained this round. External site links (2,825 items recorded by the checker) were only skipped on URL format, with no network reachability verification; external link status is unverified.
- Evidence paths: the `docs:check`, `docs:build` scripts in `package.json`; the check implementation `scripts/check_links.py`; the artifact directory `docs/.vitepress/dist`.

## Judgment and Recommendation

The table's main axis is the topic directories, and the whole can be understood as **3 organization axes: topic classification, within-topic hierarchy, navigation index**. Do not compress them into one: topic directories suit browsing and expansion, subdirectories suit splitting long chapters, and sidebar and SUMMARY serve web navigation and an editable contents page respectively, with the two currently reconciling completely. Keep the framework of "topics first, within-topic layering when needed, one content source presented through two navigations"; place future pages by topic as well, and avoid adding numbered chapters or parallel guide/API sections.

| Problem | Severity | Rationale |
|---|---|---|
| Cross-topic same-name entries (firewall etc.) do not express the viewpoint in the contents titles | Medium | The page bodies already explain the division of labour, but the navigation titles are identical, so discovery cost is high; not a dead link or a proven conflict |
| A few snake_case and kebab-case mixes | Low | Affects URL/filename consistency but not existing links; renaming needs synchronized references, and the gain is smaller than the mechanical risk |
| The site cannot be rebuilt with the current dependencies | Medium (verification risk) | VitePress is not installed, so this round cannot prove new build results; the old dist check passed but cannot stand in for a new build |

### Not actually messy, nothing to change

- The 10 top-level directory names express topics and each topic has a README entry; directory depth is concentrated where long chapters need subdivision, and content is not scattered by sequence numbers.
- There are no numeric chapter numbers, so there is no missing/skipped numbering debt.
- sidebar and SUMMARY fully cover the 145 content pages; current checks show no orphan pages and no dead config paths; there is no need to rearrange every page just so it "looks uniform".
- `README.md`/`README.zh.md` is an explicit language version pair; the READMEs inside topic directories are their respective entry pages, not duplicates.
- The firewall pages in security and network each explain the policy and the connectivity/troubleshooting viewpoint; this is reasonable cross-disciplinary reuse. Improving the navigation wording is appropriate; deleting one purely because the titles match is not.

## Three-phase closing plan

| Phase | Action list | Scope affected | Risk (links/search/external) | User decision |
|---|---|---|---|---|
| Phase 1: mechanical tidying (~1 hour, no URL changes) | Set up a checklist for new pages: search the whole repo for references before renaming a file; add viewpoint notes to cross-topic page titles/summaries (this could start by changing only the sidebar copy); settle the rule for unified kebab-case going forward -- new files follow it, old names are not renamed in bulk for now. | A few navigation titles, future contribution guidelines | Low link and external risk while URLs are unchanged; if only display titles move, search index content does not change. Per the user's request, this audit does not execute phase 1 changes. | **No decision needed** to settle the naming convention for new files first; whether existing pages get viewpoint subtitles is up to the maintainer. |
| Phase 2: navigation and redirects | If paths are to be adjusted or duplicate entries merged, first list an old URL -> new URL mapping; update `config.mts`, `SUMMARY.md`, in-body cross references and README; add VitePress redirect config/compatibility pages and rebuild for reconciliation. | sidebar, SUMMARY, in-site Markdown links, deployment URLs | Path adjustments affect search indexing and external bookmarks; without redirects, external links break. A redirect scheme lowers but cannot eliminate search migration risk. | **User decision required**: whether to change public URLs, whether to accept search index migration, and how long to keep old URLs. |
| Phase 3: content merge and chapter restructuring | Compare duplicate candidate pages section by section, decide the primary page and the specialized viewpoints; if merging, migrate unique content, change titles/navigation, keep the old URL with a redirect, and update references and the contents. Evaluate firewall, boot and logging first; avoid mechanically merging just because topic words match. | 4 candidate page groups and their links/chapter structure; may affect full-text search | Deleting/merging content can lose unique explanations, change search keyword hits and external references; page-by-page review and retained redirects are mandatory. | **User decision required**: content boundaries, primary ownership, whether duplicate sections get deleted, URL compatibility window; the structure audit cannot decide this unilaterally. |

## The three things to do first

1. Re-run `npm ci`, `npm run docs:build` and `npm run docs:check` in an environment that has the dependencies, and confirm that the new artifacts -- not the old dist -- pass; the current build is unverified because VitePress is missing.
2. Mark the viewpoint of same-name cross-topic entries in sidebar/SUMMARY (firewall first), keeping pages and URLs unchanged, so readers are less likely to mistake them for duplicate content.
3. First take inventory of paragraph-level overlap and unique content for the firewall, boot and logging pages, then let the maintainer decide whether phase 2/3 path adjustments or merges are needed; the current evidence is insufficient to delete or merge directly.

## Closing execution record (2026-10-19)

Below are the review results after executing this report's draft. The 147 files / 145 entries above are the snapshot taken when the draft was generated; after the audit report itself entered the sidebar and the index, the current source file count is 148 and content entries are 146.

### A: navigation source of truth and sync rules

- `docs/.vitepress/config.mts` is the source of truth for site navigation; `docs/SUMMARY.md:3` now states that this page is a derived complete link index -- when maintaining, change the sidebar first, then sync SUMMARY, and run `npm run docs:check` to reconcile the two. SUMMARY is kept and is no longer mistaken for a second navigation source of truth.
- Same-name sidebar entries became "Firewall (Policy Design)" and "Firewall (Connectivity Troubleshooting)"; the URLs remain `/security/firewall` and `/network/firewall` respectively.
- Each sidebar section was checked for internal route duplication; nav sharing a route with the sidebar, and a route reused across different sidebars, do not count as duplicates within one sidebar. No duplicate entries were found in any single sidebar.

### B: per-group qualification of the cross-topic candidates

Three groups' shared facts converged on the authoritative page; three groups' unique angles were kept and cross-linked, with no Markdown file deleted.

| Candidate group | Classification and action | Evidence comparing the two texts |
|---|---|---|
| Firewall | **Truly duplicated facts**: the three-distro default tools/enable state treats the security chapter as authoritative; the network chapter drops the duplicated comparison table and switches to a summary plus a full link. **Different angles kept**: policy design and connectivity troubleshooting remain two pages. | `docs/security/firewall.md:3`: "security policy viewpoint ... what should be denied by default, how to design the allowlist"; `docs/network/firewall.md:9-12`: "connectivity and troubleshooting viewpoint ... proving 'it is / is not the firewall blocking it'". Duplication evidence at baseline `6f24a13`: `docs/security/firewall.md:61-67` and `docs/network/firewall.md:86-90` both list the three-distro default tools/state; the current network chapter `:83` became a summary linking to the authoritative page. |
| Boot | **Truly duplicated facts**: the generic boot chain treats the basics chapter as authoritative; the system-management chapter's opening paragraph became a summary link. **Different angles kept**: basics covers boot composition and three-distro configuration; system-management covers stall diagnosis, rescue and boot performance. | Baseline `6f24a13`'s `docs/basic/boot.md:5`: "firmware ... bootloader ... kernel and initramfs ... PID 1"; the same baseline's `docs/system-management/boot-process.md:17-30` lists firmware, bootloader, kernel/initramfs, systemd and login as "five batons"; the current management chapter `:3` links back to basics and marks the administrator troubleshooting angle; the stage diagnosis matrix is still retained. |
| Logging | **Truly duplicated facts**: the concept of the journald/rsyslog division of labour treats the basics system-log page as authoritative; the management chapter keeps a summary pointing at the full explanation. **Different angles kept**: basics covers the pipeline, classification and rotation; system-management covers retrieval, quotas, ingestion and central forwarding. | `docs/basic/log/syslog.md:27-31` defines journald collection, rsyslog writing to disk, and the relationship between them; baseline `6f24a13`'s `docs/system-management/logging.md:16` restates "journald is ... the log bus; rsyslog is ... the text log router"; the current `docs/system-management/logging.md:16` became a summary link that then moves into retrieval and pipeline operations; `docs/basic/log.md:38` marks how the two kinds of content are divided and cross-links them. |

### C: claims and discoverability

- `README.md:18,40`, `README.zh.md:18,40` changed to a personal-notes / developer-practice positioning, dropping the inaccurate promises "learn from scratch" and "every chapter has"; the old 126/128 statistics in the English and Chinese READMEs are marked as a historical inspection snapshot.
- The topic cards on `docs/index.md` dropped the old numbers that called Markdown file counts "chapters"; the site description at `docs/.vitepress/config.mts:5` was synchronized to the personal-notes positioning.
- `docs/knowledge.md` and `docs/research/application-scenarios.md` changed order-based reading paths into scenario-based indexes of related pages; URLs unchanged.
- The important overview `knowledge.md` and this structure audit both joined the sidebar; SUMMARY gained the corresponding audit index entries. Sidebar config checks show no dead entries.

### This round's acceptance

- `pnpm docs:build`: passed, VitePress 2.0.0-alpha.20 build completed; one 500 kB chunk warning appeared.
- `npm run docs:check`: `issues=0`, `pass=33679 fail=0 total=33679 rate=100.0000%`; index `entries=146, listed=146, orphan=0, sidebar_ok=146, unlisted=0`; sitemap `locs=148, loc_ok=148, loc_dead=0, page_missing=0, missing_file=0`.
- `git diff --diff-filter=D --name-only`: 0 deleted paths; Markdown deletions: 0.
