# Search and Locate

A Linux filesystem easily runs to hundreds of thousands of files --
a server stuffed with packages
tops 100,000 inodes under `/usr` with room to spare.
Trudging through directories one level at a time with `ls`,
or hunting error lines through logs by eye,
is both slow and unreliable.
Search and locate tools answer exactly two questions:
**"where is the thing"** (pin a file down by name,
type,
size,
time,
permissions, and other conditions) and **"what is inside it"** (search,
extract,
and replace text inside a file).
Put the two capabilities together
and you have 80% of day-to-day ops work --
find big files,
find the recently changed config,
find which package owns a given command,
count how many errors a log holds.

> Content drawn from the find, locate, and grep manuals plus hands-on ops experience; see the references at the end.
> Terminal output marked "real output" was captured from actual runs (demo directory `/tmp/findemo`); you can reproduce it as-is on your own machine.

## Why Start by Telling the Three Knives Apart

The most common confusion is:
`find`,
`locate`,
`grep` all "search" --
so which one?
The answer depends on whether you want the **file itself** or the **words inside the file**,
and on how long you are willing to wait.

`find` is **real-time scanning**.
It walks the directory tree one entry at a time,
with the richest set of conditions (name,
type,
size,
time,
permissions,
owner,
and it can run a command on the results).
The drawback is that a full-disk scan can take tens of seconds on a large disk.
It is the archetypal "precise but slow" tool.

`locate` is a **database lookup**.
It never touches the filesystem,
only querying the filename index that `updatedb` builds on a schedule,
so results come back in milliseconds;
the price is that **results can go stale** --
a file you just `touch`ed,
or one that changed between index refreshes,
may not be found at all.
It is the archetypal "fast but possibly outdated" tool.

`grep` **goes inside the file**.
It matches **file content** against a regex,
and with `-r` it recurses through an entire directory.
`find` finds "the file whose name contains error",
`grep` finds "the line whose content contains error";
the two cannot substitute for each other.

Rule of thumb:
**use `find`/`locate` for filenames,
use `grep` for words inside a file;
if the filename pattern is simple and you need the freshest result, use `find`,
if the pattern is loose and you just want speed, use `locate`.**
Beyond that,
modern distros also ship `fd` (a friendlier replacement for `find`) and `ripgrep` (a faster replacement for `grep`);
this chapter closes with a comparison and three-family install commands.

Seen from the engineering side,
this toolchain is the Unix composition philosophy made concrete:
`find` produces the file list,
`grep`/`awk`/`sed` transform the text,
and `xargs`/`-exec` hand the list off to the next command for execution.
Every complex pipeline you write
is almost always these few bricks bolted together.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Chapter Covers

- **Know find's condition expressions**:
  filter by name (`-name`/`-iname`),
  type (`-type`),
  size (`-size`),
  time (`-mtime`/`-mmin`),
  permissions (`-perm`),
  and owner (`-user`),
  and run actions on the results with `-exec`,
  `-ok`,
  and `-delete`;
  understand how AND/OR/NOT combine and how to escape parentheses.
- **Locate things quickly with locate**:
  know its database mechanism,
  how to update it (`updatedb`) and configure it (`PRUNEPATHS`/`PRUNEFS`),
  and where the "fast but possibly stale" boundary falls.
- **Search content fluently with grep**:
  `-i`,
  `-n`,
  `-r`,
  `-v`,
  `-c`,
  `-o`,
  `-A/-B/-C`,
  `--include`/`--exclude-dir`,
  and when to reach for BRE, ERE (`-E`), or PCRE (`-P`).
- **Do structured processing with awk/sed**:
  `awk` for pulling columns and taking tallies by field (`$1`,
  `-F`,
  `NR`/`NF`),
  and `sed` for addressing lines to replace or delete (`s///g`,
  `-i`,
  `-n 'xp'`).
