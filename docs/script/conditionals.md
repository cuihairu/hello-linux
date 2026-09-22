# 条件判断

条件判断是脚本逻辑控制的核心，用于根据不同条件执行不同代码。

> 内容参考自 Bash 手册和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握 if/else 语句
- 学会使用 case 语句
- 理解逻辑运算符和文件测试
- 掌握条件表达式的写法

## 1. if 语句

### 1.1 基本语法

```bash
if [ condition ]; then
    # 代码块
fi

# 或
if [ condition ]; then
    # 代码块
else
    # 代码块
fi

# 或
if [ condition1 ]; then
    # 代码块
elif [ condition2 ]; then
    # 代码块
else
    # 代码块
fi
```

### 1.2 示例

```bash
#!/bin/bash

age=18

if [ $age -ge 18 ]; then
    echo "成年人"
else
    echo "未成年人"
fi
```

## 2. 条件表达式

### 2.1 数值比较

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `-eq` | 等于 | `[ $a -eq $b ]` |
| `-ne` | 不等于 | `[ $a -ne $b ]` |
| `-gt` | 大于 | `[ $a -gt $b ]` |
| `-ge` | 大于等于 | `[ $a -ge $b ]` |
| `-lt` | 小于 | `[ $a -lt $b ]` |
| `-le` | 小于等于 | `[ $a -le $b ]` |

```bash
a=10
b=20

if [ $a -lt $b ]; then
    echo "$a 小于 $b"
fi
```

### 2.2 字符串比较

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `=` | 等于 | `[ "$a" = "$b" ]` |
| `!=` | 不等于 | `[ "$a" != "$b" ]` |
| `-z` | 为空 | `[ -z "$a" ]` |
| `-n` | 非空 | `[ -n "$a" ]` |
| `<` | 小于（字典序） | `[[ "$a" < "$b" ]]` |
| `>` | 大于（字典序） | `[[ "$a" > "$b" ]]` |

```bash
name="John"

if [ -n "$name" ]; then
    echo "名字不为空"
fi

if [ "$name" = "John" ]; then
    echo "Hello John"
fi
```

### 2.3 文件测试

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `-f` | 是文件 | `[ -f file ]` |
| `-d` | 是目录 | `[ -d dir ]` |
| `-e` | 存在 | `[ -e path ]` |
| `-r` | 可读 | `[ -r file ]` |
| `-w` | 可写 | `[ -w file ]` |
| `-x` | 可执行 | `[ -x file ]` |
| `-s` | 非空 | `[ -s file ]` |
| `-L` | 是符号链接 | `[ -L link ]` |

```bash
file="/etc/passwd"

if [ -f "$file" ]; then
    echo "$file 是文件"
fi

if [ -r "$file" ]; then
    echo "$file 可读"
fi
```

## 3. 逻辑运算符

### 3.1 与、或、非

```bash
# 与（&&）
if [ $a -gt 5 ] && [ $a -lt 15 ]; then
    echo "a 在 5 到 15 之间"
fi

# 或（||）
if [ $a -lt 5 ] || [ $a -gt 15 ]; then
    echo "a 小于 5 或大于 15"
fi

# 非（!）
if [ ! -f "$file" ]; then
    echo "$file 不存在"
fi
```

### 3.2 使用 [[ ]]（Bash 扩展）

```bash
# 支持正则匹配
if [[ "$name" =~ ^[A-Z] ]]; then
    echo "名字以大写字母开头"
fi

# 支持模式匹配
if [[ "$file" == *.txt ]]; then
    echo "是文本文件"
fi
```

## 4. case 语句

### 4.1 基本语法

```bash
case $variable in
    pattern1)
        # 代码块
        ;;
    pattern2)
        # 代码块
        ;;
    *)
        # 默认代码块
        ;;
esac
```

### 4.2 示例

```bash
#!/bin/bash

fruit="apple"

case $fruit in
    apple)
        echo "苹果"
        ;;
    banana|orange)
        echo "香蕉或橙子"
        ;;
    cherry)
        echo "樱桃"
        ;;
    *)
        echo "未知水果"
        ;;
esac
```

### 4.3 模式匹配

```bash
#!/bin/bash

read -p "请输入选项 (y/n): " choice

case $choice in
    y|Y|yes|YES)
        echo "是"
        ;;
    n|N|no|NO)
        echo "否"
        ;;
    *)
        echo "无效输入"
        ;;
esac
```

## 5. 三元运算符

```bash
# 条件 ? 真值 : 假值
age=20
status=$((age >= 18 ? "成年" : "未成年"))
echo $status
```

## 6. 算术条件

```bash
# 使用 (( ))
a=10
b=20

if ((a < b)); then
    echo "$a 小于 $b"
fi

# 支持 C 风格的运算符
if ((a + b > 25)); then
    echo "和大于 25"
fi
```

## 7. 实战案例

### 7.1 检查文件是否存在

```bash
#!/bin/bash

file="/etc/passwd"

if [ -f "$file" ]; then
    echo "文件存在"
    if [ -r "$file" ]; then
        echo "文件可读"
    else
        echo "文件不可读"
    fi
else
    echo "文件不存在"
fi
```

### 7.2 检查服务状态

```bash
#!/bin/bash

service="nginx"

if systemctl is-active --quiet $service; then
    echo "$service 正在运行"
else
    echo "$service 未运行"
    read -p "是否启动? (y/n): " choice
    if [ "$choice" = "y" ]; then
        sudo systemctl start $service
    fi
fi
```

### 7.3 参数验证

```bash
#!/bin/bash

if [ $# -lt 1 ]; then
    echo "用法: $0 <filename>"
    exit 1
fi

file=$1

if [ ! -f "$file" ]; then
    echo "错误: 文件 $file 不存在"
    exit 1
fi
```

## 参考资料

- `man bash` - Conditional Constructs
- [Bash 手册 - Conditional Constructs](https://www.gnu.org/software/bash/manual/html_node/Conditional-Constructs.html)
- [Advanced Bash-Scripting Guide - Tests](https://tldp.org/LDP/abs/html/tests.html)
