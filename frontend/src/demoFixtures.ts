import type { Build } from './api';
import type { DemoProject, ProjectDraft } from './demoProjects';
const rows = [
 ['libros','Recomendador de libros','sarikr/recomendador-libros','running','Sarik Bonadiez','demo-developer'],
 ['reservas','API de reservas de laboratorio','sarikr/lab-reservas-api','building','Sarik Bonadiez','demo-developer'],
 ['portafolio','Portafolio personal','sarikr/portafolio-web','pending','Sarik Bonadiez','demo-developer'],
 ['finanzas','Tracker de finanzas','sarikr/finanzas-tracker','failed','Sarik Bonadiez','demo-developer'],
 ['archivo','Archivo académico','sarikr/archivo-academico','retained','Sarik Bonadiez','demo-developer'],
 ['tutorias','Portal de tutorías','sarikr/portal-tutorias','corrections','Sarik Bonadiez','demo-developer'],
 ['dulce','Landing de repostería Dulce Ana','cherrera/dulce-ana','pending','Camilo Herrera','camilo'],
 ['biblioteca','API de biblioteca','lauramendez/api-biblioteca','pending','Laura Méndez','laura'],
 ['gateway','api-gateway','alejandro-dev/api-gateway','running','alejandro.dev','demo-admin'],
 ['frontend','frontend-web','alejandro-dev/frontend-web','building','alejandro.dev','demo-admin'],
 ['service','mi-service','alejandro-dev/mi-service','pending','alejandro.dev','demo-admin'],
 ['chat','chat-app','maria-dev/chat-app','running','maria.dev','maria'],
 ['blog','blog-platform','juan-dev/blog-platform','ci_failed','juan.dev','juan'],
];
export function seedProjects(): DemoProject[] {
 return rows.map(([id,name,repo,status,owner,ownerId],index) => {
  const submission: ProjectDraft = { name, repo, branch:'main', commit:'8f21a4cb109e7bc43c9a7d1e815bb3d9416a0b14', purpose: id === 'portafolio' ? 'Portafolio funcional para presentar los proyectos desarrollados durante la asignatura.' : id === 'dulce' ? 'Catálogo y pedidos de un emprendimiento vinculado a la comunidad universitaria.' : id === 'biblioteca' ? 'Consultar disponibilidad y gestionar préstamos del catálogo bibliográfico.' : `Aplicación funcional para ${name.toLowerCase()} al servicio de la comunidad universitaria.`, academic:id!=='dulce', course:id==='portafolio'?'Diseño Web II':'Ingeniería de Software', type:name.includes('API')?'API / backend':'Aplicación web', port:3000, build:'Detectar automáticamente' };
  const builds: Build[] = ['running','building','failed','ci_failed'].includes(status) ? [{ id:`build-${id}`,project_id:id,status:status==='running'?'passed':status==='building'?'building':'failed',logs:status==='running'?'[demo] CI superado. Artefacto construido. Despliegue saludable.':status==='building'?'[demo] Repositorio obtenido. Ejecutando pruebas…':status==='ci_failed'?'[demo] Pruebas fallidas. No se inició el despliegue.':'[demo] CI superado. Falló la comprobación de salud del contenedor.',commit_sha:submission.commit,commit_message:'Ajusta configuración de producción',started_at:'2026-09-08T14:30:00Z',completed_at:status==='building'?null:'2026-09-08T14:35:00Z',created_at:'2026-09-08T14:30:00Z'}] : [];
  return { id,name,slug:repo.split('/')[1],repo_url:`https://github.com/${repo}`,branch:'main',status,domain:status==='running'?`${repo.split('/')[1]}.estudiantes.uninorte.local`:null,webhook_url:null,created_at:`2026-09-0${index%7+1}T14:00:00Z`,submission,owner,ownerId,builds,observation:status==='corrections'?'Explica la necesidad académica y presenta un commit con el flujo funcional de reserva.':undefined,history:[{ action:'Proyecto registrado',date:'2026-09-07T14:00:00Z',actor:owner }],retentionUntil:status==='retained'?'2026-09-18':undefined };
 });
}
export const clusterDemo = {
 nodes:5,pods:128,cpu_usage:43,memory_usage:62,
 machines:[['k3s-master',28,45],['k3s-node-1',35,62],['k3s-node-2',40,47],['k3s-node-3',30,47],['k3s-node-4',32,60]] as const,
 cpu:[30,40,25,50,35,60,45,65,52,70,43], memory:[45,50,43,57,48,60,54,65,58,68,62],
};
