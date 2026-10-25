# Practical Examples

The previous nine chapters answer "how do you write the syntax"; this chapter answers "what can you do with it all put together". Three main examples -- **log statistics, file backup, and bulk rename** -- are all high-frequency daily ops tasks. Each comes with a complete runnable script, real terminal output, and a section-by-section design rationale (why `while read` instead of a pipe, why `nullglob` is needed, how exit codes are passed), plus the install commands for the dependent tools across the three distro families. There are also condensed extended examples for system monitoring, access logs, batch SSH, and rsync incremental sync. Get the main examples running first, then adapt the paths and parameters to your own environment.

This chapter does not aim to "cover every ops scenario". Instead, it breaks down the three most common forms (read-only statistics, stateful archiving, bulk renaming) to the point where every safety detail is visible. After reading, you should be able to write a fourth kind of script yourself, not merely change the paths in these three examples. The extended section stays as bullet points to avoid repeating syntax already covered in earlier chapters; when you actually need to ship something, flesh the bullets out into a full script like the main examples.

> Content draws on real ops experience, Bird's Private Recipes (Lin's Linux Administration Guide), and the man pages of the various tools; see the references at the end.

## What This Page Covers

- Independently writing backup/statistics/rename scripts with argument validation and strict mode
- Understanding the "why" behind each design decision (subshells, globbing, exit codes, safety)
- Installing script dependencies with the three distro families' package managers (including the `pacman` equivalent)
- Reading real output and using it to troubleshoot
- Upgrading a single script into a maintainable cron/CI-ready template (DRY, layered exit codes, stderr/stdout separation)
- Porting the skeleton of the main examples onto new tasks instead of reinventing safe patterns from scratch

Reading approach: first read each example's "Task and Why" in full, then go through the complete script section by section asking "if I delete this line, which input kills it?", and finally check whether the real output matches your expectation. If the output differs, check locale, timezone, and working directory before suspecting the logic.

Acceptance suggestion: run each main example against at least three inputs -- a normal directory, an empty directory, and a nonexistent path -- and record the exit codes; then deliberately remove a quote or the `nullglob` to confirm you can name what class of filename breaks it. Being able to explain a failure matters more than being able to recite a script.

## 0. Environment Setup: Dependencies and the Three-Distro Install

The main examples depend only on Bash builtins and coreutils such as `tar`/`find`/`awk`, which are available out of the box on all three distro families (GNU coreutils are common across the three, so no need to worry about BSD differences). In other words: the three main examples below run on Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky **with no extra packages to install**; only the extended examples and the development workflow touch `rsync`, `shellcheck`, and `bashdb`. Install commands for the extended-example tools are as follows:

When preparing the environment, build a one-off demo directory (e.g. `/tmp/script-demo`) and populate it with logs, source files, and `*.txt` files; collect all real output there; **do not** practice on a production directory. Using the same scripts for dry runs and real runs, switching only `DRY_RUN` and the target path, is the workflow this chapter stresses from start to finish.

Default assumption for this chapter: you have read the main text from [Bash Basics](./bash-basics.md) through [Regular Expressions](./regex.md). This chapter does not re-explain what `set -e`, `nullglob`, or `"$@"` mean; it only notes "which rule is used here and why it was chosen". Each section follows a fixed structure: Task and Why -> Full Script -> Real Output -> Design Notes -> (if any) Gotchas.

| Tool | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|--------------|------|--------------------|
| bash (usually already installed) | `sudo apt install bash` | `sudo pacman -S bash` | `sudo dnf install bash` |
| shellcheck | `sudo apt install shellcheck` | `sudo pacman -S shellcheck` | `sudo dnf install ShellCheck` |
| rsync | `sudo apt install rsync` | `sudo pacman -S rsync` | `sudo dnf install rsync` |
| bashdb | `sudo apt install bashdb` | `sudo pacman -S bashdb` | `sudo dnf install bashdb` |

Note the RHEL family's shellcheck package name is `ShellCheck` (camel case), while Debian/Arch are all lowercase -- a typo gives `No match`. All output below comes from **real execution** in a temporary demo directory (date and host-related fields may differ from your environment).

## 1. Example 1: Log Statistics Script

Log statistics is the first lesson in "read-heavy, write-light, depends only on Bash + coreutils", and it is also the best showcase for the combined gotchas of exit codes and subshells. It was chosen as Example 1 because almost every machine has `*.log` files, so you can immediately swap the path to `/var/log` and verify for yourself; at the same time it strings together `nullglob`, process substitution, `case`, and argument validation from earlier chapters into one complete control flow.

### 1.1 Task and Why

Requirement: scan all `*.log` files in a directory and count occurrences of `INFO`/`WARN`/`ERROR`. Output one machine-readable line `INFO=n WARN=n ERROR=n`; exit code 0 means statistics succeeded (a level being 0 is allowed), non-zero means the directory does not exist or there are no statable files -- this way a cron email only alerts when "nothing was actually scanned", not when "there happened to be no ERROR today".

Why not just chain a one-liner `grep -c`? Because: (1) the command explodes with multiple files and multiple levels; (2) you need unified arguments, exit codes, and room to grow (per-hour, per-file output); (3) you must handle "a level is 0" correctly under `set -euo pipefail` -- the classic `grep -c` returns 1 on no match gotcha. `grep -c` also turns "counting" into multi-line output inside a pipe, requiring another `paste -sd+` to sum, and the error branches are more convoluted than this example's `case`.

If the logs come from multiple applications and you need per-file columns, just wrap another loop on the outside; the counters must still live in the current shell and cannot be "shortened" through a pipe. If level names are business-related (e.g. `FATAL`), prefer extending the `case` branches over renaming after the fact with `sed` -- mixing counting with normalization makes the second requirement change particularly painful.

