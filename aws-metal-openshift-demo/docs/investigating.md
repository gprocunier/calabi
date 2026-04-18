# Investigation Notes

This page now serves as a short closure note for investigations that mattered
to the current validated release.

It is more operational than <a href="./issues.md"><kbd>ISSUES LEDGER</kbd></a>: the issues ledger records the
fixes that landed, while this file records the final disposition of the bigger
investigation threads.

Use this page when you want the release-level answer to "is this still open, or
is it closed now?" Use <a href="./issues.md"><kbd>ISSUES LEDGER</kbd></a> when you need the
specific fixing commit and symptom history.

## Current Release Status

Current validated release:

- `v1.2.0`
- confirmed to deploy cleanly
- no active investigation is currently blocking the release

What is now proven on the current release:

- zero-VM teardown and rebuild through
  `./scripts/run_local_playbook.sh`
  <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
- uninterrupted
  `./scripts/run_remote_bastion_playbook.sh`
  <a href="../playbooks/site-lab.yml"><kbd>playbooks/site-lab.yml</kbd></a>
  convergence on the current codebase
- mirrored content, cluster install, and day-2 convergence
- OpenShift auth on:
  - `HTPasswd` breakglass
  - Keycloak OIDC
  - group-based RBAC through `openshift-admin`
- AAP on Keycloak OIDC
- AD-backed user login to AAP after clean redeploy
- clean repo validation:
  - `make validate`
  - `ansible-lint -p`

Current disposition:

- all release-blocking investigation items are closed
- the repo no longer needs a separate open-investigation gate for clean deploys

## Closed Investigation: Final Golden-Path Certification Run

Status:

- closed
- the clean release bar was met on `v1.2.0`

What was required:

- zero-VM teardown and network reset
- `./scripts/run_local_playbook.sh`
  <a href="../playbooks/site-bootstrap.yml"><kbd>playbooks/site-bootstrap.yml</kbd></a>
- uninterrupted `./scripts/run_remote_bastion_playbook.sh`
  <a href="../playbooks/site-lab.yml"><kbd>playbooks/site-lab.yml</kbd></a>
  without live code repair

Final result:

- that clean-path certification run has now been achieved
- the late orchestration defects that previously surfaced during fresh runs
  were corrected and retested before release

Why this note remains:

- it explains why earlier docs and runbooks emphasized the need for one final
  uninterrupted fresh-path proof
- that proof now exists, so this is retained only as release history

## Closed Investigation: AD Source-Of-Truth Policy Model

Status:

- closed for the current release baseline

What is implemented and validated:

- canonical AD-to-IdM mapping data
- IdM external-group creation for mapped AD groups
- nesting of those external groups into the target local IdM groups during the
  AD trust play
- Keycloak/OpenShift/AAP auth flowing through the current validated auth model

Current release stance:

- the release baseline is validated and closed
- future policy refinements can proceed as follow-on design work, not as an
  open release investigation

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
