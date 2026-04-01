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
- cluster build, mirrored-content use, and the default auth/day-2 path are
  working on the current environment
- the final bar is still one uninterrupted `playbooks/site-lab.yml` run from a
  deliberate teardown boundary, without live code repair during the attempt

### What is already proven

- support services can be brought up and reused across retries
- the cluster can install successfully on the current codebase
- mirrored Keycloak content deploys and runs
- OpenShift OAuth converges on:
  - `HTPasswd` breakglass
  - Keycloak OIDC
  - group-based RBAC through `openshift-admin`
- the repo validation lane is clean:
  - `make validate`
  - `ansible-lint -p`

### What remains to prove

- a fresh cluster rebuild with support services preserved
- then a fully destructive stack rebuild if the install guide is meant to
  certify the whole environment from zero

### Planned confidence sequence

1. Tear down only the OpenShift cluster and generated OCP artifacts.
2. Rerun `playbooks/site-lab.yml` end to end without intervention.
3. If that succeeds, perform one full-stack destructive rebuild and rerun the
   documented orchestration from zero.

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
