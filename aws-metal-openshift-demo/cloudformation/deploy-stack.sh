#!/usr/bin/env bash
set -euo pipefail

STACK_SCOPE="${1:-tenant}"
STACK_NAME="${2:-}"
PARAMETERS_FILE="${3:-}"

case "${STACK_SCOPE}" in
  tenant)
    TEMPLATE_SOURCE="cloudformation/templates/tenant.yaml.j2"
    TEMPLATE_FILE="cloudformation/tenant.yaml"
    STACK_NAME="${STACK_NAME:-virt-tenant}"
    PARAMETERS_FILE="${PARAMETERS_FILE:-cloudformation/parameters.tenant-example.json}"
    ;;
  host)
    TEMPLATE_SOURCE="cloudformation/templates/virt-host.yaml.j2"
    TEMPLATE_FILE="cloudformation/virt-host.yaml"
    STACK_NAME="${STACK_NAME:-virt-host}"
    PARAMETERS_FILE="${PARAMETERS_FILE:-cloudformation/parameters.example.json}"
    ;;
  full)
    TEMPLATE_SOURCE="cloudformation/templates/virt-lab.yaml.j2"
    TEMPLATE_FILE="cloudformation/virt-lab.yaml"
    STACK_NAME="${STACK_NAME:-virt-lab}"
    PARAMETERS_FILE="${PARAMETERS_FILE:-cloudformation/parameters.example.json}"
    ;;
  *)
    echo "usage: $0 {tenant|host|full} [stack-name] [parameters.json]" >&2
    exit 2
    ;;
esac

python3 cloudformation/render-virt-lab.py \
  --template "${TEMPLATE_SOURCE}" \
  --output "${TEMPLATE_FILE}"

mapfile -t parameter_overrides < <(
  jq -r '.[] | "\(.ParameterKey)=\(.ParameterValue)"' "${PARAMETERS_FILE}"
)

aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE_FILE}" \
  --parameter-overrides "${parameter_overrides[@]}"

aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs'
