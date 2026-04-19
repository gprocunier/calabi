# AWS IaaS Resource Model

Nearby docs:

<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This is the public-cloud layer that exists before Ansible ever touches
`virt-01`. It lays down the outer host and guest-disk substrate first.

## Ownership Split

The CloudFormation layer is intentionally split into two scopes.

Tenant stack owns:

- VPC
- public subnet
- internet gateway
- public route table
- persistent Elastic IP reserved for `virt-01`

Host stack owns:

- security group for `virt-01`
- imported EC2 key pair
- `virt-01` EC2 instance
- guest EBS volumes and attachments

The CloudFormation layer does not own:

- host subscription and package configuration
- `/dev/ebs/*` udev naming inside `virt-01`
- OVS, firewalld, libvirt, or guest VM provisioning inside `virt-01`

Those remain part of the Ansible bootstrap and lab orchestration.

> [!NOTE]
> The current host-stack default leaves `AdminIngressCidr` open at
> `0.0.0.0/0`. That is intentional. Home-admin source IPs are often stable
> enough to feel static until they are not, and a stale `/32` can lock you out
> of `virt-01` at exactly the wrong time. Tighten this parameter later if you
> have a genuinely stable source address or a better upstream access-control
> layer.

## Current discovered resource intent

The discovered guest-volume recreation set is captured in:

- `cloudformation/virt-01-volume-inventory.yml`

That inventory includes:

- support VM root disks
- OpenShift control-plane root disks
- OpenShift worker root disks
- OpenShift infra root disks
- OpenShift infra ODF data disks

The unused `haproxy-01` volume is explicitly excluded from the intended stack.

## Template shape

The rendered tenant-only CloudFormation template is:

- `cloudformation/tenant.yaml`

The rendered host-only CloudFormation template is:

- `cloudformation/virt-host.yaml`

The legacy full-stack CloudFormation template remains available as a
compatibility path:

- `cloudformation/virt-lab.yaml`

The rendered template is produced from:

- `cloudformation/virt-01-volume-inventory.yml`
- `cloudformation/templates/tenant.yaml.j2`
- `cloudformation/templates/virt-lab.yaml.j2`
- `cloudformation/templates/virt-host.yaml.j2`
- `cloudformation/render-virt-lab.py`

Repo-shipped parameter files are:

- `cloudformation/parameters.tenant-example.json`
- `cloudformation/parameters.host.json`
- `cloudformation/parameters.full.json`

Deployment helpers are:

- `cloudformation/deploy-stack.sh`
- `cloudformation/deploy-virt-lab.sh`

Recommended deploy order for a full fresh environment is:

1. `cloudformation/deploy-stack.sh tenant`
2. `cloudformation/deploy-stack.sh host`

## Current design notes

- `virt-01` uses `m5.metal`
- the current discovered RHEL image is a private/shared Red Hat RHEL 10.1 AMI
- the host stack imports an EC2 key pair from supplied public key material
- the host stack renders a cloud-init user-data payload for `virt-01`
- cloud-init sets:
  - `hostname: virt-01`
  - `fqdn: virt-01.workshop.lan`
  - `manage_etc_hosts: true`
- cloud-init adds the operator SSH public key to `ec2-user`
- cloud-init assigns a supplied SHA-512 password hash to `ec2-user` so Cockpit
  can be used through an SSH SOCKS proxy without exposing port `9090`
- cloud-init installs and enables `cockpit.socket`
- the bootstrap layer later enforces the same FQDN and `127.0.1.1` host entry
  so the rebuilt host identity stays stable
- the tenant stack creates the preferred persistent Elastic IP for `virt-01`
- the host-only stack can associate an existing Elastic IP allocation to
  `virt-01`
- a persistent Elastic IP is preferred so SSH access and SOCKS-proxied
  Cockpit access remain stable across host power cycles
- all guest disks are tagged with `GuestDisk` and `Purpose`
- the Ansible bootstrap derives the current active guest-volume map from AWS by
  `GuestDisk` tag and then renders and installs
  `/etc/udev/rules.d/99-ebs-friendly.rules` so `/dev/ebs/*` names remain
  deterministic after a rebuild
- the Ansible bootstrap can source the RHEL guest image from either:
  - `<project-root>/images/rhel-10.1-x86_64-kvm.qcow2`, or
  - `lab_execution_guest_base_image_url` when a Red Hat direct-download URL is
    supplied
