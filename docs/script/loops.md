# Loops

Loops repeat a block of code until a condition is met -- they are the dividing line between "run one command against a hundred files a hundred times" and "write a hundred lines of duplicated code". Bash provides three loops: `for` (iterate a known list), `while` (repeat while a condition is true), and `until` (repeat while a condition is false). The syntax itself is simple; what actually bites is the **boundaries of the loop**: pipelines open a subshell and lose variables, a careless `read` truncates filenames containing spaces, and an unquoted glob lets wildcards expand too early. This chapter unfolds as "why -> how -> common gotchas".

> Content draws on the Bash manual, the Arch Wiki, and the Advanced Bash-Scripting Guide; see the references at the end.

## What This Page Covers

- `for` (list, range, C-style, file glob), `while`, `until`
- Controlling loops with `break`/`continue`
- How pipeline subshells and redirection affect variable scope
- Reading lines and filenames containing spaces/special characters correctly with `while read`
- Writing practical loops: batch renaming, log statistics, and more

## 1. The for Loop

### 1.1 List Iteration and Number Ranges

The most intuitive form runs once per word over a known set: `for fruit in apple banana cherry; do ... done`. The list is expanded **once, up front** -- modifying the "list source" inside the loop body does not affect the current run. For number ranges prefer brace expansion `{1..5}`, with a step `{0..10..2}`, or the C-style `for ((i=0; i<5; i++))` (more flexible when variables take part in the condition).

**Why prefer `{1..N}` over `$(seq 1 N)`**: `seq` is an external command that forks a process on every iteration; `{1..N}` is the shell's brace expansion, purely builtin. Over tens of thousands of iterations the difference shows. Reach for `seq` only when you need complex stepping or floating point.

```bash
$ for fruit in apple banana cherry; do echo "fruit: $fruit"; done
fruit: apple / fruit: banana / fruit: cherry
$ for i in {1..5}; do printf '%s ' "$i"; done; echo    # -> 1 2 3 4 5
$ for ((i=0; i<3; i++)); do echo "i=$i"; done          # -> i=0 / i=1 / i=2
```

### 1.2 Iterating File Globs

In `for file in *.txt` the `*.txt` is expanded by the shell in the `in` list position; if **no file matches**, by default (without `nullglob`) the literal `*.txt` is kept as-is -- so the first string the loop body receives is `*.txt` itself, and `cat *.txt` may report "no such file". The robust form is `shopt -s nullglob` so an unmatched glob expands to an empty list (zero iterations), then `shopt -u nullglob` when done; or assign the glob to an array first and check that `${files[0]}` exists before entering the loop.

**Filenames referenced inside the loop body must be quoted**: when `for file in *.txt` expands, each filename is already a separate word (filenames with spaces are already safe at the glob-expansion stage), but inside the body an unquoted `mv $file ...` goes through word splitting a second time -- see section 5.

### 1.3 Iterating Command Output and Arrays

The correct way to iterate an array is `for item in "${arr[@]}"` (quoted); for indices use `for i in "${!arr[@]}"`. When iterating command output, **avoid `for x in $(cmd)`**: the result of command substitution goes through another round of word splitting and glob expansion -- spaces inside filenames get split apart, `*` gets expanded. For data that is "one record per line, fields may contain spaces" (filenames, paths, text with spaces) use `while IFS= read -r`, see the next section.

## 2. while and until

When counting with `while (( count < 5 )); do ...; done`, increment with `count=$((count + 1))` instead of `((count++))` -- when `count` is 0 the arithmetic result of `((count++))` is 0 (postfix increment returns the old value), `(( ))` uses that as its exit status, and `set -e` mistakes it for a failure and exits the script. To read a file use `while IFS= read -r line; do ...; done < file.txt`: `IFS=` clears the internal field separator so leading and trailing whitespace is not swallowed, `-r` disables backslash escaping (otherwise `a\nb` loses its backslash) -- these two options are the **default template**; omit them and the loop breaks on data containing spaces or backslashes. To read CSV fields set `IFS=,`.

