import { supabase } from '../services/supabase.js';

export function renderSuperAdmin(targetContainer) {
  const container = targetContainer || document.getElementById('app');

  // Inicializar tema del panel Super-Admin (dark o light)
  const savedTheme = localStorage.getItem('superadmin_theme');
  const currentAdminTheme = (savedTheme === 'dark') ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentAdminTheme);
  document.body.setAttribute('data-theme', currentAdminTheme);

  let stores = [];
  let stats = {
    totalStores: 0,
    activeStores: 0,
    projectedRevenue: 0,
    totalOrders: 0
  };

  const loadData = async () => {
    // 1. Obtener comercios
    const { data: comercios, error: errComercios } = await supabase
      .from('comercios')
      .select('*')
      .order('created_at', { ascending: false });

    if (!errComercios && comercios) {
      stores = comercios;
      stats.totalStores = stores.length;
      stats.activeStores = stores.filter(s => s.activo !== false).length;
      stats.projectedRevenue = stats.activeStores * 35000;
    }

    // 2. Obtener conteo de pedidos globales si la tabla existe
    try {
      const { count } = await supabase
        .from('pedidos')
        .select('*', { count: 'exact', head: true });
      stats.totalOrders = count || 0;
    } catch (e) {
      stats.totalOrders = 0;
    }

    renderUI();
  };

  const toggleStoreStatus = async (id, currentStatus) => {
    const newStatus = Boolean(!currentStatus);
    try {
      const { error } = await supabase
        .from('comercios')
        .update({ activo: newStatus })
        .eq('id', id);

      if (error) {
        console.warn("Columna 'activo' no presente en el esquema de comercios:", error.message);
        alert('Información: El estado se gestiona a nivel de servicio. Detalle: ' + error.message);
      } else {
        await loadData();
      }
    } catch (err) {
      console.error("Excepción al actualizar estado:", err);
    }
  };

  const openNewStoreModal = () => {
    const modal = document.getElementById('new-store-modal');
    if (modal) modal.style.display = 'flex';
  };

  const closeNewStoreModal = () => {
    const modal = document.getElementById('new-store-modal');
    if (modal) modal.style.display = 'none';
  };

  const handleCreateStore = async (e) => {
    e.preventDefault();
    const form = e.target;
    const nombre = form.nombre.value.trim();
    const slug = form.slug.value.trim().toLowerCase().replace(/\s+/g, '-');
    const whatsapp = form.whatsapp.value.trim();
    const pin = form.pin.value.trim();
    const temaRaw = form.tema?.value;
    const tema = (temaRaw === 'light') ? 'light' : 'dark';

    if (!nombre || !slug || !pin) {
      alert('Por favor completa todos los campos requeridos.');
      return;
    }

    const nuevoComercio = {
      nombre: nombre.trim(),
      slug: slug.trim().toLowerCase(),
      whatsapp: whatsapp.trim(),
      pin: pin.trim(),
      tema: tema
    };

    try {
      const { data, error } = await supabase
        .from('comercios')
        .insert([nuevoComercio])
        .select();

      if (error) {
        console.error("Error detallado de Supabase al insertar comercio:", error.message, error.details, error.hint);
        alert("Error al registrar: " + error.message);
        return;
      }

      form.reset();
      closeNewStoreModal();
      await loadData();
    } catch (err) {
      console.error("Excepción inesperada al crear comercio:", err);
      alert("Error al registrar comercio: " + (err.message || "Error desconocido"));
    }
  };

  // Estado para el modal de edición
  let currentEditingStore = null;
  let currentDeletingStore = null;

  const openEditStoreModal = (store) => {
    currentEditingStore = store;
    const modal = document.getElementById('edit-store-modal');
    if (!modal) return;

    const form = document.getElementById('form-edit-store');
    if (form) {
      form.nombre.value = store.nombre || '';
      form.slug.value = store.slug || '';
      form.whatsapp.value = store.whatsapp || '';
      form.pin.value = store.pin || store.pin_admin || store.pin_owner || '';
      form.descripcion.value = store.descripcion || '';
      if (form.tema) form.tema.value = (store.tema === 'light') ? 'light' : 'dark';
    }
    modal.style.display = 'flex';
  };

  const closeEditStoreModal = () => {
    currentEditingStore = null;
    const modal = document.getElementById('edit-store-modal');
    if (modal) modal.style.display = 'none';
  };

  const handleUpdateStore = async (e) => {
    e.preventDefault();
    if (!currentEditingStore) return;

    const form = e.target;
    const nuevoNombre = form.nombre.value.trim();
    const nuevoWhatsapp = form.whatsapp.value.trim();
    const nuevoPin = form.pin.value.trim();
    const nuevaDesc = form.descripcion.value.trim();
    const nuevoTemaRaw = form.tema?.value || currentEditingStore.tema;
    const nuevoTema = (nuevoTemaRaw === 'light') ? 'light' : 'dark';

    if (!nuevoNombre || !nuevoPin) {
      alert('El nombre y el PIN son obligatorios.');
      return;
    }

    try {
      const updatePayload = {
        nombre: nuevoNombre,
        whatsapp: nuevoWhatsapp,
        pin: nuevoPin,
        tema: nuevoTema
      };

      if (nuevaDesc) updatePayload.descripcion = nuevaDesc;

      let { error } = await supabase
        .from('comercios')
        .update(updatePayload)
        .eq('slug', currentEditingStore.slug);

      if (error && error.message && error.message.includes('descripcion')) {
        delete updatePayload.descripcion;
        const retry = await supabase
          .from('comercios')
          .update(updatePayload)
          .eq('slug', currentEditingStore.slug);
        error = retry.error;
      }

      if (error) {
        console.error("Error al actualizar comercio:", error);
        alert("Error al actualizar: " + error.message);
        return;
      }

      closeEditStoreModal();
      await loadData();
    } catch (err) {
      console.error("Excepción al actualizar comercio:", err);
      alert("Error al actualizar comercio: " + (err.message || 'Error desconocido'));
    }
  };

  const updateStoreTheme = async (slug, newTheme) => {
    try {
      const { error } = await supabase
        .from('comercios')
        .update({ tema: newTheme })
        .eq('slug', slug);

      if (error) {
        console.error("Error al actualizar tema del comercio:", error);
        showToast("Error al guardar estilo: " + error.message);
        return;
      }

      const st = stores.find(s => s.slug === slug);
      if (st) st.tema = newTheme;

      const validTheme = (newTheme === 'light') ? 'light' : 'dark';
      const themeLabels = {
        dark: '🌙 Gourmet Dark',
        light: '☀️ Clean Light'
      };
      showToast(`Estilo ${themeLabels[validTheme] || validTheme} activado`);
    } catch (err) {
      console.error("Excepción al cambiar tema:", err);
      showToast("Error al cambiar estilo");
    }
  };

  const openDeleteModal = (store) => {
    currentDeletingStore = store;
    const modal = document.getElementById('delete-store-modal');
    const storeNameEl = document.getElementById('delete-store-name');
    if (storeNameEl) storeNameEl.textContent = store.nombre;
    if (modal) modal.style.display = 'flex';
  };

  const closeDeleteModal = () => {
    currentDeletingStore = null;
    const modal = document.getElementById('delete-store-modal');
    if (modal) modal.style.display = 'none';
  };

  const confirmDeleteStore = async () => {
    if (!currentDeletingStore) return;
    const targetSlug = currentDeletingStore.slug;
    const targetId = currentDeletingStore.id;

    try {
      try {
        await supabase.from('productos').delete().eq('slug_comercio', targetSlug);
      } catch (e) {
        console.warn("Borrado secundario de productos:", e);
      }
      if (targetId) {
        try {
          await supabase.from('productos').delete().eq('comercio_id', targetId);
        } catch (e) {}
      }

      try {
        await supabase.from('pedidos').delete().eq('slug_comercio', targetSlug);
      } catch (e) {}
      if (targetId) {
        try {
          await supabase.from('pedidos').delete().eq('comercio_id', targetId);
        } catch (e) {}
      }

      const { error } = await supabase
        .from('comercios')
        .delete()
        .eq('slug', targetSlug);

      if (error) {
        console.error("Error al eliminar comercio:", error);
        alert("Error al eliminar comercio: " + error.message);
        return;
      }

      closeDeleteModal();
      await loadData();
    } catch (err) {
      console.error("Excepción al eliminar comercio:", err);
      alert("Error inesperado al eliminar: " + (err.message || 'Error desconocido'));
    }
  };

  // Estado de filtros y visualización
  let searchTerm = '';
  let statusFilter = 'all'; // 'all' | 'active' | 'paused'
  let pinVisibilityState = {}; // { [slug]: boolean }

  const getInitials = (name) => {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const getAvatarColor = (name) => {
    const palette = [
      { bg: 'rgba(79, 70, 229, 0.12)', text: '#4F46E5', border: 'rgba(79, 70, 229, 0.25)' }, // Indigo
      { bg: 'rgba(16, 185, 129, 0.12)', text: '#059669', border: 'rgba(16, 185, 129, 0.25)' }, // Emerald
      { bg: 'rgba(59, 130, 246, 0.12)', text: '#2563EB', border: 'rgba(59, 130, 246, 0.25)' }, // Blue
      { bg: 'rgba(147, 51, 234, 0.12)', text: '#9333EA', border: 'rgba(147, 51, 234, 0.25)' }, // Purple
      { bg: 'rgba(234, 88, 12, 0.12)', text: '#EA580C', border: 'rgba(234, 88, 12, 0.25)' },  // Orange
      { bg: 'rgba(219, 39, 119, 0.12)', text: '#DB2777', border: 'rgba(219, 39, 119, 0.25)' }, // Pink
      { bg: 'rgba(13, 148, 136, 0.12)', text: '#0D9488', border: 'rgba(13, 148, 136, 0.25)' }  // Teal
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const idx = Math.abs(hash) % palette.length;
    return palette[idx];
  };

  const getFilteredStores = () => {
    return stores.filter(store => {
      const q = searchTerm.trim().toLowerCase();
      const matchesSearch = !q ||
        (store.nombre && store.nombre.toLowerCase().includes(q)) ||
        (store.slug && store.slug.toLowerCase().includes(q));

      const isActive = store.activo !== false;
      let matchesStatus = true;
      if (statusFilter === 'active') matchesStatus = isActive;
      else if (statusFilter === 'paused') matchesStatus = !isActive;

      return matchesSearch && matchesStatus;
    });
  };

  const renderUI = () => {
    const allActive = stats.totalStores > 0 && stats.activeStores === stats.totalStores;
    const chipText = allActive ? '100% operativos' : `${stats.activeStores} operativos`;
    const chipBg = allActive ? 'var(--sa-success-light)' : 'var(--sa-warning-light)';
    const chipColor = allActive ? 'var(--sa-success-text)' : 'var(--sa-warning-text)';

    container.innerHTML = `
      <div class="superadmin-wrapper w-full min-h-screen">
        <div class="superadmin-container max-w-7xl mx-auto px-6 py-8" style="max-width: 80rem; width: 100%; margin: 0 auto; padding: 2rem 1.5rem;">
        
        <!-- Header Principal Super-Admin -->
        <header class="w-full flex flex-col md:flex-row justify-between items-start md:items-center mb-8 pb-6 border-b gap-4" style="border-bottom: 1px solid var(--sa-border); padding-bottom: 1.5rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <h1 style="font-size: 1.75rem; font-weight: 700; letter-spacing: -0.02em; color: var(--sa-text-primary); margin: 0; line-height: 1.2;">
                Panel Super-Administrador
              </h1>
              <span class="badge" style="background: var(--sa-primary-light); color: var(--sa-primary); font-size: 11px; font-weight: 700; padding: 0.2rem 0.55rem; border-radius: var(--sa-radius-badge); letter-spacing: 0.05em; text-transform: uppercase;">
                SUPER-ADMIN
              </span>
            </div>
            <p style="color: var(--sa-text-muted); font-size: 0.875rem; margin-top: 0.25rem; font-weight: 400;">
              Control y supervisión multi-comercio centralizada
            </p>
          </div>
          
          <div style="display: flex; gap: 0.65rem; align-items: center; flex-wrap: wrap;">
            <!-- Selector de Tema Super-Admin (Compacto) -->
            <div style="display: inline-flex; align-items: center; gap: 0.4rem; background: var(--sa-bg-card); padding: 0.3rem 0.65rem; border: 1px solid var(--sa-border); border-radius: var(--sa-radius-button); box-shadow: var(--sa-shadow-card);">
              <i data-lucide="palette" style="width: 14px; height: 14px; color: var(--sa-primary);"></i>
              <select id="superadmin-theme-switcher" class="sa-select" style="border: none; padding: 0.15rem 0.35rem; font-size: 0.8rem; font-weight: 600; background: transparent; cursor: pointer; color: var(--sa-text-primary);" aria-label="Cambiar tema visual del panel">
                <option value="light" ${currentAdminTheme === 'light' ? 'selected' : ''}>☀️ Clean Light</option>
                <option value="dark" ${currentAdminTheme === 'dark' ? 'selected' : ''}>🌙 Gourmet Dark</option>
              </select>
            </div>

            <!-- Botón Secundario Outline: Ver App Pública -->
            <a href="/" class="sa-btn-outline" title="Abrir la aplicación pública" aria-label="Abrir aplicación pública">
              <i data-lucide="external-link" style="width: 15px; height: 15px;"></i>
              <span>Ver App Pública</span>
            </a>

            <!-- Botón Primario Índigo: Nuevo Comercio -->
            <button id="btn-new-store" class="sa-btn-primary" aria-label="Registrar nuevo comercio">
              <i data-lucide="plus" style="width: 16px; height: 16px;"></i>
              <span>Nuevo Comercio</span>
            </button>
          </div>
        </header>

        <!-- Tarjetas de Métricas (3) Tintadas & Hover Leve -->
        <div class="superadmin-kpi-grid">
          
          <!-- KPI 1: Comercios Registrados -->
          <div class="sa-card sa-card-hoverable" style="padding: 1.25rem 1.5rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(79, 70, 229, 0.1); color: #4F46E5; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i data-lucide="store" style="width: 20px; height: 20px;"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
              <p style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sa-text-muted); margin: 0;">
                Comercios Registrados
              </p>
              <div style="display: flex; align-items: baseline; gap: 0.5rem; margin-top: 0.2rem;">
                <h3 style="font-size: 32px; font-weight: 700; color: var(--sa-text-primary); line-height: 1; margin: 0;">
                  ${stats.totalStores}
                </h3>
                <span class="badge" style="background: ${chipBg}; color: ${chipColor}; font-size: 11px; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: var(--sa-radius-badge); border: 1px solid ${allActive ? 'var(--sa-success-border)' : 'var(--sa-warning-border)'};">
                  ${chipText}
                </span>
              </div>
            </div>
          </div>

          <!-- KPI 2: Abono Mensual Proyectado -->
          <div class="sa-card sa-card-hoverable" style="padding: 1.25rem 1.5rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(16, 185, 129, 0.1); color: #10B981; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i data-lucide="credit-card" style="width: 20px; height: 20px;"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
              <p style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sa-text-muted); margin: 0;">
                Abono Mensual Proyectado
              </p>
              <div style="display: flex; align-items: baseline; gap: 0.4rem; margin-top: 0.2rem;">
                <h3 style="font-size: 32px; font-weight: 700; color: var(--sa-text-primary); line-height: 1; margin: 0;">
                  $${(stats.totalStores * 35000).toLocaleString('es-AR')}
                </h3>
                <span style="font-size: 12px; font-weight: 500; color: var(--sa-text-muted);">
                  / mes est.
                </span>
              </div>
            </div>
          </div>

          <!-- KPI 3: Pedidos Globales -->
          <div class="sa-card sa-card-hoverable" style="padding: 1.25rem 1.5rem; display: flex; align-items: center; gap: 1rem;">
            <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(147, 51, 234, 0.1); color: #9333EA; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i data-lucide="shopping-bag" style="width: 20px; height: 20px;"></i>
            </div>
            <div style="flex: 1; min-width: 0;">
              <p style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sa-text-muted); margin: 0;">
                Pedidos Globales
              </p>
              <div style="display: flex; align-items: baseline; gap: 0.4rem; margin-top: 0.2rem;">
                <h3 style="font-size: 32px; font-weight: 700; color: var(--sa-text-primary); line-height: 1; margin: 0;">
                  ${stats.totalOrders}
                </h3>
                <span style="font-size: 12px; font-weight: 500; color: var(--sa-text-muted);">
                  en toda la red
                </span>
              </div>
            </div>
          </div>

        </div>

        <!-- Tabla / Listado de Comercios Gastronómicos -->
        <div class="sa-card" style="padding: 0; overflow: visible; margin-bottom: 2.5rem;">
          
          <!-- Barra de Herramientas Superior (Título + Buscador + Filtro Estado) -->
          <div style="padding: 1.15rem 1.5rem; border-bottom: 1px solid var(--sa-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.65rem;">
              <div style="width: 32px; height: 32px; border-radius: 8px; background: var(--sa-primary-light); color: var(--sa-primary); display: flex; align-items: center; justify-content: center;">
                <i data-lucide="building-2" style="width: 18px; height: 18px;"></i>
              </div>
              <h2 style="font-size: 1.15rem; font-weight: 700; color: var(--sa-text-primary); margin: 0; letter-spacing: -0.01em;">
                Red de Locales Gastronómicos
              </h2>
              <span id="sa-total-stores-badge" class="badge" style="background: var(--sa-bg-subtle); color: var(--sa-text-secondary); font-size: 11px; font-weight: 600; padding: 0.2rem 0.55rem; border-radius: var(--sa-radius-badge); border: 1px solid var(--sa-border);">
                ${stores.length} locales
              </span>
            </div>

            <!-- Buscador y Filtro por Estado -->
            <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
              <!-- Buscador -->
              <div style="position: relative; width: 230px;">
                <i data-lucide="search" style="position: absolute; left: 0.65rem; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--sa-text-muted); pointer-events: none;"></i>
                <input type="text" id="sa-search-input" placeholder="Buscar por nombre o slug..." class="sa-input" style="padding-left: 2.1rem; width: 100%; height: 36px; font-size: 0.8rem;" value="${searchTerm}" aria-label="Buscar comercio por nombre o slug">
              </div>

              <!-- Filtro Estado -->
              <select id="sa-filter-status" class="sa-select" style="height: 36px; font-size: 0.8rem; font-weight: 600;" aria-label="Filtrar por estado operativo">
                <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos los estados</option>
                <option value="active" ${statusFilter === 'active' ? 'selected' : ''}>🟢 Solo operativos</option>
                <option value="paused" ${statusFilter === 'paused' ? 'selected' : ''}>🟡 Solo pausados</option>
              </select>
            </div>
          </div>

          <!-- Contenedor con Tabla de Cabecera Sticky -->
          <div class="superadmin-table-container">
            <table class="sa-table" id="sa-stores-table">
              <thead>
                <tr>
                  <th style="width: 24%;">Comercio</th>
                  <th style="width: 15%;">Slug</th>
                  <th style="width: 16%;">WhatsApp</th>
                  <th style="width: 10%; text-align: center;">PIN</th>
                  <th style="width: 13%;">Estilo</th>
                  <th style="width: 12%;">Estado</th>
                  <th style="width: 10%; text-align: right;">Acciones</th>
                </tr>
              </thead>
              <tbody id="sa-table-body">
                <!-- Se inyecta dinámicamente con renderTableRows() -->
              </tbody>
            </table>
          </div>

          <!-- Pie de Tabla con Paginación / Conteo -->
          <div style="padding: 0.85rem 1.5rem; border-top: 1px solid var(--sa-border); display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--sa-text-muted); background: var(--sa-bg-card); border-bottom-left-radius: var(--sa-radius-card); border-bottom-right-radius: var(--sa-radius-card);">
            <span id="sa-table-footer-count">Mostrando 0 de 0 comercios</span>
            <span style="font-weight: 500;">Plataforma GastroPWA Multi-Comercio</span>
          </div>

        </div>

        <!-- Modal para Nuevo Comercio -->
        <div id="new-store-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content sa-card" style="max-width: 520px; padding: 0;">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--sa-border); display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="plus-circle" style="color: var(--sa-primary);"></i>
                <h3 style="font-weight: 700; margin: 0; font-size: 1.1rem; color: var(--sa-text-primary);">Registrar Nuevo Comercio</h3>
              </div>
              <button id="btn-close-modal" class="sa-icon-btn" style="border: none;" aria-label="Cerrar modal">
                <i data-lucide="x" style="width: 16px; height: 16px;"></i>
              </button>
            </div>

            <form id="form-create-store" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.15rem;">
              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Nombre del Establecimiento *</label>
                <input class="sa-input" type="text" name="nombre" placeholder="Ej: Burger House Premium" required style="width: 100%;">
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Slug URL único * (identificador web)</label>
                <input class="sa-input" type="text" name="slug" placeholder="burger-house" required style="width: 100%;">
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">WhatsApp Pedidos</label>
                  <input class="sa-input" type="text" name="whatsapp" placeholder="54911xxxxxxxx" style="width: 100%;">
                </div>

                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">PIN de Seguridad Dueño *</label>
                  <input class="sa-input" type="password" name="pin" maxlength="6" placeholder="4 o 6 dígitos" required style="width: 100%;">
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Estilo Visual del Comercio *</label>
                <select class="sa-select" name="tema" required style="width: 100%;">
                  <option value="light">☀️ Clean Light (Delivery Claro & Coral)</option>
                  <option value="dark">🌙 Gourmet Dark (Oscuro & Dorado)</option>
                </select>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.65rem; margin-top: 0.5rem; border-top: 1px solid var(--sa-border); padding-top: 1.25rem;">
                <button type="button" id="btn-cancel-modal" class="sa-btn-outline">Cancelar</button>
                <button type="submit" class="sa-btn-primary">
                  <i data-lucide="check" style="width: 15px; height: 15px;"></i>
                  Crear Comercio
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal para Editar Comercio -->
        <div id="edit-store-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content sa-card" style="max-width: 520px; padding: 0;">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--sa-border); display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="pencil" style="color: var(--sa-primary);"></i>
                <h3 style="font-weight: 700; margin: 0; font-size: 1.1rem; color: var(--sa-text-primary);">Editar Comercio</h3>
              </div>
              <button id="btn-close-edit-modal" class="sa-icon-btn" style="border: none;" aria-label="Cerrar modal">
                <i data-lucide="x" style="width: 16px; height: 16px;"></i>
              </button>
            </div>

            <form id="form-edit-store" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.15rem;">
              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Nombre del Establecimiento *</label>
                <input class="sa-input" type="text" name="nombre" required style="width: 100%;">
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Slug URL (identificador único - Solo Lectura)</label>
                <input class="sa-input" type="text" name="slug" disabled style="opacity: 0.65; cursor: not-allowed; background: var(--sa-bg-subtle); width: 100%;">
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">WhatsApp Pedidos</label>
                  <input class="sa-input" type="text" name="whatsapp" placeholder="54911xxxxxxxx" style="width: 100%;">
                </div>

                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">PIN de Seguridad Dueño *</label>
                  <input class="sa-input" type="password" name="pin" maxlength="6" required style="width: 100%;">
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Estilo Visual del Comercio *</label>
                <select class="sa-select" name="tema" required style="width: 100%;">
                  <option value="light">☀️ Clean Light (Delivery Claro & Coral)</option>
                  <option value="dark">🌙 Gourmet Dark (Oscuro & Dorado)</option>
                </select>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 0.4rem; color: var(--sa-text-secondary);">Descripción breve / Especialidad</label>
                <input class="sa-input" type="text" name="descripcion" placeholder="Hamburguesas smash, pizzas caseras..." style="width: 100%;">
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.65rem; margin-top: 0.5rem; border-top: 1px solid var(--sa-border); padding-top: 1.25rem;">
                <button type="button" id="btn-cancel-edit-modal" class="sa-btn-outline">Cancelar</button>
                <button type="submit" class="sa-btn-primary">
                  <i data-lucide="check" style="width: 15px; height: 15px;"></i>
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal de Confirmación de Eliminación (Rojo ÚNICAMENTE para acción destructiva) -->
        <div id="delete-store-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content sa-card" style="max-width: 460px; text-align: center; padding: 2rem 1.5rem;">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--sa-danger-light); color: var(--sa-danger); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
              <i data-lucide="alert-triangle" style="width: 26px; height: 26px;"></i>
            </div>
            <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--sa-text-primary);">¿Eliminar comercio permanentemente?</h3>
            <p style="color: var(--sa-text-muted); font-size: 0.875rem; line-height: 1.5; margin-bottom: 1.5rem;">
              ¿Estás seguro de que deseas eliminar permanentemente el local <strong id="delete-store-name" style="color: var(--sa-text-primary);"></strong>? Se borrarán de inmediato sus productos, pedidos e historial.
            </p>
            <div style="display: flex; gap: 0.75rem; justify-content: center;">
              <button type="button" id="btn-cancel-delete" class="sa-btn-outline" style="flex: 1;">Cancelar</button>
              <button type="button" id="btn-confirm-delete" class="sa-btn-primary" style="flex: 1.2; background-color: var(--sa-danger) !important; border-color: var(--sa-danger) !important;" aria-label="Confirmar eliminación permanente">
                <i data-lucide="trash-2" style="width: 15px; height: 15px;"></i>
                Eliminar Comercio
              </button>
            </div>
          </div>
        </div>

        <!-- Modal de Compartir / Copiar Accesos -->
        <div id="share-links-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content sa-card" style="max-width: 500px; padding: 0;">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--sa-border); display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="share-2" style="color: var(--sa-primary);"></i>
                <h3 style="font-weight: 700; margin: 0; font-size: 1.1rem; color: var(--sa-text-primary);">Enlaces de Acceso - <span id="share-modal-store-name" style="color: var(--sa-primary);"></span></h3>
              </div>
              <button id="btn-close-share-modal" class="sa-icon-btn" style="border: none;" aria-label="Cerrar modal">
                <i data-lucide="x" style="width: 16px; height: 16px;"></i>
              </button>
            </div>

            <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.15rem;">
              
              <!-- Opción 1: Carta Digital Pública -->
              <div style="background: var(--sa-bg-subtle); border: 1px solid var(--sa-border); border-radius: 12px; padding: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <div>
                    <h4 style="font-size: 0.875rem; font-weight: 700; color: var(--sa-text-primary); margin: 0;">📋 Carta Digital (Clientes)</h4>
                    <p style="font-size: 0.75rem; color: var(--sa-text-muted); margin: 0.2rem 0 0 0;">Para colocar en Bio de Instagram, QR o redes</p>
                  </div>
                  <button id="btn-copy-public-link" class="sa-btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                    <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
                    Copiar
                  </button>
                </div>
                <div id="share-public-url" style="font-family: ui-monospace, monospace; font-size: 0.775rem; color: var(--sa-text-primary); word-break: break-all; background: var(--sa-bg-card); border: 1px solid var(--sa-border); padding: 0.45rem 0.6rem; border-radius: 8px;"></div>
              </div>

              <!-- Opción 2: Panel de Administración Dueño -->
              <div style="background: var(--sa-bg-subtle); border: 1px solid var(--sa-border); border-radius: 12px; padding: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <div>
                    <h4 style="font-size: 0.875rem; font-weight: 700; color: var(--sa-text-primary); margin: 0;">🔐 Panel de Administración (Dueño)</h4>
                    <p style="font-size: 0.75rem; color: var(--sa-text-muted); margin: 0.2rem 0 0 0;">Acceso privado para gestionar productos, pedidos y precios</p>
                  </div>
                  <button id="btn-copy-owner-link" class="sa-btn-outline" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                    <i data-lucide="copy" style="width: 13px; height: 13px;"></i>
                    Copiar
                  </button>
                </div>
                <div id="share-owner-url" style="font-family: ui-monospace, monospace; font-size: 0.775rem; color: var(--sa-text-primary); word-break: break-all; background: var(--sa-bg-card); border: 1px solid var(--sa-border); padding: 0.45rem 0.6rem; border-radius: 8px; margin-bottom: 0.5rem;"></div>
                <div style="font-size: 0.8rem; color: var(--sa-primary); font-weight: 600;">
                  PIN de Acceso: <span id="share-owner-pin" style="font-family: ui-monospace, monospace; font-size: 0.875rem; background: var(--sa-primary-light); padding: 0.15rem 0.45rem; border-radius: 6px;"></span>
                </div>
              </div>

              <!-- Opciones de Paquete y WhatsApp -->
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--sa-border); padding-top: 1rem; gap: 0.75rem;">
                <button id="btn-copy-all-package" class="sa-btn-outline" style="flex: 1; font-size: 0.8rem; padding: 0.6rem;">
                  <i data-lucide="clipboard-list" style="width: 14px; height: 14px;"></i>
                  Copiar Todo el Paquete
                </button>
                <button id="btn-share-modal-wa" class="sa-btn-primary" style="flex: 1; font-size: 0.8rem; padding: 0.6rem; background-color: var(--sa-success) !important; border-color: var(--sa-success) !important;">
                  <i data-lucide="message-circle" style="width: 14px; height: 14px;"></i>
                  Enviar por WhatsApp
                </button>
              </div>

            </div>
          </div>
        </div>

        <!-- Toast de Notificación Flotante -->
        <div id="superadmin-toast" style="
          position: fixed;
          bottom: 2rem;
          right: 2rem;
          background: #111827;
          color: #ffffff;
          font-weight: 600;
          font-size: 0.85rem;
          padding: 0.7rem 1.15rem;
          border-radius: var(--sa-radius-button);
          box-shadow: var(--sa-shadow-elevated);
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transform: translateY(100px);
          opacity: 0;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 2000;
          pointer-events: none;
        ">
          <i data-lucide="check-circle" style="width: 16px; height: 16px; color: #22C55E;"></i>
          <span id="superadmin-toast-text">Acción realizada con éxito</span>
        </div>

        </div>
      </div>
    `;

    // Función auxiliar Toast
    const showToast = (text) => {
      const toast = document.getElementById('superadmin-toast');
      const toastText = document.getElementById('superadmin-toast-text');
      if (!toast || !toastText) return;

      toastText.textContent = text;
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';

      if (window.superadminToastTimeout) clearTimeout(window.superadminToastTimeout);
      window.superadminToastTimeout = setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
      }, 3000);
    };

    // Función auxiliar para normalizar número de WhatsApp
    const formatWhatsAppNumber = (phone) => {
      let clean = (phone || '').replace(/[^0-9]/g, '');
      if (!clean) return '5491100000000';
      if (clean.startsWith('0')) clean = clean.substring(1);
      if (!clean.startsWith('54') && clean.length === 10) {
        clean = '549' + clean;
      } else if (!clean.startsWith('549') && clean.startsWith('54')) {
        clean = '549' + clean.substring(2);
      }
      return clean;
    };

    // Construcción del mensaje preformateado
    const generateWelcomeMessage = (store) => {
      const origin = window.location.origin;
      const cartaUrl = `${origin}/?local=${store.slug}`;
      const ownerUrl = `${origin}/?owner=${store.slug}`;
      const pin = store.pin_admin || store.pin || store.pin_owner || '1234';

      return `¡Hola! 👋 Te damos la bienvenida a tu plataforma gastronómica.\n\n` +
             `📋 *Tu Carta Digital (para tus clientes):*\n` +
             `${cartaUrl}\n\n` +
             `🔐 *Tu Panel de Administración (Gestión de pedidos y menú):*\n` +
             `${ownerUrl}\n` +
             `*PIN de Acceso:* ${pin}\n\n` +
             `¡Muchos éxitos con las ventas! 🚀`;
    };

    // Función para abrir WhatsApp
    const sendWhatsAppAccess = (store) => {
      const cleanPhone = formatWhatsAppNumber(store.whatsapp);
      const message = generateWelcomeMessage(store);
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
    };

    // Modal de compartir
    let currentShareStore = null;

    const openShareModal = (store) => {
      currentShareStore = store;
      const modal = document.getElementById('share-links-modal');
      const origin = window.location.origin;
      const cartaUrl = `${origin}/?local=${store.slug}`;
      const ownerUrl = `${origin}/?owner=${store.slug}`;
      const pin = store.pin_admin || store.pin || store.pin_owner || '1234';

      document.getElementById('share-modal-store-name').textContent = store.nombre;
      document.getElementById('share-public-url').textContent = cartaUrl;
      document.getElementById('share-owner-url').textContent = ownerUrl;
      document.getElementById('share-owner-pin').textContent = pin;

      if (modal) modal.style.display = 'flex';
    };

    const closeShareModal = () => {
      currentShareStore = null;
      const modal = document.getElementById('share-links-modal');
      if (modal) modal.style.display = 'none';
    };

    // Función de renderizado reactivo de filas de la tabla
    const renderTableRows = () => {
      const tbody = document.getElementById('sa-table-body');
      const footerCount = document.getElementById('sa-table-footer-count');
      if (!tbody) return;

      const filtered = getFilteredStores();
      if (footerCount) {
        footerCount.textContent = `Mostrando ${filtered.length} de ${stores.length} comercios`;
      }

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="height: auto; padding: 3.5rem 1.5rem; text-align: center; color: var(--sa-text-muted);">
              <div style="width: 52px; height: 52px; border-radius: 50%; background: var(--sa-bg-subtle); color: var(--sa-text-muted); display: flex; align-items: center; justify-content: center; margin: 0 auto 0.75rem auto; border: 1px solid var(--sa-border);">
                <i data-lucide="store" style="width: 26px; height: 26px; opacity: 0.6;"></i>
              </div>
              <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--sa-text-primary); margin: 0 0 0.3rem 0;">
                No se encontraron comercios
              </h4>
              <p style="font-size: 0.85rem; color: var(--sa-text-muted); margin: 0 0 1rem 0;">
                ${searchTerm || statusFilter !== 'all' ? 'Intenta modificar el término de búsqueda o el filtro de estado.' : 'Aún no se ha registrado ningún local gastronómico.'}
              </p>
              ${searchTerm || statusFilter !== 'all' ? `
                <button id="btn-clear-table-filters" class="sa-btn-outline" style="font-size: 0.8rem; padding: 0.4rem 0.85rem;" aria-label="Limpiar filtros de búsqueda">
                  <i data-lucide="rotate-ccw" style="width: 13px; height: 13px;"></i>
                  Limpiar filtros
                </button>
              ` : `
                <button id="btn-empty-new-store" class="sa-btn-primary" style="font-size: 0.8rem; padding: 0.45rem 1rem;">
                  <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
                  Registrar Primer Comercio
                </button>
              `}
            </td>
          </tr>
        `;

        document.getElementById('btn-clear-table-filters')?.addEventListener('click', () => {
          searchTerm = '';
          statusFilter = 'all';
          const sInput = document.getElementById('sa-search-input');
          const fSelect = document.getElementById('sa-filter-status');
          if (sInput) sInput.value = '';
          if (fSelect) fSelect.value = 'all';
          renderTableRows();
        });

        document.getElementById('btn-empty-new-store')?.addEventListener('click', openNewStoreModal);

        if (window.lucide) window.lucide.createIcons();
        return;
      }

      tbody.innerHTML = filtered.map(store => {
        const initials = getInitials(store.nombre);
        const avatarCol = getAvatarColor(store.nombre);
        const isPinVisible = Boolean(pinVisibilityState[store.slug]);
        const pinValue = store.pin || store.pin_admin || store.pin_owner || '****';
        const cleanPhone = formatWhatsAppNumber(store.whatsapp);
        const isActive = store.activo !== false;

        return `
          <tr data-slug="${store.slug}">
            
            <!-- 1. Comercio: Avatar circular con iniciales + Nombre y Descripción -->
            <td data-label="Comercio" style="overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">
                <div style="
                  width: 36px; 
                  height: 36px; 
                  border-radius: 50%; 
                  background-color: ${avatarCol.bg}; 
                  color: ${avatarCol.text}; 
                  border: 1px solid ${avatarCol.border};
                  display: flex; 
                  align-items: center; 
                  justify-content: center; 
                  font-weight: 700; 
                  font-size: 0.8rem; 
                  letter-spacing: -0.02em;
                  flex-shrink: 0;
                ">
                  ${initials}
                </div>
                <div style="min-width: 0; flex: 1; overflow: hidden;">
                  <span title="${store.nombre}" style="font-size: 0.875rem; font-weight: 600; color: var(--sa-text-primary); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;">
                    ${store.nombre}
                  </span>
                  ${store.descripcion ? `
                    <span title="${store.descripcion}" style="font-size: 0.725rem; color: var(--sa-text-muted); font-weight: 400; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;">
                      ${store.descripcion}
                    </span>
                  ` : ''}
                </div>
              </div>
            </td>

            <!-- 2. Slug: Chip monoespaciado con botón discreto de copiar -->
            <td data-label="Slug" style="overflow: hidden;">
              <div style="display: inline-flex; align-items: center; gap: 0.35rem; background: var(--sa-bg-subtle); padding: 0.2rem 0.5rem; border-radius: 8px; border: 1px solid var(--sa-border); max-width: 100%;">
                <span title="/${store.slug}" style="font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.775rem; color: var(--sa-text-secondary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  /${store.slug}
                </span>
                <button class="btn-copy-slug-inline" data-slug="${store.slug}" style="background: none; border: none; padding: 0.15rem; cursor: pointer; color: var(--sa-text-muted); display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; transition: color 150ms;" title="Copiar enlace" aria-label="Copiar slug /${store.slug}">
                  <i data-lucide="copy" style="width: 12px; height: 12px;"></i>
                </button>
              </div>
            </td>

            <!-- 3. WhatsApp: Link directo clickeable (wa.me) con icono verde -->
            <td data-label="WhatsApp" style="overflow: hidden;">
              ${store.whatsapp ? `
                <a href="https://wa.me/${cleanPhone}" target="_blank" rel="noopener noreferrer" style="display: inline-flex; align-items: center; gap: 0.45rem; text-decoration: none; color: var(--sa-text-primary); font-size: 0.825rem; font-weight: 500; transition: color 150ms;" title="Abrir WhatsApp Web" aria-label="Abrir WhatsApp ${store.whatsapp}">
                  <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: #DCFCE7; color: #16A34A; flex-shrink: 0;">
                    <i data-lucide="message-circle" style="width: 13px; height: 13px;"></i>
                  </span>
                  <span style="color: var(--sa-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${store.whatsapp}</span>
                </a>
              ` : `
                <span style="color: var(--sa-text-muted); font-size: 0.8rem; font-style: italic;">Sin asignar</span>
              `}
            </td>

            <!-- 4. PIN: Oculto por defecto (••••) con botón de ojo para alternar -->
            <td data-label="PIN" style="text-align: center; white-space: nowrap;">
              <div style="display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem;">
                <span class="pin-display" data-slug="${store.slug}" style="font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.85rem; letter-spacing: ${isPinVisible ? '0.05em' : '0.15em'}; font-weight: 700; color: var(--sa-text-primary);">
                  ${isPinVisible ? pinValue : '••••'}
                </span>
                <button class="btn-toggle-pin" data-slug="${store.slug}" style="background: none; border: none; padding: 0.2rem; cursor: pointer; color: var(--sa-text-muted); display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; transition: color 150ms;" title="${isPinVisible ? 'Ocultar PIN' : 'Mostrar PIN'}" aria-label="${isPinVisible ? 'Ocultar PIN' : 'Mostrar PIN'}">
                  <i data-lucide="${isPinVisible ? 'eye-off' : 'eye'}" style="width: 14px; height: 14px;"></i>
                </button>
              </div>
            </td>

            <!-- 5. Estilo: Select con borde fino y selector temático -->
            <td data-label="Estilo" style="white-space: nowrap;">
              <select class="select-store-theme sa-select" data-slug="${store.slug}" aria-label="Estilo visual de ${store.nombre}" style="
                padding: 0.25rem 0.5rem;
                font-size: 0.75rem;
                font-weight: 600;
                width: 100%;
                max-width: 110px;
                border-radius: 10px;
                cursor: pointer;
              ">
                <option value="light" ${store.tema === 'light' ? 'selected' : ''}>☀️ Light</option>
                <option value="dark" ${store.tema !== 'light' ? 'selected' : ''}>🌙 Dark</option>
              </select>
            </td>

            <!-- 6. Estado: Toggle switch interactivo + badge verde / ámbar -->
            <td data-label="Estado" style="white-space: nowrap;">
              <div style="display: inline-flex; align-items: center; gap: 0.6rem;">
                <!-- Switch Toggle -->
                <button class="btn-toggle-status-switch" data-id="${store.id}" data-active="${isActive}" role="switch" aria-checked="${isActive}" aria-label="Alternar estado de ${store.nombre}" style="
                  position: relative;
                  width: 36px;
                  height: 20px;
                  border-radius: 999px;
                  background-color: ${isActive ? '#16A34A' : 'var(--sa-border)'};
                  border: none;
                  cursor: pointer;
                  transition: background-color 150ms ease;
                  padding: 2px;
                  display: inline-flex;
                  align-items: center;
                  flex-shrink: 0;
                ">
                  <span style="
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    background-color: #ffffff;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.25);
                    transition: transform 150ms ease;
                    transform: translateX(${isActive ? '16px' : '0px'});
                    display: block;
                  "></span>
                </button>

                <!-- Badge Estado (Verde #16A34A / Ámbar #D97706) -->
                <span class="badge" style="
                  font-size: 0.725rem;
                  font-weight: 600;
                  padding: 0.18rem 0.55rem;
                  border-radius: 999px;
                  background: ${isActive ? 'var(--sa-success-light)' : 'var(--sa-warning-light)'};
                  color: ${isActive ? 'var(--sa-success-text)' : 'var(--sa-warning-text)'};
                  border: 1px solid ${isActive ? 'var(--sa-success-border)' : 'var(--sa-warning-border)'};
                  display: inline-flex;
                  align-items: center;
                  gap: 0.3rem;
                ">
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: ${isActive ? '#16A34A' : '#D97706'};"></span>
                  ${isActive ? 'Operativo' : 'Pausado'}
                </span>
              </div>
            </td>

            <!-- 7. Acciones: 2 botones icon-only visibles (Editar + Abrir Carta) y menú '⋯' -->
            <td data-label="Acciones" style="text-align: right; white-space: nowrap; overflow: visible; position: relative;">
              <div style="display: inline-flex; gap: 0.35rem; align-items: center; justify-content: flex-end; position: relative;">
                
                <!-- Botón 1: Editar Comercio -->
                <button class="sa-icon-btn btn-edit-store" data-slug="${store.slug}" title="Editar comercio" aria-label="Editar comercio ${store.nombre}">
                  <i data-lucide="pencil" style="width: 14px; height: 14px;"></i>
                </button>

                <!-- Botón 2: Abrir Carta Digital Pública -->
                <a href="?local=${store.slug}" target="_blank" class="sa-icon-btn btn-view-menu" title="Ver carta digital" aria-label="Ver carta digital de ${store.nombre}">
                  <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
                </a>

                <!-- Botón 3: Menú Desplegable '⋯' con el resto de opciones -->
                <div class="dropdown-container" style="position: relative; display: inline-block;">
                  <button class="sa-icon-btn btn-more-actions" data-slug="${store.slug}" title="Más opciones" aria-label="Más opciones para ${store.nombre}" aria-haspopup="true">
                    <i data-lucide="more-horizontal" style="width: 16px; height: 16px;"></i>
                  </button>

                  <div class="sa-dropdown-menu" id="dropdown-${store.slug}" style="display: none;">
                    
                    <button class="sa-dropdown-item btn-whatsapp-share" data-slug="${store.slug}">
                      <i data-lucide="message-circle" style="width: 14px; height: 14px; color: #16A34A;"></i>
                      <span>Enviar accesos por WhatsApp</span>
                    </button>

                    <button class="sa-dropdown-item btn-copy-links" data-slug="${store.slug}">
                      <i data-lucide="copy" style="width: 14px; height: 14px; color: var(--sa-primary);"></i>
                      <span>Copiar enlaces de acceso</span>
                    </button>

                    <a href="?owner=${store.slug}" class="sa-dropdown-item">
                      <i data-lucide="lock" style="width: 14px; height: 14px; color: var(--sa-text-secondary);"></i>
                      <span>Panel del Dueño</span>
                    </a>

                    <button class="sa-dropdown-item btn-toggle-status" data-id="${store.id}" data-active="${isActive}">
                      <i data-lucide="${isActive ? 'pause' : 'play'}" style="width: 14px; height: 14px; color: ${isActive ? '#D97706' : '#16A34A'};"></i>
                      <span>${isActive ? 'Pausar comercio' : 'Reactivar comercio'}</span>
                    </button>

                    <div style="height: 1px; background: var(--sa-border); margin: 0.35rem 0;"></div>

                    <button class="sa-dropdown-item sa-dropdown-item-danger btn-delete-store" data-slug="${store.slug}">
                      <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--sa-danger);"></i>
                      <span>Eliminar comercio</span>
                    </button>

                  </div>
                </div>

              </div>
            </td>

          </tr>
        `;
      }).join('');

      // Enlazar listeners dinámicos de las filas
      // 1. Alternar PIN
      tbody.querySelectorAll('.btn-toggle-pin').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          pinVisibilityState[slug] = !pinVisibilityState[slug];
          renderTableRows();
        });
      });

      // 2. Copiar slug inline
      tbody.querySelectorAll('.btn-copy-slug-inline').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          const url = `${window.location.origin}/?local=${slug}`;
          await navigator.clipboard.writeText(url);
          showToast(`Enlace /${slug} copiado al portapapeles`);
        });
      });

      // 3. Switch de estado interactivo
      tbody.querySelectorAll('.btn-toggle-status-switch').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const isActive = btn.getAttribute('data-active') === 'true';
          await toggleStoreStatus(id, isActive);
        });
      });

      // 4. Botón '⋯' menú desplegable
      tbody.querySelectorAll('.btn-more-actions').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          const menu = document.getElementById(`dropdown-${slug}`);
          
          // Cerrar otros dropdowns
          document.querySelectorAll('.sa-dropdown-menu').forEach(m => {
            if (m !== menu) m.style.display = 'none';
          });

          if (menu) {
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
          }
        });
      });

      // 5. Botones de Editar
      tbody.querySelectorAll('.btn-edit-store').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          const st = stores.find(s => s.slug === slug);
          if (st) openEditStoreModal(st);
        });
      });

      // 6. Botones de WhatsApp dentro del menú
      tbody.querySelectorAll('.btn-whatsapp-share').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          const st = stores.find(s => s.slug === slug);
          if (st) sendWhatsAppAccess(st);
          // Cerrar menú
          const menu = document.getElementById(`dropdown-${slug}`);
          if (menu) menu.style.display = 'none';
        });
      });

      // 7. Botones de Copiar Accesos dentro del menú
      tbody.querySelectorAll('.btn-copy-links').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          const st = stores.find(s => s.slug === slug);
          if (st) openShareModal(st);
          // Cerrar menú
          const menu = document.getElementById(`dropdown-${slug}`);
          if (menu) menu.style.display = 'none';
        });
      });

      // 8. Botones de Pausar / Reactivar dentro del menú
      tbody.querySelectorAll('.btn-toggle-status').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute('data-id');
          const isActive = btn.getAttribute('data-active') === 'true';
          await toggleStoreStatus(id, isActive);
        });
      });

      // 9. Botones de Eliminar dentro del menú (Rojo con confirmación)
      tbody.querySelectorAll('.btn-delete-store').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slug = btn.getAttribute('data-slug');
          const st = stores.find(s => s.slug === slug);
          if (st) openDeleteModal(st);
          // Cerrar menú
          const menu = document.getElementById(`dropdown-${slug}`);
          if (menu) menu.style.display = 'none';
        });
      });

      // 10. Selector de estilo visual en la fila
      tbody.querySelectorAll('.select-store-theme').forEach(sel => {
        sel.addEventListener('change', async (e) => {
          const slug = e.target.getAttribute('data-slug');
          const newTheme = e.target.value;
          await updateStoreTheme(slug, newTheme);
        });
      });

      if (window.lucide) window.lucide.createIcons();
    };

    // Renderizar filas inicialmente
    renderTableRows();

    // Listener para cerrar cualquier dropdown al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.dropdown-container')) {
        document.querySelectorAll('.sa-dropdown-menu').forEach(m => {
          m.style.display = 'none';
        });
      }
    });

    // Buscador en tiempo real
    document.getElementById('sa-search-input')?.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderTableRows();
    });

    // Filtro por estado
    document.getElementById('sa-filter-status')?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      renderTableRows();
    });

    // Modales: Nuevo Comercio
    document.getElementById('btn-new-store')?.addEventListener('click', openNewStoreModal);
    document.getElementById('btn-close-modal')?.addEventListener('click', closeNewStoreModal);
    document.getElementById('btn-cancel-modal')?.addEventListener('click', closeNewStoreModal);
    document.getElementById('form-create-store')?.addEventListener('submit', handleCreateStore);

    // Modales: Editar Comercio
    document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditStoreModal);
    document.getElementById('btn-cancel-edit-modal')?.addEventListener('click', closeEditStoreModal);
    document.getElementById('form-edit-store')?.addEventListener('submit', handleUpdateStore);

    // Modales: Compartir Enlaces
    document.getElementById('btn-close-share-modal')?.addEventListener('click', closeShareModal);
    document.getElementById('btn-copy-public-link')?.addEventListener('click', async () => {
      if (!currentShareStore) return;
      const url = `${window.location.origin}/?local=${currentShareStore.slug}`;
      await navigator.clipboard.writeText(url);
      showToast('¡Link de carta copiado!');
    });

    document.getElementById('btn-copy-owner-link')?.addEventListener('click', async () => {
      if (!currentShareStore) return;
      const pin = currentShareStore.pin_admin || currentShareStore.pin || currentShareStore.pin_owner || '1234';
      const text = `${window.location.origin}/?owner=${currentShareStore.slug} (PIN: ${pin})`;
      await navigator.clipboard.writeText(text);
      showToast('¡Acceso de dueño copiado!');
    });

    document.getElementById('btn-copy-all-package')?.addEventListener('click', async () => {
      if (!currentShareStore) return;
      const message = generateWelcomeMessage(currentShareStore);
      await navigator.clipboard.writeText(message);
      showToast('¡Paquete completo copiado!');
    });

    document.getElementById('btn-share-modal-wa')?.addEventListener('click', () => {
      if (currentShareStore) {
        sendWhatsAppAccess(currentShareStore);
      }
    });

    // Modales: Eliminar Comercio
    document.getElementById('btn-cancel-delete')?.addEventListener('click', closeDeleteModal);
    document.getElementById('btn-confirm-delete')?.addEventListener('click', confirmDeleteStore);

    // Selector de tema del panel Super-Admin
    document.getElementById('superadmin-theme-switcher')?.addEventListener('change', (e) => {
      const chosenTheme = e.target.value === 'dark' ? 'dark' : 'light';
      localStorage.setItem('superadmin_theme', chosenTheme);
      document.documentElement.setAttribute('data-theme', chosenTheme);
      document.body.setAttribute('data-theme', chosenTheme);
      const themeLabels = {
        dark: '🌙 Gourmet Dark',
        light: '☀️ Clean Light'
      };
      showToast(`Vista cambiada a ${themeLabels[chosenTheme]}`);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  // Inicialización
  loadData();
}
