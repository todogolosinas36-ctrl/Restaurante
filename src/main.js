import { supabase } from './services/supabase.js';
import { renderSuperAdmin } from './modules/superAdmin.js';
import { renderOwnerPanel } from './modules/ownerPanel.js';
import { renderClientView } from './modules/clientView.js';

async function initRouter() {
  const appContainer = document.getElementById('app');
  if (!appContainer) return;

  const params = new URLSearchParams(window.location.search);
  const localSlug = params.get('local');
  const ownerSlug = params.get('owner');
  const isAdmin = params.get('admin') === 'mateo';

  const cargarPrimerComercio = async () => {
    try {
      const { data: comercios, error } = await supabase
        .from('comercios')
        .select('slug')
        .limit(1);

      if (!error && comercios && comercios.length > 0) {
        const defaultSlug = comercios[0].slug;
        console.log('[Router] Redirigiendo al primer comercio registrado:', defaultSlug);
        window.history.replaceState({}, '', `?local=${defaultSlug}`);
        await renderClientView(defaultSlug);
        return;
      }
    } catch (err) {
      console.warn('[Router] No se pudo obtener comercio por defecto:', err);
    }

    // Fallback si no hay ningún comercio en la tabla
    appContainer.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; text-align: center; background: var(--bg-primary);">
        <div class="card" style="max-width: 480px; padding: 2.5rem 2rem; border-radius: var(--radius-xl); box-shadow: var(--shadow-lg);">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--accent-light); color: var(--accent); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
            <i data-lucide="store" class="lucide-lg"></i>
          </div>
          <h2 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 0.5rem; color: var(--text-primary);">Bienvenido a GastroPWA</h2>
          <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; margin-bottom: 1.75rem;">
            Aún no se ha registrado ningún comercio en la base de datos. Accede al panel de administración para dar de alta tu primer local.
          </p>
          <a href="?admin=mateo" class="btn btn-primary" style="width: 100%; padding: 0.85rem;">
            <i data-lucide="shield-check"></i>
            Ingresar al Super-Admin
          </a>
        </div>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  };

  if (isAdmin) {
    renderSuperAdmin();
  } else if (ownerSlug) {
    await renderOwnerPanel(ownerSlug);
  } else if (localSlug) {
    await renderClientView(localSlug);
  } else {
    await cargarPrimerComercio();
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Inicializar router al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  initRouter();
});
