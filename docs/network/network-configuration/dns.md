# DNS Configuration and the Resolution Path

> Part of [Network Configuration Basics](../network-configuration.md) --
> the complete chain from `getaddrinfo()`
> down to `/etc/resolv.conf`,
> and how to change DNS without it being overwritten.

## The Whole Resolution Chain

When DNS breaks,
many people only re-edit `/etc/resolv.conf` again and again,
only to find that "my change got reverted."
To avoid that futility,
first see the complete chain.

1. The application calls `getaddrinfo()` (glibc).
2. glibc reads the `hosts:` line of `/etc/nsswitch.conf`,
   commonly `files dns`
   or `files resolve dns`,
   which decides whether `/etc/hosts` is consulted first
   or DNS is used directly;
   when `resolve` is enabled,
   the query also goes through
   systemd-resolved's D-Bus interface.
3. If DNS is used,
   the query is sent to the `nameserver` entries
   listed in `/etc/resolv.conf`.
4. On systems with systemd-resolved enabled,
   `/etc/resolv.conf`
   is a symbolic link pointing at `127.0.0.53:53`,
   while the real upstream DNS configuration lives in
   `/etc/systemd/resolved.conf`
   and resolved aggregates it before querying outward.
5. NetworkManager may also own
   `resolv.conf`
   (when `PEERDNS=yes`),
   writing DHCP-provided DNS straight into it.

So `resolv.conf`
may be either a real file or a symlink,
and editing the wrong thing produces
"it saved successfully and was immediately reverted."
Confirm ownership:

```bash
$ ls -l /etc/resolv.conf
lrwxrwxrwx 1 root root 39 ... /etc/resolv.conf -> ../run/systemd/resolve/stub-resolv.conf

$ resolvectl status
Link 2 (eth0)
    Current DNS Server: 192.168.1.1
       DNS Servers: 8.8.8.8 8.8.4.4
```

Ubuntu 22.04+ and most new distros
default to stub mode (`127.0.0.53`);
RHEL does not use resolved by default
and NetworkManager writes the real
`/etc/resolv.conf` file directly.
**Use `ls -l` to see the link relationship first,
then decide what to edit**.

The most easily overlooked step in the chain is step 2:
`nsswitch.conf` decides
whether `files` comes before `dns`.
Someone adds an entry to `/etc/hosts`
and it has no effect,
usually because that machine's
`hosts:` line puts `dns` first,
or because a module such as
`mymachines` or `resolve`
was inserted in between and changed the order.
**When a hosts change does not take effect,
first `grep '^hosts' /etc/nsswitch.conf`**
and only then suspect caching or permissions.

## Configuration Files and How Changes Take Effect

```bash
# Basic /etc/resolv.conf entries
nameserver 8.8.8.8
nameserver 8.8.4.4
search example.com
options timeout:2 attempts:3

# /etc/hosts static local mappings
127.0.0.1   localhost
192.168.1.100 myserver.example.com myserver

# systemd-resolved persistent configuration
# /etc/systemd/resolved.conf
[Resolve]
DNS=8.8.8.8 8.8.4.4
FallbackDNS=1.1.1.1
```

`options timeout`/`attempts`
control the per-query timeout and retry count;
loosening them on a weak link
reduces false resolution failures.
After changing resolved's configuration you need
sudo systemctl restart systemd-resolved;
changing `nsswitch.conf`
affects global resolution order,
so before touching it confirm no application depends on a particular order.

In a NetworkManager scenario,
the correct approach is to change the connection's DNS property
rather than editing the file --
the file gets overwritten at the next DHCP renewal:

```bash
sudo nmcli connection modify office ipv4.dns "8.8.8.8 8.8.4.4"
sudo nmcli connection up office
```

Every `nameserver`
must be on its own line;
writing
`nameserver 8.8.8.8 8.8.4.4`
resolves only the first one,
or errors out on the whole line --
the most common low-level mistake
when assembling configuration with `echo` in a script.

## Observation and Troubleshooting

Use these commands for observation and diagnosis:
`resolvectl statistics` for cache statistics,
`resolvectl query example.com` to verify a single resolution,
`dig +norecurse example.com @192.168.1.1`
to force the query to a named upstream past the cache,
and sudo resolvectl flush-caches to clear the cache.

`dig @server`
names the upstream directly,
which separates
"a wrong local configuration" from "a broken upstream DNS":
if `dig @8.8.8.8`
resolves while the default query fails,
the problem is certainly in this machine's
resolv.conf/resolved configuration;
if both fail, it is the upstream or the egress.
This dividing line matches exactly the
chain of reasoning in [Network Troubleshooting](../troubleshooting.md).

There is another class of resolution problems:
**search domain side effects**.
With `search example.com` configured,
accessing the short name `myserver`
first tries `myserver.example.com`.
In a multi-region environment,
different search domain orders can resolve
to the wrong host of the same name --
"the ping works but it is a different machine"
is usually this.
To check, use `dig +short FQDN.`
(note the trailing dot) to bypass the search domain
and confirm whether this is the cause.

Bonded and VLAN topologies carry their own name-resolution
and performance considerations -- see
[Bonding, VLANs and Performance Tuning](advanced-topology.md).