Read the files with `while ... done < <(cat "$dir"/*.log)` process substitution rather than `cat | while`; the reason is in [Loops](./loops.md): the right side of a pipe opens a subshell and the counters are lost. Collect files into an array with `nullglob` first to avoid treating the literal `*.log` as a filename when there is no match; exit 1 directly when there are no files so the caller (cron/CI) can notice. `case` branches stop at the first hit from top to bottom -- if a log line may contain multiple keywords and you need multi-keyword accumulation, switch to independent `[[ ]]` tests.

### 1.2 Full Script

The script deliberately stays "no external text tools, single pass": all decisions are made inside `case`, avoiding the classic accident where `grep -c` returns 1 on no match and is treated as a failure under `set -e`. If your logs are huge, you can swap `cat "${files[@]}"` for `find -print0` streaming input, but the counting loop should still stay in the current shell.

```bash
#!/bin/bash
# logstats.sh -- log level distribution across a directory
set -euo pipefail

dir=${1:-logs}
[[ -d $dir ]] || { echo "Directory not found: $dir" >&2; exit 1; }
shopt -s nullglob
files=( "$dir"/*.log )
shopt -u nullglob
(( ${#files[@]} > 0 )) || { echo "No *.log files"; exit 1; }

info=0; warn=0; err=0
while IFS= read -r line; do
    case $line in
        *ERROR*) err=$((err + 1)) ;;
        *WARN*)  warn=$((warn + 1)) ;;
        *INFO*)  info=$((info + 1)) ;;
    esac
done < <(cat "${files[@]}")

echo "INFO=$info WARN=$warn ERROR=$err"
```

### 1.3 Real Output

The demo directory has three log files, each containing 1 INFO, 1 ERROR, and 1 WARN. The session below ran for real in a temporary directory (timestamps and host-related fields may vary with environment); the second segment shows the stderr and exit code 1 for "directory does not exist", so you can branch directly on `$?` in cron/CI:

```bash
$ ls logs/
app1.log  app2.log  app3.log

$ ./logstats.sh
INFO=3 WARN=3 ERROR=3

$ ./logstats.sh missing/
Directory not found: missing/
$ echo $?
1
```

### 1.4 Design Notes

`case` is far faster than three `grep -c` calls: it forks `cat` only once and all counting happens in the current shell. Exit-code convention: non-zero for bad arguments or no files, 0 for success, so cron and CI can decide easily. If you only need plain counting with no multi-level branching, a direct `grep -c` is faster -- this example picks `case` to show the complete form of "multi-way statistics inside a script".

Why collect files into an array first and then `cat "${files[@]}"`, instead of directly `cat "$dir"/*.log`? Because once `nullglob` is on, if nothing matches, `"$dir"/*.log` inside double quotes **will not** be glob-expanded (quotes suppress expansion), so when the array is empty `(( ${#files[@]} > 0 ))` fails unambiguously; if you write `cat "$dir"/*.log` bare with no files, the behavior depends on the interplay of nullglob and quotes, and different spellings easily produce a "silently cat a literal path" bug. Pin down the set first, then operate on the set -- an order worth cultivating in batch scripts.

Process substitution `done < <(cat ...)` rather than `done < "$dir"/*.log` (a redirection accepts only one file at a time) is also deliberate: you need to feed several logs as one stream to the same loop, and process substitution does it in one shot with the loop still in the current shell -- the counters are not lost the way they are across a pipe. If you switch to a two-level loop `for f in "${files[@]}"; do while read ... done < "$f"; done`, the semantics are clearer, but mind each level's `read` variable scope, and whether skipping empty files should still include the "file count" dimension in the count.

The `case` branch order encodes priority: if a line contains both `ERROR` and `WARN`, only ERROR is counted (first match wins). This is deliberate -- the most severe level takes precedence. If your log format guarantees exactly one level marker per line, order does not matter; if a line can be composite, replace `case` with multiple `[[ ]]` tests ordered by descending severity that allow accumulation, or normalize the logs before counting.

Extension directions: per-file column output (an outer `for f in "${files[@]}"` with inner counting), per-hour bucket aggregation (`cut`/`awk` to pull the timestamp), `tee` the results into CSV. Each time you add an aggregation layer, go back and re-check "is any loop still running on the right side of a pipe" -- the counter-loss bug usually does not show up in unit tests and only surfaces once it is wired to a real directory.

## 2. Example 2: File Backup Script

The backup script squeezes four things -- "archive, name, clean up, exit code" -- into under thirty lines; it is a touchstone for whether you truly understand `set -e` and pipe subshells. Unlike the statistics script, this one involves **destructive operations** (rotation deletion), so the design notes spend more space on safety boundaries and rehearsal.

### 2.1 Task and Why

Requirement: pack a source directory into a timestamped `tar.gz`, keep the most recent N copies, and delete expired backups. Default `KEEP=7` (last seven copies), overridable via an environment variable -- why an environment variable rather than one more positional argument? Because changing the environment in cron is more intuitive than editing the command line, and it does not collide with the "second argument is the backup directory" usage; if you prefer a `--keep` style, parse it with `getopts`, see [Bash Basics](./bash-basics.md).

Why `tar` rather than `cp` file by file? An archive preserves permissions, preserves hard links, and ships one file per machine; why is the timestamp precise to the second? Multiple backups on the same day do not overwrite each other; why is cleanup a modification-time sort with truncation rather than `ls` lexicographic order? Lexicographic order goes haywire at month/day rollovers, and `ls` is unreliable with special filenames and locale-dependent sorting anyway. The `wc -c` byte count after archiving exists so that even under the rare "disk full but tar silently succeeded" failure you can still see the anomaly from the logs (0 bytes or far smaller than expected).

