# Changelog

## v1.0.0 (2026-04-05)

Inaugural tagged release of Calabi: an Ansible-driven, single-host, fully
disconnected OpenShift 4 lab built on nested KVM.

Highlights:

- Deploy a 9-node OpenShift cluster (3 control-plane, 3 infra, 3 worker) on one
  AWS `m5.metal` host with nested KVM and libvirt.
- Open vSwitch VLAN segmentation modeling realistic service boundaries.
- Disconnected workflow: content mirroring plus agent-based installation with
  direct boot-media control.
- Day-2 automation for common platform operators and post-install tuning.
- Host resource management design: Gold/Silver/Bronze CPU performance domains,
  cgroup v2 controls, and libvirt vCPU pinning.
- Cockpit `calabi-observer` plugin for live visibility into CPU/memory
  oversubscription, KSM, and zram behavior.

Release notes:

- `releases/v1.0.0.md`

