# Conditionals

Conditional statements are the core of script logic control -- without them a script can only run commands top to bottom in a straight line, with no way to take different branches based on "does this file exist", "is this number large enough", or "did the user type y or n". Bash provides four conditional mechanisms: the `if` statement with test expressions, `case` pattern matching, `(( ))` arithmetic conditionals, and `[[ ]]` extended tests. Which one to pick, `[ ]` or `[[ ]]`, and whether to quote a variable are the key points this chapter untangles. It starts with "why several spellings exist", then shows how to use them.

> Content draws on the Bash manual, the Arch Wiki, and the Advanced Bash-Scripting Guide; see the references at the end.

## What This Page Covers

- The syntax and use cases for `if`/`elif`/`else` and `case`
- Telling apart the role boundaries of `[ ]`, `[[ ]]`, and `(( ))`
- The integer, string, and file test operators
- Exit statuses and the traps in `&&`/`||` combinations
- Writing real script snippets with argument validation

## 1. Why So Many Conditional Forms

Historically the shell has several test commands: POSIX `test` (written `[ ]`), the Bash extension `[[ ]]`, and `(( ))` for arithmetic. They solve different problems: `[ ]` is an ordinary command, suited to integer/string/file tests, but variables must be quoted and it does not support `||`, `=~`, or globs; `[[ ]]` is a Bash builtin keyword, safer with empty variables and wildcards, and supports regex and patterns; `(( ))` handles only numbers, with C-like syntax. **Choice principle**: when the script is declared `#!/bin/bash`, prefer `[[ ]]` and `(( ))`; use `[ ]` only when POSIX compatibility is required or you deliberately want the classic `test` semantics. dash (Debian's `/bin/sh`) does not support `[[ ]]`, so cross-distro scripts either use `#!/bin/bash` or fall back to quoted `[ ]`.

## 2. The `if` Statement

The basic structure is `if condition; then true-branch; elif condition2; then another-branch; else fallback; fi` -- the semicolon (or newline) before `then` cannot be omitted; it is the keyword separator. The first example uses `(( age >= 18 ))` to test adulthood and prints "adult"/"minor", since the comparison is on integers; `[[ $age -ge 18 ]]` works too, but `-ge` belongs to the test syntax, and `(( ))` feels closer to the intuition of arithmetic comparison. Think of `if` as "routing on a command's exit status": a command in the condition slot returning 0 goes to `then`, non-0 goes to `else` -- which is why `if command; then` can take any command directly (`grep`, `systemctl`, a custom function).

```bash
$ age=20
$ if (( age >= 18 )); then echo "adult"; else echo "minor"; fi   # -> adult
$ if systemctl is-active --quiet nginx; then echo "nginx is running"; else echo "nginx is not running"; fi
nginx is not running
```

## 3. Conditional Expressions

### 3.1 Integer Comparison

`-eq`/`-ne`/`-gt`/`-ge`/`-lt`/`-le` are equal, not equal, greater than, greater-or-equal, less than, and less-or-equal, written inside `[ ]` or `[[ ]]`. The same meaning written as `(( a < b ))` looks more like C, and empty variables are treated as 0, so it does not throw the argument-count syntax error that `[ $a -lt 5 ]` does. Variables inside `(( ))` do not need the `$` prefix (adding it works but is redundant); expressions like `a + b > 25` are also supported.

### 3.2 String Comparison

`=`/`==` equal (both equivalent inside `[[ ]]`), `!=` not equal, `-z` empty, `-n` non-empty, `<`/`>` lexicographic order (`[[ ]]` only), `=~` regex match (`[[ ]]` only, ERE dialect). **Why variables must be quoted when comparing strings in `[ ]`, but can be left unquoted in `[[ ]]`**: `[ ]` is an ordinary command, so an empty variable vanishes after word splitting, producing an argument-count error like `[ = foo ]`; `[[ ]]` is a keyword and does no word splitting internally. For consistent habits, quote variables inside `[[ ]]` too -- especially when the value might contain glob characters. The regex on the right side of `=~` must **not** be quoted (quoting makes it a literal); capture results are in `BASH_REMATCH`, see [Regular Expressions](./regex.md).

### 3.3 File Tests

`-f` regular file, `-d` directory, `-e` exists, `-r`/`-w`/`-x` readable/writable/executable, `-s` non-empty, `-L` symbolic link. When testing a symlink, **`-L` must come before `-f`/`-d`** -- `test -f link` checks the link target, so testing `-f` first follows the link and can never distinguish the link itself. When checking fixed paths like `/etc/passwd` in everyday work, quote everything: `[[ -f "$file" && -r "$file" ]]`.

`[ ]` vs `[[ ]]` behavior with an empty variable:

```bash
$ name=""
$ [ $name = foo ]; echo "exit=$?"
# bash: [: =: unary operator expected   exit=2 (empty variable disappears after word splitting)
$ [ "$name" = foo ]; echo "exit=$?"   # [ ] is safe only when quoted -> exit=1
$ [[ $name = foo ]]; echo "exit=$?"    # [[ ]] is a keyword, no internal word splitting -> exit=1
$ [[ "file.txt" == *.txt ]] && echo match   # [[ ]] supports globs -> match
```

## 4. Logical Operators

Inside `[[ ]]` you get `&&`, `||`, and `!` directly, with no need to split into two `[ ]` tests. With the classic `[ ]`, `&&` goes **between** the two `]` and `[`, as the shell's command connector, which is a different layer from the test logic written **inside** `[[ ... && ... ]]` -- both are legal but mean different things, and the distinction is easy to muddle on first read. `(( ))` uses true arithmetic comparison operators, so `>` and `<` are not misread as redirections or lexicographic order.

**The `case` statement**: when there are many branches based on string pattern matching, it is far clearer than a chain of `if`/`elif`. Patterns support glob-style wildcards (`*`, `?`, `[...]`), `|` means or, and each arm ends with `;;` -- **forgetting `;;` swallows the following arm**, the most common `case` syntax error. Keep the default arm `*)` permanently, or illegal input silently does nothing. Interactive input handling commonly reads with `read -rp` and then matches `y|Y|yes|YES`-style patterns in `case`.

```bash
$ cat > backup-type.sh <<'EOF'
#!/bin/bash
case "$1" in
    full|fullonly)   echo "run full backup" ;;
    incr|daily)      echo "run incremental backup" ;;
    y|Y|yes|YES)     echo "confirmed" ;;
    *)               echo "usage: $0 {full|incr}" >&2; exit 2 ;;
esac
EOF
$ chmod +x backup-type.sh
$ ./backup-type.sh full      # -> run full backup
$ ./backup-type.sh bogus     # -> usage: ./backup-type.sh {full|incr}, $? = 2
```

## 5. Ternary Operator and Exit Status

`$(( ))` supports only the **numeric** ternary `cond ? a : b`, and cannot return a string literal directly; for a string result use `if`/`else` assignment. Every command leaves an exit status: `0` success, non-`0` failure, and `$?` holds the status of the immediately preceding command. To check success, prefer `if command; then`, letting Bash consume the exit status itself; when you need to save it for later, capture immediately with `ret=$?` -- do not test it a line later.

`&&` and `||` are often used as a "ternary", but there is a classic trap: `cmd1 && cmd2 || cmd3` is **not** equivalent to "if cmd1 succeeds run cmd2, otherwise cmd3" -- if cmd1 succeeds and runs cmd2, and cmd2 fails, cmd3 runs too. Express branching correctly with `if`. The safe "fail-fast" idiom is `cd /some/dir || exit 1`, which uses only `||` and involves no intermediate success check.

## 6. Designing Practical Snippets

**Argument validation**: at the top of a script use `(( $# < 1 ))` to check the argument count, print usage to stderr and `exit 1`; then use `[[ ! -f "$file" ]]` to check the file exists. Usage errors and business errors should use different exit statuses (e.g. 2 and 1) so the caller can tell them apart. Running without arguments shows `usage: ./proc.sh <filename>`, a missing file shows `error: file missing.txt does not exist`, and `$?` is non-0.

**Service status check**: `systemctl is-active --quiet "$service"` expresses state via exit status (0=active), which is exactly what `if` consumes, with no need to parse output; if inactive, use `read` to ask whether to start it, matching patterns with `[[ "$choice" == [yY] ]]`.

**File type check**: branch in the order "symlink -> directory -> regular file -> other existing -> not exists"; the symlink arm can use `readlink` to print the real target; the directory arm counts entries with `ls -A | wc -l`; the file arm uses `wc -c` for byte count. Getting the order wrong misclassifies a symlink as a regular file -- see section 3.3.

## 7. Common Gotchas in This Chapter

1. **Empty variables left unquoted**. `if [ $name = foo ]` becomes `[ = foo ]` when `name` is empty, reporting `unary operator expected`. Rule: inside `[ ]` always write `"$var"`; prefer `[[ ]]`.

2. **`==` inside `[ ]`**. The classic `test` uses `=`; `==` is a Bash `[[ ]]` extension. Use `==` or `=` consistently inside `[[ ]]`.

3. **Integer comparison with `=` instead of `-eq`**. `[ "$a" = 5 ]` is string equality; `[ "$a" -eq 5 ]` is the numeric comparison. For numeric comparison inside `[[ ]]` use `-eq`, or just use `(( a == 5 ))`.

4. **`$?` overwritten by an intervening command**. `cmd; echo "debug"; if [[ $? -eq 0 ]]` is really testing the exit status of `echo`. Either test it immediately or capture it with `ret=$?` first.

5. **Using `&&`/`||` as if-else**. See section 5; when cmd2 fails, cmd3 runs by mistake.

6. **Missing `;;` on a `case` arm**. It falls through into the next arm's pattern match, producing a hard-to-understand "multiple arms execute at once".

7. **Wrong order for the symlink test**. `-L` must come before `-f`/`-d`, otherwise you cannot distinguish the link itself from its target type.

8. **Using `[[ ]]` in dash (`sh`)**. Debian's `/bin/sh` is dash, which does not support `[[ ]]`. Either `#!/bin/bash`, or fall back to quoted `[ ]`.

## References

- `man bash` -- Conditional Constructs, test
- Bash manual - Conditional Constructs -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Conditional-Constructs.html)
- Arch Wiki - Bash - Conditions -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Conditional Expressions -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Tests -- [tldp.org](https://tldp.org/LDP/abs/html/tests.html)
- POSIX test -- [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/test.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [bash-basics](bash-basics.md)
- [debugging](debugging.md)
- [examples](examples.md)
- [variables](variables.md)