`until` is the opposite of `while`: it loops while the condition is false, fitting "wait for a file to appear, wait for a port to be ready" scenarios -- "until the condition holds" -- and reads better than `while ! condition`; the two are interchangeable. Two ways to write an infinite loop: `while true` or `while :` (`:` is the no-op builtin, which always returns 0).

```bash
$ count=0
$ while (( count < 3 )); do echo "count=$count"; count=$((count + 1)); done
# count=0 / count=1 / count=2 -- not ((count++)), see the set -e trap
$ n=3
$ until (( n == 0 )); do echo "left: $n"; n=$((n - 1)); done
# left: 3 / left: 2 / left: 1
```

## 3. Loop Control and Nesting

`break` exits the whole loop, `continue` skips the current iteration; `break 2` / `continue 2` exit/skip the Nth enclosing level (1 = innermost). A classic nested-loop example is the multiplication table: the outer loop drives rows, the inner loop drives columns, `printf` prints without a newline to build one row, and the outer loop ends the row with `echo`. When a loop calls a function to process each file, the function's variables use `local`, and counters outside the loop must accumulate in the current shell -- putting the loop on the right side of a pipeline loses them, see the next section. `[[ -e $file ]] || continue` is the common guard for skipping nonexistent files.

## 4. Key Trap: Pipeline Subshells and Lost Variables

**This is the most classic, most frequent gotcha of the loops chapter**: after `cat file.txt | while read -r line; do count=$((count+1)); done`, `echo $count` prints 0. **Cause**: the right side of a pipeline `|` runs in a **subshell**; the loop runs inside that subshell, and modifications to `count` exist only there; the parent shell's `count` never changes. When the process ends, the subshell's variables vanish with it.

```bash
$ printf 'a\nb\nc\n' > /tmp/lines.txt
$ count=0
$ cat /tmp/lines.txt | while IFS= read -r line; do count=$((count + 1)); done
$ echo "pipe form: $count"          # -> pipe form: 0 (subshell variable lost)
$ count=0
$ while IFS= read -r line; do count=$((count + 1)); done < /tmp/lines.txt
$ echo "redirect form: $count"        # -> redirect form: 3
```

Three fixes, ranked by preference:

1. **Redirection instead of a pipeline** (best): `while ...; done < file.txt` -- the loop stays in the current shell and the counter accumulates normally.
2. **Process substitution**: `while ...; done < <(cat file.txt)` -- the loop still runs in the current shell; fits when the data comes from a command rather than a file.
3. **Write results to an array/file**: the loop only appends to an array `results+=("$line")` or a temp file, and reads it after the loop ends -- for cases that need both the count and the detail.

`done < file.txt` accepts only files; `done < <(cmd)` accepts any command that produces standard output. For everyday file reading the former is enough. **The same logic applies**: `cmd | while ...` always opens a subshell; whenever the loop body must **modify the current shell's variables** (counters, accumulators, flags), never feed the `while` through a pipeline.

## 5. Key Traps: read, Filenames with Spaces, and Glob Quoting

### 5.1 The Right Way to Use read

