# Text Processing

Text processing is a core shell scripting skill -- on Linux, configs, logs, account data, and process information almost all live as text, and the day job of a script is "filter, count, and rewrite information out of text". `grep`, `sed`, and `awk` are called the three musketeers: **grep finds, sed edits, awk computes**. All three use regular expressions by default, but in different dialects (BRE / ERE / their own), which is exactly the handoff point to [Regular Expressions](./regex.md). The commands chapter covered the basics (see [Text Processing Commands](../commands/text/text_processing.md)); this chapter focuses on **composing them in a script, exit-code semantics, and picking between tools**, avoiding long repetitions of basic options.

> Content draws on the GNU manuals, Bird's Private Recipes (Lin's Linux Administration Guide), and The AWK Programming Language; see the references at the end.

## What This Page Covers

- `grep` exit-code semantics and the common flag combinations in scripts
- Using `sed` for address-scoped substitution, in-place edits, and safe backups
- `awk` fields, patterns, built-in variables, and sum/dedupe
- Making the right pick among `grep`/`sed`/`awk`/`cut`/`sort` for the task
- Understanding pipe exit codes and the effect of `pipefail`

## 1. grep: Search and Filter

### 1.1 Core Flags and Script Uses

The most-used flag combinations: `-i` case-insensitive, `-n` show line numbers, `-v` invert, `-c` print only the matching line count, `-o` print only the matched part, `-r` recurse into directories, `-E` extended regex (ERE), `-F` fixed string (fastest), `-w` whole word, `-A`/`-B` print context after/before the match. Use `--` to end option parsing when the pattern starts with `-`. **`egrep`/`fgrep` are deprecated by POSIX**; in scripts always write `grep -E` / `grep -F`.

**Exit codes are what matter in a script**: 0 means at least one matching line was found (the `if grep -q ...; then` condition is true), 1 means no matches at all, 2 means an error (file missing, etc.). To tell "not found" apart from "error" do not just test for non-zero -- capture `$?` and check whether it equals 1. A typical idempotent config write: `grep -q "^USE_NTP=yes" /etc/ntp.conf` -- skip if already present, otherwise append one line.

**`grep -c` returns 1, not 0, when there is no match** -- in counting scripts that "allow no match", remember `|| true` or `count=$(grep ... || true)`. Under `set -o pipefail`, a middle `grep` returning 1 makes the whole pipe non-zero and triggers `set -e` to abort; before putting it in a strict-mode script think about whether "no match" is an error.

### 1.2 Common Script Combinations

Recursive search excluding version-control directories: `grep -rn --exclude-dir={.git,node_modules} "TODO" src/`. Extract just the matched part and then count: `grep -oE 'IP regex' access.log | sort | uniq -c | sort -rn | head`. For pure counting prefer `grep -c` -- an order of magnitude faster than a hand-written `while read` -- but once you need complex per-line branching (multiple conditions, accumulation, skipping comments), switch to a loop; see [Loops](./loops.md).

```bash
$ printf 'GET /a 200\nPOST /b 500\nGET /c 404\n' > access.log
$ grep ' 5[0-9][0-9]$' access.log | sed -E 's| /[^ ]+ | |' | awk '{print $1, "=>", $NF}'
POST => 500
```

Composition semantics: `grep` first filters the 5xx lines, `sed` strips the path leaving only method and status, `awk` then lays it out by field -- one job per stage, which is exactly the division of labor among the three musketeers.

## 2. sed: The Streaming Editor

`sed` reads each line into the pattern space, runs the script commands on matching lines, then outputs -- it is a **non-interactive** line editor, suited to "batch, repeatable, scriptable" substitution. The core is `s/old/new/g`: without `g` only the first match on each line is replaced, `-i` edits in place, `-n` suppresses default output and works with `p` to print only the replaced lines, `-i.bak` edits in place and keeps a backup (**strongly recommended** -- `sed -i` rewrites the original file directly; a wrong regex like `s/.*//` empties the content in an instant with no undo).

