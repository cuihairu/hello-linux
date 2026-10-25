# Text Processing Commands

Much of Linux ops and development work is, at its core, "turn one pile of text into another pile": filter logs, extract fields, count and summarize, bulk-replace. `grep`, `sed`, and `awk` are called the three musketeers of text processing, and together with the small tools `sort`/`uniq`/`cut`/`tr`/`wc` you can build surprisingly powerful pipelines with pipes. This page emphasizes **semantics and exit codes**, because in a script "the command succeeded" usually just means "the exit code is 0".

> Example output comes from a real Ubuntu 26.04 environment. All the tools below are installed by default on Debian/Ubuntu, RHEL/CentOS/Rocky, and Arch.

## What This Chapter Covers

- `grep` searching and its exit-code convention (0/1/2)
- Use `sed` / `awk` for substitution, line deletion, column processing, and simple counting
- The pipe building blocks `sort`/`uniq`/`cut`/`tr`/`wc`
- BRE / ERE differences and the POSIX deprecation of `egrep` / `fgrep`

## 1. Viewing Text

The viewing commands have full behavioral coverage in [File Operation Commands](../basic/file.md) and [Text Editing and Viewing Tools](./editors.md); here we only list the points that matter to pipelines.

### 1.1 cat / less / head / tail

```bash
cat -n file.txt / cat -A / head -n 5 / tail -n 3 / tail -n +18 / tail -f / less
# cat -n: 1  Hello Linux
# cat -A: Hello Linux$ / Second line^Iwith tab$ (^I=Tab, $ at end of line)
```

**Pipe habit**: `head` / `tail` take either a file argument or standard input; `less` works too, as in `dmesg | less`. For real-time multi-file or rotation, prefer `tail -F`.

## 2. Searching Text

### 2.1 grep - The King of Search

`grep` looks for matching lines in a file or on standard input. The most important thing to remember is not the option list, it is the **exit codes** -- almost all script control flow depends on them.

```bash
printf 'Apple pie\nbanana\nAPPLE sauce\ngrape\n' > g.txt
grep -i apple g.txt        # ignore case -> Apple pie / APPLE sauce
grep -n -i apple g.txt     # with line numbers -> 1:Apple pie / 3:APPLE sauce
grep -c -i apple g.txt     # just the number of matching lines -> 2
grep -v -i apple g.txt     # invert -> banana / grape
grep -A1 -i apple g.txt    # 1 line after the match
grep -B1 -A1 -i apple g.txt # 1 before + match + 1 after
grep -rn "Hello" . --include="*.txt"   # recursive, restricted by extension
grep -F 'Apple pie' g.txt  # fixed string
grep -E -i 'apple|banana' g.txt        # extended regex
```

**Exit codes (memorize these)**:

| Exit code | Meaning |
|--------|------|
| `0` | at least one line matched |
| `1` | no matches (**not an error**) |
| `2` | a real error: syntax error or file does not exist |

```bash
grep nomatch g.txt; echo $?
grep -i apple g.txt >/dev/null; echo $?
```

```text
1
0
```

Pipe trap: by default, the exit code of `grep nomatch | wc -l` comes from `wc` (0), so `set -e` does not abort. To detect "was there a match", enable pipe failure propagation:

```bash
set -o pipefail
grep zzz g.txt | wc -l; echo $?
# prints 0, exit code 1 -- grep's "no match" propagated out
set +o pipefail
```

### 2.2 egrep / fgrep - Deprecated by POSIX, use `grep -E` / `grep -F` instead

`egrep` and `fgrep` were historically aliases for `grep -E` (extended regex) and `grep -F` (fixed string) respectively. **POSIX has marked them as deprecated**, on the grounds of semantic duplication with `grep -E`/`-F`, inconsistent behavior across historical implementations, and the compatibility baggage the `egrep` name carries in newer standards; some system documentation and newer distributions no longer recommend -- or even provide -- the standalone aliases. Therefore: **always write `grep -E` / `grep -F` in new scripts and new docs**; treat `egrep` / `fgrep` in old code as synonymous and replace them gradually.

