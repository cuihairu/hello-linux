# Regular Expressions

A regular expression (regex, for short) is a mini-language that uses a set of special symbols to describe "text patterns", widely used by tools such as `grep`, `sed`, `awk`, `[[ =~ ]]`, and `find -regex`. It is powerful but also easy to trip over; **the root cause is that the same "looks identical" syntax actually belongs to three dialects**: BRE (basic regex), ERE (extended regex), and PCRE (Perl-compatible regex). `a+` means "one or more a" in ERE, while in BRE `+` is an ordinary character; `\d` is only recognized by PCRE, and `grep` does not accept it by default. Pick the wrong dialect and, at best, nothing matches, or at worst you mistake a "partial match" for "validation passed". This chapter lays out the differences among the three and which tools use which, and gives patterns you can drop straight into a script.

> Content draws on the PCRE manual, regular-expressions.info, and the relevant man pages; see the references at the end.

## What This Page Covers

- Telling apart the syntax differences of BRE, ERE, and PCRE and which tools use them
- Knowing how metacharacters, quantifiers, groups, and anchors are written in each dialect
- Choosing the right dialect switch in `grep`/`sed`/`awk`/`[[ =~ ]]`
- Understanding greedy matching and backtracking
- Knowing about performance traps and how to debug

## 1. Three Dialects and Tool Mapping

| Dialect | Typical switch | Grouping | `+` `?` `\|` | Common tools |
|------|---------|------|--------------|---------|
| BRE | `grep` default, `sed` default | `\(\)` | must escape: `\+` `\?` `\|` | `grep`, `sed`, `ed` |
| ERE | `grep -E`, `sed -E` | `()` | use directly: `+` `?` `\|` | `grep -E`, `sed -E` |
| PCRE | `grep -P` | `()` and more | same as ERE + `\d \w \s`, lookarounds | `grep -P`, `rg` |

**Memory aid and how to choose**: for new code **prefer ERE** (`grep -E`, `sed -E`) -- grouping and quantifiers need no escaping and are the most readable. When you need `\d`, `\w`, non-greedy `*?`, or lookaround assertions, use **PCRE** (`grep -P`); note that not every system is compiled with PCRE support (`grep -P` reporting `unrecognized` means it is not enabled; GNU grep on Arch/Debian and newer RHEL usually has it, but a script should still detect it). **BRE is the historical default**; do not choose it deliberately -- just be able to recognize `\(...\)` and `\+` in older material. `awk`'s dynamic regex is its own thing, close to ERE, but without the advanced features of `grep -P`.

The same "one or more o" is written `'go\+d'` in BRE and `'go+d'` in ERE/PCRE -- get the dialect switch wrong and the match results are completely different.

```bash
$ printf 'god\ngood\ngoood\n' > words.txt
$ grep -n 'go\+d' words.txt        # BRE: \+ is the quantifier
1:god
2:good
3:goood
$ grep -nE 'go+d' words.txt        # ERE: + used directly
1:god
2:good
3:goood
$ grep -n 'go+d' words.txt         # in BRE + is a literal, almost no match
# (no output)
$ grep -nE 'a{3}' <<< 'aaaa'       # in ERE braces need no escaping
aaaa
$ grep -n 'a\{3\}' <<< 'aaaa'      # in BRE braces need escaping
aaaa
```

## 2. Metacharacters: A Three-Dialect Comparison

### 2.1 Common Metacharacters (identical in all three)

