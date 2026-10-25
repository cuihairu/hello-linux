# Functions

A function is the basic unit for organizing code -- it packs a named, reusable piece of logic so you call it when needed instead of copy-pasting the same "check, delete, print" block. A shell function is essentially "a named sequence of commands", executed in the **current shell** (unlike an external command, which forks a child process), so it can directly modify the current shell's variables, change directory, and set `trap`. But "runs in the current shell" also brings two details that must be understood thoroughly: a variable without `local` pollutes the global namespace, and `return` can only carry an exit status (0-255), not a string -- to return data you have to `echo`, which leads straight into the classic pitfall of "return value and log output getting mixed". This chapter unfolds as "definition -> arguments -> return value -> scope -> recursion -> libraries -> practice -> common gotchas".

> Content draws on the Bash manual, the Arch Wiki, and the Advanced Bash-Scripting Guide; see the references at the end.

## What This Page Covers

- The two definition styles for functions and how to call them
- The meaning of positional parameters, `$#`, `"$@"`, and `shift` inside a function
- Telling `return` (exit status) and `echo` (data output) apart as the two kinds of "return value"
- Using `local` to bound scope, avoiding variable pollution and `local` swallowing an exit status
- Building a reusable function library

## 1. Why Functions Exist

Without functions, snippets like "check the file, log it, exit on failure" get copied all over the script; changing one spot means a global search-and-replace, and missing one is a latent hazard. A function **names** that logic once, so call sites keep only the intent (`log "start"`) and the details stay at the definition. Two further engineering reasons: **scope isolation** -- `local` makes temporary variables die on use, without clashing with the main logic; and **testability** -- once pure logic is extracted into a function, drive it with a few lines of `echo` to verify it before wiring in real data.

