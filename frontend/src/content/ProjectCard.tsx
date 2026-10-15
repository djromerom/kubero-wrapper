import { IconExternalLink } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import type { Project } from '../api';
import StatusBadge from './StatusBadge';

export default function ProjectCard({ project }: { project: Project }) {
  const visibleDomain = project.status === 'running' ? project.domain : null;
  const appUrl = visibleDomain
    ? /^https?:\/\//i.test(visibleDomain)
      ? visibleDomain
      : `http://${visibleDomain}`
    : null;

  return (
    <article className="relative flex h-full flex-col rounded-xl border border-atlas-mist p-5 transition hover:border-atlas-ink">
      <Link to={`/projects/${project.id}`} aria-label={`Ver proyecto ${project.name}`} className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-red" />
      <div>
        <StatusBadge status={project.status} />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{project.name}</h3>
      <p className="mt-1 break-all text-xs text-atlas-muted">
        {project.repo_url.replace('https://', '')}
      </p>
      {appUrl ? (
        <a href={appUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 mt-3 inline-flex max-w-full items-center gap-1 text-xs text-atlas-red hover:underline focus-visible:underline" aria-label={`Abrir aplicación ${project.name} en una pestaña nueva`}>
          <span className="min-w-0 break-all">{visibleDomain}</span>
          <IconExternalLink size={15} stroke={1.8} aria-hidden="true" className="shrink-0" />
        </a>
      ) : (
        <p className="mt-3 text-xs text-atlas-muted">
          {project.status === 'retained'
            ? 'Aplicación detenida · datos retenidos'
            : 'URL aún no disponible'}
        </p>
      )}
    </article>
  );
}
