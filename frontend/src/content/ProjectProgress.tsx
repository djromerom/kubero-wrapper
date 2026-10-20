import type { Project } from '../api';
import { projectStages, type ProjectStageId } from './projectStages';

interface Props {
  projects: Project[];
  loading: boolean;
  selectedStage: ProjectStageId | null;
  onSelectStage: (stage: ProjectStageId) => void;
}

export default function ProjectProgress({
  projects,
  loading,
  selectedStage,
  onSelectStage,
}: Props) {
  return (
    <section aria-label="Proyectos por etapa" aria-busy={loading} className="overflow-x-auto py-4">
      <ol className="flex min-w-120 gap-2">
        {projectStages.map((stage) => {
          const count = projects.filter((project) =>
            stage.statuses.includes(project.status)
          ).length;
          const selected = selectedStage === stage.id;

          return (
            <li key={stage.id} className="min-w-0 flex-1">
              <button type="button" disabled={loading} aria-pressed={selected} aria-controls="filtered-projects" aria-label={`Filtrar proyectos: ${stage.label}`} onClick={() => onSelectStage(stage.id)} className="group block w-full rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-atlas-red disabled:cursor-wait">
                <div className="relative h-10">
                  <div aria-hidden="true" className={`absolute inset-x-0 bottom-1.5 h-2 rounded-full transition-opacity group-hover:opacity-80 ${count ? stage.color : stage.track} ${selected ? 'ring-2 ring-atlas-ink/20 ring-offset-2' : ''}`} />
                  {count > 0 && (
                    <span className={`absolute bottom-0 right-0 flex h-10 w-3.5 flex-col items-center justify-between text-xs font-semibold ${stage.marker}`}>
                      <span className="tabular-nums">{count}</span>
                      <span aria-hidden="true" className={`mb-[3px] h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-white shadow-xs ${stage.marker}`} />
                    </span>
                  )}
                </div>
                <span className={`mt-1 block text-center text-[11px] sm:text-sm ${selected ? 'font-semibold text-atlas-ink' : 'font-medium text-atlas-muted'}`}>
                  {stage.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