A shell function differs from C/Python functions in one key way: it has **no separate return-value channel**. `return` is reserved for exit statuses (the same semantics as a command's `$?`), and data can only travel on stdout, captured by `$( )`. Once you internalize that, every "return-value pitfall" below falls into place.

From an engineering-rhythm standpoint, a function is also the smallest unit of "write then test": rather than waiting until the whole script is done and then tracing it end to end with `bash -x`, drive each extracted function through its boundary inputs (empty string, missing argument, illegal number) and fix the error at the point of definition. Once the logic is librarized, several scripts share the same fix and regression cost drops from "change N places" to "change 1 place + full shellcheck". Conversely, if a piece of logic is never called from a second place and never needs standalone testing, do not force it into a function just so it "looks like architecture" -- over-splitting makes the control flow jump around the file, and whoever reads the script has to flip pages to piece the whole picture together.

## 2. Definition and Call

Defining a function is like giving a run of commands an alias, but unlike `alias`: a function has its own argument list and exit status, can use `local`, can be analyzed per-function by `shellcheck`, and can live in a library file for reuse. Bash accepts two syntaxes whose everyday semantics are nearly identical; the differences are mainly in compatibility and a few builtin behaviors.

Two equivalent forms:

```bash
# Style 1 (POSIX-compatible, recommended)
greet() {
    echo "Hello, World!"
}

# Style 2 (bash extension)
function greet {
    echo "Hello, World!"
}

greet    # call: like running an ordinary command, no parentheses needed
```

**Why style 1 is recommended**: it is the POSIX form, parsed by both `sh` (dash) and `bash`; style 2 is a historical Bash extension, and a function defined with `function` keeps its function attribute until `unset -f`, which gets fiddly when migrating across shells. Unless your team mandates otherwise, standardize on `name() { ...; }`.

Under `declare -f name` the two forms show an essentially identical body; the difference is mainly in the parse stage and portability. For everyday scripts style 1 has a practical bonus: shellcheck, editor highlighting, and the "recognizable at a glance like C" quality are all more reliable. If a library you maintain must also be loaded by `#!/bin/sh`, style 2 is a straight syntax error -- one of the most innocent-looking ways a script fails during cross-machine distribution.

**A function must be defined before it is called**: the shell interprets line by line, so calling a function that is not yet defined yields `command not found` outright. Put definitions at the top of the script, or gather them all in a library file and `source` it.

On call the parentheses after the function name can be omitted; arguments are word-split on whitespace just like command-line arguments, so arguments containing spaces must be quoted. A function can recurse, call external commands, and end early with `return` -- the only difference from an ordinary command is that it runs in the current shell, and `$1` is valid only for the duration of that call, reverting to the caller's positional parameters on return. This matters especially with nested calls: an inner function's `shift` does not touch the outer `$@`.

## 3. Arguments: The Same Positional Parameters as a Script

The actual arguments passed to a function are read inside the body via `$1`, `$2`, ... -- the same implementation as the script entry point, with no second set of rules for a "function version" of positional parameters. The benefit is one mental model only: if you can write `main` you can write any function; the cost is that positional parameters are **call-time** state, so with nested calls or `source` you must know whose stack frame you are in.

Inside a function the positional parameter mechanism is identical to the script's: `$1`, `$2`, ..., `$#`, `$@`, `$*`. Arguments passed on call are **valid only while the function runs**, and revert to the outer ones on return -- the easiest thing to confuse with global variables.

```bash
greet() { echo "Hello, $1!"; }
greet "John"                    # Hello, John!

add() {
    local sum=$(( $1 + $2 ))
    echo "sum: $sum"
}
add 10 20                       # sum: 30

print_args() {
    echo "arg count: $#"
    printf '  <%s>\n' "$@"
}
print_args "a" "b c" "d"
```

```text
arg count: 3
  <a>
  <b c>
  <d>
```

**When passing any number of arguments to a function, always expand `"$@"` inside** (see [Variables and Data Types](./variables.md)): `"$@"` keeps each argument a distinct word, so arguments with spaces are not split apart. When you need "the first argument is a command, the rest forward to it", pop the first argument off with `shift`; the remaining `"$@"` is exactly the forwarding list -- far safer than string-concatenating into `eval`:

```bash
run_all() {
    local cmd=$1
    shift
    "$cmd" "$@"
}
run_all echo hello "world with space"    # prints two words, spaces preserved
```

## 4. Return Values: return vs echo

This is the most important fork in function design: **a Bash function has two ways to "bring something out", with completely different semantics**. Treating `return` as C's `return expr` and expecting it to carry a number or string back to the caller is the most frequently stepped-in pitfall -- Bash has no such channel, oversized numbers get modulo-reduced, and strings are a straight syntax/semantic error. Get this right first: decide whether the caller needs "success or failure" (`return`/`$?`) or "a piece of data" (`echo` + `$( )`). Sections 4.1-4.3 unpack them in turn.

### 4.1 `return`: Exit Status Only

`return N` requires `N` to be an integer in 0-255; `return 300` actually stores `300 % 256 = 44`. The convention matches command exit statuses: **0 = success/true, non-0 = failure/false**. With no `return` written, the exit status is that of the **last command**. `return` only makes sense inside a function (or to end a `source` load); at script top level it is equivalent to `exit`.

Think of the exit status as the function's boolean: `if is_even 4; then` does not care what the function wrote to stdout (it wrote nothing here), only about `$?`. When you need both "decide success" and "bring data back", the convention is: on success `echo` the data and `return 0`; on failure `return 1` (optionally printing the reason to stderr); the caller does the `if` first, then `$( )`, or uses the two-step "capture first, check `$?` after". Never use values like `-1`/`256` as a "special success" -- after modulo they collide with other semantics.

```bash
is_even() {
    if (( $1 % 2 == 0 )); then
        return 0
    else
        return 1
    fi
}

if is_even 4; then echo "even"; else echo "odd"; fi
if is_even 5; then echo "even"; else echo "odd"; fi
```

```text
even
odd
```

### 4.2 `echo`: For Returning Data

Data travels on stdout and the caller captures it with `$(add 10 20)`. This is the only ordinary way for a Bash function to return a string, number, or multi-line text. `echo` behavior varies subtly across shells (whether `\n` is interpreted, whether a trailing newline is added by default); when you need exact formatting prefer `printf '%s\n' "$data"` -- mixing the two in a script is easy to trip over on some distro's `sh` compatibility layer.

Multi-line data goes on stdout the same way: `$(get_lines)` strips the trailing newline but preserves internal ones; if the caller must keep exact bytes (e.g. binary or trailing blank lines), pass them through a file or temp directory instead of `$( )`. `echo` returning an "empty string" and "the function failed" are indistinguishable in result, so express failure with `return`.

### 4.3 Classic Pitfall: Mixing Return Data and Log Output

Once a function is captured by `$( )`, **everything written to stdout enters the result**. The wrong demonstration is `echo "searching..."` inside the function as a progress notice -- that line quietly becomes part of the return value, and the caller gets "a few extra lines of dirty data" with little way to trace why.

The correct posture is **data on stdout, notices and errors always `>&2` to stderr**:

```bash
get_file() {
    echo "searching..." >&2      # log -> stderr
    echo "$found_file"           # data -> stdout
}

path=$(get_file 2>/dev/null)     # data only
path=$(get_file 2>&1 >/dev/null) # log only (less common)
```

When you need to return several values at once, instead of concatenating a delimited string and splitting it back on `IFS`, use a convention of **named global variables** (knowing before the call which names will be written), or write into an array name passed in by the caller. This date-parsing example returns three fields:

```bash
parse_date() {
    local text=$1
    if [[ $text =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})$ ]]; then
        DATE_YEAR=${BASH_REMATCH[1]}
        DATE_MONTH=${BASH_REMATCH[2]}
        DATE_DAY=${BASH_REMATCH[3]}
        return 0
    fi
    return 1
}

if parse_date "2026-09-22"; then
    echo "$DATE_YEAR/$DATE_MONTH/$DATE_DAY"
fi
```

```text
2026/09/22
```

Success is still expressed with `return`, and the data travels via the global convention -- separation of duties, so the caller can branch naturally with `if parse_date ...; then`.

## 5. Local Variables and Scope

Shell variables have **no** function-level isolation by default: whoever assigns writes global (or the existing `local` in the current scope). This is the opposite of nearly every modern language, and it is the breeding ground for "works when I run it alone, blows up in the big script" bugs. `local` is the only scope declaration, and it must be used before assignment and inside the function body; using `local` outside a function is an error.

### 5.1 Why `local` Is Mandatory

A bare assignment inside a function writes a **global** variable by default. If it shares a name with the caller's, the caller's value is silently overwritten -- the failure point (library function) and the symptom point (main logic) are worlds apart, making this one of Shell's stealthiest bug sources.

```bash
name="outer"
show() {
    local name="inner"
    echo "inside: $name"
}
show
echo "outside: $name"
```

```text
inside: inner
outside: outer
```

Remove `local` and the second line becomes `inner` -- the main logic's `name` is polluted. **Rule: every variable defined inside a function is `local`**, unless you deliberately want to change global state (and should say so in a comment).

### 5.2 The Scope Chain

A function can **read** outer global variables; assigning without `local` **modifies** them; `local` creates a new variable visible only within this call stack, destroyed on return. Bash's `local` has only one level (function-level) and no block scope -- a `local` declared inside an `if` or `for` is still function-level and visible throughout the whole function body.

Read globals, write `local` is the default safe mode; "deliberately writing a global" should use an explicit name and be concentrated in a few lines at the end of the function, easy to grep. With nested calls, does an inner function's `local` not shadow the **read** path of an outer same-named `local`? It does -- once an inner `local x` is declared, all reads and writes of `$x` inside the inner function refer to the inner copy, and the outer copy survives only outside the inner scope. This is also why a library function cannot assume "the caller must have a variable called `tmp`".

### 5.3 Side Effects of `local`

`local out=$(cmd)` assigns the **command substitution's exit status** to `local` itself (`local` succeeds, i.e. 0), thereby **swallowing `cmd`'s failure**:

```bash
# Dangerous: cp failure goes undetected
f() {
    local out=$(cp a b)
    return $?          # always local's 0
}

# Correct: declare local first, then assign
f() {
    local out
    out=$(cp a b) || return $?
}
```

With `set -e` and `pipefail` in play these bugs are extremely hard to spot -- pay extra attention when writing library functions; shellcheck has warnings for this.

Kindred traps include `local x=$y` and multi-variable `local`: in `local a b=$1`, a missing `$1` blows up outright under `set -u`, and the evaluation order of `local a= b=$1` plus whether `local` counts as an "assignment" at all both affect whether `set -e` fires. The conservative style is: **separate declaration from assignment, handle one variable at a time, and always put an explicit `|| return` on a suspicious command**. One more point: `local` cannot be combined with `export`; `local -n` (a reference) is Bash 4.3+'s nameref, and in the wrong context it lets a same-named variable "punch through" to the caller, showing up during debugging as "I changed the local but the global moved".

## 6. Recursive Functions

Factorial and Fibonacci are the textbook examples: the base case returns with `return`/`echo`, and the recursive step stores the sub-result in a `local` and combines it. Both work, but be clear on the cost: **every recursion launches a subshell via `$( )`**, far more expensive than C/Python; `fibonacci(30)` slows down noticeably and may hit stack depth limits.

In production scripts prefer rewriting the recursion as a loop + array (dynamic programming takes two lines); keep recursion for teaching or very shallow depth (e.g. walking a directory tree with a depth cap). If you do keep the recursion, add a depth guard so `$( )` expansion cannot nest infinitely on pathological input.

One more detail in the recursion-`local` interplay: every level of the call creates its own copy of the `local`, and levels do not overwrite each other -- which is exactly why recursion can combine sub-results correctly. If some level forgets `local` and writes a global, the previous level's result gets clobbered by the next, and the symptom is usually a hard-to-trace pattern like "even levels correct, odd levels all wrong". When debugging deep recursion, `set -x` to see each call's arguments and return before adding dozens of `echo` lines, then decide whether the rewrite to a loop is worth it.

## 7. Function Libraries and source

Extract generic functions (logging, errors, dependency checks) into a separate file shared by several scripts. The library file is not executed directly; the main script uses `source` to "inject" the function definitions into the current shell -- `source file` (or the POSIX spelling `. file`) runs `file` line by line in **the current shell**, so the function definitions in it stick around and later calls are indistinguishable from local definitions. Compared with forking an external script and then parsing its output, `source` uses zero processes and can modify the current shell's state directly (which is also why it carries side-effect risk).

Recommend hard-coding the boundary between library files and executable scripts into the convention: a library file has no `#!/bin/bash` executable entry, takes no command-line arguments, and does not run business logic when sourced (at most "idempotent default initialization"). That way `source ./lib.sh` is always safe and never triggers a half-executed business path.

The main script locates the library file with `${BASH_SOURCE[0]}`, avoiding dependence on the caller's current directory -- invoking the script from another directory, a bare `source ./mylib.sh` cannot find the file. A `# shellcheck source=mylib.sh` comment lets static checking analyze across files. Typical library members: timestamped `log`/`error` (errors to stderr), `check_root` verifying `EUID`, `require_cmd` probing dependencies with `command -v`.

`source` takes effect in the current shell, so any `alias` and variables in the library also stick around -- if you only want to load functions and not the side effects, keep the library file "defines functions only, performs no actions".

## 8. Callbacks and Higher-Order Usage

Shell has no first-class function objects -- you cannot put a function in a variable and pass it as a value (from Bash 4.4 `name=func; $name` works awkwardly, but portability is poor and a "closure with parameters" cannot be expressed directly). But a **function name string** is enough for simple callbacks: pass `on_success`/`on_failure` as arguments and do `if "$operation"; then "$success_cb"; else "$failure_cb"; fi` inside. Note the callback call must be quoted `"$cb"`, and if `operation` is a "command + arguments" string, a bare `$operation` word-splits -- the safer form is the same as `run_all` in section 3, forwarding with `"$@"`.

The value of the callback pattern is pulling "what to do on success, what to do on failure" out of the main flow: the main function only "tries once", while notifying, retrying, and alerting are injected by the caller. The same `with_retry`/`do_operation` can then be swapped for a printing function in tests and an alerting function in production, without copy-paste branch editing. When designing library functions, any "if success then A else B" where A/B varies by context is worth extracting into a callback parameter.

Paired with callbacks is a "hook array" form: `HOOKS+=(on_start on_mid)`, and the main flow does `for h in "${HOOKS[@]}"; do "$h" || return; done`. The upside is registering multiple callbacks while keeping the `"$@"`-safe expansion; the downside is that execution order and failure policy (stop on who fails, or continue) must be written into the docs, otherwise callers get tripped up at 3 a.m. by a silently swallowed hook. Callbacks and hooks are both "convention in place of a language feature"; once the convention is written into the top comment of `lib.sh`, it is far safer than an implicit global variable.

## 9. Practical Function Set

Three functions cover the most frequently reused capabilities of an ops library; each is explained below in terms of "why designed this way, where the boundaries are", and the code skeletons can be copied straight into `lib.sh` and then filled in with tests per team convention.

**Logging**: use an associative array for level filtering (Bash 4+, satisfied by the three distro families by default), `tee -a` to write to both file and terminal, and wrap the whole thing in `>&2` so the business data captured by `$( )` stays clean. Levels run from DEBUG to ERROR; anything below `LOG_LEVEL` simply `return`s without printing. Associative arrays require Bash 4; if you also need compatibility with the Bash 3.2 bundled on macOS, map levels to numbers with a `case` instead -- no need to pull in an external `logger`.

**Retry**: the `retry max delay cmd...` pattern -- after `shift 2`, `"$@"` is exactly the full command; inside the loop, `"$@"` succeeding `return 0`s, failing sleeps then continues; exhausting the count `return 1`s with an error log. Safer than concatenating commands into `eval`, this is the standard wrapper for flaky-call interfaces like `curl` and `ssh`. If the delay needs backoff (the nth sleep doubles), use `delay=$((delay * 2))` before the sleep and cap it, to avoid an uninitialized or astronomical sleep under `set -u`.

**Config parsing**: read the file with `while IFS= read -r line`, skipping blank lines and comments, use `[[ =~ ]]` to recognize `[section]` and `key=value`, take the key and value from `BASH_REMATCH` and `printf` `section.key=value`. Note the `read` template needs the `|| [[ -n $line ]]` guard for a last line without a newline; the regex dialect is ERE, see [Regular Expressions](./regex.md). INI is not a strict standard; this implementation covers only the common subset with no nesting and no multi-line values. For full semantics use `crudini` or switch to JSON + `jq`.

These three functions correspond to "observability", "reliability", and "integration"; nearly every ops script library contains them, so copy them straight into your own `lib.sh`. Acceptance is not "it looks right" -- it is: after logging goes to stderr, `x=$(f)` is still clean; `retry` really sleeps three times on three mocked failures and then returns 1; config parsing does not blow up on a missing final newline, comment lines, or blank lines.

## 10. Common Gotchas in This Chapter

Function-related failures mostly share a signature: **the definition looks perfectly correct, and what actually breaks is invisible global state or a subshell**. When triaging, reach for `set -x` to see expansions and `declare -p` to see current variable values before touching logic. The nine below are ordered by frequency; pin them into your code review checklist.

1. **Forgetting `local`**. A bare assignment inside a function overwrites a same-named global; especially dangerous in library functions. Default: `local` on every local variable.

2. **`return` with a value over 255**. Silently modulo-reduced, so the caller gets an unexpected code. Return data with `echo` instead.

3. **Data and logs both on stdout**. `x=$(func)` captures every `echo` inside the function. Notices and errors always go `>&2`.

4. **`local out=$(cmd)` swallows the exit status**. `local`'s own success overwrites `cmd`'s `$?`. Assign in two steps, or `local out; out=$(cmd) || return $?`.

5. **Calling before defining**. The script runs line by line, so the function definition must come before the call (or live in a sourced library).

6. **Recursion too deep or perf collapse**. Bash forks a subshell for every recursive level; deep recursion should become a loop + array.

7. **`source` relative path depending on cwd**. Locate the library with `${BASH_SOURCE[0]}`, otherwise calling the script from another directory cannot find it.

8. **Using `eval`-concatenated commands for "argument forwarding"**. Always `"$cmd" "$@"` + `shift`, avoiding injection and quote hell.

9. **Giving a positional parameter and a global variable the same name**. Inside a function `$1` shadows the outer one; while debugging, `set -x` to see expansions, or use a more specific global name.

## Chapter Summary

A function is the smallest means of turning "named logic" into a reusable asset. The chapter's core compresses into three sentences: **define in POSIX style, always pass arguments with `"$@"`, and let data travel on stdout via `echo` while `return` only expresses success or failure**. `local` handles isolation, `source` handles sharing, and callbacks inject policy in a language without closures.

Default discipline when writing library functions: do not mutate the caller's global variables (unless the docs say so), do not log to stdout, do not depend on the cwd at call time, and always `return` non-zero on the failure path. A function meeting these four gets sourced by a second script from `lib.sh` and usually needs not a single line changed.

Self-check list (pasteable into a PR template): are all new variables `local`; does the `$(func)` capture result contain leaked debug output; is `local out=$(cmd)` rewritten as a two-step assignment; is the library path located via `${BASH_SOURCE[0]}`; is `shellcheck -x` at zero errors. Merging only when all five are green saves far more trouble than chasing an "even levels all wrong" result after release.

Next, string this chapter's functions together with [Text Processing](./text-processing.md) and [Script Debugging](./debugging.md): wrap `grep`/`awk` inside functions, hold the line on regressions with `set -x` and shellcheck, and end up at the complete script skeletons in [Practical Examples](./examples.md).

## References

- `man bash` -- Shell Functions (the authoritative source for builtin commands and the semantics of `local`/`return`)
- Bash manual - Shell Functions -- [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Functions.html)
- Arch Wiki - Bash -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash) (maintainer notes on functions, arrays, and common gotchas)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Functions -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Functions -- [tldp.org](https://tldp.org/LDP/abs/html/functions.html)
- Google Shell Style Guide - Function Libraries -- [google.github.io](https://google.github.io/styleguide/shellguide.html)
- ShellCheck wiki -- trigger conditions and fix examples for local variables, exit statuses, and `local`-related warnings

All examples in this chapter are written for Bash 4+ (the three distro families by default); to stay compatible with the Bash 3.2 bundled on macOS, associative arrays, `mapfile`, and some `[[ ]]` extensions must be rewritten into `case`/`while read` equivalents, with a version gate via `BASH_VERSINFO` at the top of the script. Before cross-distro distribution, run `bash -n` and shellcheck once against each of the three `bash` versions -- far more reliable than a single pass on the dev box.

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [debugging](debugging.md)
- [examples](examples.md)
- [variables](variables.md)
