interface Props {
  status: string;
}

const colors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  building: 'bg-blue-100 text-blue-900',
  running: 'bg-green-100 text-green-900',
  failed: 'bg-red-100 text-red-900', corrections: 'bg-amber-100 text-amber-900', ci_failed: 'bg-red-100 text-red-900',
  deleted: 'bg-atlas-mist text-atlas-muted',
};

export default function StatusBadge({ status }: Props) {
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status] || 'bg-atlas-mist text-atlas-muted'}`}>
      {({ pending: 'Validación pendiente', building: 'CI en ejecución', ci_pending: 'CI pendiente', corrections: 'Correcciones pendientes', retained: 'Retenido', recovery_pending: 'Recuperación pendiente', ci_failed: 'CI fallido', approved: 'Aprobado', passed: 'Superado', not_started: 'No iniciado', not_deployed: 'No desplegado', running: 'Desplegado', failed: 'Fallido', deleted: 'Eliminado' } as Record<string, string>)[status] || status}
    </span>
  );
}