- the host and legacy full stacks are rendered from the same volume inventory so the
  AWS EBS resource list does not drift from the hypervisor naming layer
- fresh AWS RHEL hosts are expected to bootstrap against Red Hat CDN content,
  not RHUI-only content, because the host requires the `fast-datapath`
  repository for `openvswitch3.6`
- fresh AWS RHEL hosts also install the Cockpit and PCP services needed for
  the lab; the exact package and service inventory is tracked in
  <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>
- fresh AWS RHEL hosts are updated before `idm-01` and `bastion-01` are built,
  and bootstrap reboots the hypervisor when the package transaction requires it

## Current recommendation

> [!IMPORTANT]
> Use `tenant` for a fresh environment, then `host` inside it. Use `host`
> alone when rebuilding `virt-01` in an existing tenant. Do not use `full`
> for new work — it exists only as a backward-compatible convenience path.

- use `tenant` when standing up a fresh AWS environment from zero
- use `host` when rebuilding `virt-01` inside an already-provisioned tenant
- keep `full` only as a backward-compatible convenience path while the project
  transitions fully to the two-stack model

## Calabi versus native cloud fanout

The main reason to do this on one metal host is architectural realism, not
raw cost reduction.

The project name is intentional: Calabi is shorthand for a Calabi-Yau
manifold, which is a useful metaphor here. The lab folds what would normally be
a spread-out datacenter footprint into one host while still keeping clear
network, storage, and service boundaries.

The lab keeps a shape that still feels like a real deployment:

- separate support services
- a full `3` control-plane / `3` infra / `3` worker cluster
- realistic storage carve-up
- network boundaries that map cleanly to what you would do across multiple hosts
- Windows AD guest for hybrid identity testing

That is the first win. You get a deployment pattern that is much easier to
relate to a real environment than a toy single-node build, while still keeping
it small enough to run on one public-cloud metal instance.

### Native instance equivalents

Pricing the current guest estate as individual EC2 instances in `us-east-2`,
rounding each guest up to the nearest practical instance type:

| Role | Count | Guest shape | EC2 equivalent | EC2 specs | $/hr | $/hr total |
| --- | --- | --- | --- | --- | ---: | ---: |
| ocp-master | 3 | 8 vCPU, 24 GiB | m5.2xlarge | 8 vCPU, 32 GiB | `$0.384` | `$1.152` |
| ocp-infra | 3 | 16 vCPU, 64 GiB | m5.4xlarge | 16 vCPU, 64 GiB | `$0.768` | `$2.304` |
| ocp-worker | 3 | 12 vCPU, 16 GiB | c5.4xlarge | 16 vCPU, 32 GiB | `$0.680` | `$2.040` |
| idm | 1 | 2 vCPU, 8 GiB | m5.large | 2 vCPU, 8 GiB | `$0.096` | `$0.096` |
| bastion | 1 | 4 vCPU, 16 GiB | m5.xlarge | 4 vCPU, 16 GiB | `$0.192` | `$0.192` |
| mirror-registry | 1 | 4 vCPU, 16 GiB | m5.xlarge | 4 vCPU, 16 GiB | `$0.192` | `$0.192` |
| ad | 1 | 4 vCPU, 8 GiB | m5.xlarge (Windows) | 4 vCPU, 16 GiB | `$0.376` | `$0.376` |
| **native total** | **13** | | | | | **`$6.352`** |
| **Calabi m5.metal** | **1** | | m5.metal | 96 vCPU, 384 GiB | | **`$4.608`** |

> [!NOTE]
> Workers at 12 vCPU have no exact EC2 match. The native path is forced to
> buy c5.4xlarge at 16 vCPU -- 33% more CPU than needed per worker. This is
> one of the structural inefficiencies that the one-host model avoids: Calabi
> allocates exactly 12 vCPU to each worker because it controls the guest
> shape directly.

> [!NOTE]
> The AD server carries a Windows license premium. The m5.xlarge Windows
> on-demand rate (`$0.376/hr`) is nearly double the Linux rate (`$0.192/hr`).
> On the Calabi host, the Windows guest runs as a KVM domain with no AWS
> license surcharge -- the license is supplied by the operator.

### EBS storage