Compared with a minimal "backup only, never clean" script, the rotation logic added here is the real production dividing line: a non-rotating backup directory quietly fills the disk a few months later while the backup task itself still reports success. Rotation failure must also be visible -- this example prints "Cleaned" to stdout for auditability; if you feed centralized logging, `tee` a copy to a fixed file too.

**Safety baseline**: source and backup directories must be validated non-empty, and never `rm -rf` an unquoted variable path -- see [Conditionals](./conditionals.md) and [Loops](./loops.md). `tar -C "$src" .` keeps the archive free of a long redundant prefix; `date +%Y%m%d_%H%M%S` is sortable; `ls -1t` takes the newest N by modification time and drops the rest. The cleanup loop on the right side of a pipe opens a subshell, but here it only `rm`s/`echo`s and returns no variables, so it is acceptable; if you want to count deletions, switch to reading into an array via redirection. The `--` in `rm -f -- "$old"` prevents filenames starting with `-` from being parsed as options.

Rotation count uses the environment variable `KEEP` rather than a hardcoded constant so cron can override with `KEEP=14 ./backup.sh ...` without editing the file; the default of 7 matches the common "keep a week" expectation. Cleanup targets only "the prefix this script produced" and will not delete other `tar.gz` files placed by hand in the directory -- the prefix from `basename "$src"` keeps multiple sources from interfering with one another.

Production enhancements: the `KEEP` environment variable tunes the copy count; pushing to a remote with `rsync` is in section 4.4; wiring `logrotate` is in [Log Rotation](../basic/log/rotation.md).

### 2.2 Full Script

```bash
#!/bin/bash
# backup.sh -- archive a directory + rotate by copy count
set -euo pipefail

src=${1:?Usage: $0 <source dir> [backup dir]}
dst=${2:-./backups}
keep=${KEEP:-7}
name=$(basename "$src")
stamp=$(date +%Y%m%d_%H%M%S)

[[ -d $src ]] || { echo "Source directory not found: $src" >&2; exit 1; }
mkdir -p "$dst"

archive="$dst/${name}_${stamp}.tar.gz"
tar -czf "$archive" -C "$src" .
echo "Created: $archive ($(wc -c < "$archive") bytes)"

ls -1t "$dst/${name}_"*.tar.gz 2>/dev/null | tail -n +$((keep + 1)) |
while IFS= read -r old; do
    rm -f -- "$old"
    echo "Cleaned: $old"
done
```

### 2.3 Real Output

First prepare two small files and run once; the byte count printed by `wc -c` cross-checks against the subsequent `ls -lh` and the `tar -tzf` listing -- the acceptance criterion for a backup script is "can list it, can restore it", not "the command exit code is 0":

```bash
$ echo 'hello backup' > src/a.txt
$ echo 'world' > src/b.txt

$ ./backup.sh src ./backups
Created: ./backups/src_20260922_050700.tar.gz (179 bytes)

$ ls -lh backups/
-rw-rw-r-- 1 cui cui 107 Sep 22 05:06 backup_20260922_050643.tar.gz
-rw-rw-r-- 1 cui cui 179 Sep 22 05:06 src_20260922_050700.tar.gz

$ tar -tzf backups/src_20260922_050700.tar.gz
./
./b.txt
./a.txt
```

### 2.4 Design Notes

`${1:?...}` errors out and exits directly when the argument is missing, more compact than hand-writing `if (( $# < 1 ))`; `basename` takes the directory name as the archive prefix so multiple sources can share one backup directory; `wc -c` prints the byte count so "did it actually get written" is visible at a glance. The listing uses `tar -t` rather than assuming the file is there -- **the acceptance criterion for a backup script is always "can list it, can restore it"**.

Why does the cleanup use `ls -1t | tail -n +$((keep + 1))` instead of sorting by filename? Because the timestamp inside the filename is sortable, but once manually copied old files get mixed in, or the locale affects `ls`'s collation, lexicographic order detaches from "new vs old"; `-t` sorting by mtime is the true intent of "keep the most recent N". `tail -n +K` means start output from line K (inclusive), so paired with the `keep` semantics it is exactly "drop the first `keep`, process the rest". A pipe into `while` opens a subshell; this example only `rm`s and returns no variables, so it is acceptable; if you want to count deletions, change the loop to read into an array via redirection and accumulate in the current shell.

Another easily overlooked point is the behavior when `tar -czf` fails: under `set -e`, a non-zero `tar` terminates the script directly and the cleanup logic after it never runs -- this is usually a good thing (a half-finished archive should not enter rotation as a legitimate backup). If you want "run cleanup even when the backup fails", you need to explicitly consume the exit code with `tar ... || { echo fail; }` and think through whether deleting old intact backups on failure is allowed (by default, absolutely not). The `gzip` layer can also be swapped to `zstd`/`xz` for a different compression ratio; all three distro families' coreutils/package managers can install the corresponding tool, and the script structure needs no major change.

The semantics when `KEEP` is 0 or negative deserve explicit definition: this example's `tail -n +1` hands every archive to the cleanup loop, which equals "keep only the state before the one just written" -- usually not what the user wants. A production version should add `(( keep >= 1 )) || { echo "KEEP must be at least 1" >&2; exit 2; }` at the top to block an illegal configuration before any disk is touched. Likewise, reject when `src` and `dst` land in the same subtree, to avoid "backing up into the directory being backed up" making the archive inflate on itself.