- **Answer "where does this command come from" with which/whereis**: tell a shell builtin apart from an alias and from an executable on disk.
- **Do not get stuck across the three families**:
  know that `find`/`grep` are preinstalled on all three,
  while `locate`,
  `fd`,
  and `ripgrep` need the corresponding package installed per distro with `apt`/`pacman`/`dnf`.

## 1. The find Command

### 1.1 Basic Syntax and the Execution Model

The general form of `find` is `find [path] [options] [expression]`.
What matters more than the syntax is its **execution model**:
starting from the given path,
it **depth-first walks** the directory tree,
evaluating the "test expression" on each entry in turn,
and prints whatever evaluates to true (by default the path).
Tests can be combined with an implicit AND (just write them next to each other, meaning "both hold"),
an explicit OR (`-o`),
and negation (`!` or `-not`).
Get this model first,
and every complex expression that follows you can derive yourself
instead of memorizing it.

The default output is just the path itself. The following is real output on the demo directory, listing four regular files one at a time:

```bash
$ find /tmp/findemo -type f
/tmp/findemo/t.csv
/tmp/findemo/a.tmp
/tmp/findemo/notes.txt
/tmp/findemo/logs/app.log
```

The GNU find extension `-printf` lets you customize the output format,
for example showing file sizes as you search
and then piping to `sort` to rank them --
when hunting the "disk eaters", this is far more readable than plain `-ls`:

```bash
$ find /tmp/findemo -type f -printf '%s\t%p\n' | sort -n
2	/tmp/findemo/a.tmp
12	/tmp/findemo/t.csv
20	/tmp/findemo/notes.txt
51	/tmp/findemo/logs/app.log
```

### 1.2 Search by Name and Type

Name matching uses shell wildcard syntax,
but the matching is done by `find` itself,
so **quote the pattern**,
otherwise your current shell expands it first.
`-iname` is case-insensitive,
useful when README/Readme/readme are spelled inconsistently;
`-name` matches only the last path segment (the basename);
use `-path` to match the whole path,
for example `find / -path "*/.git/config"`.

Type tests use `-type` plus one letter:
`f` regular file,
`d` directory,
`l` symbolic link,
`b` block device (such as `/dev/sda`),
`c` character device (such as `/dev/tty`).
With `-type l` combined with GNU's `-xtype l` you can hunt **dangling symlinks** (links whose target is gone),
which is handy when repairing a web document root.

```bash
find /path -name "filename"
find /path -iname "filename"
find /path -name "*.txt"
find /path -type d -name "dirname"
```

### 1.3 Search by Size and Time

The size units `k`/`M`/`G` use base 1024 (GNU find);
`+`/`-` mean "larger than" / "smaller than";
omitting both means "exactly" (in practice, because of block alignment,
rarely an exact hit).
Note that `-size` measures **allocated blocks** converted to bytes,
so a sparse file's logical size and apparent size can differ a lot;
`-empty` matches an empty file **or** an empty directory.

Time tests rest on three timestamps:
**atime** (last access),
**mtime** (last content change),
**ctime** (last status change --
changing permissions or
changing ownership also bumps ctime).
The unit is "whole multiples of 24 hours":
`-mtime -7` means modified within the last 7 days,
`-mtime +30` means modified at least 31 days ago.
This "+/-" semantics is the easiest thing to invert;
before acting, verify against a small directory with a known date.
The minute-precision `-mmin`/`-amin`/`-cmin` are far more useful than day-based tests for forensic questions like "who changed the config in the last five minutes".

```bash
find /path -size +100M
find /path -empty
find /path -mtime -7
find /path -mtime +30
find /path -cmin -10
```

### 1.4 Search by Permissions and Owner

The three permission-test modes have completely different semantics;
getting one wrong in a security sweep script silently misses findings:
`-perm 755` requires the mode to be **exactly** 755 (750 does not match);
the `-` in `-perm -4000` means **all** listed bits are set,
and that is how a SUID search must be written;
GNU also adds `/` to mean **any one of** the bits matches.
For ownership,
`-user` matches by username,
`-uid` matches by numeric ID (after a bulk migration usernames can be stale,
so the number is more reliable);
`-nouser` finds orphan files whose owner is no longer in `/etc/passwd`,
the standard clean-up step after deleting an account.

