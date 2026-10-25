# Text Editing and Viewing Tools

In Linux system administration, almost every config change and every log read involves text editing and viewing tools. Editors handle "changing", viewers handle "reading": the former represented by Vim/nano, the latter by less/head/tail/cat. Choosing the wrong tool -- for example, piping a several-GB log straight through `cat` -- hangs the terminal; using the wrong Vim mode -- typing `:q` in insert mode -- makes even quitting hard. This page is organized as "what to install first -> how to edit -> how to view -> real-world use and comparison", with example output from a real Ubuntu 26.04 environment.

> Editors are **not always installed by default** on each distribution -- see section 1.1 for installation; `cat`/`less`/`more`/`head`/`tail` come from coreutils/less and are generally ready out of the box.

## What This Chapter Covers

- Understand the default editor and installation method on each distribution (including Arch `pacman` package names)
- Vim mode switching, movement, editing, search-and-replace, and common configuration
- Quick editing with nano, and efficient viewing with less/cat/head/tail
- The `vi`/`editor` alternative-name mechanism and real-world scenarios

## 1. The Vim Editor

### 1.1 What Vim Is and How to Install It

Vim (Vi IMproved) is an enhanced version of vi, with mature modal editing, search-and-replace, macros, and a plugin ecosystem. It is the de facto standard terminal editor on servers. It is not a GUI program, yet it can do most of the work from editing a single line of config to bulk-refactoring a script.

```bash
# Debian/Ubuntu: sudo apt install vim
# RHEL/CentOS/Rocky: sudo dnf install vim
# Arch Linux (official extra repository): sudo pacman -S vim
vim --version | head -1
VIM - Vi IMproved 9.1 (2024 Jan 02, compiled Aug 24 2026 22:11:12)
```

**Arch package notes (important)**:

| Package | Repository | Notes |
|------|------|------|
| `vim` | extra | Full Vim, the most common one; `sudo pacman -S vim` |
| `neovim` | extra | Neovim, a modern fork of Vim, config usually in `~/.config/nvim/` |
| `nano` | extra | Simple editor |
| `ex-vi-compat` | extra | Provides POSIX `vi`/`ex` compatibility entry points, can `provides vi`; suits the "minimal vi only" case |
| `base` | -- | Meta package, **does not include** vim/nano; new installs must choose an editor themselves |

