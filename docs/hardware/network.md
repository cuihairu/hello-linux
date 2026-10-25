# Network Devices

When troubleshooting "the network is down", most people start from IP and routing — not wrong, but there is a whole class of problems that never reach the protocol stack: a loose cable, the link negotiated to 100M half duplex, no driver bound, firmware not loaded, all interrupts piled onto one core. This page covers, from the **hardware viewpoint**, the facts of "before a packet enters the Linux network stack": NIC structure, PCIe attachment, drivers and `ethtool`, interrupts and multi-queue, link negotiation, and the wireless regulatory domain. How IP gets configured, how routing and DNS get troubleshot, how the firewall gets read — those are the job of [the Network pages](../network/README.md) — together the two form the complete chain from the RJ45 plug to the application layer.

> Content is drawn from the Arch Wiki, the ethtool manual, and kernel networking documentation; see the references at the end.

## What This Page Covers

- Understanding a NIC's PHY/MAC/DMA/PCIe structure
- Confirming device and driver binding with `lspci -k` + `ethtool -i`, and troubleshooting "the NIC is not recognized"
- Fluently using `ethtool` to inspect link, statistics, offloads, and queues
- Understanding interrupt affinity and RSS multi-queue
- Separating hardware-side facts like interface naming and the wireless regulatory domain from the Network pages' configuration topics

## Division of Labor with the Network Pages

| Layer | This page (hardware view) | [Network pages](../network/README.md) (software view) |
|------|------------------|-----------------------------------------------|
| Physical/link | NIC structure, PHY/MAC, duplex negotiation, cabling and optical modules | — |
| Driver | `lspci -k`, `ethtool -i`, module loading, firmware | — |
| Interrupts/DMA | IRQ spreading, RSS multi-queue, Ring Buffer, offload | — |
| Interface naming | why it is called `enp3s0` and not `eth0` (set by hardware topology) | how interfaces get addresses and routes |
| L3 and up | — | [Network configuration](../network/network-configuration.md), [troubleshooting](../network/troubleshooting.md), [firewall](../network/firewall.md) |

A suggested order of judgment: first use this page to confirm **the hardware and driver exist and the link is up** (`ip link` for `UP`, `ethtool` for `Link detected`), then enter the Network pages with the premise "the physical layer works" to chase addresses, routing, DNS. Do it the other way around and you will spend half a day capturing packets on a machine with a loose cable. All example interface names on this page use `enp3s0`; substitute your machine's real names from `ip link`.

## 1. The Structure of a NIC

### 1.1 Components and the Data Path

```text
┌───────────────────────────────────────┐
│                  NIC                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │RJ45/SFP │→│  PHY    │→│  MAC    │  │
│  │  port   │ │  layer  │ │  ctrl   │  │
│  └─────────┘ └─────────┘ └────┬────┘  │
│                               ↓       │
│  ┌──────────────────────────────────┐ │
│  │ DMA engine (direct host memory)  │ │
│  └────────────────┬─────────────────┘ │
│                   ↓                   │
│  ┌──────────────────────────────────┐ │
│  │ PCIe interface (CPU/chipset)     │ │
│  └──────────────────────────────────┘ │
└───────────────────────────────────────┘
```

| Component | Function | Why it matters for troubleshooting |
|------|------|---------|
| PHY | physical-layer signal transmit/receive (encoding, auto-negotiation) | the scene of duplex/speed negotiation errors |
| MAC controller | frame encapsulation/decapsulation, CRC checking | the error counters in `ethtool -S` come from this layer |
| DMA engine | moves frames straight into host memory, no CPU copy | consumes memory bandwidth at high rates; IOMMU matters for passthrough security |
| PCIe interface | interconnect to the host | what `lspci` enumerates; x1/x4/x8/x16 width caps throughput above 10G |

String the receive path together: the PHY receives the signal → the MAC validates and frames → DMA writes into a pre-allocated Ring Buffer → an interrupt/poll notifies the kernel driver → the driver hands the skb to the kernel protocol stack. **This page covers up to the driver handoff**; IP/routing/TCP after the skb belongs to the Network pages. With this path in mind, the three tuning points that follow — `ethtool -G` (Ring size), `ethtool -k` (offload), `/proc/interrupts` (interrupts) — finally have coordinates: they act on the three hardware stages of DMA buffering, MAC offload, and interrupt notification respectively.

### 1.2 NIC Types at a Glance

