# Text Processing

The most important "data format" on a Linux system is not JSON and not a database table -- it is plain text.
Configuration files are text,
logs are text,
the account table `/etc/passwd` is text,
and the output of `ps` is text.
That is exactly why the Unix designers built the whole toolchain around text --
each command does one thing,
and then you chain them with pipes to do complex jobs.
That is the real power of "Linux text processing":
you do not need to learn one huge piece of software,
you just need to combine a few small commands that each do their job.

> The commands in this chapter (`grep`,
> `sed`,
> `awk`,
> `sort`,
> `cat`,
> `less`,
> Vim, etc.) behave identically on **Debian/Ubuntu,
> Arch,
> RHEL/CentOS/Rocky** --
> all of them come from the GNU/POSIX ecosystem,
> so you can rely on them across distributions.
> You only need to switch package managers by distribution when you want to install an extra editor or tool (`apt install` / `pacman -S` / `dnf install`).

## Why Text Processing Is the Core Linux Skill

Three very practical reasons:

1. **Troubleshooting means reading logs, and logs are text**.
   A service returns 502,
   and you need to find the errors in `/var/log/nginx/error.log` for a given time window;
   the disk alarm goes off,
   and you need to count which directory's files are growing out of control.
   The first move in all of these is "pull the text out,
   filter it,
   count it" --
   which is the `grep` + `awk` + `sort | uniq -c` combination.
   Without pipes you are stuck scrolling screen by screen.
2. **Bulk editing of configuration has to be done by tooling**.
   To change `PermitRootLogin yes` to `no` on 200 machines,
   opening 200 files by hand is not realistic;
   one `sed -i` does it,
   and combined with `find` / `xargs` you can scope it down.
   How fast you can change text sets the floor for automation.
3. **The pipe is shell programming syntax**.
   In one command like `ps aux | grep nginx | awk '{print $2}' | xargs kill`,
   every tool is simple,
   but together they run a complete "find the process -- grab the PID -- kill it" workflow.
   Understanding that what flows through a pipe is a stream of text is half of understanding shell programming.

Bird's private favorite teaching analogy:
`grep` is a sieve (picks out the lines that match),
`sed` is an assembly-line worker (processes each line according to a script),
`awk` is an accountant (pulls columns and totals).
The three have different jobs,
and they often work in relay.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Chapter Covers

- **Viewing**:
  fluency with `cat`,
  `less`,
  `head`,
  `tail -f`,
  and knowing which to use for big files versus live logs (use `less` for big files,
  `tail -f` for real-time tailing,
  `less +F` for very large logs).
- **Searching**:
  know `grep`'s `-i`,
  `-n`,
  `-r`,
  `-v`,
  `-c`,
  `-A/-B/-C` and its regex modes (BRE / `-E` ERE / `-P` PCRE),
  and be able to pull exact error lines out of logs with line numbers and context.
- **Editing**:
  know `sed`'s substitution (`s/old/new/g`),
  line addresses,
  in-place `-i` with backups (`-i.bak`),
  and the "preview first, then `-i`" safety flow.
- **Counting**:
  know `awk`'s field references (`$1` ...
  `$n`),
  `-F` delimiter,
  `NR`/`NF`/`FS` builtins and `BEGIN`/`END` blocks,
  and be able to do column extraction,
  conditional filtering,
  and counted summaries.
- **Sorting**: use `sort`, `uniq -c`, `cut`, `tr`, `wc` for sorting, deduplication, and counting -- turn messy output into a readable report.
- **Writing**: know Vim's minimal usable set of insert, save, quit, and search-and-replace

## Reading the Subpages

| Subpage | One-line tour |
|------|------------|
| [Text Processing Commands](./text/text_processing.md) | The pipe toolbox: `cat`/`nl`/`wc` for viewing and counting, `grep` for searching and filtering, `sed` for substitution and deletion, `awk` for column extraction and math, `sort`/`uniq`/`cut`/`tr` for formatting, plus many copy-pasteable pipe examples. |
| [Text Editing and Viewing Tools](./text/editors.md) | Editors and viewers: Vim's three modes and the common shortcuts (insert, save and quit, search and replace, visual block), a quick start on nano, and how to choose among `less`/`more`/`head`/`tail -f` for different situations, plus paging techniques. |

The Text Processing Commands and [Text Editing and Viewing Tools](./text/editors.md) pages record the pipe work and the result-saving work respectively. The two checklist commands are: `grep -c ERROR /var/log/syslog` counts the number of errors, and `awk '{print $1}' /etc/passwd | sort -u` lists every unique username on the system -- if you can write both from memory, this chapter is a pass.

## Three-Family Differences at a Glance

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Default editor | usually `nano` (the `editor` command) | usually `vi` | usually `vim` (`vi` is a symlink) |
| Install Vim | `sudo apt install vim` | `sudo pacman -S vim` | `sudo dnf install vim-enhanced` |
| Install `ripgrep` (a faster grep alternative) | `sudo apt install ripgrep` | `sudo pacman -S ripgrep` | `sudo dnf install ripgrep` (EPEL/AppStream) |
| Install `fd-find` | `sudo apt install fd-find` (binary is `fdfind`) | `sudo pacman -S fd` (binary is `fd`) | `sudo dnf install fd-find` |
| Log file location | `/var/log/syslog` | `/var/log/messages` (journalctl is separate) | `/var/log/messages` |
| Live logs | `journalctl -f` works everywhere; use `tail -f` for text logs | same | same |

