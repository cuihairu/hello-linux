# Script Debugging

Debugging is an unavoidable part of script development: Shell is interpreted and weakly typed, so many errors -- a missed quote, an empty variable, a pipe subshell -- **never show up while you are writing them; they only blow up in a weird way at the line you happen to hit at runtime**. Good debugging habit is not "investigate after it breaks" but layered defense: while writing, run shellcheck for a static scan; before running, check syntax with `bash -n`; while running, watch expansions with `set -x`; for complex logic, single-step with bashdb; after deploy, leave traces via `trap` and logs. This chapter unfolds in that order and gives the tool install commands for the three distro families.

> Content draws on the Bash manual, ShellCheck docs, and the Arch Wiki; see the references at the end.

## What This Page Covers

- Know every option and side effect of strict mode `set -euo pipefail`
- Use `set -x` / `bash -x` to locate the execution path and expansion results
- Install and use shellcheck across the three distro families, and read the common warnings
- Use `trap` for EXIT/ERR/INT, writing error handling and logs
- bashdb basic breakpoints and single-step operations

## 1. Strict mode: set -euo pipefail

The top of an engineering script almost always has a line `set -euo pipefail`. Each option blocks one class of bug: `-e` (errexit) exits immediately when any command returns non-zero (and is not consumed by `if`/`&&`/`||` etc.); `-u` (nounset) errors outright on referencing an undefined variable instead of expanding to the empty string; `-o pipefail` makes the whole pipe's exit code fail if **any segment** fails (by default only the last segment is looked at).

The `pipefail` difference is clear with a minimal example: `false | true` exits 0 without pipefail (only the last segment, true, is looked at) and 1 with pipefail (the middle false makes the whole pipe fail). **Why `-u` is needed**: an undefined variable expands to empty by default, so `rm "$dir"/*` with a misspelled `dir` can become a dangerous path; `-u` stops immediately with `unbound variable`.

**Side effects and boundaries** (must know before using):

1. **`local x=$(false)` does not trigger `-e`** -- `local` itself returns 0, swallowing the subcommand failure (see [Functions](./functions.md)).
2. **`((var++))` returns 1 when var=0**, so `set -e` exits the script; use `var=$((var+1))` or `|| true`.
3. **`grep` with no match returns 1** and also triggers `-e`; when no match is allowed, write `grep ... || true`.
4. When a function is called as an `if` condition, `-e` is **temporarily disabled** inside the function body (the whole function is in a "conditional context") -- do not rely on `-e` for line-by-line safety in complex functions.

Temporarily off and back on: `set +e` for a segment you deliberately tolerate failing, then `set -e` to restore. `-e` is a safety net, not a logic framework; critical branches still need explicit `if`/`||`.

## 2. Syntax and Static Checks

### 2.1 bash -n: parse only, do not execute

`bash -n script.sh` executes no commands, it only parses -- good for quickly filtering low-level errors like "missing `fi`" before committing; exit code 0 means syntax passed.

### 2.2 shellcheck: the script linter

