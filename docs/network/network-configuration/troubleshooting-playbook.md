# Worked Cases and Common Pitfalls

> Part of [Network Configuration Basics](../network-configuration.md) --
> a fixed-order diagnostic script, a migration checklist,
> and the high-frequency pitfalls of configuration management.

## A One-Shot Diagnostic Script

Chain the observation commands from
[manager detection](manager-detection.md),
[routing](routing.md),
and [DNS](dns.md)
into a minimal diagnostic set
and run it first on any network ticket:

```bash
#!/bin/bash
echo "=== 1. Interface state ==="
ip -br addr
echo "=== 2. Routes ==="
ip route show
echo "=== 3. DNS sources ==="
ls -l /etc/resolv.conf
grep -E '^hosts' /etc/nsswitch.conf
echo "=== 4. Connectivity ==="
ping -c 2 -W 2 192.168.1.1 >/dev/null && echo "gateway: OK" || echo "gateway: FAIL"
ping -c 2 -W 2 8.8.8.8      >/dev/null && echo "public:  OK" || echo "public:  FAIL"
ping -c 2 -W 2 example.com   >/dev/null && echo "DNS:     OK" || echo "DNS:     FAIL"
```

The value of the script is its **fixed order**:
configuration first (1-2),
then resolution sources (3),
then layered probing (4).
Any FAIL narrows the field to the corresponding layer
and avoids the inefficiency of reaching for a capture immediately.
Lift the gateway address and target domain
into variables at the top of the script,
and it can be reused in a new environment by changing two lines.

## Migration Checklist

After moving across distros or reinstalling,
this checklist avoids most configuration loss:

1. Confirm the new system's network manager
   (the [detection commands](manager-detection.md)) and pick the right entry point.
2. Export the old machine's addresses, routes, and DNS
   (`ip addr`, `ip route`,
   `cat /etc/resolv.conf`)
   and write them into the new configuration.
3. Apply with `netplan try` / `nmcli con up` /
   `networkctl reload`,
   keeping a rollback window open.
4. Verify layer-three connectivity
   (gateway, public IP, name),
   then verify the business ports.
5. Confirm the configuration landed in the persistent layer
   and was not merely changed temporarily with `ip` --
   restart the machine once as a final check.

Step 5 of the checklist is the most often skipped
and is precisely the only defense against
"configured in the morning, gone after an afternoon restart."
Putting the restart verification into the change process
is more relaxing than remembering the details of every manager.

## Common Pitfalls

- **A resolv.conf edit is reverted immediately**.
  It is probably owned by systemd-resolved
  or NetworkManager.
  Use `ls -l` as in [the resolution chain](dns.md) to determine ownership,
  change the setting the manager exposes,
  and do not edit the file itself.
- **Losing access after `netplan apply`**.
  YAML indentation errors, or a
  `renderer` that does not match the actual backend,
  make the apply fail or the interface disappear.
  When working remotely, always use `netplan try`
  and leave the system its 60-second automatic rollback.
- **Two managers active at once**.
  NetworkManager and networkd coexisting
  overwrite each other's addresses and DNS,
  which looks like configuration rolling back "at random."
  Disable the one you do not need with `systemctl disable`
  and keep a single manager.
- **Device names drifting and the configuration going dead**.
  After cloning a VM or changing hardware,
  `eth0` may become `ens192`
  and every name-based match misses.
  Switch to MACAddress matching,
  or enable `net.ifnames=0`
  for uniform naming
  (evaluate the impact on existing operations scripts first).
- **Treating `ip route show cache` as troubleshooting evidence**.
  Newer kernels removed the route cache;
  that command producing no output is normal,
  not "the cache got lost."
- **Forcing NIC speed/duplex**.
  Unless the switch side is explicitly configured too,
  keep auto-negotiation;
  the signature of a duplex mismatch is
  "half-working, lots of retransmits,"
  and both the `ethtool` side and the switch port
  have to be checked.
- **A VLAN sub-interface is UP but carries no traffic**.
  Check whether the switch trunk
  allows that VLAN through,
  and whether the parent interface is in the right mode;
  use `tcpdump -e`
  to see whether the frame tag matches.
- **Permanent routes written into a temporary script**.
  An `ip route add` in `rc.local`
  or in an ad-hoc operations command
  vanishes at the next restart.
  Put it back into
  [the manager configuration](routing.md).

For faults that survive a correct configuration,
continue with the layered reasoning in
[Network Troubleshooting](../troubleshooting.md).
