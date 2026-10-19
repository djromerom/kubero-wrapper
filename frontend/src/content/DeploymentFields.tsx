import { useState } from 'react';
import type { DeploymentConfig } from '../api';
import { fieldClassName, fieldLabelClassName, controlClassName } from '../shared/formStyles';

function parseVariables(text: string, publicOnly: boolean): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      throw new Error('Usa una variable por línea: NOMBRE=valor.');
    if (Object.hasOwn(values, key)) throw new Error(`La variable ${key} está repetida.`);
    if (publicOnly && !/^(NEXT_PUBLIC_|PUBLIC_|VITE_)/.test(key))
      throw new Error(
        'Las variables de construcción deben comenzar con NEXT_PUBLIC_, PUBLIC_ o VITE_.'
      );
    values[key] = line.slice(separator + 1);
  }
  return values;
}

export default function DeploymentFields({
  value,
  onChange,
  onValidityChange,
  disabled = false,
}: {
  value: DeploymentConfig;
  onChange: (config: DeploymentConfig) => void;
  onValidityChange: (valid: boolean) => void;
  disabled?: boolean;
}) {
  const format = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([key, item]) => `${key}=${item}`)
      .join('\n');
  const [buildText, setBuildText] = useState(() => format(value.build_env));
  const [runtimeText, setRuntimeText] = useState(() => format(value.runtime_env));
  const [variableError, setVariableError] = useState('');
  const updateVariables = (build: string, runtime: string) => {
    setBuildText(build);
    setRuntimeText(runtime);
    try {
      onChange({
        ...value,
        build_env: parseVariables(build, true),
        runtime_env: parseVariables(runtime, false),
      });
      setVariableError('');
      onValidityChange(true);
    } catch (error) {
      setVariableError((error as Error).message);
      onValidityChange(false);
    }
  };
  return (
    <fieldset disabled={disabled} className="space-y-5 disabled:opacity-70">
      <p className="text-sm text-atlas-muted">
        Se usará el Dockerfile del repositorio. Si falta, Atlas intentará una plantilla para
        Next.js, Astro, Vite o Node. Una aplicación no compatible deberá proporcionar su Dockerfile.
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={fieldClassName}>
          <span className={fieldLabelClassName}>Puerto interno</span>
          <input type="number" min={1} max={65535} required className={controlClassName} value={value.port} onChange={(e) => onChange({ ...value, port: Number(e.target.value) })} />
        </label>
        <label className={fieldClassName}>
          <span className={fieldLabelClassName}>Ruta de comprobación HTTP</span>
          <input required pattern="/.*" className={controlClassName} value={value.health_path} onChange={(e) => onChange({ ...value, health_path: e.target.value })} placeholder="/api/docs" />
        </label>
      </div>
      <label className={fieldClassName}>
        <span className={fieldLabelClassName}>Variables públicas de construcción</span>
        <textarea className={`${controlClassName} font-mono text-xs`} rows={3} value={buildText} onChange={(e) => updateVariables(e.target.value, runtimeText)} placeholder="NEXT_PUBLIC_API_URL=http://tu-api.app.127.0.0.1.sslip.io" />
        <span className="text-xs text-atlas-muted">
          Estos valores se incorporan al sitio y son visibles en el navegador. No ingreses
          contraseñas.
        </span>
      </label>
      <label className={fieldClassName}>
        <span className={fieldLabelClassName}>Variables del servidor</span>
        <textarea className={`${controlClassName} font-mono text-xs`} rows={3} value={runtimeText} onChange={(e) => updateVariables(buildText, e.target.value)} placeholder="JWT_SECRET=tu-valor" spellCheck={false} autoComplete="off" />
      </label>
      {variableError && (
        <p role="alert" className="text-sm text-atlas-red">
          {variableError}
        </p>
      )}
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={value.postgres} onChange={(e) => onChange({ ...value, postgres: e.target.checked })} />
          PostgreSQL propio
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={value.redis} onChange={(e) => onChange({ ...value, redis: e.target.checked })} />
          Redis para colas y caché
        </label>
      </div>
      <p className="text-xs text-atlas-muted">
        Atlas configura DATABASE_URL para PostgreSQL y REDIS_HOST, REDIS_PORT y REDIS_URL para
        Redis. PostgreSQL conserva sus datos entre despliegues; Redis es temporal.
      </p>
      <label className={fieldClassName}>
        <span className={fieldLabelClassName}>Migración antes del arranque</span>
        <input className={controlClassName} value={value.migration_command} onChange={(e) => onChange({ ...value, migration_command: e.target.value })} placeholder="npx prisma migrate deploy" />
        <span className="text-xs text-atlas-muted">
          Opcional. Se ejecuta dentro de la imagen y debe terminar correctamente.
        </span>
      </label>
      <label className={fieldClassName}>
        <span className={fieldLabelClassName}>Comando del worker</span>
        <input className={controlClassName} value={value.worker_command} onChange={(e) => onChange({ ...value, worker_command: e.target.value })} placeholder="npm run start:worker:prod" />
        <span className="text-xs text-atlas-muted">
          Opcional. Usa la misma imagen y variables que la aplicación.
        </span>
      </label>
    </fieldset>
  );
}
