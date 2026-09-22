# 正则表达式

正则表达式是文本匹配的强大工具，广泛应用于 grep、sed、awk 等工具。

> 内容参考自 PCRE 手册和正则表达式实践，见文末参考资料。

## 学习目标

- 掌握基础正则表达式（BRE）
- 学会扩展正则表达式（ERE）
- 了解 PCRE 和 Perl 正则
- 掌握正则表达式优化技巧

## 1. 基础正则表达式（BRE）

### 1.1 字符匹配

| 字符 | 说明 | 示例 |
|------|------|------|
| `.` | 匹配任意单个字符 | `a.c` 匹配 `abc`, `a1c` |
| `*` | 匹配前一个字符零次或多次 | `ab*c` 匹配 `ac`, `abc`, `abbc` |
| `^` | 匹配行首 | `^hello` 匹配以 hello 开头的行 |
| `$` | 匹配行尾 | `world$` 匹配以 world 结尾的行 |
| `[]` | 字符类 | `[abc]` 匹配 a, b 或 c |
| `[^]` | 否定字符类 | `[^abc]` 匹配除 a, b, c 外的字符 |
| `\` | 转义字符 | `\.` 匹配实际的点 |

### 1.2 示例

```bash
# 匹配以数字开头的行
grep "^[0-9]" file

# 匹配空行
grep "^$" file

# 匹配包含 .com 的行
grep "\.com" file

# 匹配以 . 结尾的行
grep "\.$" file
```

## 2. 扩展正则表达式（ERE）

### 2.1 量词

| 字符 | 说明 | 示例 |
|------|------|------|
| `+` | 匹配前一个字符一次或多次 | `ab+c` 匹配 `abc`, `abbc` |
| `?` | 匹配前一个字符零次或一次 | `ab?c` 匹配 `ac`, `abc` |
| `{n}` | 匹配前一个字符恰好 n 次 | `a{3}` 匹配 `aaa` |
| `{n,}` | 匹配前一个字符至少 n 次 | `a{3,}` 匹配 `aaa`, `aaaa` |
| `{n,m}` | 匹配前一个字符 n 到 m 次 | `a{2,4}` 匹配 `aa`, `aaa`, `aaaa` |

### 2.2 分组和选择

```bash
# 分组
grep -E "(ab)+" file

# 选择
grep -E "cat|dog" file

# 捕获组
echo "hello world" | sed -E 's/([a-z]+) ([a-z]+)/\2 \1/'
```

### 2.3 示例

```bash
# 匹配 IP 地址
grep -E "[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}" file

# 匹配邮箱
grep -E "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" file

# 匹配 URL
grep -E "https?://[a-zA-Z0-9./-]+" file
```

## 3. PCRE（Perl 兼容正则表达式）

### 3.1 特性

```bash
# 使用 grep -P
grep -P "\d{3}-\d{4}" file  # 匹配电话号码

# 前瞻断言
grep -P "foo(?=bar)" file   # 匹配后面跟着 bar 的 foo

# 后顾断言
grep -P "(?<=foo)bar" file  # 匹配前面是 foo 的 bar
```

### 3.2 常用模式

```bash
# 匹配 HTML 标签
grep -P "<[^>]+>" file

# 匹配引号内容
grep -P "'[^']*'" file

# 匹配变量名
grep -P "[a-zA-Z_][a-zA-Z0-9_]*" file
```

## 4. 正则表达式引擎

### 4.1 贪婪与非贪婪

```bash
# 贪婪匹配（默认）
echo "<div>hello</div>" | grep -oP "<.*>"  # 匹配整个字符串

# 非贪婪匹配
echo "<div>hello</div>" | grep -oP "<.*?>"  # 匹配 <div>
```

### 4.2 回溯

```bash
# 避免回溯
grep -P "(?>a+)" file  # 原子组
```

## 5. 实用模式

### 5.1 常用正则

```bash
# 匹配数字
grep -E "^[0-9]+$" file

# 匹配字母
grep -E "^[a-zA-Z]+$" file

# 匹配字母数字
grep -E "^[a-zA-Z0-9]+$" file

# 匹配中文
grep -P "[\x{4e00}-\x{9fa5}]" file
```

### 5.2 验证模式

```bash
# 验证邮箱
validate_email() {
    local email=$1
    if [[ $email =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        echo "有效邮箱"
    else
        echo "无效邮箱"
    fi
}

# 验证手机号
validate_phone() {
    local phone=$1
    if [[ $phone =~ ^1[3-9][0-9]{9}$ ]]; then
        echo "有效手机号"
    else
        echo "无效手机号"
    fi
}
```

### 5.3 提取模式

```bash
# 提取日期
extract_date() {
    local text=$1
    if [[ $text =~ ([0-9]{4})-([0-9]{2})-([0-9]{2}) ]]; then
        echo "年: ${BASH_REMATCH[1]}"
        echo "月: ${BASH_REMATCH[2]}"
        echo "日: ${BASH_REMATCH[3]}"
    fi
}

# 提取 IP
extract_ip() {
    local text=$1
    if [[ $text =~ ([0-9]{1,3}\.){3}[0-9]{1,3} ]]; then
        echo "IP: ${BASH_REMATCH[0]}"
    fi
}
```

## 6. 性能优化

### 6.1 避免回溯

```bash
# 不推荐
grep "a*b" file

# 推荐
grep "b" file  # 如果 a* 不是必需的
```

### 6.2 使用锚点

```bash
# 不推荐
grep "pattern" file

# 推荐
grep "^pattern$" file  # 如果需要精确匹配
```

### 6.3 使用字符类

```bash
# 不推荐
grep "[0123456789]" file

# 推荐
grep "[0-9]" file
```

## 7. 调试正则表达式

### 7.1 在线工具

- [regex101](https://regex101.com/)
- [regexr](https://regexr.com/)
- [RegExr](https://regexr.com/)

### 7.2 命令行调试

```bash
# 使用 grep 调试
echo "test string" | grep -oP "pattern"

# 使用 sed 调试
echo "test string" | sed -E 's/pattern/replacement/'

# 使用 awk 调试
echo "test string" | awk '/pattern/ {print}'
```

## 参考资料

- `man grep`, `man sed`, `man awk`
- [PCRE 手册](https://www.pcre.org/original/doc/html/)
- [正则表达式教程](https://www.regular-expressions.info/)
- [正则表达式 Cookbook](https://www.oreilly.com/library/view/regular-expressions-cookbook/9781449327453/)
