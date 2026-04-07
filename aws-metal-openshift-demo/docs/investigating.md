# Active Investigation Notes

Nearby docs:

<a href="./manual-process.md"><kbd>&nbsp;&nbsp;MANUAL PROCESS&nbsp;&nbsp;</kbd></a>
<a href="./orchestration-guide.md"><kbd>&nbsp;&nbsp;ORCHESTRATION GUIDE&nbsp;&nbsp;</kbd></a>
<a href="./issues.md"><kbd>&nbsp;&nbsp;ISSUES LEDGER&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This is the working notebook for problems that are still open or worth coming
back to later.

It is more operational than <a href="./issues.md"><kbd>ISSUES LEDGER</kbd></a>: the issues ledger records fixes
that already landed, while this file keeps the observations, experiments, and
unanswered questions.

## Open Investigation: Final Golden-Path Certification Run

Status:

- open
- zero-VM teardown and `playbooks/site-bootstrap.yml` have now been re-proven
- cluster build, mirrored-content use, and the default auth/day-2 path have
  already succeeded from preserved support-service boundaries
- recent fresh-path `playbooks/site-lab.yml` reruns have still exposed late
  orchestration defects that required code repair
- the final bar remains one uninterrupted zero-VM `playbooks/site-lab.yml` run
  on the current codebase, without live code repair during the attempt

### What is already proven

- support services can be brought up and reused across retries
- a zero-VM rebuild through `playbooks/site-bootstrap.yml` completes on the
  current codebase
- the cluster can install successfully on the current codebase
- the full support-service plus cluster path can converge cleanly on the
  current codebase
- mirrored Keycloak content deploys and runs
- OpenShift OAuth converges on:
  - `HTPasswd` breakglass
  - Keycloak OIDC
  - group-based RBAC through `openshift-admin`
- the repo validation lane is clean:
  - `make validate`
  - `ansible-lint -p`
- the runner split and workstation-to-bastion handoff are now documented in
  <a href="./orchestration-plumbing.md"><kbd>ORCHESTRATION PLUMBING</kbd></a>
- the current live auth model and the planned AD-source-of-truth policy model
  now have dedicated architecture pages:
  - <a href="./authentication-model.md"><kbd>AUTH MODEL</kbd></a>
  - <a href="./ad-idm-policy-model.md"><kbd>AD / IDM POLICY MODEL</kbd></a>

### What remains to prove

- one uninterrupted zero-VM `playbooks/site-lab.yml` run after
  `playbooks/site-bootstrap.yml` completes
- no live code repair during that attempt

### Current confidence gate

1. Tear down to zero VMs and reset lab networking.
2. Run `playbooks/site-bootstrap.yml`.
3. Run `playbooks/site-lab.yml` end to end without intervention.

## Planned Work: AD Source-Of-Truth Policy Model

Status:

- in progress
- the first orchestration slice is now wired
- live validation of the bridge and downstream consumers is still pending

The future target is:

- AD as the source of truth for users and source-side group membership
- IdM local groups as the policy and authorization boundary
- RHEL sudo, Keycloak group emission, and OpenShift RBAC all consuming the
  local IdM groups rather than raw AD group names

Saved implementation artifacts:

- <a href="./ad-idm-policy-model.md"><kbd>AD / IDM POLICY MODEL</kbd></a>
- <a href="../vars/global/ad_group_policy.yml"><kbd>vars/global/ad_group_policy.yml</kbd></a>
- <a href="../roles/idm_ad_trust/tasks/main.yml"><kbd>roles/idm_ad_trust/tasks/main.yml</kbd></a>

What is implemented now:

- canonical AD-to-IdM mapping data
- IdM external-group creation for mapped AD groups
- nesting of those external groups into the target local IdM groups during the
  AD trust play

What is still pending:

- live proof that trusted AD users inherit the intended local IdM groups
- RHEL-side authorization validation through the bridged local groups
- Keycloak/OpenShift validation that the bridged local groups are what drive
  OIDC group claims and RBAC
- deferred naming/description cleanup so local IdM access groups and external
  AD source groups are visually distinct in the UI and `ipa` output

## Closed Investigation: ODF NooBaa / CNPG initialization stall

Status:
- closed
- the current day-2 flow now completes
- the historical failure is preserved here only as context for older logs

### What happened

During the long day-2 stabilization work, ODF initially stopped in the NooBaa
and CNPG path while the storage stack was still being hardened. The cluster
reached a state where Ceph was healthy and the remaining blocker was the
NooBaa database volume path on the infra nodes.

That work was eventually superseded by later ODF rerun hardening:

- the ODF role now treats destructive recovery as force-only
- ODF host-side cleanup is explicit
- BlueStore wipe positions are codified
- the day-2 probe path is healthy-state aware and skip-by-default on reruns

### Why this note remains

This page stays as a closed-case notebook so older logs and run outputs still
have a place to point people who are trying to match historical symptoms.
The actionable fixes moved into:

- <a href="./issues.md"><kbd>ISSUES LEDGER</kbd></a>
- <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a>
- <a href="./orchestration-guide.md"><kbd>ORCHESTRATION GUIDE</kbd></a>

### Historical symptom summary

- ODF initially appeared to stop at NooBaa/CNPG initialization.
- A user-created RBD PVC could bind successfully while NooBaa remained
  unsettled.
- The failure path was eventually traced into the NooBaa DB volume staging
  lifecycle on the storage nodes, then superseded by later ODF rebuild safety
  work.

### Historical follow-up

The original investigation included nodeplugin restarts, kubelet restarts,
cordoning, and CNPG/PVC recreation. Those steps are intentionally preserved in
the older logs but are not the current recommended operator path.
