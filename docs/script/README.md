# 脚本篇

Shell 脚本编程是 Linux 系统管理和自动化的基础技能。

> 内容参考自 Bash 手册、Advanced Bash-Scripting Guide 和实际运维经验，见各章节参考资料。

## 学习目标

- 掌握 Bash 脚本基础语法和调试技巧
- 学会使用变量、数组、条件判断和循环
- 掌握函数定义和文本处理工具
- 了解正则表达式和 sed/awk 高级用法
- 能够编写实用的自动化脚本

## 内容

| 章节 | 内容 |
|------|------|
| [Bash 基础](./bash-basics.md) | 脚本结构、执行方式、引号规则、特殊字符 |
| [变量与数据类型](./variables.md) | 变量定义、环境变量、数组、算术运算 |
| [条件判断](./conditionals.md) | if/else、case、逻辑运算符、文件测试 |
| [循环结构](./loops.md) | for、while、until、循环控制 |
| [函数](./functions.md) | 函数定义、参数、返回值、局部变量 |
| [文本处理](./text-processing.md) | grep、sed、awk 实战 |
| [正则表达式](./regex.md) | 基础正则、扩展正则、PCRE |
| [脚本调试](./debugging.md) | 调试技巧、错误处理、日志记录 |
| [实战案例](./examples.md) | 系统监控、自动备份、日志分析等 |

## 快速入门

```bash
#!/bin/bash
# 第一个脚本

echo "Hello, World!"
echo "当前时间: $(date)"
echo "当前用户: $(whoami)"
```

## 参考资料

- [Bash 手册](https://www.gnu.org/software/bash/manual/)
- [Advanced Bash-Scripting Guide](https://tldp.org/LDP/abs/html/)
- [ShellCheck](https://www.shellcheck.net/) - 脚本静态分析工具
- [Google Shell Style Guide](https://google.github.io/styleguide/shellguide.html)