| Type | Speed | Interface | Use case |
|------|------|------|---------|
| Gigabit | 1 Gbps | RJ45 | desktops and entry servers; `igb`/`e1000e`/`r8169` common |
| 10 Gigabit | 10 Gbps | RJ45(SFP+) | virtualization hosts, storage networks |
| 25G/100G | 25/100 Gbps | SFP28/QSFP28 | data centers (Mellanox `mlx5` common) |
| Wireless | Wi-Fi 5/6/6E/7 | antenna | laptops and APs; constrained by the regulatory domain (section 6) |

## 2. Knowing the Network Hardware: From lspci to Interface Naming

### 2.1 lspci: The Reconciliation Sheet of Devices and Drivers

```bash
$ lspci -k | grep -A3 -i "Ethernet\|Network"
03:00.0 Ethernet controller: Intel I350 Gigabit Network Connection
        Subsystem: Intel I350 Gigabit Network Connection
        Kernel driver in use: igb        ← driver bound
        Kernel modules: igb
```

The `Kernel driver in use` line is the watershed of hardware troubleshooting: **with it, the device is in the kernel's hands — go check link and configuration next; without it, the interface will never appear — go check driver and firmware** (section 4). `lspci` is preinstalled by default (`pciutils`); if missing: Debian/Ubuntu `apt install pciutils`, Arch `pacman -S pciutils`, RHEL `dnf install pciutils`. Wireless NICs answer to `lspci | grep -i network`; USB NICs to `lsusb` (the `usbutils` package).

### 2.2 Why the Interface Is Called enp3s0

Before Linux 2.6, interfaces were named `eth0`/`eth1` in driver probe order — **the order can change across reboots or added cards**, the most hidden time bomb in old scripts. Modern systemd distros enable **predictable naming** by default: names like `enp3s0` (onboard/PCI Ethernet: `en` + PCI location `p3s0`) and `wlp2s0` (wireless) are generated from firmware/topology, with fixed meaning — `enp3s0` is precisely "the Ethernet port at PCI bus 3 slot 0"; it changes when you change card or slot, but the rule "position is identity" never does.

```bash
ip link show   # these names are authoritative; do not copy the eth0 from documentation
# 2: enp3s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ... state UP
```

Of `<BROADCAST,MULTICAST,UP,LOWER_UP>`, **only `LOWER_UP` means "the light is on"**: an interface that is `UP` without `LOWER_UP` has its administrative state enabled but no physical link — check the cable, the switch port, the far end. This field is the first fork in hardware-view troubleshooting; once you have the "physical layer works" verdict, move IP and routing questions to [the Network pages - troubleshooting](../network/troubleshooting.md).

## 3. ethtool: Talking to the NIC

`ethtool` reads and writes the parameters a NIC's firmware and driver expose; it is the core tool of the hardware view. The package name is identical on the three families: Debian/Ubuntu `sudo apt install ethtool`, Arch `sudo pacman -S ethtool`, RHEL/CentOS/Rocky `sudo dnf install ethtool`; see section 7 and [the README quick-reference table](./README.md) for the full comparison.

### 3.1 Link Status and Driver Information

Read a link's state from the key fields of `sudo ethtool enp3s0`: **`Speed: 1000Mb/s`, `Duplex: Full`, `Link detected: yes`, `Auto-negotiation: on`** — the troubleshooting paths for each abnormal value are in section 5; `Duplex: Half` is almost always wrong, and a `Speed` that fell to 100Mb/s points at negotiation or cabling. Driver information comes from `ethtool -i`:

```bash
$ sudo ethtool -i enp3s0
driver: igb
version: 5.15.0-1-generic        ← driver version (check it against the vendor support list)
bus-info: 0000:03:00.0           ← matches the lspci address; cross-verify here
```

`ethtool -i` and `lspci -k` should corroborate each other: the reconciliation only succeeds when both point at the same driver. When `ethtool` says `Operation not supported` or the device does not exist while `ip link` shows the interface, suspect permissions first (most queries need root) or a mistyped interface name.

### 3.2 Statistics Counters: Which Way the Errors Grow

```bash
# Driver statistics (field names differ per driver; grab the key error items)
$ sudo ethtool -S enp3s0 | grep -E "rx_error|crc|drop|missed" | head -8
     rx_crc_errors: 0            ← sustained non-zero growth: cabling/EMI/peer problem
     rx_missed_errors: 0         ← the kernel cannot fetch fast enough; the Ring Buffer may be small (section 3.4)
     tx_dropped: 0
```