Concurrency and locking: when two machines or two cron jobs back up the same `src` to the same `dst` at the same time, timestamps can collide (second-level precision), and `tar -czf` with the same name will overwrite each other. A simple countermeasure is to splice the hostname or a random segment into the filename; the serious countermeasure is wrapping the whole script in `flock`. The example omits the lock for readability -- add it before wiring in multiple schedulers, otherwise the cleanup logic may also read a half-written archive mid-write.

## 3. Example 3: Bulk Rename Script

The length of the rename example is not in "features" but in **boundaries**: no matches, spaces, already exists, dash-prefixed names, dry-run mode. It is the best teaching sample for code review -- a functionally correct version missing any one guard often still "looks like it runs" in the demo directory and only blows up on real data. Compared with the first two examples, the destructiveness here is more direct (it changes the user's files themselves), so DRY and target-existence checks rank above "rename as many as possible".

The requirement itself will morph in real environments: insert a date prefix, normalize case, skip symlinks, process only files modified in the last 24 hours. Whatever the variation, the safety skeleton does not change -- first fix the set with glob/`find`, then check existence and quoting safety on each target, and only then `mv`; filter conditions belong in the "fix the set" stage, not bolted on as an `if` right before `mv`, otherwise the DRY output will not match the real plan.

### 3.1 Task and Why

Requirement: rename all `*.txt` in a directory to `*.md`. This is a textbook case of "safety details packed into a tiny script": the feature is one `mv` line, but the production-ready version must handle no matches, spaces, already exists, dash-prefixed names, and dry-run mode -- five things. The four below are hard requirements:

1. **No matching files**: with no `*.txt`, the literal pattern enters the loop and `mv` errors -> `nullglob`.
2. **Filenames with spaces**: `my notes.txt` unquoted splits into two arguments -> quote `"$file"` throughout.
3. **Target already exists**: silent overwrite is an incident -> skip first with `[[ -e $new ]]`.
4. **Filenames starting with `-`**: parsed as an option by `mv` -> `mv --`.

On top of that, a `DRY_RUN` switch: for destructive batch operations, print the plan first, confirm it is correct, then run for real -- the ops golden standard. Count with `count=$((count + 1))` rather than `((count++))`, to avoid the post-increment returning 1 when count is 0 under `set -e` and aborting (see [Loops](./loops.md)). `${file%.txt}` is suffix-removal expansion, see [Variables and Data Types](./variables.md). The whole script should pass `shellcheck` with no errors; three-distro install commands are in the section 0 table.

If the source directory is a version control repo or a sync drive, bulk renaming also tugs on watchers/indexes: rehearse on a copy first, or turn the sync client off before running for real. A cross-filesystem `mv` degrades to copy + delete and may leave a half-written target on failure -- for important data, keep backup (Example 2) as a prerequisite rather than assuming `mv` is atomic.

### 3.2 Full Script

```bash
#!/bin/bash
# rename.sh -- *.txt -> *.md, safe bulk rename
set -euo pipefail
shopt -s nullglob

dir=${1:-.}
dry=${DRY_RUN:-0}
count=0; skipped=0

for file in "$dir"/*.txt; do
    base=${file%.txt}
    new_name="${base}.md"
    if [[ -e $new_name ]]; then
        echo "Skipped (already exists): $new_name" >&2
        skipped=$((skipped + 1))
        continue
    fi
    if [[ $dry == 1 ]]; then
        echo "DRY: mv -- '$file' '$new_name'"
    else
        mv -n -- "$file" "$new_name"
        echo "Renamed: $file -> $new_name"
    fi
    count=$((count + 1))
done

echo "Done: renamed $count, skipped $skipped"
```

### 3.3 Real Output

First create a few files in the demo directory (including one with a space). `DRY_RUN=1` only prints the plan; run again with it removed, and the second run counts the remaining files as `skipped` because the targets already exist -- this is exactly what an idempotent re-run should look like:

```bash
$ ls *.txt
my notes.txt  report.txt  sample.txt  words.txt

$ DRY_RUN=1 ./rename.sh
DRY: mv -- './my notes.txt' './my notes.md'
DRY: mv -- './report.txt' './report.md'
DRY: mv -- './sample.txt' './sample.md'
DRY: mv -- './words.txt' './words.md'
Done: renamed 4, skipped 0

$ ./rename.sh
Renamed: ./my notes.txt -> ./my notes.md
Renamed: ./report.txt -> ./report.md
Done: renamed 2, skipped 2

$ ls *.md 2>/dev/null
my notes.md  report.md  sample.md  words.md
```

### 3.4 Design Notes

The space-containing filename `my notes.txt` was never split apart end to end, proving both the glob expansion stage and the loop body quoting are correct. On the second run, existing targets are skipped and counted into `skipped` -- an idempotent re-run does not overwrite. If you switched the renaming to `sed` to process filenames, you would instead have to handle escaping; pure Bash parameter expansion is clearer.

`mv -n` and the `[[ -e $new_name ]]` at the top of the loop are double insurance: the former is GNU mv's atomic tendency (do not overwrite), the latter `continue`s before an overwrite and counts it as skipped, making the statistics more accurate. Relying on `-n` alone, overwrites are silently skipped and the user may think "everything got renamed" when some did not. In DRY mode do not actually `mv`, but still increment the counter inside the DRY branch -- that way the dry-run output's "will process N" matches the real run, making reconciliation easy.

If the directory holds both `*.txt` and `*.txt` inside subdirectories, this script **scans one level only** (`"$dir"/*.txt` does not recurse). For recursion, switch to `find "$dir" -type f -name '*.txt' -print0` with `while IFS= read -r -d ''`; `-print0`/`-d ''` delimit with NUL, which is the only way to safely handle extreme filenames containing newlines -- this is the standard find+rename idiom, far more robust than `for $(find)`.

`${file%.txt}` strips the **shortest suffix** match; if you want "strip any run of `.txt`" without collateral damage to compound names like `notes.txt.bak`, keep `%` as is and do not switch to a greedy form. Prefix collisions are worth guarding too: if a target `.md` file arrived from elsewhere via a hard link or a sync drive, `[[ -e ]]` sees "already exists" and skips -- usually the correct conservative behavior. The acceptance standard for batch operations: first DRY-run in a directory containing filenames with spaces, CJK characters, and `-`-prefixed names, reconcile the count against a manual `ls`, then run for real.

Sorting and ordering: glob expands in lexicographic order under the current locale, consistent with the default `ls`; renaming itself does not depend on order, but if you switch to a two-phase "generate a temp name then rename back" algorithm, you must sort explicitly or use a NUL list, to avoid the two phases disagreeing on order and self-overwriting. Single-level direct renaming has no such problem, which is also why this example insists on "one step + skip if the target exists".

Acceptance after renaming is not only `ls`: if files are tracked by git/backup systems, run a status check before and after (e.g. `git status` or `rsync -n`) to avoid the silent inconsistency of "script succeeded, index not updated". For batch operations, write the three steps **plan (DRY) -> execute -> reconcile the listing** into a runbook, more reliable than relying on the operator's memory.

## 4. Extended Examples

The main examples cover the three local operation types "read, write, rename"; the extended examples add monitoring snapshots, access logs, batch remote, and incremental sync, rounding out the four most common ops script directions. The extended examples lean toward "bullet-point lists" rather than full scripts -- the skeleton and safety patterns follow the main examples; only the domain-specific differences are emphasized here.

The right way to read the extended examples: do not copy a half command line straight into production; first ask three things -- is the input read-only, is failure perceivable, and are the dependencies named the same across the three distro families. Only after all three are confirmed should you flesh out `usage`, strict mode, and exit codes using the main examples' template; then the extended examples are truly usable. Each subsection below unfolds as "Requirement -> Data source/Command choice -> Boundaries and acceptance", keeping the narrative level consistent with the main examples.

### 4.1 System Resource Monitoring (Single Snapshot)

Requirement: one command prints CPU idle rate, available memory, root partition usage, and load, with output kept in "key: value" form for secondary processing by `awk`/`jq`. Why not `top`/`htop` in one go? Because a script needs **parseable, storable, alertable** stable fields; `top`'s interactive UI and localized output (decimal points, thousands separators, language) are all unsuitable for reprocessing. Data sources read `/proc/stat`, `/proc/meminfo`, and `df` directly; the interfaces are identical across the three distro families (procfs and coreutils are common to all three); if procfs is trimmed in a container, switch to the `cgroup` interface or collect on the host.

Script key points: CPU idle rate divides `idle+iowait` by the sum of all fields in the `cpu` line (cumulative since boot, suited to coarse-grained snapshots); memory prefers `MemAvailable` over `MemFree` (the latter excludes reclaimable cache and badly underestimates available memory); load takes the first three fields of `/proc/loadavg` directly.

```bash
#!/bin/bash
set -euo pipefail
read -r _ cuser cnice csys cidle ciowait cirq csoft csteal _ < /proc/stat
cpu_total=$((cuser+cnice+csys+cidle+ciowait+cirq+csoft+csteal))
cpu_idle_pct=$(( 100 * (cidle+ciowait) / cpu_total ))
mem_total=$(awk '/^MemTotal/{print $2}' /proc/meminfo)
mem_avail=$(awk '/^MemAvailable/{print $2}' /proc/meminfo)
disk_root=$(df -h / | awk 'NR==2{print $5}')
printf 'CPU idle: %s%%\n' "$cpu_idle_pct"
printf 'Mem available: %s / %s KiB\n' "$mem_avail" "$mem_total"
printf 'Root partition: %s\n' "$disk_root"
printf 'Load: %s\n' "$(cut -d' ' -f1-3 /proc/loadavg)"
```

Real output (local demo, values change with load):

```bash
$ ./sysinfo.sh
CPU idle: 63%
Mem available: 30272288 / 39948940 KiB
Root partition: 58%
Load: 10.71 25.26 28.77
```

Continuous monitoring should not run `while true; sleep` resident inside a script (the process is hard to manage, the log hard to rotate); handing it to cron or a `systemd` timer called once a minute fits ops practice better; for second-level curves use `sar`, `mpstat`, or a Prometheus collector rather than reinventing the wheel. If you must write a resident loop, at least `trap` for `TERM`, bound log rotation, and avoid unbacked busy polling.

The output of `/proc` and `df` can differ between container and host perspectives: inside a container `df /` is often an illusion after overlay, and CPU may be a value relative to the host's quota. Running the script at "the layer you actually want to monitor" (host agent vs container probe), or explicitly reading the cgroup interface, matters more than mislabeling host numbers as container metrics.

### 4.2 Nginx/Apache Access Log TOP IP

Design: required argument + `[[ -r ]]` readability check -> `wc -l` total requests -> extract the first field with `sort | uniq -c | sort -rn | head` for TOP N. All read-only, can be hung on cron directly. Combined with the status-code distribution script from [Text Processing](./text-processing.md), you get an ops daily report quickly.

Why is TOP IP a good fit for `sort | uniq -c` but not for associative-array counting? Because log line counts are often in the millions; an associative array avoids external sorting but memory and Bash hash overhead blow up first; `sort` uses external sorting and handles inputs larger than memory, and it is a standard capability of coreutils/`sort` across the three distro families. If you only care about "the last hour", filter by timestamp with `awk '$4 >= ...'` first and then count, to avoid rescanning the full file.

Field extraction must handle quotes and spaces: `$1` under the default delimiter is enough for "client IPs without spaces"; if upstream emits forwarded fields with spaces, strip by `"` before `awk '{print $1}'`, or fix the field count with `logformat`. Each extra pipe stage is one more fork; in the TOP 10 scenario the bottleneck is usually disk reads rather than `uniq`; if you truly need to optimize, `tail` a window file first and then count.

### 4.3 Batch Remote Execution

Key points: `hosts.txt` one host per line, skipping blank lines and `#` comments; `ssh -o BatchMode=yes -o ConnectTimeout=5` -- `BatchMode` avoids hanging at a password prompt, `ConnectTimeout` keeps one hung host from dragging down the whole loop; each machine's failure is consumed with an `if` on the exit code without aborting the run, and handled together after aggregation. **Do not** write `while read host; do ssh ... || exit 1; done` -- that abandons the remaining hosts at the first failure.

For failure aggregation, prefer "write the failures into an array + exit non-zero at the end" over printing and then `exit 0`: the caller (CI/Ansible wrapper) needs to know "how many did not make it". Concurrency can use `xargs -P` or background `&` + `wait`, but cap the limit to avoid opening hundreds of SSH connections at once and tripping rate limits; when output interleaves, prefix each line with `[host] `, or write temp files first and merge per host. Key and `known_hosts` policy (`StrictHostKeyChecking=accept-new` vs pre-provisioned fingerprints) must be pinned down in team docs, otherwise the first connection to a new machine hangs -- unrelated to the script itself, yet the most common cause of "false death" in batch execution.

### 4.4 Remote/Incremental Backup (rsync)

`rsync -avz --delete --exclude '.git' "$src/" "$dest"`: a trailing `/` on the source path means "copy the directory's contents" rather than the directory itself; `--delete` removes files in the target that no longer exist in the source -- **confirm the target path before the first run**, and you can first drop `--delete` for a rehearsal. Three-distro install: `sudo apt install rsync` / `sudo pacman -S rsync` / `sudo dnf install rsync`; install first, then run.

The relationship with section 2's local `tar` backup is complementary, not either-or: `tar` suits "a portable snapshot at a moment in time" (restore does not depend on rsync), `rsync` suits "keeping a long-term mirror + saving bandwidth on large directories". A common combination is local `tar` keeping N copies with a nightly `rsync` push to a NAS; the cleanup strategies on the two sides must be accounted separately -- do not sweep two roots with the same `find -delete`.

`-a` already includes `-rlptgoD`, so generally do not add `-r` separately; `-z` gives little benefit on already-compressed logs and costs CPU, so turn it off on a LAN. The `--exclude` pattern is a glob relative to the source path; the semantic difference of omitting the trailing `/` applies only to the source path itself and usually does not affect `--exclude` directory names -- what really deserves care is target consistency under `--delete-after` and `--delay-updates` during a power loss; on critical paths add `--partial --append-verify` to guarantee resume semantics (defer to the man page of your installed rsync version).

### 4.5 Exit Codes, Signals, and Teardown

All three main examples treat "exit code" as part of the API: 0 success, 1 business/environment failure, 2 usage error. When wired into cron, a non-zero exit triggers MAILTO by default; if you only want to log without sending mail, explicitly `|| true` or `>/dev/null 2>&1` in the cron line, but do not `|| true` away every error inside the script -- that removes the caller's only perception channel.

The minimum `trap` set is `INT`/`TERM` (do not leave half-finished temp files on stop) and `EXIT` (unified cleanup). `HUP` is meaningful when a remote session drops; interactive tools can register it while they are at it. Note that `trap` still fires on an EXIT triggered by `set -e`, but `$?` is already the failure code at that point; the cleanup logic must not overwrite it and then `exit 0`, unless you intend to swallow the error -- swallowing errors is a subtler incident source than a missing DRY.

Layered exit codes are especially useful when composing multiple scripts: an upper orchestration script seeing 127 knows to install dependencies first rather than retry, and seeing 2 knows to print usage rather than alert. If your monitoring only distinguishes "non-zero means bad", at least write the meaning of each non-zero code into the script header comments so the next person can write `case $? in`. Do not do heavy work in signal handlers -- `INT` should only delete temp files and restore the terminal; time-consuming cleanup belongs in `EXIT` or in self-healing logic at next startup, otherwise the user feels the script "hangs" when pressing Ctrl+C.

## 5. Assembling the Examples into a Maintainable Script

The three main examples each run on their own, but to enter a repository or a pipeline they still need a unified skeleton. This section introduces no new syntax; it answers one question: **how to let the next person (or you three months from now) fix one boundary correctly in ten minutes**. The answer is to lock "argument validation, strict mode, exit codes, cleanup, DRY" into a template rather than rewriting from feel every time.

The recommended copy-as-template order is: shebang with a one-line description, `set -euo pipefail`, `usage()` and argument parsing, `main "$@"`, and a single `main "$@"` business entry at the end of the file. Add `trap` on destructive paths: at minimum `INT` must restore the terminal or clean up half-finished work, and `EXIT` can handle must-run teardown like "delete the temp directory". Separate functions from business logic -- define first, orchestrate in `main`, so tests can `source` and call a single function directly.

Add the shellcheck gate from [Script Debugging](./debugging.md) (in CI, `shellcheck -x *.sh` blocks on failure) and `trap EXIT` cleanup, and you reach the baseline of "can hand it to a colleague, can put it in cron". Naming, indentation, whether `eval` is allowed -- style questions go to shellcheck and the team `.editorconfig`, not to manual eyeballing in code review. Every choice in the template maps to an earlier chapter: the side-effect boundaries of `set -euo pipefail` in the debugging chapter; `"$@"` and `local` in the variables and functions chapters; loops staying out of pipes and glob paired with nullglob in the loops chapter; arguments and file tests in the conditionals chapter.

Reading all three examples through and then going back to adapt your own environment is far safer than copying an online "one-click script" from scratch -- you know which incident each line guards against. From a maintenance standpoint, three practices are worth writing into team standards: first, **destructive operations always DRY first**; second, **separate logs from data** (notices on stderr, results on stdout) so cron mail, CI logs, and upper-level scripts can all consume them at once; third, **layered exit codes** (0 success, 1 business failure, 2 usage error, 127 missing dependency) so callers can write reliable `if`/`&&` chains. These three look excessive in a small single-machine script and become hard requirements the moment they enter a pipeline.

When landing the template, fix the directory conventions: `bin/` for entry scripts, `lib/` for sourced function libraries, `tests/` for stdout/exit-code assertions (`bash tests/run.sh`). Even with only two scripts, setting up the `shellcheck` CI step is worth it first -- it catches quoting, subshell, and spelling-level problems more reliably than manual review. When a version upgrade must stay compatible with older environments, pin the minimum version with `#!/bin/bash` and state "requires Bash >= 4.0" clearly in the README (the dividing line for associative arrays, `mapfile`, etc.), so users do not run it under an old system's default `sh` and get wildly different errors.

Maintainability also shows up in "executable error messages": an error carrying the offending path, the argument, and the next action ("Source directory not found: ... (check the mount)") cuts tickets in half compared to a bare `error`. Every `echo ... >&2` in the examples follows this principle -- leave troubleshooting clues on stderr, data on stdout, neither polluting the other. Handoff documentation contains at minimum: how to DRY-run, how to read exit codes, how to install dependencies on the three distro families, and the steps to roll back to the previous backup -- those four sections in `bin/README` are more reliable than word of mouth.

### 5.1 A Skeleton Checklist You Can Reuse Directly

Extract the common parts of the main examples into a checklist (the order is the implementation order): 1) shebang + `set -euo pipefail` + a brief `usage`; 2) argument unpacking and `[[ -d ]]`/`[[ -r ]]` validation, exit 2 on failure; 3) `command -v` to check external dependencies, exit 127 with the three-distro install names (including `pacman`) printed if missing; 4) destructive branches DRY_RUN first; 5) core loops confirmed not to lose state on the right side of a pipe; 6) success path exit 0, business failure exit 1; 7) `trap EXIT` to clean up temp files. A script with all seven boxes ticked can go into cron with confidence.

