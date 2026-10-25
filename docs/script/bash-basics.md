# Bash Basics

A shell script is a text file holding a sequence of commands, interpreted and executed by the shell. It is not a compiled language; there is no "compile and link" step -- every line is read, parsed, and executed by the interpreter at runtime. This model has two practical consequences: **errors usually only surface at runtime** (shellcheck can intercept part of them ahead of time), and **the rules for quoting and special characters directly decide whether a script succeeds or fails**. This page records the shebang, script structure, ways to run a script, quoting rules, and command substitution.

> Content draws on the Bash manual, the Arch Wiki, and the Advanced Bash-Scripting Guide; see the references at the end.

## What This Page Covers

- What the shebang does
- The differences between three ways to run a script (execute permission / `bash` / `source`)
- Single quotes, double quotes, backticks, and command substitution, thoroughly
- Special characters and escaping, laying the ground for variables, conditionals, and loops

## 1. Script Structure and the Shebang

### 1.1 Why the First Line Is `#!/bin/bash`

The shebang (also called hashbang) is the special comment at the top of a script starting with `#!`. It tells the kernel: **do not interpret this file with the default shell; use the interpreter named after it**. When you run `./script.sh`, the kernel reads the first line and turns the path and arguments into an `exec` call, equivalent to running `/bin/bash script.sh` by hand.

```bash
#!/bin/bash
```

Two common spellings and how to choose:

| Spelling | Meaning | When to use |
|------|------|---------|
| `#!/bin/bash` | Specifies bash's absolute path directly | **Almost always** -- works on all three families, the safest bet |
| `#!/usr/bin/env bash` | Looks up bash in `PATH` via `env` | When bash lives at a non-standard path (self-compiled, or several versions side by side) |
| `#!/bin/sh` | Hands it to the system's `/bin/sh` | **Only if the script is confirmed to use POSIX sh syntax only** (on Debian that is dash in practice) |

**Why not write `#!/bin/sh` and then use bash syntax**: on Debian/Ubuntu `/bin/sh` is dash, which lacks arrays, `[[ ]]`, `local`, and bash extensions beyond `$(( ))`. A script using `[[ ]]` runs on Arch (`/bin/sh` -> bash) and errors out on Debian with something like `[[: not found`. Unless you deliberately write only the POSIX subset, always write `#!/bin/bash` on the first line.

On Arch `/bin/sh` also points to bash, so "tested on Arch, broke the moment it moved to Debian" is the number one trap for cross-distribution scripts.

### 1.2 Basic Structure

A well-structured script usually contains: shebang, a comment header, strict mode, a main function, and the entry call:

```bash
#!/bin/bash
# Script description: example script
# Author: your name
# Date: 2026-09-22
# Usage: ./script.sh <arg>

set -euo pipefail   # strict mode, see [Script Debugging](./debugging.md)

main() {
    echo "Script starting"
    # ... other commands ...
    echo "Script finished"
}

main "$@"
```

`set -euo pipefail` is called strict mode; each option handles one thing: `-e` exits the script immediately when any command returns non-zero; `-u` reports an error when an undefined variable is referenced (instead of expanding to the empty string); `-o pipefail` makes a pipeline return failure when any segment fails (by default only the last segment is checked). Why you need it and what the edge cases are get their own treatment in [Script Debugging](./debugging.md) -- for this chapter just remember: **the first line of real code in an engineering script is this**.

`main "$@"` passes every argument the script received straight through to `main`. Note that `$@` must be double-quoted, or arguments containing spaces get split apart -- this is a key point in [Variables and Data Types](./variables.md).

## 2. Ways to Run a Script

The three ways carry three different semantics; choosing wrong gives you "the environment did not apply" or "wrong permissions":

### 2.1 Adding Execute Permission

```bash
$ chmod +x script.sh
$ ./script.sh
```

The kernel reads the shebang and runs the named interpreter. This is the most common way to run a script and the standard way to ship one. If you see `Permission denied`, first check that `chmod +x` was actually run and that the file is in a directory on `PATH`.

