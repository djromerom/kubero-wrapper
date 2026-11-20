import type { Project } from '../api';
export const projectCiStage = (project: Project) => project.ci ? `ci_${project.ci.status}` : project.status;
export type ProjectStageId = 'queued' | 'failed' | 'deploying' | 'deployed';

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
    id: 'queued',
    label: 'CI en cola',
    statuses: ['ci_queued', 'ci_submitting', 'ci_pending', 'pending', 'approved', 'adapting'],
    color: 'bg-violet-600',
    track: 'bg-violet-100',
    marker: 'border-violet-600 text-violet-700',
  },
  {
    id: 'failed',
    label: 'Requieren atención',
    statuses: ['ci_failed', 'ci_blocked', 'ci_submission_unknown', 'ci_cancelled', 'failed', 'corrections'],
    color: 'bg-amber-700',
    track: 'bg-amber-100',
    marker: 'border-amber-700 text-amber-700',
  },
  {
    id: 'deploying',
    label: 'Construyendo',
    statuses: ['ci_running', 'ci_verifying', 'building'],
    color: 'bg-sky-600',
    track: 'bg-sky-100',
    marker: 'border-sky-600 text-sky-700',
  },
  {
    id: 'deployed',
    label: 'Imagen publicada',
    statuses: ['ci_published'],
    color: 'bg-emerald-600',
    track: 'bg-emerald-100',
    marker: 'border-emerald-600 text-emerald-700',
  },
];