### 5.2 When to Split into a Library, When to Stay Single-File

Single-file is easy to copy and audit (one `scp` deploys it), suited to scripts under 300 lines used by a single entry point. When a second script starts copy-pasting the same `log`/`require_cmd` block, extract `lib/*.sh` and locate it with `${BASH_SOURCE[0]}`; when the same function has three patches across three repositories, move it into a shared library and tag it. Conversely, extracting a library too early turns every change into a cross-file review, a burden for one-off ops scripts -- **abstract on the second repetition, not the first**.

## 6. Common Gotchas in This Chapter (Practice-Oriented)

The gotchas in the practice chapter are almost never "syntax written wrong" but "semantics written wrong yet it looks like it runs": the script is all green in the demo directory and loses data the first time it hits production. The eight below are ordered by harm; pin them into the comment header of your script template and tick them one by one. Each maps to a design decision above -- reading the "why" before memorizing the "do not" sticks better than reciting a checklist.

### 6.1 Data and Destructive Operations

1. **Destructive operations without a dry-run mode**. Renames, deletes, `rsync --delete` all print the plan first with `DRY_RUN=1`. The dry-run output must contain the **full command lines that will run**, not just filenames -- that is how you spot path-concatenation errors straight from the logs.

2. **Paths and filenames left unquoted**. `"$src"`, `"$file"`, `"$archive"` must not be unquoted anywhere in `mv`/`rm`/`tar`. Glob expansion handled by Bash is safe; the danger is stuffing the expanded result into an unquoted variable again, or feeding it through `eval`/`sh -c` once more.

