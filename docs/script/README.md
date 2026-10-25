# Scripting

I treat shell scripts as a way of recording command-line work: variables, conditionals, loops, and functions chain familiar commands into repeatable programs. This section starts from `echo` and script structure, records real scripts for backups, log statistics, and bulk renames, and also collects debugging tools and the differences across the three distro families.

> Content draws on the Bash manual, the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and the Advanced Bash-Scripting Guide; see the references in each chapter.

## Content Index

The pages record how hand-typed commands settle into scripts, Bash syntax and control structures, practical scripts for backups and logs, `set -euo pipefail` and shellcheck, and the differences between bash/sh, `[ ]`/`[[ ]]`, `$@`/`$*`, and more.

## 1. Why Turn Commands into Scripts

The commands you type by hand in a terminal are already a "program" in essence -- one that was never saved and cannot be reproduced exactly next time. Writing commands into a script solves three real pains:

1. **Repeatable**. Deploying an environment takes twenty commands; typing them by hand inevitably skips a step. As a script, every run produces the same result, and it can be handed to cron to run on schedule.
2. **Handover-friendly**. When a colleague takes over, the script itself is the documentation; verbal instruction like "cd first, then edit the config, then restart" distorts easily.
3. **Batchable**. Changing a config on one machine is hand work; on a hundred machines it is script work. Loops and `ssh` turn "change a hundred machines" into one command.

A straightforward comparison: manual operation is "type whatever you happen to remember", a script is "write down only what you have thought through". The former is fast, the latter is reliable. Use the former for daily exploration; anything that needs to run more than once should settle into the latter.

## 2. Content Index

The pages are ordered by dependency; for a specific problem you can also jump straight to the matching page:

1. **[Bash Basics](./bash-basics.md)** -- shebang choice, ways to run a script, quoting rules, command substitution. This is the foundation; get quoting wrong and everything after it is a minefield.
2. **[Variables and Data Types](./variables.md)** -- variable definition, environment variables, arrays, arithmetic and string expansion. Focus on `$@` vs `$*` and `local`.
3. **[Conditionals](./conditionals.md)** -- `if`/`case`, `[ ]` vs `[[ ]]`, file and integer tests, the `&&`/`||` exit-code trap.
4. **[Loops](./loops.md)** -- `for`/`while`/`until`, losing variables to a pipeline subshell, `read` with filenames containing spaces, quoting globs.
5. **[Functions](./functions.md)** -- function definition, local variables, the pitfalls of mixing `return` with `echo`, function libraries.
6. **[Text Processing](./text-processing.md)** -- `grep`/`sed`/`awk` in practice, cross-referenced with the commands chapter to avoid duplication.
7. **[Regular Expressions](./regex.md)** -- BRE/ERE/PCRE differences and how each maps to `grep`/`sed`/`awk`.
8. **[Script Debugging](./debugging.md)** -- `set -x`, installing shellcheck on all three families, bashdb, error handling and logging.
9. **[Worked Examples](./examples.md)** -- backup, log-statistics, and bulk-rename scripts you can actually run, with real output.

Chapters one through five are the syntax skeleton, six and seven are the data-processing muscle, eight is quality assurance, and nine pulls everything together into runnable deliverables.

## 3. One-Line Guide per File

| Chapter | Guide |
|------|------|
| [Bash Basics](./bash-basics.md) | What a script looks like, how to run it, quoting and special characters |
| [Variables and Data Types](./variables.md) | Variables, environment variables, arrays, arithmetic and string expansion |
| [Conditionals](./conditionals.md) | `if`/`case`, file and integer tests, `[ ]` vs `[[ ]]` |
| [Loops](./loops.md) | `for`/`while`/`until`, loop control, common loop traps |
| [Functions](./functions.md) | Definition, parameters, return values, local variables, function libraries |
| [Text Processing](./text-processing.md) | `grep`/`sed`/`awk` and pipeline combinations in practice |
| [Regular Expressions](./regex.md) | BRE/ERE/PCRE differences and which tool uses which |
| [Script Debugging](./debugging.md) | `set -x`, shellcheck, bashdb, error handling and logging |
| [Worked Examples](./examples.md) | Runnable scripts: backup, log statistics, bulk rename |

## 4. Bash Environment Differences Across the Three Distro Families

Scripts themselves are distribution-independent, but the interpreter and toolchain you rely on differ slightly. Sort out these differences before writing scripts, or you end up with "works on my machine":

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|--------------|------|--------------------|
| Default `/bin/sh` | dash (not bash) | bash | bash |
| bash version | 5.x (recent) | 5.x (latest) | 5.1 (conservative, follows the distro major release) |
| Installing bash | preinstalled | preinstalled (`pacman -S bash` to upgrade) | preinstalled (`dnf install bash`) |
| Installing shellcheck | `apt install shellcheck` | `pacman -S shellcheck` | `dnf install ShellCheck` |
| Installing bashdb | `apt install bashdb` | `pacman -S bashdb` | `dnf install bashdb` |
| coreutils | GNU coreutils | GNU coreutils | GNU coreutils |

