# 脚本调试

调试是脚本开发的重要环节，帮助发现和修复错误。

> 内容参考自 Bash 手册和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握 Bash 调试选项
- 学会使用 set 命令调试
- 了解错误处理最佳实践
- 掌握日志记录技巧

## 1. 调试选项

### 1.1 set 命令

```bash
# 启用调试模式
set -x  # 显示执行的命令
set -e  # 遇到错误立即退出
set -u  # 使用未定义变量时报错
set -o pipefail  # 管道中任意命令失败则整个管道失败
```

### 1.2 组合使用

```bash
#!/bin/bash
set -euo pipefail  # 严格模式

# 代码块
```

### 1.3 临时启用

```bash
# 启用调试
set -x

# 代码块

# 禁用调试
set +x
```

## 2. 调试技巧

### 2.1 打印变量

```bash
# 方法 1
echo "变量值: $var"

# 方法 2
printf "变量值: %s\n" "$var"

# 方法 3（调试时使用）
declare -p var
```

### 2.2 打印数组

```bash
arr=("a" "b" "c")

# 打印所有元素
echo "数组: ${arr[@]}"

# 打印索引
echo "索引: ${!arr[@]}"

# 使用 declare
declare -p arr
```

### 2.3 打印函数参数

```bash
my_func() {
    echo "参数个数: $#"
    echo "所有参数: $@"
    echo "第一个参数: $1"
}
```

## 3. 错误处理

### 3.1 检查命令退出状态

```bash
# 检查上一条命令的退出状态
command
if [ $? -eq 0 ]; then
    echo "成功"
else
    echo "失败"
fi

# 或者
if command; then
    echo "成功"
else
    echo "失败"
fi
```

### 3.2 trap 捕获信号

```bash
#!/bin/bash

# 捕获退出信号
trap 'echo "脚本退出"; cleanup' EXIT

# 捕获中断信号
trap 'echo "收到中断信号"; exit 1' INT TERM

# 捕获错误
trap 'echo "错误发生在第 $LINENO 行"; exit 1' ERR

cleanup() {
    echo "清理资源"
    # 清理临时文件等
}
```

### 3.3 错误处理函数

```bash
#!/bin/bash

error_handler() {
    local line=$1
    local command=$2
    local code=$3
    echo "错误: 命令 '$command' 在第 $line 行失败，退出码 $code"
    exit $code
}

trap 'error_handler ${LINENO} "$BASH_COMMAND" $?' ERR
```

## 4. 日志记录

### 4.1 基本日志函数

```bash
#!/bin/bash

LOG_FILE="/var/log/myscript.log"

log() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

log "INFO" "脚本开始"
log "ERROR" "发生错误"
log "INFO" "脚本结束"
```

### 4.2 日志级别

```bash
#!/bin/bash

LOG_LEVEL="DEBUG"  # DEBUG, INFO, WARN, ERROR

log() {
    local level=$1
    local message=$2
    
    # 定义日志级别优先级
    declare -A levels=(
        [DEBUG]=0
        [INFO]=1
        [WARN]=2
        [ERROR]=3
    )
    
    # 检查是否应该记录
    if [ ${levels[$level]} -ge ${levels[$LOG_LEVEL]} ]; then
        local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        echo "[$timestamp] [$level] $message"
    fi
}
```

### 4.3 日志轮转

```bash
#!/bin/bash

LOG_DIR="/var/log/myscript"
MAX_SIZE=10485760  # 10MB
MAX_FILES=5

rotate_log() {
    local log_file=$1
    
    if [ -f "$log_file" ] && [ $(stat -f%z "$log_file") -gt $MAX_SIZE ]; then
        # 轮转日志文件
        for i in $(seq $((MAX_FILES-1)) -1 1); do
            if [ -f "$log_file.$i" ]; then
                mv "$log_file.$i" "$log_file.$((i+1))"
            fi
        done
        mv "$log_file" "$log_file.1"
    fi
}
```

## 5. 调试工具

### 5.1 shellcheck

```bash
# 安装
sudo apt install shellcheck

# 使用
shellcheck script.sh

# 输出格式
shellcheck -f json script.sh
shellcheck -f gcc script.sh
```

### 5.2 bashdb

```bash
# 安装
sudo apt install bashdb

# 使用
bashdb script.sh

# 调试命令
# (bashdb) step    # 单步执行
# (bashdb) next    # 下一行
# (bashdb) print $var  # 打印变量
# (bashdb) break 10    # 设置断点
# (bashdb) continue    # 继续执行
```

### 5.3 使用 echo 调试

```bash
#!/bin/bash

debug() {
    if [ "${DEBUG:-0}" = "1" ]; then
        echo "DEBUG: $1" >&2
    fi
}

# 使用
DEBUG=1 ./script.sh
```

## 6. 最佳实践

### 6.1 严格模式

```bash
#!/bin/bash
set -euo pipefail
```

### 6.2 错误检查

```bash
# 检查必要命令
command -v curl >/dev/null 2>&1 || { echo "需要安装 curl"; exit 1; }

# 检查必要文件
[ -f "/etc/passwd" ] || { echo "文件不存在"; exit 1; }

# 检查必要变量
[ -n "${VAR:-}" ] || { echo "变量未设置"; exit 1; }
```

### 6.3 清理函数

```bash
#!/bin/bash

cleanup() {
    # 清理临时文件
    rm -f "$tmp_file"
    # 其他清理操作
}

trap cleanup EXIT

tmp_file=$(mktemp)
```

## 7. 常见错误

### 7.1 未加引号

```bash
# 错误
file="my file.txt"
cat $file  # 会出错

# 正确
cat "$file"
```

### 7.2 未检查退出状态

```bash
# 错误
cd /some/dir
rm -rf *

# 正确
cd /some/dir || exit 1
rm -rf *
```

### 7.3 使用未定义变量

```bash
# 错误
set -u
echo $undefined_var  # 会出错

# 正确
echo ${undefined_var:-"默认值"}
```

## 参考资料

- `man bash` - Shell Builtin Commands
- [Bash 手册 - Shell Builtin Commands](https://www.gnu.org/software/bash/manual/html_node/Shell-Builtin-Commands.html)
- [ShellCheck](https://www.shellcheck.net/)
- [Bash 调试技巧](https://tldp.org/LDP/abs/html/debugging.html)