[ShellCheck](https://www.shellcheck.net/) statically analyzes common traps: unquoted variables, the old `$[ ]` syntax, the `cat file |` anti-pattern, `==` used with `[ ]`, and hundreds of other rules. **Install across the three distro families**:

```bash
# Debian/Ubuntu
sudo apt install shellcheck

# Arch
sudo pacman -S shellcheck

# RHEL/CentOS/Rocky
sudo dnf install ShellCheck
```

Note the RHEL family package name is `ShellCheck` (CamelCase, different from the binary name `shellcheck`); Debian/Arch are all lowercase -- a misspelled package name gives `No match`, the easiest step to get stuck on when comparing the three families.

Basic usage: `shellcheck script.sh` lists warnings directly (e.g. SC2086 reminds you to quote variables); `-f gcc` outputs GCC style for editor jumping; `-f json` for CI parsing; `-S error` shows only the error level; `-e SC2086` excludes a specific rule. **Fold into your workflow**: an editor plugin for live hints; in CI run `shellcheck -S warning` on `*.sh` and let warnings fail the build. All examples in these notes should pass shellcheck's core rules (SC2086 quote variables, SC2046 quote command substitution, etc.).

### 2.3 Debug-friendly output habits

The `%q` in `printf 'name=%q\n' "$name"` escapes the value, so spaces and special characters are immediately visible -- much better than a bare `echo` for spotting whether a variable has a trailing space or contains a tab. `declare -p arr` prints arrays and types. Printing the argument count and `"<$1>"` form at a function entry immediately reveals parameters being split apart.

## 3. set -x: trace execution

Put `set -x` / `set +x` around a suspicious segment, or run the whole script with `bash -x script.sh`. The `+` at the start of each line marks "the actual expanded command that ran" -- **variable expansion results are directly visible**, so missed quotes and empty expansions are spotted at a glance. Control noise: `PS4='+ ${BASH_SOURCE}:${LINENO}: '` shows file and line number; `BASH_XTRACEFD=3 bash -x script.sh 3>trace.log` writes the trace to fd 3, keeping stdout clean. Combine with `set -e` via `set -ex` to see the trace and the failure point at once; the last `+` line before the failure is often the culprit.

## 4. trap and Error Handling

The three most-used signals: `EXIT` fires when the script ends (normally or via `exit`), for deleting temp files and releasing locks; `ERR` fires when a command returns non-zero (needs `set -e` or `set -o errtrace` for fine granularity), for error localization; `INT`/`TERM` correspond to Ctrl+C and `kill`, for graceful exit. There is also `DEBUG`, which fires before every command -- extremely noisy, for ultra-fine-grained tracing only.

The standard template is `trap cleanup EXIT` + `mktemp`: temp files get deleted even if `set -e` exits mid-way, no pileup in `/tmp`; `trap 'on_error ${LINENO} "$BASH_COMMAND" $?' ERR` records the failing line number and command; `trap 'echo "interrupt received"; exit 130' INT` handles interrupts. At startup, block "missing tool, missing variable, missing file" in one pass: use `command -v` to probe dependencies, use `${VAR:?}` or `[[ -n ${TARGET:-} ]]` to check variables -- far friendlier than hitting `command not found` halfway through.

**Mind the division of labor between `trap ERR` and `set -e`**: `-e` handles "exit on command failure", `ERR` handles "run a hook on failure"; both depend on the failure being visible to the shell. Conditional positions like `if cmd` / `while cmd` consume the exit code, so they trigger neither `-e` nor `ERR` -- the hook not running is by design, not a misconfiguration.

## 5. Logging

A logging function assembles timestamp, level, and message, then `tee -a` to file, all `>&2` to stderr -- so `result=$(my_cmd 2>>log)` leaves the log without polluting the result (data/log separation in [Functions](./functions.md)). Level filtering with an associative array (Bash 4+, satisfied by the three families by default): `DEBUG=0 INFO=1 WARN=2 ERROR=3`; anything below `LOG_LEVEL` returns without printing.

In production, simple rotation can be self-implemented (mv with a sequence number when the size is exceeded), but the more carefree approach is to hand logs to `logrotate` (see [Log Rotation](../basic/log/rotation.md)); the script just writes to a fixed file -- self-implemented rotation easily trips over concurrent writes and inode reuse.

## 6. bashdb: Interactive Breakpoint Debugging

`set -x` can only "replay the whole segment"; when you need to **pause, change variables, and single-step**, use bashdb -- a GDB-style Bash debugger. **Install across the three distro families**:

```bash
# Debian/Ubuntu
sudo apt install bashdb

# Arch
sudo pacman -S bashdb

# RHEL/CentOS/Rocky
sudo dnf install bashdb
```

Common in a session: `break 12` or `break func` to set a breakpoint, `continue` to continue to the next breakpoint, `next` (n) single-steps without entering a function, `step` (s) single-steps into a function, `print $var` evaluates and prints, `list` shows nearby source, `where` shows the call stack, `quit` exits; you can also use `bashdb -b 10 script.sh` to stop non-interactively at line 10. The install is small (on Arch `pacman -S bashdb` is instant); complex state-machine scripts are worth the learning cost, while simple scripts are often faster with `set -x` + `printf`.

## 7. Suggested Debugging Workflow

1. **`shellcheck` right after writing** -- catches 60% of quoting and common anti-pattern issues.
2. **`bash -n`** -- resolve syntax errors before execution.
3. **Get it running on a small sample** -- verify the logic with a minimal input file before real data.
4. **Trace with `bash -x`** -- turn it on when the path is wrong or an expansion is empty, to see what each step actually ran.
5. **Print intermediate values** -- `printf '%q\n'` key variables, or temporarily `declare -p`.
6. **Single-step with bashdb** -- set breakpoints when state is complex, functions are deeply nested, or loop conditions are hard to reproduce.
7. **`trap EXIT` + logs before shipping** -- rely on the traces left behind when you cannot reproduce on site.

## 8. Common Gotchas in This Chapter

1. **Thinking `set -e` is universal**. `-e` is disabled inside a function used as an `if` condition; `local x=$(cmd)`, `((i++))`, and `grep` with no match all have exceptions. `-e` is a safety net, not a logic framework; critical branches still need explicit `if`/`||`.

2. **Turning on `-u` but not handling optional variables**. Use `${VAR:-}` and `${1:?...}` patterns for optional arguments, otherwise even the normal path hits `unbound variable`.

3. **Installing shellcheck with the wrong package name**. The RHEL family is `dnf install ShellCheck` (uppercase), Debian is `shellcheck`, Arch is `pacman -S shellcheck`; the lowercase package name is not found on Rocky.

4. **`set -x` output mixed with business stdout**. Redirect the trace: `BASH_XTRACEFD=3 bash -x s.sh 3>trace.log`, or `exec 2>trace.log` and inspect stderr separately.

5. **`trap ERR` not firing**. Needs `set -e` or `set -o errtrace`; and commands whose exit code is consumed by `if cmd` do not enter ERR.

6. **Chaining `&&` without checking `$?`**. `cmd && do_ok || do_fail` also enters `do_fail` when `do_ok` fails -- see [Conditionals](./conditionals.md).

7. **Forgetting to remove `set -x`/`echo debug` after debugging**. Run shellcheck plus a code search for `TODO`/`DEBUG` before committing; collecting debug output into `log DEBUG` controlled by `LOG_LEVEL` is safer.

8. **Debugging `rm -rf $dir` in a production script**. First dry-run with `echo rm -rf "$dir"`, or add `-i`/`--dry-run`; `set -u` ensures a misspelled `dir` errors instead of deleting root.

## References

- `man bash` -- set (Shell Builtin Commands), trap
- ShellCheck Wiki -- [shellcheck.net](https://www.shellcheck.net/wiki/)
- Arch Wiki - Bash -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bash manual - The Set Builtin -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html)
- Bash manual - Bourne Shell Builtins (trap) -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Builtin-Commands.html)
- Bird's Private Recipes (Lin's Linux Administration Guide) - How scripts are executed and recommendations -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Debugging -- [tldp.org](https://tldp.org/LDP/abs/html/debugging.html)
- bashdb manual -- [bashdb.sourceforge.net](https://bashdb.sourceforge.net/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [bash-basics](bash-basics.md)
- [examples](examples.md)
- [functions](functions.md)
- [automation](/system-management/automation.md)