The way to read them is **trend and direction**: rising `rx_crc_errors` points at the physical layer (replace the cable, check the connector, check duplex); rising `rx_missed_errors`/FIFO points at the host side failing to keep up (interrupts, Ring, CPU saturation); rising `tx_dropped` points above the protocol stack (over to the Network pages). `ip -s link show enp3s0` gives the coarse totals of packets sent and received; paired with the fine-grained counters of `ethtool -S`, quantify first, then qualify.

### 3.3 Speed, Duplex, and Auto-Negotiation

For most scenarios keep `autoneg on` — force-setting duplex on modern devices actually mismatches with the peer more easily. For a temporary change use `sudo ethtool -s enp3s0 speed 1000 duplex full autoneg on`; **if you must set it by hand, the switch side must change in sync**: one side forced to 1000/full while the other's autoneg fails and falls to 100/half is the classic root cause of "pages occasionally hang, big file copies stall". Optical modules (SFP+) add compatibility problems: non-original modules may be refused by firmware or run at odd speeds — when swapping modules, read `dmesg` and the vendor HCL (hardware compatibility list) first.

### 3.4 Ring Buffer, Offload, and Multi-Queue

```bash
sudo ethtool -g enp3s0                 # Ring: current/maximum of the DMA ring
sudo ethtool -G enp3s0 rx 4096         # enlarge rx (lost on reboot; the cap is in -g output)
sudo ethtool -k enp3s0                 # offloads: tso/gso/gro/checksum state
sudo ethtool -K enp3s0 gro on tso on   # generally on; consider turning gro off only for packet analysis
sudo ethtool -l/-L enp3s0              # multi-queue: view/adjust channel count (no more than CPU count)
```

The division of labor among the three knobs: **Ring** governs "how much can be buffered when the kernel cannot fetch fast enough", **offload** governs "who computes checksums and segmentation", **channels/multi-queue** governs "how many cores receive work can spread onto". All are implemented by the driver, and changing them **is not guaranteed to persist** — a reboot, or NetworkManager/systemd-Link rereading its configuration, restores defaults; persistence belongs to the configuration layer (the Network pages); use `ethtool -G/-K/-L` for ad-hoc troubleshooting.

## 4. NIC Drivers and Firmware

### 4.1 Common Driver Reference

| Driver | NICs supported | Notes |
|------|-----------|---------|
| `e1000e` | Intel gigabit (desktop/server) | old and stable |
| `igb` | Intel I210/I340/I350 gigabit | common in multi-port servers |
| `ixgbe` | Intel 10G 82599/X520/X540 | 10GbE |
| `i40e`/`ice` | Intel X710/X722, E810 | the 25G/100G generation |
| `mlx5_core` | Mellanox/NVIDIA ConnectX-4/5/6 | 25G/100G, RDMA |
| `r8169` | Realtek gigabit | integrated on consumer boards |
| `virtio_net` | paravirtualized VM NIC | KVM/QEMU guests |

```bash
# Driver state and firmware logs (the classic failure signatures)
lsmod | grep -E "igb|ixgbe|mlx5|virtio_net"
sudo modprobe igb    # load manually
sudo dmesg | grep -iE "firmware|failed to load" | grep -iE "net|iwl|ath"
```

### 4.2 The Checklist for "The NIC Is Not Recognized"

Walk it in order; each step yields exactly one conclusion: ① does `lspci | grep -i ether` show the device? No → a PCIe enumeration problem (slot/power/passthrough config), nothing to do with the driver; ② does `-k` show `Kernel driver in use`? No → the driver is not bound: `lsmod` for the module, `dmesg` for load errors, `modprobe` to load by hand if needed; if it still fails, check the driver's support for that chip ID (take an ID like `8086:1521` from `lspci -nn` and compare against the driver source/distro notes); ③ driver present but no interface in `ip link`? → check `dmesg` for `firmware failed` (a missing firmware file, common with some wireless cards and new NICs on old kernels) and whether interface renaming interfered (`dmesg | grep renamed`); ④ interface present but no `LOWER_UP`? → back to section 3.3 for negotiation, or swap cable and port. When the distro repo's driver is old, **upgrade the distro kernel first** instead of casually compiling a third-party driver — the compatibility debt of DKMS versus kernel upgrades is often costlier than the driver itself; when a vendor driver is genuinely required (some Mellanox firmware tools, for example), defer to the vendor's installation documentation.

### 4.3 The Firmware Particularity of Wireless NICs

