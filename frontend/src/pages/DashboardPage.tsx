import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import type { DemoProject } from '../demoProjects';
import { getDemoUser } from '../demoSession';
import CreateProjectModal from '../components/CreateProjectModal';
import ProjectCard from '../components/ProjectCard';
import { IconChevronRight } from '@tabler/icons-react';
import { useToast } from '../components/ToastProvider';
export default function DashboardPage(){
 const showToast=useToast();
 const [projects,setProjects]=useState<Project[]>([]);const [loading,setLoading]=useState(true);const [showModal,setShowModal]=useState(false);const [error,setError]=useState('');
 const refreshing=useRef(false);
 const loadProjects=useCallback(async()=>{
  if(refreshing.current)return;
  refreshing.current=true;
  try{setProjects(await api.listProjects());setError('');}
  catch{setError('No se pudieron cargar los proyectos.');}
  finally{refreshing.current=false;setLoading(false);}
 },[]);
 useEffect(()=>{
  void loadProjects();
  const refresh=()=>{if(!document.hidden)void loadProjects();};
  const interval=window.setInterval(refresh,5000);
  document.addEventListener('visibilitychange',refresh);
  return()=>{window.clearInterval(interval);document.removeEventListener('visibilitychange',refresh);};
 },[loadProjects]);
 const corrections=projects.filter(p=>p.status==='corrections');
 return <div className="space-y-6"><header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-semibold">Mis proyectos</h1><p className="mt-2 text-sm text-atlas-muted">Gestiona tus aplicaciones y sigue cada despliegue.</p></div><div className="flex gap-4 items-center"><Link to="/como-desplegar" className="text-sm text-atlas-red hover:underline">Cómo desplegar</Link><button onClick={()=>setShowModal(true)} className="rounded-lg bg-atlas-red px-4 py-2 text-sm text-white">+ Nuevo proyecto</button></div></header>
 {error&&<p role="alert">{error} <button onClick={loadProjects} className="text-atlas-red">Reintentar</button></p>}
 {!!corrections.length&&<section><h2 className="mb-3 text-xl font-semibold">Proyectos por corregir</h2><div className="grid gap-3">{corrections.map(p=><Link to={`/projects/${p.id}`} key={p.id} aria-label={`Corregir ${p.name}`} className="flex w-full items-center justify-between gap-5 rounded-xl border border-amber-300 bg-amber-50 p-5"><span className="min-w-0"><h3 className="font-semibold">{p.name}</h3><p className="mt-0.5 text-sm text-atlas-muted">{(p as DemoProject).observation}</p></span><IconChevronRight size={20} stroke={2} aria-hidden="true" className="shrink-0 text-atlas-red" /></Link>)}</div></section>}
 <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[['Proyectos',projects.length],['Desplegados',projects.filter(p=>p.status==='running').length],[getDemoUser() ? 'CI en curso' : 'Desplegando',projects.filter(p=>['building','ci_pending'].includes(p.status)).length],[getDemoUser() ? 'Validación pendiente' : 'Despliegue pendiente',projects.filter(p=>p.status==='pending').length],['Fallidos',projects.filter(p=>['failed','ci_failed'].includes(p.status)).length]].map(([label,value])=><div className="flex items-center justify-between gap-3 rounded-xl border border-atlas-mist p-4" key={label}><p className="text-xs text-atlas-muted">{label}</p><p className="shrink-0 text-2xl font-semibold">{value}</p></div>)}</div>
 {loading?<p>Cargando…</p>:<><div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{projects.filter(p=>p.status!=='corrections').map(p=><ProjectCard key={p.id} project={p}/>)}</div>{!projects.length&&!error&&<p className="py-12 text-center text-atlas-muted">Tu próximo proyecto empieza aquí. Registra tu repositorio.</p>}<p className="text-xs text-atlas-muted">{projects.length} proyectos en tu espacio de trabajo</p></>}
 <CreateProjectModal open={showModal} onClose={()=>setShowModal(false)} onCreated={()=>{showToast(getDemoUser() ? 'Proyecto enviado a aprobación. Estado: Validación pendiente.' : 'Proyecto creado. El despliegue comenzará automáticamente.');loadProjects();}}/>
 </div>;
}
