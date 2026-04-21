# AD Source-Of-Truth / IdM Policy Model

Nearby docs:

<a href="./automation-flow.md"><kbd>&nbsp;&nbsp;AUTOMATION FLOW&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-plumbing.md"><kbd>&nbsp;&nbsp;ORCHESTRATION PLUMBING&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./investigating.md"><kbd>&nbsp;&nbsp;INVESTIGATING&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

## Status

This document describes the target model and the implementation work now
underway.

The current orchestration already does:

- AD trust into IdM
- Keycloak OIDC for OpenShift
- IdM compat LDAP federation for Keycloak
- local IdM group `access-openshift-admin` bound to OpenShift `cluster-admin`
- local IdM group `access-linux-admin` bound to the `admins-nopasswd-all` sudo rule

The current implementation now also includes the active policy-bridge slice:

- canonical mapping data in
  <a href="../vars/global/ad_group_policy.yml"><kbd>vars/global/ad_group_policy.yml</kbd></a>
- creation and validation of one IdM external group per mapped AD group during
  <a href="../playbooks/bootstrap/idm-ad-trust.yml"><kbd>playbooks/bootstrap/idm-ad-trust.yml</kbd></a>
- SID resolution and `ipaexternalmember` reconciliation for each mapped AD
  source group
- nesting of each IdM external group into the target local IdM policy group
- OIDC claim validation for both a native IdM test user and the AD-trusted test
  user when AD trust is enabled

What is still pending is broader consumer-side proof that changing AD group
membership alone changes the resulting RHEL and OpenShift authorization end to
end.

## Target Model

The target access path is:

```mermaid
flowchart LR
    A[AD User] --> B[AD Security Group]
    B --> C[IdM External Group]
    C --> D[IdM Local POSIX Group]
    D --> E[SSSD and IPA sudo on RHEL]
    D --> F[Keycloak LDAP Federation]
    F --> G[OIDC groups claim]
    G --> H[OpenShift RBAC]
```

The intent is:

- AD is the source of truth for users and source-side group membership
- IdM translates trusted AD groups into local policy groups
- RHEL and OpenShift consume only the IdM local groups
- OpenShift does not authorize against raw AD group names
- RHEL sudo and HBAC do not authorize against raw AD group names

## Planned Group Contract

The future-state mapping scaffold lives in
<a href="../vars/global/ad_group_policy.yml"><kbd>vars/global/ad_group_policy.yml</kbd></a>.

The current planned mappings are:

| AD group | IdM external group | IdM local group | Intended access |
| --- | --- | --- | --- |
| `ad-corp-openshift-admins` | `ad-corp-openshift-admins` | `access-openshift-admin` | OpenShift `cluster-admin` |
| `ad-corp-linux-admins` | `ad-corp-linux-admins` | `access-linux-admin` | RHEL passwordless sudo via `admins-nopasswd-all` |
| `ad-corp-openshift-virt-admins` | `ad-corp-openshift-virt-admins` | `access-virt-admin` | virtualization-scoped policy target |
| `ad-corp-developers` | `ad-corp-developers` | `access-developer` | non-admin application access target |
| `ad-corp-aap-admins` | `ad-corp-aap-admins` | `access-aap-admin` | AAP authorization target |

## Deferred Hygiene: Naming And Descriptions

This is saved as follow-on housekeeping after the current rollout completes.

The current implementation now applies terse descriptions to both sides of the
bridge so the IdM web UI and `ipa group-show` output communicate the two roles
immediately:

- local IdM groups grant access
- external IdM groups are only upstream AD membership sources

Planned naming direction remains:

| Group type | Planned pattern | Example |
| --- | --- | --- |
| IdM local access group | `access-<scope>-<role>` | `access-openshift-admin` |
| IdM external AD source group | `ext-<domain>-<group>` | `ext-corp-lan-openshift-admins` |

Planned description pattern:

| Group type | Description template | Example |
| --- | --- | --- |
| IdM local access group | `Access group: <permission>` | `Access group: OpenShift cluster-admin` |
| IdM external AD source group | `AD source group: <domain>/<group>` | `AD source group: corp.lan/ad-corp-openshift-admins` |

Why this is deferred:

- the current bridge is already wired and being exercised
- renaming the groups now would create extra churn while rollout validation is
  still in progress
- the current hygiene work is description-first so operators can see the role
  split without changing live names
- a later rename can still be done if we decide the `ad-*` bridge names are too
  noisy for long-term use

