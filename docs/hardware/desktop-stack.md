# Desktop Graphics Stack

From the GPU driver inside the kernel to a single pixel on screen there are five software layers in between: miss or break any one of them and the screen stays black. A minimal server install has no desktop, and what it is missing is this whole chain — this page walks "graphics hardware → display stack" in order and tears it apart layer by layer, so when you hit the classic scenes of "will not install, will not start, corrupted display, no fonts" you know where to look at each layer.

> Content is drawn from the graphics entries of the Arch Wiki and the freedesktop/Wayland documentation; see the references at the end.

## What This Page Covers

- Drawing the layered path from GPU to pixel, and naming the observation entry point for each layer in Linux
- The architectural and security-model differences between Xorg and Wayland
- Telling apart the three often-confused roles of display manager, window manager, and desktop environment
- Choosing between an open-source and a proprietary driver for a given GPU, and explaining what linux-firmware and DKMS do after a kernel upgrade
- Assembling the minimum viable graphics session on any of the three distro families using metapackages
- Making an evidence-based call on "should a server carry a desktop at all", and naming the alternatives

## 1. The Layered Path: How Many Layers Between GPU and Pixel

A server install usually only reaches layer 2: the kernel ships DRM/KMS and open-source drivers (otherwise even console resolution falls back to firmware), but there is nothing at layer 3 or above. A desktop distro has all five.

```text
┌──────────────────────────────────────────────────┐
│ 5 application Firefox, terminal emulator, editor │
│            (GTK/Qt toolkits draw widgets/text)   │
├──────────────────────────────────────────────────┤
│ 4 session      DE: GNOME / KDE Plasma / XFCE     │
│            or a standalone WM: i3 / sway         │
├──────────────────────────────────────────────────┤
│ 3 display server Xorg or Wayland compositor      │
│            (X11 apps run via XWayland)           │
├──────────────────────────────────────────────────┤
│ 2 kernel GFX   DRM/KMS subsystem + GPU driver    │
│            i915 / amdgpu / nouveau / nvidia      │
├──────────────────────────────────────────────────┤
│ 1 hardware     GPU · VRAM · monitor · input      │
└──────────────────────────────────────────────────┘
```

Every layer has its own observation entry point; troubleshoot bottom-up, confirming layer by layer:

| Layer | Component | Responsibility | Observation entry point |
|----|------|------|----------|
| Hardware | GPU, monitor, input devices | the physical basis of rendering and display | `lspci -tv` |
| Kernel GFX | DRM/KMS + driver | mode setting, VRAM management, command submission | `lspci -k`, `dmesg` |
| Display server | Xorg / Wayland compositor | takes over input and output, allocates window surfaces | `echo $XDG_SESSION_TYPE` |
| Session layer | desktop environment or window manager | panel, tray, hotkeys, window policy | `echo $DESKTOP_SESSION` |
| Application | GTK/Qt apps, xdg-desktop-portal | draws the UI, requests screenshots/files and so on via the portal | `ldd $(which app)` |

Whether the GPU entry in `lspci -k` shows `Kernel driver in use` corresponds exactly to the "is the driver bound" question from section 3 of [Computer Architecture](./architecture.md) — the first move of graphics-stack troubleshooting is identical to checking a NIC.

```bash
lspci -k | grep -A3 -i vga          # GPU model and the driver bound to it
dmesg | grep -i drm | head -5       # DRM subsystem initialization records
echo "$XDG_SESSION_TYPE"            # x11 / wayland / tty
echo "$WAYLAND_DISPLAY$DISPLAY"     # a value in wayland-0 = Wayland; :0 = X11
```

## 2. Xorg and Wayland: Two Models

### 2.1 Architectural Differences

X11 uses a client/server model: Xorg is the "server", holding the GPU and input/output exclusively; Firefox, the terminal, and other applications are "clients" that send drawing instructions to the server over the X11 protocol — "draw a window, write a line of text" — and the actual drawing happens on the server side. The model was born in the 1980s for networked terminals; when running locally the client and server sit on the same machine, but the protocol is still designed as if it were "across the network".

