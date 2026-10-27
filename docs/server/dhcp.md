# DHCP Server (dhcpd / Kea)

Static IPs suit servers, but there is no way to hand-configure every laptop, phone, and printer on a LAN -- DHCP (Dynamic Host Configuration Protocol) is the protocol that automates this layer of allocation: a machine plugs in and shouts a broadcast, a DHCP server answers with a complete set of network parameters -- gateway, DNS, lease duration -- and the client's configuration is done. Typical scenarios for running your own DHCP: a home or office LAN that wants unified control of its address range and DNS egress; a virtualization or lab environment where VMs come and go constantly and manual bookkeeping cannot keep up; or re-cutting the DHCP range built into an existing router and reserving fixed addresses for printers. This page uses ISC dhcpd as its main line (`isc-dhcp-server` on Debian/Ubuntu, the `dhcp-server` package on the RHEL family, `dhcp` on Arch), organized as "why -> install -> server config -> client and lease verification -> Kea -> troubleshooting"; for the DNS options DHCP hands out, see the self-hosted BIND material in [DNS Server](./dns/bind.md), and for cross-subnet networking and NAT see [Routing and NAT](./routing-nat.md).

> Content draws on the official ISC documentation and the Arch Wiki (conceptual framework from "Vbird's Linux Cabinet"); see the references at the end.

## What This Page Covers

- Explaining why the four DORA steps are broadcast all the way through, and why a lease must expire
- Knowing the install and unit name differences across the three distros, and being able to verify the service really listens after installing
- Writing a complete, runnable `dhcpd.conf` on your own: address pool, options, fixed reservations
- Verifying one successful allocation from both ends: reading the lease ledger on the server, checking the actual parameters on the client
- Kea, the successor to ISC DHCP after it stopped being maintained
- Diagnosing the high-frequency traps: service will not start, address without a gateway, address conflicts

## 1. What Problem DHCP Solves

### 1.1 DORA: A Four-Step Handshake, All Broadcast

A client has no IP address before it gets one, so the whole negotiation has to happen over broadcast -- this is the four DORA steps: **Discover** (the client broadcasts "is there a DHCP server here?"), **Offer** (the server broadcasts "I propose 192.168.56.101, with gateway and DNS as follows"), **Request** (the client broadcasts "I want the address that server just proposed" -- broadcasting also tells the other servers "I did not take your offer"), and **ACK** (the server broadcasts "deal, lease for 600 seconds"). The protocol ports are UDP 67 (server) and 68 (client); everything is a link-layer broadcast, and any lost step relies on the client retrying -- the protocol itself has no retransmission coordinator.

| Step | Sent by | Key points of the message |
|------|------|----------|
| Discover | client | source address 0.0.0.0, destination 255.255.255.255, carries the MAC and hostname |
| Offer | server | proposes IP/netmask/gateway/DNS/lease time; multiple servers each send their own |
| Request | client | broadcast confirmation of the chosen server and address; losers reclaim their offer |
| ACK | server | formal grant; from here the client can configure its NIC and go online |

The most overlooked step is why the third one must also be broadcast: if there are several DHCP servers on the LAN (very common during migrations), the client publicly announces "who I chose", so the losing servers can put the addresses they offered back into the pool. Understand this and you see why a packet capture is more direct than log reading when troubleshooting -- whether DORA completed and at which step it broke is all laid out by a single `tcpdump`.

### 1.2 Leases: An Expiring Ledger

DHCP is not "allocate and forget" but a rental model: every address handed out is recorded in the server's lease file, with start and end times. Halfway through the lease (0.5 x T1) the client proactively renews with the original server; past 7/8 of the term (0.875 x T2) without a renewal it broadcasts to any server for help; if everything fails, the lease expires and the address returns to the pool. The analogy for this ledger is a package manager's install database: `/var/lib/dhcp/dhcpd.leases` is to dhcpd what `/var/lib/dpkg/status` is to dpkg -- both are the single source of truth for "what I handed out / installed", surviving service restarts and reviewable offline. Lease duration is a tuning knob, not a constant: a short lease (say 1 hour) on an office LAN recycles addresses quickly and suits devices that come and go; the fixed segment where servers live should be covered by reservations rather than long leases -- duration solves "reclaiming", reservations solve "this machine always has this address"; do not mix the two up.