## Current Gap Versus Target

What exists now:

- AD demo groups are created on `ad-01`
- IdM local groups are created on `idm-01`
- IdM trust and compat are enabled
- Keycloak reads users and groups from the IdM compat tree
- the AD-to-IdM policy bridge data model is defined centrally
- IdM external groups are created from that mapping during the AD trust play
- trusted AD group SIDs are reconciled into the corresponding IdM external
  groups
- mapped IdM external groups are nested into the target local IdM policy groups
- Keycloak OIDC validation asserts that the AD-trusted test user receives the
  bridged local OpenShift admin group in the `groups` claim

What does not exist yet:

- repeatable proof that changing AD group membership alone changes both RHEL and
  OpenShift authorization without any broader fallback path masking the result
- proof that RHEL sudo and HBAC are being granted through the bridged local
  groups rather than through broader trust behavior
- revocation-side proof that removing an AD user from a mapped source group also
  removes the resulting OpenShift and RHEL access on the expected timeline

## Implementation Plan

### Phase 1: Data Model

Add the future-state mapping data and keep it disabled by default.

Files:

- <a href="../vars/global/ad_group_policy.yml"><kbd>vars/global/ad_group_policy.yml</kbd></a>

Success criteria:

- one canonical mapping source exists in the repo
- the mapping covers OpenShift, RHEL, and AAP intent explicitly

Status:

- implemented

### Phase 2: IdM Trust Policy Objects

Create:

- one IdM external group per trusted AD group
- one nested membership from each external group into the target local IdM
  group

Likely ownership:

- <a href="../roles/idm_ad_trust/tasks/main.yml"><kbd>roles/idm_ad_trust/tasks/main.yml</kbd></a>
- possibly a new trust-policy subtask file if the role gets too large

Success criteria:

- `ipa group-show <local-group>` shows the external group as a member
- trusted AD users land in the correct local IdM policy group through nesting

Status:

- implementation landed in
  <a href="../roles/idm_ad_trust/tasks/main.yml"><kbd>roles/idm_ad_trust/tasks/main.yml</kbd></a>
- live validation still in progress

### Phase 3: RHEL Authorization Validation

Validate that:

- the AD-backed Linux admin user resolves through SSSD
- that user gains the local IdM `access-linux-admin` policy
- `admins-nopasswd-all` applies through `access-linux-admin` without granting
  access via raw AD groups

Likely ownership:

- <a href="../roles/bastion_guest/tasks/main.yml"><kbd>roles/bastion_guest/tasks/main.yml</kbd></a>
- <a href="../roles/mirror_registry_guest/tasks/main.yml"><kbd>roles/mirror_registry_guest/tasks/main.yml</kbd></a>
- dedicated trust validation tasks or maintenance probes

### Phase 4: OpenShift Authorization Validation

Validate that:

- Keycloak emits the local IdM group names in the `groups` claim
- OpenShift continues to bind only the local group `access-openshift-admin`
- an AD user in `ad-corp-openshift-admins` becomes cluster-admin only through
  the local IdM group bridge

Likely ownership:

- <a href="../roles/openshift_post_install_oidc_auth/tasks/main.yml"><kbd>roles/openshift_post_install_oidc_auth/tasks/main.yml</kbd></a>

Status:

- token issuance and `groups` claim validation already exist for both the
  native IdM test user and the AD-trusted test user
- what remains is stronger end-to-end proof that AD membership changes alone are
  what grant and revoke the resulting OpenShift authorization

### Phase 5: Optional AAP Alignment

If AAP remains in scope, give it the same policy model:

- trusted AD group
- IdM external group
- local IdM policy group
- AAP LDAP or SSO mapping against the local IdM group

## Guardrails

When this work is implemented, keep these constraints:

- do not use `Domain Admins` as the Linux admin policy group
- do not bind raw AD group names directly to OpenShift RBAC
- do not bind raw AD group names directly to IPA sudo rules
- keep `HTPasswd` breakglass unchanged
- keep the existing local IdM access groups as the authorization boundary

## Validation Checklist

When implementation starts later, the minimum proof should be:

1. change AD group membership only
2. confirm IdM trust/compat reflects the change
3. confirm the corresponding local IdM group reflects the nested policy
4. confirm an AD-backed Linux admin user gains or loses sudo accordingly
5. confirm an AD-backed OpenShift admin user gains or loses `cluster-admin`
   accordingly
6. confirm native IdM users still work through the same local groups