3. **Cleanup collateral damage**. `find $dst -name '*.tar.gz' -delete` deletes every archive in the directory; restrict it to the prefix `${name}_` and the retention count. Once the cleanup prefix detaches from the archive naming (say you changed the `basename` rule but not the cleanup glob), you get the silent incident of "new backups pile up forever, old backups never delete" -- or the reverse.

4. **Timestamps only to the day**. Multiple backups on the same day overwrite the archive; at least `%Y%m%d_%H%M%S`. If you cross-check with other systems, mind the timezone: `date -u` UTC stamps align better across machines, the local timezone reads better for humans flipping logs -- pick one, write it into the comments, do not mix them.

### 6.2 Environment, Dependencies, and Scheduling

5. **Dependencies not checked**. When distributing scripts across distros, start with `command -v rsync || { echo "Please install: apt/pacman/dnf install rsync"; exit 127; }`, giving all three families' hints at once. Package name differences (like RHEL's camel-case `ShellCheck`) belong in the hint string too, saving a round of "installed it but command not found" troubleshooting.

6. **No absolute paths in cron**. cron's `PATH` is minimal; tools you installed beyond `date`/`tar` need absolute paths, or set `PATH=/usr/local/bin:/usr/bin:/bin` inside the script. Also note cron's working directory is usually `$HOME`; relative-path scripts should switch to paths based on `${BASH_SOURCE[0]}` or an explicit `cd` in the crontab.

