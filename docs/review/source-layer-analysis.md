# Source Layer Analysis (2026-11-08)

This analysis describes the repository by responsibility rather than directory name. It is based on the source tree at HEAD `a5e5f2e8bba34fd7d1c1d48473728602a59a104d`; generated dependency locks, caches, `node_modules`, and build output are treated as state, not source.

## Layer Summary

| Layer | Responsibility | Representative implementation | State |
|---|---|---|---|
| L1 — Documentation Product | Owns the bilingual Linux teaching content and its source-facing evidence. | [Kernel Source guide](../source/README.md) | Markdown files in the working tree |
| L2 — Site Presentation and Locale Projection | Projects one route list into English and Chinese labels, navigation, sidebar, and shell text. | `docs/.vitepress/config.mts` | In-memory navigation objects |
| L3 — Static Build and Release | Turns Markdown, assets, and site configuration into the Pages artifact. | `package.json` | `docs/.vitepress/dist` for one invocation |
| L4 — Site Integrity Service | Checks links, anchors, route/index coverage, sitemap coverage, and generated HTML without network access. | `scripts/check_links.py` | Read-only over source and current artifacts |
| L5 — Deterministic Illustration Service | Generates a seeded terrain/tree composition and emits ANSI, HTML, or PNG on demand. | `scripts/tree_art.py` | Process memory; optional output files |
| L6 — Tool Verification Harness | Isolates Python tool behavior in temporary sites or pure objects and enforces full line/branch coverage. | `tests/conftest.py` | Temporary pytest directories |

There are no Redis, MySQL, queue, or RPC services in the source. The only durable inputs are working-tree files and script arguments; durable outputs are built pages, optional illustration files, and GitHub Pages deployment.

## Module and Service Inventory

- **Documentation product**: 150 English and 150 Chinese Markdown pages form paired source trees. Their purpose is explicit at the Kernel Source guide's module map (`docs/source/README.md:23`) and the network configuration scope statement (`docs/network/network-configuration.md:29`).
- **Locale projection and presentation**: `project()` turns bilingual `[English, Chinese]` nodes into locale-specific links (`docs/.vitepress/config.mts:16`); the root and `/zh/` locale definitions consume that projection (`docs/.vitepress/config.mts:409`).
- **Build and release**: the `docs:build` shell command is declared in `package.json:7`; CI builds it (`.github/workflows/deploy.yml:63`), uploads `docs/.vitepress/dist` (`.github/workflows/deploy.yml:70`), and then deploys the Pages artifact (`.github/workflows/deploy.yml:84`).
- **Site integrity service**: `main()` runs source, configuration, index, sitemap, and HTML checks in a fixed order (`scripts/check_links.py:511`). It is the executable policy for route coverage described by the audit (`docs/review/structure-audit-2026-10-19.md:79`).
- **Illustration service**: `main()` parses CLI options, constructs a world, composes a character grid, and optionally writes HTML/PNG (`scripts/tree_art.py:327`).
- **Verification harness**: pytest discovers `tests` (`pytest.ini:2`), imports scripts through `tests/conftest.py:4`, and enforces 100% line and branch coverage for both Python services (`.coveragerc:2`, `.coveragerc:10`).

## Layer Details

### L1 — Documentation Product

**Responsibility.** Capture mechanisms, commands, configuration practice, research, and repository-facing terminology in a synchronized English/Chinese corpus.

**Implementation.** Content is Markdown under `docs`, including topic entry points such as `docs/source/README.md:1` and long-form module explanations such as `docs/network/network-configuration.md:44`. Root `README.md` is repository documentation rather than a site chapter and introduces the two Python tools (`README.md:68`).

**Configuration schema.** There is no content schema file or required front matter; the source contract is Markdown structure, internal links, headings, and indexed routes.

**Protocol.** Markdown and relative links are the internal protocol. Existing terminology entries intentionally pair definitions with authoritative references and related pages (`docs/glossary.md:3`, `docs/glossary.md:258`).

**Copy placement.** Teaching copy and its Chinese counterpart live beside each other under `docs` and `docs/zh`; glossary copy is at `docs/glossary.md:1` and `docs/zh/glossary.md:1`.

**State and lifecycle.** State is version-controlled text. It changes through normal commits; no process owns content at runtime.

### L2 — Site Presentation and Locale Projection

**Responsibility.** Keep route identity shared while presenting locale-specific labels, links, navigation hierarchy, and shell wording.

**Implementation.** `NavNode` declares bilingual labels and collapse state (`docs/.vitepress/config.mts:9`); `project()` recursively maps a root route to `/route` or `/zh/route` (`docs/.vitepress/config.mts:16`). `NAV` is the concise route list (`docs/.vitepress/config.mts:26`), while `SIDEBAR` is the complete browsing tree (`docs/.vitepress/config.mts:42`).

**Configuration schema.** The site configuration is the schema source. Its input node shape is declared locally (`docs/.vitepress/config.mts:9`), VitePress types are imported (`docs/.vitepress/config.mts:2`), and the exported `defineConfig()` defines base, locales, sitemap, and head (`docs/.vitepress/config.mts:409`).

