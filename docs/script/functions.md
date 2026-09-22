# 函数

函数是组织代码的基本单元，提高代码复用性和可维护性。

> 内容参考自 Bash 手册和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握函数定义和调用
- 学会使用参数和返回值
- 了解局部变量和全局变量
- 掌握递归函数

## 1. 函数定义

### 1.1 基本语法

```bash
# 方法 1
function_name() {
    # 代码块
}

# 方法 2
function function_name {
    # 代码块
}
```

### 1.2 示例

```bash
# 定义函数
greet() {
    echo "Hello, World!"
}

# 调用函数
greet
```

## 2. 函数参数

### 2.1 位置参数

```bash
greet() {
    echo "Hello, $1!"
}

greet "John"  # 输出: Hello, John!
```

### 2.2 多个参数

```bash
add() {
    local sum=$(( $1 + $2 ))
    echo "和: $sum"
}

add 10 20  # 输出: 和: 30
```

### 2.3 参数个数

```bash
print_args() {
    echo "参数个数: $#"
    echo "所有参数: $@"
    echo "第一个参数: $1"
}

print_args "a" "b" "c"
```

## 3. 返回值

### 3.1 使用 return

```bash
is_even() {
    if [ $(($1 % 2)) -eq 0 ]; then
        return 0  # 真
    else
        return 1  # 假
    fi
}

if is_even 4; then
    echo "偶数"
else
    echo "奇数"
fi
```

### 3.2 使用 echo

```bash
add() {
    echo $(($1 + $2))
}

result=$(add 10 20)
echo "结果: $result"
```

### 3.3 返回数组

```bash
get_files() {
    local files=()
    for file in *.txt; do
        files+=("$file")
    done
    echo "${files[@]}"
}

# 获取数组
file_list=$(get_files)
for file in $file_list; do
    echo "文件: $file"
done
```

## 4. 局部变量

### 4.1 使用 local

```bash
my_func() {
    local name="John"
    echo "函数内: $name"
}

my_func
echo "函数外: $name"  # 空，因为 name 是局部变量
```

### 4.2 变量作用域

```bash
global_var="全局"

my_func() {
    local local_var="局部"
    echo "函数内: $global_var"
    echo "函数内: $local_var"
}

my_func
echo "函数外: $global_var"
echo "函数外: $local_var"  # 空
```

## 5. 递归函数

### 5.1 阶乘

```bash
factorial() {
    if [ $1 -le 1 ]; then
        echo 1
    else
        local prev=$(factorial $(($1 - 1)))
        echo $(($1 * prev))
    fi
}

result=$(factorial 5)
echo "5! = $result"  # 120
```

### 5.2 斐波那契数列

```bash
fibonacci() {
    if [ $1 -le 0 ]; then
        echo 0
    elif [ $1 -eq 1 ]; then
        echo 1
    else
        local a=$(fibonacci $(($1 - 1)))
        local b=$(fibonacci $(($1 - 2)))
        echo $((a + b))
    fi
}

for i in {0..10}; do
    echo "fibonacci($i) = $(fibonacci $i)"
done
```

## 6. 函数库

### 6.1 创建函数库

```bash
# mylib.sh
#!/bin/bash

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

check_root() {
    if [ $EUID -ne 0 ]; then
        error "需要 root 权限"
        exit 1
    fi
}
```

### 6.2 使用函数库

```bash
#!/bin/bash

# 加载函数库
source ./mylib.sh

# 使用函数
log "脚本开始"
check_root
log "脚本结束"
```

## 7. 回调函数

```bash
# 定义回调函数
on_success() {
    echo "操作成功"
}

on_failure() {
    echo "操作失败"
}

# 使用回调
do_operation() {
    local operation=$1
    local success_callback=$2
    local failure_callback=$3
    
    if $operation; then
        $success_callback
    else
        $failure_callback
    fi
}

# 调用
do_operation "ls /tmp" on_success on_failure
```

## 8. 实战案例

### 8.1 日志函数

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

### 8.2 重试函数

```bash
#!/bin/bash

retry() {
    local max_attempts=$1
    local delay=$2
    local command=$3
    
    for ((attempt=1; attempt<=max_attempts; attempt++)); do
        if $command; then
            return 0
        fi
        echo "尝试 $attempt 失败，${delay}秒后重试..."
        sleep $delay
    done
    
    echo "所有尝试失败"
    return 1
}

# 使用
retry 3 5 "curl -s https://example.com"
```

### 8.3 配置文件解析

```bash
#!/bin/bash

parse_config() {
    local config_file=$1
    local section=""
    
    while IFS= read -r line; do
        # 跳过注释和空行
        [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
        
        # 解析节
        if [[ "$line" =~ ^\[(.*)\]$ ]]; then
            section="${BASH_REMATCH[1]}"
            continue
        fi
        
        # 解析键值对
        if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
            key="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            echo "${section}.${key}=${value}"
        fi
    done < "$config_file"
}

# 使用
parse_config "/etc/myapp.conf"
```

## 参考资料

- `man bash` - Shell Functions
- [Bash 手册 - Shell Functions](https://www.gnu.org/software/bash/manual/html_node/Shell-Functions.html)
- [Advanced Bash-Scripting Guide - Functions](https://tldp.org/LDP/abs/html/functions.html)
