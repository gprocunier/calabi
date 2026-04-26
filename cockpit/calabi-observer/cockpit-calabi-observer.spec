Name:           cockpit-calabi-observer
Version:        1.2.3
Release:        1%{?dist}
Summary:        Cockpit plugin for Calabi hypervisor performance domain and memory oversubscription observability

License:        GPL-3.0-or-later
URL:            https://github.com/gprocunier/calabi
Source0:        %{name}-%{version}.tar.gz

BuildArch:      noarch
BuildRequires:  systemd-rpm-macros

Requires:       cockpit-system
Requires:       cockpit-bridge
Requires:       python3
Requires:       libvirt-client
Requires:       firewalld
Requires(post): systemd
Requires(preun): systemd
Requires(postun): systemd

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
mkdir -p %{buildroot}%{_unitdir}
mkdir -p %{buildroot}%{_tmpfilesdir}
mkdir -p %{buildroot}%{_sysconfdir}/calabi-observer
install -m 0644 manifest.json   %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 index.html      %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 calabi-observer.js  %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 calabi-observer.css %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 sparkline.js    %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0755 collector.py    %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0755 calabi_exporter.py %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0755 prometheus_exporter.py %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0755 prometheus_control.py %{buildroot}%{_datadir}/cockpit/calabi-observer/
install -m 0644 prometheus.json %{buildroot}%{_sysconfdir}/calabi-observer/prometheus.json
install -m 0644 calabi-exporter.service %{buildroot}%{_unitdir}/
install -m 0644 calabi-node-exporter.service %{buildroot}%{_unitdir}/
install -m 0644 calabi-observer-prometheus.tmpfiles %{buildroot}%{_tmpfilesdir}/calabi-observer-prometheus.conf

%post
/usr/bin/systemd-tmpfiles --create %{_tmpfilesdir}/calabi-observer-prometheus.conf || :
%systemd_post calabi-exporter.service calabi-node-exporter.service

%preun
%systemd_preun calabi-exporter.service calabi-node-exporter.service

%postun
%systemd_postun_with_restart calabi-exporter.service calabi-node-exporter.service

%files
%{_datadir}/cockpit/calabi-observer/
%{_unitdir}/calabi-exporter.service
%{_unitdir}/calabi-node-exporter.service
%{_tmpfilesdir}/calabi-observer-prometheus.conf
%config(noreplace) %{_sysconfdir}/calabi-observer/prometheus.json

%changelog
* Sat Apr 25 2026 Greg Procunier <greg.procunier@gmail.com> - 1.2.3-1
- Radial arc gauges on key percentage/ratio metrics
- Improved glass card visibility with lower opacity and stronger blur
- Dark mode text contrast boost across all text tokens

* Sat Apr 25 2026 Greg Procunier <greg.procunier@gmail.com> - 1.2.2-1
- Gradient page backgrounds for visible glass blur effect
- Fixed solid-color backdrop producing no visual difference

* Sat Apr 25 2026 Greg Procunier <greg.procunier@gmail.com> - 1.2.1-1
- Frosted glass aesthetic with backdrop-filter blur
- Light and dark mode support via prefers-color-scheme
- Glass tokens for all card, tile, and panel surfaces

* Sat Apr 25 2026 Greg Procunier <greg.procunier@gmail.com> - 1.2.0-1
- UX refactor: disposition strips replace verdict gauges
- Add Effective Clock sub-tab with per-tier SLO floor reference lines
- Design tokens and monospace values throughout
- Compact single-row VM inventory layouts for KSM and zram attribution
- Collapsible zram detail metrics
- Sparkline reference line support
- ARIA tab roles for accessibility
- Card elevation, table zebra striping, sticky headers

* Wed Mar 25 2026 Greg Procunier <greg.procunier@gmail.com> - 1.1.0-1
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