You can change the delimiter: when paths have too many slashes, `s|/usr/local|/opt|g` or `s#^http://#https://#` is clearer. Addresses scope the substitution to some lines: line number `5`, range `5,10`, to the end `5,$`, regex `/^DEBUG/`, GNU extension `/error/,+3` (the match plus the next 3 lines). Delete with `d` (`/^#/d` removes comment lines, `/^$/d` removes blank lines); insert/append with `i\` and `a\` -- GNU sed and BSD sed (macOS) differ in syntax, and **all three distro families in these notes use GNU sed**.

Practical snippets: extract the value from `key=value` with `-n 's/^name=//p'`; strip leading/trailing whitespace with `s/^[[:space:]]*//;s/[[:space:]]*$//`; combined with a pipe it edits only the stream in memory and never touches the original (redirect to a new file then `mv`) -- a safer in-place editing pattern. In the replacement, `&` stands for the whole match and `\1`--`\9` for the groups -- different from `grep`, which only matches and never replaces.

## 3. awk: Fields and Statistics

`awk` is a "pattern-action" language: for each line, if the pattern matches, run the action. It has built-in field splitting (whitespace by default), arithmetic, and associative arrays, making it naturally suited to **column-wise statistics**. Most common: `{print $1}` prints the first field; `-F:` sets the delimiter; `$3 >= 1000` for conditional filtering; `/error/` for a regex pattern; `NR == 5` for the 5th line; `NR>=10 && NR<=20` for a line range; `END {print NR}` for the total line count (the END block runs only once).

Built-in variables: `NR` lines processed so far, `NF` fields in the current line, `FS`/`OFS` input/output delimiter, `FILENAME` current filename, `FNR` line number within the current file (differs from NR across multiple files), `RS` record separator. `BEGIN {FS=":"}` lets you change the delimiter before reading starts.

Three statistical staples: **sum** `'{sum += $3} END {printf "sum=%.2f", sum}'`; **dedupe** `!seen[$0]++` (on first sight `seen[$0]` is 0, a false value, so `!0` is true and it prints, then it increments; on the second sighting `!1` is false and it does not print -- "keep the first occurrence" in one line); **frequency** extract the field then `sort | uniq -c | sort -rn`. Format output with `printf "%-20s %10d\n"`; for multiple files, `FNR==1 {print "=== " FILENAME " ==="}` prints a separator header.

```bash
$ printf 'alice 100\nbob 250\ncarol 150\nalice 50\n' > score.txt
$ awk '{sum += $2} END {printf "sum=%.0f avg=%.1f\n", sum, sum/NR}' score.txt
sum=550 avg=137.5
$ awk '!seen[$1]++ {print $1}' score.txt   # keep first occurrence by field 1
alice
bob
carol
```

**`awk`'s default field separator is "any whitespace"**, so runs of consecutive spaces do not produce empty fields; to split on single spaces or parse CSV you need an explicit `FS`. Do not hard-split a CSV with spaces in it using `-F,` -- consider stricter parsing. For mixed CJK and Latin text, prefer `[[:space:]]` over `[ \t]` for portability.

## 4. Other Tools and Choosing

The commands chapter has full sections; here only the highest-frequency one-liners in scripts: `cut -d: -f1,3` pulls columns by fixed delimiter (lighter than `awk`); `sort -k2 -n` numeric sort by column; `sort -u` sort and dedupe; `sort | uniq -c | sort -rn` the standard triple for frequency counts; `tr 'a-z' 'A-Z'` character-level mapping (mapping only, no per-column logic); `wc -l` count lines.

**Choosing rule of thumb**: just deciding "is there one / which lines" -> `grep`; rewriting content by line number or regex -> `sed`; filtering, summing, and formatting by **field** -> `awk`; a fixed delimiter to pull a few columns with no logic -> `cut`; sort, dedupe, and count -> `sort`+`uniq` (awk is bad at sorting). Common combos: TOP 10 IPs is `awk '{print $1}' | sort | uniq -c | sort -rn | head`; hourly request volume extracts the time field then `cut -d: -f2 | sort | uniq -c`; watching errors live is `tail -f | grep --line-buffered` (without `--line-buffered`, grep buffers in blocks and the log lags).

