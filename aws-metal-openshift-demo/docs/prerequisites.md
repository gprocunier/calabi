# Prerequisites

Nearby docs:

<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./iaas-resource-model.md"><kbd>&nbsp;&nbsp;IAAS MODEL&nbsp;&nbsp;</kbd></a>
<a href="./secrets-and-sanitization.md"><kbd>&nbsp;&nbsp;SECRETS&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

Read this before the first build or rebuild.

This is the short checklist for what needs to exist before the automation and
manual process make sense.

## What You Need On The Operator Workstation

- a local checkout of this repo
- `aws` CLI configured for the target account
- `ansible-core`
- `jq`
- `rsync`
- `ssh` and a working SSH keypair
- enough local disk to stage the repo, pull secret, and generated artifacts

The repo ships one required Ansible collection in:

- `requirements.yml`

Install it with:

```bash
cd <project-root>
ansible-galaxy collection install -r requirements.yml
```

Current automation also assumes a modern Ansible controller environment. The
live validation work on this repo has been using `ansible-core 2.18`.

## What You Need In Public Cloud

- a public-cloud account that can run an unfettered metal instance
- permission to create the tenant and host resources modeled by the
  CloudFormation stack
- a public IP path to `virt-01`
- enough EBS quota for the host root disk and all guest disks

For the current AWS implementation, that means:

- CloudFormation
- EC2
- EBS
- Elastic IP
- key-pair import

> [!NOTE]
> The current host-stack default for `AdminIngressCidr` is `0.0.0.0/0`. That
> keeps the lab reachable when the operator is coming from a home connection or
> any other source IP that can drift unexpectedly. If your admin source is
> truly stable, tighten it later.

## What You Need From Red Hat

<a href="./redhat-developer-subscription.md"><kbd>&nbsp;&nbsp;DEVELOPER SUBSCRIPTION SETUP&nbsp;&nbsp;</kbd></a>

> [!IMPORTANT]
> If you do not already have an active Red Hat account with entitlements, the
> Developer Subscription for Individuals is a zero-cost path to everything
> listed below. See the setup guide linked above.

- a pull secret file for OpenShift content access
- RHSM credentials:
  - activation key plus organization ID, or
  - username plus password
- a RHEL 10.1 guest image source:
  - a qcow2 cached on `virt-01`, or
  - a direct-download URL used by the automation
- a RHEL AMI or equivalent host image source for the metal host

## Local Secrets And Ignored Files

The main local secret file is:

- `inventory/group_vars/all/lab_credentials.yml`

That file is for local or vaulted values only. Use common sense here:

- keep real secrets out of tracked files
- keep them in ignored local files or a vault workflow
- do not normalize plaintext credentials as a project convention

Typical local content includes:

- `lab_default_password`
- `lab_rhsm_activation_key`
- `lab_rhsm_organization_id`
- or the username/password RHSM variant

You also need:

- a local SSH private key that can reach `virt-01`
- the matching public key
- a local pull-secret file

The secrets model and Git guardrails are documented in:

- <a href="./secrets-and-sanitization.md"><kbd>SECRETS</kbd></a>

## Quick Preflight

Before you start a build, the practical checks are:

```bash
aws sts get-caller-identity
ansible --version
ansible-galaxy collection list | grep freeipa.ansible_freeipa
test -f inventory/group_vars/all/lab_credentials.yml
test -f ~/pull-secret.txt
test -f ~/.ssh/id_ed25519
```

You do not need every generated artifact in place before bootstrap. You do need
the credentials, key material, and content-access inputs sorted out first.

## Where To Go Next

- for the run order: <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
- for the full manual equivalent: <a href="./manual-process.md"><kbd>MANUAL PROCESS</kbd></a>
- for the outer cloud model: <a href="./iaas-resource-model.md"><kbd>IAAS MODEL</kbd></a>
