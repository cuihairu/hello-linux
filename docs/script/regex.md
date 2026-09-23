# 正则表达式

正则表达式（regular expression，简称 regex）是用一套特殊符号描述「文本模式」的微型语言，广泛用于 `grep`、`sed`、`awk`、`[[ =~ ]]`、`find -regex` 等工具。它强大但也极易踩坑，**最大根源是同一套「看起来一样」的语法其实分属三个方言**：BRE（基础正则）、ERE（扩展正则）、PCRE（Perl 兼容正则）。`a+` 在 ERE 里表示「一个或多个 a」，在 BRE 里 `+` 是普通字符；`\d` 只有 PCRE 认，`grep` 默认不认。选错方言，轻则匹配不到，重则把「部分匹配」误当成「验证通过」。本章讲清三者区别与工具对应，并给出可直接用于脚本的模式。

> 内容参考自 PCRE 手册、regular-expressions.info 和各工具 man 手册，见文末参考资料。

## 学习目标

- 分清 BRE、ERE、PCRE 的语法差异与适用工具
- 掌握元字符、量词、分组、锚点在三种方言下的写法
- 会在 `grep`/`sed`/`awk`/`[[ =~ ]]` 间正确选择方言开关
- 理解贪婪匹配与回溯，会写常见验证与提取模式
- 了解性能陷阱与调试方法

## 1. 三种方言与工具对应

| 方言 | 典型开关 | 分组 | `+` `?` `\|` | 常见工具 |
|------|---------|------|--------------|---------|
| BRE | `grep` 默认、`sed` 默认 | `\(\)` | 需转义：`\+` `\?` `\|` | `grep`、`sed`、`ed` |
| ERE | `grep -E`、`sed -E` | `()` | 直接用：`+` `?` `\|` | `grep -E`、`sed -E` |
| PCRE | `grep -P` | `()` 及更多 | 同 ERE + `\d \w \s`、断言 | `grep -P`、`rg` |

**记忆与选择**：日常新写**优先 ERE**（`grep -E`、`sed -E`）——分组和量词不用转义，可读性最好。需要 `\d`、`\w`、非贪婪 `*?`、前后 lookaround 断言时用 **PCRE**（`grep -P`）；注意不是所有系统都编译了 PCRE 支持（`grep -P` 报 `unrecognized` 即未启用，Arch/Debian/较新 RHEL 的 GNU grep 通常可用，仍建议脚本里检测）。**BRE 是历史默认**，不主动选；遇到老教程里的 `\(...\)`、`\+` 能认出来即可。`awk` 的动态正则自成一派，接近 ERE，但没有 `grep -P` 的高级特性。

同一个「一个或多个 o」，BRE 写 `'go\+d'`，ERE/PCRE 写 `'go+d'`——方言开关一错，匹配结果天差地别。

```bash
$ printf 'god\ngood\ngoood\n' > words.txt
$ grep -n 'go\+d' words.txt        # BRE: \+ 才是量词
1:god
2:good
3:goood
$ grep -nE 'go+d' words.txt        # ERE: + 直接用
1:god
2:good
3:goood
$ grep -n 'go+d' words.txt         # BRE 里 + 是字面量, 几乎匹配不到
# (无输出)
$ grep -nE 'a{3}' <<< 'aaaa'       # ERE 花括号不用转义
aaaa
$ grep -n 'a\{3\}' <<< 'aaaa'      # BRE 花括号要转义
aaaa
```

## 2. 元字符：三种方言对照

### 2.1 通用元字符（三方言一致）

