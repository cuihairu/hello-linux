# KVM Virtualization

Containers answer how to isolate processes under one kernel; virtual machines answer a different question -- should this machine have a second kernel. The judgment can be given directly: if you need to run a different kernel or a different operating system than the host (Windows or BSD on a Linux host, or verifying another distro on the same machine), or you need hardware-boundary isolation between different tenants with whole-machine snapshot and rollback, pick a virtual machine; for dense deployment of services under the same kernel, keep using [containers](../container/docker.md). KVM is the virtualization scheme built into the Linux kernel: the kernel module uses the CPU's VT-x/AMD-V hardware assistance to execute guest instructions directly, QEMU emulates the devices, and libvirt wraps both into a unified API and toolchain. This combination is the most widely used server virtualization stack in the Linux world, and Red Hat's enterprise virtualization product line is built on top of it.

> Content draws on the official libvirt and QEMU/KVM documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Sorting out the layering of KVM, QEMU, libvirt, and virsh
- Checking CPU virtualization flags and kernel module status
- Installation paths on Debian/Ubuntu, Arch, and RHEL/Rocky
- Configuring the default NAT network and a bridged network
- Building a VM with virt-install, day-to-day management with virsh, and image and snapshot management with qemu-img
- Choosing "virtual machine vs container" for a concrete scenario from the division-of-labor table, with the rationale

## 1. The Relationship of Four Names: Kernel, Devices, Management, Front End

It is easy to treat KVM, QEMU, libvirt, and virsh as four tools of a kind and compare them; in fact they are four layers from the bottom up, and the chain does not work if any one is missing:

| Layer | Component | Responsibility | Form |
|---|------|------|------|
| kernel | KVM (`kvm.ko`, `kvm_intel`/`kvm_amd`) | relies on the CPU's VT-x/AMD-V hardware assistance to virtualize CPU and memory; most guest instructions execute directly on the physical CPU | kernel module, shipped with the kernel |
| devices | QEMU | emulates whole-machine peripherals: disk controllers, NICs, graphics, interrupt controllers; without /dev/kvm it can still emulate a whole machine in pure software, only noticeably slower | user-space process, one per VM |
| management | libvirt (libvirtd and the modular daemons) | unified API: describes VMs, networks, and storage pools in XML, owns lifecycle, hotplug, and migration | daemon + library |
| front end | virsh / virt-manager / virt-install | command-line and graphical tools calling the libvirt API | client programs |

The full path of one `virsh start debian12` is: virsh connects to libvirtd's socket, libvirtd reads the definition in `/etc/libvirt/qemu/debian12.xml` and forks a qemu process; qemu opens `/dev/kvm` to request hardware assistance and keeps emulating the disk and NIC itself. With the layering understood, fault localization gains a grip: when qemu will not start, whether the error lands in the kernel layer (KVM unavailable) or the configuration layer (disk path, XML syntax) is visible at a glance; when virsh cannot connect, it has nothing to do with KVM itself and is a libvirt-layer problem -- each boundary between layers corresponds to a completely different investigation entry point.

One supplement on QEMU's independent value: it can run without KVM (TCG dynamic translation, pure software emulation), so an x86 host can directly boot ARM images for cross-architecture verification, at the cost of execution speed far below the hardware-assisted path. Day-to-day server workloads must go through `/dev/kvm`; that is a prerequisite, not an option.

## 2. Preflight Checks: CPU, Firmware, and Kernel Module

```bash
# 1) Does the CPU have virtualization extensions: vmx is Intel VT-x, svm is AMD-V; output greater than 0 means yes
$ egrep -c '(vmx|svm)' /proc/cpuinfo
16
# lscpu shows this line too
$ lscpu | grep -i virtualization
Virtualization:                  VT-x
# 2) Is the kernel module loaded: kvm_intel on Intel machines, kvm_amd on AMD
$ lsmod | grep kvm
kvm_intel     438272  0
kvm          1130496  1 kvm_intel
# 3) Debian/Ubuntu offer kvm-ok as a one-stop checkup (from the cpu-checker package)
$ sudo kvm-ok
INFO: /dev/kvm exists
KVM acceleration can be used
```