EBS cost is essentially the same in both models. All guest disks are gp3
volumes attached to `virt-01` in the Calabi model and would attach directly
to each instance in the native model. The current volume layout:

| Volume class | Count | Per volume | Total GiB |
| --- | --- | --- | --- |
| virt-01 root | 1 | 100 GiB | 100 |
| support VM root (idm, bastion, mirror) | 3 | 120-400 GiB | 640 |
| ad root | 1 | 60 GiB | 60 |
| master root | 3 | 250 GiB | 750 |
| worker root | 3 | 250 GiB | 750 |
| infra root | 3 | 250 GiB | 750 |
| infra ODF data | 3 | 1000 GiB | 3000 |
| **total** | **17 volumes** | | **6,050 GiB** |

At current gp3 pricing (`$0.08/GiB/month`) plus IOPS and throughput overages
on the master volumes (6000 IOPS, 250 MB/s), total EBS cost is approximately
**`$544/month`** in both models. The native model drops the virt-01 root but
the total stays within a few dollars either way.

### Monthly cost comparison

| Component | Native fanout | Calabi |
| --- | ---: | ---: |
| EC2 compute (730 hours) | `$4,636.96` | `$3,363.84` |
| EBS storage | `$544.00` | `$544.00` |
| **total** | **`$5,180.96`** | **`$3,907.84`** |
| **difference** | | **`-$1,273.12/month (25%)`** |

### Short-run cost comparison

For short-lived lab events the EBS cost is amortized across the month regardless
of runtime, so the per-event savings come entirely from compute hours:

| Runtime shape | Native compute | Calabi compute | Savings |
| --- | ---: | ---: | ---: |
| typical demo: `6` hours/day, `3` days (`18` hours) | `$114.34` | `$82.94` | `$31.40` |
| typical workshop: `8` hours/day, `5` days (`40` hours) | `$254.08` | `$184.32` | `$69.76` |
| full month (`730` hours) | `$4,636.96` | `$3,363.84` | `$1,273.12` |

### How oversubscription widens the gap

The Calabi cost is fixed at `$4.608/hr` regardless of how many vCPUs or how
much memory the guests consume. The native cost scales linearly with every
guest uplift.

The current layout already demonstrates this:

- 122 guest vCPUs on 72 physical CPUs (`1.69:1` oversubscription)
- 360 GiB committed guest memory on 384 GiB host (`0.94:1`)
- the Gold/Silver/Bronze tier model ensures degradation is intentional
- KSM, zram, and THP provide the memory safety margin

If the same lab had stayed at the original `3 x 4 vCPU` worker shape with
48 GiB infra nodes, the native fanout cost would have been lower, and the
Calabi cost advantage would have been marginal. The progression:

| Layout | Guest vCPU | Native EC2 $/hr | Calabi $/hr | Calabi advantage |
| --- | --- | ---: | ---: | ---: |
| original (`3 x 4` workers, 48G infra) | 94 | `$5.088` | `$4.608` | `9%` |
| previous (`3 x 8` workers, 48G infra) | 106 | `$5.088` | `$4.608` | `9%` |
| current (`3 x 12` workers, 64G infra, AD) | 122 | `$6.352` | `$4.608` | `27%` |

> [!NOTE]
> The old 3x4 and 3x8 worker shapes both used m5.2xlarge on the native side
> (same instance, same cost) because 4 and 8 vCPU both fit in that type. The
> jump to 12 vCPU workers forced c5.4xlarge and the AD server added a Windows
> license premium. That is why the native cost stepped up sharply while the
> Calabi cost stayed flat.

### The argument

The one-host model is already worthwhile for realism and repeatability.
Once the host carries a larger guest footprint through controlled
oversubscription, it wins on cost as well:

- native cloud buys every guest uplift literally, at the nearest instance shape
- Calabi absorbs uplift into policy: more vCPU and memory on the same host,
  managed by tier weights and kernel memory efficiency
- the cost gap widens with each guest uplift because the native side scales
  linearly while the Calabi side stays flat
- the Windows AD guest is a particularly clear example: native AWS charges
  a license premium per hour, while Calabi runs it as a plain KVM domain

All pricing is `US East (Ohio)` on-demand as of March 2026. Reserved or
savings-plan pricing reduces both sides proportionally but does not change the
relative gap.