`.` 匹配任意单个字符（不含换行）；`*` 前一字符 0 次或多次；`^` 行首锚点；`$` 行尾锚点；`[...]` 字符集合；`[^...]` 集合取反；`\` 转义元字符（字面量点写 `\.`）。典型 BRE/通用用法：`^[0-9]` 以数字开头，`^$` 空行，`\.com` 字面量 `.com`，`[^a-z]` 含非小写字母。

### 2.2 量词：BRE 要转义，ERE/PCRE 直接用

ERE/PCRE：`x+` 一次或多次，`x?` 零或一次，`x{n}` 恰好 n 次，`x{n,}` 至少 n 次，`x{n,m}` n 到 m 次，`foo|bar` 或。BRE 对应要写 `x\+`、`x\?`、`x\{n\}`、`foo\|bar`（花括号和加问号都要反斜杠）。分组在 ERE/PCRE 是 `()`，BRE 是 `\(\)`；替换时 `sed -E` 的 `\1` 引用分组，`&` 表示整个匹配。示例：`grep -E 'a{3}'` 匹配恰好三个 a；`sed -E 's/([a-z]+) ([a-z]+)/\2 \1/'` 交换两个单词的位置。

### 2.3 PCRE 独有能力

简写类：`\d` 数字、`\w` 单词字符、`\s` 空白（仅 PCRE/部分工具；ERE 请写 `[0-9]` 等）。零宽断言：`(?=bar)` 前瞻（后面紧跟 bar 的 foo）、`(?<=foo)` 后顾（前面是 foo 的 bar）、`(?!baz)` 负前瞻——断言只检查位置、不把检查内容算进匹配文本。非贪婪：`*?`、`+?` 尽量少吃字符（`<.+?>` 匹配单个标签而非整段）。**断言为什么零宽**：用于「要 foo 但要求其后是 bar、且匹配结果不含 bar」的场景。

## 3. 贪婪、回溯与性能

正则引擎默认**贪婪**：量词尽量多吃字符，失败再回溯（backtrack）吐出。回溯是强大之源，也是性能灾难之源——嵌套量词可能指数级展开（catastrophic backtracking）。贪婪 vs 非贪婪：`<.*>` 从第一个 `<` 吃到最后一个 `>`，`<.*?>` 只吃第一个标签。

性能上注意：能用锚点 `^` `$` 收窄就收窄，别让引擎从每个位置尝试；大文件优先 `grep -F` 固定字符串或 `grep -E` 简单模式，最后才上 `-P`；避免 `(a+)+b` 这类嵌套量词；PCRE 有原子组 `(?>...)` 可锁定回溯，但 GNU grep 场景很少需要。先用 `grep -c` 小样本验证，再全量跑。

## 4. 在 Bash 中使用正则

`[[ $email =~ 正则 ]]` 使用 **ERE** 方言。**关键规则**：右侧正则**不能加引号**——加了引号就变成字面量匹配整串；也不能在引号内用变量拼正则（应先 `re=$pattern` 再 `[[ $s =~ $re ]]`）。邮箱校验示例用 `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`，有效则打印「有效邮箱」。

捕获组存入 `BASH_REMATCH` 数组（下标 0 是整串匹配）：对「部署于 2026-09-22 完成」用 `([0-9]{4})-([0-9]{2})-([0-9]{2})` 匹配后，`${BASH_REMATCH[1]}` 是年、`[2]` 是月、`[3]` 是日。可封装成 `is_uint`、`is_ipv4`、`is_cn_mobile` 等谓词函数，在 `if` 里直接调用。

```bash
$ email="alice@example.com"
$ if [[ $email =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
>     echo "有效邮箱"
> else
>     echo "无效邮箱"
> fi
有效邮箱
$ s="部署于 2026-09-22 完成"
$ if [[ $s =~ ([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
>     echo "年=${BASH_REMATCH[1]} 月=${BASH_REMATCH[2]} 日=${BASH_REMATCH[3]}"
> fi
年=2026 月=09 日=22
$ re='^[0-9]+$'                     # 正则先存变量再引用
$ [[ 12345 =~ $re ]] && echo 全是数字
全是数字
```

**验证 ≠ 完全合法**：`[0-9]{1,3}` 会放过 `999.999.999.999`；严格校验 IP 需逐段数值判断。写校验时明确「业务可接受的宽松度」，别把演示正则当 RFC 实现。`\b` 单词边界（GNU/ERE/PCRE 支持）用于避免 `cat` 匹配到 `concatenate`。

## 5. sed/awk 中的正则

`sed` 默认 BRE，`-E` 切到 ERE：`sed -n '/error/p'` 与 `sed -n -E '/error|warn/p'`。`awk` 动态正则用斜杠字面量或字符串：`/error/`、`$0 ~ /timeout|refused/`、`BEGIN {pat="^GET"} $0 ~ pat`。注意 `sed` 替换串的 `&` 与 `\1` 语义——`grep` 只匹配不替换，sed 才有「替换时引用匹配」的概念。

```bash
$ echo 'hello world' | sed -E 's/([a-z]+) ([a-z]+)/\2 \1/'   # 交换两个单词
world hello
$ echo 'price: 42 USD' | sed -E 's/[0-9]+/[金额]/'           # 替换数字
price: [金额] USD
$ echo 'user=admin' | sed -n 's/^user=//p'                   # 提取 value
admin
$ sed -E 's|http://|https://|g' <<< 'http://a.example http://b.example'
https://a.example https://b.example
```

中文匹配需要 PCRE：`grep -P '[\x{4e00}-\x{9fa5}]'`；POSIX 字符类 `[:alpha:]` 不认 CJK，`[` 简单范围也覆盖不了全部汉字区间。处理 UTF-8 中文时确保 locale 正确，否则 `.` 与字符类按字节而非字符处理。

## 6. 调试正则

命令行最小样本快速试：`echo "test123" | grep -oE '[0-9]+'`、`sed -E 's/[0-9]+/#/'`、`awk '{gsub(/[0-9]+/,"#"); print}'`。GNU grep 还有 `-d e` 把文件当数据看引擎匹配过程（较少用）。在线工具 [regex101.com](https://regex101.com/) 注意选对 flavor（Grep/PCRE/JavaScript 等），[regexr.com](https://regexr.com/) 适合可视化讲解。

**调试顺序建议**：先用 `echo`/`printf` 构造最小样本 → 选对 flavor（ERE/PCRE）→ 看是否整串匹配还是子串匹配 → 最后再接大文件。

## 7. 本章常见坑

1. **方言搞混**。`grep 'a+'` 的 `+` 是字面量（BRE）；要 ERE 用 `grep -E 'a+'`。`{3}` 在 BRE 里要写 `\{3\}`。**新代码统一 `grep -E` / `sed -E`**。

2. **`grep -P` 在目标机不可用**。部分精简系统/旧 grep 未编译 PCRE，`grep -P` 报错。部署脚本先探测，或用 `awk`/`sed` ERE 替代 `\d` 等简写（写成 `[0-9]`）。

3. **`[[ =~ ]]` 右侧加了引号**。`[[ $s =~ "^abc$" ]]` 变成字面量比较，几乎永远失败。正则不加引号，或先存变量再 `[[ $s =~ $re ]]`。

4. **点号 `.` 忘转义**。`grep '.txt'` 会匹配 `atxt`、`a-txt`。字面量点写 `\.`（单引号内）。

5. **用正则做「整行校验」却没锚点**。漏掉 `^$` 的 `grep '[0-9]*'` 空匹配永远成功。校验务必首尾锚定。

6. **贪婪匹配截取 HTML/引号**。`".*"` 会从第一个引号吃到最后一个引号。改非贪婪 `".*?"`（PCRE）或用 `[^"]*`。

7. **在 `sed` 与 `grep` 之间照搬语法**。`sed` 的 `&`、`+`（GNU sed ERE）与 `grep` 语义不同；替换用 `sed`，过滤用 `grep`，别混。

8. **中文匹配期望 `.` 或 `[[:alpha:]]` 覆盖汉字**。POSIX 字符类不认 CJK；用 `grep -P '[\x{4e00}-\x{9fa5}]'`。

## 参考资料

- `man 7 regex` — POSIX 正则语义综述
- `man grep`、`man sed`、`man pcre2pattern`
- regular-expressions.info — [regular-expressions.info](https://www.regular-expressions.info/)
- PCRE2 文档 — [pcre.org](https://pcre.org/)
- GNU Grep 手册 - Regular Expressions — [gnu.org](https://www.gnu.org/software/grep/manual/)
- GNU Sed 手册 - Regular Expressions — [gnu.org](https://www.gnu.org/software/sed/manual/)
- Arch Wiki - Bash - Conditions（`=~`） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- 鸟哥的私房菜 - 正则表达式 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- regex101 在线调试 — [regex101.com](https://regex101.com/)
