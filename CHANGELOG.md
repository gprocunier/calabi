# Changelog

## v1.3.0 (2026-04-26)

Feature release of Calabi focused on making the experimental on-prem path a
usable cluster-capable workflow, adding external ODF consumption, hardening
rerun/convergence behavior, and refreshing the operator documentation for both
AWS and on-prem deployments.

Highlights:

- Added external ODF day-2 orchestration that installs the ODF operator,
  imports operator-provided Ceph cluster details, applies an external
  `StorageCluster`, and keeps the storage phase in the same dependency slot as
  internal ODF.
- Expanded the on-prem target with override-driven profiles, extra OVS/libvirt
  networking, host sizing guidance, full cleanup support, and a cluster-capable
  3-control-plane / 3-worker external-Ceph profile.
- Hardened support-service and day-2 reruns with convergence probes, explicit
  force flags, safer cleanup boundaries, and cluster convergence checks that
  avoid rebuilding healthy AD, IdM, bastion, mirror-registry, or OpenShift
  phases unnecessarily.
- Added `calabi-shell` installation, mirror-registry `oc-mirror` parallelism
  tunables, host zram writeback policy support, and refreshed guest sizing for
  the current lab profile.
- Reworked the documentation set for automation flow, manual process,
  override mechanics, ODF modes, host resource policy, and publish
  sanitization; the publish tree now removes local external-Ceph secrets and
  build artifacts before release.
- Updated the docs site renderer with Shiki-backed code highlighting and
  refreshed Cockpit observer assets and exporter integration.

Release notes:

- `releases/v1.3.0.md`

## v1.2.1 (2026-04-18)

Maintenance release of Calabi focused on bootstrap reliability and publishable
operator flow after the experimental on-prem release.

Highlights:

- Hardened the staged DNS bootstrap path so the hypervisor and bastion prefer
  authoritative IdM DNS as soon as it is reachable, while retaining safe
  fallback behavior earlier in bootstrap.
- Improved bastion and guest bring-up behavior around RHSM registration,
  package management, and disk reseed handling during staged deployment.
- Fixed on-prem bastion-stage runtime issues that affected wrapper-driven
  `site-bootstrap` runs, including inventory staging and bastion-to-hypervisor
  handoff behavior.
- Added tracked runner wrappers and `lab-dashboard` support for the on-prem
  path, then aligned the AWS and on-prem operator docs to use those wrappers as
  the primary execution entrypoints.
- Published sanitized inventory defaults and docs-site content for the GitHub
  release tree.

Release notes:

- `releases/v1.2.1.md`

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
