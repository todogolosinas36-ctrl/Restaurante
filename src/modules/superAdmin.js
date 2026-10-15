import { supabase } from '../services/supabase.js';

export function renderSuperAdmin(targetContainer) {
  const container = targetContainer || document.getElementById('app');
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

    if (!nombre || !slug || !pin) {
      alert('Por favor completa todos los campos requeridos.');
      return;
    }

    const nuevoComercio = {
      nombre: nombre.trim(),
      slug: slug.trim().toLowerCase(),
      whatsapp: whatsapp.trim(),
      pin: pin.trim()
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

    if (!nuevoNombre || !nuevoPin) {
      alert('El nombre y el PIN son obligatorios.');
      return;
    }

    try {
      const updatePayload = {
        nombre: nuevoNombre,
        whatsapp: nuevoWhatsapp,
        pin: nuevoPin
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

  const renderUI = () => {
    container.innerHTML = `
      <div style="min-height: 100vh; padding: 2rem 1.5rem; max-width: 1200px; margin: 0 auto;">
        
        <!-- Header -->
        <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid var(--border-default); padding-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div style="background-color: var(--accent-light); padding: 0.6rem; border-radius: var(--radius-md); color: var(--accent); display: flex;">
                <i data-lucide="shield-check" class="lucide-lg"></i>
              </div>
              <div>
                <h1 style="font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em;">Panel Super-Administrador</h1>
                <p style="color: var(--text-secondary); font-size: 0.875rem;">Control y supervisión multi-comercio centralizada</p>
              </div>
            </div>
          </div>
          
          <div style="display: flex; gap: 0.75rem;">
            <button id="btn-new-store" class="btn btn-primary">
              <i data-lucide="plus-circle"></i>
              Nuevo Comercio
            </button>
            <a href="/" class="btn btn-secondary">
              <i data-lucide="external-link"></i>
              Ver App Pública
            </a>
          </div>
        </header>

        <!-- Métricas Clave -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; margin-bottom: 2.5rem;">
          
          <div class="card" style="display: flex; align-items: center; gap: 1.25rem;">
            <div style="background-color: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 1rem; border-radius: var(--radius-lg); display: flex;">
              <i data-lucide="store" class="lucide-lg"></i>
            </div>
            <div>
              <p style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600;">Comercios Registrados</p>
              <h3 style="font-size: 1.75rem; font-weight: 800; color: var(--text-primary); margin-top: 0.2rem;">
                ${stats.totalStores} <span style="font-size: 0.9rem; font-weight: 500; color: var(--text-secondary);">locales</span>
              </h3>
            </div>
          </div>

          <div class="card" style="display: flex; align-items: center; gap: 1.25rem;">
            <div style="background-color: var(--accent-light); color: var(--accent); padding: 1rem; border-radius: var(--radius-lg); display: flex;">
              <i data-lucide="credit-card" class="lucide-lg"></i>
            </div>
            <div>
              <p style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600;">Abono Mensual Proyectado</p>
              <h3 style="font-size: 1.75rem; font-weight: 800; color: var(--text-primary); margin-top: 0.2rem;">
                $${(stats.totalStores * 35000).toLocaleString('es-AR')}
              </h3>
            </div>
          </div>

          <div class="card" style="display: flex; align-items: center; gap: 1.25rem;">
            <div style="background-color: var(--success-light); color: var(--success); padding: 1rem; border-radius: var(--radius-lg); display: flex;">
              <i data-lucide="shopping-bag" class="lucide-lg"></i>
            </div>
            <div>
              <p style="font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600;">Pedidos Globales</p>
              <h3 style="font-size: 1.75rem; font-weight: 800; color: var(--text-primary); margin-top: 0.2rem;">
                ${stats.totalOrders}
              </h3>
            </div>
          </div>

        </div>

        <!-- Tabla / Listado de Comercios -->
        <div class="card" style="padding: 0; overflow: hidden;">
          <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <i data-lucide="building-2" style="color: var(--accent);"></i>
              <h2 style="font-size: 1.15rem; font-weight: 700;">Red de Locales Gastronómicos</h2>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-muted);">${stores.length} registros</span>
          </div>

          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem;">
              <thead>
                <tr style="background-color: var(--bg-primary); border-bottom: 1px solid var(--border-default); color: var(--text-secondary);">
                  <th style="padding: 1rem 1.5rem;">Comercio</th>
                  <th style="padding: 1rem 1.5rem;">Slug</th>
                  <th style="padding: 1rem 1.5rem;">WhatsApp</th>
                  <th style="padding: 1rem 1.5rem;">PIN Acceso</th>
                  <th style="padding: 1rem 1.5rem;">Estado</th>
                  <th style="padding: 1rem 1.5rem; text-align: right;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${stores.length === 0 ? `
                  <tr>
                    <td colspan="6" style="padding: 3rem; text-align: center; color: var(--text-muted);">
                      <i data-lucide="utensils" class="lucide-lg" style="margin-bottom: 0.5rem; opacity: 0.5;"></i>
                      <p>No hay comercios dados de alta todavía. Haz clic en "Nuevo Comercio" para comenzar.</p>
                    </td>
                  </tr>
                ` : stores.map(store => `
                  <tr style="border-bottom: 1px solid var(--border-subtle); transition: background 0.15s ease;" onmouseover="this.style.background='var(--bg-card-hover)'" onmouseout="this.style.background='transparent'">
                    <td style="padding: 1rem 1.5rem; font-weight: 600; color: var(--text-primary);">
                      <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <i data-lucide="store" style="color: var(--accent); width: 1.1rem; height: 1.1rem;"></i>
                        ${store.nombre}
                      </div>
                    </td>
                    <td style="padding: 1rem 1.5rem; color: var(--text-secondary); font-family: monospace;">
                      ${store.slug}
                    </td>
                    <td style="padding: 1rem 1.5rem; color: var(--text-secondary);">
                      <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <i data-lucide="phone" class="lucide-sm" style="color: var(--text-muted);"></i>
                        ${store.whatsapp || 'Sin asignar'}
                      </div>
                    </td>
                    <td style="padding: 1rem 1.5rem;">
                      <span style="font-family: monospace; background: var(--bg-primary); padding: 0.2rem 0.5rem; border-radius: var(--radius-sm); border: 1px solid var(--border-default); color: var(--accent);">
                        ${store.pin || store.pin_admin || store.pin_owner || '****'}
                      </span>
                    </td>
                    <td style="padding: 1rem 1.5rem;">
                      <span class="badge ${store.activo !== false ? 'badge-active' : 'badge-inactive'}">
                        <i data-lucide="${store.activo !== false ? 'check-circle' : 'slash'}" class="lucide-sm"></i>
                        ${store.activo !== false ? 'Operativo' : 'Suspendido'}
                      </span>
                    </td>
                    <td style="padding: 1rem 1.5rem; text-align: right;">
                      <div style="display: inline-flex; gap: 0.35rem; align-items: center; flex-wrap: nowrap;">
                        
                        <!-- Botón WhatsApp Accesos -->
                        <button class="btn btn-whatsapp-share" data-slug="${store.slug}" style="
                          padding: 0.4rem 0.65rem; 
                          font-size: 0.75rem; 
                          background-color: rgba(16, 185, 129, 0.15); 
                          color: #34d399; 
                          border: 1px solid rgba(16, 185, 129, 0.3);
                        " title="Enviar Accesos por WhatsApp">
                          <i data-lucide="message-circle" class="lucide-sm"></i>
                          <span>WhatsApp</span>
                        </button>

                        <!-- Botón Copiar Accesos -->
                        <button class="btn btn-secondary btn-copy-links" data-slug="${store.slug}" style="padding: 0.4rem 0.65rem; font-size: 0.75rem;" title="Copiar Enlaces de Acceso">
                          <i data-lucide="copy" class="lucide-sm"></i>
                          <span>Copiar</span>
                        </button>

                        <button class="btn btn-secondary btn-toggle-status" data-id="${store.id}" data-active="${store.activo !== false}" style="padding: 0.4rem 0.55rem; font-size: 0.75rem;" title="${store.activo !== false ? 'Suspender' : 'Activar'}">
                          <i data-lucide="${store.activo !== false ? 'pause' : 'play'}" class="lucide-sm"></i>
                        </button>

                        <button class="btn btn-secondary btn-edit-store" data-slug="${store.slug}" style="padding: 0.4rem 0.55rem; font-size: 0.75rem;" title="Editar Comercio">
                          <i data-lucide="pencil" class="lucide-sm"></i>
                        </button>

                        <a href="?owner=${store.slug}" class="btn btn-secondary" style="padding: 0.4rem 0.55rem; font-size: 0.75rem;" title="Panel de control del comercio">
                          <i data-lucide="lock" class="lucide-sm"></i>
                        </a>

                        <a href="?local=${store.slug}" target="_blank" class="btn btn-primary" style="padding: 0.4rem 0.55rem; font-size: 0.75rem;" title="Ver Menú Público">
                          <i data-lucide="eye" class="lucide-sm"></i>
                        </a>

                        <button class="btn btn-danger btn-delete-store" data-slug="${store.slug}" style="padding: 0.4rem 0.55rem; font-size: 0.75rem;" title="Eliminar Comercio">
                          <i data-lucide="trash-2" class="lucide-sm"></i>
                        </button>

                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Modal para Nuevo Comercio -->
        <div id="new-store-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="plus-circle" style="color: var(--accent);"></i>
                <h3 style="font-weight: 700;">Registrar Nuevo Comercio</h3>
              </div>
              <button id="btn-close-modal" class="btn-icon" style="border: none; background: transparent;">
                <i data-lucide="x"></i>
              </button>
            </div>

            <form id="form-create-store" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.2rem;">
              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">Nombre del Establecimiento *</label>
                <input class="input-field" type="text" name="nombre" placeholder="Ej: Burger House Premium" required>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">Slug URL único * (identificador web)</label>
                <input class="input-field" type="text" name="slug" placeholder="burger-house" required>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">WhatsApp Pedidos</label>
                  <input class="input-field" type="text" name="whatsapp" placeholder="54911xxxxxxxx">
                </div>

                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">PIN de Seguridad Dueño *</label>
                  <input class="input-field" type="password" name="pin" maxlength="6" placeholder="4 o 6 dígitos" required>
                </div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; border-top: 1px solid var(--border-default); padding-top: 1.25rem;">
                <button type="button" id="btn-cancel-modal" class="btn btn-secondary">Cancelar</button>
                <button type="submit" class="btn btn-primary">
                  <i data-lucide="check"></i>
                  Crear Comercio
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal para Editar Comercio -->
        <div id="edit-store-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="pencil" style="color: var(--accent);"></i>
                <h3 style="font-weight: 700;">Editar Comercio</h3>
              </div>
              <button id="btn-close-edit-modal" class="btn-icon" style="border: none; background: transparent;">
                <i data-lucide="x"></i>
              </button>
            </div>

            <form id="form-edit-store" style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.2rem;">
              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">Nombre del Establecimiento *</label>
                <input class="input-field" type="text" name="nombre" required>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">Slug URL (identificador único - Solo Lectura)</label>
                <input class="input-field" type="text" name="slug" disabled style="opacity: 0.65; cursor: not-allowed; background: var(--bg-card-hover);">
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">WhatsApp Pedidos</label>
                  <input class="input-field" type="text" name="whatsapp" placeholder="54911xxxxxxxx">
                </div>

                <div>
                  <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">PIN de Seguridad *</label>
                  <input class="input-field" type="password" name="pin" maxlength="6" required>
                </div>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.4rem; color: var(--text-secondary);">Descripción breve / Especialidad</label>
                <input class="input-field" type="text" name="descripcion" placeholder="Hamburguesas smash, pizzas caseras...">
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem; border-top: 1px solid var(--border-default); padding-top: 1.25rem;">
                <button type="button" id="btn-cancel-edit-modal" class="btn btn-secondary">Cancelar</button>
                <button type="submit" class="btn btn-primary">
                  <i data-lucide="check"></i>
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Modal de Confirmación de Eliminación -->
        <div id="delete-store-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content" style="max-width: 480px; text-align: center; padding: 2rem 1.5rem;">
            <div style="width: 54px; height: 54px; border-radius: 50%; background: var(--danger-light); color: var(--danger); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
              <i data-lucide="alert-triangle" class="lucide-lg"></i>
            </div>
            <h3 style="font-size: 1.25rem; font-weight: 800; margin-bottom: 0.75rem; color: var(--text-primary);">¿Eliminar comercio permanentemente?</h3>
            <p style="color: var(--text-secondary); font-size: 0.875rem; line-height: 1.5; margin-bottom: 1.75rem;">
              ¿Estás seguro de que deseas eliminar permanentemente el comercio <strong id="delete-store-name" style="color: var(--text-primary);"></strong>? Esta acción también borrará todos sus productos asociados y pedidos.
            </p>
            <div style="display: flex; gap: 0.75rem; justify-content: center;">
              <button type="button" id="btn-cancel-delete" class="btn btn-secondary" style="flex: 1;">Cancelar</button>
              <button type="button" id="btn-confirm-delete" class="btn btn-danger" style="flex: 1.3;">
                <i data-lucide="trash-2"></i>
                Eliminar Definitivamente
              </button>
            </div>
          </div>
        </div>

        <!-- Modal de Compartir / Copiar Accesos -->
        <div id="share-links-modal" class="modal-overlay" style="display: none;">
          <div class="modal-content" style="max-width: 500px;">
            <div style="padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="share-2" style="color: var(--accent);"></i>
                <h3 style="font-weight: 700;">Enlaces de Acceso - <span id="share-modal-store-name" style="color: var(--accent);"></span></h3>
              </div>
              <button id="btn-close-share-modal" class="btn-icon" style="border: none; background: transparent;">
                <i data-lucide="x"></i>
              </button>
            </div>

            <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1.2rem;">
              
              <!-- Opción 1: Carta Digital Pública -->
              <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <div>
                    <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">📋 Carta Digital (Clientes)</h4>
                    <p style="font-size: 0.775rem; color: var(--text-secondary);">Para colocar en Bio de Instagram, QR o compartir en redes</p>
                  </div>
                  <button id="btn-copy-public-link" class="btn btn-primary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                    <i data-lucide="copy" class="lucide-sm"></i>
                    Copiar
                  </button>
                </div>
                <div id="share-public-url" style="font-family: monospace; font-size: 0.8rem; color: var(--text-muted); word-break: break-all; background: var(--bg-card); padding: 0.4rem 0.6rem; border-radius: var(--radius-sm);"></div>
              </div>

              <!-- Opción 2: Panel de Administración Dueño -->
              <div style="background: var(--bg-primary); border: 1px solid var(--border-default); border-radius: var(--radius-md); padding: 1rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                  <div>
                    <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">🔐 Panel de Administración (Dueño)</h4>
                    <p style="font-size: 0.775rem; color: var(--text-secondary);">Acceso privado para gestionar productos, pedidos y precios</p>
                  </div>
                  <button id="btn-copy-owner-link" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">
                    <i data-lucide="copy" class="lucide-sm"></i>
                    Copiar
                  </button>
                </div>
                <div id="share-owner-url" style="font-family: monospace; font-size: 0.8rem; color: var(--text-muted); word-break: break-all; background: var(--bg-card); padding: 0.4rem 0.6rem; border-radius: var(--radius-sm); margin-bottom: 0.4rem;"></div>
                <div style="font-size: 0.775rem; color: var(--accent); font-weight: 600;">
                  PIN de Acceso: <span id="share-owner-pin" style="font-family: monospace; font-size: 0.85rem;"></span>
                </div>
              </div>

              <!-- Opción 3: Paquete Completo -->
              <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-default); padding-top: 1rem; gap: 0.75rem;">
                <button id="btn-copy-all-package" class="btn btn-secondary" style="flex: 1; font-size: 0.8rem; padding: 0.6rem;">
                  <i data-lucide="clipboard-list" class="lucide-sm"></i>
                  Copiar Todo el Paquete
                </button>
                <button id="btn-share-modal-wa" class="btn" style="flex: 1; font-size: 0.8rem; padding: 0.6rem; background-color: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);">
                  <i data-lucide="message-circle" class="lucide-sm"></i>
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
          background: #10b981;
          color: #0b1120;
          font-weight: 700;
          font-size: 0.875rem;
          padding: 0.75rem 1.25rem;
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg), 0 0 20px rgba(16, 185, 129, 0.4);
          display: flex;
          align-items: center;
          gap: 0.5rem;
          transform: translateY(100px);
          opacity: 0;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 2000;
          pointer-events: none;
        ">
          <i data-lucide="check-circle" class="lucide-sm"></i>
          <span id="superadmin-toast-text">Enlace copiado al portapapeles</span>
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

    // Estado del modal de compartir
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

    // Eventos
    document.getElementById('btn-new-store')?.addEventListener('click', openNewStoreModal);
    document.getElementById('btn-close-modal')?.addEventListener('click', closeNewStoreModal);
    document.getElementById('btn-cancel-modal')?.addEventListener('click', closeNewStoreModal);
    document.getElementById('form-create-store')?.addEventListener('submit', handleCreateStore);

    // Eventos Editar
    document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditStoreModal);
    document.getElementById('btn-cancel-edit-modal')?.addEventListener('click', closeEditStoreModal);
    document.getElementById('form-edit-store')?.addEventListener('submit', handleUpdateStore);

    document.querySelectorAll('.btn-edit-store').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-slug');
        const st = stores.find(s => s.slug === slug);
        if (st) openEditStoreModal(st);
      });
    });

    // Eventos Compartir / WhatsApp / Copiar
    document.querySelectorAll('.btn-whatsapp-share').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-slug');
        const st = stores.find(s => s.slug === slug);
        if (st) sendWhatsAppAccess(st);
      });
    });

    document.querySelectorAll('.btn-copy-links').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-slug');
        const st = stores.find(s => s.slug === slug);
        if (st) openShareModal(st);
      });
    });

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

    // Eventos Eliminar
    document.getElementById('btn-cancel-delete')?.addEventListener('click', closeDeleteModal);
    document.getElementById('btn-confirm-delete')?.addEventListener('click', confirmDeleteStore);

    document.querySelectorAll('.btn-delete-store').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = btn.getAttribute('data-slug');
        const st = stores.find(s => s.slug === slug);
        if (st) openDeleteModal(st);
      });
    });

    document.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const isActive = btn.getAttribute('data-active') === 'true';
        toggleStoreStatus(id, isActive);
      });
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  // Inicialización
  loadData();
}
