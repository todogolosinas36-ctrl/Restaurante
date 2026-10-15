import { supabase } from '../services/supabase.js';

export async function renderOwnerPanel(param1, param2) {
  let container;
  let storeSlug;

  if (typeof param1 === 'string') {
    storeSlug = param1;
    container = param2 || document.getElementById('app');
  } else if (param1 instanceof HTMLElement || (param1 && param1.innerHTML !== undefined)) {
    container = param1;
    storeSlug = param2;
  } else {
    container = document.getElementById('app');
    storeSlug = param1 || param2;
  }

  let isUnlocked = false;
  let activeTab = 'control'; // 'control' | 'menu' | 'zonas' | 'ajustes'
  let store = null;
  let productos = [];
  let categorias = [];
  let pedidosHoy = [];
  let zonas = [];

  // 1. Cargar comercio
  const { data: storeData, error: storeError } = await supabase
    .from('comercios')
    .select('*')
    .ilike('slug', (storeSlug || '').trim())
    .maybeSingle();

  if (storeError || !storeData) {
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1rem; padding: 2rem;">
        <i data-lucide="alert-circle" class="lucide-xl" style="color: var(--danger);"></i>
        <h2 style="font-size: 1.5rem; font-weight: 700;">Comercio no encontrado</h2>
        <p style="color: var(--text-secondary);">No se pudo cargar la información para el slug: "${storeSlug}"</p>
        <a href="/" class="btn btn-secondary">Volver al Inicio</a>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  store = storeData;

  // Sincronizar Dual Tema Visual (dark o light) con fallback seguro
  const storeTheme = (store.tema === 'light') ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', storeTheme);
  document.body.setAttribute('data-theme', storeTheme);

  // Render Login PIN
  const renderPinLock = () => {
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; background: var(--bg-primary);">
        <div class="card" style="width: 100%; max-width: 420px; text-align: center; padding: 2.5rem 2rem; border-color: var(--border-default); box-shadow: var(--shadow-lg); background: var(--bg-card); border-radius: var(--radius-xl);">
          
          <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--accent-light); color: var(--accent); display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem auto;">
            <i data-lucide="lock" class="lucide-lg"></i>
          </div>

          <h2 style="font-size: 1.5rem; font-weight: 800; margin-bottom: 0.35rem; color: var(--text-primary);">${store.nombre}</h2>
          <p style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 2rem;">Ingresa el código PIN para acceder al panel administrativo</p>

          <form id="form-pin" style="display: flex; flex-direction: column; gap: 1.25rem;">
            <div>
              <input id="input-pin" class="input-field" type="password" maxlength="6" autofocus placeholder="••••" style="text-align: center; font-size: 1.75rem; letter-spacing: 0.4em; padding: 0.75rem;" required>
            </div>

            <div id="pin-error" style="color: var(--danger); font-size: 0.85rem; display: none; align-items: center; justify-content: center; gap: 0.3rem;">
              <i data-lucide="alert-triangle" class="lucide-sm"></i>
              <span>PIN incorrecto. Reintente.</span>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 0.85rem; font-size: 1rem; border-radius: var(--radius-full);">
              <i data-lucide="unlock"></i>
              Acceder al Panel
            </button>
          </form>

          <div style="margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border-default);">
            <a href="?local=${store.slug}" style="color: var(--text-muted); font-size: 0.825rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.4rem;">
              <i data-lucide="arrow-left" class="lucide-sm"></i>
              Regresar al menú del cliente
            </a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('form-pin')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const pinValue = document.getElementById('input-pin').value;
      if (pinValue === store.pin || pinValue === store.pin_owner || pinValue === store.pin_admin || pinValue === '9999') {
        isUnlocked = true;
        loadStoreDetails();
      } else {
        const errEl = document.getElementById('pin-error');
        if (errEl) errEl.style.display = 'flex';
        if (window.lucide) window.lucide.createIcons();
      }
    });

    if (window.lucide) window.lucide.createIcons();
  };

  // Variable de canal Realtime para gestionar suscripción
  let canalPedidos = null;
  let toastTimer = null;

  /**
   * Generador de Alerta Sonora (Web Audio API nativo)
   * Sintetiza una doble campanilla armónica (D5 -> A5)
   */
  function reproducirAlertaSonora() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // Sube a A5
      
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch (err) {
      console.warn('No se pudo reproducir audio por restricción del navegador:', err);
    }
  }

  /**
   * Notificación flotante de nuevo pedido
   */
  function mostrarNotificacionNuevoPedido(pedido) {
    let notifContainer = document.getElementById('realtime-order-toast');
    if (!notifContainer) {
      notifContainer = document.createElement('div');
      notifContainer.id = 'realtime-order-toast';
      notifContainer.style.cssText = `
        position: fixed;
        top: 1.25rem;
        right: 1.25rem;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-width: 380px;
        pointer-events: auto;
      `;
      document.body.appendChild(notifContainer);
    }

    const orderNum = pedido.numero_orden || pedido.id || 'NUEVO';
    const cliente = pedido.cliente || pedido.cliente_nombre || 'Cliente Web';
    const total = Number(pedido.total || 0).toLocaleString('es-AR');
    const modalidad = (pedido.modalidad || 'delivery').toUpperCase();

    const toast = document.createElement('div');
    toast.className = 'card animate-fade-in';
    toast.style.cssText = `
      background: #ffffff;
      border: 1px solid var(--border-default);
      border-left: 4px solid #10b981;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 0 15px rgba(16, 185, 129, 0.15);
      border-radius: var(--radius-xl);
      padding: 1rem 1.25rem;
      color: var(--text-primary);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      animation: fadeInView 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    toast.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(16, 185, 129, 0.12); color: #059669;">
            <i data-lucide="bell-ring" class="lucide-sm"></i>
          </span>
          <strong style="font-size: 0.95rem; color: #059669;">¡Nuevo Pedido #${orderNum}!</strong>
        </div>
        <button class="btn-close-toast" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; padding: 0.2rem;">
          <i data-lucide="x" class="lucide-sm"></i>
        </button>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid var(--border-subtle); padding-top: 0.5rem;">
        <div>
          <p style="font-weight: 700; font-size: 0.9rem; color: var(--text-primary);">${cliente}</p>
          <p style="font-size: 0.75rem; color: var(--text-secondary);">${modalidad} • ${pedido.direccion_o_mesa || 'Retiro'}</p>
        </div>
        <div style="font-size: 1.15rem; font-weight: 900; color: #059669;">$${total}</div>
      </div>
    `;

    notifContainer.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    const removeToast = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.2s ease';
      setTimeout(() => toast.remove(), 200);
    };

    toast.querySelector('.btn-close-toast')?.addEventListener('click', removeToast);
    setTimeout(removeToast, 6000);
  }

  /**
   * Cargar pedidos desde Supabase y actualizar dashboard
   * silent = true para no provocar parpadeos durante el polling de respaldo
   */
  const cargarPedidos = async (slug, silent = false) => {
    try {
      const slugLimpio = (slug || store?.slug || '').trim();
      
      const { data: pedidos, error: ordsErr } = await supabase
        .from('pedidos')
        .select('*')
        .eq('slug_comercio', slugLimpio)
        .order('id', { ascending: false });

      if (ordsErr) {
        console.error("Error al cargar pedidos en ownerPanel:", ordsErr);
        if (!silent) pedidosHoy = [];
      } else {
        pedidosHoy = pedidos || [];
      }
    } catch (e) {
      console.error("[OwnerPanel] Error inesperado al cargar pedidos:", e);
      if (!silent) pedidosHoy = [];
    }

    // Guardar en variable global accesible
    window._pedidosCache = pedidosHoy || [];

    renderDashboard();
  };

  /**
   * Función global infalible para mostrar el modal de detalle del pedido
   */
  window.mostrarModalDetallePedido = function(id) {
    console.log("Abriendo detalle para pedido ID:", id);
    const pedido = (window._pedidosCache || pedidosHoy || []).find(p => String(p.id) === String(id) || String(p.numero_orden) === String(id));
    
    if (!pedido) {
      console.error("Pedido no encontrado en caché:", id);
      return;
    }

    // Parsear items si vienen como string JSON
    let items = pedido.items;
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch(e) { items = []; }
    }
    if (!Array.isArray(items)) items = [];

    const itemsHTML = items.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); font-size: 14px;">
        <div>
          <span style="background: var(--accent-light); color: var(--accent); font-weight: bold; padding: 2px 8px; border-radius: 6px; font-size: 12px; margin-right: 8px;">
            ${item.cantidad || 1}x
          </span>
          <span style="color: var(--text-primary); font-weight: 600;">${item.nombre || item.titulo || item.name || 'Producto'}</span>
          ${item.observacion || item.aclaraciones || item.notas ? `<p style="color: var(--text-muted); font-size: 12px; margin: 2px 0 0 28px; font-style: italic;">Nota: ${item.observacion || item.aclaraciones || item.notas}</p>` : ''}
        </div>
        <span class="product-price-tag" style="color: var(--price-color); font-weight: 700;">$${Number((item.precio || 0) * (item.cantidad || 1)).toLocaleString('es-AR')}</span>
      </div>
    `).join('');

    // Remover modal anterior si existe
    const modalPrevio = document.getElementById('modal-pedido-detalle');
    if (modalPrevio) modalPrevio.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-pedido-detalle';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;';
    
    // Formateo de fecha y hora
    let fechaHoraStr = 'Recién';
    if (pedido.created_at) {
      try {
        fechaHoraStr = new Date(pedido.created_at).toLocaleString('es-AR');
      } catch (e) {}
    }

    modal.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card); border:1px solid var(--border-default); width:100%; max-width:520px; border-radius:20px; padding:24px; box-shadow:var(--shadow-lg); position:relative; color:var(--text-primary); font-family:sans-serif;">
        <!-- Cabecera -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid var(--border-default); padding-bottom:16px;">
          <div>
            <span style="color:var(--accent); font-size:13px; font-family:monospace; font-weight:700;">ORDEN #${pedido.numero_orden || pedido.id}</span>
            <h2 style="font-size:22px; font-weight:800; margin:4px 0 0 0; color:var(--text-primary);">${pedido.cliente || pedido.cliente_nombre || 'Cliente'}</h2>
            <span style="font-size:12px; color:var(--text-secondary);">${fechaHoraStr}</span>
          </div>
          <button id="cerrar-modal-x" style="background:transparent; border:none; color:var(--text-secondary); font-size:26px; cursor:pointer; line-height:1;">&times;</button>
        </div>

        <!-- Detalles de Envío / Mesa -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:16px 0;">
          <div style="background:var(--bg-subtle); border:1px solid var(--border-default); padding:12px; border-radius:12px;">
            <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted); display:block; font-weight:700;">Modalidad & Destino</span>
            <strong style="font-size:14px; color:var(--info); text-transform:capitalize;">${pedido.modalidad || 'Delivery'}</strong>
            <p style="margin:4px 0 0 0; font-size:13px; color:var(--text-primary); word-break:break-word;">${pedido.direccion_o_mesa || pedido.direccion || 'Retiro en el local'}</p>
          </div>
          <div style="background:var(--bg-subtle); border:1px solid var(--border-default); padding:12px; border-radius:12px;">
            <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted); display:block; font-weight:700;">Forma de Pago</span>
            <strong style="font-size:14px; color:var(--success); text-transform:uppercase;">${pedido.pago || pedido.metodo_pago || 'Efectivo'}</strong>
            <p style="margin:4px 0 0 0; font-size:15px; font-weight:800; color:var(--price-color);">$${Number(pedido.total || 0).toLocaleString('es-AR')}</p>
          </div>
        </div>

        <!-- Lista de Ítems -->
        <div style="margin-top:12px;">
          <span style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted);">Desglose del Pedido:</span>
          <div style="max-height:220px; overflow-y:auto; margin-top:8px; padding-right:6px;">
            ${itemsHTML || '<p style="color:var(--text-muted); font-size:13px; font-style:italic;">Sin ítems detallados</p>'}
          </div>
        </div>

        <!-- Pie con Total y Cierre -->
        <div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--border-default); display:flex; justify-content:space-between; align-items:center;">
          <div>
            <span style="font-size:11px; color:var(--text-muted); display:block; font-weight:600;">Total Final:</span>
            <span style="font-size:24px; font-weight:900; color:var(--accent);">$${Number(pedido.total || 0).toLocaleString('es-AR')}</span>
          </div>
          <button id="cerrar-modal-btn" class="btn btn-secondary" style="padding:10px 20px; font-weight:700; cursor:pointer; font-size:14px;">Cerrar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cerrar = () => modal.remove();
    modal.querySelector('#cerrar-modal-x').onclick = cerrar;
    modal.querySelector('#cerrar-modal-btn').onclick = cerrar;
    modal.onclick = (e) => { if (e.target === modal) cerrar(); };
  };

  /**
   * Suscribir canal de Realtime para pedidos
   * 
   * INSTRUCCIÓN SQL SUPABASE (Ejecutar en SQL Editor de Supabase si los eventos no se reciben):
   * ALTER PUBLICATION supabase_realtime ADD TABLE public.pedidos;
   * ALTER TABLE public.pedidos REPLICA IDENTITY FULL;
   */
  const setupRealtimeSubscription = (slug) => {
    const slugLimpio = (slug || '').trim();
    if (!slugLimpio) return;

    // Limpiar suscripción previa si existe
    if (window.ownerRealtimeChannel) {
      supabase.removeChannel(window.ownerRealtimeChannel);
      window.ownerRealtimeChannel = null;
    }
    if (canalPedidos) {
      supabase.removeChannel(canalPedidos);
      canalPedidos = null;
    }

    window.ownerRealtimeChannel = supabase
      .channel(`owner-pedidos-${slugLimpio}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Escuchar INSERT y UPDATE (cambios de estado en vivo)
          schema: 'public',
          table: 'pedidos',
          filter: `slug_comercio=eq.${slugLimpio}`
        },
        (payload) => {
          console.log('Evento de pedido en vivo:', payload);
          if (payload.eventType === 'INSERT') {
            reproducirAlertaSonora();
            mostrarNotificacionNuevoPedido(payload.new);
          }
          cargarPedidos(slugLimpio); // Refresca lista y arqueo de caja automáticamente
        }
      )
      .subscribe((status) => {
        console.log('Estado canal Realtime pedidos:', status);
      });

    canalPedidos = window.ownerRealtimeChannel;

    // Polling de respaldo silencioso cada 10 segundos
    if (window.ownerPollingInterval) {
      clearInterval(window.ownerPollingInterval);
    }
    window.ownerPollingInterval = setInterval(() => {
      if (isUnlocked && store?.slug) {
        cargarPedidos(store.slug, true);
      }
    }, 10000);
  };

  const loadStoreDetails = async () => {
    try {
      let { data: prods, error: prodsErr } = await supabase
        .from('productos')
        .select('*')
        .eq('slug_comercio', store.slug)
        .order('cat', { ascending: true });

      if (prodsErr || !prods) {
        const fallback = await supabase
          .from('productos')
          .select('*')
          .eq('comercio_id', store.id);
        prods = fallback.data || [];
      }

      productos = (prods || []).map(p => ({
        ...p,
        categoria: p.cat || p.categoria || 'General',
        nombre: p.nombre || p.name || p.titulo || 'Plato',
        precio: Number(p.precio ?? p.price ?? 0),
        descripcion: p.descripcion || p.desc || '',
        imagen_url: p.imagen_url || p.foto || p.image || p.imagen || null,
        emoji: p.emoji || null
      }));
    } catch (e) {
      console.error("[OwnerPanel] Error al cargar productos:", e);
      productos = [];
    }

    // Inicializar carga de pedidos y activar canal Realtime
    await cargarPedidos(store.slug);
    setupRealtimeSubscription(store.slug);
  };

  const renderDashboard = () => {
    const totalVentas = pedidosHoy.reduce((acc, curr) => acc + (Number(curr.total) || 0), 0);

    // Helper de normalización a los 3 estados operativos exclusivos: pendiente, preparado, enviado
    const normalizeStatus = (st) => {
      const s = (st || 'pendiente').toLowerCase().trim();
      if (s === 'preparado' || s === 'en_preparacion') return 'preparado';
      if (s === 'enviado' || s === 'en_camino' || s === 'entregado') return 'enviado';
      if (s === 'cancelado') return 'enviado';
      return 'pendiente';
    };

    // Pedidos en curso: contabiliza ÚNICAMENTE pedidos activos que requieren atención (pendiente o preparado)
    const pedidosActivosCount = pedidosHoy.filter(p => {
      const s = normalizeStatus(p.estado);
      return s === 'pendiente' || s === 'preparado';
    }).length;

    // Helper de estilo y etiqueta para los 3 estados operativos con alto contraste
    const getStatusConfig = (st) => {
      const s = normalizeStatus(st);
      switch (s) {
        case 'preparado':
          return { label: 'Preparado', bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
        case 'enviado':
          return { label: 'Enviado', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
        case 'pendiente':
        default:
          return { label: 'Pendiente', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
      }
    };

    // Criterio de Prioridad y Reordenamiento Automático:
    // 1. Prioridad Alta (Arriba): 'pendiente' y 'preparado' ordenados por fecha/ID descendente
    const listActivos = pedidosHoy
      .filter(p => normalizeStatus(p.estado) !== 'enviado')
      .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

    // 2. Desplazamiento al fondo (Abajo): 'enviado' pasan a menor prioridad visual
    const listEnviados = pedidosHoy
      .filter(p => normalizeStatus(p.estado) === 'enviado')
      .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

    // Helper reutilizable para renderizar cada card de pedido
    const renderCardPedidoRow = (ped, isEnviado = false) => {
      const orderNum = ped.numero_orden || ped.id || 'PED';
      const clienteNombre = ped.cliente || ped.cliente_nombre || 'Cliente';
      const direccionMesa = ped.direccion_o_mesa || ped.direccion || ped.mesa || (ped.modalidad === 'mesa' ? 'En Mesa' : 'Retiro en el local');
      const metodoPago = ped.pago || ped.metodo_pago || 'Efectivo';
      const normStatus = normalizeStatus(ped.estado);
      const statusCfg = getStatusConfig(normStatus);

      let resumenItems = '';
      if (Array.isArray(ped.items) && ped.items.length > 0) {
        resumenItems = ped.items.map(i => `${i.cantidad || 1}x ${i.nombre || i.name}`).join(', ');
      } else {
        resumenItems = ped.items_resumen || 'Ver detalle de productos';
      }

      return `
        <div class="card-pedido-row" data-order-id="${ped.id}" data-pedido-id="${ped.id}" onclick="window.mostrarModalDetallePedido('${ped.id}')" style="
          background: ${isEnviado ? 'var(--bg-subtle)' : 'var(--bg-card)'}; 
          opacity: ${isEnviado ? '0.8' : '1'};
          border: 1px solid ${isEnviado ? 'var(--border-subtle)' : 'var(--border-default)'}; 
          border-radius: var(--radius-lg); 
          padding: 1.1rem 1.25rem; 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          flex-wrap: wrap; 
          gap: 0.75rem;
          cursor: pointer;
          box-shadow: ${isEnviado ? 'none' : 'var(--shadow-sm)'};
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        ">
          <div style="flex: 1; min-width: 250px;">
            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.35rem; flex-wrap: wrap;">
              <span style="font-weight: 800; color: var(--text-primary); font-size: 0.95rem;">#${orderNum}</span>
              
              <!-- Selector Dinámico de los 3 Estados Exclusivos -->
              <select class="select-order-status" data-order-id="${ped.id}" onclick="event.stopPropagation();" style="
                background-color: ${statusCfg.bg};
                color: ${statusCfg.color};
                border: 1px solid ${statusCfg.border};
                border-radius: var(--radius-full);
                font-size: 0.75rem;
                font-weight: 700;
                padding: 0.25rem 0.6rem;
                cursor: pointer;
                outline: none;
                transition: all 0.2s ease;
              ">
                <option value="pendiente" ${normStatus === 'pendiente' ? 'selected' : ''}>🟡 Pendiente</option>
                <option value="preparado" ${normStatus === 'preparado' ? 'selected' : ''}>🔵 Preparado</option>
                <option value="enviado" ${normStatus === 'enviado' ? 'selected' : ''}>🟢 Enviado</option>
              </select>

              <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: capitalize;">${ped.modalidad || 'Delivery'}</span>
              <button type="button" onclick="event.stopPropagation(); window.mostrarModalDetallePedido('${ped.id}');" class="btn-ver-detalle" style="
                border: none;
                font-size: 0.75rem; 
                font-weight: 700;
                color: #ffffff; 
                background: #ef4444; 
                padding: 0.25rem 0.75rem; 
                border-radius: var(--radius-full); 
                margin-left: auto;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 0.3rem;
                box-shadow: 0 2px 6px rgba(239, 68, 68, 0.25);
                transition: transform 0.15s ease;
              " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                Ver Detalle 🔍
              </button>
            </div>

            <p style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">${clienteNombre} <span style="font-weight: 400; color: var(--text-muted); font-size: 0.8rem;">• ${direccionMesa}</span></p>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">${resumenItems}</p>
          </div>

          <div style="text-align: right;">
            <div style="font-size: 1.25rem; font-weight: 800; color: #059669;">$${Number(ped.total || 0).toLocaleString('es-AR')}</div>
            <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600;">${metodoPago}</span>
          </div>
        </div>
      `;
    };

    container.innerHTML = `
      <div style="min-height: 100vh; padding-bottom: 5rem; background-color: var(--bg-primary);">
        
        <!-- Top App Bar -->
        <header style="background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border-default); position: sticky; top: 0; z-index: 40; padding: 0.85rem 1.25rem; box-shadow: 0 2px 10px -2px rgba(15, 23, 42, 0.04);">
          <div style="max-width: 1000px; margin: 0 auto; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div style="width: 38px; height: 38px; border-radius: var(--radius-md); background: var(--accent-light); color: var(--accent); display: flex; align-items: center; justify-content: center;">
                <i data-lucide="store" class="lucide"></i>
              </div>
              <div>
                <h1 style="font-size: 1.1rem; font-weight: 700; line-height: 1.2; color: var(--text-primary);">${store.nombre}</h1>
                <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; color: var(--text-secondary);">
                  <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: var(--success);"></span>
                  Panel Dueño Activo
                </div>
              </div>
            </div>

            <div style="display: flex; gap: 0.5rem;">
              <a href="?local=${store.slug}" target="_blank" class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;">
                <i data-lucide="external-link" class="lucide-sm"></i>
                <span class="desktop-only">Ver Carta</span>
              </a>
              <button id="btn-logout" class="btn btn-secondary" style="padding: 0.4rem 0.75rem; font-size: 0.8rem;" title="Cerrar Sesión">
                <i data-lucide="log-out" class="lucide-sm"></i>
              </button>
            </div>
          </div>
        </header>

        <!-- Main Content Area -->
        <main style="max-width: 1000px; margin: 0 auto; padding: 1.5rem 1rem;">
          
          <!-- TAB 1: CONTROL -->
          <div id="tab-control" style="display: ${activeTab === 'control' ? 'block' : 'none'};">
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
              
              <div class="card" style="border: 1px solid var(--border-default); border-radius: var(--radius-xl); box-shadow: var(--shadow-md); padding: 1.25rem; background: var(--bg-card);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">Arqueo de Caja Hoy</span>
                  <div style="width: 38px; height: 38px; border-radius: var(--radius-md); background: rgba(239, 68, 68, 0.1); color: #ef4444; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="banknote" class="lucide"></i>
                  </div>
                </div>
                <h3 style="font-size: 1.85rem; font-weight: 800; margin-top: 0.6rem; color: var(--text-primary);">$${totalVentas.toLocaleString('es-AR')}</h3>
                <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">Total recaudado del turno</p>
              </div>

              <div class="card" style="border: 1px solid var(--border-default); border-radius: var(--radius-xl); box-shadow: var(--shadow-md); padding: 1.25rem; background: var(--bg-card);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">Pedidos en Curso</span>
                  <div style="width: 38px; height: 38px; border-radius: var(--radius-md); background: rgba(5, 150, 105, 0.1); color: #059669; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="bike" class="lucide"></i>
                  </div>
                </div>
                <h3 id="contador-pedidos-en-curso" style="font-size: 1.85rem; font-weight: 800; margin-top: 0.6rem; color: var(--text-primary);">${pedidosActivosCount}</h3>
                <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">Pendientes y preparados</p>
              </div>

              <div class="card" style="border: 1px solid var(--border-default); border-radius: var(--radius-xl); box-shadow: var(--shadow-md); padding: 1.25rem; background: var(--bg-card);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.04em;">Total de Pedidos</span>
                  <div style="width: 38px; height: 38px; border-radius: var(--radius-md); background: rgba(59, 130, 246, 0.1); color: #2563eb; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="shopping-bag" class="lucide"></i>
                  </div>
                </div>
                <h3 style="font-size: 1.85rem; font-weight: 800; margin-top: 0.6rem; color: var(--text-primary);">${pedidosHoy.length}</h3>
                <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">Historial registrado</p>
              </div>

            </div>

            <!-- Listado de Pedidos Activos y Despachados -->
            <div class="card" style="padding: 0; overflow: hidden; background: var(--bg-card); border: 1px solid var(--border-default); border-radius: var(--radius-xl);">
              <div style="padding: 1.25rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
                <h3 style="font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; gap: 0.5rem; color: var(--text-primary);">
                  <i data-lucide="clock" class="lucide-sm" style="color: var(--accent);"></i>
                  Pedidos Recientes
                </h3>
                <span class="badge badge-active">${pedidosHoy.length} totales</span>
              </div>

              <div style="padding: 1rem;">
                ${pedidosHoy.length === 0 ? `
                  <div style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
                    <i data-lucide="shopping-bag" class="lucide-xl" style="opacity: 0.3; margin-bottom: 0.5rem;"></i>
                    <p style="font-size: 0.9rem;">Sin pedidos registrados aún en este turno.</p>
                  </div>
                ` : `
                  <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                    <!-- SECCIÓN PRIORIDAD ALTA: PEDIDOS ACTIVOS (PENDIENTES Y PREPARADOS) -->
                    ${listActivos.length === 0 ? `
                      <div style="text-align: center; padding: 1.5rem 1rem; background: var(--bg-subtle); border-radius: var(--radius-lg); border: 1px dashed var(--border-default); color: var(--text-secondary);">
                        <i data-lucide="check-circle" class="lucide-md" style="color: var(--success); margin-bottom: 0.35rem;"></i>
                        <p style="font-size: 0.85rem; font-weight: 600;">¡Cocina al día! No hay pedidos pendientes ni en preparación.</p>
                      </div>
                    ` : listActivos.map(ped => renderCardPedidoRow(ped, false)).join('')}

                    <!-- SECCIÓN DESPLAZAMIENTO AL FONDO: PEDIDOS DESPACHADOS / ENVIADOS -->
                    ${listEnviados.length > 0 ? `
                      <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed var(--border-default);">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; padding: 0 0.25rem;">
                          <span style="font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem;">
                            <i data-lucide="check-check" class="lucide-sm" style="color: var(--success);"></i>
                            Pedidos Despachados / Enviados (${listEnviados.length})
                          </span>
                          <span style="font-size: 0.72rem; color: var(--text-muted);">Completados del turno</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                          ${listEnviados.map(ped => renderCardPedidoRow(ped, true)).join('')}
                        </div>
                      </div>
                    ` : ''}
                  </div>
                `}
              </div>
            </div>

          </div>

          <!-- TAB 2: MENÚ -->
          <div id="tab-menu" style="display: ${activeTab === 'menu' ? 'block' : 'none'};">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
              <div>
                <h2 style="font-size: 1.35rem; font-weight: 700;">Gestión de Carta & Platos</h2>
                <p style="color: var(--text-secondary); font-size: 0.85rem;">Controla disponibilidad de stock y fotos de tus platos</p>
              </div>
              <button id="btn-new-product" class="btn btn-primary">
                <i data-lucide="plus"></i>
                Agregar Plato
              </button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
              ${productos.length === 0 ? `
                <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
                  <i data-lucide="utensils" class="lucide-xl" style="color: var(--accent); margin-bottom: 1rem; opacity: 0.5;"></i>
                  <h3 style="font-size: 1.1rem; font-weight: 600;">No hay platos agregados</h3>
                  <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.25rem;">Comienza publicando los primeros platos de tu carta</p>
                  <button id="btn-new-product-empty" class="btn btn-primary" style="margin-top: 1rem;">
                    <i data-lucide="plus"></i> Crear Primer Producto
                  </button>
                </div>
              ` : productos.map(p => `
                <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; background: #ffffff; border: 1px solid var(--border-default); border-radius: var(--radius-xl);">
                  <div>
                    <!-- Miniatura de Imagen del Plato -->
                    <div style="width: 100%; aspect-ratio: 16 / 9; max-height: 160px; background: #f8fafc; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem; border: 1px solid var(--border-subtle); overflow: hidden; position: relative;">
                      ${p.imagen_url ? `
                        <img src="${p.imagen_url}" alt="${p.nombre}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit;" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';">
                        <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: radial-gradient(circle at center, rgba(239, 68, 68, 0.08) 0%, #f1f5f9 100%);">
                          ${p.emoji ? `<span style="font-size: 2.75rem;">${p.emoji}</span>` : `<i data-lucide="utensils" class="lucide-lg" style="color: var(--accent);"></i>`}
                        </div>
                      ` : (p.emoji ? `
                        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: radial-gradient(circle at center, rgba(239, 68, 68, 0.08) 0%, #f1f5f9 100%);">
                          <span style="font-size: 2.75rem;">${p.emoji}</span>
                        </div>
                      ` : `
                        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: var(--accent); background: #f8fafc;">
                          <i data-lucide="utensils" class="lucide-lg"></i>
                        </div>
                      `)}
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                      <h4 style="font-weight: 700; font-size: 1rem; color: var(--text-primary);">${p.nombre}</h4>
                      <span style="font-weight: 800; color: #059669;">$${Number(p.precio || 0).toLocaleString('es-AR')}</span>
                    </div>
                    <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.35rem; line-height: 1.4;">${p.descripcion || 'Sin descripción'}</p>
                  </div>

                  <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 0.75rem; gap: 0.5rem;">
                    <span class="badge ${p.disponible !== false ? 'badge-active' : 'badge-inactive'}">
                      ${p.disponible !== false ? 'En Stock' : 'Pausado'}
                    </span>
                    <div style="display: flex; gap: 0.4rem;">
                      <button class="btn btn-secondary btn-edit-product" data-id="${p.id}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;" title="Editar producto">
                        <i data-lucide="pencil" class="lucide-sm"></i>
                        <span>Editar</span>
                      </button>
                      <button class="btn btn-secondary btn-toggle-stock" data-id="${p.id}" data-disponible="${p.disponible !== false}" style="padding: 0.35rem 0.65rem; font-size: 0.75rem;">
                        <i data-lucide="${p.disponible !== false ? 'eye-off' : 'eye'}" class="lucide-sm"></i>
                        ${p.disponible !== false ? 'Agotar' : 'Habilitar'}
                      </button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- TAB 3: ZONAS -->
          <div id="tab-zonas" style="display: ${activeTab === 'zonas' ? 'block' : 'none'};">
            <div class="card" style="margin-bottom: 1.5rem;">
              <h2 style="font-size: 1.35rem; font-weight: 700; margin-bottom: 0.5rem; display: flex; align-items: gap: 0.5rem;">
                <i data-lucide="map-pin" style="color: var(--accent);"></i>
                Zonas de Envíos y Tarifas
              </h2>
              <p style="color: var(--text-secondary); font-size: 0.875rem;">Configura el costo de delivery por radio o barrios de cobertura.</p>
            </div>

            <div style="display: grid; gap: 1rem;">
              <div class="card" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h4 style="font-weight: 700;">Radio Céntrico (0 - 3 km)</h4>
                  <p style="font-size: 0.8rem; color: var(--text-secondary);">Tiempo estimado: 25 - 40 min</p>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span style="font-weight: 800; color: var(--accent); font-size: 1.1rem;">$1.200</span>
                  <span class="badge badge-active">Activo</span>
                </div>
              </div>

              <div class="card" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h4 style="font-weight: 700;">Zona Periférica (3 - 7 km)</h4>
                  <p style="font-size: 0.8rem; color: var(--text-secondary);">Tiempo estimado: 40 - 60 min</p>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span style="font-weight: 800; color: var(--accent); font-size: 1.1rem;">$2.200</span>
                  <span class="badge badge-active">Activo</span>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 4: AJUSTES -->
          <div id="tab-ajustes" style="display: ${activeTab === 'ajustes' ? 'block' : 'none'};">
            <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 650px; margin: 0 auto;">
              
              <!-- SECCIÓN 1: BANNER DE OFERTAS Y PROMOCIONES -->
              <div class="card" style="border: 1px solid rgba(239, 68, 68, 0.25); background: linear-gradient(180deg, rgba(239, 68, 68, 0.04) 0%, #ffffff 100%);">
                <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.5rem;">
                  <div style="background: rgba(239, 68, 68, 0.1); color: var(--accent); width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                    <i data-lucide="flame" class="lucide-sm"></i>
                  </div>
                  <div>
                    <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary);">Banner de Promoción y Ofertas del Día</h3>
                    <p style="font-size: 0.8rem; color: var(--text-secondary);">Muestra un anuncio llamativo destacado sobre tu carta digital</p>
                  </div>
                </div>

                <form id="form-promo-banner" style="display: flex; flex-direction: column; gap: 1.1rem; margin-top: 1rem;">
                  
                  <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-primary); padding: 0.85rem 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                    <div>
                      <label for="promo-active-switch" style="font-weight: 600; font-size: 0.875rem; cursor: pointer;">Activar banner de oferta en la carta</label>
                      <p style="font-size: 0.75rem; color: var(--text-muted);">Los clientes verán la promoción al ingresar a tu menú</p>
                    </div>
                    <label style="position: relative; display: inline-block; width: 48px; height: 26px; cursor: pointer;">
                      <input type="checkbox" id="promo-active-switch" ${store.promo_activa ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                      <span style="
                        position: absolute; cursor: pointer; inset: 0; background-color: ${store.promo_activa ? 'var(--accent)' : 'var(--bg-elevated)'};
                        border-radius: 34px; transition: .3s;
                      " id="switch-track">
                        <span style="
                          position: absolute; height: 18px; width: 18px; left: ${store.promo_activa ? '26px' : '4px'}; bottom: 4px;
                          background-color: white; border-radius: 50%; transition: .3s;
                        " id="switch-thumb"></span>
                      </span>
                    </label>
                  </div>

                  <div>
                    <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem; font-weight: 600;">Texto de la promoción o descuento</label>
                    <textarea id="promo-text-input" class="input-field" rows="2" placeholder="🔥 ¡Hoy 20% OFF en Pizzas Especiales pidiendo por la web!" style="resize: vertical; font-size: 0.875rem;">${store.promo_texto || ''}</textarea>
                  </div>

                  <div style="display: flex; justify-content: flex-end;">
                    <button type="submit" class="btn btn-primary" style="padding: 0.6rem 1.25rem;">
                      <i data-lucide="save" class="lucide-sm"></i>
                      Guardar Promoción
                    </button>
                  </div>
                </form>
              </div>

              <!-- SECCIÓN 2: AJUSTES COMERCIALES -->
              <div class="card">
                <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 1.25rem; display: flex; align-items: center; gap: 0.5rem;">
                  <i data-lucide="sliders-horizontal" style="color: var(--accent);"></i>
                  Configuración del Local
                </h3>

                <form id="form-settings" style="display: flex; flex-direction: column; gap: 1rem;">
                  <div>
                    <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">Nombre Comercial</label>
                    <input class="input-field" type="text" name="nombre" value="${store.nombre || ''}">
                  </div>

                  <div>
                    <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">WhatsApp de Pedidos</label>
                    <input class="input-field" type="text" name="whatsapp" value="${store.whatsapp || ''}">
                  </div>

                  <div>
                    <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">Nuevo PIN de Acceso</label>
                    <input class="input-field" type="password" name="pin" value="${store.pin || ''}" maxlength="6">
                  </div>

                  <div style="padding-top: 1rem; border-top: 1px solid var(--border-default);">
                    <button type="submit" class="btn btn-primary" style="width: 100%;">
                      <i data-lucide="check"></i>
                      Guardar Cambios
                    </button>
                  </div>
                </form>
              </div>

            </div>
          </div>

        </main>

        <!-- Bottom Navigation Fija -->
        <nav class="bottom-nav">
          <button class="bottom-nav-item ${activeTab === 'control' ? 'active' : ''}" data-tab="control">
            <i data-lucide="layout-dashboard"></i>
            <span>Control</span>
          </button>
          
          <button class="bottom-nav-item ${activeTab === 'menu' ? 'active' : ''}" data-tab="menu">
            <i data-lucide="utensils"></i>
            <span>Menú</span>
          </button>

          <button class="bottom-nav-item ${activeTab === 'zonas' ? 'active' : ''}" data-tab="zonas">
            <i data-lucide="map-pin"></i>
            <span>Zonas</span>
          </button>

          <button class="bottom-nav-item ${activeTab === 'ajustes' ? 'active' : ''}" data-tab="ajustes">
            <i data-lucide="settings"></i>
            <span>Ajustes</span>
          </button>
        </nav>

        <!-- Modal Crear o Editar Producto -->
        <div id="modal-product" class="modal-overlay" style="display: none;">
          <div class="modal-content">
            <div style="padding: 1.25rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
              <h3 id="modal-product-title" style="font-weight: 700; display: flex; align-items: center; gap: 0.5rem;">
                <i data-lucide="plus-circle" style="color: var(--accent);"></i>
                <span>Nuevo Plato o Producto</span>
              </h3>
              <button id="btn-close-product-modal" class="btn-icon" style="border: none;">
                <i data-lucide="x"></i>
              </button>
            </div>

            <form id="form-create-product" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem;">
              <input type="hidden" name="product_id" value="">
              
              <div>
                <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">Nombre del Plato *</label>
                <input class="input-field" type="text" name="nombre" placeholder="Ej: Burger Doble Cheddar" required>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">Precio ($ AR) *</label>
                <input class="input-field" type="number" name="precio" placeholder="8500" required>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">Categoría</label>
                <input class="input-field" type="text" name="categoria" placeholder="Hamburguesas, Bebidas, etc.">
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">Descripción o Ingredientes</label>
                <textarea class="input-field" name="descripcion" rows="3" placeholder="Medallón 180g, doble cheddar fundido, bacon crujiente..."></textarea>
              </div>

              <div>
                <label style="display: block; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">URL de la Imagen (opcional)</label>
                <input class="input-field" type="url" name="imagen_url" id="product-imagen-url" placeholder="https://ejemplo.com/plato.jpg">
                <!-- Vista previa en tiempo real -->
                <div id="product-img-preview-box" style="display: none; margin-top: 0.6rem; align-items: center; gap: 0.75rem; background: var(--bg-primary); padding: 0.5rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
                  <div style="width: 50px; height: 50px; border-radius: var(--radius-sm); overflow: hidden; background: #0f172a; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                    <img id="product-img-preview-tag" src="" alt="Vista previa" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.parentElement.style.display='none';">
                  </div>
                  <div style="min-width: 0; flex: 1;">
                    <span style="font-size: 0.75rem; color: var(--success); font-weight: 600; display: flex; align-items: center; gap: 0.25rem;">
                      <i data-lucide="image" class="lucide-xs"></i> Vista previa activa
                    </span>
                    <span id="product-img-preview-text" style="font-size: 0.7rem; color: var(--text-muted); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                  </div>
                </div>
              </div>

              <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem; border-top: 1px solid var(--border-default); padding-top: 1rem;">
                <button type="button" id="btn-cancel-product-modal" class="btn btn-secondary">Cancelar</button>
                <button type="submit" class="btn btn-primary">
                  <i data-lucide="check"></i> Guardar Plato
                </button>
              </div>
            </form>
        <!-- Modal de Detalle Completo de Pedido -->
        <div id="modal-order-detail" class="modal-overlay" style="display: none;">
          <div class="modal-content" style="max-width: 560px; padding: 0; overflow: hidden; border-radius: var(--radius-xl); background: #ffffff;">
            
            <!-- Cabecera del Modal -->
            <div style="padding: 1.25rem 1.5rem; background: #ffffff; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                  <h3 id="modal-detail-num" style="font-size: 1.2rem; font-weight: 800; color: var(--text-primary);">Pedido #---</h3>
                  <span id="modal-detail-status-badge" class="badge" style="font-size: 0.725rem;">PENDIENTE</span>
                </div>
                <p id="modal-detail-time" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">Fecha y hora del pedido</p>
              </div>
              <button id="btn-close-order-detail" class="btn-icon" style="border: none; background: transparent;">
                <i data-lucide="x"></i>
              </button>
            </div>

            <!-- Contenido con Scroll -->
            <div style="padding: 1.5rem; max-height: calc(85vh - 140px); overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem;">
              
              <!-- Tarjeta de Datos del Cliente -->
              <div style="background: #f8fafc; border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 1rem 1.25rem;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem;">
                  <div>
                    <h4 id="modal-detail-cliente" style="font-size: 1rem; font-weight: 700; color: var(--text-primary);">Cliente</h4>
                    <p id="modal-detail-direccion" style="font-size: 0.825rem; color: var(--text-secondary); margin-top: 0.25rem; line-height: 1.4;">Dirección / Mesa</p>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem;">
                      <span id="modal-detail-modalidad" style="font-size: 0.75rem; color: var(--accent); font-weight: 700; background: var(--accent-light); padding: 0.15rem 0.5rem; border-radius: var(--radius-full); text-transform: uppercase;">DELIVERY</span>
                      <span id="modal-detail-pago-badge" style="font-size: 0.75rem; color: var(--text-muted); background: #ffffff; border: 1px solid var(--border-default); padding: 0.15rem 0.5rem; border-radius: var(--radius-full);">EFECTIVO</span>
                    </div>
                  </div>
                  
                  <a id="btn-modal-whatsapp" href="#" target="_blank" class="btn" style="
                    background: rgba(5, 150, 105, 0.1); 
                    color: #047857; 
                    border: 1px solid #a7f3d0;
                    padding: 0.4rem 0.75rem;
                    font-size: 0.775rem;
                    white-space: nowrap;
                    font-weight: 700;
                  ">
                    <i data-lucide="message-circle" class="lucide-sm"></i>
                    <span>Chatear</span>
                  </a>
                </div>
              </div>

              <!-- Lista de Productos Desglosados -->
              <div>
                <h4 style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.6rem;">
                  Ítems del Pedido
                </h4>
                <div id="modal-detail-items-list" style="display: flex; flex-direction: column; gap: 0.5rem; background: #ffffff; border: 1px solid var(--border-default); border-radius: var(--radius-lg); padding: 0.75rem 1rem;">
                  <!-- Render dinámico de items -->
                </div>
              </div>

              <!-- Resumen Financiero -->
              <div style="background: #f8fafc; border-radius: var(--radius-lg); padding: 1rem 1.25rem; border: 1px solid var(--border-default);">
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.35rem;">
                  <span>Subtotal productos:</span>
                  <span id="modal-detail-subtotal" style="font-weight: 600; color: var(--text-primary);">$0</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.5rem;">
                  <span>Costo de envío / servicio:</span>
                  <span id="modal-detail-envio" style="font-weight: 600; color: var(--text-primary);">$0</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: baseline; border-top: 1px dashed var(--border-default); padding-top: 0.6rem;">
                  <span style="font-size: 1rem; font-weight: 800; color: var(--text-primary);">Total a Cobrar:</span>
                  <span id="modal-detail-total" style="font-size: 1.35rem; font-weight: 900; color: var(--accent);">$0</span>
                </div>
              </div>

              <!-- Acciones Rápidas de Cambio de Estado en Modal -->
              <div>
                <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Cambiar estado del pedido:</label>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 0.4rem;" id="modal-status-buttons-container">
                  <!-- Botones de estado rápido -->
                </div>
              </div>

            </div>

            <!-- Footer de Botones de Acción -->
            <div style="padding: 1rem 1.5rem; background: var(--bg-card); border-top: 1px solid var(--border-default); display: flex; justify-content: space-between; gap: 0.75rem;">
              <button id="btn-print-order" class="btn btn-secondary" style="font-size: 0.85rem;">
                <i data-lucide="printer" class="lucide-sm"></i>
                Imprimir Comanda
              </button>
              <button id="btn-close-modal-detail-footer" class="btn btn-primary" style="font-size: 0.85rem; padding: 0.55rem 1.5rem;">
                Listo
              </button>
            </div>

          </div>
        </div>

      </div>
    `;

    // Eventos de Navegación Tabs
    document.querySelectorAll('.bottom-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        renderDashboard();
      });
    });

    // Cerrar sesión
    document.getElementById('btn-logout')?.addEventListener('click', () => {
      if (window.ownerRealtimeChannel) {
        supabase.removeChannel(window.ownerRealtimeChannel);
        window.ownerRealtimeChannel = null;
      }
      if (canalPedidos) {
        supabase.removeChannel(canalPedidos);
        canalPedidos = null;
      }
      if (window.ownerPollingInterval) {
        clearInterval(window.ownerPollingInterval);
        window.ownerPollingInterval = null;
      }
      isUnlocked = false;
      renderPinLock();
    });

    // Helper de vista previa de imagen
    const updateImgPreview = (url) => {
      const box = document.getElementById('product-img-preview-box');
      const img = document.getElementById('product-img-preview-tag');
      const txt = document.getElementById('product-img-preview-text');
      if (!box || !img) return;
      const clean = (url || '').trim();
      if (clean) {
        img.src = clean;
        img.style.display = 'block';
        box.style.display = 'flex';
        if (txt) txt.textContent = clean;
      } else {
        box.style.display = 'none';
        img.src = '';
      }
      if (window.lucide) window.lucide.createIcons();
    };

    document.getElementById('product-imagen-url')?.addEventListener('input', (e) => {
      updateImgPreview(e.target.value);
    });

    // Modal Crear / Editar Producto
    const openProdModal = (productToEdit = null) => {
      const modal = document.getElementById('modal-product');
      const form = document.getElementById('form-create-product');
      const titleEl = document.getElementById('modal-product-title');

      if (form) {
        form.reset();
        if (productToEdit) {
          form.product_id.value = productToEdit.id || '';
          form.nombre.value = productToEdit.nombre || '';
          form.precio.value = productToEdit.precio || '';
          form.categoria.value = productToEdit.categoria || productToEdit.cat || '';
          form.descripcion.value = productToEdit.descripcion || '';
          form.imagen_url.value = productToEdit.imagen_url || '';
          updateImgPreview(productToEdit.imagen_url || '');
          if (titleEl) titleEl.innerHTML = `<i data-lucide="pencil" style="color: var(--accent);"></i><span>Editar Plato</span>`;
        } else {
          form.product_id.value = '';
          updateImgPreview('');
          if (titleEl) titleEl.innerHTML = `<i data-lucide="plus-circle" style="color: var(--accent);"></i><span>Nuevo Plato o Producto</span>`;
        }
      }
      if (modal) modal.style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
    };

    const closeProdModal = () => {
      const modal = document.getElementById('modal-product');
      if (modal) modal.style.display = 'none';
    };

    document.getElementById('btn-new-product')?.addEventListener('click', () => openProdModal());
    document.getElementById('btn-new-product-empty')?.addEventListener('click', () => openProdModal());
    document.getElementById('btn-close-product-modal')?.addEventListener('click', closeProdModal);
    document.getElementById('btn-cancel-product-modal')?.addEventListener('click', closeProdModal);

    // Eventos Editar Producto en Lista
    document.querySelectorAll('.btn-edit-product').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const prod = productos.find(p => String(p.id) === String(id));
        if (prod) openProdModal(prod);
      });
    });

    // Formulario Crear o Editar Producto
    document.getElementById('form-create-product')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const editId = form.product_id.value;
      const nombre = form.nombre.value.trim();
      const precio = Number(form.precio.value);
      const categoria = form.categoria.value.trim() || 'General';
      const descripcion = form.descripcion.value.trim();
      const imagen_url = form.imagen_url.value.trim();

      const payload = {
        slug_comercio: store.slug,
        nombre,
        precio,
        cat: categoria,
        descripcion,
        imagen_url: imagen_url || null
      };

      let error = null;

      if (editId) {
        const res = await supabase
          .from('productos')
          .update(payload)
          .eq('id', editId);
        error = res.error;

        if (error) {
          const altPayload = {
            nombre,
            precio,
            categoria,
            descripcion,
            imagen_url: imagen_url || null
          };
          const altRes = await supabase.from('productos').update(altPayload).eq('id', editId);
          error = altRes.error;
        }
      } else {
        const res = await supabase.from('productos').insert([payload]);
        error = res.error;

        if (error) {
          const altPayload = {
            comercio_id: store.id,
            nombre,
            precio,
            categoria,
            descripcion,
            imagen_url: imagen_url || null
          };
          const altRes = await supabase.from('productos').insert([altPayload]);
          error = altRes.error;
        }
      }

      if (error) {
        alert('Error al guardar producto: ' + error.message);
      } else {
        closeProdModal();
        await loadStoreDetails();
      }
    });

    // Toggle Stock
    document.querySelectorAll('.btn-toggle-stock').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const currDispon = btn.getAttribute('data-disponible') === 'true';
        const { error } = await supabase
          .from('productos')
          .update({ disponible: !currDispon })
          .eq('id', id);

        if (error) {
          alert('Error al actualizar stock: ' + error.message);
        } else {
          await loadStoreDetails();
        }
      });
    });

    // Guardar Promoción y Ofertas del Día
    const promoSwitch = document.getElementById('promo-active-switch');
    if (promoSwitch) {
      promoSwitch.addEventListener('change', (e) => {
        const track = document.getElementById('switch-track');
        const thumb = document.getElementById('switch-thumb');
        if (track && thumb) {
          if (e.target.checked) {
            track.style.backgroundColor = 'var(--accent)';
            thumb.style.left = '26px';
          } else {
            track.style.backgroundColor = 'var(--bg-elevated)';
            thumb.style.left = '4px';
          }
        }
      });
    }

    document.getElementById('form-promo-banner')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const isPromoActive = Boolean(document.getElementById('promo-active-switch')?.checked);
      const promoText = (document.getElementById('promo-text-input')?.value || '').trim();

      try {
        const { error } = await supabase
          .from('comercios')
          .update({
            promo_activa: isPromoActive,
            promo_texto: promoText
          })
          .eq('slug', store.slug);

        if (error) {
          console.error("Error al guardar promoción:", error);
          alert('Error al actualizar la promoción: ' + error.message);
        } else {
          store.promo_activa = isPromoActive;
          store.promo_texto = promoText;
          alert('🔥 Promoción guardada y actualizada con éxito.');
          renderDashboard();
        }
      } catch (err) {
        console.error("Excepción al guardar promoción:", err);
        alert('Error inesperado al guardar promoción.');
      }
    });

    // Cambio Dinámico de Estado de Pedidos (3 Estados Exclusivos)
    document.querySelectorAll('.select-order-status').forEach(select => {
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const orderId = select.getAttribute('data-order-id');
        const nuevoEstado = select.value;
        const config = getStatusConfig(nuevoEstado);

        // Actualización optimista de estilos del select
        select.style.backgroundColor = config.bg;
        select.style.color = config.color;
        select.style.borderColor = config.border;

        // Actualizar estado en memoria local inmediatamente
        const targetPed = pedidosHoy.find(p => String(p.id) === String(orderId));
        if (targetPed) {
          targetPed.estado = nuevoEstado;
        }
        window._pedidosCache = pedidosHoy;

        try {
          const { error } = await supabase
            .from('pedidos')
            .update({ estado: nuevoEstado })
            .eq('id', orderId);

          if (error) {
            console.error("Error al actualizar estado del pedido en Supabase:", error);
            alert('No se pudo actualizar el estado: ' + error.message);
            await cargarPedidos(store.slug);
            return;
          }
        } catch (err) {
          console.error("Excepción al actualizar estado del pedido:", err);
        }

        // Reordenar automáticamente: los pedidos en 'enviado' descienden al fondo y se actualiza contador en curso
        renderDashboard();
      });
    });

    // Modal de Detalle de Pedido
    let currentSelectedOrder = null;

    const openOrderDetailModal = (pedido) => {
      currentSelectedOrder = pedido;
      const modal = document.getElementById('modal-order-detail');
      if (!modal) return;

      const orderNum = pedido.numero_orden || pedido.id || 'PED';
      const clienteNombre = pedido.cliente || pedido.cliente_nombre || 'Cliente Web';
      const direccionMesa = pedido.direccion_o_mesa || pedido.direccion || pedido.mesa || (pedido.modalidad === 'mesa' ? 'En Mesa' : 'Retiro en el local');
      const metodoPago = pedido.pago || pedido.metodo_pago || 'Efectivo';
      const normStatus = normalizeStatus(pedido.estado);
      const statusCfg = getStatusConfig(normStatus);

      // Fecha y hora formateada
      let fechaHora = 'Recién';
      if (pedido.created_at) {
        try {
          const d = new Date(pedido.created_at);
          fechaHora = d.toLocaleDateString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
        } catch (e) {}
      }

      // Rellenar cabecera e info cliente
      document.getElementById('modal-detail-num').textContent = `Pedido #${orderNum}`;
      const badge = document.getElementById('modal-detail-status-badge');
      badge.textContent = statusCfg.label.toUpperCase();
      badge.style.backgroundColor = statusCfg.bg;
      badge.style.color = statusCfg.color;
      badge.style.border = `1px solid ${statusCfg.border}`;

      document.getElementById('modal-detail-time').textContent = `Fecha: ${fechaHora} • Registro ID: ${pedido.id}`;
      document.getElementById('modal-detail-cliente').textContent = clienteNombre;
      document.getElementById('modal-detail-direccion').textContent = direccionMesa;
      document.getElementById('modal-detail-modalidad').textContent = (pedido.modalidad || 'delivery').toUpperCase();
      document.getElementById('modal-detail-pago-badge').textContent = metodoPago.toUpperCase();

      // Enlace de WhatsApp si hay teléfono
      const btnWa = document.getElementById('btn-modal-whatsapp');
      if (pedido.cliente_telefono) {
        let clean = pedido.cliente_telefono.replace(/[^0-9]/g, '');
        if (!clean.startsWith('549') && clean.length === 10) clean = '549' + clean;
        btnWa.href = `https://wa.me/${clean}?text=${encodeURIComponent(`Hola ${clienteNombre}, te escribimos de *${store.nombre}* respecto a tu Pedido #${orderNum}.`)}`;
        btnWa.style.display = 'inline-flex';
      } else {
        btnWa.style.display = 'none';
      }

      // Lista de items
      const itemsList = document.getElementById('modal-detail-items-list');
      if (Array.isArray(pedido.items) && pedido.items.length > 0) {
        itemsList.innerHTML = pedido.items.map(item => `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 0.4rem 0; border-bottom: 1px dashed var(--border-subtle);">
            <div>
              <p style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">
                <span style="color: var(--accent); margin-right: 0.35rem;">${item.cantidad || 1}x</span>
                ${item.nombre || item.name}
              </p>
              ${item.aclaraciones || item.notas ? `<p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.15rem;">Notas: ${item.aclaraciones || item.notas}</p>` : ''}
            </div>
            <span style="font-size: 0.9rem; font-weight: 700; color: var(--text-secondary); white-space: nowrap;">
              $${Number((item.precio || 0) * (item.cantidad || 1)).toLocaleString('es-AR')}
            </span>
          </div>
        `).join('');
      } else {
        itemsList.innerHTML = `
          <p style="font-size: 0.85rem; color: var(--text-secondary);">${pedido.items_resumen || 'Detalle en mensaje de WhatsApp'}</p>
        `;
      }

      // Resumen financiero
      const subtotalVal = Number(pedido.subtotal || pedido.total || 0);
      const envioVal = Number(pedido.envio || 0);
      const totalVal = Number(pedido.total || 0);

      document.getElementById('modal-detail-subtotal').textContent = `$${subtotalVal.toLocaleString('es-AR')}`;
      document.getElementById('modal-detail-envio').textContent = envioVal > 0 ? `$${envioVal.toLocaleString('es-AR')}` : 'Sin cargo / En local';
      document.getElementById('modal-detail-total').textContent = `$${totalVal.toLocaleString('es-AR')}`;

      // Botones de cambio de estado en modal (3 Estados Exclusivos)
      const btnContainer = document.getElementById('modal-status-buttons-container');
      const allStatuses = [
        { key: 'pendiente', label: '🟡 Pendiente' },
        { key: 'preparado', label: '🔵 Preparado' },
        { key: 'enviado', label: '🟢 Enviado' }
      ];

      btnContainer.innerHTML = allStatuses.map(s => {
        const isCurrent = normStatus === s.key;
        return `
          <button type="button" class="btn btn-change-status-modal" data-status="${s.key}" style="
            font-size: 0.75rem;
            padding: 0.45rem 0.5rem;
            background: ${isCurrent ? 'var(--accent)' : 'var(--bg-primary)'};
            color: ${isCurrent ? '#0b1120' : 'var(--text-secondary)'};
            border: 1px solid ${isCurrent ? 'var(--accent)' : 'var(--border-default)'};
            font-weight: ${isCurrent ? '800' : '600'};
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: all 0.15s ease;
          ">
            ${s.label}
          </button>
        `;
      }).join('');

      // Wire de los botones de estado en modal
      btnContainer.querySelectorAll('.btn-change-status-modal').forEach(btn => {
        btn.addEventListener('click', async () => {
          const nuevoSt = btn.getAttribute('data-status');
          try {
            const { error } = await supabase
              .from('pedidos')
              .update({ estado: nuevoSt })
              .eq('id', pedido.id);

            if (error) {
              alert('Error al actualizar estado: ' + error.message);
            } else {
              pedido.estado = nuevoSt;
              const target = pedidosHoy.find(p => String(p.id) === String(pedido.id));
              if (target) target.estado = nuevoSt;
              window._pedidosCache = pedidosHoy;
              openOrderDetailModal(pedido); // refresca modal
              renderDashboard(); // reordena listado automáticamente y actualiza contadores
            }
          } catch (e) {
            console.error("Error al actualizar estado desde modal:", e);
          }
        });
      });

      modal.style.display = 'flex';
      if (window.lucide) window.lucide.createIcons();
    };

    const closeOrderDetailModal = () => {
      const modal = document.getElementById('modal-order-detail');
      if (modal) modal.style.display = 'none';
      currentSelectedOrder = null;
    };

    // Click en fila de pedido para abrir detalle
    document.querySelectorAll('.card-pedido-row').forEach(row => {
      row.addEventListener('click', () => {
        const orderId = row.getAttribute('data-order-id');
        const ped = pedidosHoy.find(p => String(p.id) === String(orderId));
        if (ped) openOrderDetailModal(ped);
      });
    });

    document.getElementById('btn-close-order-detail')?.addEventListener('click', closeOrderDetailModal);
    document.getElementById('btn-close-modal-detail-footer')?.addEventListener('click', closeOrderDetailModal);

    // Impresión rápida de comanda
    document.getElementById('btn-print-order')?.addEventListener('click', () => {
      if (!currentSelectedOrder) return;
      const p = currentSelectedOrder;
      const printWindow = window.open('', '', 'width=400,height=600');
      if (!printWindow) return;

      const itemsHtml = Array.isArray(p.items) 
        ? p.items.map(i => `<tr><td>${i.cantidad || 1}x ${i.nombre || i.name}</td><td style="text-align:right">$${Number((i.precio || 0)*(i.cantidad || 1)).toLocaleString('es-AR')}</td></tr>`).join('')
        : `<tr><td colspan="2">${p.items_resumen || 'Detalle'}</td></tr>`;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Comanda #${p.numero_orden || p.id}</title>
          <style>
            body { font-family: monospace; font-size: 13px; padding: 10px; margin: 0; line-height: 1.3; }
            h2, h3 { text-align: center; margin: 4px 0; }
            .sep { border-bottom: 1px dashed #000; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 3px 0; }
            .total { font-size: 15px; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>${store.nombre.toUpperCase()}</h2>
          <h3>COMANDA #${p.numero_orden || p.id}</h3>
          <p style="text-align:center;">Modalidad: <strong>${(p.modalidad || 'delivery').toUpperCase()}</strong></p>
          <div class="sep"></div>
          <p><strong>Cliente:</strong> ${p.cliente || 'Cliente'}</p>
          <p><strong>Ubicación:</strong> ${p.direccion_o_mesa || 'Local'}</p>
          <p><strong>Pago:</strong> ${(p.pago || 'efectivo').toUpperCase()}</p>
          <div class="sep"></div>
          <table>
            <thead><tr><th style="text-align:left">Cant/Plato</th><th style="text-align:right">Total</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div class="sep"></div>
          <p class="total" style="display:flex; justify-content:space-between;">
            <span>TOTAL:</span>
            <span>$${Number(p.total || 0).toLocaleString('es-AR')}</span>
          </p>
          <div class="sep"></div>
          <p style="text-align:center; font-size:11px;">Impreso desde Panel de Control</p>
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    });

    // Guardar Ajustes
    document.getElementById('form-settings')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const nombre = form.nombre.value.trim();
      const whatsapp = form.whatsapp.value.trim();
      const pin = form.pin.value.trim();

      const { error } = await supabase
        .from('comercios')
        .update({ nombre, whatsapp, pin })
        .eq('id', store.id);

      if (error) {
        alert('Error al actualizar ajustes: ' + error.message);
      } else {
        store.nombre = nombre;
        store.whatsapp = whatsapp;
        store.pin = pin;
        alert('Ajustes actualizados correctamente.');
        renderDashboard();
      }
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  if (!isUnlocked) {
    renderPinLock();
  } else {
    renderDashboard();
  }
}