### 2.2 Running with a Shell

```bash
$ bash script.sh
$ sh script.sh
```

**Key difference**: `bash script.sh` explicitly interprets with bash and **ignores the shebang**; `sh script.sh` interprets with `/bin/sh` and likewise ignores the shebang (on Debian that is dash). For debugging, `bash script.sh` is the least hassle -- it runs even if the shebang is wrong; but if the script depends on a special interpreter named in the shebang, be careful.

Also, `bash script.sh` **starts a subshell**, so any `cd`, `export`, or variable assignment inside the script does not affect the current shell; `source` below does.

### 2.3 Running with source

```bash
$ source script.sh
$ . script.sh
```

`source` (or the equivalent `.`) runs the script in **the current shell process**, with no subshell. Typical uses:

- Loading `~/.bashrc`, function libraries, or other configuration that must "leave a trace"
- Making a script's `cd` or `export PATH=...` take effect in the current session

Conversely, if your script `cd`s into a directory to work on files, do not run it with `source` -- it would drag your current shell along.

The three side by side:

| Method | Subshell | Honors shebang | Typical use |
|------|---------|-------------|---------|
| `./script.sh` | yes | yes | everyday runs |
| `bash script.sh` | yes | no | debugging, forcing bash |
| `source script.sh` | no | no | loading config/function libraries |

## 3. Quoting Rules

Quoting is the concept most likely to go wrong in Bash, and the most important. **Whether you quote at all, and which kind of quote you use, decides whether variable expansion, glob expansion, and escaping happen**.

### 3.1 Single Quotes: Output As-Is

Nothing inside single quotes is expanded -- variables, command substitution, and escaping all stop working and the text is printed as-is:

```bash
$ USER=alice
$ echo 'Hello $USER'
Hello $USER
$ echo 'Current directory: $(pwd)'
Current directory: $(pwd)
```

Use single quotes when you need a **literal** (regexes, text containing `$`).

### 3.2 Double Quotes: Expand but Do Not Split

Inside double quotes variables and command substitution **do** expand, but **no** word splitting or glob expansion happens:

```bash
$ USER=alice
$ echo "Hello $USER"
Hello alice
$ echo "Today is $(date +%Y-%m-%d)"
Today is 2026-09-22
```

**Why variables almost always need double quotes**: unquoted, a value containing spaces or wildcards gets split into several arguments by the shell or glob-expanded:

```bash
$ file="my file.txt"
$ echo $file        # dangerous: split into two words
my file.txt         # looks fine, but is already two words when passed as arguments
$ echo "$file"      # correct: one argument as a whole
my file.txt

$ files="*.txt"
$ echo $files       # dangerous: glob-expanded to the actual file list
a.txt b.txt c.txt
$ echo "$files"     # correct: prints the literal *.txt
*.txt
```

**Rule**: write every variable reference as `"$var"`, unless you specifically need word splitting (such as the special semantics of `"$@"` when iterating an array).

### 3.3 Backticks and `$()`: Command Substitution

Command substitution captures a command's output as a string. The old style uses backticks, the new style uses `$()`:

```bash
# Old style (not recommended): backticks
$ files=`ls -l`

# Recommended: $()
$ files=$(ls -l)

# The difference shows with nesting - $() nests directly, backticks need escaping
$ echo "Host: $(uname -n), Kernel: $(uname -r)"
Host: ubuntu-lab, Kernel: 6.8.0-45-generic
```

