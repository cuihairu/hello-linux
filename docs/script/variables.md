# 变量与数据类型

Shell 变量是存储数据的容器，无需声明类型。

> 内容参考自 Bash 手册和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握变量定义和引用
- 了解环境变量和特殊变量
- 学会使用数组和关联数组
- 掌握算术运算和字符串操作

## 1. 变量定义

### 1.1 基本定义

```bash
# 定义变量（等号两边不能有空格）
name="John"
age=25
city="New York"

# 引用变量
echo $name
echo ${name}
echo "My name is $name"
```

### 1.2 只读变量

```bash
readonly PI=3.14159
PI=3.14  # 错误：只读变量不能修改
```

### 1.3 删除变量

```bash
unset name
```

## 2. 变量类型

### 2.1 字符串

```bash
# 单引号：原样输出
str1='Hello $USER'

# 双引号：解释变量
str2="Hello $USER"

# 字符串长度
echo ${#str2}

# 子字符串
echo ${str2:0:5}  # 从位置0开始，取5个字符

# 字符串替换
echo ${str2/World/Linux}  # 替换第一个匹配
echo ${str2//World/Linux} # 替换所有匹配
```

### 2.2 整数

```bash
# 整数运算
a=10
b=20

# 使用 $(( ))
sum=$((a + b))
echo $sum  # 30

# 使用 let
let "c = a + b"
echo $c

# 使用 expr（注意空格）
d=$(expr $a + $b)
echo $d
```

### 2.3 数组

```bash
# 索引数组
fruits=("apple" "banana" "cherry")

# 访问元素
echo ${fruits[0]}  # apple
echo ${fruits[1]}  # banana

# 所有元素
echo ${fruits[@]}

# 数组长度
echo ${#fruits[@]}

# 添加元素
fruits+=("date")

# 删除元素
unset fruits[1]
```

### 2.4 关联数组（Bash 4+）

```bash
# 声明关联数组
declare -A user

# 赋值
user[name]="John"
user[age]=25
user[city]="New York"

# 访问
echo ${user[name]}
echo ${user[age]}

# 所有键
echo ${!user[@]}

# 所有值
echo ${user[@]}
```

## 3. 环境变量

### 3.1 常用环境变量

```bash
echo $HOME      # 主目录
echo $USER      # 当前用户
echo $SHELL     # 默认 Shell
echo $PATH      # 命令搜索路径
echo $PWD       # 当前目录
echo $HOSTNAME  # 主机名
echo $LANG      # 语言设置
```

### 3.2 设置环境变量

```bash
# 当前 Shell 有效
export VAR="value"

# 永久生效（添加到 ~/.bashrc）
echo 'export VAR="value"' >> ~/.bashrc
source ~/.bashrc
```

## 4. 特殊变量

| 变量 | 说明 |
|------|------|
| `$0` | 脚本名称 |
| `$1`-`$9` | 第1-9个参数 |
| `${10}` | 第10个及以上参数 |
| `$#` | 参数个数 |
| `$@` | 所有参数（独立字符串） |
| `$*` | 所有参数（单个字符串） |
| `$?` | 上一条命令的退出状态 |
| `$$` | 当前进程 PID |
| `$!` | 后台运行的最后一个进程 PID |

```bash
#!/bin/bash
echo "脚本名称: $0"
echo "第一个参数: $1"
echo "参数个数: $#"
echo "所有参数: $@"
```

## 5. 变量扩展

### 5.1 默认值

```bash
# 变量未定义或为空时使用默认值
echo ${name:-"Anonymous"}

# 变量未定义时设置默认值
echo ${name:="Anonymous"}

# 变量未定义时报错
echo ${name:?"Variable not set"}
```

### 5.2 字符串操作

```bash
str="Hello World"

# 长度
echo ${#str}

# 子字符串
echo ${str:0:5}   # Hello
echo ${str:6}     # World

# 删除匹配
echo ${str#Hello }  # World
echo ${str% World}  # Hello

# 替换
echo ${str/World/Linux}  # Hello Linux
```

## 6. 类型声明

```bash
# 声明整数
declare -i num=10
num="abc"  # 转换为 0

# 声明只读
declare -r PI=3.14159

# 声明数组
declare -a arr=(1 2 3)

# 声明关联数组
declare -A map

# 声明全局变量
declare -g GLOBAL="value"
```

## 参考资料

- `man bash` - Shell Variables
- [Bash 手册 - Shell Variables](https://www.gnu.org/software/bash/manual/html_node/Shell-Variables.html)
- [Advanced Bash-Scripting Guide - Variables](https://tldp.org/LDP/abs/html/variables.html)
