# VPN

A VPN (Virtual Private Network) does one thing,
which can be summed up in a single sentence:
**over an untrusted network,
forge a trusted private link**.
Remote work needing access to internal systems,
two offices needing to talk to each other,
a traveling employee needing to browse safely --
all of it is the same requirement --
run a scenario that used to require a dedicated line
over the public internet through an encrypted tunnel.

This page first explains how a tunnel and routing cooperate
(which decides 90% of configuration problems),
then gives two deployable configurations,
WireGuard and OpenVPN,
and finally adds the conceptual positioning of IPsec and security practice.

> Content adapted from the official documentation of WireGuard,
> OpenVPN, and Libreswan and the Arch Wiki;
> see the references at the end.

## What This Page Covers

- How a VPN tunnel works:
  how encapsulation, encryption, and routing fit together
- WireGuard's key scheme,
  configuration syntax, and the semantics of `AllowedIPs`
- Being able to deploy OpenVPN (certificate mode)
  and understanding where it applies
- The concepts of IPsec/IKE
  and where they sit in site-to-site interconnection
- Recognizing the VPN failure modes that occur most often:
  routes not allowed, NAT traversal, MTU fragmentation,
  the firewall blocking UDP

## 1. Why VPNs Exist

### 1.1 Three Typical Scenarios

**Remote access**:
an employee at home or in a cafe
needs to reach the internal Git, jump host, and test environment
as if sitting in the office.
Rather than opening a public entrance for every internal service,
have the employee "enter" the internal network first --
the entrance converges to one,
and audit and rate limiting only need to be done in one place.

**Site to site**:
headquarters and a branch each have a full internal network
and need to interconnect like a single cable,
so the two sides' 192.168.x.x networks can reach each other directly.
Business systems deployed on internal addresses
with no configuration changed at all
is the biggest value in this kind of scenario.

**Safe access to the public internet**:
traffic on public Wi-Fi
may be sniffed by a man in the middle,
and the tunnel converges the egress to a trusted gateway and forwards from there.
In the cafe scenario,
what the VPN protects is not "confidentiality" itself
but the illusion of "you think you are on a direct connection
when someone is actually in the middle".

What the three have in common is
**replacing a dedicated line with a tunnel**,
and the cost is that it introduces three new failure domains:
encryption, authentication,
key management, and the tunnel's own routing.
The benefit and the complexity arrive together --
understand that,
and you will not be surprised by "the VPN is half-working".

### 1.2 The Division of Labor Among Tunnel, Encryption, and Routing

One VPN communication contains three orthogonal mechanisms,
and understanding their division of labor is a prerequisite for troubleshooting.

**Tunnel (encapsulation)**:
stuff the original packet whole into another packet,
with the source/destination addresses becoming the two tunnel endpoints,
like an envelope inside an envelope.
From the original packet's point of view, the intermediate network is completely transparent.

**Encryption and authentication**:
guarantee that only the peer holding the key/certificate can decrypt,
and that the content was not tampered with.
WireGuard completes a Noise protocol handshake and then encrypts with ChaCha20;
OpenVPN is based on TLS;
IPsec uses IKE negotiation plus ESP encryption.

**Routing**:
once the tunnel interface (`wg0`, `tun0`, `ipsec0`) appears,
the kernel must know
"which destination addresses go through this tunnel".
**Encryption working does not mean routing is correct** --
this is the root of "the VPN connected but the internal network will not ping".

Flow diagram:

```text
LAN packet 10.0.0.5 -> decide: covered by AllowedIPs/routing table
        -> enter the tunnel interface -> encrypt and encapsulate as UDP
        -> send out the physical NIC to the peer's public address
        -> peer decapsulates -> forward into the LAN
```