The wrong demonstration is `while read line` (no `IFS=`, no `-r`): it loses backslashes, swallows leading/trailing whitespace, and continues lines on `\`. The correct template is always `while IFS= read -r line; do ...; done < file.txt`. If you worry about the last line being swallowed when it lacks a trailing newline (`read` returns non-zero but `line` may still hold data), guard with `while IFS= read -r line || [[ -n $line ]]; do ...; done`.

```bash
$ printf '  my notes.txt  \npath/with\\space.txt\n' > /tmp/names.txt
$ while IFS= read -r file; do echo "read: [$file]"; done < /tmp/names.txt
read: [  my notes.txt  ]          # leading/trailing spaces preserved
read: [path/with\space.txt]       # backslash preserved
$ while read file; do echo "read: [$file]"; done < /tmp/names.txt   # wrong form
read: [my notes.txt]              # spaces swallowed
read: [path/withspace.txt]        # backslash eaten as an escape
```

### 5.2 Handling Filenames with Spaces

`for file in $(ls)` splits filenames on spaces -- dangerous. The correct approach is a direct glob `for file in *` (the words are already safe), or `while IFS= read -r file` over a "one filename per line" list (Here Document or process substitution). For arbitrary path lists, use read the same way to avoid word splitting.

### 5.3 Two-Stage Expansion of Unquoted Globs

The shell processes a command line in two stages: the **expansion stage** (variables, command substitution, globs) and the **word-splitting stage**. With `file="my file.txt"`, `cat $file` expands to the full string and then word-splits into the two arguments `my` and `file.txt`; `cat "$file"` passes one whole argument. With `target="*.txt"`, `echo $target` glob-expands into the actual file list, while `echo "$target"` prints the literal `*.txt`. **Rule of thumb**: always double-quote variables, `$@`, `"${arr[@]}"`, and command substitution when they stand as arguments; glob patterns (`*`, `?`) at positions where you **want** expansion (such as `for ... in *.txt`, `rm *.log`) must **not** be quoted, or they turn into literals.

## 6. Designing Practical Examples

**Batch rename (safe version)**: `nullglob` prevents one iteration over the literal when nothing matches; `mv -n` prevents overwriting (or check `[[ -e $new_name ]]` first and skip); `--` terminates option parsing (so a filename starting with `-` is not read as an option); count with `count=$((count + 1))`. First run with `DRY_RUN=1` printing the `mv` commands without touching files, then run for real once verified -- the gold standard for destructive operations. Real output shows lines like `rename: my notes.txt -> my notes.md`, filenames with spaces handled correctly.

**Counting log errors**: read line by line with `while IFS= read -r line`, counting with `[[ $line == *ERROR* ]]`; note that `((errors++))` has exit status 1 while errors is 0, so under `set -e` you need a `|| true` guard (or use `errors=$((errors+1))` instead). Line-by-line read is slower than `grep -c`, but once you need complex per-line branching it is the only way; for plain counting `grep -c` is faster.

**Periodic monitoring**: `while true; do ...; sleep 5; done` shows the structure, but production monitoring is better served by `mpstat`, `sar`, or `node_exporter` -- computing `/proc/stat` deltas yourself is error-prone, and a resident script is harder to manage than a cron/systemd timer.

## 7. Common Gotchas in This Chapter

1. **Feeding `while` through a pipeline resets the counter to zero**. `cmd | while read` runs in a subshell and the variables never come back. Switch to `while read ... done < file` or process substitution `done < <(cmd)`.

2. **`for x in $(cmd)` shreds data containing spaces**. For filenames and paths always use `while IFS= read -r` or an array glob.

3. **`read` without `IFS=` and `-r`**. Loses backslashes and swallows leading/trailing whitespace; the template is always `while IFS= read -r line`.

4. **Glob with no match loops once over the literal**. An unmatched `*.txt` enters the loop as-is, and `mv *.txt ...` may error out. Use `shopt -s nullglob` or test for existence first.

5. **Unquoted `mv $file`/`rm $target` inside the loop body**. A filename containing spaces splits into two arguments and may delete the wrong thing. Always `"$file"`, and add `--` after the options.

6. **Under `set -e`, `((var++))` exits the script when var is 0**. The postfix `++` returns the old value 0, read as failure. Switch to `var=$((var+1))`, `((++var))`, or a trailing `|| true`.

7. **Mixing up `{1..N}` and `$(seq)` performance**. For large ranges use `{1..N}` or `((;;))` to avoid pointless external processes.

8. **The last line, lacking a newline, is swallowed by `read`**. Guard with `while IFS= read -r line || [[ -n $line ]]`.

## References

- `man bash` -- Looping Constructs, Compound Commands
- Bash manual - Looping Constructs -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Looping-Constructs.html)
- Bash manual - pipelines (subshell semantics) -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
- Arch Wiki - Bash - Loops -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bird's Private Recipes (Lin's Linux Administration Guide) - loop scripts -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Loops -- [tldp.org](https://tldp.org/LDP/abs/html/loops1.html)
- Google Shell Style Guide - Reading Files -- [google.github.io](https://google.github.io/styleguide/shellguide.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
- [examples](examples.md)
- [text-processing](text-processing.md)
