import { DB } from './store.js';
import { estadoOrden } from './ordenes.js';
import { fmtNum } from './helpers.js';

function diasDesde(fechaStr){
  if(!fechaStr) return null;
  const ms = Date.now() - new Date(fechaStr + 'T00:00:00').getTime();
  return Math.floor(ms / 86400000);
}
function horasDesde(fechaStr, horaStr){
  if(!fechaStr || !horaStr) return null;
  const ms = Date.now() - new Date(fechaStr + 'T' + horaStr).getTime();
  return ms / 3600000;
}

function calcularAlertas(){
  const alertas = [];

  // A) órdenes activas sin movimiento en 3+ días
  // Si la orden ya tiene el 100% de sus procesos completados, no está
  // "sin movimiento" — está terminada y solo falta que Gerencia la cierre
  // (ver caso real: orden 5968, ya finalizada, generaba esta alerta igual).
  DB.opp_ordenes.filter(o => o.estado === 'Activa' && estadoOrden(o).pct !== 100).forEach(o => {
    const recs = DB.produccion.filter(r => r.orden === o.orden);
    const ultimaFecha = recs.reduce((max, r) => (!max || (r.fecha && r.fecha > max)) ? r.fecha : max, o.fecha);
    const dias = diasDesde(ultimaFecha);
    if(dias !== null && dias >= 3){
      alertas.push({
        severidad: dias >= 6 ? 'alta' : 'media',
        icono: '⏳',
        mensaje: `La orden <b>${o.orden}</b> (${o.cliente || 'sin cliente'}) lleva <b>${dias} días</b> sin movimiento.`
      });
    }
  });

  // B) actividades en curso por más de 4 horas (probable olvido de
  // finalizar). Desde que un operario no puede tener dos actividades
  // corriendo a la vez, una de estas sesiones olvidadas le bloquea
  // CUALQUIER actividad nueva hasta que alguien la cierre — no es solo un
  // dato sucio, es un bloqueo real. Se corrige desde Operario > "Corregir
  // registro" (Jefe/Gerencia/Admin), poniéndola como terminada o pausada.
  DB.produccion.filter(r => !r.horaFin).forEach(r => {
    const horas = horasDesde(r.fecha, r.horaIni);
    if(horas !== null && horas >= 4){
      const opp = r.opp && /^\d+-\d+$/.test(r.opp) ? r.opp : (r.orden ?? 'general');
      const tiempoTxt = horas >= 48 ? `${Math.floor(horas/24)} días` : `${horas.toFixed(1)} h`;
      alertas.push({
        severidad: horas >= 8 ? 'alta' : 'media',
        icono: '⏱️',
        mensaje: `<b>${r.operario || 'Un operario'}</b> tiene una actividad abierta hace <b>${tiempoTxt}</b> sin finalizar (orden ${opp}, ${r.actividad || r.area || ''}) — mientras siga así, no puede iniciar ninguna otra actividad. Corrígela desde Operario &gt; "Corregir registro".`
      });
    }
  });

  // C) órdenes activas creadas hace más de 7 días, sin ningún proceso empezado
  DB.opp_ordenes.filter(o => o.estado === 'Activa').forEach(o => {
    const dias = diasDesde(o.fecha);
    const estado = estadoOrden(o);
    if(dias !== null && dias >= 7 && estado.label === 'Pendiente'){
      alertas.push({
        severidad: 'alta',
        icono: '🚨',
        mensaje: `La orden <b>${o.orden}</b> (${o.cliente || 'sin cliente'}) se creó hace <b>${dias} días</b> y todavía no tiene ningún proceso iniciado.`
      });
    }
  });

  // D) materia prima faltante para una orden — queda visible acá hasta
  // que se repone el stock de esa materia prima (ver js/ordenes.js,
  // alertarStockPapelInsuficiente, y js/maestros.js, materiasCtl).
  DB.alertas_faltante_material.forEach(a => {
    const o = DB.opp_ordenes.find(x => x.orden === a.orden);
    const mat = DB.materias_primas.find(m => m.codigo === a.materia_prima_codigo);
    alertas.push({
      severidad: 'alta',
      icono: '📦',
      mensaje: `La orden <b>${a.orden}</b> (${o?.cliente || 'sin cliente'}) necesita <b>${a.cantidad_faltante} ${a.unidad || ''}</b> más de <b>${mat?.nombre || a.materia_prima_codigo}</b> — falta reponer stock en Materias primas.`
    });
  });

  // E) stock en negativo — el consumo real de un operario puede superar el
  // stock cargado (es normal en litografía: se registra el consumo real
  // aunque la compra todavía no haya entrado, ver descontarInventarioY
  // CargarCosto en js/registrar.js). No se bloquea el registro, pero
  // tiene que quedar visible hasta que alguien cargue la compra.
  DB.materias_primas.filter(m => (m.stock_actual || 0) < 0).forEach(m => {
    alertas.push({
      severidad: 'alta',
      icono: '🔴',
      mensaje: `<b>${m.nombre}</b> quedó con stock <b>negativo (${fmtNum(m.stock_actual,2)} ${m.unidad || 'pliegos'})</b> — se consumió más de lo que había cargado. Carga la compra en Maestros &gt; Materias primas.`
    });
  });
  DB.insumos_area.filter(m => (m.stock_actual || 0) < 0).forEach(m => {
    alertas.push({
      severidad: 'alta',
      icono: '🔴',
      mensaje: `<b>${m.nombre}</b> (${m.area || 'sin área'}) quedó con stock <b>negativo (${fmtNum(m.stock_actual,2)} ${m.unidad || 'unidad'})</b> — se consumió más de lo que había cargado. Carga la compra en Maestros &gt; Materiales por área.`
    });
  });

  // F) materiales que SÍ se están consumiendo pero no tienen costo por
  // unidad configurado — el stock se descuenta igual, pero ese consumo
  // real no se refleja en los costos de la orden (Rentabilidad/Gerencial)
  // hasta que alguien le cargue un costo en Maestros. Sin esta alerta,
  // ese hueco en los costos podía pasar desapercibido — ver
  // descontarInventarioYCargarCosto en js/registrar.js.
  const nombresConsumidos = new Set(DB.produccion.map(r => r.materiaPrima).filter(Boolean));
  DB.materias_primas.filter(m => nombresConsumidos.has(m.nombre) && !m.costo_unitario).forEach(m => {
    alertas.push({
      severidad: 'media',
      icono: '💸',
      mensaje: `<b>${m.nombre}</b> se está registrando como consumo, pero no tiene <b>costo por unidad</b> configurado — ese gasto no está entrando a los costos de la orden. Cárgaselo en Maestros &gt; Materias primas.`
    });
  });
  DB.insumos_area.filter(m => nombresConsumidos.has(m.nombre) && !m.costo_unitario).forEach(m => {
    alertas.push({
      severidad: 'media',
      icono: '💸',
      mensaje: `<b>${m.nombre}</b> (${m.area || 'sin área'}) se está registrando como consumo, pero no tiene <b>costo por unidad</b> configurado — ese gasto no está entrando a los costos de la orden. Cárgaselo en Maestros &gt; Materiales por área.`
    });
  });

  // G) registros con "Insumo consumido" que no calza con ningún material
  // del catálogo (típico de usar "Otro / no está en la lista…" con un
  // nombre distinto al real) — no se descontó del inventario ni se
  // costeó nunca. Se corrige desde el Historial de la orden > "Ajustar".
  const nombresCatalogo = new Set([...DB.materias_primas.map(m=>m.nombre), ...DB.insumos_area.map(m=>m.nombre)]);
  DB.produccion.filter(r => r.materiaPrima && !nombresCatalogo.has(r.materiaPrima)).forEach(r => {
    alertas.push({
      severidad: 'media',
      icono: '❓',
      mensaje: `El registro de <b>${r.operario || 'un operario'}</b> en la orden <b>${r.orden ?? '—'}</b> (${(r.fecha||'').slice(0,10)}) anotó <b>"${r.materiaPrima}"</b> como insumo, que no existe igual en ningún maestro — no se descontó del inventario ni se costeó. Corrígelo desde el Historial de esa orden &gt; "Ajustar".`
    });
  });

  const peso = { alta: 0, media: 1 };
  alertas.sort((a,b) => peso[a.severidad] - peso[b.severidad]);
  return alertas;
}

export function renderAlertas(){
  const cont = document.getElementById('alertas-list');
  if(!cont) return;
  const alertas = calcularAlertas();
  cont.innerHTML = alertas.map(a => `<div class="alerta-card ${a.severidad}">
    <div class="alerta-icon">${a.icono}</div>
    <div class="alerta-msg">${a.mensaje}</div>
  </div>`).join('') || '<p class="card-hint">Sin alertas por ahora — todo en orden 🎉</p>';
}

export function initAlertas(){
  renderAlertas();
}