An `egrep` output of 0 has only two possible causes: the CPU hardware does not support it, or it is not enabled in the firmware. On servers the latter is far more common than the former -- enter BIOS/UEFI, on Intel platforms look for "Intel Virtualization Technology / VT-x", on AMD platforms for "SVM Mode", enable it and cold boot. When the module is not loaded, bring it up manually with `sudo modprobe kvm_intel` (`kvm_amd` on AMD); most distros auto-load it when hardware support is detected; if modprobe reports Operation not supported, it is most likely still the firmware switch not taking effect -- go back into the BIOS and check again.

Another frequent scenario: the host itself is a virtual machine (a cloud instance, or a VM on a physical machine), in which case whether `/dev/kvm` is available depends on nested virtualization being enabled one level up. On Intel platforms load the module one level up with `kvm_intel nested=1` (AMD nesting is on by default); for cloud instances, check whether the vendor allows it. With nesting off, the second-level VM gets no hardware acceleration or falls back to pure software emulation -- which manifests as this section's checks failing, not as an installation error.

## 3. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/Rocky |
|------|---------------|------|-----------|
| Install | `sudo apt install qemu-kvm libvirt-daemon-system libvirt-clients virtinst` | `sudo pacman -S qemu-full libvirt virt-manager dnsmasq` | `sudo dnf install @virtualization` (the EL7 software group; on EL8/9 use `dnf module install virt`, or install directly with `dnf install qemu-kvm libvirt virt-install`) |
| Enable the service | `sudo systemctl enable --now libvirtd` | same | same |
| Graphical front end | add `virt-manager` | already installed with the line above | add `virt-manager` / `virt-viewer` |

The package name differences are worth explaining: Debian splits the daemon into `libvirt-daemon-system` and the clients into `libvirt-clients` (virsh is in the latter), and both virt-install and virt-clone come from the `virtinst` package; Arch's `qemu-full` covers all machine types and tools (including qemu-img), and the `virt-manager` package depends on the split-out `virt-install` package; RHEL 8/9 package virtualization as the `virt` module, `@virtualization` is the EL7-era software group spelling, and on versions where the group does not exist just install by package name. The DHCP/DNS of the NAT network is provided by dnsmasq -- Debian/RHEL families pull it in automatically as a dependency, while on Arch it is an optional dependency of libvirt and must be installed explicitly (also confirm `iptables-nft` is present; the default network needs it to apply firewall rules).

After installation the user-group step is identical across the three families, and so is the meaning of the permissions:

```bash
$ sudo usermod -aG libvirt,kvm $USER   # takes effect after re-login; newgrp libvirt applies immediately
$ virsh --connect qemu:///system list --all
 Id   Name   State
--------------------
```

The `libvirt` group decides whether you can access the system instance's socket (`qemu:///system`, the set of VMs libvirtd manages), and the `kvm` group decides whether you can read and write `/dev/kvm` directly. You can still work with sudo without the groups, but putting your daily account in the libvirt group to operate without sudo is shared convention across all three families; after a group membership change you must re-login, otherwise the error persists and is easy to misjudge as a failed installation.

## 4. Networking: Start with NAT, Bridge for Parity

### 4.1 The Default NAT Network

libvirt ships a NAT network named `default`: the host gains a `virbr0` bridge (address 192.168.122.1), dnsmasq hands the VMs addresses in 192.168.122.0/24, and outbound traffic is forwarded through NAT on the host. The effect is that VMs can reach the internet and the host, while other LAN machines and the internet cannot reach the VMs; to publish a port, do DNAT on the host -- the rule syntax is in the [Routing and NAT](../routing-nat.md) page.

```bash
$ virsh net-list --all                  # default is commonly inactive
 Name      State      Autostart   Persistent
---------------------------------------------
 default   inactive   no          yes
$ virsh net-start default && virsh net-autostart default  # start it and make it start with the service
$ ip addr show virbr0                   # should show 192.168.122.1/24
$ sysctl net.ipv4.ip_forward            # NAT depends on the forwarding switch; confirm it is 1
```