`.` matches any single character (except a newline); `*` the preceding character 0 or more times; `^` start-of-line anchor; `$` end-of-line anchor; `[...]` character class; `[^...]` negated class; `\` escapes a metacharacter (write `\.` for a literal dot). Typical BRE/common uses: `^[0-9]` starts with a digit, `^$` a blank line, `\.com` the literal `.com`, `[^a-z]` contains a non-lowercase letter.

### 2.2 Quantifiers: BRE escapes them, ERE/PCRE use them directly

ERE/PCRE: `x+` one or more, `x?` zero or one, `x{n}` exactly n, `x{n,}` at least n, `x{n,m}` n to m, `foo|bar` or. BRE must write `x\+`, `x\?`, `x\{n\}`, `foo\|bar` (both braces and the plus/question need a backslash). Grouping is `()` in ERE/PCRE and `\(\)` in BRE; when substituting, `sed -E` references groups with `\1`, and `&` stands for the whole match. Examples: `grep -E 'a{3}'` matches exactly three a's; `sed -E 's/([a-z]+) ([a-z]+)/\2 \1/'` swaps the positions of two words.

### 2.3 PCRE-only Features

Shorthand classes: `\d` digit, `\w` word character, `\s` whitespace (PCRE and some tools only; in ERE write `[0-9]` etc.). Zero-width assertions: `(?=bar)` lookahead (a foo immediately followed by bar), `(?<=foo)` lookbehind (a bar immediately preceded by foo), `(?!baz)` negative lookahead -- assertions only check a position; the checked content is not counted as part of the matched text. Non-greedy: `*?`, `+?` consume as few characters as possible (`<.+?>` matches a single tag rather than a whole block). **Why are assertions zero-width**: for the case of "I want foo but only when it is followed by bar, and the match result must not include bar".

## 3. Greedy Matching, Backtracking, and Performance

The regex engine is **greedy** by default: quantifiers consume as many characters as possible and backtrack to give them back on failure. Backtracking is the source of power and the source of performance disaster -- nested quantifiers can expand exponentially (catastrophic backtracking). Greedy vs non-greedy: `<.*>` eats from the first `<` to the last `>`, while `<.*?>` eats only the first tag.

For performance: narrow with anchors `^` `$` wherever you can so the engine does not try from every position; for large files prefer `grep -F` fixed strings or `grep -E` simple patterns, and reach for `-P` last; avoid nested quantifiers like `(a+)+b`; PCRE has atomic groups `(?>...)` to lock backtracking, but the GNU grep case rarely needs it. Verify on a small sample with `grep -c` first, then run the whole thing.

## 4. Using Regex in Bash

`[[ $email =~ regex ]]` uses the **ERE** dialect. **Key rule**: the regex on the right **must not be quoted** -- quoting it turns it into a literal whole-string match; and you cannot build the regex from a variable inside the quotes (store it first with `re=$pattern`, then `[[ $s =~ $re ]]`). An email-validation example uses `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`, printing "valid email" when it matches.

Capture groups are stored in the `BASH_REMATCH` array (index 0 is the whole match): for "deployed on 2026-09-22", match with `([0-9]{4})-([0-9]{2})-([0-9]{2})`, and `${BASH_REMATCH[1]}` is the year, `[2]` the month, `[3]` the day. Wrap it into predicate functions like `is_uint`, `is_ipv4`, `is_cn_mobile` and call them directly in an `if`.

```bash
$ email="alice@example.com"
$ if [[ $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
>     echo "valid email"
> else
>     echo "invalid email"
> fi
valid email
$ s="deployed on 2026-09-22"
$ if [[ $s =~ ([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
>     echo "year=${BASH_REMATCH[1]} month=${BASH_REMATCH[2]} day=${BASH_REMATCH[3]}"
> fi
year=2026 month=09 day=22
$ re='^[0-9]+$'                     # store the regex in a variable first, then reference it
$ [[ 12345 =~ $re ]] && echo all digits
all digits
```

**Validation is not full legality**: `[0-9]{1,3}` lets `999.999.999.999` through; strict IP validation needs a numeric check per octet. When writing validators, be explicit about "how much looseness the business can accept" -- do not treat a demo regex as an RFC implementation. The word boundary `\b` (supported by GNU/ERE/PCRE) avoids `cat` matching inside `concatenate`.

## 5. Regex in sed/awk

`sed` defaults to BRE; `-E` switches to ERE: `sed -n '/error/p'` and `sed -n -E '/error|warn/p'`. `awk` dynamic regexes use slash literals or strings: `/error/`, `$0 ~ /timeout|refused/`, `BEGIN {pat="^GET"} $0 ~ pat`. Mind the meaning of `&` and `\1` in sed replacement strings -- `grep` only matches and never replaces, so only sed has the notion of "referencing the match during replacement".

```bash
$ echo 'hello world' | sed -E 's/([a-z]+) ([a-z]+)/\2 \1/'   # swap two words
world hello
$ echo 'price: 42 USD' | sed -E 's/[0-9]+/[amount]/'           # replace numbers
price: [amount] USD
$ echo 'user=admin' | sed -n 's/^user=//p'                   # extract the value
admin
$ sed -E 's|http://|https://|g' <<< 'http://a.example http://b.example'
https://a.example https://b.example
```

Matching Chinese needs PCRE: `grep -P '[\x{4e00}-\x{9fa5}]'`; the POSIX character class `[:alpha:]` does not recognize CJK, and a plain `[` range does not cover the whole CJK block either. When handling UTF-8 Chinese, ensure the locale is correct, or `.` and character classes are treated by byte rather than by character.

## 6. Debugging Regex

Try the minimum sample on the command line quickly: `echo "test123" | grep -oE '[0-9]+'`, `sed -E 's/[0-9]+/#/'`, `awk '{gsub(/[0-9]+/,"#"); print}'`. GNU grep also has `-d e` to treat a file as data and show the engine's matching process (less common). For online tools, [regex101.com](https://regex101.com/) -- make sure to pick the right flavor (Grep/PCRE/JavaScript, etc.); [regexr.com](https://regexr.com/) is good for visual explanations.

**Suggested debugging order**: first build a minimal sample with `echo`/`printf` -> pick the right flavor (ERE/PCRE) -> check whether it is a whole-string match or a substring match -> only then hook up the large file.

## 7. Common Gotchas in This Chapter

1. **Dialects confused**. The `+` in `grep 'a+'` is a literal (BRE); for ERE use `grep -E 'a+'`. `{3}` must be written `\{3\}` in BRE. **New code: always `grep -E` / `sed -E`**.

2. **`grep -P` unavailable on the target machine**. Some minimal systems / old grep are not compiled with PCRE, so `grep -P` errors out. Probe for it first in a deploy script, or replace shorthands like `\d` with `awk`/`sed` ERE (write `[0-9]`).

3. **Quotes around the right side of `[[ =~ ]]`**. `[[ $s =~ "^abc$" ]]` becomes a literal comparison and almost always fails. Do not quote the regex, or store it in a variable first and use `[[ $s =~ $re ]]`.

4. **Forgetting to escape the dot `.`**. `grep '.txt'` matches `atxt` and `a-txt`. Write `\.` for a literal dot (inside single quotes).

5. **Using a regex for "whole-line validation" without anchors**. A `grep '[0-9]*'` missing `^$` matches empty and always succeeds. Validation must be anchored at both ends.

6. **Greedy matching grabbing HTML/quotes**. `".*"` eats from the first quote to the last quote. Use non-greedy `".*?"` (PCRE) or `[^"]*`.

7. **Copying syntax straight from `sed` into `grep` or vice versa**. sed's `&` and `+` (GNU sed ERE) mean something different from `grep`; use `sed` for replacement and `grep` for filtering -- do not mix them.

8. **Expecting `.` or `[[:alpha:]]` to cover Chinese**. POSIX character classes do not recognize CJK; use `grep -P '[\x{4e00}-\x{9fa5}]'`.

## References

- `man 7 regex` -- an overview of POSIX regex semantics
- `man grep`, `man sed`, `man pcre2pattern`
- regular-expressions.info -- [regular-expressions.info](https://www.regular-expressions.info/)
- PCRE2 documentation -- [pcre.org](https://pcre.org/)
- GNU Grep manual - Regular Expressions -- [gnu.org](https://www.gnu.org/software/grep/manual/)
- GNU Sed manual - Regular Expressions -- [gnu.org](https://www.gnu.org/software/sed/manual/)
- Arch Wiki - Bash - Conditions (`=~`) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Regular Expressions -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- regex101 online debugging -- [regex101.com](https://regex101.com/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [conditionals](conditionals.md)
- [examples](examples.md)
- [functions](functions.md)
- [text-processing](text-processing.md)
- [variables](variables.md)
