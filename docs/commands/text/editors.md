# 文本编辑和查看工具

在 Linux 系统管理中，文本编辑和查看工具是修改配置文件、查看日志的必备技能。

> 内容参考自 Vim、GNU Coreutils 手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 Vim 编辑器的基本使用和高级技巧
- 学会使用 nano 等简单编辑器
- 掌握 cat、less、more 等文本查看工具
- 了解 head、tail 等文件内容查看命令

## 1. Vim 编辑器

### 1.1 Vim 简介

```bash
# Vim 是 vi 的增强版，是 Linux 系统中最流行的文本编辑器
# 特点：模式编辑、强大的文本处理能力、高度可定制

# 安装 Vim
sudo apt install vim        # Debian/Ubuntu
sudo dnf install vim        # RHEL/CentOS
```

### 1.2 Vim 模式

```bash
# 普通模式（Normal Mode）
# 用于导航、删除、复制、粘贴等操作
# 按 Esc 进入普通模式

# 插入模式（Insert Mode）
# 用于输入文本
# 按 i, I, a, A, o, O 进入插入模式

# 命令模式（Command Mode）
# 用于执行命令
# 按 : 进入命令模式

# 可视模式（Visual Mode）
# 用于选择文本
# 按 v, V, Ctrl+v 进入可视模式
```

### 1.3 基本操作

```bash
# 启动 Vim
vim file.txt                # 打开文件
vim +10 file.txt           # 打开文件并跳转到第10行
vim +/pattern file.txt     # 打开文件并搜索 pattern

# 保存和退出
:w                         # 保存
:q                         # 退出
:wq                        # 保存并退出
:q!                        # 强制退出不保存
:wq!                       # 强制保存并退出
:x                         # 保存并退出（同 :wq）

# 退出（普通模式）
ZZ                         # 保存并退出
ZQ                         # 不保存退出
```

### 1.4 光标移动

```bash
# 基本移动
h                          # 左移一个字符
j                          # 下移一行
k                          # 上移一行
l                          # 右移一个字符

# 单词移动
w                          # 移动到下一个单词开头
b                          # 移动到上一个单词开头
e                          # 移动到当前单词末尾
W                          # 移动到下一个单词开头（忽略标点）
B                          # 移动到上一个单词开头（忽略标点）

# 行内移动
0                          # 移动到行首
^                          # 移动到第一个非空字符
$                          # 移动到行尾
g_                         # 移动到最后一个非空字符

# 段落移动
{                          # 移动到上一段落
}                          # 移动到下一段落

# 屏幕移动
H                          # 移动到屏幕顶部
M                          # 移动到屏幕中间
L                          # 移动到屏幕底部

# 文件移动
gg                         # 移动到文件开头
G                          # 移动到文件末尾
:10                        # 移动到第10行
10G                        # 移动到第10行
```

### 1.5 编辑操作

```bash
# 进入插入模式
i                          # 在光标前插入
I                          # 在行首插入
a                          # 在光标后插入
A                          # 在行尾插入
o                          # 在下方新建一行并插入
O                          # 在上方新建一行并插入

# 删除操作
x                          # 删除光标下的字符
X                          # 删除光标前的字符
dd                         # 删除整行
D                          # 删除到行尾
d$                         # 删除到行尾
d0                         # 删除到行首
dw                         # 删除到下一个单词开头
db                         # 删除到上一个单词开头
dG                         # 删除到文件末尾
dgg                        # 删除到文件开头

# 复制粘贴
yy                         # 复制整行
Y                          # 复制整行
yw                         # 复制一个单词
y$                         # 复制到行尾
p                          # 在光标后粘贴
P                          # 在光标前粘贴

# 撤销和重做
u                          # 撤销
U                          # 撤销整行操作
Ctrl+r                     # 重做

# 修改操作
r                          # 替换光标下的字符
R                          # 进入替换模式
s                          # 替换光标下的字符并进入插入模式
S                          # 替换整行并进入插入模式
cw                         # 修改到单词末尾
cb                         # 修改到单词开头
c$                         # 修改到行尾
C                          # 修改到行尾
```

### 1.6 搜索和替换

```bash
# 搜索
/pattern                   # 向下搜索 pattern
?pattern                   # 向上搜索 pattern
n                          # 重复上一次搜索
N                          # 反向重复上一次搜索
*                          # 搜索光标下的单词
#                          # 反向搜索光标下的单词

# 替换
:s/old/new/                # 替换当前行第一个匹配
:s/old/new/g               # 替换当前行所有匹配
:%s/old/new/g              # 替换文件中所有匹配
:%s/old/new/gc             # 替换文件中所有匹配（确认）
:10,20s/old/new/g          # 替换第10-20行的匹配
```