### 4.2 Bridging: Let VMs Get LAN Addresses

NAT hides VMs behind the host, which does not work in some scenarios: a VM needs to serve the outside world, be reached directly from the LAN, or get an address from the router like a physical machine. The approach is to create a bridge `br0` on the host, demote the physical NIC to a bridge member, move the IP onto br0, and attach the VM's virtual NIC directly to br0 -- from then on VMs and the host are peers on the LAN. The complication is that "how the host builds the bridge" happens to be where the three families differ most.

On traditional Debian ifupdown, write `/etc/network/interfaces`:

```text
auto br0
iface br0 inet dhcp
    bridge_ports enp3s0        # physical NIC demoted to a member; the address moves to br0
```

Newer Ubuntu uses netplan, write `/etc/netplan/*.yaml`:

```yaml
network:
  version: 2
  ethernets:
    enp3s0: { dhcp4: no }
  bridges:
    br0:
      interfaces: [enp3s0]
      dhcp4: true
```

NetworkManager is common on the RHEL family and desktop Ubuntu:

```bash
nmcli con add type bridge ifname br0 con-name br0
nmcli con add type bridge-slave ifname enp3s0 master br0
# the IPv4 config on the original NIC must move to br0, then restart the connection
```

One shared risk must be stated first: building a bridge tears down and reconnects the host's own network, and a single misconfiguration loses SSH immediately. Before operating remotely, confirm you have an out-of-band console (iLO/iDRAC/IPMI or the cloud vendor's serial port), or use `at` to schedule a rollback script a few minutes out as a safety net; after the change, use `ip addr` to check that the address sits on br0 and the physical NIC no longer holds an IP before calling it correctly connected. A word on macvtap in passing: `<interface type='direct'>` lets a VM borrow the physical NIC's traffic directly, skipping the bridge, but by default the host and other VMs on that NIC cannot talk to each other -- fine for a temporary experiment, still choose bridging in production.

## 5. Storage: Image Formats and Storage Pools

### 5.1 qcow2 vs raw

| | qcow2 | raw |
|--|-------|-----|
| Space usage | sparse allocation, grows with actual writes; the virtual size seen by `ls` is far larger than the real usage seen by `du` | the file is full-size (unless the filesystem has sparse files) |
| Internal snapshots | supported; state stored inside the image file | not supported |
| Backing file chains | supports backing files, can make differential disks | not supported |
| I/O path | one extra metadata layer; overhead concentrates on lookup and allocation during random writes | no format overhead, shortest path |

Selection judgment: system disks, test machines needing snapshot rollback, and templates to derive differential disks from use qcow2; database disks sensitive to random writes either go raw on a local disk or attach an LVM block device to the VM directly. Do not deify raw either -- sequential read/write differ little between the two formats, qcow2's overhead concentrates on random writes, and the disk saved by sparse allocation is real money; on capacity-tight machines qcow2 is usually the more pragmatic choice.

### 5.2 Day-to-Day qemu-img

```bash
$ qemu-img create -f qcow2 /var/lib/libvirt/images/db01.qcow2 20G
$ qemu-img info /var/lib/libvirt/images/db01.qcow2
virtual size: 20 GiB
disk size: 196 KiB        # actual disk usage -- the gap between virtual size and real usage at a glance
$ qemu-img convert -O raw -p db01.qcow2 db01.raw   # -p shows progress; conversion reads the whole chain, flattening the backing chain on the way
```

`convert` is the most frequently used moving action: changing formats, flattening snapshot chains, and exporting an LVM block device to a file all go through it.

### 5.3 Storage Pools

libvirt uses storage pools to answer "where do the images live, and who keeps the books": the `default` pool that exists right after installation maps to the `/var/lib/libvirt/images` directory, `virsh pool-list` lists pools, and `virsh vol-list default` lists volumes. Pools can also point at LVM volume groups, iSCSI, and NFS. Mind the bookkeeping boundary -- files created by hand with `qemu-img create` are invisible to libvirt; either let the pool create them with `virsh vol-create-as`, or register them afterward with `virsh pool-refresh`. On machines with a small root partition, point the pool at a large partition early with `virsh pool-define-as dir --target /data/vm-images`, rather than waiting for `/var` to fill up (see the common faults).