Note the last step:
**the peer must also be willing to forward and return traffic**,
including kernel `ip_forward`,
NAT rules,
and a return entry in the peer's routing table.
A VPN with a fully correct local configuration but a missing return route on the peer
is the most common "half-working" case in site-to-site links --
A can ping B, but B's response never comes back.
When troubleshooting, always draw the bidirectional path first
before looking at one side's configuration.

## 2. Selection: WireGuard, OpenVPN, IPsec

| Dimension | WireGuard | OpenVPN | IPsec (IKEv2/ESP) |
|------|-----------|---------|---------------------|
| Protocol | UDP (default 51820), custom Noise handshake | UDP/TCP 1194, TLS-based | UDP 500/4500, IKE + ESP |
| Code size | Kernel module, on the order of thousands of lines | Userspace, hundreds of thousands of lines | Mixed kernel/userspace, complex implementation |
| Configuration complexity | Very low (two key pairs + AllowedIPs) | High (PKI, certificates, policy files) | High (SAs, policies, certificates) |
| Typical scenario | Personal networking, container interconnect, modern server-to-server links | Needs to punch through strict proxies, compatibility with old clients | Interoperating with hardware firewalls / existing devices |
| Authentication model | Static public key (peer identified by its public key) | X.509 certificate | Certificate or PSK |

