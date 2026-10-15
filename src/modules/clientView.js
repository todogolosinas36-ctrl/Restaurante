import { supabase } from '../services/supabase.js';

export async function renderClientView(param1, param2) {
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

  let store = null;
  let productos = [];
  let cart = []; // [{ id, nombre, precio, cantidad }]
  let categoriaSeleccionada = null; // null = grid de categorías, string = vista de productos de esa categoría
  let searchTerm = '';
  let orderModalOpen = false;

  // Estado del formulario de checkout
  let orderData = {
    modalidad: 'delivery', // 'delivery' | 'retiro' | 'mesa'
    nombre: '',
    telefono: '',
    direccion: '',
    gpsLocation: null,
    mesaNumero: '',
    metodoPago: 'efectivo', // 'efectivo' | 'transferencia'
    notas: ''
  };

  const renderNotFound = () => {
    if (!container) return;
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 1rem; padding: 2rem; text-align: center;">
        <i data-lucide="store" class="lucide-xl" style="color: var(--accent); opacity: 0.5;"></i>
        <h2 style="font-size: 1.5rem; font-weight: 700;">Comercio no disponible</h2>
        <p style="color: var(--text-secondary); max-width: 400px;">El enlace ingresado no corresponde a ningún establecimiento gastronómico activo o su identificador no es válido.</p>
        <a href="/" class="btn btn-primary" style="margin-top: 1rem;">
          <i data-lucide="arrow-left"></i>
          Volver a la portada
        </a>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  };

  // 1. Cargar datos del comercio por slug
  const urlLocal = new URLSearchParams(window.location.search).get('local');
  const slugParam = (storeSlug || urlLocal || '').trim().toLowerCase();

  console.log('[ClientView] Buscando comercio con slug:', slugParam);

  const { data, error } = await supabase
    .from('comercios')
    .select('*')
    .ilike('slug', slugParam);

  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    console.error("[ClientView] Error al buscar comercio:", error, "Slug buscado:", slugParam);
    renderNotFound();
    return;
  }

  const comercio = Array.isArray(data) ? data[0] : data;
  console.log('[ClientView] Comercio encontrado:', comercio);

  // Extraer ID soportando id, id_comercio, comercio_id, _id o fallback al slug
  const comercioId = comercio?.id ?? comercio?.id_comercio ?? comercio?.comercio_id ?? comercio?._id ?? comercio?.slug;

  if (!comercioId) {
    console.error("[ClientView] ID de comercio no válido:", comercio);
    renderNotFound();
    return;
  }

  store = {
    ...comercio,
    id: comercioId
  };

  // 2. Cargar platos con las columnas reales de la BD (.eq('slug_comercio', slug).order('cat', { ascending: true }))
  const storeSlugClean = store.slug || slugParam;
  let prodsData = null;
  let prodsError = null;

  try {
    const res = await supabase
      .from('productos')
      .select('*')
      .eq('slug_comercio', storeSlugClean)
      .order('cat', { ascending: true });
    prodsData = res.data;
    prodsError = res.error;
  } catch (err) {
    prodsError = err;
  }

  // Fallback secundario si la tabla usa comercio_id
  if (prodsError || !prodsData) {
    console.warn("[ClientView] Reintentando carga de productos con comercio_id:", prodsError?.message);
    const fallbackRes = await supabase
      .from('productos')
      .select('*')
      .eq('comercio_id', comercioId);
    prodsData = fallbackRes.data || [];
  }

  // Normalizar propiedades: cat -> categoria, name/titulo -> nombre, price -> precio
  productos = (prodsData || []).map(p => ({
    ...p,
    categoria: p.cat || p.categoria || 'General',
    nombre: p.nombre || p.name || p.titulo || 'Plato',
    precio: Number(p.precio ?? p.price ?? 0),
    descripcion: p.descripcion || p.desc || '',
    imagen_url: p.imagen_url || p.foto || p.image || p.imagen || null,
    emoji: p.emoji || null
  }));

  const updateCartTotals = () => {
    return cart.reduce((acc, item) => acc + (item.precio * item.cantidad), 0);
  };

  const addToCart = (product) => {
    const existing = cart.find(i => i.id === product.id);
    if (existing) {
      existing.cantidad += 1;
    } else {
      cart.push({
        id: product.id,
        nombre: product.nombre,
        precio: product.precio,
        cantidad: 1
      });
    }
    renderUI();
  };

  const removeFromCart = (productId) => {
    const idx = cart.findIndex(i => i.id === productId);
    if (idx !== -1) {
      if (cart[idx].cantidad > 1) {
        cart[idx].cantidad -= 1;
      } else {
        cart.splice(idx, 1);
      }
    }
    renderUI();
  };

  const clearCart = () => {
    cart = [];
    renderUI();
  };

  const requestGPSLocation = () => {
    const gpsBtn = document.getElementById('btn-get-gps');
    const statusText = document.getElementById('gps-status');

    if (!navigator.geolocation) {
      alert('La geolocalización no es compatible con tu navegador');
      return;
    }

    if (gpsBtn) gpsBtn.disabled = true;
    if (statusText) statusText.innerText = 'Obteniendo ubicación...';

    navigator.geolocation.getCurrentPosition(
      (position) => {
        orderData.gpsLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        if (statusText) {
          statusText.innerHTML = `GPS capturado: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`;
          statusText.style.color = 'var(--success)';
        }
        if (gpsBtn) gpsBtn.disabled = false;
      },
      (err) => {
        if (statusText) {
          statusText.innerText = 'No se pudo obtener el GPS (permiso denegado)';
          statusText.style.color = 'var(--danger)';
        }
        if (gpsBtn) gpsBtn.disabled = false;
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const submitOrder = async (e) => {
    e.preventDefault();
    if (cart.length === 0) {
      alert('El carrito está vacío');
      return;
    }

    const form = e.target;
    orderData.nombre = form.nombre.value.trim();
    orderData.telefono = form.telefono.value.trim();
    orderData.metodoPago = form.metodo_pago.value;
    orderData.notas = form.notas.value.trim();

    if (orderData.modalidad === 'delivery') {
      orderData.direccion = form.direccion.value.trim();
      if (!orderData.direccion) {
        alert('Por favor ingresa la dirección de entrega');
        return;
      }
    } else if (orderData.modalidad === 'mesa') {
      orderData.mesaNumero = form.mesa.value.trim();
      if (!orderData.mesaNumero) {
        alert('Por favor indica tu número de mesa');
        return;
      }
    }

    const total = updateCartTotals();
    const subtotal = total;
    const envio = 0; // Costo de envío base o según zona

    let direccionOMesa = 'Retiro en el local';
    if (orderData.modalidad === 'delivery') {
      direccionOMesa = orderData.direccion;
      if (orderData.gpsLocation) {
        direccionOMesa += ` (GPS: https://maps.google.com/?q=${orderData.gpsLocation.lat},${orderData.gpsLocation.lng})`;
      }
    } else if (orderData.modalidad === 'mesa') {
      direccionOMesa = `Mesa ${orderData.mesaNumero}`;
    }

    const storeSlugTarget = store.slug || slugParam;

    // Generar número de orden incremental o basado en timestamp
    let numeroOrdenGenerado = Math.floor(Date.now() % 100000);
    try {
      const { data: ultimosPedidos } = await supabase
        .from('pedidos')
        .select('numero_orden')
        .eq('slug_comercio', storeSlugTarget)
        .order('numero_orden', { ascending: false })
        .limit(1);

      if (ultimosPedidos && ultimosPedidos.length > 0 && typeof ultimosPedidos[0].numero_orden === 'number') {
        numeroOrdenGenerado = Number(ultimosPedidos[0].numero_orden) + 1;
      }
    } catch (err) {
      console.warn("[ClientView] Fallback a timestamp para numero_orden:", err);
      numeroOrdenGenerado = Math.floor(Date.now() % 100000);
    }

    const datosPedido = {
      slug_comercio: storeSlugTarget,
      numero_orden: numeroOrdenGenerado,
      cliente: orderData.nombre || 'Cliente',
      modalidad: orderData.modalidad || 'delivery', // 'delivery', 'retiro' o 'mesa'
      direccion_o_mesa: direccionOMesa,
      pago: orderData.metodoPago || 'efectivo', // 'efectivo' | 'transferencia'
      items: cart, // Array serializado a jsonb
      subtotal: Number(subtotal || 0),
      envio: Number(envio || 0),
      total: Number(total || 0),
      estado: 'pendiente'
    };

    // 1. Guardar en Supabase con esquema oficial y numero_orden
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .insert([datosPedido])
        .select();

      if (error) {
        console.error("Error al registrar pedido en Supabase:", error);
      } else {
        console.log("Pedido guardado con éxito en Supabase:", data);
      }
    } catch (err) {
      console.error("Excepción al insertar pedido en Supabase:", err);
    }

    // 2. Construir mensaje y abrir WhatsApp
    let mensaje = `*NUEVO PEDIDO - ${store.nombre.toUpperCase()}*\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `*Modalidad:* ${orderData.modalidad.toUpperCase()}\n`;
    mensaje += `*Cliente:* ${orderData.nombre}\n`;
    mensaje += `*Teléfono:* ${orderData.telefono}\n`;

    if (orderData.modalidad === 'delivery') {
      mensaje += `*Dirección:* ${orderData.direccion}\n`;
      if (orderData.gpsLocation) {
        mensaje += `*GPS Ubicación:* https://maps.google.com/?q=${orderData.gpsLocation.lat},${orderData.gpsLocation.lng}\n`;
      }
    } else if (orderData.modalidad === 'mesa') {
      mensaje += `*Mesa Nº:* ${orderData.mesaNumero}\n`;
    }

    mensaje += `*Pago:* ${orderData.metodoPago.toUpperCase()}\n`;
    if (orderData.notas) mensaje += `*Aclaraciones:* ${orderData.notas}\n`;
    mensaje += `━━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `*DETALLE DEL PEDIDO:*\n`;

    cart.forEach(item => {
      mensaje += `• ${item.cantidad}x ${item.nombre} - $${(item.precio * item.cantidad).toLocaleString('es-AR')}\n`;
    });

    mensaje += `━━━━━━━━━━━━━━━━━━━━━\n`;
    mensaje += `*TOTAL A PAGAR:* $${total.toLocaleString('es-AR')}\n`;

    const cleanWhatsapp = (store.whatsapp || '5491100000000').replace(/[^0-9]/g, '');
    const whatsappUrl = `https://wa.me/${cleanWhatsapp}?text=${encodeURIComponent(mensaje)}`;

    window.open(whatsappUrl, '_blank');
    orderModalOpen = false;
    clearCart();
  };

  const renderProductCard = (p) => {
    const inCart = cart.find(c => c.id === p.id);
    return `
      <div class="card" style="display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem; transition: transform 0.15s ease, border-color 0.15s ease; border-radius: var(--radius-xl);">
        <div>
          <!-- Contenedor Responsive 16:9 de Imagen -->
          <div class="product-media-wrapper" style="width: 100%; aspect-ratio: 16 / 9; max-height: 200px; background: #0f172a; border-radius: var(--radius-lg); display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem; border: 1px solid var(--border-subtle); overflow: hidden; position: relative;">
            ${p.imagen_url ? `
              <img 
                src="${p.imagen_url}" 
                alt="${p.nombre}" 
                loading="lazy" 
                style="width: 100%; height: 100%; object-fit: cover; border-radius: inherit; transition: transform 0.3s ease;" 
                onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';"
              >
              <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: radial-gradient(circle at center, rgba(245, 158, 11, 0.12) 0%, #0f172a 100%);">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.35rem; color: var(--accent);"><i data-lucide="utensils" class="lucide-lg"></i></div>
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; align-items: center; gap: 0.35rem; color: var(--accent); opacity: 0.85;">
                <i data-lucide="utensils" class="lucide-lg"></i>
                <span style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; letter-spacing: 0.05em;">Plato Especial</span>
              </div>
            `}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
            <h3 style="font-weight: 700; font-size: 1.05rem; line-height: 1.3;">${p.nombre}</h3>
            <span style="font-weight: 800; font-size: 1.1rem; color: var(--accent); white-space: nowrap;">$${Number(p.precio).toLocaleString('es-AR')}</span>
          </div>

          <p style="font-size: 0.825rem; color: var(--text-secondary); margin-top: 0.4rem; line-height: 1.45;">
            ${p.descripcion || 'Elaborado con ingredientes frescos del día de la más alta calidad gastronómica.'}
          </p>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
          ${inCart ? `
            <div style="display: flex; align-items: center; gap: 0.6rem;">
              <button class="btn-icon btn-cart-dec" data-id="${p.id}" style="width: 32px; height: 32px; padding: 0;">
                <i data-lucide="minus" class="lucide-sm"></i>
              </button>
              <span style="font-weight: 700; font-size: 0.95rem; min-width: 1.25rem; text-align: center;">${inCart.cantidad}</span>
              <button class="btn-icon btn-cart-inc" data-id="${p.id}" style="width: 32px; height: 32px; padding: 0;">
                <i data-lucide="plus" class="lucide-sm"></i>
              </button>
            </div>
          ` : `
            <div></div>
          `}

          <button class="btn btn-primary btn-add-prod" data-id="${p.id}" style="padding: 0.45rem 0.9rem; font-size: 0.8rem;">
            <i data-lucide="plus" class="lucide-sm"></i>
            ${inCart ? 'Añadir más' : 'Agregar'}
          </button>
        </div>
      </div>
    `;
  };

  const renderUI = () => {
    // 1. Agrupamiento por categorías
    const categoriesMap = {};
    productos.forEach(p => {
      const cat = p.categoria || 'General';
      if (!categoriesMap[cat]) {
        categoriesMap[cat] = [];
      }
      categoriesMap[cat].push(p);
    });

    const categoryNames = Object.keys(categoriesMap);

    // 2. Determinar modo de vista actual
    const isSearching = searchTerm.trim().length > 0;
    
    // Si hay búsqueda activa, filtramos transversalmente
    let searchProducts = [];
    if (isSearching) {
      searchProducts = productos.filter(p => {
        return p.nombre.toLowerCase().includes(searchTerm.toLowerCase()) || 
               (p.descripcion && p.descripcion.toLowerCase().includes(searchTerm.toLowerCase())) ||
               p.categoria.toLowerCase().includes(searchTerm.toLowerCase());
      });
    }

    const totalCart = updateCartTotals();
    const countItems = cart.reduce((acc, i) => acc + i.cantidad, 0);

    // Header superior reutilizable
    const headerHtml = `
      <header style="background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid var(--border-subtle); padding: 2rem 1.25rem 1.5rem 1.25rem;">
        <div style="max-width: 900px; margin: 0 auto;">
          
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              <div style="width: 54px; height: 54px; border-radius: var(--radius-lg); background: var(--accent); color: #0b1120; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-glow);">
                <i data-lucide="store" class="lucide-lg"></i>
              </div>
              <div>
                <h1 style="font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em; color: var(--text-primary);">${store.nombre}</h1>
                <p style="color: var(--text-secondary); font-size: 0.875rem;">${store.descripcion || 'Especialidades culinarias y delivery'}</p>
              </div>
            </div>

            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span class="badge badge-active">
                <i data-lucide="check-circle" class="lucide-sm"></i>
                Abierto
              </span>
              <a href="?owner=${store.slug}" class="btn-icon" title="Acceso Propietario">
                <i data-lucide="lock" class="lucide-sm"></i>
              </a>
            </div>
          </div>

          <!-- Buscador Dinámico -->
          <div style="position: relative; margin-top: 1.5rem;">
            <i data-lucide="search" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-muted); width: 1.1rem; height: 1.1rem;"></i>
            <input id="input-search" class="input-field" type="text" placeholder="Buscar por plato, ingrediente o categoría..." value="${searchTerm}" style="padding-left: 2.75rem; border-radius: var(--radius-full); background: rgba(11, 17, 32, 0.7); backdrop-filter: blur(8px);">
            ${isSearching ? `
              <button id="btn-clear-search" style="position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; padding: 0.25rem;">
                <i data-lucide="x" class="lucide-sm"></i>
              </button>
            ` : ''}
          </div>

          <!-- Banner de Promociones / Ofertas del Día -->
          ${store.promo_activa && store.promo_texto ? `
            <div class="animate-fade-in" style="
              margin-top: 1.25rem;
              background: linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(239, 68, 68, 0.2) 100%);
              border: 1px solid rgba(245, 158, 11, 0.5);
              border-radius: var(--radius-lg);
              padding: 0.85rem 1.2rem;
              display: flex;
              align-items: center;
              gap: 0.75rem;
              box-shadow: 0 4px 15px rgba(245, 158, 11, 0.15);
            ">
              <div style="
                background: var(--accent);
                color: #0b1120;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                font-weight: 800;
              ">
                <i data-lucide="flame" class="lucide-sm"></i>
              </div>
              <div style="flex: 1;">
                <span style="font-size: 0.7rem; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; color: var(--accent); display: block; margin-bottom: 0.1rem;">Oferta Especial</span>
                <p style="font-size: 0.875rem; font-weight: 600; color: #fff; line-height: 1.35;">${store.promo_texto}</p>
              </div>
            </div>
          ` : ''}

        </div>
      </header>
    `;

    // 3. Renderizar Contenido Principal según Estado
    let mainContentHtml = '';

    if (isSearching) {
      // Vista temporal: Resultados de búsqueda
      mainContentHtml = `
        <main class="animate-fade-in" style="max-width: 900px; margin: 1.5rem auto 0 auto; padding: 0 1.25rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
            <div>
              <h2 style="font-size: 1.2rem; font-weight: 700; color: var(--text-primary);">Resultados de búsqueda</h2>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">Para "${searchTerm}"</p>
            </div>
            <span style="font-size: 0.85rem; color: var(--text-muted); background: var(--bg-card); padding: 0.3rem 0.75rem; border-radius: var(--radius-full); border: 1px solid var(--border-subtle);">
              ${searchProducts.length} ${searchProducts.length === 1 ? 'producto' : 'productos'}
            </span>
          </div>

          ${searchProducts.length === 0 ? `
            <div class="card" style="text-align: center; padding: 4rem 1.5rem; border-radius: var(--radius-xl);">
              <i data-lucide="search-x" class="lucide-xl" style="color: var(--text-muted); opacity: 0.4; margin-bottom: 0.75rem;"></i>
              <h3 style="font-size: 1.1rem; font-weight: 600;">No encontramos platos coincidentes</h3>
              <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.25rem;">Intenta con otro término o borra la búsqueda para ver el menú completo.</p>
              <button id="btn-reset-search-empty" class="btn btn-secondary" style="margin-top: 1rem;">
                Limpiar búsqueda
              </button>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
              ${searchProducts.map(p => renderProductCard(p)).join('')}
            </div>
          `}
        </main>
      `;
    } else if (!categoriaSeleccionada) {
      // VISTA 1: Nivel Categorías (Cards Grid)
      mainContentHtml = `
        <main class="animate-fade-in" style="max-width: 900px; margin: 1.75rem auto 0 auto; padding: 0 1.25rem;">
          
          <div style="margin-bottom: 1.5rem;">
            <h2 style="font-size: 1.35rem; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em;">Nuestra Carta</h2>
            <p style="color: var(--text-secondary); font-size: 0.875rem; margin-top: 0.25rem;">Selecciona una categoría para explorar nuestros platos y especialidades</p>
          </div>

          ${categoryNames.length === 0 ? `
            <div class="card" style="text-align: center; padding: 4rem 1.5rem; border-radius: var(--radius-xl);">
              <i data-lucide="utensils" class="lucide-xl" style="color: var(--text-muted); opacity: 0.4; margin-bottom: 0.75rem;"></i>
              <h3 style="font-size: 1.1rem; font-weight: 600;">No hay categorías registradas</h3>
              <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.25rem;">El comercio aún no ha cargado platos en su carta.</p>
            </div>
          ` : `
            <!-- Grid de Categorías (2 cols móvil, 3-4 en desktop) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.25rem;">
              ${categoryNames.map(cat => {
                const prodsInCat = categoriesMap[cat] || [];
                // Tomar la imagen del primer producto con foto válida
                const prodWithImg = prodsInCat.find(p => p.imagen_url);
                const coverImg = prodWithImg ? prodWithImg.imagen_url : null;
                const count = prodsInCat.length;

                return `
                  <div class="category-card" data-category="${cat}">
                    <!-- Banner de Portada de Categoría -->
                    <div style="width: 100%; aspect-ratio: 16 / 10; position: relative; background: #0f172a; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                      ${coverImg ? `
                        <img 
                          src="${coverImg}" 
                          alt="${cat}" 
                          loading="lazy" 
                          style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.4s ease;"
                          class="cat-cover-img"
                          onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';"
                        >
                        <div style="display: none; width: 100%; height: 100%; align-items: center; justify-content: center; background: radial-gradient(circle at center, rgba(245, 158, 11, 0.15) 0%, #0f172a 100%);">
                          <i data-lucide="utensils" class="lucide-xl" style="color: var(--accent); opacity: 0.8;"></i>
                        </div>
                      ` : `
                        <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at center, rgba(245, 158, 11, 0.15) 0%, #0f172a 100%);">
                          <i data-lucide="utensils" class="lucide-xl" style="color: var(--accent); opacity: 0.8;"></i>
                        </div>
                      `}
                      <!-- Gradiente inferior para legibilidad -->
                      <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(15, 23, 42, 0.1) 0%, rgba(15, 23, 42, 0.7) 100%); pointer-events: none;"></div>
                      
                      <!-- Badge con conteo en esquina -->
                      <span style="
                        position: absolute; 
                        top: 0.75rem; 
                        right: 0.75rem; 
                        background: rgba(11, 17, 32, 0.75); 
                        backdrop-filter: blur(8px); 
                        color: var(--text-primary); 
                        font-size: 0.725rem; 
                        font-weight: 700; 
                        padding: 0.25rem 0.6rem; 
                        border-radius: var(--radius-full); 
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                      ">
                        ${count} ${count === 1 ? 'plato' : 'productos'}
                      </span>
                    </div>

                    <!-- Info de la Categoría -->
                    <div style="padding: 1rem 1.15rem; display: flex; justify-content: space-between; align-items: center; background-color: var(--bg-card); flex: 1;">
                      <div>
                        <h3 style="font-weight: 700; font-size: 1.05rem; color: var(--text-primary);">${cat}</h3>
                        <p style="font-size: 0.775rem; color: var(--text-secondary); margin-top: 0.15rem;">Ver opciones disponibles</p>
                      </div>
                      <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; color: var(--accent); border: 1px solid var(--border-subtle);">
                        <i data-lucide="chevron-right" class="lucide-sm"></i>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </main>
      `;
    } else {
      // VISTA 2: Nivel Productos de la Categoría Seleccionada
      const prodsInCat = categoriesMap[categoriaSeleccionada] || [];

      mainContentHtml = `
        <main class="animate-fade-in" style="max-width: 900px; margin: 1.5rem auto 0 auto; padding: 0 1.25rem;">
          
          <!-- Barra superior contextual de navegación -->
          <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; background: var(--bg-card); padding: 1.15rem 1.25rem; border-radius: var(--radius-xl); border: 1px solid var(--border-subtle);">
            
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <button id="btn-back-categories" class="btn btn-secondary" style="padding: 0.45rem 0.9rem; font-size: 0.85rem; border-radius: var(--radius-full);">
                <i data-lucide="arrow-left" class="lucide-sm"></i>
                Volver a Categorías
              </button>
              
              <span style="font-size: 0.8rem; color: var(--accent); font-weight: 700; background: var(--accent-light); padding: 0.25rem 0.65rem; border-radius: var(--radius-full); border: 1px solid rgba(245, 158, 11, 0.25);">
                ${prodsInCat.length} ${prodsInCat.length === 1 ? 'disponible' : 'disponibles'}
              </span>
            </div>

            <div style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
              <h2 style="font-size: 1.4rem; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em;">${categoriaSeleccionada}</h2>
              <p style="color: var(--text-secondary); font-size: 0.825rem; margin-top: 0.15rem;">Explora los platos disponibles en esta sección</p>
            </div>

          </div>

          <!-- Cuadrícula de Platos -->
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem;">
            ${prodsInCat.length === 0 ? `
              <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 4rem 1.5rem; border-radius: var(--radius-xl);">
                <i data-lucide="utensils" class="lucide-xl" style="color: var(--text-muted); opacity: 0.4; margin-bottom: 0.75rem;"></i>
                <h3 style="font-size: 1.1rem; font-weight: 600;">No hay productos en esta categoría</h3>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 0.25rem;">Regresa para explorar otras opciones en nuestra carta.</p>
                <button id="btn-back-empty" class="btn btn-primary" style="margin-top: 1rem;">
                  <i data-lucide="arrow-left"></i>
                  Volver a Categorías
                </button>
              </div>
            ` : prodsInCat.map(p => renderProductCard(p)).join('')}
          </div>

        </main>
      `;
    }

    container.innerHTML = `
      <div style="min-height: 100vh; padding-bottom: ${cart.length > 0 ? '6.5rem' : '2rem'}; background-color: var(--bg-primary);">
        
        ${headerHtml}
        ${mainContentHtml}

        <!-- Barra Flotante de Carrito / Checkout -->
        ${cart.length > 0 ? `
          <div style="
            position: fixed;
            bottom: 1rem;
            left: 1rem;
            right: 1rem;
            max-width: 600px;
            margin: 0 auto;
            background: #f59e0b;
            color: #0b1120;
            border-radius: var(--radius-xl);
            padding: 0.85rem 1.25rem;
            box-shadow: var(--shadow-lg), 0 0 25px rgba(245, 158, 11, 0.4);
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 100;
            cursor: pointer;
            transition: transform 0.15s ease;
          " id="btn-open-cart">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <div style="background: rgba(11, 17, 32, 0.15); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800;">
                ${countItems}
              </div>
              <div>
                <p style="font-weight: 800; font-size: 0.95rem; line-height: 1.1;">Ver Pedido</p>
                <p style="font-size: 0.75rem; font-weight: 600; opacity: 0.85;">${countItems} ${countItems === 1 ? 'producto' : 'productos'}</p>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span style="font-size: 1.2rem; font-weight: 900;">$${totalCart.toLocaleString('es-AR')}</span>
              <i data-lucide="chevron-right" class="lucide"></i>
            </div>
          </div>
        ` : ''}

        <!-- Modal de Pedido / Checkout -->
        ${orderModalOpen ? `
          <div class="modal-overlay" id="checkout-modal">
            <div class="modal-content" style="max-width: 550px;">
              
              <div style="padding: 1.25rem; border-bottom: 1px solid var(--border-default); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <i data-lucide="shopping-bag" style="color: var(--accent);"></i>
                  <h3 style="font-weight: 800; font-size: 1.15rem;">Confirmar Pedido</h3>
                </div>
                <button id="btn-close-checkout" class="btn-icon" style="border: none;">
                  <i data-lucide="x"></i>
                </button>
              </div>

              <!-- Resumen de productos en Modal -->
              <div style="padding: 1.25rem; border-bottom: 1px solid var(--border-subtle); background: var(--bg-primary); max-height: 180px; overflow-y: auto;">
                <p style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 0.6rem;">Items Seleccionados</p>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                  ${cart.map(item => `
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                      <span><strong>${item.cantidad}x</strong> ${item.nombre}</span>
                      <span style="color: var(--accent); font-weight: 700;">$${(item.precio * item.cantidad).toLocaleString('es-AR')}</span>
                    </div>
                  `).join('')}
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 1.05rem; font-weight: 800; border-top: 1px dashed var(--border-default); margin-top: 0.75rem; padding-top: 0.75rem;">
                  <span>Total</span>
                  <span style="color: var(--accent);">$${totalCart.toLocaleString('es-AR')}</span>
                </div>
              </div>

              <!-- Formulario de Entrega & Pago -->
              <form id="form-submit-order" style="padding: 1.25rem; display: flex; flex-direction: column; gap: 1.2rem;">
                
                <!-- Selector de Modalidad -->
                <div>
                  <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Modalidad de entrega *</label>
                  <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem;">
                    
                    <button type="button" class="btn btn-modalidad ${orderData.modalidad === 'delivery' ? 'btn-primary' : 'btn-secondary'}" data-mod="delivery" style="font-size: 0.8rem; padding: 0.6rem 0.3rem;">
                      <i data-lucide="bike" class="lucide-sm"></i>
                      Delivery
                    </button>

                    <button type="button" class="btn btn-modalidad ${orderData.modalidad === 'retiro' ? 'btn-primary' : 'btn-secondary'}" data-mod="retiro" style="font-size: 0.8rem; padding: 0.6rem 0.3rem;">
                      <i data-lucide="store" class="lucide-sm"></i>
                      Retiro Local
                    </button>

                    <button type="button" class="btn btn-modalidad ${orderData.modalidad === 'mesa' ? 'btn-primary' : 'btn-secondary'}" data-mod="mesa" style="font-size: 0.8rem; padding: 0.6rem 0.3rem;">
                      <i data-lucide="utensils" class="lucide-sm"></i>
                      En Mesa
                    </button>

                  </div>
                </div>

                <!-- Campos de Cliente -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                  <div>
                    <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Tu Nombre *</label>
                    <input class="input-field" type="text" name="nombre" required placeholder="Ej: Mateo Díaz" value="${orderData.nombre}">
                  </div>
                  <div>
                    <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Teléfono / WhatsApp *</label>
                    <input class="input-field" type="tel" name="telefono" required placeholder="54911xxxxxxxx" value="${orderData.telefono}">
                  </div>
                </div>

                <!-- Campos condicionales por Modalidad -->
                ${orderData.modalidad === 'delivery' ? `
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                      <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">Dirección exacta de entrega *</label>
                      <button type="button" id="btn-get-gps" class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                        <i data-lucide="map-pin" class="lucide-sm"></i>
                        Ubicar con GPS
                      </button>
                    </div>
                    <input class="input-field" type="text" name="direccion" required placeholder="Calle, número, piso o depto..." value="${orderData.direccion}">
                    <div id="gps-status" style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;"></div>
                  </div>
                ` : ''}

                ${orderData.modalidad === 'mesa' ? `
                  <div>
                    <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Número de Mesa *</label>
                    <input class="input-field" type="number" name="mesa" required placeholder="Ej: Mesa 4" value="${orderData.mesaNumero}">
                  </div>
                ` : ''}

                <!-- Método de Pago -->
                <div>
                  <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">Forma de Pago *</label>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                    
                    <label style="
                      display: flex; align-items: center; gap: 0.6rem; padding: 0.75rem; border-radius: var(--radius-md);
                      border: 1px solid ${orderData.metodoPago === 'efectivo' ? 'var(--accent)' : 'var(--border-default)'};
                      background: ${orderData.metodoPago === 'efectivo' ? 'var(--accent-light)' : 'var(--bg-primary)'};
                      cursor: pointer;
                    ">
                      <input type="radio" name="metodo_pago" value="efectivo" ${orderData.metodoPago === 'efectivo' ? 'checked' : ''} style="accent-color: var(--accent);">
                      <i data-lucide="banknote" class="lucide-sm" style="color: var(--accent);"></i>
                      <span style="font-size: 0.85rem; font-weight: 600;">Efectivo</span>
                    </label>

                    <label style="
                      display: flex; align-items: center; gap: 0.6rem; padding: 0.75rem; border-radius: var(--radius-md);
                      border: 1px solid ${orderData.metodoPago === 'transferencia' ? 'var(--accent)' : 'var(--border-default)'};
                      background: ${orderData.metodoPago === 'transferencia' ? 'var(--accent-light)' : 'var(--bg-primary)'};
                      cursor: pointer;
                    ">
                      <input type="radio" name="metodo_pago" value="transferencia" ${orderData.metodoPago === 'transferencia' ? 'checked' : ''} style="accent-color: var(--accent);">
                      <i data-lucide="credit-card" class="lucide-sm" style="color: var(--accent);"></i>
                      <span style="font-size: 0.85rem; font-weight: 600;">Transferencia</span>
                    </label>

                  </div>
                </div>

                <!-- Aclaraciones -->
                <div>
                  <label style="display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.35rem;">Notas adicionales para la cocina</label>
                  <input class="input-field" type="text" name="notas" placeholder="Ej: Sin cebolla, aderezo aparte, timbre roto..." value="${orderData.notas}">
                </div>

                <!-- Enviar Pedido -->
                <div style="border-top: 1px solid var(--border-default); padding-top: 1rem; display: flex; gap: 0.75rem;">
                  <button type="button" id="btn-cancel-checkout" class="btn btn-secondary" style="flex: 1;">Volver</button>
                  <button type="submit" class="btn btn-primary" style="flex: 2; padding: 0.85rem; font-size: 0.95rem;">
                    <i data-lucide="send"></i>
                    Pedir por WhatsApp
                  </button>
                </div>

              </form>

            </div>
          </div>
        ` : ''}

      </div>
    `;

    // 4. Asignación de Event Listeners
    const searchInput = document.getElementById('input-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value;
        renderUI();
        const reInput = document.getElementById('input-search');
        if (reInput) {
          reInput.focus();
          reInput.setSelectionRange(searchTerm.length, searchTerm.length);
        }
      });
    }

    document.getElementById('btn-clear-search')?.addEventListener('click', () => {
      searchTerm = '';
      renderUI();
    });

    document.getElementById('btn-reset-search-empty')?.addEventListener('click', () => {
      searchTerm = '';
      renderUI();
    });

    // Clic en Card de Categoría -> entra al detalle de la categoría con scroll suave
    document.querySelectorAll('.category-card').forEach(card => {
      card.addEventListener('click', () => {
        const cat = card.getAttribute('data-category');
        categoriaSeleccionada = cat;
        renderUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Botón Volver a Categorías
    const handleBackToCategories = () => {
      categoriaSeleccionada = null;
      renderUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    document.getElementById('btn-back-categories')?.addEventListener('click', handleBackToCategories);
    document.getElementById('btn-back-empty')?.addEventListener('click', handleBackToCategories);

    // Botones de Carrito / Producto
    document.querySelectorAll('.btn-add-prod').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-id')) || btn.getAttribute('data-id');
        const prod = productos.find(p => String(p.id) === String(id));
        if (prod) addToCart(prod);
      });
    });

    document.querySelectorAll('.btn-cart-inc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const prod = productos.find(p => String(p.id) === String(id));
        if (prod) addToCart(prod);
      });
    });

    document.querySelectorAll('.btn-cart-dec').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        removeFromCart(id);
      });
    });

    document.getElementById('btn-open-cart')?.addEventListener('click', () => {
      orderModalOpen = true;
      renderUI();
    });

    document.getElementById('btn-close-checkout')?.addEventListener('click', () => {
      orderModalOpen = false;
      renderUI();
    });
    document.getElementById('btn-cancel-checkout')?.addEventListener('click', () => {
      orderModalOpen = false;
      renderUI();
    });

    document.querySelectorAll('.btn-modalidad').forEach(btn => {
      btn.addEventListener('click', () => {
        orderData.modalidad = btn.getAttribute('data-mod');
        renderUI();
      });
    });

    document.querySelectorAll('input[name="metodo_pago"]').forEach(r => {
      r.addEventListener('change', (e) => {
        orderData.metodoPago = e.target.value;
        renderUI();
      });
    });

    document.getElementById('btn-get-gps')?.addEventListener('click', requestGPSLocation);
    document.getElementById('form-submit-order')?.addEventListener('submit', submitOrder);

    if (window.lucide) {
      window.lucide.createIcons();
    }
  };

  renderUI();
}