**Why prefer `$()`**: better readability, nestable, and clearer error handling. Inside backticks you must additionally escape `$` and `\`, which is easy to get wrong.

```bash
# Get today's date and the file count (real output example)
$ today=$(date +%Y-%m-%d)
$ file_count=$(ls -1 | wc -l)
$ echo "$today: $file_count files in total"
2026-09-22: 14 files in total
```

## 4. Special Characters

Many characters in Bash have special meanings; escape with a backslash `\` or quotes when needed:

| Character | Meaning | Example |
|------|------|------|
| `#` | comment (start of line or of a word) | `# this is a comment` |
| `$` | variable reference / command substitution | `$VAR`, `${VAR}`, `$(cmd)` |
| `\` | escapes the next character | `\$`, `\n` |
| `\|` | pipe | `ls \| grep txt` |
| `&` | run in the background | `command &` |
| `;` | command separator | `cmd1; cmd2` |
| `&&` | logical AND (runs only if the previous one succeeded) | `cmd1 && cmd2` |
| `\|\|` | logical OR (runs only if the previous one failed) | `cmd1 \|\| cmd2` |
| `>` `>>` | redirection: overwrite / append | `echo hi > f`, `echo hi >> f` |
| `<` | input redirection | `sort < file` |
| `()` | subshell | `(cd /tmp && ls)` |
| `{}` | code block in the current shell / glob | `{ cmd1; cmd2; }`, `{1..5}` |
| `[]` | test command / glob character class | `[ -f file ]`, `[aeiou]` |
| `~` | home directory expansion | `~/doc` |
| `!` | history expansion / logical NOT | `! cmd`, `[ ! -f f ]` |

**The exit-code trap of `&&` and `||`** (see [Conditionals](./conditionals.md)): `cmd1 && cmd2 || cmd3` is **not** equivalent to "run cmd2 if cmd1 succeeds, otherwise cmd3" -- if cmd2 fails, cmd3 runs too. Use an `if` to express a three-way branch.

## 5. Comments

```bash
# Single-line comment

# Multi-line comment method one: Here Document (not executed, just a placeholder)
: <<'COMMENT'
This is a multi-line comment
Second line
COMMENT

# Multi-line comment method two: consecutive # lines (most direct, recommended)
# This is also a multi-line comment
# Add # to every line
```

**Why use `: <<'COMMENT'`**: `:` is Bash's no-op builtin, and the Here Document body is fed to it as standard input without being executed. The single quotes around `'COMMENT'` keep the body from expanding. The downside is that it is less obvious than a run of `#` lines -- **for new code prefer plain consecutive `#` lines**, which also fold more cleanly in editors.

## 6. Common Gotchas in This Chapter

1. **Writing `#!/bin/sh` but using bash syntax**. On Debian `/bin/sh` is dash, so `[[ ]]`, arrays, and `local` all stop working. Unless you are sure you use only the POSIX subset, always write `#!/bin/bash`.

2. **Unquoted variables**. `rm $file` becomes `rm my file.txt` (two files) when the filename contains spaces; the `*` in `echo $files` gets glob-expanded. **Rule: always quote variables as `"$var"`**; use `"${arr[@]}"` for iterating arrays and `"$@"` for arguments.

3. **Testing a bash script with `sh script.sh`**. Use `bash script.sh` or `./script.sh` (with a correct shebang) when debugging, and avoid `sh`, which creates a false "works on my machine".

4. **Mixing `source` with direct execution**. If the script contains `cd` or `export`, `source` pollutes the current shell; conversely, when you do want the environment change to stick, `bash script.sh` loses it with the subshell. Decide first whether you want to "leave a trace".

5. **Using `&&`/`||` as if-else**. `a && b || c` wrongly runs c when b fails; use `if` for branching.

6. **Not escaping `$` inside backticks**. In `` result=`echo $var` `` the `$var` still expands; if you meant a literal, wrap the `$()` in single quotes.

## References

- `man bash` -- shell syntax and quoting rules
- Bash manual - Quoting -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Quoting.html)
- Arch Wiki - Bash -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bird's Private Recipes (Lin's Linux Administration Guide) - What is a shell script -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0340bashshell-scripts.php)
- Advanced Bash-Scripting Guide - Chapter 2 - Starting Out With a Shell Script -- [tldp.org](https://tldp.org/LDP/abs/html/)
- Google Shell Style Guide - Quoting Conventions -- [google.github.io](https://google.github.io/styleguide/shellguide.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [process](/commands/system/process.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [examples](examples.md)
- [variables](variables.md)