```bash
find /path -perm 755
find /path -perm -4000
find /path -user username
find /path -nouser
find /path -uid 1000
```

### 1.5 Acting on the Results

Once `find` has matched files you usually still need to "do something" with them,
and there are three mechanisms.
`{}` is the "current file" placeholder,
and `\;` is the escaped semicolon (it tells the shell this is an argument to find).
`-delete` is a built-in delete,
the most efficient;
`-exec ... \;` invokes the command once per file;
`-exec ... +` batches as many files as possible into one invocation,
an order of magnitude faster than `\;`;
`-ok` is the interactive form of `-exec`,
asking before each run,
mandatory for anything destructive.
`-print0` paired with `xargs -0` separates filenames with NUL,
and is the only safe way to handle **filenames containing spaces,
newlines,
or quotes**.

```bash
find /path -name "*.tmp" -delete
find /path -name "*.txt" -exec ls -l {} \;
find /path -name "*.txt" -exec ls -l {} +
find /path -name "*.tmp" -ok rm {} \;
find /path -name "*.txt" -print0 | xargs -0 ls -l
```

Real check --
for a path with a space, `my dir/file.txt`,
both `-print0 | xargs -0` and `-exec` handle it correctly,
whereas plain `xargs` splits it into two paths and errors out:

```bash
$ find /tmp/findemo -name "*.txt" -print0 | xargs -0 ls -l
-rw-rw-r-- 1 cui cui  0 Sep 22 05:32 /tmp/findemo/my dir/file.txt
-rw-rw-r-- 1 cui cui 20 Sep 22 05:32 /tmp/findemo/notes.txt
```

### 1.6 Combining Conditions and Escaping Parentheses

Implicit AND is just tests written next to each other;
OR is `-o`,
and negation is `!` (or `-not`).
**Whenever there is an `-o`,
wrap both sides of the OR in `\(...\)`** --
the parentheses must be backslash-escaped for the shell.
The depth limiter `-maxdepth` speeds up searches under `/` enormously,
for example `find /usr -maxdepth 3 -name "openssl"`.

These two commands give different results on the demo directory:
the first one picks up the directory `dir.log`.
Without parentheses the expression parses as `(-type f AND -name "*.tmp") OR (-name "*.log")` --
the right side of the OR is **no longer constrained by `-type f`**,
so a directory sneaks in.
This is find's number-one pitfall;
always verify semantics on a small directory first.

```bash
$ find /tmp/findemo -type f -name "*.tmp" -o -name "*.log"
/tmp/findemo/dir.log
/tmp/findemo/a.tmp
/tmp/findemo/logs/app.log

$ find /tmp/findemo -type f \( -name "*.tmp" -o -name "*.log" \)
/tmp/findemo/a.tmp
/tmp/findemo/logs/app.log
```

More combinations:
`find /path -name "*.txt" -size +1M` is an implicit AND;
`find /path ! -name "*.txt"` is negation;
`find /path -type f \( -name "*.txt" -o -name "*.log" \) -size +1M` is "txt or log, and larger than 1M" --
note that AND binds tighter than OR,
so adding more parentheses when mixing is always safe.

## 2. The locate Command

### 2.1 Why locate Is So Fast, and Its Boundaries

`locate` never touches the filesystem;
it only does string lookup in the **filename database** that `updatedb` builds.
The database is usually refreshed once a day by `cron`/`systemd timer`,
so it can answer a full-disk filename query in milliseconds,
at the price of three limits:
**files created just now will not be found** (the database has not been updated);
**files deleted just now may still appear** in the results;
and the database **skips** several directories by default (`/tmp`,
`/proc`,
network mounts,
and more;
see 2.3),
so nothing under them can be located.

