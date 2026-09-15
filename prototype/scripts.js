// -----------------------------
  // Atlas — flujo de demostración
  // Login → rol → dashboard → logout
  // -----------------------------

  function go(id){
    // Students cannot enter administration. Administrators may also own projects.
    const role = document.body.dataset.role;
    const adminScreens = ['admin','adminprojects'];
    const studentScreens = ['dashboard','detail'];

    if(role === 'student' && adminScreens.includes(id)) return;

    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });

    const target = document.getElementById(id);
    if(!target){
      if(adminScreens.includes(id)) window.location.href = `admin.html#${id}`;
      if(studentScreens.includes(id)) window.location.href = `developer.html#${id}`;
      return;
    }
    target.classList.add('active');
    if(document.body.dataset.role) addRoleBar();

    window.scrollTo(0,0);
  }

  function loginDemo(){
    const email = document.querySelector('#login input[type="email"]');
    const password = document.querySelector('#login input[type="password"]');
    if(!email.value.trim() || !email.validity.valid){
      showToast('Escribe un correo institucional válido.');
      email.focus();
      return;
    }
    if(password.value.length < 8){
      showToast('La contraseña debe tener al menos 8 caracteres.');
      password.focus();
      return;
    }
    showRoleChooser();
  }

  function showRoleChooser(){
    const existing = document.querySelector('.role-chooser');
    if(existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'role-chooser';
    overlay.innerHTML = `
      <div class="role-chooser-card">
        <span class="demo-kicker">Modo demostración</span>
        <h2>¿Qué experiencia quieres revisar?</h2>
        <p>En la plataforma real, tu rol se detectaría automáticamente desde tu cuenta. Aquí puedes elegir una vista para mostrar los dos flujos de Atlas.</p>
        <div class="role-chooser-grid">
          <button class="role-choice" type="button" aria-label="Continuar como estudiante" onclick="selectRole('student')">
            <div class="ico">01</div>
            <h3>Estudiante</h3>
            <small>Gestiona proyectos, repositorios, builds, logs y despliegues.</small>
          </button>
          <button class="role-choice" type="button" aria-label="Continuar como administrador" onclick="selectRole('admin')">
            <div class="ico">02</div>
            <h3>Administrador</h3>
            <small>Revisa aprobaciones, proyectos y estado del clúster.</small>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function addRoleBar(){
    document.querySelectorAll('.screen.active .sidebar-foot').forEach(footer => {
      const role = document.body.dataset.role;
      const isAdmin = role === 'admin';
      const name = isAdmin ? 'Prof. Daniel Romero' : 'Sarik Bonadiez';
      const label = isAdmin ? 'Administrador' : 'Estudiante';

      footer.innerHTML = `
        <div class="sidebar-account">
          <div class="sidebar-account-row">
            <button class="sidebar-user" type="button" onclick="openProfile(this)" aria-label="Abrir perfil de ${name}">
              <span class="sidebar-user-icon"><i class="ti ti-user" aria-hidden="true"></i></span>
              <span class="sidebar-user-copy">
                <span class="who">${name}</span>
                <span class="sidebar-role">${label}</span>
              </span>
            </button>
            <div class="notification-wrap">
              <button class="notification-btn" type="button" aria-label="Notificaciones" aria-expanded="false" onclick="toggleNotifications(this)"><i class="ti ti-bell" aria-hidden="true"></i><span class="notification-dot"></span></button>
              <div class="notification-panel">
                <div style="font-weight:700;padding:6px 8px 10px;">Notificaciones</div>
                <div class="notification-item">Tu proyecto <b>recomendador-libros</b> fue aprobado.</div>
                <div class="notification-item">Build #42 terminó correctamente.</div>
                <div class="notification-item">El administrador dejó una actualización sobre una solicitud.</div>
              </div>
            </div>
          </div>
          <button class="logout-btn" type="button" onclick="logout()"><i class="ti ti-logout" aria-hidden="true"></i>Cerrar sesión</button>
        </div>
      `;

      const sidebar = footer.closest('.sidebar');
      sidebar?.querySelector('.profile-panel')?.remove();
      const profile = document.createElement('div');
      profile.className = 'profile-panel';
      profile.innerHTML = `
        <div class="profile-panel-head"><span>Mi perfil</span><button type="button" onclick="openProfile(this)" aria-label="Cerrar perfil"><i class="ti ti-x"></i></button></div>
        <div class="profile-avatar"><i class="ti ti-user"></i></div>
        <h3>${name}</h3>
        <p>${isAdmin ? 'daniel.romero@uninorte.edu.co' : 'sarik.bonadiez@uninorte.edu.co'}</p>
        <div class="profile-fact"><span>Rol</span><strong>${label}</strong></div>
        <div class="profile-fact"><span>Institución</span><strong>Universidad del Norte</strong></div>
        <div class="github-profile"><i class="ti ti-brand-github"></i><span><strong>GitHub vinculado</strong><small>${isAdmin ? '@danielromero' : '@sarikr'}</small></span><span class="badge badge-running"><span class="dot"></span>Vinculado</span></div>
        <button class="btn sidebar-github-btn" type="button" onclick="showToast('La cuenta de GitHub ya está vinculada.')">Gestionar vínculo</button>
      `;
      sidebar?.insertBefore(profile, footer);
    });
  }

  function selectRole(role){
    const chooser = document.querySelector('.role-chooser');
    if(chooser) chooser.remove();
    window.location.href = role === 'admin' ? 'admin.html' : 'developer.html';
  }

  function logout(){
    window.location.href = 'index.html';
  }

  // -----------------------------
  // Registro
  // -----------------------------
  function createAccount(){
    const fields = document.querySelectorAll('#register input');
    const email = fields[1];
    const password = fields[2];
    if(!fields[0].value.trim() || !email.value.trim() || !email.validity.valid || !email.value.endsWith('@uninorte.edu.co')){
      showToast('Completa tus datos con un correo @uninorte.edu.co.');
      return;
    }
    if(password.value.length < 8){
      showToast('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    showToast('Cuenta creada correctamente. Ahora inicia sesión.');
    go('login');
  }

  // -----------------------------
  // Nuevo proyecto
  // -----------------------------
  let wizardStep = 1;
  let projectType = 'Web';

  function openModal(){
    if(!['student','admin'].includes(document.body.dataset.role)) return;
    wizardStep = 1;
    document.getElementById('modal').classList.add('active');
    renderWizard();
  }

  function closeModal(){
    document.getElementById('modal').classList.remove('active');
  }

  function renderWizard(){
    document.querySelectorAll('[data-wizard-panel]').forEach(p=>{
      p.classList.toggle('active', Number(p.dataset.wizardPanel) === wizardStep);
    });

    document.querySelectorAll('#wizardSteps .wz-circle').forEach(c=>{
      const n = Number(c.dataset.step);
      c.classList.remove('done','current');
      if(n < wizardStep) c.classList.add('done');
      else if(n === wizardStep) c.classList.add('current');
      c.textContent = n < wizardStep ? '✓' : n;
    });

    document.querySelectorAll('#wizardSteps .wz-label').forEach((l,i)=>{
      l.classList.toggle('current', i + 1 === wizardStep);
    });

    document.getElementById('wizardBack').textContent =
      wizardStep === 1 ? 'Cancelar' : 'Atrás';

    document.getElementById('wizardNext').textContent =
      wizardStep === 3 ? 'Enviar a aprobación' : 'Siguiente';

    if(wizardStep === 3) updateReview();
  }

  function wizardPrev(){
    if(wizardStep === 1){
      closeModal();
      return;
    }
    wizardStep--;
    renderWizard();
  }

  function wizardNext(){
    if(wizardStep === 1 && !document.getElementById('wizName').value.trim()){
      showToast('Escribe un nombre para el proyecto.');
      return;
    }

    if(wizardStep === 1 && !document.getElementById('wizRepo').value){
      showToast('Selecciona un repositorio de GitHub.');
      return;
    }

    if(wizardStep === 1 && !document.getElementById('wizBranch').value){
      showToast('Selecciona una rama del repositorio.');
      return;
    }

    if(wizardStep === 1 && !document.getElementById('wizCommit').value){
      showToast('Selecciona el commit que se presentará para la admisión.');
      return;
    }

    if(wizardStep === 1 && !document.getElementById('wizDescription').value.trim()){
      showToast('Explica el propósito funcional del proyecto.');
      return;
    }

    if(wizardStep === 1 && document.getElementById('wizAcademic').checked && !document.getElementById('wizClass').value){
      showToast('Selecciona la asignatura a la que pertenece el proyecto.');
      return;
    }

    if(wizardStep < 3){
      wizardStep++;
      renderWizard();
      return;
    }

    addProjectToDashboard();
    closeModal();
    showToast('Proyecto enviado a aprobación. Estado: Validación pendiente.');
  }

  function escapeHtml(value){
    return value.replace(/[&<>'"]/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    }[character]));
  }

  function addProjectToDashboard(){
    const catalog = document.querySelector('#dashboard .developer-project-catalog');
    if(!catalog) return;

    const name = document.getElementById('wizName').value.trim();
    const repo = document.getElementById('wizRepo').value.trim();
    const branch = document.getElementById('wizBranch').value.trim() || 'main';
    const safeName = escapeHtml(name);
    const safeRepo = escapeHtml(repo);
    const card = document.createElement('article');
    card.className = 'project-card project-pending';
    card.innerHTML = `<div class="project-card-head action-menu-wrap"><h3 class="proj-name">${safeName}</h3><button type="button" class="row-action-btn" aria-label="Acciones de ${safeName}" onclick="toggleActionMenu(this)">⋮</button><span class="action-menu"><button onclick="actionViewProject()">Ver proyecto</button><button onclick="actionBuilds()">Ver builds</button><button onclick="actionLogs()">Ver logs</button><button onclick="actionDeleteProject()" class="danger">Eliminar proyecto</button></span></div><div class="project-owner project-repo">${safeRepo}</div><span class="badge badge-pending"><span class="dot"></span>Validación pendiente</span><div class="project-build"><span>Solicitud enviada</span><strong>Ahora</strong><small>Rama ${escapeHtml(branch)}</small></div><div class="project-url unavailable">URL aún sin asignar</div>`;
    catalog.prepend(card);

    const count = catalog.querySelectorAll('.project-card').length;
    const countLabel = document.getElementById('studentProjectCount');
    if(countLabel) countLabel.textContent = `Mostrando 1 a ${count} de ${count} proyectos`;
  }

  function toggleClassField(){
    const enabled = document.getElementById('wizAcademic').checked;
    const field = document.getElementById('wizClassField');
    field.hidden = !enabled;
    if(!enabled) document.getElementById('wizClass').value = '';
  }

  function updateRepoBranches(){
    const repo = document.getElementById('wizRepo').value;
    const branch = document.getElementById('wizBranch');
    const branches = repo.includes('portafolio') ? ['main','redesign'] : repo.includes('reservas') ? ['main','develop','staging'] : ['main','develop'];
    branch.innerHTML = repo ? branches.map(name=>`<option value="${name}">${name}</option>`).join('') : '<option value="">Selecciona primero un repositorio</option>';
    branch.disabled = !repo;
    updateCommitOptions();
  }

  function updateCommitOptions(){
    const repo = document.getElementById('wizRepo')?.value;
    const branch = document.getElementById('wizBranch')?.value;
    const commit = document.getElementById('wizCommit');
    if(!commit) return;
    const commits = repo && branch ? [
      ['8f21a4cb109e7bc43c9a7d1e815bb3d9416a0b14','Último · Ajusta configuración de producción · hace 18 min'],
      ['e17b590f7c1a242fb6731da98c545a139a210b2d','Corrige pruebas del servicio · ayer'],
      ['731da20818ac4fd62e02f79bfb2304fc96a46c1a','Versión inicial funcional · hace 3 días']
    ] : [];
    commit.innerHTML = commits.length ? commits.map(([sha,label])=>`<option value="${sha}">${label} · ${sha.slice(0,7)}</option>`).join('') : '<option value="">Selecciona primero un repositorio y una rama</option>';
    commit.disabled = !commits.length;
  }

  function selectType(value){
    projectType = value;
    document.getElementById('typeWeb').classList.toggle('selected', value === 'Web');
    document.getElementById('typeApi').classList.toggle('selected', value === 'API');
  }

  function updateReview(){
    document.getElementById('reviewName').textContent =
      document.getElementById('wizName').value || '—';
    document.getElementById('reviewDescription').textContent =
      document.getElementById('wizDescription').value || '—';
    document.getElementById('reviewClass').textContent = document.getElementById('wizAcademic').checked
      ? document.getElementById('wizClass').value
      : 'No pertenece a una clase';
    document.getElementById('reviewProvider').textContent = 'GitHub vinculado';
    document.getElementById('reviewRepo').textContent =
      document.getElementById('wizRepo').value || '—';
    document.getElementById('reviewBranch').textContent =
      document.getElementById('wizBranch').value || 'main';
    document.getElementById('reviewCommit').textContent =
      document.getElementById('wizCommit').value || '—';
    document.getElementById('reviewType').textContent =
      projectType === 'Web' ? 'Aplicación web' : 'API / backend';
    document.getElementById('reviewPort').textContent =
      document.getElementById('wizPort').value || '3000';
  }

  // -----------------------------
  // Toasts
  // -----------------------------
  function showToast(message){
    const toast = document.getElementById('toast');
    if(!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__atlasToast);
    window.__atlasToast = setTimeout(()=>toast.classList.remove('show'), 2600);
  }

  // -----------------------------
  // Tabs del detalle
  // -----------------------------
  document.addEventListener('click', function(e){
    const tab = e.target.closest('.tab');
    if(!tab) return;

    const name = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach(panel=>{
      panel.classList.remove('active');
    });

    const target = document.getElementById('tab-' + name);
    if(target) target.classList.add('active');
  });

  let approvalDetailTarget = null;
  let correctionsTarget = null;

  function openApprovalDetail(item){
    if(item.classList.contains('decision-complete')) return;
    approvalDetailTarget = item;
    const fields = {
      approvalDetailTitle: item.dataset.project,
      approvalOwner: item.dataset.owner,
      approvalRepo: item.dataset.repo,
      approvalBranch: item.dataset.branch,
      approvalSha: item.dataset.sha,
      approvalType: item.dataset.type,
      approvalCourse: item.dataset.course,
      approvalPurpose: item.dataset.purpose
    };
    Object.entries(fields).forEach(([id,value])=>{ const element=document.getElementById(id); if(element) element.textContent=value; });
    document.getElementById('approvalDetailModal')?.classList.add('active');
  }

  function closeApprovalDetail(){
    document.getElementById('approvalDetailModal')?.classList.remove('active');
  }

  function requestCorrectionsFromDetail(){
    const target = approvalDetailTarget;
    closeApprovalDetail();
    if(target) openCorrectionsModal(target);
  }

  function openValidationConfirmation(){
    if(!approvalDetailTarget) return;
    const expected = approvalDetailTarget.dataset.repo;
    document.getElementById('validationExpected').textContent = expected;
    document.getElementById('validationText').value = '';
    document.getElementById('validationError').textContent = '';
    closeApprovalDetail();
    document.getElementById('validationModal')?.classList.add('active');
    document.getElementById('validationText')?.focus();
  }

  function closeValidationConfirmation(){
    document.getElementById('validationModal')?.classList.remove('active');
  }

  function confirmValidation(){
    const expected = approvalDetailTarget?.dataset.repo || '';
    const input = document.getElementById('validationText');
    const error = document.getElementById('validationError');
    if(input?.value.trim() !== expected){
      if(error) error.textContent = `Escribe exactamente ${expected}.`;
      input?.focus();
      return;
    }
    document.getElementById('validationModal')?.classList.remove('active');
    approvalDetailTarget?.classList.add('decision-complete');
    const action = approvalDetailTarget?.querySelector('.approval-open');
    if(action) action.textContent = 'Proyecto validado';
    showToast('Proyecto validado. El primer proceso técnico ha comenzado.');
    approvalDetailTarget = null;
  }

  function openCorrectionsModal(source){
    correctionsTarget = source.closest('.approval-item');
    const project = correctionsTarget?.dataset.project || 'este proyecto';
    const modal = document.getElementById('correctionsModal');
    const description = document.getElementById('correctionsProject');
    const text = document.getElementById('correctionsText');
    const error = document.getElementById('correctionsError');
    if(description) description.textContent = `Indica qué debe corregirse en “${project}” antes de volver a presentarlo.`;
    if(text) text.value = '';
    if(error) error.textContent = '';
    modal?.classList.add('active');
    text?.focus();
  }

  function closeCorrectionsModal(){
    document.getElementById('correctionsModal')?.classList.remove('active');
    correctionsTarget = null;
  }

  function submitCorrections(){
    const text = document.getElementById('correctionsText');
    const error = document.getElementById('correctionsError');
    if(!text?.value.trim()){
      if(error) error.textContent = 'Debes explicar las correcciones requeridas.';
      text?.focus();
      return;
    }
    correctionsTarget?.querySelectorAll('.actions .btn').forEach(button => { button.disabled = true; });
    correctionsTarget?.classList.add('decision-complete');
    const action = correctionsTarget?.querySelector('.approval-open');
    if(action) action.textContent = 'Correcciones solicitadas';
    document.getElementById('correctionsModal')?.classList.remove('active');
    showToast('Correcciones solicitadas. Estado: Correcciones pendientes.');
    correctionsTarget = null;
    approvalDetailTarget = null;
  }

  let developerCorrectionTarget = null;
  function openDeveloperCorrection(source){
    developerCorrectionTarget = source;
    document.getElementById('developerCorrectionTitle').textContent = source.dataset.project;
    document.getElementById('developerCorrectionObservation').textContent = source.dataset.observation;
    document.getElementById('developerCorrectionModal')?.classList.add('active');
  }

  function closeDeveloperCorrection(){
    document.getElementById('developerCorrectionModal')?.classList.remove('active');
    developerCorrectionTarget = null;
  }

  function submitDeveloperCorrection(){
    const purpose = document.getElementById('developerCorrectionPurpose')?.value.trim();
    if(!purpose){ showToast('Escribe el propósito funcional corregido.'); return; }
    developerCorrectionTarget?.remove();
    document.getElementById('developerCorrectionModal')?.classList.remove('active');
    showToast('Nueva solicitud enviada. Estado: Validación pendiente.');
    developerCorrectionTarget = null;
  }

  // Estado inicial según la entrada del prototipo.
  document.querySelectorAll('.screen').forEach(screen=>screen.classList.remove('active'));
  const page = document.body.dataset.page || 'auth';
  if(page === 'developer' && new URLSearchParams(window.location.search).get('as') === 'admin'){
    document.body.dataset.role = 'admin';
  }
  const defaultScreen = page === 'developer' ? 'dashboard' : page === 'admin' ? 'admin' : 'login';
  const requestedScreen = window.location.hash.slice(1);
  const initialScreen = document.getElementById(requestedScreen) ? requestedScreen : defaultScreen;
  const initialTarget = document.getElementById(initialScreen);
  if(initialTarget) initialTarget.classList.add('active');
  if(page !== 'auth') addRoleBar();

  // Cambiar los botones de autenticación del prototipo.
  const loginButton = document.querySelector('#login .btn-primary');
  if(loginButton) loginButton.onclick = loginDemo;

  const microsoftButton = document.querySelector('#login .btn-microsoft');
  if(microsoftButton) microsoftButton.onclick = showRoleChooser;

  const registerButton = document.querySelector('#register .btn-primary');
  if(registerButton) registerButton.onclick = createAccount;

  function toggleNotifications(source){
    const panel = source?.closest('.notification-wrap')?.querySelector('.notification-panel');
    if(!panel) return;

    document.querySelectorAll('.notification-panel.show').forEach(openPanel => {
      if(openPanel !== panel) openPanel.classList.remove('show');
    });

    const isOpen = panel.classList.toggle('show');
    source.setAttribute('aria-expanded', String(isOpen));
  }

  function openProfile(source){
    const sidebar = source?.closest('.sidebar');
    const panel = sidebar?.querySelector('.profile-panel');
    if(!panel) return;
    sidebar.querySelectorAll('.notification-panel.show').forEach(item=>item.classList.remove('show'));
    panel.classList.toggle('show');
  }

  function filterAdminProjects(filter, source){
    document.querySelectorAll('#adminprojects .filter-chip').forEach(chip => chip.classList.remove('active'));
    if(source) source.classList.add('active');

    document.querySelectorAll('#adminprojects .project-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      const matches = filter === 'all'
        || (filter === 'running' && text.includes('desplegado'))
        || (filter === 'building' && text.includes('ci en ejecución'))
        || (filter === 'pending' && text.includes('validación pendiente'))
        || (filter === 'error' && (text.includes('ci fallido') || text.includes('despliegue fallido')));
      card.style.display = matches ? '' : 'none';
    });
  }

  function showEmptyProjects(){
    showToast('No tienes proyectos todavía. Crea tu primer proyecto.');
  }

  function editProjectConfig(){
    const panel=document.getElementById('configEditor');
    if(panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  function saveProjectConfig(){
    const name=document.getElementById('editName')?.value.trim() || 'recomendador-libros';
    const branch=document.getElementById('editBranch')?.value || 'main';
    const heading=document.querySelector('#detail .title-row h1');
    if(heading) heading.textContent=name;
    showToast(`Configuración guardada: ${name}, rama ${branch}.`);
    const panel=document.getElementById('configEditor');
    if(panel) panel.style.display='none';
  }

  function checkSubdomain(){
    const value=document.getElementById('editSubdomain')?.value.trim() || '';
    if(!/^(?!-)[a-z0-9-]{3,20}(?<!-)$/.test(value) || ['admin','api','auth','www','status'].includes(value)){
      showToast('El subdominio no cumple las reglas o está reservado.');
      return;
    }
    showToast(`${value}.estudiantes.uninorte.local está disponible.`);
  }

  function openRetainedProject(){
    go('detail');
    const heading=document.querySelector('#detail .title-row h1');
    if(heading) heading.textContent='archivo-academico';
    const badge=document.querySelector('#detail .title-row .badge');
    if(badge){ badge.className='badge badge-building'; badge.innerHTML='<span class="dot"></span>Retenido'; }
    document.querySelectorAll('#detail .tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.tab==='retention'));
    document.querySelectorAll('#detail .tab-panel').forEach(panel=>panel.classList.remove('active'));
    document.getElementById('tab-retention')?.classList.add('active');
  }

  function openBuildLogs(execution){
    document.querySelectorAll('#detail .tab').forEach(tab=>tab.classList.toggle('active', tab.dataset.tab === 'logs'));
    document.querySelectorAll('#detail .tab-panel').forEach(panel=>panel.classList.remove('active'));
    document.getElementById('tab-logs')?.classList.add('active');
    const title=document.getElementById('logsTitle');
    if(title) title.textContent=`Diagnóstico de la ejecución ${execution}`;
    window.scrollTo(0,0);
  }

  function resubmitRejected(){
    showToast('Proyecto reenviado a aprobación.');
  }

  function simulateBuildLimit(){
    showToast('Límite de builds alcanzado: máximo 5 por hora.');
  }

  function actionMenuDemo(){
    showToast('Demo: aquí iría el menú de acciones.');
  }

  function openAudit(){
    const list=document.getElementById('auditList');
    const button=document.getElementById('auditToggle');
    if(!list || !button) return;
    const willHide=!list.hidden;
    list.hidden=willHide;
    button.setAttribute('aria-expanded', String(!willHide));
    button.setAttribute('aria-label', willHide ? 'Mostrar historial' : 'Ocultar historial');
    button.title=willHide ? 'Mostrar historial' : 'Ocultar historial';
    button.innerHTML=`<i class="ti ${willHide ? 'ti-eye-off' : 'ti-eye'}" aria-hidden="true"></i>`;
  }

  function closeActionMenus(){
    document.querySelectorAll('.action-menu.show').forEach(m=>m.classList.remove('show'));
  }

  function toggleActionMenu(source){
    let menu = null;
    if(typeof source === 'string'){
      menu = document.getElementById(source);
    }else if(source && source.closest){
      menu = source.closest('.action-menu-wrap')?.querySelector('.action-menu');
    }
    if(!menu) return;

    const wasOpen=menu.classList.contains('show');
    closeActionMenus();
    if(!wasOpen) menu.classList.add('show');
  }

  document.addEventListener('click', function(e){
    if(!e.target.closest('.action-menu-wrap')) closeActionMenus();
  });


  function currentActionProject(){
    const open=document.querySelector('.action-menu.show');
    const row=open ? open.closest('.project-card, tr') : null;
    if(row) return row.querySelector('.proj-name')?.textContent.trim() || 'proyecto';
    return document.querySelector('#detail.active .title-row h1')?.textContent.trim() || 'proyecto';
  }

  function currentActionRepo(){
    const open=document.querySelector('.action-menu.show');
    const card=open?.closest('.project-card');
    const explicit=card?.dataset.repo || card?.querySelector('.project-repo')?.textContent.trim().replace(/^github\.com\//,'');
    if(explicit) return explicit;
    if(card){
      const owner=card.querySelector('.project-owner')?.textContent.trim() || 'propietario';
      const name=card.querySelector('.proj-name')?.textContent.trim().toLowerCase().replace(/\s+/g,'-') || 'proyecto';
      return `${owner}/${name}`;
    }
    return 'sarikr/recomendador-libros';
  }

  function actionViewProject(){
    const project=currentActionProject();
    closeActionMenus();
    showToast(`Demo: abriendo ${project}.`);
  }

  function actionBuilds(){
    const project=currentActionProject();
    closeActionMenus();
    showToast(`Builds de ${project}: abriendo historial.`);
  }

  function actionLogs(){
    const project=currentActionProject();
    closeActionMenus();
    showToast(`Logs de ${project}: abriendo registros.`);
  }

  function actionUrl(){
    const project=currentActionProject();
    closeActionMenus();
    showToast(`Demo: abriendo la URL pública de ${project}.`);
  }

  function actionRetryBuild(){
    const project=currentActionProject();
    closeActionMenus();
    showToast(`Build de ${project} reintentado. Estado: CI en ejecución.`);
  }

  let deletionProject='';
  let deletionRepo='';
  let deletionCard=null;
  function actionDeleteProject(){
    deletionCard=document.querySelector('.action-menu.show')?.closest('.project-card') || null;
    deletionProject=currentActionProject();
    deletionRepo=currentActionRepo();
    closeActionMenus();
    if(document.body.dataset.role==='admin' && document.body.dataset.page==='admin'){
      document.getElementById('adminDeleteTitle').textContent=`Solicitar eliminación de ${deletionProject}`;
      document.getElementById('adminDeleteExpected').textContent=deletionRepo;
      document.getElementById('adminDeleteText').value='';
      document.getElementById('adminDeleteReason').value='';
      document.getElementById('adminDeleteError').textContent='';
      document.getElementById('adminDeleteModal')?.classList.add('active');
      return;
    }
    document.getElementById('voluntaryDeleteTitle').textContent=`Eliminar ${deletionProject}`;
    document.getElementById('voluntaryDeleteExpected').textContent=deletionRepo;
    document.getElementById('voluntaryDeleteText').value='';
    document.getElementById('voluntaryDeleteError').textContent='';
    document.querySelectorAll('input[name="deleteReason"]').forEach(item=>item.checked=false);
    document.getElementById('voluntaryDeleteModal')?.classList.add('active');
  }

  function closeVoluntaryDelete(){ document.getElementById('voluntaryDeleteModal')?.classList.remove('active'); }
  function confirmVoluntaryDelete(){
    const input=document.getElementById('voluntaryDeleteText');
    const error=document.getElementById('voluntaryDeleteError');
    if(!document.querySelector('input[name="deleteReason"]:checked')){ error.textContent='Selecciona al menos un motivo.'; return; }
    if(input.value.trim()!==deletionRepo){ error.textContent=`Escribe exactamente ${deletionRepo}.`; return; }
    closeVoluntaryDelete();
    showToast(`${deletionProject}: aplicación detenida. Retención iniciada por 15 días.`);
    openRetainedProject();
  }

  function closeAdminDelete(){ document.getElementById('adminDeleteModal')?.classList.remove('active'); }
  function confirmAdminDelete(){
    const reason=document.getElementById('adminDeleteReason');
    const input=document.getElementById('adminDeleteText');
    const error=document.getElementById('adminDeleteError');
    if(!reason.value.trim()){ error.textContent='El motivo administrativo es obligatorio.'; return; }
    if(input.value.trim()!==deletionRepo){ error.textContent=`Escribe exactamente ${deletionRepo}.`; return; }
    const deadline=document.getElementById('adminDeleteDeadline').value;
    const retention=document.getElementById('adminDeleteRetention').value;
    if(deletionCard){
      deletionCard.className='project-card project-building';
      const badge=deletionCard.querySelector('.badge');
      if(badge){ badge.className='badge badge-building'; badge.innerHTML='<span class="dot"></span>Eliminación solicitada'; }
      const build=deletionCard.querySelector('.project-build');
      if(build) build.innerHTML=`<span>Plazo para responder</span><strong>${deadline} días</strong><small>Retención posterior: ${retention} días</small>`;
    }
    closeAdminDelete();
    showToast(`Solicitud creada: ${deadline} días para responder y ${retention} días de retención posterior.`);
  }

