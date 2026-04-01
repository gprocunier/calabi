.PHONY: validate validate-site-lab validate-day2

validate:
	./scripts/validate-orchestration.sh

validate-site-lab:
	./scripts/validate-orchestration.sh --playbook playbooks/site-lab.yml

validate-day2:
	./scripts/validate-orchestration.sh --playbook playbooks/day2/openshift-post-install.yml