So the locating strategy is:
**first get candidates from `locate` in an instant,
then confirm live state with `find`/`ls -l`**;
or the reverse --
when you know for certain that the file just changed,
go straight to `find`
and do not trust `locate`.

### 2.2 Basic Usage and Refreshing the Database

`locate -i` is case-insensitive,
`-n 10` caps the number of results,
`-c` only counts matches,
and `-r` takes a regex (always quote it).
Refresh the database with `sudo updatedb` (add `-U /path` to index a single directory).
Note that
on many minimal installs `locate` is **not installed by default**;
on a real system you may just get `bash: locate: command not found` --
install the package that provides `locate` using the three-family table in section 8.

```bash
locate filename
locate -i filename
locate -n 10 filename
sudo updatedb
sudo updatedb -U /path
```

### 2.3 The Configuration File

`/etc/updatedb.conf` (mlocate) controls indexing behavior:
`PRUNEPATHS` is the list of directories to skip (for example `/tmp /var/spool /media /mnt`),
`PRUNEFS` is the list of filesystem types to skip (for example `nfs nfs4 cifs proc sysfs`),
and `PRUNE_BIND_MOUNTS` controls whether bind mounts are skipped.
Once a directory lands in `PRUNEPATHS`, `locate` will never find it --
when troubleshooting "the file clearly exists but locate misses it",
look at this file first,
then at the database timestamps (`ls -l /var/lib/mlocate/` or `/var/lib/plocate/`) to confirm `updatedb` actually ran.

## 3. The grep Command

### 3.1 Basic Usage and Real Output

`grep` stands for *global regular expression print*:
it filters lines from an input stream by regex and prints them.
The common options group into six:
`-i` case-insensitive,
`-n` show line numbers,
`-r` recurse into directories (`-R` also follows directory symlinks,
so `-r` is the safer choice for searching a repo),
`-v` invert the match to exclude,
`-c` print only the match count,
`-w` match whole words,
`-o` print only the matching fragments.

Real output (the log contains `INFO start` / `ERROR disk full` / `WARN slow` / `ERROR timeout`):

```bash
$ grep -n "ERROR" /tmp/findemo/logs/app.log
2:ERROR disk full
4:ERROR timeout

$ grep -c ERROR /tmp/findemo/logs/app.log
2

$ grep -rn "ERROR" /tmp/findemo
/tmp/findemo/logs/app.log:2:ERROR disk full
/tmp/findemo/logs/app.log:4:ERROR timeout
```

### 3.2 Regular Expressions: BRE, ERE, and PCRE

`grep` defaults to **basic regular expressions (BRE)**,
in which `+`,
`?`,
`|`,
and `{}` are literal characters
and only take effect as `\+`/`\?` and so on;
add `-E` to switch to **extended regular expressions (ERE)**,
where the metacharacters work as written,
are more readable, and are POSIX-guaranteed --
the everyday default;
add `-P` for **Perl-compatible regex (PCRE)**,
which supports `\d`,
`\w`,
`\s`,
and advanced features like lookarounds,
but depends on PCRE being linked into grep at build time,
so it may be unavailable on some embedded or minimal systems;
verify on the target machine before any script depends on it.

```bash
grep "^start" file
grep "end$" file
grep -E "pattern1|pattern2" file
grep -E "go+" file
grep -P "\d{3}" file
```

### 3.3 Context and Exclusion: Making Results Readable

When troubleshooting, a single matching line is often not enough;
`-A 3`/`-B 3`/`-C 3` take the 3 lines after a match,
the 3 lines before,
or 3 on each side respectively (A=after,
B=before,
C=context) --
reading the log context around an error
is far more useful than reading the line alone.
`-l` lists only filenames that contain a match;
`-L` lists the opposite.
In a code repository, searching without `--exclude-dir` floods the results with `node_modules` and `.git`;
in a log directory, omitting `--include` sweeps in a large number of unrelated binary files and spams `Binary file matches` warnings.