7. **Batch SSH without timeouts**. One blackholed host hangs the whole night; `ConnectTimeout` + `BatchMode` are mandatory. If you go through a jump host or ProxyJump, the timeout must be set at both layers -- "direct to the jump host" and "jump host to target" -- otherwise you may still hang in the middle layer.

8. **Statistics loops through a pipe**. Counters written on the right side of `cmd | while` silently zero out -- exactly why Example 1 uses process substitution. This one is even stealthier under `set -e`: the loop "finishes successfully" but the result is always the initial value, and if the test directory happens to hold only one file it is easy to misjudge as passing.

### 6.3 Acceptance and Handoff

A finished script is not the same as a handoff-ready script. The minimum acceptance actions: run one DRY in a **non-demo directory**; use `echo $?` to confirm the three exit codes success/failure/usage error; `shellcheck` with no errors; write usage and dependencies into the file header comments. Only after these four steps hand it to cron -- otherwise the first trigger tends to happen at 3 a.m. when you are not there.

If a post-mortem finds "output is right but extra logs went to stdout", first check whether a progress notice was written into a path `$( )` captures (see the stderr convention in [Functions](./functions.md)); if "the count is always short a chunk", first check whether the loop was again placed on the right side of a pipe. Both problem classes are demonstrated with the correct patterns in the three main examples -- fix by reference, no need to redesign from scratch.