### 1.3 authoritative: The Authoritative and Non-Authoritative Postures

The top-level `authoritative;` in `dhcpd.conf` declares this server to be the official DHCP for the subnet. The difference shows up in "refusals": a client arrives with an old lease from another subnet and asks to renew -- an authoritative server answers NAK immediately, forcing it to run DORA again and get this subnet's correct parameters; a non-authoritative server stays silent, and the client hangs on its old lease, retrying forever, appearing as "no network after moving to a new subnet". Only temporary servers during a migration should stay non-authoritative; production environments always add `authoritative;` -- missing this line is the most classic "everything looks right but nothing works" in common configurations.

## 2. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install (server) | `apt install isc-dhcp-server` | `pacman -S dhcp` | `dnf install dhcp-server` |
| Service unit | `isc-dhcp-server` | `dhcpd4` | `dhcpd` |
| Main config | `/etc/dhcp/dhcpd.conf` | `/etc/dhcpd.conf` | `/etc/dhcp/dhcpd.conf` |
| NIC to listen on | `INTERFACESv4` in `/etc/default/isc-dhcp-server` | `systemctl edit dhcpd4` to override ExecStart | `DHCPDARGS` in `/etc/sysconfig/dhcpd` |
| Lease file | `/var/lib/dhcp/dhcpd.leases` | `/var/lib/dhcp/dhcpd.leases` | `/var/lib/dhcpd/dhcpd.leases` |
| Client tool | `dhclient` (isc-dhcp-client, usually already installed) | `dhclient` ships in the package | `dhclient` (dhcp-client package) |

The differences across the three families concentrate in package name, unit name, and config path; the config syntax is identical. One point that confuses people: Arch's `dhcp` package installs both the server `dhcpd` and the ISC client `dhclient`, whereas `dhcpcd` is the client of a different, independent project (it is what Arch uses to get online by default) -- one letter apart: the former, dhcpd, hands out addresses, while the latter, dhcpcd, asks for them. When troubleshooting, align `systemctl status` on the right unit first, and do not chase the client's log as if it were a server problem.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install isc-dhcp-server
$ systemctl status isc-dhcp-server | head -3
     isc-dhcp-server.service - ISC DHCP IPv4 server
     Active: failed (Result: exit-code) ...
```

Right after install, `status` most likely shows failed -- the install is not broken; Debian's default config has no subnet declarations yet, and dhcpd refuses to run empty (reason in the first trap of section 6). On Debian-family systems the standard order is: finish the config and write `INTERFACESv4` in `/etc/default/isc-dhcp-server`, then start -- configure first, then start, rather than installing and starting.

### 2.2 Arch

```bash
$ sudo pacman -S dhcp
$ sudo touch /var/lib/dhcp/dhcpd.leases      # make sure the lease file exists before the first run
$ sudo systemctl enable --now dhcpd4 && systemctl is-active dhcpd4
active
```

Arch's config lives at the upstream default path `/etc/dhcpd.conf` (note there is no `/etc/dhcp/` directory layer), and the unit name `dhcpd4` explicitly marks IPv4 only -- for IPv6 PD there is `dhcpd6`. If the first start reports a lease-file error, the second line above was skipped: dhcpd does not create its own lease file; this "ledger" must exist on disk first. To restrict listening to a specific NIC, use `systemctl edit dhcpd4` to write a drop-in overriding `ExecStart`, appending the NIC name at the end of the command line.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install dhcp-server
$ sudo systemctl enable --now dhcpd && systemctl is-active dhcpd
active
$ sudo ss -ulnp | grep :67
udp   UNCONN 0  0  0.0.0.0:67  0.0.0.0:*  users:(("dhcpd",pid=1248,fd=7))
```

Since RHEL 8 the old `dhcp` package was split into `dhcp-server` and `dhcp-client`, so following old docs with `dnf install dhcp` will fail. `ss -ulnp | grep :67` is the final acceptance check shared by all three families: an active unit only means the process is alive, while UDP 67 actually holding the broadcast socket means the service is receiving packets -- the same discipline as verifying BIND with a `dig` response rather than a green `systemctl` light. Opening the firewall for DHCP (UDP 67/68) is not covered on this page; see the [Firewall](../security/firewall.md) page.