```bash
grep -C 3 "pattern" file
grep -o "pattern" file
grep -rn --exclude-dir={.git,node_modules,.svn} "pattern" /path
grep -rn --include="*.conf" "pattern" /etc
```

## 4. The awk Command

`awk` is the swiss-army knife for processing text column by column:
by default it splits fields on whitespace (runs of whitespace count as one separator),
and `$1`,
`$2`...
reference columns,
`$0` is the whole line,
and `$NF` is the last column.
`-F:` sets a custom delimiter and is the standard tool for colon- or equals-delimited files like `/etc/passwd`,
`/etc/group`,
and sshd configuration --
picking the wrong delimiter is the most common cause of misaligned columns.
Among the built-in variables, `NR` is the current line number,
`NF` is the field count,
and `FS`/`OFS` are the input/output delimiters;
`BEGIN`/`END` blocks run once each, **before** and **after** input processing,
making them the standard place for aggregate statistics.

Real output -- taking the first column from passwd and the second from a CSV:

```bash
$ awk -F: '{print $1}' /etc/passwd | head -5
root
daemon
bin
sys
sync

$ awk -F, '{print $2}' /tmp/findemo/t.csv
b
2
```

Pattern matching and range matching mean awk rarely needs an explicit `if`:
`/pattern/` acts only on matching lines,
`!/pattern/` on the rest,
and `/start/,/end/` on the range from start to end;
`$3 > 100` is a numeric condition filter.
A statistics example --
`sum+=$NF` accumulates the last column,
and `END` prints the total and line count:

```bash
awk '{print $1, $3}' file
awk -F: '{print $1, $NF}' file
awk 'BEGIN{FS=":"} {print $7}' /etc/passwd
awk '/start/,/end/' file
awk '$3 > 100' file
awk '{print NF}' file
awk '{sum+=$NF} END{print "total:", sum, "lines:", NR}' file
```

Note:
if `FS` is set to a single whitespace character,
awk automatically collapses consecutive whitespace;
set it to any other character (such as `:` or
`,`) and consecutive delimiters produce empty fields,
shifting the column numbers.
When columns do not line up, check the delimiter first.

## 5. The sed Command

`sed` is a "stream editor":
it reads line by line,
edits per script,
and writes to the screen by default (**the original file is untouched**).
The core is the substitution command `s/old/new/flags`,
where the `g` flag means replace all occurrences on a line (without it, only the first match per line is replaced).
Add `-i` to edit in place;
`-i.bak` keeps a `file.bak` copy before modifying --
**preview first, then `-i`** is the iron rule:
run it without `-i` and read the output,
then add the flag once you are sure;
for important configs, go straight to `-i.bak`.

Address ranges limit a substitution to a slice:
numeric line numbers (`3`,
`3,5`),
pattern addresses (`/pattern/`),
or both combined (`/start/,/end/`).
Pair with `-n` to switch off default output
and use `p` to print,
turning it into "print only line N / the matching lines" (equivalent to grep).
Also, `i\` inserts before a given line,
`a\` appends after it,
and `c\` replaces the whole line --
for editing config files this is faster than opening an editor.

```bash
sed 's/old/new/g' file
sed -i 's/old/new/g' file
sed -i.bak 's/old/new/g' file
sed '/pattern/d' file
sed '/start/,/end/s/old/new/' file
sed -n '3p' file
sed -n '/pattern/p' file
sed '3a\new line' file
```

A real line-extraction example --
print only the third line of a log:
`sed -n '3p' app.log`.
sed's regex comes from the same lineage as grep's BRE;
inside the replacement string, `&` means "the whole match",
and backslash-escaped groups `\1`...
`\9` can be referenced,
which is indispensable for operations like "swap two segments".

## 6. which, whereis, and type

When you want to know "where did the command I typed actually come from",
there are three layers of tools,
each with different semantics.
**`type` is a shell builtin and the most honest** --
it will tell you that `ls` is really an alias;
`which` only searches PATH
and is blind to aliases and functions;
`whereis` also searches standard source trees and man directories,
suited to answering "does this system have its source or manual installed".
Recommended order for diagnosing `command not found`:
`type -a command` -> `echo $PATH` -> `ls -l expected-path`.

Real output, showing that `ls` has both an alias definition and two paths on disk:

```bash
$ type -a ls
ls is aliased to `ls --color=auto'
ls is /usr/bin/ls
ls is /bin/ls
```

