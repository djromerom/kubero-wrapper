# Retains the official Kubero operator and its builder implementation.
FROM ghcr.io/kubero-dev/kubero-operator/kuberoapp:v0.2.2 AS upstream
FROM python:3.12-alpine AS patch
COPY --from=upstream /opt/helm/helm-charts/kuberobuild /chart
COPY patch-build-chart.py /patch-build-chart.py
RUN python /patch-build-chart.py /chart
FROM upstream
COPY --from=patch /chart /opt/helm/helm-charts/kuberobuild
LABEL atlas.dev.build-contract="2"
