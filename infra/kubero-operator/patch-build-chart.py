"""Small integration fixes to Kubero's official v0.2.2 builder chart.

Packaging remains the upstream fetch/Nixpacks/CNB/Buildah implementation.
Adds admission integration: node selection, scoped credentials, build variables,
and a maintained kubectl image. The upstream chart/license stay in the image.
"""
from pathlib import Path
import sys
import re

for path in (Path(sys.argv[1]) / 'templates').glob('job-*.yaml'):
    text = path.read_text()
    text = text.replace('image: bitnami/kubectl:latest',
                        'image: {{ .Values.deployerImage | default "registry.k8s.io/kubectl:v1.34.0" }}')
    # The maintained kubectl image contains the binary, but no shell.
    text = re.sub(r'          command:\n          - sh\n          - -c\n          - \'kubectl patch kuberoapps.*?\}\}\}"\'\n',
                  '''          command: ["/bin/kubectl"]
          args: ["patch", "kuberoapps", {{ .Values.app | quote }}, "--type=merge", "-p", {{ dict "spec" (dict "image" (dict "repository" .Values.repository.image "tag" (.Values.repository.tag | default "latest"))) | toJson | quote }}]
''', text, count=1, flags=re.S)
    text = text.replace('      automountServiceAccountToken: true', '''      {{- with .Values.nodeSelector }}
      nodeSelector:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      automountServiceAccountToken: true''')
    text = text.replace('          - name: GIT_REPOSITORY', '''          {{- if .Values.gitCredentialsSecret }}
          - name: ATLAS_GIT_TOKEN
            valueFrom:
              secretKeyRef:
                name: {{ .Values.gitCredentialsSecret }}
                key: token
          - name: GIT_CONFIG_COUNT
            value: "1"
          - name: GIT_CONFIG_KEY_0
            value: credential.helper
          - name: GIT_CONFIG_VALUE_0
            value: '!f() { echo username=x-access-token; echo password=$ATLAS_GIT_TOKEN; }; f'
          {{- end }}
          - name: GIT_REPOSITORY''')
    text = text.replace('        - name: build\n', '''        - name: build
          {{- if .Values.buildEnvironmentSecret }}
          envFrom:
          - secretRef:
              name: {{ .Values.buildEnvironmentSecret }}
          {{- end }}
''')
    text = text.replace('        - name: push\n', '''        - name: push
          {{- if .Values.buildEnvironmentSecret }}
          envFrom:
          - secretRef:
              name: {{ .Values.buildEnvironmentSecret }}
          {{- end }}
''')
    text = text.replace('buildah build -f $BUILDAH_DOCKERFILE_PATH',
                        'buildah build {{ range .Values.buildEnvKeys }}--build-arg {{ . | quote }} {{ end }}-f $BUILDAH_DOCKERFILE_PATH')
    text = text.replace('buildah push --tls-verify=false',
                        'buildah push --tls-verify={{ .Values.registryTlsVerify | default "true" }}')
    text = text.replace('nixpacks build . -o .',
                        'nixpacks build . {{ range .Values.buildEnvKeys }}--env "{{ . }}=${{ . }}" {{ end }}-o .')
    if path.name == 'job-buikdpacks.yaml':
        text = text.replace('image: "paketobuildpacks/builder-jammy-full:latest"', 'image: {{ .Values.buildpack.builder | default "paketobuildpacks/ubuntu-noble-builder:latest" | quote }}')
        text = text.replace('          - name: CNB_PLATFORM_API', '''          - name: CNB_INSECURE_REGISTRIES
            value: {{ .Values.insecureRegistry | default "" | quote }}
          - name: CNB_PLATFORM_API''')
        text = text.replace('          - mountPath: /home/cnb/.docker', '''          {{- if .Values.buildEnvironmentSecret }}
          - mountPath: /platform/env
            name: build-environment
            readOnly: true
          {{- end }}
          - mountPath: /home/cnb/.docker''')
        text = text.replace('      volumes:\n', '''      volumes:
      {{- if .Values.buildEnvironmentSecret }}
      - name: build-environment
        secret:
          secretName: {{ .Values.buildEnvironmentSecret }}
      {{- end }}
''')
    path.write_text(text)