Other common forms:
`which python` finds the first match on PATH;
`which -a python` lists all matches;
`whereis python` reports binary,
source,
and manual locations together,
with `-b`/`-s`/`-m` to ask for only one of those kinds;
and `type ls` directly answers "is this `ls` an alias or a file on disk".

## 7. Modern Replacements: fd and ripgrep

`find` and `grep` are fully capable but have ancient syntax (parenthesis escaping,
`\;`,
and BRE by default are all historical baggage).
The two modern replacements feel noticeably smoother in **interactive use**:
`fd` recurses by default,
respects `.gitignore` by default,
and has more intuitive regex syntax (`fd -e conf nginx /etc` filters by extension plus content);
`ripgrep` (the `rg` command) recurses by default,
skips binaries and ignored files by default,
is an order of magnitude faster than `grep -r`,
and `rg --files -g '*.log'` even replaces "list by name".

Recommendation:
**use `fd`/`rg` for interactive exploration,
and `find`/`grep` in scripts and audit pipelines** --
the latter are mandatory POSIX/GNU infrastructure on all three families,
so scripts can depend on them with no extra install step;
the former need you to confirm the target machine has the package (see the next section).
Common forms:
`fd '\.conf$' /etc`,
`fd -e conf nginx /etc`,
`rg "ERROR" /var/log`,
`rg -n -C 2 "timeout" .`,
`rg --files -g '*.log'`.

## 8. Three-Family Comparison and Tool Installation

`find` (findutils),
`grep`,
`awk` (gawk/mawk),
and `sed` are all preinstalled on **Debian/Ubuntu,
Arch,
and RHEL/CentOS/Rocky**
and need nothing done.
What does report `command not found` are the enhanced tools below:

| Tool | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `locate` (and `updatedb`) | `sudo apt install mlocate` (or `plocate`) | `sudo pacman -S plocate` | `sudo dnf install mlocate` |
| `fd` | `sudo apt install fd-find` (command is `fdfind`) | `sudo pacman -S fd` (command `fd`) | `sudo dnf install fd-find` |
| `ripgrep` | `sudo apt install ripgrep` | `sudo pacman -S ripgrep` | `sudo dnf install ripgrep` (needs EPEL/CRB) |
| `fdupes` (duplicate-file search) | `sudo apt install fdupes` | `sudo pacman -S fdupes` | `sudo dnf install fdupes` (needs EPEL) |
| `trash-cli` (safe deletion) | `sudo apt install trash-cli` | `sudo pacman -S trash-cli` | `sudo dnf install trash-cli` |
| GNU findutils itself | preinstalled | preinstalled (`findutils`) | preinstalled |

Three points worth flagging.
**Arch users, remember the `pacman -S package` column**:
`plocate`,
`fd`,
and `ripgrep` are first-class citizens in the official repositories,
ready to use the moment they are installed;
the AUR has more search tools (such as `fzf` for fuzzy find),
but the AUR needs a `yay`/`paru` helper,
and you must review the build scripts yourself.
**On Debian/Ubuntu the `fd` command is named `fdfind`** (to avoid a clash with a legacy package name);
probe with `command -v fd fdfind` before writing scripts,
or add a compatibility alias in the script.
**Some tools on RHEL/CentOS/Rocky live in EPEL**;
run `sudo dnf install epel-release` first, then install.
Also,
right after installing `locate` run `sudo updatedb` once,
otherwise the database is empty
and no query returns anything.

The fastest way to confirm an install succeeded:
`command -v fd fdfind rg locate`,
or `fd --version; rg --version`.