**Pipe exit-code reminder**: in a pipe like `sort | uniq | head`, when the last command is `head`, a preceding `grep` with no match (exit 1) is masked without `pipefail`; with `pipefail` the whole pipe becomes non-zero. Before putting this in a `set -euo pipefail` script, decide whether "no match" is an error, and add `|| true` as needed.

## 5. Practice: Nginx Log Analysis

Design approach: argument validation (`usage` + `[[ -r ]]`) -> total requests `wc -l` -> unique IP count by extracting the first field `sort -u | wc -l` -> TOP IPs and status-code distribution, each via `sort | uniq -c | sort -rn`. Everything is a read-only pipe, no destructive operations, so you can hang it on cron for a daily report. At real scale the output looks like 12043 total requests, 876 unique IPs, status codes dominated by 200 with 404/502 mixed in -- a sudden spike in 502 means it is time to check upstream. Complex branching (bucket alerts by status code, count crawlers by UA) is where you reach for an `awk` script or a combination of the three musketeers in this chapter.

```bash
$ cat > nginx-stats.sh <<'EOF'
#!/bin/bash
# Usage: ./nginx-stats.sh access.log
set -euo pipefail
log=${1:?Usage: $0 <access.log>}
[[ -r "$log" ]] || { echo "Error: cannot read $log" >&2; exit 1; }

echo "Total requests: $(wc -l < "$log")"
echo "Unique IPs: $(awk '{print $1}' "$log" | sort -u | wc -l)"
echo "TOP 5 IP:"
awk '{print $1}' "$log" | sort | uniq -c | sort -rn | head -5
echo "Status code distribution:"
awk '{print $9}' "$log" | sort | uniq -c | sort -rn
EOF
$ chmod +x nginx-stats.sh
$ ./nginx-stats.sh access.log
Total requests: 12043
Unique IPs: 876
TOP 5 IP:
   1520 203.0.113.7
    984 198.51.100.23
    ...
Status code distribution:
   9871 200
   1432 404
    511 502
    ...
```

## 6. Common Gotchas in This Chapter

1. **`grep -c` returns 1, not 0, with no match**. `count=$(grep -c X f)` can abort outright under `set -e`; write `|| count=0`.

2. **`sed -i` edits in place without a backup**. A wrong regex empties the file in a second. Use `sed -i.bak` or copy first.

3. **`awk`'s default field separator is "any whitespace"**, so consecutive spaces do not produce empty fields; to split on single spaces or parse CSV you need an explicit `FS`. Do not hard-split a CSV with spaces using `-F,`.

4. **`cat file | grep` wastes a process**. Redirect with `grep pat file` to fork one fewer `cat` -- the difference is noticeable in scripts and loops.

5. **`$9` and later are fine in awk, but do not use positional parameter `$1` to extract fields in the shell** -- a log line is not a script argument; use `cut`/`awk`.

6. **Treating "no match" as an error under `set -o pipefail`**. grep/sed return 1 when no pattern is found, making the whole pipe non-zero; add `|| true` as needed.

7. **Wrong character class when mixing CJK and Latin**. `[[:space:]]` is more portable than `[ \t]`; when handling UTF-8 Chinese, ensure the locale is UTF-8, or `.` and character classes are treated by byte.

8. **Reinventing the wheel from the commands chapter**. Full option tables for `sort`/`uniq`/`cut`/`wc` are in [Text Processing Commands](../commands/text/text_processing.md); this chapter only emphasizes composition and exit codes.

## References

- `man grep`, `man sed`, `man awk`, `man cut`, `man sort`, `man uniq`
- GNU Grep manual -- [gnu.org](https://www.gnu.org/software/grep/manual/)
- GNU Sed manual -- [gnu.org](https://www.gnu.org/software/sed/manual/)
- GNU Awk manual -- [gnu.org](https://www.gnu.org/software/gawk/manual/)
- The AWK Programming Language -- [awk.dev](https://awk.dev/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Text processors -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Commands chapter - Text Processing Commands -- [docs/commands/text/text_processing.md](../commands/text/text_processing.md)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [examples](examples.md)
- [functions](functions.md)