Wayland defines only a protocol for window surfaces and input events, with no separate server process: the compositor holds both the display-server and the compositing roles at once. Each client renders into its own buffer via EGL/Vulkan, "hands" the buffer to the compositor, and the compositor assembles them into the final frame. Drawing happens inside the client's own process — that is the most essential difference from X.

| Comparison | Xorg | Wayland compositor |
|--------|------|----------------|
| Model | client/server, server proxies the drawing | the compositor assembles the client-drawn buffers directly |
| Drawing location | server side (client sends draw commands) | inside the client process, self-drawn |
| Window decoration and compositing | depends on extensions (Composite, cooperation with the WM) | native to the protocol, handled centrally by the compositor |
| Screenshot/screen recording | any client can read directly | must be authorized through xdg-desktop-portal |

### 2.2 Security-Model Differences

Under the X11 protocol clients of the same X server are barely isolated from each other: any client can read another client's window contents and listen to global keyboard events. In other words, the password you type in a terminal can theoretically be picked up by another process in the same session. That was tolerable in the single-user desktop era, but today it is a real security gap.

Wayland isolates at the protocol level: a client can only touch its own surface and its own input; screenshots, screen recording, and global hotkeys all must go through a controlled channel such as xdg-desktop-portal and be authorized by the user each time. The price is that some legacy software that depends on "global hooks" (some password managers, remote-assist tools) loses functionality under pure Wayland.

### 2.3 Current State and the Compatibility Layer

Mainstream desktops have completed the default switch to Wayland: GNOME defaults to Wayland on recent Fedora Workstation and Ubuntu releases; KDE Plasma defaults to a Wayland session from 6.0 onward (released 2024); XFCE still defaults to X11 as of 4.20, with Wayland support in experimental status (defer to what your distro actually packages). The session choices on the login screen are, at bottom, the difference between the `.desktop` files in `/usr/share/wayland-sessions/` and `/usr/share/xsessions/`; see section 4.

Existing X11 applications do not vanish overnight; XWayland is the compatibility layer: it is an X server running inside a Wayland session, old applications connect to it and work as usual, and the compositor then composites its output. To tell which path an application takes, look at the environment variables or read the process tree directly.

```bash
pstree -p | grep -i xwayland        # an XWayland process present = X11 apps running in the session
ps -o comm= -p "$(xprop -root _NET_SUPPORTING_WM_CHECK \
  | grep -o '[0-9]\+')" 2>/dev/null # find the WM under an X11 session; under Wayland xprop has no root window
GDK_BACKEND=x11 firefox             # force a GTK app over XWayland, for A/B troubleshooting
```

## 3. The Display Manager: The Layer That Logs You In and Starts the Session

The display manager (DM) runs under `graphical.target` after boot and does two things: it provides a graphical login screen, and it starts the desktop for the session you pick. It is not the desktop itself — that login "screen" is just a login box; whether GNOME or i3 starts is decided entirely by which session file it hands off to.

| Display manager | Common pairing | Notes |
|-----------|---------|------|
| GDM | GNOME | GNOME's official companion; Debian package name `gdm3` |
| SDDM | KDE Plasma | Plasma's official companion, Qt-based |
| LightDM | XFCE and the like | lightweight, several greeters (login screens) available |
| greetd | sway, i3 and other WMs | minimal, usually paired with tuigreet/gtkgreet, no full graphical UI |

`systemctl status display-manager` shows whichever one is currently running (it is an alias pointing at the real service); `loginctl list-sessions` shows both the DM's own session and your user session after login. When swapping DMs, `disable` the old one before `enable`-ing the new — two enabled at once will fight over `display-manager.service`.

```bash
systemctl status display-manager    # which display manager is running, and did it come up
systemctl cat display-manager       # see which unit it actually points to, gdm3/sddm/lightdm
sudo systemctl disable --now gdm3   # Debian/Ubuntu: turn off GDM (the service name has a 3)
sudo systemctl enable sddm          # switch to SDDM: takes effect after reboot once enabled
```