Note that Debian/Ubuntu names the `fd` package's executable `fdfind`,
to avoid clashing with `findutils`' `fd`;
Arch and the RHEL family use the standard `fd`.
Keep this difference in mind when writing cross-distribution scripts.

## Common Gotchas

1. **`sed -i` does not make a backup,
   so a bad change cannot be reverted**.
   Before editing in place, use `sed -i.bak 's/a/b/' file` (this writes `file.bak`),
   or drop `-i` first and preview the output,
   then add `-i` once you are sure.
   Configuration files especially need a backup first.
2. **`grep`'s default regex is BRE,
   and `+`,
   `?`,
   `|` need escaping or you need to switch to `-E`**.
   To match "one or more o", write `grep -E 'go+'`;
   a bare `grep 'go+'` treats `+` as a literal in basic regex.
   For Perl-style (`\d`,
   `\w`) you need `grep -P` (GNU grep supports it;
   some minimal environments may not have PCRE compiled in).
3. **`grep -r` without excluding `.git` / `node_modules` floods the output**.
   Add `--exclude-dir={.git,node_modules}` when searching a repo;
   add `--include='*.log'` when searching a log directory to keep it scoped.
4. **`awk` splits on whitespace by default -- will repeated spaces misalign the columns?**
   No --
   awk treats a run of whitespace as a single separator;
   but if you use `-F:` on a colon-delimited file like `/etc/passwd`,
   it can only split on colons.
   Choosing the wrong delimiter is the most common cause of column misalignment.
5. **`>` redirection truncates the target file before writing**.
   `cat large.log > large.log` gives you an empty file;
   `>>` is what appends.
   Chained redirection to the same file truncates it too -- a pipe plus `tee` is the safer pattern.
6. **Wildcards are expanded early by the shell**.
   `find . -name *.log` when there are no `.log` files in the current directory passes the literal `*.log` to find,
   or has the shell expand it into a long list of filenames.
   Always quote find patterns:
   `find . -name "*.log"`.
7. **`tail -f` stops seeing new log lines after a rotation**.
   Rotation creates a new file and a new inode,
   and the old `tail -f` is still watching the old inode.
   Use `tail -F` (GNU,
   follows the filename) or just `journalctl -f`.
8. **Windows line endings break scripts**.
   Text copied from Windows is CRLF (`\r\n`),
   and running it on Linux reports `\r: command not found`.
   Convert with `dos2unix` or `sed -i 's/\r$//' file`.

## Common Questions

**Q: How do `grep`, `sed`, and `awk` divide the work?**

Remember it by verb: **search with `grep`, edit with `sed`, count or pull columns with `awk`**.
To just check "is there a matching line" or count matches, `grep` does it in one line;
for whole-line substitution or bulk regex rewrites, `sed 's/.../.../g'` is the natural fit;
when you need to pull the Nth column by delimiter or do sums and deduped counts, `awk`'s field variables (`$1`, `$NF`) and its condition-action structure are the right tool.
All three can be partially replaced by `perl` / `rg`,
but as the POSIX/GNU foundation, the habit of combining them in pipes is worth learning first.

**Q: What is the difference between `grep -E` and bare `grep`?**

The default `grep` uses **basic regex** (BRE),
where the quantifiers `+`, `?` and grouping `()` need escaping to take effect;
`grep -E` switches to **extended regex** (ERE),
which reads closer to intuition: `grep -E 'error|warn|fail' app.log`.
`grep -P` enables Perl regex (with `\d`, lookaheads, etc.),
but it depends on PCRE, which is not available on some minimal systems -- in production scripts, prefer `-E`.

**Q: Why does a pipe put `sort` before `uniq` rather than the other way around?**

`uniq` only merges **adjacent** duplicate lines,
so you have to sort the same content together first, or deduplication is incomplete.
The typical count is `sort file | uniq -c | sort -nr`:
sort first, then dedupe and count, then sort by count descending.
Skip the `sort` and just run `uniq`,
and you get "adjacent duplicates removed" only --
the result drifts with the input order,
and it looks like random data loss.

**Q: What do I do about Vim's `E45: 'readonly' is set` on save?**

The file itself is not writable (`ls -l` shows the owner is not you),
or it has been locked with `chattr +i`.
To force a write use `:w !sudo tee %` (write it back through sudo),
but more often the real situation is that you should not be editing this file at all --
check the owner and permissions first, then decide whether to `chmod` or use `sudoedit`.
Treating the `-i` warning as noise and forcing `:w!` easily leaves half a change on the wrong file.

## References

- `man grep`, `man sed`, `man awk`, `man sort`, `man less`, `man vim`
- Bird's Private Recipes (Lin's Linux Administration Guide) - Text editors and processors -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Arch Wiki - Vim -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Vim)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- GNU grep manual -- [gnu.org](https://www.gnu.org/software/grep/manual/)
- GNU sed manual -- [gnu.org](https://www.gnu.org/software/sed/manual/)
- gawk manual (GNU awk) -- [gnu.org](https://www.gnu.org/software/gawk/manual/)
- POSIX - Regular Expressions -- [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