**Rule of thumb**:
new projects default to WireGuard,
unless you need to disguise over TCP 443
(OpenVPN's advantage)
or must do standards-compliant IPsec interconnection with vendor network equipment.
The three can coexist on the same gateway,
distinguished by different ports.

The practical meaning of TCP mode is often underrated:
some hotel networks only allow 443,
and only OpenVPN over TCP can establish the connection,
while WireGuard's pure UDP
fails outright in that case.
Teams that travel often
keeping OpenVPN as a fallback channel
is a mature practice.

Install across the three distro families
(Arch always `pacman -S`):

```bash
# WireGuard: Debian/Ubuntu
sudo apt install wireguard
# Arch: the kernel already ships the module, only userspace tools are needed
sudo pacman -S wireguard-tools
# RHEL/CentOS/Rocky 8/9
sudo dnf install wireguard-tools

# OpenVPN + certificate tooling
sudo apt install openvpn easy-rsa      # Debian/Ubuntu
sudo pacman -S openvpn easy-rsa        # Arch
sudo dnf install openvpn easy-rsa      # RHEL/CentOS (easy-rsa is also in EPEL)
```

## 3. WireGuard

### 3.1 Key Scheme

WireGuard needs no certificate scheme;
each machine has one curve key pair
(private key + public key),
and peers exchange public keys to establish trust.
This compresses the complexity of PKI into two commands:

```bash
# Generate the server key
wg genkey | tee server_private.key | wg pubkey > server_public.key

# Generate the client key
wg genkey | tee client_private.key | wg pubkey > client_public.key
```

Private key permissions must be `600`
and it must never leave the server;
public keys can be distributed freely.
WireGuard has no "revocation list" --
the way to kick a client
is to delete its
`[Peer]` section in the server configuration and reload the interface.
So **the emergency response for a leaked private key
is to rotate the keys and update every peer**,
with no more elegant intermediate state.

Key storage also has its own care:
do not commit it to Git,
do not stuff it into a shared directory.
Exchange public keys offline
(or through an encrypted channel of your configuration management system),
and generate private keys only on the target machine --
once a private key has traveled through a chat tool once,
treat it as needing rotation.

### 3.2 Server Configuration

```ini
# /etc/wireguard/wg0.conf (server)
[Interface]
PrivateKey = <server_private_key>
Address = 10.0.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = <client_public_key>
AllowedIPs = 10.0.0.2/32
```

`PostUp`/`PostDown`
run when the interface comes up and goes down,
and handle two key things:
**allowing forwarding**
(otherwise tunnel traffic comes in but cannot get out)
and **NAT**
(so internal return packets know how to get back to the tunnel address).
If the server only does point-to-point
and does not forward third-party traffic,
these two lines can be omitted.

IP forwarding itself also needs a kernel parameter to let it through
(`net.ipv4.ip_forward = 1`,
written into `/etc/sysctl.d/`
then `sysctl --system`),
and forgetting this step shows up as
the client can connect and `wg show` handshakes normally,
yet the server's internal network will not ping --
**handshake success does not mean forwarding is on**,
and the two are completely independent switches.
The same goes for systems using nft;
the iptables rules inside PostUp
can be replaced with equivalent nft syntax,
but the policy of the FORWARD hook
must be accept or have an explicit allow.

### 3.3 Client Configuration

```ini
# /etc/wireguard/wg0.conf (client)
[Interface]
PrivateKey = <client_private_key>
Address = 10.0.0.2/24
DNS = 10.0.0.1

[Peer]
PublicKey = <server_public_key>
Endpoint = 203.0.113.5:51820
AllowedIPs = 10.0.0.0/24
PersistentKeepalive = 25
```

**`AllowedIPs`
is the most easily misunderstood field in WireGuard**:
it carries two semantics at once --
(1) which source addresses the peer is allowed to send you
(a security allowlist),
and (2) which destination addresses' routes
point into this tunnel (the routing table).
So if the client writes
`AllowedIPs = 0.0.0.0/0`,
that is global VPN mode with "all traffic into the tunnel";
writing only `10.0.0.0/24`
is internal-access mode.
On the server side, each `[Peer]`
usually gets the client's address as a `/32`,
meaning only that client's own traffic is accepted.

`PersistentKeepalive = 25`
solves the problem of NAT mappings expiring:
when the client is behind a home router,
if it does not actively send packets the NAT session is reclaimed,
and the peer can no longer initiate a connection backwards.
**Scenarios where only the client side initiates traffic may skip it,
but once the server needs to actively reach the client
(push configuration, internal access),
this keepalive is mandatory.**
The way to judge is simple:
one-way curl works,
server-initiated push fails --
check keepalive before anything else.

`DNS = 10.0.0.1`
temporarily takes over system resolution
when the connection is established
(wg-quick sets it through resolvconf
or systemd-resolved),
and restores it after disconnecting.
If the client does not set DNS,
short names inside the tunnel network may fail to resolve,
which is also a common cause of
"can ping the IP but cannot open an internal hostname".

### 3.4 Startup and Verification

```bash
$ sudo wg-quick up wg0
$ sudo wg show
interface: wg0
  public key: 3L4x8K...=
  listening port: 51820

peer: 9Zc1wQ...
  endpoint: 198.51.100.23:54321
  allowed ips: 10.0.0.2/32
  latest handshake: 12 seconds ago
  transfer: 48.21 KiB received, 51.06 KiB sent

$ sudo systemctl enable --now wg-quick@wg0
```

Verification follows the same reasoning chain as
[Network Troubleshooting](./troubleshooting.md),
just with one extra tunnel-state step at the very front:
whether `latest handshake`
was updated within the last minute.
A handshake stuck at a few minutes ago means the tunnel is down,
at which point pinging a tunnel-internal address is meaningless;
restore the handshake first
(check UDP endpoint reachability, NAT, firewall).

If the handshake is normal but the tunnel interior does not work,
check in order
`AllowedIPs`, `ip route`,
the peer's forwarding and NAT --
the order corresponds one to one to the three mechanisms in section 1.2.
In `wg show`, `transfer`
growing in both directions
means the data plane is really running;
only a handshake with no transfer
means routing or the firewall stopped the traffic halfway.

### 3.5 Common Pitfalls

- **Routes missing after `wg-quick up`**.
  `AllowedIPs` decides
  whether `wg-quick` adds routes automatically;
  a manual `wg set` does not add routes,
  and you must `ip route add` yourself.
- **Asymmetric AllowedIPs between server and client**.
  The server allows `10.0.0.2/32`,
  but the client declares `0.0.0.0/0`
  and pushes out the default route for other traffic,
  bringing down the whole network --
  think through which mode you want before editing the config.
- **UDP 51820 blocked by the egress firewall / cloud security group**.
  Symptom: local `wg show` shows no handshake and no error.
  Use `tcpdump -ni eth0 udp port 51820`
  to see whether there is bidirectional traffic,
  then collect evidence against the [Firewall](./firewall.md) section.
- **MTU causing "small packets pass, large ones die"**.
  After the tunnel headers stack on, the effective MTU shrinks,
  so ping works but SSH hangs and web pages will not open;
  the typical symptom is
  `ping -M do -s 1400` failing
  while `-s 1000` succeeds.
  The fix is to set a smaller MTU on the tunnel interface
  (start at `MTU = 1280`),
  or clamp TCPMSS at the TCP layer.
- **Only one side's return route configured**.
  The server can ping the client's tunnel address
  but cannot ping back into the client's LAN,
  because the return path has no entry pointing into the tunnel --
  write both directions into the config according to the topology.

## 4. OpenVPN

### 4.1 Certificate Model and PKI

OpenVPN's trust is based on X.509 certificates,
so a minimal PKI
(a certificate authority) must be built first,
done with `easy-rsa`:

```bash
$ cd /etc/openvpn
$ sudo make-cadir easy-rsa && cd easy-rsa
$ sudo ./easyrsa init-pki
$ sudo ./easyrsa build-ca nopass
$ sudo ./easyrsa gen-req server nopass
$ sudo ./easyrsa sign-req server server
$ sudo ./easyrsa gen-req client1 nopass
$ sudo ./easyrsa sign-req client client1
$ sudo ./easyrsa gen-dh
$ sudo openvpn --genkey secret /etc/openvpn/ta.key
```

The operational cost of PKI
is clearly higher than WireGuard's two keys,
but in return you get a complete issue/revocation chain
(together with CRLs),
which fits enterprise environments with
"frequent personnel turnover,
certificates issued by role".
`build-ca nopass`
removes the interactive password prompt each time
and is automation-friendly,
but the CA private key is therefore unprotected by a passphrase --
**add a passphrase to a production CA and back it up offline**;
here it is simplified only for the demonstration.

The certificate issuance flow itself is also a governance tool:
someone leaves, revoke their certificate,
and audit logs are attributed by CN,
which is far clearer than "sharing one PSK".
The cost is that every new client
requires the whole issuance flow again --
beyond a few dozen clients,
either automate issuance,
or seriously consider switching to WireGuard.

### 4.2 Server and Client Configuration

```bash
# /etc/openvpn/server.conf (excerpt; adjust paths to where your PKI actually lives)
port 1194
proto udp
dev tun

ca   /etc/openvpn/easy-rsa/pki/ca.crt
cert /etc/openvpn/easy-rsa/pki/issued/server.crt
key  /etc/openvpn/easy-rsa/pki/private/server.key
dh   /etc/openvpn/easy-rsa/pki/dh.pem

server 10.8.0.0 255.255.255.0
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 10.8.0.1"

keepalive 10 120
tls-auth /etc/openvpn/ta.key 0
cipher AES-256-GCM
auth SHA256

user nobody
group nogroup
persist-key
persist-tun
verb 3
```

The `server` directive does three things in one line:
carving out the tunnel subnet,
generating the server's tunnel address,
and handing DHCP-style addresses to connecting clients.
`push "redirect-gateway"`
makes the client redirect its default route into the tunnel
(global VPN);
when global mode is not needed, just delete that line --
**many "my whole home loses internet the moment the VPN connects" complaints
are a client being pushed a default route when it should not have been**.

The client's `client.ovpn` side correspondingly writes
`remote <server IP> 1194`,
the certificate/private key paths and `cipher`
(must match the server side),
and likewise sets `persist-tun` and `nobind`.
Management and troubleshooting commands:

```bash
$ sudo systemctl start openvpn@server
$ sudo systemctl enable openvpn@server
$ sudo journalctl -u openvpn@server -f
$ sudo cat /var/log/openvpn/status.log
```

Newer OpenVPN versions log to journald by default,
no longer always writing to
`/var/log/openvpn/openvpn.log` --
querying logs by unit is the most reliable approach.
The common causes of handshake failure, in order, are:
clock skew too large,
CA/cipher not matching the client,
the UDP port blocked,
expired certificate (rotate with `easyrsa renew`).
The clock problem is the stealthiest:
TLS is sensitive to certificate validity and
NotBefore/NotAfter,
and clock drift after a virtual machine wakes from sleep
directly causes handshake failure --
during troubleshooting, `chronyc tracking`
deserves a spot in your top five commands.

### 4.3 Site to Site

Run one OpenVPN on each of two gateways
and write the other's internal network into the routes.
The server declares the peer's subnet,
and the client declares the return subnet:

```bash
# Site A (server): send traffic bound for site B's LAN into the tunnel
route 192.168.2.0 255.255.255.0

# Site B (client): the return path
route 192.168.1.0 255.255.255.0
```

Bidirectional routes + bidirectional firewall allows +
`ip_forward=1` on both sides;
missing any one of the three gives you "one-way working".
Once the topology exceeds two sites,
switch to dynamic routing
(such as running OSPF/BGP over the tunnel)
or go straight to a mesh solution;
the manual maintenance cost of static routes
grows with the square of the site count --
three sites is fine,
thirty sites needs a control plane.

Site-to-site also needs MTU and MSS aligned:
after two layers of encapsulation stack up,
large internal packets are easily fragmented inside the tunnel.
If you notice "file transfers are slow,
small requests are normal",
prefer TCPMSS clamping on both sides of the tunnel
over tuning application timeouts.
This lesson applies equally to WireGuard,
OpenVPN, and IPsec.

## 5. The Concepts of IPsec

IPsec is the IETF standard for network-layer encryption frameworks;
**it is not a single protocol**,
but a combination of two protocol groups.

**IKE (Internet Key Exchange)**,
UDP 500/4500:
responsible for identity authentication and key negotiation;
IKEv2 is more concise than v1 and
supports mobility (MOBIKE),
and is the currently recommended version.

**ESP (Encapsulating Security Payload)**:
responsible for the actual data encryption and integrity protection,
with a choice of transport mode
(encrypting only the payload, host to host)
or tunnel mode
(wrapping the whole packet in another layer, commonly used for site-to-site).

Implementations on Linux are Libreswan
(the default on the RHEL/CentOS family)
and StrongSwan
(common on Arch/Debian),
and the configuration core is **policy**
(which traffic to encrypt, and with whom)
and **SA** (security association,
the negotiated key state).

Unlike WireGuard's static public key model,
IPsec policies are declared by "source/destination subnet pair",
which is very well suited to interoperating with standard devices such as
hardware firewalls, NAS boxes,
and routers --
which is also why it remains irreplaceable
in enterprises' existing environments.
For new internal Linux interconnection, WireGuard is still the first choice;
reach for IPsec only when you need to talk to vendor equipment.

At the conceptual level you only need to remember three things:
IPsec site-to-site is equivalent to
"first establish a trusted SA,
then use the policy to define which traffic enters the tunnel";
under NAT it relies on
NAT-Traversal (UDP 4500);
when troubleshooting, look first at whether IKE negotiated successfully
(`ip xfrm state` / `ipsec status`),
then the data plane
(`tcpdump` for ESP or port 4500),
and finally whether the policy covers the target subnet
(`ip xfrm policy`).
This is completely isomorphic to WireGuard's
"handshake first, then routing",
so the reasoning chain can be migrated directly.

## 6. Security Practice

- **Minimal exposure surface**.
  Open only the VPN ports you truly need
  (UDP 51820 / 1194 / 500,4500),
  and restrict the source IP;
  management ports open to the whole public internet
  are a scanner's first target.
  For clients without a fixed egress,
  at least back things up with rate limiting and key rotation.
- **Key and certificate rotation**.
  WireGuard private keys,
  OpenVPN CAs and server certificates
  should all have a replacement plan;
  OpenVPN should rotate the server certificate at least yearly,
  and reissue clients promptly on departures with the CRL updated.
- **Do not go "all traffic" unless you really need to**.
  `AllowedIPs = 0.0.0.0/0`
  and `redirect-gateway`
  pull all Internet traffic into the tunnel,
  amplifying server bandwidth use and single-point-of-failure impact;
  when you only need internal access, the internal subnet is enough.
- **Permissions on sensitive files**.
  Everything under `/etc/wireguard/*.key` and
  `/etc/openvpn/**/private/*`
  should be `600 root:root`,
  and keep configuration directories out of version control in plaintext.
- **Logging and audit**.
  For WireGuard look at `latest handshake`
  and transfer statistics;
  for OpenVPN turn on `verb 3`
  and keep the journald logs;
  handshakes at odd times
  and abnormally large transfers are both worth alerting on,
  and can be wired into the [Network Monitoring](./network-monitoring.md) system.
- **Firewall cooperation**.
  Allowing a VPN through is connectivity configuration;
  after allowing it, still confirm
  that it was not overwritten by a broader DROP rule;
  see [Firewall](./firewall.md).

Security and availability make one deliberate trade-off here:
unhandshaken WireGuard traffic
is silently dropped (no ICMP reply),
so an outsider sees "port does not exist"
and a misconfigured insider sees the same
"nothing at all" --
silence is both protection and an obstacle to troubleshooting.
That is why tunnel failures
rely more on active handshake-state checking
than on waiting for a connection timeout error.

## 7. Quick Reference for Common Pitfalls

| Symptom | Check first |
|------|----------|
| Cannot connect, no handshake log | Whether the UDP port is blocked by a cloud security group / the local firewall (`tcpdump -ni eth0 udp port 51820`) |
| Handshake succeeds but the tunnel address does not ping | Both sides' `AllowedIPs`/routes, `ip_forward`, NAT rules |
| Only small packets pass, large ones fail | MTU/MSS fragmentation; lower the tunnel interface MTU or clamp MSS |
| The whole home loses internet the moment the VPN connects | A default route was pushed by mistake (`redirect-gateway` / `0.0.0.0/0`) |
| Internal hostnames fail to resolve after connecting | `DNS=` not set, or the internal DNS was not pushed to the client |
| OpenVPN keeps dropping | The `keepalive` parameters, NAT session timeout, clock skew on both sides |

Every row can be followed back to the corresponding subsection here
and to the reasoning chain in [Network Troubleshooting](./troubleshooting.md)
for further drilling down.
The correct way to use a quick reference is
**first locate which row you are on,
then go back and read the principle paragraph that row maps to** --
memorizing only the table fails the moment you meet a variant symptom.

## References

- WireGuard official site and whitepaper -- [wireguard.com](https://www.wireguard.com/)
- Arch Wiki - WireGuard -- [wiki.archlinux.org](https://wiki.archlinux.org/title/WireGuard)
- OpenVPN community documentation -- [openvpn.net](https://openvpn.net/community-resources/)
- Arch Wiki - OpenVPN -- [wiki.archlinux.org](https://wiki.archlinux.org/title/OpenVPN)
- strongSwan documentation -- [docs.strongswan.org](https://docs.strongswan.org/)
- Libreswan documentation -- [libreswan.org](https://libreswan.org/wiki/Documentation)
- RFC 7296 (IKEv2),
  RFC 4301/4303 (IPsec architecture and ESP)
- `man wg`, `man wg-quick`, `man openvpn`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [troubleshooting](troubleshooting.md)
