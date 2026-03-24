# Secrets And Sanitization

Nearby docs:

<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./issues.md"><kbd>&nbsp;&nbsp;ISSUES LEDGER&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This is the rulebook for keeping live credentials out of Git.

The rules:

- track examples and paths
- keep live secret material outside Git
- prefer `ansible-vault` for inventory-backed secrets
- block obvious secret leaks before commit or push

## Current Secret Model

The main inventory-backed lab credential is:

- `inventory/group_vars/all/lab_credentials.yml`

That file is intentionally ignored and should exist only in local operator
worktrees. The tracked companion file is:

- `inventory/group_vars/all/lab_credentials.yml.example`

Recommended setup:

```bash
cd aws-metal-openshift-demo

cp inventory/group_vars/all/lab_credentials.yml.example \
   inventory/group_vars/all/lab_credentials.yml

ansible-vault encrypt inventory/group_vars/all/lab_credentials.yml
```

That local vault file can hold both:

- `lab_default_password`
- RHSM activation key / org ID or RHSM username / password values

Then run playbooks with either:

```bash
ansible-playbook ... --ask-vault-pass
```

or:

```bash
ansible-playbook ... --vault-password-file <path>
```

## Other Secret Inputs

Other sensitive inputs are referenced by path and should also remain outside Git:

- Red Hat pull secret files
- controller SSH private keys
- AWS CLI credentials
- vault password files

Tracked config files such as `vars/global/rhsm.yml` should contain wiring only,
not live RHSM values.

Those inputs belong in operator-local paths such as the existing execution
environment secrets locations, not in tracked repository files.

## Git Hygiene

This repo now includes versioned Git hooks under:

- `.githooks/pre-commit`
- `.githooks/pre-push`

They are intended to catch:

- tracked LLM sidecar artifacts
- a tracked live `lab_credentials.yml`
- plaintext `lab_default_password` assignments
- plaintext RHSM activation keys and org IDs
- hard-coded Docker auth blobs
- private key material
- common AWS access-key patterns

Enable them locally with:

```bash
git config core.hooksPath .githooks
```

> [!TIP]
> Run the `git config` command above immediately after cloning the repo. The
> hooks are versioned under `.githooks/` but Git does not activate them
> automatically.

## If A Secret Leaks

> [!CAUTION]
> Current-tree cleanup is not enough if the credential was already pushed and
> is still valid. You must rotate the credential first.

The correct response is:

1. rotate the credential
2. remove it from the current tree
3. add or improve the guardrail that should have caught it
4. decide whether history must be rewritten and the remote force-pushed