### 1.7 多文件操作

```bash
# 打开多个文件
vim file1.txt file2.txt    # 打开多个文件
:next                      # 切换到下一个文件
:prev                      # 切换到上一个文件
:first                     # 切换到第一个文件
:last                      # 切换到最后一个文件

# 缓冲区操作
:ls                        # 列出所有缓冲区
:b2                        # 切换到缓冲区2
:bn                        # 切换到下一个缓冲区
:bp                        # 切换到上一个缓冲区
:bd                        # 关闭当前缓冲区

# 窗口分割
:split                     # 水平分割
:vsplit                    # 垂直分割
Ctrl+w h                   # 切换到左边窗口
Ctrl+w j                   # 切换到下面窗口
Ctrl+w k                   # 切换到上面窗口
Ctrl+w l                   # 切换到右边窗口
Ctrl+w =                   # 均分窗口
Ctrl+w _                   # 最大化当前窗口
```

### 1.8 高级技巧

```bash
# 宏录制
qa                         # 开始录制宏到寄存器 a
...操作...
q                          # 停止录制
@a                         # 执行宏 a
@@                         # 重复上一次宏

# 标记
ma                         # 设置标记 a
'a                         # 跳转到标记 a
`a                         # 跳转到标记 a 的精确位置

# 寄存器
"ayy                       # 复制到寄存器 a
"ap                        # 从寄存器 a 粘贴
"+y                        # 复制到系统剪贴板
"+p                        # 从系统剪贴板粘贴

# 可视模式
v                          # 字符可视模式
V                          # 行可视模式
Ctrl+v                     # 块可视模式

# 块可视模式操作
选择块后：
d                          # 删除选中块
y                          # 复制选中块
c                          # 修改选中块
I                          # 在选中块前插入
A                          # 在选中块后插入
```

### 1.9 Vim 配置

```bash
# ~/.vimrc 配置文件
set number                 " 显示行号
set relativenumber         " 显示相对行号
set tabstop=4              " Tab 宽度为 4
set shiftwidth=4           " 缩进宽度为 4
set expandtab              " 将 Tab 转换为空格
set autoindent             " 自动缩进
set smartindent            " 智能缩进
set showmatch              " 显示匹配的括号
set hlsearch               " 高亮搜索结果
set incsearch              " 增量搜索
set ignorecase             " 搜索时忽略大小写
set smartcase              " 智能大小写
set wrap                   " 自动换行
set linebreak              " 按单词换行
set mouse=a                " 启用鼠标
set clipboard=unnamedplus  " 使用系统剪贴板
set encoding=utf-8         " 使用 UTF-8 编码
set fileencoding=utf-8     " 文件编码为 UTF-8
syntax on                  " 启用语法高亮
filetype plugin indent on  " 启用文件类型检测
```

## 2. Nano 编辑器

### 2.1 基本使用

```bash
# Nano 是简单易用的文本编辑器
# 适合初学者和快速编辑

# 启动 Nano
nano file.txt              # 打开文件
nano +10 file.txt         # 打开文件并跳转到第10行

# 基本操作
Ctrl+O                     # 保存文件
Ctrl+X                     # 退出
Ctrl+K                     # 剪切行
Ctrl+U                     # 粘贴行
Ctrl+W                     # 搜索
Ctrl+\                     # 替换
Ctrl+G                     # 帮助
```

### 2.2 配置

```bash
# ~/.nanorc 配置文件
set tabsize 4              # Tab 宽度为 4
set autoindent             # 自动缩进
set mouse                  # 启用鼠标
set linenumbers            # 显示行号
set smarthome              # 智能 Home 键
```

## 3. cat 命令

### 3.1 基本用法

```bash
# cat 用于查看文件内容
cat file.txt               # 查看文件内容
cat -n file.txt            # 显示行号
cat -b file.txt            # 只对非空行显示行号
cat -s file.txt            # 压缩空行
cat -A file.txt            # 显示所有字符（包括特殊字符）

# 合并文件
cat file1.txt file2.txt > combined.txt

# 创建文件
cat > newfile.txt << EOF
内容行1
内容行2
EOF
```

### 3.2 常用选项

```bash
# 查看多个文件
cat file1.txt file2.txt

# 追加内容
cat >> file.txt << EOF
追加的内容
EOF

# 查看文件末尾
cat file.txt | tail -10
```

## 4. less 命令

### 4.1 基本用法

```bash
# less 用于分页查看文件内容
# 比 more 更强大，支持向前和向后翻页

