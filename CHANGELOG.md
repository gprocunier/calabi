# Changelog

## v1.2.0 (2026-04-09)

Third tagged release of Calabi, centered on the experimental on-prem target
and the docs/site work needed to surface it cleanly without changing the
validated AWS deployment path.

Highlights:

- Added `on-prem-openshift-demo/` as an experimental alternate deployment
  target for operators who already have a prepared `virt-01`-like host.
- Implemented LVM-backed guest volume provisioning for the on-prem path,
  including free-space validation before `lvcreate` and `/dev/ebs/*`
  compatibility symlink publication for the stock guest and cluster roles.
- Kept the validated AWS codepath pristine by isolating the on-prem behavior in
  local wrappers and on-prem-only playbooks rather than modifying the
  `aws-metal-openshift-demo/` orchestration path.
- Added explicit bastion-to-hypervisor runtime settings for the on-prem path so
  the experimental mode no longer depends on `ec2-user` existing on the
  hypervisor.
- Added and refined the on-prem operator docs set:
  prerequisites, automation flow, manual process, host sizing, and portability
  guidance, including handoff points back into the stock AWS docs.
- Updated GitHub Pages to surface the experimental on-prem route from the main
  entry flow while keeping the primary lab/docs path AWS-first.

Release notes:

- `releases/v1.2.0.md`

## v1.1.0 (2026-04-09)

Second tagged release of Calabi, centered on the `calabi-ad-services` merge
and the clean-deploy validation work that followed it.

Highlights:

- Added AD support-service orchestration and formalized the support-service
  order around AD, IdM, AD trust, and bastion enrollment.
- Moved AAP from direct LDAP authentication to Keycloak OIDC and validated
  AD-backed login after clean redeploy.
- Hardened long-running day-2 and install-time orchestration for fresh deploys:
  workspace ownership normalization, safer OpenShift tool publishing, bounded
  operator roll-out recovery, and cleaner bootstrap/install wait handling.
- Refreshed the operator and auth documentation set, especially
  `manual-process.md`, the architecture/auth model pages, and the
  troubleshooting notes.
- Published the GitHub Pages docs site with intent-first navigation, linked
  source paths, repaired Mermaid rendering, and renderer-safe diagrams.

Release notes:

- `releases/v1.1.0.md`

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
