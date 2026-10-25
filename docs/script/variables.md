# Variables and Data Types

A shell variable is a container for data, with no declared type -- the same variable may hold a number one moment and a string the next, and the interpreter gives it a context-dependent reading only when it is used. This weakly-typed design makes scripts fast to write, but it also produces two high-frequency accidents: quoting was needed but omitted, causing word splitting and glob expansion; and `"${arr[@]}"` was needed but `$arr` was written, flattening an array into a single string. This chapter centers on variable definition, collects environment variables, special variables, arrays, and arithmetic and string expansion, and digs into the details around `$@` vs `$*`, `local`, and exit codes.

> Content draws on the Bash manual, the Arch Wiki, and shell programming practice; see the references at the end.

## What This Page Covers

- Variable definition, reference, and readonly/deletion
- Telling local variables, environment variables, and special variables apart (`$@`/`$*`/`$?`/`$$`, and more)
- Indexed and associative arrays, and the difference between `"${arr[@]}"` and `$arr`
- Arithmetic and string expansion (length, substring, substitution, prefix/suffix stripping)
- `local` scope, and the global pollution caused by omitting it

## 1. Variable Definition

### 1.1 Assignment Syntax: Why There Must Be No Space Around the Equals Sign

`name="John"` is a lexical assignment, not "evaluate the expressions on both sides of the equals and store the result". Write `name = "John"` and Bash treats `name` as a command with `=` and `John` as arguments, producing `name: command not found` -- a very common pitfall. When referencing, always write `"${name}"` or `"$name"`: braces make the boundary explicit when the variable name is followed by other characters, so `${name}suffix` written as `$namesuffix` would look for a different variable. Build the habit: **always use braces when letters or digits immediately follow the variable, and always double-quote a variable when it is an argument**.

```bash
$ name="John"
$ echo "Hello, ${name}!"          # -> Hello, John!
$ greeting="Hi$name again"        # braces required when a letter follows -> HiJohn again
$ readonly PI=3.14159
$ PI=3                            # -> bash: PI: readonly variable
$ unset name && echo "${name:-Anonymous}"   # -> Anonymous
```

Readonly and deletion: after `readonly PI=3.14159` or `declare -r VERSION=1.0`, reassigning yields a `readonly variable` error; `unset name` removes only the variable itself (affecting the current shell only), and if the variable was `export`ed, a subshell may still inherit it from elsewhere.

### 1.2 Why Double Quotes Are Recommended

Unquoted, a value containing spaces or wildcards gets split into several arguments by the shell or glob-expanded: with `file="my file.txt"`, `echo $file` looks fine but is already two words by the time it is passed to a command; with `files="*.txt"`, `echo $files` glob-expands to the actual file list. **Rule: write every variable reference as `"$var"`**, unless you specifically need word splitting (such as the special semantics of `"$@"` when iterating an array).

## 2. Data Types and Arrays

### 2.1 String Operations at a Glance

Strings are the most-used "type" in Bash, and all operations run through `${}` expansion: `${#str}` for length; `${str:0:5}` for 5 characters from position 0; `${str/World/Linux}` replaces the first occurrence and `${str//o/0}` replaces all; `${str#Hello }` strips a prefix and `${str% World}` strips a suffix. Memory aid: `#` before the variable name reads like "count from the front" (strip prefix), `%` like "percentage to finish" (strip suffix); `//` means replace all, a single `/` only the first occurrence. Single quotes do not expand variables (`'Hello $USER'` prints as-is), while double quotes do -- see [Bash Basics](./bash-basics.md).

```bash
$ str="Hello World"
$ echo "${#str}"                  # length -> 11
$ echo "${str:0:5}"               # substring -> Hello
$ echo "${str/World/Linux}"       # replace first occurrence -> Hello Linux
$ echo "${str//o/0}"              # replace all -> Hell0 W0rld
$ echo "${str#Hello }"            # strip prefix -> World
$ echo "${str% World}"            # strip suffix -> Hello
```

### 2.2 Indexed Arrays: Why You Must Write `"${arr[@]}"`

Array literals use parentheses: `fruits=("apple" "banana" "cherry")`. Get an element with `${fruits[0]}`, all elements with `${fruits[@]}`, the count with `${#fruits[@]}`, append with `fruits+=("date")`, and delete with `unset fruits[1]` (which leaves a hole). **Without braces and `@`, an array collapses to its first element; without quotes, spaces inside elements get split again**: with `files=("a b.txt" "c.txt")`, `echo $files` looks fine after word splitting but the arguments are already wrong, while `echo "${files[@]}"` prints each element as a separate word. Always use `"${arr[@]}"` for looping over arrays and for passing to functions.

```bash
$ fruits=("apple" "banana" "cherry")
$ echo "${fruits[0]}"            # -> apple
$ echo "${#fruits[@]}"           # number of elements -> 3
$ fruits+=("date")
$ echo "${fruits[@]}"            # -> apple banana cherry date
$ files=("my notes.txt" "c.txt")
$ printf '[%s]\n' $files         # unquoted: the spaced element is split again -> [my] [notes.txt] [c.txt]
$ printf '[%s]\n' "${files[@]}"  # correct: one word per element -> [my notes.txt] [c.txt]
```

### 2.3 Associative Arrays (Bash 4+)

After `declare -A user` you can assign with keys like `user[name]="John"`; `${user[name]}` gets a value, `${!user[@]}` gets all keys, and `${user[@]}` gets all values. Associative arrays require Bash 4.0+: the default bash on Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky 9 is 5.x, which satisfies the requirement; even the very old RHEL 6 (bash 4.1) supports it, but the bash 3.2 bundled with macOS cannot use it (these notes focus on Linux, so this is rarely a problem).