Note: there is **no** package named `vim-neovim` in the official repositories; use the real package names in the table above. You can search with `pacman -Ss vim`. Also: AUR has [neovim-symlinks](https://aur.archlinux.org/packages/neovim-symlinks) to symlink `vi`/`vim` to `nvim` (not an official repository package -- evaluate on your own). For more, see [Arch Wiki - Vim](https://wiki.archlinux.org/title/Vim), [Arch Wiki - Neovim](https://wiki.archlinux.org/title/Neovim), [Arch Wiki - Pacman](https://wiki.archlinux.org/title/Pacman), [archlinux.org vim package page](https://archlinux.org/packages/extra/x86_64/vim/), [neovim package page](https://archlinux.org/packages/extra/x86_64/neovim/), [ex-vi-compat package page](https://archlinux.org/packages/extra/x86_64/ex-vi-compat/).

### 1.2 The Four Modes

Everything awkward about Vim comes from the modes. You start in **Normal mode**, where keypresses are commands, not characters.

| Mode | How to enter | What it is for |
|------|----------|------|
| Normal | `Esc` (always return here) | move, delete, copy, paste |
| Insert | `i` `I` `a` `A` `o` `O` | type text |
| Command | `:` | save, quit, replace, jump to a line |
| Visual | `v` `V` `Ctrl+v` | select chars/lines/block, then act |

**Most common gotcha**: you cannot find `:wq` in insert mode -- press `Esc` to return to Normal mode, then type the colon. When you are unsure which mode you are in, pressing `Esc` a few times is always safe.

### 1.3 Starting, Saving, Quitting

```bash
vim file.txt              # open; vim +10 jumps to line 10; vim +/pat searches first
vim file1.txt file2.txt   # open multiple files at once
:w save  :q quit (refused if there are unsaved changes)  :wq save and quit  :q! force quit without saving
:x save if there are changes, then quit   ZZ save and quit in Normal mode   ZQ quit without saving in Normal mode
```

If a read-only config reports `E45: 'readonly' option is set`, either change permissions (`chmod`/`sudo`) or explicitly use `:w!` -- do not develop the habit of blindly overwriting read-only files.

### 1.4 Cursor Movement

```text
h j k l left/down/up/right  w b e next/prev word start, word end  0 ^ $ line start, first non-blank, line end
{ } prev/next paragraph  H M L screen top, middle, bottom  gg G file top/bottom  10G or :10 jump to line
Ctrl+d / Ctrl+u half-page down/up
```

The secret to being faster than the mouse is combinations: `d` + a motion = delete that range, `y` + a motion = yank that range, `c` + a motion = delete and enter insert mode.

### 1.5 Editing Operations

```text
i I a A o O  enter insert: before cursor, line start, after cursor, line end, new line below, new line above
x X dd D d0 dw db dG  delete char, prev line, whole line, to end, to start, to word, to end of file (combine with a motion)
yy yw y$ p P  yank line, word, to end; paste after, before cursor
u Ctrl+r U  undo, redo, undo the most recent change on this line
r R s S cw C  replace char, replace mode, delete char to insert, change to word end/line end
```

### 1.6 Searching and Replacing

```text
/pattern ?pattern  search down/up  n N next/prev match  * search for the word under the cursor
:s/old/new/ first on current line  :s/old/new/g all on current line  :%s/.../g whole file
:%s/.../gc confirm each in whole file  :10,20s/.../g lines 10-20
```

Before replacing, search `/old` first to confirm it matches, then use `%s`; for production configs, always `cp` a backup or open two windows side by side with `vim -p` for comparison.

### 1.7 Multiple Files and Split Windows

```text
:next :prev / :ls / :b2 :bn :bp :bd  file and buffer switching
:split (Ctrl+w s) horizontal split  :vsplit (Ctrl+w v) vertical split
Ctrl+w h/j/k/l move between panes   Ctrl+w = equalize sizes
```

### 1.8 Macros and Visual Block

```text
qa ... q  record a macro into register a, q to stop  @a @@ execute/repeat
v V Ctrl+v  char, line, block selection; after a block selection I...Esc inserts at line start, A...Esc appends at line end
```

To add comments to many lines at once: `Ctrl+v` to select the first column -> `I#` -> `Esc`. This is a high-frequency technique when editing configs.

### 1.9 Basic Configuration (~/.vimrc)

```vim
set number
set relativenumber
set tabstop=4 shiftwidth=4 expandtab
set autoindent smartindent
set hlsearch incsearch ignorecase smartcase
set showmatch
set wrap linebreak
set encoding=utf-8 fileencoding=utf-8
set mouse=a
syntax on
filetype plugin indent on
```

On first use, try `vimtutor` (shipped with the vim package) for about 30 minutes to get the movement and quitting basics -- it is worth more than memorizing a shortcut list. For more, see [vim.rtorr.com](https://vim.rtorr.com/) and the [Vim official docs](https://www.vim.org/docs.php).

## 2. Neovim at a Glance

Neovim is highly compatible with Vim commands. The main differences are: the default config path `~/.config/nvim/init.lua`, a more aggressive Lua configuration ecosystem, and an improved built-in terminal experience. If your team already uses Neovim, daily `dd`/`:w`/`/` search work transfers almost as-is. For installation see section 1.1 (on Arch, `pacman -S neovim`). This demo environment does not have `nvim` installed, so there is no version output.

## 3. The nano Editor

### 3.1 Who It Is For and How to Use It

nano keeps its key hints on screen at all times, so it is ideal for "just change a few lines, do not want to learn modes". Many distributions set it as the default implementation of the `editor` alternative.

```bash
# install (if not preinstalled): apt/dnf/pacman install nano
nano file.txt
nano +10 file.txt            # open and jump to line 10
# GNU nano 8.7.1 -- key hints always on at the bottom
Ctrl+O save  Ctrl+X quit  Ctrl+K cut  Ctrl+U paste  Ctrl+W search
Ctrl+\ replace  Ctrl+G help  Alt+U undo  Alt+E redo
```

### 3.2 Configuration (~/.nanorc)

Common settings: `set tabsize 4`, `set autoindent`, `set linenumbers`, `set smarthome`, `set mouse` -- like Vim's `~/.vimrc`, this is a "configure once, benefit everywhere" personal baseline; put it in a dotfiles repo and you can restore it on a new machine in seconds.

The `vi` and `editor` you type on the command line are usually not a fixed binary, but an **alternatives / alternative name** that points to the current implementation. On Debian/Ubuntu, check with:

```bash
update-alternatives --display vi && update-alternatives --display editor
# vi - auto mode -> /usr/bin/vim.basic   editor - auto mode -> /bin/nano
readlink -f "$(which vi)" "$(which editor)"
/usr/bin/vim.basic
/bin/nano
dpkg -l | grep -E 'vim|nano' | awk '{print $1,$2,$3}'
ii nano 8.7.1-1ubuntu0.1
ii vim 2:9.1.2141-1ubuntu4.9
```

Common packages on RHEL/CentOS/Rocky: `vim-minimal` (provides basic `vi`), `vim-enhanced` (full `vim`), `neovim` (often in EPEL), `nano`. For Arch see the table in section 1.1; use `pacman -Qs 'vim|nano'` to query installed packages. If a script depends on "vi exists", check with `command -v vi`, do not hardcode `/usr/bin/vim`.

## 4. cat - Whole-File Viewing and Concatenation

```bash
cat file.txt / cat -n / -b / -s / -A   # as-is, line numbers, number non-empty only, squeeze blank lines, show ^I and $
cat file1.txt file2.txt > combined.txt # concatenate and merge
# cat -A measured: ^I=Tab, $ at end of line
server {$
^Ilisten 80;$
}$
cat > notes.txt << 'EOF'               # create and write
line one
EOF
cat >> notes.txt << 'EOF'              # append
line three
EOF
```

**Gotcha**: `cat bigfile | less` is fine, but `cat bigfile | grep foo` adds a pointless hop -- just `grep foo bigfile` is cheaper. Piping a very large file entirely through `cat` can also cause memory spikes. `cat`'s real job is "concatenation"; for viewing, follow the choices below.

## 5. less - Paginated Viewing (The Default Choice)

less supports forward/backward paging, search, and jumping; quitting is just `q`. It is the default choice for big files and pipes.

```bash
less file.txt / less +10 / less +/pat   # open and jump to a line / search
dmesg | less / less -N / less -i         # pipe, line numbers, ignore case
# less 668 (GNU regular expressions)
# keys: Space, f next page  b prev page  j, k line  g, G top/bottom  10G jump to line  /, ? search  q quit  h help
```

**Gotcha**: in a pipe, `less` buffers all input before showing the interface (depending on the implementation and options like `--no-init`). For a long real-time stream you are "generating and watching at the same time", prefer `tail -f` or `journalctl -f`.

## 6. more - Simple Forward-Only Paging

more only pages forward, with fewer features than less, but simpler dependencies and still present in some minimal environments. It suits "glance at the first few screens and quit".

```bash
more file.txt / more +10 file.txt
# Space, Enter next page/line  b up (some implementations)  q quit  /pattern search
# more from util-linux 2.41.3
```

For new scripts and docs, prefer `less`; for interactive teaching, the rule of thumb is "more is nice to know, less is must know".

## 7. head / tail - Head, Tail, and Live Logs

```bash
head file.txt / head -n 20 / head -c 100    # default 10 lines, specified line count, first 100 bytes
tail file.txt / tail -n 20 / tail -c 100    # default last 10 lines
tail -f /var/log/syslog    # follow appended writes
tail -F /var/log/app.log   # reopen automatically after rotation
tail -n +18 file.txt       # from line 18 to the end
# log troubleshooting combos
tail -100 app.log
grep -i error app.log | tail -50
less +G app.log            # jump straight to the end and search
```

**Gotchas**:

- The common path on RHEL/CentOS/Rocky is `/var/log/messages`, on Debian/Ubuntu it is `/var/log/syslog`; on systemd systems prefer `journalctl -u service_name -f`.
- `tail -f` may stall on the old inode after log rotation; use `-F`, or pair with the `copytruncate`/`create` rotation strategy.
- `-n` and `-c` differ in meaning: lines versus bytes; for binary or newline-less files you only have `-c`.

## 8. Real-World Examples

### 8.1 Editing Configuration and Validating

```bash
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
sudo vim /etc/nginx/nginx.conf
nginx -t                      # test syntax before and after
sudo systemctl reload nginx
diff -u /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf
```

SSH config and sysctl are the same: **back up -> edit -> syntax check -> gradual apply -> diff for the record**. Forgetting `nginx -t`/`sshd -t` is the main cause of rollbacks.

### 8.2 Locating Errors in Logs

```bash
grep -n -i "error" /var/log/syslog | tail -20
less +/error /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```

After `grep -n` keeps the line numbers, you can `vim +412 app.log` to jump straight to that line's context.

### 8.3 The Minimal Loop Without a GUI

When you have only SSH and do not know what editor is installed:

```bash
command -v nano && nano file || command -v vim && vim file || vi file
```

Or first check what is installed with `pacman -Qs 'vim|nano'` / `dpkg -l | grep -E 'vim|nano'`, then install. On a minimal Arch system, remember `pacman -S vim` or `pacman -S nano`; do not assume an editor ships in `base`.

## 9. Tool Comparison and Choosing

| Tool | Role | When to use | When not to use |
|------|------|--------|----------|
| Vim | Full-featured modal editing | Long-term config editing, scripts, bulk operations | Never learned it but must edit a production file in 10 seconds (use nano or try `vimtutor` first) |
| nano | Simple editing | Quick changes, teaching | You need macros, split windows, or large-scale refactoring |
| less | Paginated viewing | Big files, pipes, back-and-forth paging | You need to modify the file (use an editor) |
| more | Simple forward paging | Glancing at the first few screens | Deep searching in big files |
| cat | Concatenation / small-file direct output | Merging multiple files, `cat` into a pipe | Viewing very large files |
| head/tail | Head, tail, and live | Logs, extracting snippets | Random jumps into the middle of a file (less is better) |

**Rule of thumb**: if you do not know how big, use `less`; if you only need head or tail, use `head`/`tail`; to edit, use `vim` (or whatever editor you know); to edit multiple places, back up first, then `vim`/`sed -i.bak`.

## 10. Common Gotchas Quick Reference

| Symptom | Cause | Fix |
|------|------|------|
| Keys in Vim "do nothing / delete randomly" | Treating insert mode as normal mode, or vice versa | `Esc` back to normal mode and check the mode indicator at the bottom |
| `:q` errors and cannot quit | There are unsaved changes | `:wq` or `:q!` |
| Saving a read-only file fails | Permissions or `readonly` | Reopen with `sudo` or explicitly `:w!` |
| `cat bigfile` hangs the terminal | Dumping the whole file at once | Use `less`/`head`/`tail` instead |
| `tail -f` log does not move | Wrong path / rotated / no new writes | Confirm the path, use `-F` or `journalctl -f` |
| No vim/nano on the system | Minimal install does not include an editor | `apt/dnf/pacman -S vim` or `nano` |
| `vi` behaves strangely in a script | The alternative points to a different implementation | Check with `readlink -f $(which vi)` |
| `cat -A` shows lots of `^I`/`$` | That is exactly Tab and end of line | Use it to debug formatting issues, not garbled text |

## 11. Differences Across the Three Distributions

| Item | Debian/Ubuntu | RHEL/CentOS/Rocky | Arch |
|------|---------------|-------------------|------|
| Full Vim package | `vim` | `vim-enhanced` | `vim` (extra) |
| Minimal vi | `vim-tiny` | `vim-minimal` | `ex-vi-compat` etc. |
| nano | `nano` | `nano` | `nano` |
| Neovim | `neovim` | `neovim` (often EPEL) | `neovim` |
| Install command example | `sudo apt install vim` | `sudo dnf install vim-enhanced` | `sudo pacman -S vim` |
| `editor` common default | nano | nano (depending on minimal install) | install and configure yourself |
| Default log viewing path | `/var/log/syslog` | `/var/log/messages` | `journalctl` preferred |

## References

- `man vim`, `man nano`, `man cat`, `man less`, `man more`, `man head`, `man tail`
- man vim (Arch) -- [man.archlinux.org](https://man.archlinux.org/man/vim.1)
- man nano -- [man.archlinux.org](https://man.archlinux.org/man/nano.1)
- man less -- [man.archlinux.org](https://man.archlinux.org/man/less.1)
- man more -- [man.archlinux.org](https://man.archlinux.org/man/more.1)
- man cat -- [man.archlinux.org](https://man.archlinux.org/man/cat.1)
- man head -- [man.archlinux.org](https://man.archlinux.org/man/head.1)
- man tail -- [man.archlinux.org](https://man.archlinux.org/man/tail.1)
- Vim manual -- [vim.org](https://www.vim.org/docs.php)
- Vim shortcut cheatsheet -- [vim.rtorr.com](https://vim.rtorr.com/)
- Arch Wiki - Vim -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Vim)
- Arch Wiki - Neovim -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Neovim)
- Arch Wiki - Pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - Base meta package -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Base_meta_package)
- Nano official docs -- [nano-editor.org](https://www.nano-editor.org/docs.php)
- archlinux.org: vim -- [archlinux.org](https://archlinux.org/packages/extra/x86_64/vim/)
- neovim -- [archlinux.org](https://archlinux.org/packages/extra/x86_64/neovim/)
- ex-vi-compat -- [archlinux.org](https://archlinux.org/packages/extra/x86_64/ex-vi-compat/)
- Debian manual -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Rocky Linux documentation -- [docs.rockylinux.org](https://docs.rockylinux.org/)
- Red Hat documentation -- [access.redhat.com](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - File and directory management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [text](/commands/text.md)
- [text_processing](text_processing.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