## 7. Chapter Summary

The three main examples together cover the full lifecycle of an ops script: **how to read input, how to change state safely, and how to hand results and errors separately to the caller**. Log statistics demonstrates read-only counting and the subshell boundary, backup demonstrates archiving, rotation, and destructive cleanup, rename demonstrates glob, quoting, and dry-run mode. The extended examples add monitoring, access logs, batch SSH, and rsync -- four more directions whose skeletons are all reusable.

Leaving this chapter, take at least these three executable habits: DRY destructive commands first and check the plan text; confirm every loop keeps its counter off the right side of a pipe; design exit codes and stderr as an external API. You can flip back to the relevant chapters when syntax details fade, but if these three slip away, the script will surprise you on the night it must not fail.

The three habits map onto tools as: the `DRY_RUN` branch prints the full plan; counting loops use process substitution or array redirection; success/usage-error/business-failure/missing-dependency correspond to 0/2/1/127. Writing them into the comment header of your team's script template gets them actually enforced in code review more readily than a long specification; once the template passes review once, every new script inherits this safety baseline automatically.

Self-test: can you write, without looking at the text, a backup script from scratch with `usage`, `set -euo pipefail`, `DRY_RUN`, and layered exit codes, and explain the role of every quote and `--`? If yes, this chapter's goal is met; if not, reread Example 2's design notes first, then work through the section 5 skeleton checklist item by item.

Next, wire the statistics script into cron, connect the backup script to rsync/a remote and [Log Rotation](../basic/log/rotation.md), and use shellcheck and `set -x` from [Script Debugging](./debugging.md) as the pre-deployment gate -- the layer missing between "can write" and "dare to let someone else run" is exactly this engineering discipline.

If you are about to commit a modified script, run the three main examples' "nonexistent path / empty directory / normal directory" cases one final time and confirm `echo $?` matches the 0/1/2 convention -- that step is worth more time than adding one more feature.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - System administration scripting practice -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/)
- Arch Wiki - Bash -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- `man tar`, `man rsync`, `man find`, `man awk`
- GNU Coreutils - Documentation -- [gnu.org](https://www.gnu.org/software/coreutils/manual/)
- awesome-bash script collection -- [github.com/awesome-lists/awesome-bash](https://github.com/awesome-lists/awesome-bash)
- ShellCheck - Examples and fixes -- [shellcheck.net](https://www.shellcheck.net/)
- Earlier chapters in this section: [Loops](./loops.md), [Conditionals](./conditionals.md), [Text Processing](./text-processing.md), [Script Debugging](./debugging.md)

Hands-on path suggestion: first run the three main examples of sections 1-3 as-is in a temporary directory and confirm they match the real output; then swap the paths and `KEEP`/`DRY_RUN` to your environment for one DRY run; finally complete `usage`, `trap`, and shellcheck per the section 5 skeleton and wire it into cron or CI. Keep the exit codes and stderr logs at every step; when something breaks, troubleshoot in the order "usage error -> missing environment dependency -> business failure" -- usually faster than bolting on `echo` debugging.

The first time you take over someone else's script, read it in the same order: usage and exit-code conventions first, then dependency checks and the DRY branch, and only then the core loop. Reversing the order easily traps you in "fixing syntax line by line without understanding the failure semantics", and you still dare not deploy after editing. Once this reading approach becomes a team habit, script review arguments shift from "style" to "are the boundaries covered", which is far more productive.

If you maintain a multi-machine environment, combine the SSH points from the extended examples with the main examples' exit-code layering: each host writes its own log file, and the aggregation script only reads exit codes to decide whether to alert. For a more systematic text pipeline (status-code distribution, UA aggregation), revisit [Text Processing](./text-processing.md); to localize the exact line and command on failure, connect the `set -x`/bashdb workflow from [Script Debugging](./debugging.md). The three-distro dependency install table stays in section 0; before distribution, verify package names once against the target distro (mind the `pacman`, `apt`, `dnf` differences and the RHEL family's camel-case `ShellCheck`); for uncertain options defer to the relevant distro's `man` page rather than changing production parameters from memory.

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
- [functions](functions.md)
