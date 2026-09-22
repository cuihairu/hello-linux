# 循环结构

循环用于重复执行代码块，直到满足条件为止。

> 内容参考自 Bash 手册和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握 for、while、until 循环
- 学会使用循环控制语句
- 了解循环的优化技巧

## 1. for 循环

### 1.1 列表循环

```bash
# 基本语法
for item in item1 item2 item3; do
    echo $item
done

# 示例
for fruit in apple banana cherry; do
    echo "水果: $fruit"
done
```

### 1.2 范围循环

```bash
# 数字范围
for i in {1..5}; do
    echo $i
done

# 带步长
for i in {0..10..2}; do
    echo $i
done

# C 风格
for ((i=0; i<5; i++)); do
    echo $i
done
```

### 1.3 文件循环

```bash
# 遍历文件
for file in *.txt; do
    echo "处理文件: $file"
done

# 遍历目录
for dir in /home/*/; do
    echo "目录: $dir"
done
```

### 1.4 命令输出循环

```bash
# 遍历命令输出
for user in $(cat /etc/passwd | cut -d: -f1); do
    echo "用户: $user"
done

# 遍历数组
arr=("one" "two" "three")
for item in "${arr[@]}"; do
    echo $item
done
```

## 2. while 循环

### 2.1 基本语法

```bash
while [ condition ]; do
    # 代码块
done
```

### 2.2 示例

```bash
#!/bin/bash

count=0
while [ $count -lt 5 ]; do
    echo "计数: $count"
    count=$((count + 1))
done
```

### 2.3 读取文件

```bash
# 逐行读取文件
while IFS= read -r line; do
    echo "行: $line"
done < file.txt

# 读取 CSV
while IFS=, read -r name age city; do
    echo "姓名: $name, 年龄: $age, 城市: $city"
done < data.csv
```

### 2.4 无限循环

```bash
# 方法 1
while true; do
    echo "运行中..."
    sleep 1
done

# 方法 2
while :; do
    echo "运行中..."
    sleep 1
done
```

## 3. until 循环

### 3.1 基本语法

```bash
until [ condition ]; do
    # 代码块
done
```

### 3.2 示例

```bash
#!/bin/bash

count=0
until [ $count -ge 5 ]; do
    echo "计数: $count"
    count=$((count + 1))
done
```

## 4. 循环控制

### 4.1 break

```bash
# 跳出循环
for i in {1..10}; do
    if [ $i -eq 5 ]; then
        break
    fi
    echo $i
done
```

### 4.2 continue

```bash
# 跳过当前迭代
for i in {1..10}; do
    if [ $i -eq 5 ]; then
        continue
    fi
    echo $i
done
```

### 4.3 跳出多层循环

```bash
# 跳出外层循环
for i in {1..3}; do
    for j in {1..3}; do
        if [ $j -eq 2 ]; then
            break 2  # 跳出两层循环
        fi
        echo "i=$i, j=$j"
    done
done
```

## 5. 嵌套循环

```bash
# 九九乘法表
for i in {1..9}; do
    for j in {1..9}; do
        if [ $j -le $i ]; then
            echo -n "$j×$i=$((i*j)) "
        fi
    done
    echo
done
```

## 6. 循环与数组

```bash
# 遍历数组
arr=("apple" "banana" "cherry")

# 方法 1
for item in "${arr[@]}"; do
    echo $item
done

# 方法 2
for i in "${!arr[@]}"; do
    echo "索引 $i: ${arr[$i]}"
done
```

## 7. 循环与函数

```bash
# 使用函数处理
process_file() {
    local file=$1
    echo "处理文件: $file"
}

for file in *.txt; do
    process_file "$file"
done
```

## 8. 性能优化

### 8.1 避免子 Shell

```bash
# 不推荐
cat file.txt | while read line; do
    echo $line
done

# 推荐
while read line; do
    echo $line
done < file.txt
```

### 8.2 使用内置命令

```bash
# 不推荐
for i in $(seq 1 100); do
    echo $i
done

# 推荐
for i in {1..100}; do
    echo $i
done
```

## 9. 实战案例

### 9.1 批量重命名文件

```bash
#!/bin/bash

for file in *.txt; do
    new_name="${file%.txt}.md"
    mv "$file" "$new_name"
    echo "重命名: $file -> $new_name"
done
```

### 9.2 监控系统资源

```bash
#!/bin/bash

while true; do
    cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    mem=$(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')
    echo "CPU: $cpu%, 内存: $mem"
    sleep 5
done
```

### 9.3 批量处理日志

```bash
#!/bin/bash

for log_file in /var/log/*.log; do
    echo "处理: $log_file"
    # 统计错误数
    error_count=$(grep -c "ERROR" "$log_file")
    echo "错误数: $error_count"
done
```

## 参考资料

- `man bash` - Looping Constructs
- [Bash 手册 - Looping Constructs](https://www.gnu.org/software/bash/manual/html_node/Looping-Constructs.html)
- [Advanced Bash-Scripting Guide - Loops](https://tldp.org/LDP/abs/html/loops1.html)