less file.txt              # 分页查看文件
less +10 file.txt         # 从第10行开始查看
less +/pattern file.txt   # 从第一个匹配 pattern 的位置开始查看
```

### 4.2 导航命令

```bash
# 基本导航
Space                      # 向下翻一页
b                          # 向上翻一页
j                          # 向下移动一行
k                          # 向上移动一行
G                          # 跳转到文件末尾
g                          # 跳转到文件开头
10G                        # 跳转到第10行

# 搜索
/pattern                   # 向下搜索 pattern
?pattern                   # 向上搜索 pattern
n                          # 重复上一次搜索
N                          # 反向重复上一次搜索

# 其他命令
q                          # 退出
h                          # 帮助
v                          # 在编辑器中打开当前文件
```

### 4.3 常用选项

```bash
# 显示行号
less -N file.txt

# 忽略大小写
less -i file.txt

# 显示百分比
less -m file.txt

# 从管道读取
dmesg | less
```

## 5. more 命令

### 5.1 基本用法

```bash
# more 用于分页查看文件内容
# 只能向前翻页

more file.txt              # 分页查看文件
more +10 file.txt         # 从第10行开始查看
```

### 5.2 导航命令

```bash
# 基本导航
Space                      # 向下翻一页
Enter                      # 向下移动一行
b                          # 向上翻一页
q                          # 退出

# 搜索
/pattern                   # 搜索 pattern
n                          # 重复上一次搜索
```

## 6. head 命令

### 6.1 基本用法

```bash
# head 用于查看文件开头内容
head file.txt              # 默认显示前10行
head -n 20 file.txt       # 显示前20行
head -c 100 file.txt      # 显示前100个字节

# 查看多个文件
head file1.txt file2.txt
```

### 6.2 常用选项

```bash
# 显示行数
head -n 5 file.txt

# 显示字节数
head -c 100 file.txt

# 静默模式（不显示文件名）
head -q file.txt

# 从管道读取
dmesg | head -20
```

## 7. tail 命令

### 7.1 基本用法

```bash
# tail 用于查看文件末尾内容
tail file.txt              # 默认显示最后10行
tail -n 20 file.txt       # 显示最后20行
tail -c 100 file.txt      # 显示最后100个字节

# 实时查看文件更新
tail -f file.txt           # 实时显示新增内容
tail -F file.txt           # 实时显示，并在文件轮转时重新打开
```

### 7.2 常用选项

```bash
# 显示行数
tail -n 5 file.txt

# 实时跟踪
tail -f /var/log/syslog

# 显示字节数
tail -c 100 file.txt

# 从管道读取
dmesg | tail -20
```

## 8. 实战案例

### 8.1 配置文件编辑

```bash
# 编辑 Nginx 配置文件
sudo vim /etc/nginx/nginx.conf

# 编辑 SSH 配置文件
sudo vim /etc/ssh/sshd_config

# 编辑系统配置文件
sudo vim /etc/sysctl.conf
```

### 8.2 日志查看

```bash
# 查看系统日志
tail -f /var/log/syslog

# 查看 Nginx 访问日志
tail -f /var/log/nginx/access.log

# 查看错误日志
cat /var/log/nginx/error.log | less

# 搜索日志中的错误
grep "error" /var/log/syslog | tail -20
```

### 8.3 配置文件备份和恢复

```bash
# 备份配置文件
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

# 恢复配置文件
sudo cp /etc/nginx/nginx.conf.backup /etc/nginx/nginx.conf

# 比较配置文件差异
diff /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup
```

### 8.4 批量编辑

```bash
# 使用 sed 批量替换配置文件中的内容
sudo sed -i 's/old_value/new_value/g' /etc/nginx/nginx.conf

# 使用 awk 提取配置文件中的特定内容
awk '/server_name/ {print $2}' /etc/nginx/nginx.conf

# 使用 grep 查找配置文件中的特定配置
grep -n "listen" /etc/nginx/nginx.conf
```

## 9. 工具对比

| 工具 | 用途 | 特点 |
|------|------|------|
| vim | 文本编辑 | 功能强大，学习曲线陡峭 |
| nano | 文本编辑 | 简单易用，适合初学者 |
| cat | 查看文件 | 快速查看，适合小文件 |
| less | 分页查看 | 支持前后翻页，适合大文件 |
| more | 分页查看 | 只能向前翻页，功能简单 |
| head | 查看开头 | 快速查看文件开头内容 |
| tail | 查看末尾 | 支持实时跟踪，适合日志查看 |

## 参考资料

- `man vim`, `man nano`, `man cat`, `man less`, `man more`, `man head`, `man tail`
- [Vim 手册](https://www.vim.org/docs.php)
- [Vim 实用技巧](https://vim.rtorr.com/)
- [GNU Coreutils 手册](https://www.gnu.org/software/coreutils/manual/)
- [Nano 手册](https://www.nano-editor.org/docs.php)