On most Wi-Fi chips the **firmware runs on the card**, uploaded by the kernel from `/lib/firmware/` at initialization; when the firmware is missing the interface exists but stays `DOWN`, and `dmesg` shows `direct firmware load ... failed`. Debian/Ubuntu split packages like `firmware-iwlwifi` (Intel) into free/firmware repositories, and **a minimal install often omits them by default** — after installing, "no wireless" means: install the firmware package first. Arch rarely hits this because `linux-firmware` is installed by default; RHEL/Rocky installs `linux-firmware` after enabling the corresponding repositories. That is the most common non-magical explanation for why "wireless behaves differently" across the three families.

## 5. Interrupts, RSS, and Receive-Path Tuning

### 5.1 Why Interrupts Deserve Attention

Every receive interrupt costs CPU; if all interrupts land on one core (single-queue legacy NICs, or badly spread IRQs), that core's `sy` spikes while the other cores watch — the bottleneck is not bandwidth but a **notification path one wire wide**. Modern NICs parallelize in hardware with **multi-queue + RSS** (Receive Side Scaling, hashing different flows to different queues/interrupts); the operator's job is to confirm the queue count and interrupt distribution match the machine's core count:

```bash
# Interrupt counts per CPU (grep NIC lines by driver name; everything on CPU0 = single-core bottleneck)
grep -E "enp3s0|virtio|mlx5" /proc/interrupts
#            CPU0       CPU1       CPU2       CPU3
# 44:  12003455  11987632  11990210  12011089  IR-PCI-MSI  igb-TxRx-0
grep -E "NET_RX|NET_TX" /proc/softirqs   # soft interrupts (NET_RX reflects receive pressure)
```

The default answer for most scenarios is to leave the spreading to the irqbalance daemon; the three-family install comparison — Debian/Ubuntu `sudo apt install irqbalance`, Arch `sudo pacman -S irqbalance`, RHEL/CentOS/Rocky `sudo dnf install irqbalance` — then `sudo systemctl enable --now irqbalance` and you are done.

### 5.2 irqbalance and Manual Affinity

Before deciding "who manages the interrupts", understand the division between the two mechanisms: **irqbalance** is the daemon distros ship by default, periodically respreading IRQs across cores by load — effortless, but not guaranteed to agree with your workload's core pinning; **manual affinity** nails each interrupt number to a specific CPU — predictable and reproducible, at the price of maintaining the mapping yourself. You must pick one — running both means your bindings get quietly rewritten. The choice criterion is simple: general servers use irqbalance; latency-sensitive setups, or machines already pinned with `taskset`/NUMA, stop it and go manual.

Manual binding takes three steps: `grep enp3s0 /proc/interrupts` to get interrupt number N, disable irqbalance (`sudo systemctl disable --now irqbalance`), then write the hexadecimal mask into `/proc/irq/N/smp_affinity`. That file is a **bitmask, one bit per CPU**: `1`=CPU0, `2`=CPU1, `4`=CPU2, `c`=CPU2+3 — writing the hex as decimal (wanting CPU2 but writing `2`, which actually binds CPU1) is the most common silent mistake; always read the file back to confirm. On a multi-queue NIC each `igb-TxRx-N` queue needs its own plan; interrupt numbers change across reboots and card swaps, so a manual mapping needs maintenance — which is exactly why irqbalance is the default and manual pinning is a targeted optimization only. For the advanced XPS/RPS software-queue steering, see the kernel documentation when needed.

## 6. Wireless: The Hardware View

### 6.1 Inspecting Wireless Hardware and the Regulatory Domain

```bash
iw dev                     # wireless interfaces (phy index, MAC, current channel)
iw phy phy0 info | grep -A20 "Supported"   # supported bands and channel list
iw reg get   # regulatory domain → country: CN decides available channels and power; install table in section 7
```

**The regulatory domain is a legal boundary written into wireless hardware**: the channels and power levels allowed differ by country; a wrong country code produces "the AP is visible but 5G channels will not connect" or power-limited signal that will not pass through walls. When the frequency list of `iw reg get` and `iw phy` does not match the channels you expect, check the country code before blaming the router. The **configuration operations** of scanning and connecting (`nmcli`, `wpa_supplicant`) belong to [the Network pages - configuration](../network/network-configuration.md); this page only requires locating the layer of "what the hardware supports and what regulation allows".

### 6.2 Common Facts About Drivers and Radio

Intel NICs go through `iwlwifi` plus firmware (section 4.3); Realtek through `rtw88`/`rtw89` and the like (some need DKMS; Arch users often fill the gap from the AUR); some Broadcom chips need the closed driver plus `firmware-brcm80211` on Debian. A laptop's **hardware radio switch/Fn hotkey** puts the device into the `RFKILL` state — when the interface is present in `ip link` but `STATE` is odd, `rfkill list all` shows the Soft/Hard block; this is a pure hardware-layer issue and has nothing to do with NetworkManager:

```bash
rfkill list all   # 0: WLAN Soft blocked: yes → rfkill unblock; Hard = a physical toggle
```

## 7. Three-Family Differences at a Glance

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Installing `ethtool`/`iw` | `apt install ethtool iw` | `pacman -S ethtool iw` | `dnf install ethtool iw` |
| Default network config layer | Netplan (`/etc/netplan/`, Ubuntu Server); Debian servers commonly ifupdown/networkd | usually systemd-networkd or NetworkManager (your choice) | NetworkManager (`nmcli`; unified since RHEL 9) |
| Predictable naming | enabled by default | enabled by default | enabled by default |
| Firmware packages | split `firmware-*`, may be missing on minimal installs | `linux-firmware`, fairly complete by default | `linux-firmware` |
| `irqbalance` | `apt install irqbalance` | `pacman -S irqbalance` | `dnf install irqbalance` |
| Firewall (configuration belongs to the Network pages) | `ufw` | your choice of `nftables`/`ufw` | `firewalld` |

Note this table lists only the **hardware-view differences**: the full comparison of configuration managers and firewalls is in the three-family quick reference of [the Network pages](../network/README.md). The principle on this page is that the three families agree — `lspci`/`ethtool`/`ip` usage and the format of `/proc/interrupts` are identical; the differences are only package names, whether firmware is complete by default, and which manager holds the configuration.

## 8. Common Gotchas

1. **Hardcoding `eth0` in scripts.** With predictable naming the default is names like `enp3s0`/`ens33`, and they change when cards change — read the real name with `ip link`, or make a stable alias via MAC address/udev rules (section 2.2).
2. **`ip link` shows UP but nothing connects, and you forgot `LOWER_UP`.** Administrative state and physical link are two different things; without `LOWER_UP` there is no link — go check negotiation and cabling, not routing first (section 2.2).
3. **`ethtool` settings vanish on reboot and you blame the driver.** Runtime parameters are not persistent by design; persistence is the job of networkd/Netplan/NetworkManager link configuration (the Network pages) — use `ethtool` for ad-hoc checks, write config files for long-term policy (section 3.4).
4. **Forcing 1G/full on one side only and breaking the link.** Inconsistent negotiation rules on the two sides fall to 100/half, with the symptom "small traffic fine, heavy traffic extremely slow"; restore `autoneg on` on both sides and align (section 3.3).
5. **Binding interrupts manually and leaving irqbalance on.** The two mechanisms rewrite each other's `smp_affinity`, showing up as "bindings mysteriously stop working" — hand everything to irqbalance, or stop it and manage yourself (section 5.2).
6. **Writing `smp_affinity` as decimal.** It is a **hexadecimal bitmask**: wanting CPU2 you write `4`, not `2`; always read the file back to confirm (section 5.2).
7. **A VM shows no real NIC driver, or `ethtool -k` floods with unsupported.** VMs use `virtio_net`/emulated devices whose capability set differs from a physical NIC; unsupported offload items are normal — do not force a physical machine's tuning checklist onto them (section 4.1).
8. **"The wireless driver is broken" when it is really firmware/regulatory domain/radio switch.** In the order of sections 4.3, 6.1, 6.2, check `dmesg` firmware loading → `iw reg get` country code → `rfkill list`; only suspect the driver itself after all three gates pass.

## References

- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - Network configuration / Wireless — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration/Wireless)
- Arch Wiki - irqbalance — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Arch Wiki - Improving performance (network tuning context) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Linux Kernel Networking Documentation — [kernel.org](https://www.kernel.org/doc/html/latest/networking/)
- ethtool(8) manual — [man7.org](https://man7.org/linux/man-pages/man8/ethtool.8.html)
- systemd.net-naming-scheme (predictable interface naming) — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd.net-naming-scheme.html)
- iw(8) manual — [kernel.org](https://www.kernel.org/doc/html/latest/networking/regulatory.html)
- Bird's Private Recipes (Lin's Linux Administration Guide) - connecting to the Internet — [linux.vbird.org](https://linux.vbird.org/linux_server/rocky9/0150networking.php)
- Red Hat - RHEL 9 network performance tuning — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [architecture](architecture.md)
- [storage](storage.md)
- [coverage-matrix](/research/coverage-matrix.md)