## 3. Server Configuration

### 3.1 Address Pool and Global Options

Below is a complete, runnable configuration for a `192.168.56.0/24` LAN, with comments matching the semantics line by line:

```text
# /etc/dhcp/dhcpd.conf (on Arch: /etc/dhcpd.conf)
authoritative;                       # this machine is the official DHCP for the subnet (see section 1.3)
option domain-name "lan.example.com";
option domain-name-servers 192.168.56.10, 192.168.56.2;
default-lease-time 3600;             # default lease: 1 hour
max-lease-time 7200;                 # even if the client asks for longer, it gets 2 hours

subnet 192.168.56.0 netmask 255.255.255.0 {
    option routers 192.168.56.2;     # gateway: the egress for cross-subnet traffic and NAT, see the Routing and NAT page
    range 192.168.56.100 192.168.56.200;   # dynamic pool: 101 addresses available for leasing
}
```

Three things are worth stopping to think about. First, the `subnet` block must match the actual subnet of one of the server's NICs -- dhcpd uses it to decide "should I answer this broadcast"; if the NIC is on `192.168.56.0/24` but the config only declares `10.0.0.0/8`, the service will not start at all. Second, putting `domain-name-servers` in the global scope and `routers` inside the subnet deliberately demonstrates the two scopes: global options apply to every subnet, while subnet options apply only to that segment -- on multi-subnet networks, where the gateway differs per segment but DNS is uniform, this division is exactly the typical use. Third, `range` defines the dynamic pool; addresses outside the pool are left for reservations and static devices. The boundary between "pool" and "reservation zone" must be drawn once at planning time; most of the conflict traps later trace back to this boundary never being drawn.

When the server has two NICs, each on a subnet, declare the two subnets side by side; dhcpd picks the pool of the subnet matching the interface the broadcast arrived on, and the global options are shared by both:

```text
# Two NICs, two subnets: append this block in addition to the section 3.1 config
subnet 192.168.57.0 netmask 255.255.255.0 {
    option routers 192.168.57.2;           # this segment's gateway differs from the 56 segment
    range 192.168.57.100 192.168.57.150;   # size the pool by the device count on the segment
}
```

This is the simplest form of "one server serving multiple subnets" (direct physical attachment); for the relay approach when a router sits between subnets, see section 6. Note that each segment needs its own clearly drawn pool/reservation boundary, and non-overlapping address spaces between segments are a hard prerequisite.

### 3.2 Fixed Reservations (host)

Printers, NAS boxes, and internal services that need port mapping are identified by MAC, not by lease:

```text
# Appended to dhcpd.conf -- reservations go outside the range (.50 is not in .100-.200)
host laserjet {
    hardware ethernet 08:00:27:aa:bb:cc;
    fixed-address 192.168.56.50;
    option host-name "laserjet";
}
```

A reservation essentially means "always offer the same address" -- the client still runs the standard DORA flow, only the Offer is pinned; from the client's point of view it is a "DHCP client that gets the same address every time", which differs subtly from manual static configuration (the latter does not participate in DHCP at all). Reservations must be drawn outside the `range`: before sending an Offer, dhcpd pings the candidate address to check it is free by default, but when the target machine's firewall drops ICMP the probe fails, and a pool address gets handed out twice under "ping does not answer but someone is actually using it" -- the classic accident when the reservation zone overlaps the dynamic pool. If you already run your own BIND on the LAN, register both an A and a PTR record for the reservation so that name, MAC, and address agree in all three places -- DHCP handles granting, DNS handles naming; the two ledgers keep separate books, but they must reconcile.

### 3.3 Listening NIC and Syntax Checks

By default dhcpd tries to serve every broadcast interface; in production you should pin it down explicitly. The entry points differ across the three families but the semantics are the same:

```text
# /etc/default/isc-dhcp-server (Debian/Ubuntu)
INTERFACESv4="enp3s0"

# /etc/sysconfig/dhcpd (RHEL family)
DHCPDARGS="enp3s0"
```