## 9. Real-World Cases

### 9.1 Finding Big Files (When the Disk Is Full)

When a disk alert fires, do not reach for a full-disk `find` first;
**aggregate by directory to isolate the suspects,
then drill inside the directory** --
get the order right and the time cost differs by an order of magnitude.
`-xdev` means do not cross filesystems (skipping NFS or other mount points),
which speeds things up a lot and avoids uselessly scanning a backup disk;
`2>/dev/null` discards permission errors.
Note that `du` reports disk usage
while `find -size` reports file size;
sparse files and files hard-linked many times make the two disagree.

```bash
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -20
find /var -xdev -type f -size +100M -exec ls -lh {} \; 2>/dev/null
find /var -xdev -type f -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -10
```

### 9.2 Finding Recently Modified Files

A config change and now the service is broken?
List what was touched recently first
rather than opening files one by one and guessing.
The three common variants map to "logs from the last day",
"configs from the last week",
and "who touched this directory in the last ten minutes" (minute-level forensics,
with `-ls` carrying permissions and timestamps directly).

```bash
find /var/log -type f -mtime -1
find /etc -type f -name "*.conf" -mtime -7
find /etc/nginx -cmin -10 -ls
```

### 9.3 Finding Duplicate Files

The correct order for duplicate hunting is **rough-filter by size first,
then hash the few candidates**.
`fdupes -r` does the whole flow in one command (installable on all three families,
see section 8);
without it, use `find -printf '%s %p\n' | sort -n` to find files whose size appears more than once,
then `md5sum` each pair to confirm the contents really match.
The "hash everything with `find -exec md5sum`, then `sort | uniq -d`" approach is very slow on large directories (it must read all the data once),
so reserve it for small scopes.

```bash
fdupes -r /path
find /path -type f -size +1M -printf '%s %p\n' | sort -n
find /path -type f -name "*.iso" -exec md5sum {} + | sort | uniq -d -w 32
```

### 9.4 Batch Renaming

One of the rare **three-family command forks**:
Debian/Ubuntu's `rename` is the Perl version (`rename 's/\.txt$/\.md/' *.txt`),
Arch's `rename` comes from util-linux
and uses the plain `rename from to files` syntax (`rename .txt .md *.txt`);
the two are incompatible.
When writing scripts across distros, prefer rewriting the extension with `find -exec bash`
for full portability:

```bash
rename 's/\.txt$/\.md/' *.txt          # Debian/Ubuntu
rename .txt .md *.txt                  # Arch/util-linux style
find /path -name "*.txt" -exec bash -c 'mv "$1" "${1%.txt}.md"' _ {} \;
```

### 9.5 Log Analysis

The skeleton of log analysis is almost always "filter -> extract -> count -> sort".
`grep -c` counts occurrences;
`awk` range patterns slice out a time window;
`grep -rhoE 'ERROR [A-Z_]+' | sort | uniq -c | sort -rn | head` is an off-the-shelf "top-N error types" report --
`sort | uniq -c` is grouped counting in the shell,
and the final numeric sort is `sort -rn`.
Combine it with `find -mtime -3 -exec grep -l ... {} +`
and you search only logs changed in the last three days,
steering clear of historical archives.

```bash
grep -rn "ERROR" /var/log/
grep -c "ERROR" /var/log/syslog
awk '/2024-01-01 10:00/,/2024-01-01 11:00/' /var/log/syslog
grep -rhoE 'ERROR [A-Z_]+' /var/log/*.log | sort | uniq -c | sort -rn | head
find /var/log -name "*.log" -mtime -3 -exec grep -l "timeout" {} +
```

## 10. Common Pitfalls

1. **Forgetting to quote the `find` pattern**.
   `find . -name *.log` gets expanded by the current shell's wildcard first:
   if the current directory happens to contain `.log` files,
   it becomes a search for only those names;
   if there are none at all,
   the literal is passed straight through to find.
   **Any time a wildcard is handed to the command to interpret itself (`find -name`,
   `grep -e`,
   `tar --exclude`),
   single-quote it.**