Key points:

- **The default shell differs**. On Debian/Ubuntu `/bin/sh` points to `dash`, which is not bash and lacks arrays, `[[ ]]`, `local`, and other bash extensions. Starting a script with `#!/bin/bash` instead of `#!/bin/sh` exists precisely to avoid dash misreading bash syntax on Debian and erroring out. See the shebang section of [Bash Basics](./bash-basics.md).
- **bash version**. The RHEL family pins bash to the distro major release (Rocky 9 ships 5.1); Arch rolls to the latest (`pacman -S bash`). If a script uses newer bash features (associative arrays need 4.0+, `readarray` needs 4.0+), older RHEL releases may not support them.
- **coreutils is the same on all three families**. The `ls`, `grep`, `sed`, `awk`, `sort`, `uniq`, `cut`, `wc`, and friends used in this section are all GNU implementations on all three families and behave identically; this section does not cover BSD differences (that is a macOS/FreeBSD problem).
- **Some tools must be installed by hand**. shellcheck and bashdb are not installed by default; per-family install commands are in the table above and in [Script Debugging](./debugging.md).

## 5. The shellcheck Toolchain

[ShellCheck](https://www.shellcheck.net/) is a static analysis tool for shell scripts -- a linter for the scripting world. Without executing the script, it catches unquoted variables, `==` instead of `=`, old-style `$[ ]` arithmetic, and hundreds of other problem classes. **Run shellcheck after finishing every script**; it intercepts many "common gotchas" before they bite.

Install on the three families:

```bash
# Debian/Ubuntu
sudo apt install shellcheck

# Arch
sudo pacman -S shellcheck

# RHEL/CentOS/Rocky
sudo dnf install ShellCheck
```

Basic usage and output format are covered in [Script Debugging](./debugging.md). The toolchain in full: write the script -> shellcheck static analysis -> `bash -n` syntax check -> `set -x` execution tracing -> bashdb single-stepping when needed.

## 6. Quick Start

The first script, broken down line by line along the "why -> how" line:

```bash
#!/bin/bash
# First script: print the current time and user
# Why bash and not sh: the syntax below needs reliable support
set -euo pipefail   # strict mode, see "why" above

echo "Hello, World!"
echo "Current time: $(date)"
echo "Current user: $(whoami)"
```

Run it like this:

```bash
$ chmod +x hello.sh
$ ./hello.sh
Hello, World!
Current time: Tue Sep 22 10:30:00 CST 2026
Current user: alice
```

`set -euo pipefail` is the de facto "strict mode" for engineering scripts: `-e` exits on the first error, `-u` errors on any use of an undefined variable, and `-o pipefail` makes a pipeline fail if any segment fails (by default only the last segment counts). Why you need it and what side effects it has are covered in [Bash Basics](./bash-basics.md) and [Script Debugging](./debugging.md).

## 7. Common Gotchas

The things beginners trip over most -- later chapters expand each one; here is the mine map first:

1. **Confusing the shebang with the default shell**. On Debian/Ubuntu `/bin/sh` is dash, which lacks `[[ ]]`, arrays, and `local`. Always write `#!/bin/bash`, and debug with `bash script.sh` rather than `sh script.sh`.
2. **Unquoted variables**. `rm $file` deletes the wrong target when the filename contains spaces; the `*` in `echo $files` gets glob-expanded early. The rule: quote every variable reference in double quotes, and iterate with `"$@"` and `"${arr[@]}"`.
3. **Piping into `while` loses the counter**. The body of `cmd | while read` runs in a subshell, so variable changes never make it back to the current shell; rewrite as `while ... done < file` or use process substitution.
4. **Treating `return` as a data return**. `return` only carries an exit code of 0-255; for a function to return a string it must `echo` and the caller captures with `$( )`, with logs going to `stderr` -- otherwise they pollute the result.
5. **Mixing `[ ]` with `[[ ]]`, or BRE with ERE**. Empty variables or a wrong regex dialect produce results that "ran but matched nothing"; see the conditionals and regex chapters.
6. **Shipping without static analysis**. shellcheck catches most quoting and anti-pattern problems; install it with `apt install shellcheck`, `pacman -S shellcheck`, or `dnf install ShellCheck` per family.

## References

- Bash manual -- [gnu.org](https://www.gnu.org/software/bash/manual/)
- Arch Wiki - Bash -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Shell scripts -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0340bashshell-scripts.php)
- Advanced Bash-Scripting Guide -- [tldp.org](https://tldp.org/LDP/abs/html/)
- ShellCheck -- [shellcheck.net](https://www.shellcheck.net/)
- Google Shell Style Guide -- [google.github.io](https://google.github.io/styleguide/shellguide.html)
- `man bash`, `man sh`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](/system-management/README.md)
- [automation](/system-management/automation.md)