## 3. Environment Variables

The commonly read-only ones to observe are `$HOME`, `$USER`, `$SHELL`, `$PATH` (colon-separated command search path), `$PWD`, and `$LANG`. A plain assignment exists only in the current shell; after `export VAR="value"` the variable enters the "environment block", readable by any child process started from this shell (a script, an `ssh` remote command) -- this is the mechanism that lets a script pass arguments to the external commands it calls. To make it permanent, append the `export` line to `~/.bashrc` and run `source ~/.bashrc`; login shells, non-login interactive shells, and non-interactive shells read their config files in different orders, so a wrong edit "looks like it had no effect" -- start troubleshooting with `echo $PATH` to confirm the current session picked up the new value.

## 4. Special Variables and `$@` vs `$*`

These variables are maintained automatically by Bash: `$0` is the script name; `$1`-`$9` are the first nine arguments, and `${10}` and beyond must use braces (a bare `$10` parses as `$1` followed by the character `0`); `$#` is the argument count; `$?` is the exit status of the last command (**it reflects only the immediately preceding one** -- inserting any command in between overwrites it, so either test it immediately or capture it with `ret=$?`); `$$` is the current PID; `$!` is the PID of the last background process.

The difference between `$@` and `$*` only really appears **when double-quoted**: `"$@"` treats each argument as a distinct, complete word, while `"$*"` joins all arguments into a single word using the first character of `IFS` (a space by default). A demo script run on the two arguments `"a b"` and `"c"` prints `"$@"` as two words `<a b>` `<c>` and `"$*"` as one word `<a b c>`. **Always use `"$@"` when passing arguments to a function or command**; use `"$*"` only when you deliberately want to join several arguments into one log line or command string. Positional parameters are valid during a function call and revert on return -- see [Functions](./functions.md).

## 5. Variable Expansion and Default Values

`${name:-Anonymous}` uses a default when name is empty or undefined, without writing it back; `${name:=Anonymous}` also assigns the default to the variable; `${unset_var:?Variable not set}` reports an error and exits when the variable is undefined. Scripts commonly fall back to `:-` for optional parameters at the top, and use `:?` for critical variables that must fail immediately -- paired with `set -u` it is good defense. For arithmetic prefer the pure builtin `$((a + b))`, which needs no fork of an external process and no escaping of spaces; `let` works but assignment is less readable than `$(( ))`; `expr` is an external command that requires spaces, so use it only for compatibility with very old POSIX shells. `$(( age >= 18 ? 1 : 0 ))` supports the numeric ternary only; for a string result use `if`/`else` (see [Conditionals](./conditionals.md)).

```bash
$ a=15 b=7
$ echo $(( a + b ))              # 22
$ echo $(( a * b ))              # 105
$ echo $(( a % b ))              # modulo -> 1
$ echo $(( a > b ? a : b ))      # numeric ternary -> 15
$ (( a += 3 )) && echo "$a"      # assignment after arithmetic -> 18
```

## 6. Type Declarations

`declare -i num=10` declares an integer, and non-numeric values silently become 0 -- which looks convenient but means `num="10+5"` is evaluated as an arithmetic expression to 15, an unpleasant surprise when assembling logs. **Do not add `-i` to ordinary variables unless you specifically need it**; put arithmetic inside `$(( ))` instead. `declare -r` is readonly, `-a` an indexed array, `-A` an associative array, `-g` creates a global variable from inside a function, and `-p` prints a variable's full declaration (including type) -- during debugging `declare -p var` reveals "what it really is" far better than a bare `echo`.

## 7. Common Gotchas in This Chapter

1. **Spaces around the equals sign**. `a = 1` is not an assignment; it invokes a command called `a`. Write assignments flush: `a=1`.

2. **Referencing an array as just `$arr`**. `${arr}` equals `${arr[0]}` (the first element); iterating all requires `"${arr[@]}"`, and the count is `${#arr[@]}`.

3. **`$@` without quotes**. `f $@` splits arguments containing spaces; the correct form is `f "$@"`. Likewise, loop arrays with `for x in "${arr[@]}"`.

4. **Forgetting `local` inside a function**. A variable without `local` is global, so a same-named variable in the caller gets overwritten unexpectedly -- see [Functions](./functions.md).

5. **Checking `$?` one command too late**. `$?` reflects only the immediately preceding command; inserting anything in between overwrites it. Either test it immediately or capture it at once: `ret=$?`.

6. **Writing `${10}` as `$10`**. `$10` parses as `$1` followed by the character `0`. Arguments from the tenth onward must use braces.

7. **Capturing BASH_REMATCH with `=~` outside `[[ ]]`**. Regex match results live in the `BASH_REMATCH` array, but the match itself must happen inside `[[ ... =~ ... ]]`; see [Regular Expressions](./regex.md).

8. **Treating `local x=$(cmd)` as having checked `cmd`'s exit status**. `local` itself succeeds and overwrites `cmd`'s `$?`, so split it into two steps.

## References

- `man bash` -- Shell Variables, Arrays, Parameter Expansion
- Bash manual - Shell Variables -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Variables.html)
- Bash manual - Shell Parameters -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameters.html)
- Arch Wiki - Bash - Variables -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Variables and environment variables -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Variables -- [tldp.org](https://tldp.org/LDP/abs/html/variables.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [bash-basics](bash-basics.md)
- [examples](examples.md)
- [functions](functions.md)
- [userland](/source/userland.md)
