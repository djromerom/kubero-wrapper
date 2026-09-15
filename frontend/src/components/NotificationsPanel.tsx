import { Link } from 'react-router-dom';
import { listDemoProjects } from '../demoProjects';
import { getDemoUser } from '../demoSession';
export default function NotificationsPanel({ onClose }: { onClose: () => void }) {
 if(!getDemoUser()) return <p className="text-sm text-atlas-muted">Las notificaciones estarán disponibles al conectar el servicio.</p>;
 const projects=listDemoProjects(getDemoUser()?.role==='admin');
 const events=projects.flatMap(project=>(project.history||[]).map(event=>({...event,project}))).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
 return <ul className="divide-y divide-atlas-mist">{events.map((event,index)=><li key={`${event.project.id}-${index}`} className="py-3"><Link onClick={onClose} to={`/projects/${event.project.id}`} className="text-sm hover:text-atlas-red"><strong>{event.project.name}</strong><span className="mt-1 block">{event.action}</span><span className="mt-2 block text-xs text-atlas-muted">{new Date(event.date).toLocaleString('es-CO')}</span></Link></li>)}{!events.length&&<li className="text-sm text-atlas-muted">No hay notificaciones.</li>}</ul>;
}