### 5.4 Why virtio Is Fast

Emulated devices are slow because "the protocol itself is simulated": the guest kernel believes it is operating a real IDE disk or e1000 NIC, and every read or write of an I/O register traps out from the guest to QEMU. virtio is a paravirtualized driver -- the guest kernel knows explicitly that it runs in a VM and exchanges data with the host in batches through shared-memory ring queues, bypassing the register-by-register simulation of real hardware protocols. Hence in this page's virt-install examples, `bus=virtio` for the disk and `model=virtio` for the NIC are the default picks; Linux guest kernels ship virtio drivers, while Windows guests need an extra virtio-win driver disk mounted at install time. Inside a VM the disk device name is `/dev/vda`, not `/dev/sda` -- seeing vda means virtio is in effect.

## 6. Building a VM with virt-install

```bash
$ virt-install \
    --name debian12 \          # the VM name, used by virsh throughout
    --memory 2048 \            # memory in MiB
    --vcpus 2 \                # number of vCPUs
    --disk path=/var/lib/libvirt/images/debian12.qcow2,size=20,format=qcow2,bus=virtio \
    --cdrom /var/lib/libvirt/images/debian-12.5.0-amd64-netinst.iso \
    --network network=default,model=virtio \   # attach to the default NAT network
    --graphics spice \         # graphical console protocol; virt-manager / virt-viewer connect to it
    --os-variant debian12      # from the osinfo database; osinfo-query os lists everything
```

Parameter by parameter:

- `--name` / `--memory` / `--vcpus` correspond to the name, memory, and vCPU count in the XML. Memory and vCPUs can be adjusted online with `virsh setmem` / `setvcpu` (bounded by the max value in the definition); renaming requires dumping with dumpxml, editing, and redefining.
- Each field of `--disk` owns one thing: `path` is where the image lands (put it inside a storage pool directory), `size=20` is a virtual size of 20 GiB, `format=qcow2` was compared above, and `bus=virtio` decides whether the guest sees vda or sda.
- `--cdrom` attaches an ISO as a CD drive, needed only during installation; `--location` is its alternative, with the benefit of combining with `--extra-args 'console=ttyS0'` to redirect the installation to a serial port.
- `--network network=default` attaches to the NAT network of 4.1; swap in `bridge=br0` to attach to the LAN bridge of 4.2, with the NIC model likewise virtio.
- `--graphics spice` provides the graphical console; on servers with no graphical environment use `--graphics none --console pty,target_type=serial` together with `--location` and `--extra-args` to complete the install in pure text.
- `--os-variant` is not just a label: it decides the machine type QEMU exposes and a series of optimization switches targeted at that distro. Getting it wrong does not necessarily error immediately, but adds gratuitous compatibility troubles; verify once with `osinfo-query os` before installing.

After installation, day-to-day management is the following set of virsh commands:

```bash
$ virsh list --all                          # full inventory including powered-off VMs
$ virsh start debian12                      # power on
$ virsh shutdown debian12                   # ACPI shutdown; use the next one only when the guest does not respond
$ virsh destroy debian12                    # pull-the-plug force stop, loses unsynced data, emergencies only
$ virsh console debian12                    # serial console; Ctrl+] to exit
$ virsh domblklist debian12                 # disk inventory; how you find the qcow2 path
$ virsh domifaddr debian12 --source lease   # look up the IP in the NAT network from dnsmasq's lease
$ virsh autostart debian12                  # start with libvirtd at boot
$ virsh edit debian12                       # edit the XML definition; syntax is validated on save
```

Two habits are worth fixing in place. First, prefer `shutdown` for powering off -- it sends an ACPI event, equivalent to pressing the power button, and `destroy` is for a hung guest; for the guest to respond to shutdown it needs acpid (most distro images ship it), and to make `domifaddr` queries more accurate, install qemu-guest-agent in the guest so virsh's `--source agent` becomes usable. Second, always change config through `virsh edit`, never by editing `/etc/libvirt/qemu/*.xml` directly -- libvirtd holds the definitions, so editing the file directly neither takes effect nor survives being overwritten by runtime state.

