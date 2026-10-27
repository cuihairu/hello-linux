# Cloud Computing and cloud-init

The previous chapter installed virtual machines on your own machine; this one switches the perspective to renting them: an instance is clicked into existence on a web console or an API, login-ready within minutes, and destroyed when you are done. The main battlefield of operations shifts from one host to a set of programmable resources -- but inside the instance it is still a Linux running systemd, with package management, services, and logs intact. Two things change: machine provisioning becomes image boot, and config injection becomes cloud-init. This page organizes the layering of cloud service models, the relationship between instances and images, how cloud-init works, and cloud-only concepts such as security groups.

> Content draws on the official cloud-init documentation and the official Ubuntu/Debian cloud image sites; package version facts were verified on 2026-10-10 against the official Arch package API and the CentOS Stream 9 mirror directory.

## What This Page Covers

- Using IaaS/PaaS/SaaS to state clearly "which layer you are responsible for", and judging which one a scenario should buy
- Explaining the relationship between the instance lifecycle and machine images
- Reading a `#cloud-config` user-data file, and walking through the injection flow locally on a VM with the NoCloud datasource
- Using the metadata service so an instance can look up its own attributes
- Explaining the division of labor between security groups and the system firewall, so you know which layer to check when troubleshooting

## 1. Cloud Service Models: Which Layer You Manage

| Model | The cloud manages | You manage | Typical forms |
|------|---------|---------|---------|
| IaaS | hardware, the virtualization layer, the network foundation | the operating system and above: system config, packages, services, data | cloud compute instances, cloud disks |
| PaaS | everything up to runtime and middleware | application code and configuration | managed databases, object storage, container platforms |
| SaaS | almost everything | usage and account management | webmail, collaboration tools |

A test for the three boundaries: who fixes it when it breaks. A kernel patch is you -- IaaS; a connection-limit increase is the platform -- PaaS; a wrong feature is customer support -- SaaS. The main battlefield of system operations is IaaS; PaaS is the option of outsourcing the system-layer work, and however much you outsource, that much of the systemd, package management, and firewall knowledge in this repo loses its use.

## 2. Instances and Images