```bash
# The fixed prelude after editing config: syntax check, restart only if it passes
$ sudo dhcpd -t -cf /etc/dhcp/dhcpd.conf
Internet Systems Consortium DHCP Server 4.4.3-P1
...
If you did not get this output, there may be errors in your config.   # passes if there is no error
$ sudo systemctl restart isc-dhcp-server    # Arch: dhcpd4; RHEL: dhcpd
```

`dhcpd -t` is to dhcpd what `nginx -t` and `named-checkconf` are to their services: it catches syntax errors before the restart. It checks syntax and structure, but not runtime facts such as "does the subnet match the NIC" -- those only surface when the service actually starts, so acceptance still means `systemctl is-active` and `ss -ulnp | grep :67` both green.

## 4. Client and Lease Verification

### 4.1 The Server's View: Reading the Lease Ledger

```bash
$ sudo cat /var/lib/dhcp/dhcpd.leases
lease 192.168.56.101 {
  starts 3 2026/10/01 09:12:44;
  ends 3 2026/10/01 10:12:44;
  binding state active;
  next binding state free;
  hardware ethernet 08:00:27:9f:3a:c1;
  client-hostname "desk-01";
}
```

`binding state active` means the lease is on the books, `starts/ends` is the lease window, and `hardware ethernet` is the tenant's identity -- when a new device comes online, the first thing to check here is "did it actually take an address from me, and which one". On a successful renewal the `ends` value in the file moves forward; debugging "the address is about to expire and did not renew" means watching the timestamps in this ledger.

Renewals also leave clear footprints in the server log, so you can verify the T1 moment from section 1.2 on the spot: halfway through the term the client sends only a unicast REQUEST (no Discover), the server replies ACK, and it is done in two steps:

```bash
$ sudo journalctl -u isc-dhcp-server --since "2 hours ago" | grep 9f:3a:c1
... DHCPREQUEST for 192.168.56.101 from 08:00:27:9f:3a:c1 via enp3s0   # unicast renewal, no Discover
... DHCPACK on 192.168.56.101 to 08:00:27:9f:3a:c1 via enp3s0
```

Frequent full DORA sequences (with Discover) in the log mean the client is re-acquiring its address over and over -- either the lease never renews, or the client's NIC keeps reconnecting; both root causes point at the "environment", not at dhcpd's config.

### 4.2 The Client's View: Request and Verify the Handed-Down Parameters

```bash
# One-off manual request (the most direct approach for verification)
$ sudo dhclient -v -r && sudo dhclient -v enp3s0
Listening on LPF/enp3s0/08:00:27:9f:3a:c1
DHCPDISCOVER on enp3s0 to 255.255.255.255 port 67 interval 1
DHCPOFFER of 192.168.56.101 from 192.168.56.5
DHCPREQUEST of 192.168.56.101 on enp3s0 to 255.255.255.255 port 67
DHCPACK of 192.168.56.101 from 192.168.56.5
$ ip -4 addr show enp3s0 | grep inet
    inet 192.168.56.101/24 brd 192.168.56.255 scope global dynamic enp3s0
$ ip route | head -1
default via 192.168.56.2 dev enp3s0       # whether option routers took effect: look at this line
```

On a NetworkManager-managed desktop the equivalent is `nmcli con mod <connection> ipv4.method auto && nmcli con up <connection>` (the full static/dynamic comparison is in [Network Configuration Fundamentals](../network/network-configuration.md)). Verification is not just "got an address": gateway, DNS, and the domain suffix must each be checked, because they correspond to different options in the config -- a half-broken allocation like "address but no gateway" is precisely the high-frequency trap of section 6:

```bash
$ resolvectl status enp3s0 | grep -A2 "DNS Server"
Current DNS Server: 192.168.56.10
       DNS Servers: 192.168.56.10 192.168.56.2
        DNS Domain: lan.example.com      # both option domain-name and domain-name-servers were handed down
```

### 4.3 Packet Capture for DORA and Log Reading