You can reach the graphical interface without a DM: install `xorg-xinit` (Debian ships it in the `xinit` package) and use `startx` to start a session from `~/.xinitrc`. That is exactly the foundation of the "minimal graphics interface" approach in section 7.

## 4. Desktop Environments and Window Managers

### 4.1 Dividing the Labor Between a Full DE and a Standalone WM

A desktop environment (DE) is a bundle of software: window manager, panel, file manager, settings center, and theming framework packaged together, giving a complete out-of-the-box experience. A standalone window manager (WM) does only the one thing of placing and switching windows — the status bar, launcher, and wallpaper are all yours to assemble. Cost for benefit: the full GNOME/Plasma suites often run to hundreds of MB, while i3 plus a status bar gets by on a few tens of MB; memory footprint and upgrade burden differ by an order of magnitude too.

| Component | Type | Built-in WM | Default display protocol |
|------|------|---------|-------------|
| GNOME | full desktop | Mutter | Wayland (X11 session optional) |
| KDE Plasma | full desktop | KWin | Wayland (default from Plasma 6) |
| XFCE | full desktop (lightweight) | Xfwm4 | X11 (Wayland experimental) |
| i3 | standalone WM (tiling) | — | X11 |
| sway | standalone WM (tiling) | — | Wayland (the Wayland implementation of i3) |

### 4.2 Session Files: Where the Login-Screen Options Come From

The DM's session menu reads the `.desktop` files in two directories: `/usr/share/xsessions/` holds X11 sessions, `/usr/share/wayland-sessions/` holds Wayland sessions. If you install `plasma` without `plasma-wayland-session` (Arch), the Wayland option is absent from the login screen because that file is missing from the directory. To add a custom entry, copy one and edit `Exec`; the user-level directories are `~/.local/share/xsessions/` and `~/.local/share/wayland-sessions/`.

```bash
ls /usr/share/xsessions/ /usr/share/wayland-sessions/ 2>/dev/null
cat /usr/share/wayland-sessions/sway.desktop   # the Exec= line is the startup command
echo "$DESKTOP_SESSION"                        # current session name, matching the file name above
```

## 5. GPU Drivers and Firmware

### 5.1 Open-Source and Proprietary Drivers

Intel and AMD GPUs use the kernel's built-in open-source drivers (`i915`/`amdgpu`), with firmware supplied by `linux-firmware` and no extra install needed. NVIDIA is the classic dilemma: the open-source `nouveau` was reverse-engineered by the community without official cooperation, so support for new cards and power management is incomplete and performance is clearly limited; the proprietary `nvidia` driver gives full performance but is an out-of-tree module that must be rebuilt on every kernel upgrade, and it has long lagged on some Wayland features (paths other than GBM, early support for PRIME hybrid output) — NVIDIA has improved Wayland support from the 545 series onward, but choosing it still means accepting the maintenance cost of "rebuilding to the kernel's rhythm".

| Driver | Applies to | Pros | Cost |
|------|------|------|------|
| i915 / amdgpu | Intel, AMD GPUs | built into the kernel, updated with the kernel, full Wayland support | optimization varies for older cards |
| nouveau | NVIDIA GPUs | fully open source, works out of the box | no official firmware cooperation, performance and power management limited |
| nvidia (proprietary) | NVIDIA GPUs | full performance, official support | out-of-tree module, must be rebuilt on kernel upgrade (DKMS) |

### 5.2 linux-firmware and DKMS

`linux-firmware` is the collection of firmware (microcode and runtime code) that the kernel loads; drivers such as amdgpu must pull the matching firmware file for their chip from it at startup, and a missing file produces `failed to load firmware`-type errors in `dmesg` with the GPU failing to initialize outright. The package name is identical on the three families: Debian/Ubuntu `linux-firmware`, Arch `linux-firmware`, RHEL/Rocky the same — one of the key packages most often stripped from a minimal install.