```bash
grep -E "pattern1|pattern2" file.txt   # equivalent to the deprecated egrep
grep -F "fixed string" file.txt        # equivalent to the deprecated fgrep (literal match, usually faster)
grep -E 'apple|banana' g.txt           # -> Apple pie / banana / APPLE sauce
grep -F 'Apple pie' g.txt              # -> Apple pie
```

Note: `grep -F` treats `.`, `*`, `[`, etc. all as ordinary characters; for regex use `-E` (or the default BRE). For the spec, compare [POSIX grep](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/grep.html) and [Arch Wiki - Grep](https://wiki.archlinux.org/title/Grep).

## 3. Replacing Text

### 3.1 sed - The Stream Editor

`sed` processes line by line and does **not** modify the source file by default. The most common uses are substitution `s/old/new/` and line deletion `Nd`. By default only the **first** match on each line is replaced; add `g` for global.

```bash
printf 'foo bar foo baz\n' | sed 's/foo/FOO/'     # -> FOO bar foo baz
printf 'foo bar foo baz\n' | sed 's/foo/FOO/g'    # -> FOO bar FOO baz
printf 'foo bar foo\n' > sedfile.txt
sed -i.bak 's/foo/FOO/g' sedfile.txt              # in-place with a .bak backup
seq 1 6 | sed '3,5d'    # -> 1 2 6
seq 1 5 | sed -n '2p'   # -> 2 (-n turns off default printing; p outputs the selected line)
seq 1 3 | sed '2i\INSERTED'   # -> 1 / INSERTED / 2 / 3
seq 1 3 | sed '2a\APPENDED'   # -> 1 / 2 / APPENDED / 3
```

GNU sed's `-i` edits the file directly; `-i.bak` (note the no space) writes a backup first. On BSD/macOS, `-i` requires a suffix argument, so cross-platform scripts should either use explicit `-i.bak` or use redirection plus `mv`. `-n` turns off default printing and, combined with `p`, means "only output the selected lines". Addresses support line numbers, `$` for the last line, `/re/` regex, and comma ranges.

**Gotchas**:

- The delimiter does not have to be `/`: for path substitution use `s|/old|/new|g` to avoid escaping `\/`.
- Before `-i`, run `cp file file.bak` or `sed -i.bak`, especially for configurations under `/etc`.
- For binary or large files, watch `sed`'s whole-file load strategy and memory; prefer scoping by line number or narrowing first with `grep`.

### 3.2 awk - Column Processing and Counting

`awk` splits on whitespace by default, with `$1` as the first column, `$0` as the whole line, `NF` as the column count, and `NR` as the line number; `-F` sets the delimiter. It is well suited to "pull the Nth column, filter by condition, group and sum".

```bash
awk -F: '{print $1}' /etc/passwd              # -> root / daemon / bin ...
awk -F: '{print $1, $NF}' /etc/passwd | head -2  # -> root /bin/bash - daemon /usr/sbin/nologin
awk 'NR<=3 {print NR, NF, $0}' fruits.txt     # line number, column count, whole line
awk '{s+=$2} END{print s}' fruits.txt         # sum -> 20
printf 'a 10\nb 5\na 7\nc 3\na 1\nc 3\n' > sales.txt
awk '{s[$1]+=$2} END{for (k in s) printf "%-6s %d\n", k, s[k]}' sales.txt | sort
# -> a 18 / b 5 / c 3
awk 'BEGIN{printf "%-10s %s\n", "NAME", "QTY"}'  # format the header
```

**Gotchas**:

- Numeric comparison is done as a number when the field looks like one, otherwise as a string; dirty data will silently produce wrong results, so coerce with `+0` when needed.
- `awk`'s `printf` format is C-like; `\n` has to be written inside the format string.
- For complex state machines or heavy regex backtracking, modern `gawk` extensions or a dedicated tool are worth considering, but the three musketeers are still mandatory.

## 4. Sorting and Deduplicating Text

### 4.1 sort

```bash
sort fruits.txt           # lexicographic: apple 5 / apple 9 / banana 3 / cherry 2 / date 1
sort -k2 -n fruits.txt    # by the 2nd column numerically: date 1 / cherry 2 / banana 3 / apple 5 / apple 9
sort -u list.txt          # sort and deduplicate
sort -t: -k3 -n /etc/passwd | head | cut -d: -f1,3   # root:0 / daemon:1 / bin:2
```

By default it sorts by **lexicographic order** (and can even be affected by locale); `-n` is numeric, `-r` reverses, `-h` is human-readable size (GNU). When sorting numbers in a pipe, always use `-n`, or `"10"` will sort before `"9"`.

### 4.2 uniq - Deduplicate Adjacent Identical Lines

`uniq` **only merges adjacent duplicate lines**, so you almost always need to `sort` first. `-c` counts, `-d` outputs only the duplicated lines, and `-u` outputs only the never-duplicated lines.

```bash
printf 'apple\nbanana\napple\ncherry\napple\n' > list.txt
sort list.txt | uniq -c   # -> 3 apple / 1 banana / 1 cherry
sort list.txt | uniq -d   # -> apple (only the lines that were duplicated)
sort list.txt | uniq -u   # -> banana / cherry (only the lines never duplicated)
```

**Gotcha**: skipping `sort` and running `uniq` directly means separated duplicates are treated as "not duplicated".

## 5. Transforming Text

### 5.1 tr - Character Mapping and Deletion

`tr` only reads standard input and does not take filenames directly; it is handy for case conversion, character deletion, and squeezing repeated whitespace.

```bash
printf 'hello world\n' | tr 'a-z' 'A-Z'   # -> HELLO WORLD
printf 'a  b   c\n' | tr -s ' '           # squeeze repeated whitespace -> a b c
printf 'abc123\n' | tr -d '0-9'           # delete characters in the set -> abc
```

**Gotcha**: `tr` cannot substitute "one string" for "another string" (that is `sed`'s job); `-d` deletes characters in the set, not lines.

### 5.2 cut - Slice by Delimiter or Character

A lighter column-extraction tool than `awk`, good for simple `-f` cases; it does not support complex conditional logic.

```bash
cut -d: -f1 /etc/passwd | head -3         # -> root / daemon / bin
cut -d: -f1,3 /etc/passwd | head -3       # -> root:0 / daemon:1 / bin:2
printf 'col1,col2,col3\n' | cut -d, -f2   # -> col2
printf 'abcdefghij\n' | cut -c3-5         # -> cde
```

**Gotcha**: `cut`'s delimiter must be a **single character**, not a multi-character string or regex; when a CSV field contains commas use `awk -F'","'` or a dedicated CSV tool.

### 5.3 paste - Merge Multiple Columns by Line

```bash
paste -d, c1.txt c2.txt   # c1: a b c / c2: 1 2 3 -> a,1 / b,2 / c,3
```

The default delimiter is a Tab; `paste -s` joins multiple lines into one.

## 6. Counting Text

```bash
wc -l fruits.txt     # 5 fruits.txt (line count)
wc -lw fruits.txt    # 5 10 fruits.txt (lines and words)
wc fruits.txt g.txt  # lines / words / bytes per file, plus a total line
```

The column order is fixed: line count, word count, byte count. `-l` lines, `-w` words, `-c` bytes (some implementations use `-m` for character count).

**Gotcha**: `wc -l` counts the number of **newline characters**; a final line without `\n` is not counted. Combined with `grep -c`, be careful to distinguish "line count" from "number of matching lines".

## 7. Comparing Text and Patches

```bash
diff -u file.txt file2.txt || true
```

```text
--- file.txt	2024-01-01 12:00:00.000000000 +0000
+++ file2.txt	2024-06-15 08:30:00.000000000 +0000
@@ -1,3 +1,4 @@
-Hello Linux
-Second line	with tab
+Hello Linux v2
+Second line changed
 Third line with trailing space   
+Fourth line
```

Generate and apply a patch:

```bash
diff -u old.conf new.conf > fix.patch
patch < fix.patch          # or patch target_file < fix.patch
```

Exit codes: `0` identical, `1` differs, `>1` error -- just like `grep`'s "1 means no match", **1 here means "differs" in the business sense, not a crash**. Handle it explicitly in `set -e` scripts. More file-level examples in [File Operation Commands](../basic/file.md).

## 8. Regular Expressions

### 8.1 Basic Regular Expressions (BRE)

The default dialect of `grep` / `sed` (POSIX BRE). `+`, `?`, `|`, `()`, etc. are **not** metacharacters and match literally; escape them as `\+`, `\?`, etc. when needed (GNU extension).

| Symbol | Meaning |
|------|------|
| `.` | match any single character |
| `*` | the preceding character 0 or more times |
| `^` | start of line (a literal `^` in the middle of a line, depending on the implementation) |
| `$` | end of line |
| `[]` | character class |
| `[^]` | negated class |
| `\` | escape / quote |

### 8.2 Extended Regular Expressions (ERE)

Used by `grep -E`, `awk` (default is roughly ERE), and `sed -E`. Metacharacter semantics are closer to modern regex intuition.

| Symbol | Meaning |
|------|------|
| `+` | 1 or more times |
| `?` | 0 or 1 time |
| `()` | grouping |
| `\|` | or (in ERE, `\|` works) |
| `{n}` / `{n,}` / `{n,m}` | repetition bounds |

```bash
echo 'a+ b' | grep 'a+'        # BRE: + is literal, still matches
echo 'a+ b' | grep -E 'a+'     # ERE: + is a quantifier -> a+ b
echo 'foo(bar)' | grep -E 'foo(bar)'   # grouping
```

### 8.3 Practical Examples

```bash
printf 'ip 192.168.1.1 ok\ndate 2024-01-15\nmail user@example.com\n' > rx.txt

grep -Eo '[0-9]{1,3}(\.[0-9]{1,3}){3}' rx.txt
grep -E '[0-9]{4}-[0-9]{2}-[0-9]{2}' rx.txt
grep -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' rx.txt
```

```text
192.168.1.1
date 2024-01-15
mail user@example.com
```

**Gotcha**: the IP example is a "teaching-grade" regex and does not validate the 0-255 range; for production validation use a mature parser. Unicode classes and `grep -P` (PCRE, not enabled by default on every system) need a platform-support check first.

## 9. Advanced Pipes

### 9.1 xargs - Turn Standard Input into Command Arguments

When converting `find` / `grep` output into arguments for `rm`, `chmod`, etc., filenames with spaces and newlines are the disaster zone -- prefer `-print0` plus `-0`.

```bash
printf 'one two three\n' | xargs -n1 echo got   # -> got one / got two / got three
printf 'a.txt\0b.txt\0' | xargs -0 -I{} echo "file: {}"  # file: a.txt / file: b.txt
find . -name "*.txt" -print0 | xargs -0 rm     # safe deletion of filenames with spaces
```

**Gotcha**: GNU `xargs` may run the command once even with no input, depending on the options; to "only run when there is input", add `-r` (GNU). Before deleting, drop the `-exec rm` and do a dry run with `find ... -print | xargs -n1 echo` to see the list.

### 9.2 tee - Write to Screen and File at Once

```bash
echo hello | tee teeout.txt     # -> hello on screen and to file
echo world | tee -a teeout.txt  # append -> teeout.txt: hello / world
```

`tee` overwrites by default; `-a` appends; multiple filenames are fine. Use it instead of `> file` when you want to see progress and also persist.

### 9.3 Pipe Combination Example: Log Top Keywords

```bash
grep -i error app.log | awk '{print $3}' | sort | uniq -c | sort -rn | head
```

The pattern is fixed: **filter -> pull column -> sort -> dedupe and count -> sort by count -> truncate**. Swap out any stage to fit a different counting need.

## 10. Common Gotchas Quick Reference

| Symptom | Cause | Fix |
|------|------|------|
| `grep` returns 1 and aborts the script | 1 = no match, `set -e` treats it as failure | check the exit code, or add `\|\| true` |
| `egrep` not found or warns on a new system | POSIX-deprecated alias | rewrite as `grep -E` / `grep -F` |
| `sed -i` clobbered a config | no backup, in-place write | `-i.bak` or copy first |
| `uniq` dedup is incomplete | no prior `sort` | `sort \| uniq` |
| `sort -n` still sorts wrong | mixed non-numeric input or missing `-n` | check the delimiter and `-k` |
| `cut` pulls the wrong column | default is Tab, not arbitrary whitespace | specify the delimiter with `-d:`, or use `awk` for complex cases |
| `wc -l` is one short | the final line has no newline | accept the semantics or pad with `printf '\n'` |
| Pipe "false success" | exit code comes from the last command | `set -o pipefail` |
| Filenames with spaces get split by `xargs` | splitting on whitespace | `-print0` plus `xargs -0` |

## 11. Differences Across the Three Distributions

All three families use the GNU toolchain (consistent `grep` / `sed` semantics); the differences are mainly in **the awk implementation, modern alternative tools, and log paths** -- check the table below before writing cross-distribution scripts.

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| awk implementation | default may be `mawk`, install with `apt install gawk` | `gawk` (confirm with `pacman -S gawk`) | default `gawk` (confirm with `dnf install gawk`) |
| `grep -P` (PCRE) | GNU grep supports it by default | supported by default | supported by default |
| Modern search alternatives (ripgrep/fd) | `apt install ripgrep fd-find` (binary is `fdfind`) | `pacman -S ripgrep fd` | `dnf install ripgrep fd-find` |
| `sed -i` behavior | GNU sed: `-i` needs no suffix, `-i.bak` makes a backup | same | same |
| Default pager / editor | `less` + `nano` | `less` + install your own editor | `less` + `vim-minimal`/`nano` |
| Log path (in the `tail -f` example) | `/var/log/syslog` | `journalctl` preferred | `/var/log/messages` |

**Key points**: the awk on the Debian family is often the lightweight `mawk`, so scripts that depend on gawk features like `asort` should explicitly invoke `gawk`; on Debian/Ubuntu the `fd` binary is named `fdfind`. For Arch see [Arch Wiki - AWK](https://wiki.archlinux.org/title/AWK), [Arch Wiki - Sed](https://wiki.archlinux.org/title/Sed), [Arch Wiki - Grep](https://wiki.archlinux.org/title/Grep).

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Regular expressions and text processing -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- Arch Wiki - Grep -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Grep)
- Arch Wiki - Sed -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Sed)
- Arch Wiki - AWK -- [wiki.archlinux.org](https://wiki.archlinux.org/title/AWK)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- POSIX grep -- [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/grep.html)
- man grep -- [man.archlinux.org](https://man.archlinux.org/man/grep.1)
- man sed -- [man.archlinux.org](https://man.archlinux.org/man/sed.1)
- man awk -- [man.archlinux.org](https://man.archlinux.org/man/awk.1)
- man sort -- [man.archlinux.org](https://man.archlinux.org/man/sort.1)
- man uniq -- [man.archlinux.org](https://man.archlinux.org/man/uniq.1)
- man tr -- [man.archlinux.org](https://man.archlinux.org/man/tr.1)
- man cut -- [man.archlinux.org](https://man.archlinux.org/man/cut.1)
- man wc -- [man.archlinux.org](https://man.archlinux.org/man/wc.1)
- man xargs -- [man.archlinux.org](https://man.archlinux.org/man/xargs.1)
- man tee -- [man.archlinux.org](https://man.archlinux.org/man/tee.1)
- man diff -- [man.archlinux.org](https://man.archlinux.org/man/diff.1)
- Linux man pages (man7) -- [man7.org](https://man7.org/linux/man-pages/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [directory](/commands/basic/directory.md)
- [file](/commands/basic/file.md)
- [text](/commands/text.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [text-processing](/script/text-processing.md)