```bash
# Watch the full four steps on the server NIC (trigger by restarting dhcpcd/dhclient)
$ sudo tcpdump -i enp3s0 -n port 67 or port 68
09:12:43.112341 IP 0.0.0.0.68 > 255.255.255.255.67: BOOTP/DHCP, Request from 08:00:27:9f:3a:c1
09:12:43.114902 IP 192.168.56.5.67 > 255.255.255.255.68: BOOTP/DHCP, Reply from 08:00:27:aa:bb:cc   # Offer
09:12:43.118760 IP 0.0.0.0.68 > 255.255.255.255.67: BOOTP/DHCP, Request from 08:00:27:9f:3a:c1
09:12:43.121577 IP 192.168.56.5.67 > 255.255.255.255.68: BOOTP/DHCP, ACK from 08:00:27:aa:bb:cc
$ sudo journalctl -u isc-dhcp-server --since "10 min ago" | grep dhcpd
... dhcpd[1248]: DHCPDISCOVER from 08:00:27:9f:3a:c1 via enp3s0
... dhcpd[1248]: DHCPOFFER on 192.168.56.101 to 08:00:27:9f:3a:c1 (desk-01) via enp3s0
... dhcpd[1248]: DHCPACK on 192.168.56.101 to 08:00:27:9f:3a:c1 (desk-01) via enp3s0
```

Discover present but no Offer points at the server config or permissions; no Discover at all points at the link or the client; no ACK after the Request most likely means writing the lease ledger failed -- a capture cuts the fault into one of the three segments far faster than guessing through logs. Debian-family systems can also `apt install dhcpdump` for a field-by-field decoded view; it is the same thing as tcpdump, just with the DORA fields translated into human language.

## 5. Kea: ISC's New-Generation DHCP

ISC announced end-of-maintenance for ISC DHCP at the end of 2022 (no fixes after the final 4.4.3-P1), and the successor is Kea, also developed by ISC. dhcpd is still widely used across distros with a mature config ecosystem, and existing deployments have no short-term pressure to migrate; but new projects should evaluate Kea directly, especially when they need these capabilities: leases in MySQL/PostgreSQL to support large scale and multi-server sharing, built-in HA hot standby (premium hook), a REST API management interface, and native IPv6 and prefix delegation support.

```bash
$ sudo apt install kea-dhcp4-server       # Debian/Ubuntu; RHEL family via EPEL: dnf install kea; Arch must be built from the AUR
$ sudo systemctl enable --now kea-dhcp4-server
$ keactrl status
kea-dhcp4: active                         # keactrl manages the state of the kea-dhcp4/-6 processes in one place
```

```json
// /etc/kea/kea-dhcp4.conf -- the minimal config equivalent to section 3 (JSON)
{
  "Dhcp4": {
    "interfaces-config": { "interfaces": ["enp3s0"] },
    "lease-database": { "type": "memfile" },
    "valid-lifetime": 3600,
    "subnet4": [{
      "subnet": "192.168.56.0/24",
      "pools": [{ "pool": "192.168.56.100 - 192.168.56.200" }],
      "option-data": [
        { "name": "routers", "data": "192.168.56.2" },
        { "name": "domain-name-servers", "data": "192.168.56.10, 192.168.56.2" }
      ],
      "reservations": [{
        "hw-address": "08:00:27:aa:bb:cc",
        "ip-address": "192.168.56.50",
        "hostname": "laserjet"
      }]
    }]
  }
}
```

The concepts map one to one: `pools` is range, `option-data` is the option lines, `reservations` is the host reservation, `valid-lifetime` is default-lease-time -- what changes is the carrier (text becomes JSON); what does not change is DORA and the lease model.

| Dimension | ISC dhcpd | Kea |
|------|-----------|-----|
| Maintenance status | maintenance ended end of 2022, still widespread in existing deployments | an active ISC project, continuously updated |
| Config carrier | plain-text `dhcpd.conf` | JSON, machine-friendly |
| Lease backend | local file | memfile / MySQL / PostgreSQL |
| High availability | primary/backup on their own, external coordination needed | native two-node HA hook (premium) |
| API/automation | none | REST control API (CA) |
| IPv6 prefix delegation | supported, cumbersome config | native support |

The selection rule: for learning and small LANs keep using dhcpd -- plenty of material and direct troubleshooting; reach for Kea when you have thousands of addresses, need a database lease backend, or want API automation. Both come from ISC, clients do not see any difference at the DORA message level, and migration can be rolled out subnet by subnet.

