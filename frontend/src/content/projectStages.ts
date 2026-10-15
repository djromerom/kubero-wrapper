export type ProjectStageId = 'validation' | 'approval' | 'deploying' | 'deployed';

interface ProjectStage {
  id: ProjectStageId;
  label: string;
  statuses: string[];
  color: string;
  track: string;
  marker: string;
}

export const projectStages: ProjectStage[] = [
  {
    id: 'validation',
    label: 'Validación',
    statuses: ['adapting', 'pending', 'corrections'],
    color: 'bg-amber-700',
    track: 'bg-amber-100',
    marker: 'border-amber-700 text-amber-700',
  },
  {
    id: 'approval',
    label: 'Aprobación',
    statuses: ['approved'],
    color: 'bg-violet-600',
    track: 'bg-violet-100',
    marker: 'border-violet-600 text-violet-700',
  },
  {
    id: 'deploying',
    label: 'Desplegando',
    statuses: ['ci_pending', 'building'],
    color: 'bg-sky-600',
    track: 'bg-sky-100',
    marker: 'border-sky-600 text-sky-700',
  },
  {
    id: 'deployed',
    label: 'Desplegado',
    statuses: ['running'],
    color: 'bg-emerald-600',
    track: 'bg-emerald-100',
    marker: 'border-emerald-600 text-emerald-700',
  },
];