## 7. Snapshots and Cloning

### 7.1 Internal vs External Snapshots

```bash
# Internal snapshot: state written into the snapshot area inside the qcow2 file
$ virsh snapshot-create-as debian12 clean-install --description "marked after system install"
$ virsh snapshot-list debian12
$ virsh snapshot-revert debian12 clean-install     # one-click rollback to the marked moment
$ virsh snapshot-delete debian12 clean-install
# External snapshot: the original image becomes a read-only base; new writes land in an overlay file
$ virsh snapshot-create-as debian12 snap2 --disk-only --atomic
$ qemu-img info /var/lib/libvirt/images/debian12.qcow2   # backing file points at the previous link
```

Internal snapshots have two prerequisites: the disk must be qcow2 (raw has no internal snapshot storage), and the guest must boot with legacy BIOS -- UEFI firmware NVRAM variables do not live inside the qcow2, and libvirt refuses outright to take internal snapshots of such VMs. Adding `--memspec` to a running VM writes the memory state into the qcow2 as well, so after a rollback the process is still there. External snapshots produce a backing chain (base plus overlay), more flexible and more troublesome: virsh's `snapshot-revert` does not support rolling back to an external snapshot, and merging requires `virsh blockcommit`; no single link in the chain can be deleted or renamed on its own, so look at the chain with `qemu-img info --backing-chain` before touching anything. For test scenarios that need "roll back anytime", internal snapshots are handier; doing the rollback at the filesystem layer (btrfs/ZFS snapshots) is also a mature approach, in which case the VM needs no cooperation at all.

### 7.2 Cloning and the Traps of Chained Images

```bash
$ virt-clone --original debian12 --name debian12-tpl --auto-clone
# full-disk copy; UUID and MAC regenerated by virt-clone
```

Cloning only solves duplication on the host side: inside the guest it is still the same `/etc/machine-id`, the same set of SSH host keys, and the same hostname. An identical machine-id makes dnsmasq in the NAT network treat two machines as one DHCP client, which may hand them the same address; identical SSH host keys trigger man-in-the-middle warnings. Before deriving in bulk, reset these identities with libguestfs's `virt-sysprep`, far more reliable than fixing them one by one by hand.

"Template base plus differential disk" is the file-level version of cloning: `qemu-img create -f qcow2 -b base.qcow2 -F qcow2 diff.qcow2` makes a new VM write only differences, saving space and deployment time, and concentrating the traps with it -- once the base is renamed or moved, the whole chain breaks; fix the path with `qemu-img rebase -u`; the base must never be shared read-write by several VMs, and newer QEMU refuses the second writer with a file lock (reporting `Failed to get "write" lock`) -- that is a protection mechanism, not a failure; to untie the chain completely, `qemu-img convert` to a new file flattens it. There is only one discipline: keep templates read-only, keep derived disks independent, and look at the chain before deleting any link.

## 8. Virtual Machines vs Containers: Division of Labor and Selection

| Dimension | Virtual machine (KVM) | Container (Docker etc.) |
|------|--------------|------------------|
| Isolation boundary | whole machine: independent kernel, independent device view, drawn by the hypervisor | process: shared host kernel, drawn by namespaces/cgroups |
| Systems that can run | kernel unrelated to the host; Windows, BSD, any Linux | only Linux user space above the host kernel |
| Startup | tens of seconds to minutes, a full boot process | seconds; fundamentally starting a constrained process |
| Per-machine density | low; each needs a complete kernel and baseline memory | high; dense deployment under one kernel |
| Snapshots and rollback | whole-machine snapshot, freezing kernel state too | image layers plus data volumes, no running kernel state included |
| Migration | libvirt live migration is a mature capability | reschedule and restart; no in-memory migration |
| Typical scenarios | heterogeneous OS, strongly isolated tenants, whole-machine snapshots, kernel experiments | dense deployment and fast delivery of homogeneous services |

