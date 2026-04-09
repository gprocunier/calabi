# On-Prem Calabi Notes

This directory captures the current portability analysis for running Calabi on
an on-prem bare-metal host instead of provisioning `virt-01` through AWS.

Current conclusion:

- most of the lab, support-service, cluster, and day-2 orchestration is already
  portable
- the main portability gap is the outer host-acquisition contract, not the lab
  itself
- if an on-prem host is prepared to look enough like the current `virt-01`
  contract, most playbooks should run with little or no orchestration change

Start here:

- [Portability And Gap Analysis](./portability-and-gap-analysis.md)
- [Host Sizing And Resource Policy](./host-sizing-and-resource-policy.md)

Scope of this note set:

- what is AWS-specific today
- what is already portable
- what host assumptions must be preserved on-prem
- how CPU tiering and memory oversubscription change as hardware drifts away
  from `m5.metal`

This is design and implementation guidance only. It does not yet add a
first-class on-prem target to the automation.
