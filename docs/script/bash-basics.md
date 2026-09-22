# Bash 基础

Shell 脚本是包含一系列命令的文本文件，由 Shell 解释执行。

> 内容参考自 Bash 手册和 Advanced Bash-Scripting Guide，见文末参考资料。

## 学习目标

- 理解 Shell 脚本的结构和执行方式
- 掌握引号规则和特殊字符
- 学会使用变量和命令替换

## 1. 脚本结构

### 1.1 Shebang 行

脚本第一行指定解释器：

```bash
#!/bin/bash
# 或
#!/usr/bin/env bash
```

### 1.2 基本结构

```bash
#!/bin/bash
# 脚本描述
# 作者: Your Name
# 日期: 2024-01-01

# 设置严格模式
set -euo pipefail

# 主逻辑
main() {
    echo "脚本开始"
    # ... 其他命令 ...
    echo "脚本结束"
}

# 执行主函数
main "$@"
```

## 2. 执行方式

### 2.1 添加执行权限

```bash
chmod +x script.sh
./script.sh
```

### 2.2 使用 Shell 执行

```bash
bash script.sh
sh script.sh
```

### 2.3 Source 执行

```bash
source script.sh
. script.sh
```

## 3. 引号规则

### 3.1 单引号

单引号内的内容原样输出，不解释变量：

```bash
echo 'Hello $USER'  # 输出: Hello $USER
```

### 3.2 双引号

双引号内解释变量和命令替换：

```bash
echo "Hello $USER"  # 输出: Hello username
echo "Today is $(date +%Y-%m-%d)"
```

### 3.3 反引号

命令替换（推荐使用 `$()`）：

```bash
# 旧式写法
files=`ls -l`

# 推荐写法
files=$(ls -l)
```

## 4. 特殊字符

| 字符 | 说明 | 示例 |
|------|------|------|
| `#` | 注释 | `# 这是注释` |
| `$` | 变量引用 | `$VAR`, `${VAR}` |
| `\` | 转义字符 | `\$`, `\n` |
| `|` | 管道 | `ls \| grep txt` |
| `&` | 后台执行 | `command &` |
| `;` | 命令分隔 | `cmd1; cmd2` |
| `&&` | 逻辑与 | `cmd1 && cmd2` |
| `\|\|` | 逻辑或 | `cmd1 \|\| cmd2` |

## 5. 命令替换

```bash
# 获取当前日期
today=$(date +%Y-%m-%d)

# 获取文件数量
file_count=$(ls -1 | wc -l)

# 获取系统信息
kernel=$(uname -r)
```

## 6. 注释

```bash
# 单行注释

: '
多行注释
使用 Here Document
'

<< 'COMMENT'
这也是多行注释
COMMENT
```

## 参考资料

- `man bash`
- [Bash 手册](https://www.gnu.org/software/bash/manual/)
- [Advanced Bash-Scripting Guide - Chapter 2](https://tldp.org/LDP/abs/html/)