2. **Not wrapping the two sides of `-o` in parentheses**.
   See the real output in 1.6:
   the right side of the OR is not constrained by the earlier `-type f`,
   so directories slip into the results.
   Make `\(... -o ... \)` the default habit,
   and verify on a small directory.
3. **Inverting `+` and `-` in time and size tests**.
   `-mtime -7` means "within 7 days",
   and `-mtime +30` means "at least 31 days ago".
   Before writing a cleanup script, run `find directory -mtime +30 -ls` to print only and delete nothing,
   and confirm the range by eye.
4. **Treating `-perm 755` and `-perm -4000` as one thing when their semantics differ**.
   The former requires an **exact match**,
   while the latter requires **all** listed bits set.
   Finding "files with the SUID bit set" must use `-perm -4000`;
   writing it the other way misses risky files.
5. **Assuming `locate` is broken because it misses a file you just created**.
   It queries a database, not the disk;
   run `sudo updatedb` first, then search,
   or switch to `find`.
   Conversely,
   a deleted file still showing up in the results is the same mechanism
   and does not mean there is a ghost file.
6. **`locate` may not be installed by default at all**.
   Minimal installs on Debian/Ubuntu/Arch/RHEL do not ship it;
   install `mlocate`/`plocate` per section 8 before using it,
   and run `updatedb` right after installing.
7. **`grep` printing `Binary file xxx matches`**.
   The target file contains NUL bytes and is treated as binary;
   add `-a` to treat it as text,
   or add `-I` to skip binary files;
   for searching a source tree, `-I` is usually the right call to avoid noise.
8. **Spaces in filenames splitting `xargs`/`for` loops into words**.
   Switch to `find -print0 | xargs -0 command`,
   `find -exec command {} +`,
   or bash's `while IFS= read -r f; do ...; done`.
9. **`grep -P` being unavailable in some environments**.
   If you see `grep: -P is not supported`,
   rewrite with `grep -E` or `perl -ne`;
   before writing a cross-distro script, run it once on the target system.
10. **`sed -i` without a backup and
    `find -delete` without confirmation**.
    Both are irreversible in-place operations.
    Rule:
    drop `-i`/`-delete` and preview the result -> confirm the range -> add it back and run;
    for important data directories, `tar` a backup before touching anything,
    and use `-ok` to confirm one by one at first.
11. **A full-disk `find` under `/` without `-xdev`/`2>/dev/null`**.
    It crosses into network mounts and scans furiously
    while flooding stderr with `Permission denied`.
    Standard form:
    `find / -xdev ... 2>/dev/null`.
12. **Confusing hard links with duplicate files**.
    `find -samefile file` finds hard links sharing the same inode (they share the data by definition),
    which is not the same as "two files with duplicated content";
    for duplicate hunting, use the size-plus-hash flow in 9.3.

## References

- `man find`, `man locate`, `man updatedb`, `man grep`, `man awk`, `man sed`, `man xargs`, `man type`
- findutils (GNU find) manual -- [gnu.org](https://www.gnu.org/software/findutils/manual/)
- grep manual -- [gnu.org](https://www.gnu.org/software/grep/manual/)
- gawk manual (GNU awk) -- [gnu.org](https://www.gnu.org/software/gawk/manual/)
- sed manual -- [gnu.org](https://www.gnu.org/software/sed/manual/)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Arch Wiki - Pacman (install plocate/fd/ripgrep with `pacman -S`) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian manual - package management and findutils/grep -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- GNU findutils manual - find and locate usage -- [gnu.org](https://www.gnu.org/software/findutils/manual/)
- fd project page -- [github.com](https://github.com/sharkdp/fd)
- ripgrep project page -- [github.com](https://github.com/BurntSushi/ripgrep)
- Bird's Private Recipes (Lin's Linux Administration Guide) - file search and mounting -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [coverage-matrix](/research/coverage-matrix.md)