DKMS (Dynamic Kernel Module Support) rebuilds out-of-tree modules automatically after a kernel upgrade. A proprietary NVIDIA driver installed via DKMS can, at the moment a new kernel is installed, still have its module unbuilt or its build failed — a black screen on reboot with `nvidia-smi` not finding the device is usually this window. The way to tell is to compare the module's current version against its DKMS registration state:

```bash
dkms status                         # registered modules: installed or broken?
pacman -Q linux nvidia-dkms         # Arch: are the kernel and module package versions matched
ls /usr/lib/modules/$(uname -r)/updates/dkms/ 2>/dev/null   # did the module land under the new kernel
```

## 6. Fonts and Input Method

### 6.1 fontconfig and CJK Fonts

Text in applications goes through fontconfig's font matching: the app issues a request like "I want a sans-serif font", and fontconfig picks one according to the rules in `/etc/fonts/` and the installed font library. A minimal-install server often has only Latin fonts, so Chinese pages render as a row of tofu boxes — this is not an encoding problem, the library simply has no font covering CJK. To confirm and fix:

```bash
fc-list :lang=zh | head -5          # list fonts covering Chinese; empty output = tofu boxes ahead
sudo apt install fonts-noto-cjk     # Debian/Ubuntu
sudo pacman -S noto-fonts-cjk       # Arch
sudo dnf search noto cjk            # RHEL/Rocky: package name varies by version, search before installing
fc-cache -f                         # refresh the font cache by hand (sometimes needed after a new install)
```

### 6.2 Input Method Frameworks

Chinese input needs an input method framework to transcribe: the application states its intent "I want to input", the framework takes over the keys, produces candidates, and hands the result back. Under X11 this flow is an agreement of environment variables: `GTK_IM_MODULE` and `QT_IM_MODULE` tell the toolkits which framework to use, and `XMODIFIERS=@im=fcitx` tells the X layer that the global input method is fcitx. fcitx5 and ibus are both frameworks of this kind; GNOME ships ibus built in.

Under Wayland the path is different: keyboard input is received centrally by the compositor and flows between compositor, input method, and application over the text-input protocol in wayland-protocols (such as `zwp_text_input_v3`) plus the input method protocol, so environment variables matter less. In practice the same configuration behaves differently in the two sessions — ibus works out of the box under GNOME Wayland, fcitx5 works well under KDE Wayland with Plasma 6's text-input support, while other combinations need environment variables added by hand or the framework's Wayland front end. When troubleshooting, confirm the session type first (`echo $XDG_SESSION_TYPE`), then pick the configuration location by session: X11 writes `~/.xprofile`, and under Wayland most compositors read `~/.config/environment.d/*.conf`.

## 7. Three-Family Install Comparison: The Minimum to Reach a Graphical Interface

| Goal | Debian/Ubuntu | Arch | RHEL/Rocky |
|------|---------------|------|------------|
| Full desktop | `apt install ubuntu-desktop` (GNOME) | `pacman -S gnome` + `systemctl enable gdm` | `dnf groupinstall "Server with GUI"` |
| Full KDE | `apt install kubuntu-desktop` | `pacman -S plasma-meta sddm` + `systemctl enable sddm` | `dnf groupinstall "Workstation"` |
| Minimal X + WM | `apt install xorg openbox` | `pacman -S xorg-server xorg-xinit openbox` | see the note below |

The minimal path is worth a separate look — it is the most used approach for "a server that needs a graphical interface temporarily":

```bash
# Minimal X11 session on Debian/Ubuntu and Arch
apt install xorg openbox            # Debian: the xorg metapackage already includes xinit
pacman -S xorg-server xorg-xinit openbox   # Arch: split finer, xinit must be installed separately
echo "exec openbox-session" > ~/.xinitrc   # startx reads it by default to decide what to start
startx                              # enter openbox; exiting returns you to the console
```