An instance is a rented virtual machine, with three points on its lifecycle: start (run), stop (stop -- the disk is kept, compute is no longer billed), and destroy (terminate -- everything zeroes out). An instance boots from a machine image -- a disk image with the system installed and pre-configured. Ubuntu and Debian both publish official cloud images ([cloud-images.ubuntu.com](https://cloud-images.ubuntu.com/), [cloud.debian.org](https://cloud.debian.org/), verified reachable on 2026-10-10); the qcow2/raw formats can be imported into a public cloud and also fed to local KVM, so the same image set is reused in both places.

The image/instance relationship introduces the key mechanism of cloud computing: one image must be able to boot on a thousand hosts with different hardware into a thousand differently configured instances, so the system has to configure itself **at first boot** -- hostname, network, SSH keys, and disk expansion cannot be baked into the image. The component that does this is cloud-init.

## 3. cloud-init: Config Injection at Boot

cloud-init runs at the system's first boot (strictly speaking, the first boot after the instance-id changes), reads configuration from a "datasource", and executes it in stages. For local testing the most-used datasource is NoCloud -- the configuration comes from a mounted ISO or seed disk and does not depend on a cloud vendor; on public clouds the datasource is the metadata service (section 4).

Installation on the three distro families (production images already ship it; you only need to install it on hand-rolled VMs or container images):

| Action | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| Install | `apt install cloud-init` | `dnf install cloud-init` | `pacman -S cloud-init` |
| Service units | the four-stage chain cloud-init-local / cloud-init / cloud-config / cloud-final | same | same |
| Main config | `/etc/cloud/cloud.cfg` | same | same |
| Logs | `/var/log/cloud-init.log` and the journal | same | same |

Current package versions: Arch 26.2 (extra), EL9 24.4 (AppStream). The four service units are chained local -> network -> config -> final; the early stages do not depend on the network (disk mounting, growpart), while the later stages can go online to fetch packages.

### 3.1 A Working user-data

user-data starts with `#cloud-config` and is declarative YAML. The following example accomplishes four things in a NoCloud scenario -- change the hostname, create an ops account with keys, update the system, and install a web service:

```yaml
#cloud-config
hostname: web-01
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: wheel
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1... ops@example.com
package_update: true
packages:
  - nginx
runcmd:
  - systemctl enable --now nginx
```

You do not have to wait for boot to validate the syntax: `cloud-init schema --config-file user-data` checks it directly. On the instance side, confirm whether injection completed:

```bash
$ cloud-init status --wait      # blocks until all four stages finish; use this in scripts that wait for initialization
$ cloud-init query datasource   # query the current datasource and instance attributes
$ sudo less /var/log/cloud-init.log   # if it did not take effect, start with the log and locate by stage
```

Two points that are easy to misjudge: user-data only runs at the first boot after the instance-id changes, so editing the config and rebooting will not re-run it -- to test a new config, either change the instance-id or run `cloud-init clean` (it clears the machine identity, so use it with care in production); and each runcmd entry is one element of a command list -- get the nesting level wrong and it is treated as a single command, with the error showing up in the log rather than as a boot failure.

## 4. The Metadata Service

While it is running, an instance queries its own attributes through the standard entry point, the link-local address `169.254.169.254`:

```bash
$ curl -s http://169.254.169.254/latest/meta-data/instance-id
i-0abc123def456
```

Instance id, availability zone, public IP, and instance type are all queryable -- this is how a script answers "which machine am I on", and how inventory reporting in configuration management tools gets its data. Draw the boundary clearly: metadata is the query port for **instance facts**, not a configuration store. Writing custom data into it must go through the user-data channel, and sensitive information should certainly not go there -- any process on the same host with metadata access can read it. Newer metadata services on the major clouds add session protection to IMDSv1-style requests (a token must be fetched first); verify the details against your provider's version, but the principle is unchanged: treat metadata as a read-only source of system facts.

## 5. Networking and Security Groups

Cloud networking adds a platform-level firewall layer -- the security group: a stateful port whitelist attached outside the instance's NIC. Rules take effect immediately and do not add load to the instance. Its relationship to the system firewall is **stacking, not replacement**: only if the security group allows 22 can sshd ever see a connection; the union of the two rule sets determines final reachability, so when troubleshooting, check the security group first and then log into the machine to check firewalld/ufw (this repo's [Firewall](../security/firewall.md) page covers the system layer). A VPC (virtual private cloud) fences a set of instances into a private network range; subnetting, route tables, and peering connections are its everyday vocabulary -- semantically these are the same concepts from this repo's [Routing and NAT](./routing-nat.md) mapped onto the platform, so only the concept carries over, with the console or API replacing the commands.

There are two ways to get public internet access: an elastic IP (a static public address that stays bound across instance replacements) and on-demand allocation (which may change across reboots). Billing comes in pay-as-you-go and subscription shapes -- pay-as-you-go for short-term and test environments, monthly/annual for long-lived loads; pricing structures vary heavily by provider and region, so this page gives no numbers.

## 6. A Glimpse of Private Clouds

Replicating the same mechanisms in your own data center is a private cloud: OpenStack offers a complete compute/network/storage API set, Proxmox VE packages KVM and storage into a mid-sized solution with a web UI, and oVirt is the enterprise form of virtualization management for the RHEL family. What all three share is support for cloud-init semantics -- the images and injection workflows from this repo's knowledge transfer directly. Private cloud platform engineering is not small; until you are past a few dozen machines, using KVM virtualization (see the [previous chapter](./virtualization/kvm.md)) plus scripted management is the better deal.

## 7. Common Failures

**The SSH key was not injected, so I cannot log in.** Rule out the security group first (section 5); then check cloud-init: `cloud-init status` to see whether it finished, and search `/var/log/cloud-init.log` for errors in the ssh module. Common root causes: cloud-init is not installed in the image, or the datasource was not recognized (a NoCloud seed disk must have the label `cidata`).

**Editing user-data had no effect.** Expected behavior: user-data only runs at the first boot after the instance-id changes. Test flows use `cloud-init clean` or a new instance identity; production changes go through rebuilding the image.

**The instance has no IP after boot.** The DHCP client did not start, or the cloud-init network stage failed: `cloud-init status` is stuck at the network stage, and the log shows whether the NIC name and the in-image config (`network:` in `/etc/cloud/cloud.cfg`, or netplan/network-scripts) match the host network.

**The disk did not expand with the instance size.** The growpart module extends the root partition at first boot; if it did not happen, look there: search the log for growpart. This commonly happens on custom images that lack cloud-utils-growpart (verified present in EL9 AppStream: cloud-utils-growpart-0.31-10.el9).

**runcmd silently did not run.** Most often the YAML nesting is wrong and it was parsed as a single command. `cloud-init schema` pre-validation catches most of it; the output of every command that did run is archived in `/var/log/cloud-init-output.log`.

## Division of Labor with Other Pages

Key generation and the meaning of authorized_keys are covered in [SSH Remote Login](./ssh.md) -- cloud-init's `ssh_authorized_keys` is only an injection mechanism; the stacking relationship between the system-level firewall and security groups is in [Firewall](../security/firewall.md); the full hands-on treatment of self-hosted virtualization is in [KVM Virtualization](./virtualization/kvm.md); service delivery and changes on instances go through CI/CD pipelines, covered in [CI/CD and Continuous Delivery](./ci-cd.md); what gets pre-installed inside an image follows the same boundary as in [Building from Source and Tarball Installation](../basic/packages/tarball.md), section 6 -- anything the package manager can carry should not be stuffed in by hand.

## References

- cloud-init official documentation -- [docs.cloud-init.io](https://docs.cloud-init.io/)
- Ubuntu official cloud images -- [cloud-images.ubuntu.com](https://cloud-images.ubuntu.com/)
- Debian official cloud images -- [cloud.debian.org](https://cloud.debian.org/)
- NoCloud datasource notes -- the "datasources/nocloud" section of the cloud-init docs
- man pages -- man cloud-init, man cloud-config

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](/research/README.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)