**Protocol.** There is no separate route or translation file. Root routes are the protocol; `docs/SUMMARY.md` and `docs/zh/SUMMARY.md` are editable catalogs reconciled against that protocol.

**Copy placement.** UI text is localized in `themeFor()`, including outline, footer, edit-link, and search strings (`docs/.vitepress/config.mts:346`). Site title and description remain single-language metadata (`docs/.vitepress/config.mts:410`).

**State and lifecycle.** Navigation is evaluated in memory during build or dev-server startup. It does not persist independent state.

### L3 — Static Build and Release

**Responsibility.** Produce the routable static site and promote the exact build output to GitHub Pages after checks.

**Implementation.** VitePress is invoked through `docs:build` in `package.json:7`; deployment sequencing is encoded by `.github/workflows/deploy.yml:63` through `.github/workflows/deploy.yml:84`.

**Configuration schema.** The VitePress schema is supplied by `docs/.vitepress/config.mts:409`; base is `/hello-linux/` (`docs/.vitepress/config.mts:412`), sitemap generation is declared at `docs/.vitepress/config.mts:434`, and head assets are listed at `docs/.vitepress/config.mts:441`. CI inputs include Node and Python versions plus the Pages permissions in `.github/workflows/deploy.yml:21` and `.github/workflows/deploy.yml:41`.

**Protocol.** There is no proprietary protocol file. Inputs are repository files; the interface to deployment is the uploaded artifact directory at `.github/workflows/deploy.yml:70`.

**Copy placement.** Release-facing repository copy is in root README files (`README.md:84`, `README.zh.md:84`); runtime shell output belongs to the called tools.

**State and lifecycle.** `docs/.vitepress/dist` is invocation-local build output, not a source module. The lifecycle begins on push or manual dispatch (`.github/workflows/deploy.yml:5`) and ends after deployment or failed verification.

### L4 — Site Integrity Service

**Responsibility.** Prove that source links, locale indexes, configuration routes, generated HTML, and the sitemap agree before release.

**Implementation.** The CLI contract and three modes are documented at `scripts/check_links.py:2`; path constants are set at `scripts/check_links.py:24`; `main()` orchestrates all checks at `scripts/check_links.py:511`.

**Configuration schema.** There is no configuration file. Inputs are implicit repository paths (`scripts/check_links.py:24`), the current presence of `DIST` (`scripts/check_links.py:26`), and the optional `--require-html` argument (`scripts/check_links.py:619`).

**Protocol.** Markdown, HTML attributes, heading IDs, and sitemap `<loc>` entries are parsed in code. The regular expressions live at `scripts/check_links.py:29` through `scripts/check_links.py:37`; the sitemap protocol extractor is at `scripts/check_links.py:380`. No protocol definition has a dedicated file.

**Copy placement.** User-facing output is console text and issue tuples, composed in `main()` (`scripts/check_links.py:557`).

**State and lifecycle.** The service reads source and the existing artifact but writes no files. It runs as a CLI (`scripts/check_links.py:625`) or as a CI step (`.github/workflows/deploy.yml:65`).

### L5 — Deterministic Illustration Service

**Responsibility.** Convert a seeded procedural world into a reproducible terminal, HTML, or PNG composition.

**Implementation.** Noise and fractal sampling are implemented at `scripts/tree_art.py:25` and `scripts/tree_art.py:48`; terrain state and river carving are implemented by `World` at `scripts/tree_art.py:103` and `scripts/tree_art.py:128`; quadtree subdivision and grid composition are implemented at `scripts/tree_art.py:203` and `scripts/tree_art.py:222`.

**Configuration schema.** CLI flags define seed, dimensions, output targets, and quiet mode (`scripts/tree_art.py:328`). The palette and biome glyphs are repository constants (`scripts/tree_art.py:66`), not external configuration.

**Protocol.** ANSI escape sequences (`scripts/tree_art.py:256`) and a generated HTML document (`scripts/tree_art.py:275`) are inline output protocols. PNG capture delegates to Playwright and Chromium over a local `file://` page (`scripts/tree_art.py:313`). There is no dedicated protocol file.

**Copy placement.** Terminal summaries and the generated HTML title/legend use Chinese copy inside `scripts/tree_art.py`, including `scripts/tree_art.py:295` and `scripts/tree_art.py:350`.

**State and lifecycle.** World state lives in process memory. Optional HTML/PNG outputs are caller-supplied files and are not read back by the site build.

### L6 — Tool Verification Harness

**Responsibility.** Test both Python services in isolation and enforce complete branch-level behavioral coverage.

**Implementation.** Check-link scenarios import the service and replace repository roots with a temporary fake site (`tests/test_check_links.py:22`, `tests/test_check_links.py:31`). Tree-art scenarios exercise pure generation, rendering, CLI, and screenshot seams (`tests/test_tree_art.py:27`, `tests/test_tree_art.py:501`).

**Configuration schema.** pytest inputs are `pytest.ini:1`; coverage scope and the 100% gate are `.coveragerc:2` and `.coveragerc:10`. The suite is invoked by `docs:test` and `docs:cov` in `package.json:10`.