RHEL/Rocky group installs are coarser; the minimal approach is to install the X window base group and then add a WM — group names shift across major versions, so defer to the actual output of `dnf group list` (a name such as `base-x` could not be confirmed from public comps sources when this draft was checked, so do not copy it blindly: check first, install second); `dnf groupinstall "Server with GUI"` gives a complete graphical environment with GNOME + GDM. After installing, check the default boot target: a minimal-install server often stops at `multi-user.target`, and without switching you will never see a login screen.

```bash
systemctl get-default               # the current default target
sudo systemctl set-default graphical.target   # switch to graphical login
```

## 8. Should a Server Carry a Desktop

The clear call: production servers do not get a desktop. The reasoning rests on three points — attack surface (a full GUI plus a browser is a whole extra batch of components that need security updates tracked), resources (a desktop session resident hundreds of MB of memory and running background processes continuously, squeezing the business headroom), and necessity (a desktop gives nothing irreplaceable for administering a server; the three alternatives below cover almost every scenario):

| Need | Alternative | Notes |
|------|---------|------|
| Web-based graphical management | Cockpit (shipped with RHEL) | after `dnf install cockpit`, enable the socket and reach it over the browser on port 9090 |
| Run one GUI program occasionally | X forwarding | `ssh -X user@host`; the program's window shows locally and only that program is installed on the server |
| A persistent full desktop is genuinely needed | VNC | install minimal X + WM, bring it up on demand, and shut it down after use |

X forwarding suits "I just want to run a graphical configuration tool like `system-config-*`" — low bandwidth use, no resident service. VNC suits training environments or the occasional case that genuinely needs a long-lived graphical session, but it exposes a port, so it must sit behind an SSH tunnel or VPN. If you really do install a desktop, install the "minimal X + WM" from section 7 rather than a full DE, and make the session start on demand instead of at boot.

## 9. Troubleshooting Entry Points

1. **Black or corrupted screen: start at the kernel layer.** Switch TTY (Ctrl+Alt+F3) or get in over SSH: `dmesg | grep -iE "drm|gpu"` for driver initialization and firmware load errors; `lspci -k` to confirm `Kernel driver in use` is present. For a proprietary driver, run `dkms status` against the kernel version. Emergency validation: add `nomodeset` to the kernel command line to force KMS off — if the screen comes up, the problem is in the driver layer, not the display cable.
2. **DM will not start: read the journal.** `systemctl status display-manager` for state, `journalctl -b -u gdm` (swap the service name for sddm/lightdm) for the startup log; when the unit log is not enough, widen to `journalctl -b | grep -iE "gdm|sddm|xinit"`. Common root causes: after swapping DMs both services are still enabled; a GPU driver crash drags the DM down with it (back to the previous point); a full disk means the session cannot write its logs.
3. **A legacy X application misbehaves under a Wayland session: troubleshoot via XWayland.** First `echo $XDG_SESSION_TYPE` to confirm you really are in Wayland; force XWayland with `GDK_BACKEND=x11 app` or `QT_QPA_PLATFORM=xcb app` for comparison — if the problem persists, it belongs to the application itself, not Wayland; `journalctl -b | grep -i xwayland` for XWayland's own crash records. If the input method fails inside a specific Wayland app, confirm text-input support per section 6.2 — do not apply the X11 environment-variable conclusion here.
4. **Chinese rendering as tofu boxes is a font problem, not an encoding one.** Empty output from `fc-list :lang=zh` means CJK fonts are missing; install them per section 6.1, then `fc-cache -f` and restart the application — no locale configuration needs changing at all.

## References

- Arch Wiki - Graphics category — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Graphics)
- Arch Wiki - Xorg — [wiki.archlinux.org](https://wiki.archlinux.org/title/Xorg)
- Arch Wiki - Wayland — [wiki.archlinux.org](https://wiki.archlinux.org/title/Wayland)
- freedesktop.org — [freedesktop.org](https://www.freedesktop.org/)
- Ubuntu desktop documentation — [ubuntu.com](https://ubuntu.com/desktop)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [authoritative-books](/research/authoritative-books.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [official-docs](/research/official-docs.md)
