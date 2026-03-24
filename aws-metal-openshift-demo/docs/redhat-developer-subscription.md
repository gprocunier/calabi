# Red Hat Developer Subscription For Individuals

Nearby docs:

<a href="./prerequisites.md"><kbd>&nbsp;&nbsp;PREREQUISITES&nbsp;&nbsp;</kbd></a>
<a href="./secrets-and-sanitization.md"><kbd>&nbsp;&nbsp;SECRETS&nbsp;&nbsp;</kbd></a>
<a href="./README.md"><kbd>&nbsp;&nbsp;DOCS MAP&nbsp;&nbsp;</kbd></a>

This lab needs Red Hat subscription content that is not available from
community or upstream-only sources. If you do not already have an active Red
Hat account with entitlements, the Developer Subscription for Individuals is
the easiest zero-cost path to everything the project requires.

## What The Developer Subscription Gives You

- CDN access to RHEL content, including the `fast-datapath` repository
  required for `openvswitch3.6` on the metal host
- a pull secret for OpenShift container image content
- RHEL guest images in qcow2 format
- access to the OpenShift installer and client toolchain
- Red Hat Insights registration for host and guest telemetry

> [!IMPORTANT]
> The developer subscription is a self-support, individual-use entitlement.
> It is not intended for production workloads. For this project that is fine
> — it covers every content channel the lab automation needs.

## How To Set It Up

### 1. Create a Red Hat account

Go to the Red Hat Developer portal and create a free account:

- `https://developers.redhat.com`

If you already have a Red Hat account from a prior engagement, training, or
certification, you can use it. You do not need a separate developer account.

### 2. Activate the developer subscription

Once logged in, visit:

- `https://developers.redhat.com/register`

Accept the terms. The Developer Subscription for Individuals will appear in
your account subscription inventory. If it does not show up immediately, log
out and back in.

Verify it is active at:

- `https://access.redhat.com/management/subscriptions`

You should see a subscription named `Red Hat Developer Subscription for
Individuals` with a status of `Active`.

### 3. Get your pull secret

The OpenShift pull secret is available at:

- `https://console.redhat.com/openshift/install/pull-secret`

Download it and save it locally. The automation expects a path to this file,
configured in your local `lab_credentials.yml` or passed via
`lab_execution_pull_secret_file`.

### 4. Get RHSM credentials

You need one of:

- an activation key plus organization ID, or
- your Red Hat account username plus password

For the activation key path, create one at:

- `https://console.redhat.com/insights/connector/activation-keys`

Your organization ID is visible at:

- `https://console.redhat.com/settings/sources`

Or retrieve it with:

```bash
curl -s -u '<username>' \
  https://subscription.rhsm.redhat.com/subscription/users/<username>/owners \
  | python3 -m json.tool
```

The `key` field in the response is your organization ID.

### 5. Get the RHEL guest image

Download the RHEL 10.1 KVM guest image from:

- `https://console.redhat.com/insights/image-builder`

Or from the direct downloads page:

- `https://access.redhat.com/downloads/content/rhel`

Look for the `KVM Guest Image` artifact in qcow2 format. The automation
expects either a local copy at `<project-root>/images/rhel-10.1-x86_64-kvm.qcow2`
or a direct-download URL in `lab_execution_guest_base_image_url`.

### 6. Get the RHEL AMI for the metal host via Red Hat Cloud Access

The current CloudFormation stack expects a private or shared RHEL AMI ID.
The preferred way to get this is through the Red Hat Cloud Access program,
which shares Gold Images directly into your cloud provider account at no
additional image cost beyond the underlying compute.

#### What Cloud Access is

Cloud Access lets you use your existing Red Hat subscriptions — including the
Developer Subscription — in supported public clouds. Instead of paying a
per-hour RHEL premium through the cloud provider marketplace, Red Hat shares
pre-built Gold Images into your account and you bring your own subscription
entitlement.

This is supported on:

- AWS (EC2 AMIs)
- Microsoft Azure (VM images)
- Google Cloud Platform (Compute Engine images)

The mechanics differ slightly per provider, but the model is the same: you
enroll the subscription, link your cloud account, and Red Hat shares the
image catalog into it.

#### How to enroll

1. Log in to the Red Hat Hybrid Cloud Console:

   - `https://console.redhat.com`

2. Navigate to the Cloud Access management page:

   - `https://console.redhat.com/settings/integrations`

3. Add a new cloud provider source:

   - choose AWS (or Azure / GCP if adapting this project for another cloud)
   - provide your AWS account ID
   - Red Hat will share RHEL Gold Images into your account

4. Wait for the images to appear. This can take up to an hour on the first
   enrollment. Once active, the shared images refresh automatically as Red Hat
   publishes new builds.

5. Find the shared AMI:

   ```bash
   aws ec2 describe-images \
     --owners 309956199498 \
     --filters "Name=name,Values=RHEL-10.1*" \
     --query 'Images[*].[ImageId,Name,CreationDate]' \
     --output table \
     --region us-east-2
   ```

   Owner `309956199498` is the Red Hat image-sharing account for Cloud Access.
   Adjust the region to match your deployment target.

6. Use the AMI ID as the `RedHatRhelPrivateAmiId` parameter in the host
   CloudFormation stack.

> [!TIP]
> Cloud Access images are CDN-entitled by default. This means the metal host
> will register against Red Hat CDN content on first boot, which is exactly
> what the lab requires for the `fast-datapath` repository.

#### If Cloud Access is not available

If you cannot enroll in Cloud Access, the fallback is a RHEL Marketplace AMI
from the AWS Marketplace. Marketplace AMIs work but carry an additional
per-hour RHEL usage charge on top of the EC2 compute cost. They also
typically register against RHUI content, so you will need to manually switch
the host to CDN subscription after first boot.

## Where These Inputs Land In The Project

| Input | Where it goes |
| --- | --- |
| pull secret file | `lab_execution_pull_secret_file` or local path |
| RHSM activation key | `lab_rhsm_activation_key` in `lab_credentials.yml` |
| RHSM organization ID | `lab_rhsm_organization_id` in `lab_credentials.yml` |
| RHSM username/password | `lab_rhsm.username` / `lab_rhsm.password` in `lab_credentials.yml` |
| RHEL guest qcow2 | `<project-root>/images/` or `lab_execution_guest_base_image_url` |
| RHEL AMI ID | `RedHatRhelPrivateAmiId` in CloudFormation parameters |

## What To Do Next

Once you have the subscription active and the inputs staged:

- <a href="./prerequisites.md"><kbd>PREREQUISITES</kbd></a> — verify the full checklist
- <a href="./secrets-and-sanitization.md"><kbd>SECRETS</kbd></a> — set up `lab_credentials.yml` safely
- <a href="./automation-flow.md"><kbd>AUTOMATION FLOW</kbd></a> — start the build