## 6. Troubleshooting and Common Traps

**Service will not start: No subnet declaration.** `journalctl -u dhcpd -e` shows `No subnet declaration for enp3s0 (no address yet.)` or `Not configured to listen on any interfaces!`; the root cause is that no subnet in the config matches the NIC's actual subnet -- either the NIC has no address yet (the machine itself is also waiting on DHCP), or the subnet declares the wrong network. The order of action: `ip addr` to confirm the NIC already has a static address -> check that the subnet/netmask in `dhcpd.conf` matches -> `dhcpd -t` passes, then start. Giving the DHCP server itself a static address is a precondition; a machine without a stable address of its own cannot hand out leases to others.

**The client got an address but no gateway/DNS.** Address in place, but `ping 8.8.8.8` fails or name resolution fails: first `ip route` to see whether a default route exists, then `resolvectl status` to see whether DNS was handed down. Nine times out of ten `option routers` / `option domain-name-servers` is missing or written in the wrong scope (a typo inside the subnet means the global option will not back it up). Compare the position and spelling of the two options against section 3.1; capturing the packet and looking at which options the ACK actually carries is the final arbiter.

**IP address conflict.** The symptom is two machines intermittently fighting for the line, with the MAC address jumping back and forth in the switch's forwarding table. First check whether `range` overlaps machines with manual static config or the host reservation zone -- dhcpd pings pool addresses by default to probe them, but this is worthless when the target's firewall drops ICMP; only boundary planning (reservations outside the pool, a separately carved static segment) truly fixes it. For an address already in conflict, delete the corresponding lease block from the lease file and restart dhcpd to force the reclaim, then have the victim machine run DORA again.

**Clients on a remote subnet get no address.** DHCP broadcasts do not cross routers; for a central DHCP to serve a remote segment you need a relay on that segment: `dhcrelay -i <internal NIC> <DHCP server IP>`, which converts the broadcast to unicast toward the server and converts the reply back to broadcast; the giaddr field in the message tells the server "which subnet's pool to pick from". Without a relay there are only two options: a local DHCP on every segment, or a DHCP relay configured on a layer-3 switch -- the topology decides the solution; the config merely executes it.

**A second DHCP answers on the LAN.** The symptom is one client hopping between address subnets at varying speed, with gateway and DNS drifting, and the lease ledger filling with addresses "not in your plan". The most common sources at home and in labs: the router's built-in DHCP coexisting with your new server, and virtualization software (VirtualBox/VMware host-only, libvirt's default network) putting another stack on the bridged segment. Handle evidence first, defuse second: capture ports 67/68 on both sides, see which MAC each Offer comes from, and once the answerer is identified, either disable the router's built-in DHCP or switch the libvirt network to isolated mode with `forward dev=...`, so that only one responder exists per broadcast domain -- DORA's third step does broadcast a "loser declaration", but it only coordinates concurrency within the protocol; it cannot control two configurations that know nothing of each other.

**Edits to the config have no effect.** Three-step self-check: was `dhcpd -t` actually run (a syntax error means it will not start at all); did you `systemctl restart` (dhcpd has no reload semantics; a config change requires restarting the whole process); is the client still holding its old lease (it will not run DORA again until the lease expires -- verify with a manual `dhclient -r && dhclient -v`, or disconnect and reconnect). The same discipline as BIND's "you must rndc reload after editing": every link in the chain that makes a config take effect must be watched going green with your own eyes.

## References

- ISC DHCP official documentation -- [isc.org/dhcp](https://isc.org/dhcp/)
- Kea official documentation (Kea ARM) -- [kea.readthedocs.io](https://kea.readthedocs.io/)
- Arch Wiki: dhcpd -- [wiki.archlinux.org/title/Dhcpd](https://wiki.archlinux.org/title/Dhcpd)
- "Vbird's Linux Cabinet" - DHCP server -- [linux.vbird.org](https://linux.vbird.org/linux_server/)
- man dhcpd.conf -- the authoritative source for config syntax
- man dhcpd.leases -- the lease file format

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)