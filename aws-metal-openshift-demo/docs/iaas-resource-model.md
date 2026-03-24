# AWS IaaS Resource Model

Nearby docs:

<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./network-topology.md"><kbd>&nbsp;&nbsp;NETWORK TOPOLOGY&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This page covers the public-cloud layer that exists before Ansible ever touches
`virt-01`.

It is the outer infrastructure that gets the metal host and guest-disk
substrate on the ground.

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

Example parameter files are:

- `cloudformation/parameters.tenant-example.json`
- `cloudformation/parameters.example.json`

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

That is the first win. You get a deployment pattern that is much easier to
relate to a real environment than a toy single-node build, while still keeping
it small enough to run on one public-cloud metal instance.

If you price the intended guest footprint as a native-cloud fanout in
`us-east-2`, the current numbers are close enough that cost is not the whole
story:

| Shape | Native fanout total / month | Calabi total / month |
| --- | ---: | ---: |
| baseline workers at `3 x 4 vCPU` | `$3,816.73` | `$3,903.04` |
| current target workers at `3 x 8 vCPU` | `$4,179.13` | `$3,903.04` |
| deeper bronze uplift at `3 x 12 vCPU` | `$4,960.96` | `$3,903.04` |

Those numbers are based on:

- `1 x m5.metal` for Calabi
- native-cloud rounding to the nearest practical EC2 shapes for each guest
- the current guest EBS layout from `cloudformation/virt-01-volume-inventory.yml`
- current on-demand EC2 and gp3 pricing in `US East (Ohio)`

The blunt read is:

- without oversubscription, Calabi is mainly an architectural and realism win
- with moderate oversubscription, it also becomes a clear cost win
- with deeper but still controlled oversubscription, the cost gap widens quickly

That is why the host performance-domain work matters. The value is not just
"more vCPU on paper." The value is being able to present more useful worker
capacity on the same host without giving up control of who loses first under
contention.

For short-lived lab events, the gap is smaller in absolute dollars but still
real. Using the deeper `3 x 12 vCPU` worker target as the representative case:

| Runtime shape | Native fanout | Calabi | Calabi advantage |
| --- | ---: | ---: | ---: |
| typical demo: `6` hours/day for `3` days (`18` hours) | `$122.32` | `$96.24` | `$26.08` |
| typical workshop: `8` hours/day for `5` days (`40` hours) | `$271.83` | `$213.87` | `$57.96` |

Those short-run numbers matter less than the monthly comparison, but they are a
useful reminder that the one-host model does not need a long-lived environment
to make sense. Even for a tightly bounded demo or workshop, the same design
still gives you the realism benefit first and a modest cost benefit alongside
it.

In other words:

- native cloud buys every uplift literally
- Calabi can turn some of that uplift into policy

That is the economic argument for the tiered host design. The one-host model is
already worthwhile for realism and repeatability. Once the host can safely
carry a larger worker shape through controlled oversubscription, it starts to
win on cost as well.
