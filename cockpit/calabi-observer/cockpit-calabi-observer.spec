Name:           cockpit-calabi-observer
Version:        1.1.0
Release:        1%{?dist}
Summary:        Cockpit plugin for Calabi hypervisor performance domain and memory oversubscription observability

License:        GPL-3.0-or-later
URL:            https://github.com/gprocunier/calabi
Source0:        %{name}-%{version}.tar.gz

BuildArch:      noarch

Requires:       cockpit-system
Requires:       cockpit-bridge
Requires:       python3
Requires:       libvirt-client

%description
Calabi Observer is a Cockpit plugin that provides real-time observability
into CPU performance domains (Gold/Silver/Bronze systemd cgroup tiers) and
host memory oversubscription features (KSM, zram, THP) on KVM hypervisors
running the Calabi nested-virtualization lab.

The plugin displays:
- KSM cost-benefit analysis with efficiency verdict and tuning recommendations
- Per-tier and per-domain CPU utilization with throttling indicators
- Host memory waterfall with overcommit ratio and reclaim gains
- Memory management overhead tracking (ksmd, kswapd, kcompactd CPU cost)

%prep
%autosetup

%build
# Nothing to build — pure HTML/JS/CSS/Python plugin

%install
mkdir -p %{buildroot}%{_datadir}/cockpit/calabi-observer
install -m 0644 manifest.json   %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 index.html      %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 calabi-observer.js  %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 calabi-observer.css %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 sparkline.js    %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0755 collector.py    %{buildroot}%{_datadir}/cockpit/calabi-observer/

%files
%{_datadir}/cockpit/calabi-observer/

%changelog
* Tue Mar 25 2026 Greg Procunier <greg.procunier@gmail.com> - 1.1.0-1
- Add CPU Pool Topology heatmap with NUMA domain boxing and pool color coding
- Add per-CPU clock frequency in tooltips and per-pool average frequency display
- Add vCPU oversubscription ratio, total guest vCPUs, host steal time metrics
- Separate per-tier vCPU density into dedicated row
- Remove redundant zram text and available memory sparkline from Memory Overview
- Add KSM use_zero_pages disabled annotation
- Collector now reads per-CPU frequency from /proc/cpuinfo

* Tue Mar 25 2025 Greg Procunier <greg.procunier@gmail.com> - 1.0.0-1
- Initial release
- KSM cost-benefit panel with efficiency verdict gauge
- CPU performance domain observability (Gold/Silver/Bronze tiers)
- Memory overview with overcommit ratio and reclaim gains
- Memory management overhead tracking (ksmd/kswapd/kcompactd)