Selection asks one question: does the workload need a different kernel. Yes -- running Windows, verifying another distro's kernel, giving different tenants hardware-level boundaries -- and there is no substitute for a VM; no -- web, cache, and job processes under the same kernel -- and the density and speed advantages of containers are hard to beat. In production the two are layered more often than chosen between: carve out boundaries with independent kernels using VMs on physical machines, then raise density with containers inside the VMs. Section 1 of the [Containers](../container/docker.md) page has the same table from the opposite angle; read them together and both directions of the selection argument are in hand.

## Common Faults

**virsh reports failed to connect to the hypervisor.** Investigate in the order "URI -> process -> permissions": `virsh --connect qemu:///system list` specifies the system instance explicitly, since an ordinary user may default to the per-user `qemu:///session` and see no system VMs; `systemctl status libvirtd` confirms the daemon is alive -- some newer distros split the daemon into modular units such as virtqemud and virtnetworkd, and the unit names change accordingly; if the process is fine but you still get Permission denied, add the user to the `libvirt` group and re-login. If all three check out and it still fails, look at the daemon's own log with `journalctl -u libvirtd -n 50`.

**Host lost after changing to bridging.** The root cause is almost always "the IP was never moved onto br0" -- an address configured on both the physical NIC and the bridge creates routing chaos, or the bridge never took over the connection at all. Prevention beats repair: before making such a change, confirm an out-of-band console is reachable, or schedule a delayed rollback script; when repairing, move the IP, gateway, and DNS all into br0's config, leave only membership on the physical NIC, and verify with `ip addr` that the address sits on br0 before disconnecting the console. Do not bridge wireless NICs -- most wireless drivers do not support multi-address frames and it simply will not work.

**Default storage pool path missing.** Reports no storage pool 'default' or cannot find `/var/lib/libvirt/images`: the directory was cleaned up, or the `default` pool is inactive. Check the state with `virsh pool-list --all`; if inactive, `virsh pool-start default`; if the directory is genuinely gone, recreate it and then `virsh pool-refresh`. The more fundamental fix is in section 5.3 -- define the pool on a large partition, and update virt-install's `--disk` path accordingly.

**VM will not start, reporting VT-x unavailable.** qemu reports the virtualization extensions are not available or /dev/kvm is missing; investigate in the three layers "firmware -> kernel -> nesting": `egrep -c '(vmx|svm)' /proc/cpuinfo` returning 0 while the CPU spec itself supports it means VT-x/AMD-V is off in the BIOS; a normal value but a missing module means run `modprobe kvm_intel` (`kvm_amd` on AMD) and read the error; when the host is itself a VM, confirm nesting is enabled one level up (Intel needs `kvm_intel nested=1`), otherwise the second-level VM falls back to pure software emulation and slows down noticeably.

**Host disk filled by images.** qcow2 only growing and never shrinking is by design: deleting files inside the guest does not shrink the image, and internal snapshots all hide inside the qcow2. Handling order: `df -h /var/lib/libvirt/images` to locate the partition, `qemu-img info --backing-chain` to find the biggest link in the chain, `fstrim -a` inside the guest (with discard enabled on the disk) to reclaim holes, `qemu-img convert` to rewrite a clean image when necessary, then reclaim snapshots one by one with `virsh snapshot-delete`. For growth use `qemu-img resize` plus growpart inside the guest; but the root fix is still having the storage pool live on a large partition from the start.

## References

- libvirt documentation -- [libvirt.org/docs.html](https://libvirt.org/docs.html)
- QEMU documentation -- [www.qemu.org/docs/master](https://www.qemu.org/docs/master/)
- Arch Wiki: KVM -- [wiki.archlinux.org/title/KVM](https://wiki.archlinux.org/title/KVM)
- Arch Wiki: Libvirt -- [wiki.archlinux.org/title/Libvirt](https://wiki.archlinux.org/title/Libvirt)
- Red Hat product documentation (virtualization) -- [docs.redhat.com](https://docs.redhat.com/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [authoritative-books](/research/authoritative-books.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](/server/README.md)
- [cloud-computing](/server/cloud-computing.md)
- [cross-compile](/source/cross-compile.md)