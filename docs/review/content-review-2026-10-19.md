# Content Review (2026-10-19)

## Review Scope

Ran `git fetch origin && git pull --rebase origin main` first: the working tree was clean, the branch was already up to date, and there were no rebase conflicts. The review actually covered the last 4 commits (within the agreed range of 3-4):

- `dee3df3` Align docs with notes voice (C: positioning and claims)
- `e64ead6` Clarify cross-topic notes (B: converging cross-topic duplication)
- `887a770` Unify docs navigation (A: navigation unification)
- `6f24a13` Add docs structure audit (structure audit baseline)

Technical errors found while reviewing were fixed in a separate commit `0d1aa79`; the history of the reviewed commits above was not rewritten.

## The Four Checks

### 1. Content Loss

**Conclusion: one specific piece of information was not migrated during the merge; it has been put back and its scope corrected. No content entries in SUMMARY were found to have been trimmed away.**

- `e64ead6` merged the three-distro difference explanation and example that used to live at `docs/network/firewall.md:92-98` into the security chapter. Before/after: the original `:96-98` spelled out that firewalld's `public` zone allows `ssh, dhcpv6-client, cockpit and other services`; after the merge `docs/security/firewall.md:170` instead asserted that it "only allows ssh and dhcpv6-client", dropping the cockpit case and generalizing an example into an absolute rule.
- After the fix, `docs/security/firewall.md:170,186` states that the common services include `ssh` and `dhcpv6-client`, that environments with the web console enabled may also include `cockpit`, and that the authoritative answer is whatever `firewall-cmd --list-all` reports right now; the checklist at `:309` was changed to inspect the real allowlist instead of demanding that `public` hold only ssh. `:336` added the Red Hat documentation source. Red Hat's RHEL 9 documentation example does show `cockpit dhcpv6-client ssh`: [Red Hat firewalld configuration](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_firewalls_and_packet_filters/using-and-configuring-firewalld). Fix commit: `0d1aa79`.
- Remaining merged content compared: `docs/basic/boot.md:7` gained a link to the system-management troubleshooting page while the original BIOS/UEFI, GRUB configuration and rescue material was kept; `docs/system-management/boot-process.md:3` replaced the generic boot-chain overview with a link to the basics chapter, but this page's five-stage diagnosis and rescue content is still there (e.g. `:17-36`, `:61`); `docs/system-management/logging.md:16` replaced the journald/rsyslog concepts with a link to the basics chapter, while retrieval, retention and pipeline operational content remains (e.g. `:16`, `:18`, `:285`). No other unique technical content was found deleted.
- `docs/SUMMARY.md:3` only gained a note about its role as the sidebar-derived index; the original directory entries were kept, and audit/review report entries were added at `:183-186`. This was not a large-scale SUMMARY trim.

### 2. Statements Changed to Something Wrong

**Conclusion: no numbers in README or the front page were found to disagree with reality; the semantic adjustments to reading paths did not invert any technical meaning.**

- `README.md:18,40` and `README.zh.md:18,40` changed "learn from scratch" and "every chapter has examples" into a personal-notes positioning and "many notes contain hands-on examples", a more careful scope. `README.md:104`, `README.zh.md:104` relabel 126/128 as a historical inspection snapshot instead of continuing to pass them off as current counts.
- `docs/index.md:9-43` removed stale counts such as "38 chapters, 20 chapters" and replaced them with topic summaries. Counted against the review baseline: 148 tracked Markdown files, 146 index content entries, 10 topic directories; the 148 includes index/home pages and structure-audit documents, so it does not equal the number of topic pages. `npm run docs:check` reports `entries=146, listed=146, orphan=0`, reconciling with the sidebar. Once this report was committed and added to navigation, content entries rose by 1.
- `docs/knowledge.md:8` changed the "concept -> commands -> services -> troubleshooting" learning skeleton into a content thread and made explicit that no fixed order is required; `docs/research/application-scenarios.md:39-72` turned the numbered reading route into an unordered index of related pages. Their link topics still match their descriptions -- installation through services, desktop, embedded and operations pages are all still on the application-scenarios page. What changed semantically is that the mandatory order was dropped, not that the meaning of the technical steps was altered.
- The review baseline had 148 tracked Markdown files; after adding this report it is 149, and SUMMARY/sidebar currently include 147 content pages. The `docs:check` source-file and index checks pass, but its sitemap reads a 148-page stale build artifact; not verified: VitePress was not rebuilt this round, so we cannot claim on that basis that the new report is in the build output.

### 3. Links and Navigation

**Conclusion: every added or renamed navigation entry has a matching file; sampled targets match their topics; the repository link check passes.**

- `docs/.vitepress/config.mts:556,599` and `docs/SUMMARY.md:131,143` renamed the two identically titled firewall entries to "Policy Design" -> `security/firewall.md` and "Connectivity Troubleshooting" -> `network/firewall.md`. The target pages match their labels, and both bodies explain the division of labour (`docs/security/firewall.md:3`, `docs/network/firewall.md:3`).
- `docs/.vitepress/config.mts:726-750` added the `/knowledge` and `/review/` sidebars; `docs/knowledge.md`, the audit page and this report all exist. The knowledge, structure-audit and content-review entries in SUMMARY each point at the corresponding file. The SUMMARY URL in the README and `/SUMMARY` on the front page still point at the contents page.
- `npm run docs:check` (after the report was added to navigation): `issues=0`, `pass=33683 fail=0`; index 147/147 with no orphan pages; the sitemap listed by the script is the old 148/148 artifact and does not include this report, which has not been rebuilt yet.
- Not verified: apart from the Red Hat page used to confirm the cockpit example, no reachability sweep was run over external references untouched in this round; a static repository check does not prove that every external site is reachable right now.

### 4. Failing Items and Decisions Pending

**Conclusion: no unfixed definite errors; no content merge or cut that needs a user decision.** The firewall-only cockpit information has been moved to the authoritative page and accurately scoped, the other splits keep their distinct angles, and no page was deleted wholesale.

## Issue List

| Severity | Issue | Status / commit |
|---|---|---|
| Medium | The firewalld `public` zone allowlist was generalized to ssh and dhcpv6-client only, dropping the cockpit case; see `docs/security/firewall.md:170,309` before the fix and the merged paragraph `docs/network/firewall.md:96-98` | Fixed, `0d1aa79` |

## Acceptance Conclusion

One definite technical error was found and fixed in a separate commit; structure, remaining statements, navigation and index checks revealed no other problems. The fix commit is in and the final `docs:check` reports 0 issues; **once this report and the fix commit are pushed, this batch of changes can be considered accepted.** VitePress was not rebuilt this round, so the state of the build output is unverified.