**Protocol.** There is no wire protocol. The harness uses pytest fixtures, monkeypatching, temporary files, process-output capture, and direct imports.

**Copy placement.** Test intent and coverage notes are in test docstrings, such as `tests/test_check_links.py:1` and `tests/test_tree_art.py:1`.

**State and lifecycle.** Tests allocate temporary state and release it with pytest. The lifecycle is one local or CI invocation (`package.json:11`, `.github/workflows/deploy.yml:67`).

## Call Surface

| Caller | Channel | Callee | Contract |
|---|---|---|---|
| Developer or CI | shell / npm | VitePress build | Read Markdown, assets, and `config.mts`; write `docs/.vitepress/dist` |
| Developer or CI | shell / Python | `check_links.py` | Read source and optional artifact; return exit status and console report |
| Developer or CI | shell / pytest | Python unit harness | Import `check_links` and `tree_art`; return test and coverage results |
| CI | workflow step | GitHub Pages artifact API | Upload and deploy one immutable Pages artifact |
| User | CLI | `tree_art.py` | Seed and dimensions in; ANSI/HTML/PNG out |
| `tree_art.py` | Python import | Playwright | Open generated HTML through `file://` and screenshot the body |

No layer calls Redis, MySQL, HTTP APIs, message brokers, or another first-party process.

## Inputs and Lifecycle

| Input | Consumer | Effect |
|---|---|---|
| Working-tree Markdown and assets | VitePress, integrity service | Site routes, page text, checked targets |
| Root routes and bilingual labels | locale projection, build | Both navigation trees and UI copy |
| `package.json` scripts | developer and CI shell | Build, preview, integrity check, tests, coverage |
| workflow trigger and runner variables | deployment workflow | CI lifecycle and artifact promotion |
| `--require-html` | integrity service | Refuse to pass when the artifact-level phase is unavailable |
| seed, width, height, output paths | illustration service | Deterministic world and optional output files |
| pytest and coverage settings | verification harness | Temporary-site tests and full branch gate |

Normal lifecycle: edit L1/L2 source; build with L3; verify source and artifact with L4; verify Python behavior with L6; then deploy L3 output. L5 is independent and run only for illustration work.

## Split Rationale

1. **Content and route presentation are separate.** The corpus is 150 files per locale, while one `project()` function derives both presentation trees from shared routes (`docs/.vitepress/config.mts:4`, `docs/.vitepress/config.mts:16`). This makes route drift a data error rather than a manual translation-maintenance task.
2. **Route presentation and integrity policy are separate.** The projection trusts declared routes, whereas `check_index()` independently compares every content page, `SUMMARY.md`, and config route (`scripts/check_links.py:322`). The second module is the guard for the first.
3. **Artifact production is separate from artifact promotion.** VitePress ends at a local `dist`; the workflow explicitly builds, uploads, then deploys (`.github/workflows/deploy.yml:63`, `.github/workflows/deploy.yml:70`, `.github/workflows/deploy.yml:84`). A build failure cannot be mistaken for a successful release.
4. **Site integrity is separate from unit verification.** `check_links.py` validates the real corpus and current artifact (`scripts/check_links.py:511`), while the harness validates tool behavior in isolated temporary sites (`tests/test_check_links.py:31`). Real-data auditing and deterministic regression therefore have different lifecycles.
5. **Source checking and artifact checking are separate phases in one integrity service.** The service works before build through source approximation and after build through IDs extracted from HTML (`scripts/check_links.py:194`, `scripts/check_links.py:225`). `--require-html` exposes that distinction explicitly (`scripts/check_links.py:619`).
6. **Sitemap reconciliation is a distinct invariant.** It is not just “all links resolve”: every `<loc>` must reach an artifact and every generated page must be listed (`scripts/check_links.py:383`, `scripts/check_links.py:423`). This protects discovery behavior after route changes.
7. **Illustration is standalone.** Its CLI constructs a world and writes caller-selected files but is not imported by VitePress or release checks (`scripts/tree_art.py:327`, `scripts/tree_art.py:354`). Its correctness can be tested without publishing a site.
8. **Playwright is a late optional adapter.** It is imported only inside `snap_png()` (`scripts/tree_art.py:314`), so ANSI/HTML generation remains dependency-free and testable without Chromium.
9. **Protocol parsing is local to its only consumer.** Markdown, HTML, and sitemap syntax are encoded beside the integrity checks (`scripts/check_links.py:29`, `scripts/check_links.py:380`); no separate parser package or protocol file currently earns its own boundary.
10. **Coverage is a repository-level gate, not an incidental test flag.** Coverage scopes both Python scripts and fails below 100% line and branch coverage (`.coveragerc:2`, `.coveragerc:10`). This couples tool changes to explicit behavioral evidence.

## Related Pages

- [Glossary](/glossary.md)
- [简体中文术语表](/zh/glossary.md)
- [源码分层分析（2026-11-08）](/zh/review/source-layer-analysis.md)
- [Documentation Structure Audit](./structure-audit-2026-10-19.md)
