import { Link } from 'react-router-dom';
import type { Project } from '../api';
import type { DemoProject } from '../demoProjects';
import StatusBadge from './StatusBadge';
export default function ProjectCard({ project:p }: { project:Project }) {
 const demo=p as Partial<DemoProject>;
 return <Link to={`/projects/${p.id}`} aria-label={`Ver proyecto ${p.name}`} className="block h-full cursor-pointer rounded-xl"><article className="flex h-full flex-col rounded-xl border border-atlas-mist p-5 transition hover:border-atlas-red"><div><StatusBadge status={p.status}/></div><h3 className="mt-4 text-lg font-semibold">{p.name}</h3><p className="mt-2 text-xs text-atlas-muted">{demo.owner}</p><p className="mt-1 break-all text-xs text-atlas-muted">{p.repo_url.replace('https://','')}</p><p className="mt-3 break-all text-xs text-atlas-muted">{p.domain || (p.status==='retained'?'Aplicación detenida · datos retenidos':'URL aún no disponible')}</p>{demo.deletion&&<p className="mt-3 text-xs text-atlas-red">Eliminación solicitada · plazo {demo.deletion.days} días</p>}<div className="mt-5 flex justify-between gap-3 border-t border-atlas-mist pt-3 text-xs text-atlas-muted"><span>{demo.builds?.length?'Última ejecución':'Solicitud registrada'}</span><span>{demo.builds?.[0]?.status === 'building'?'En curso':new Date(demo.builds?.[0]?.created_at || p.created_at).toLocaleDateString('es-CO')}</span></div></article></Link>;
}
