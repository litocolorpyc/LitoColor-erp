import { loadAll } from './store.js';
import { initRegistrar } from './registrar.js';
import { renderOrdenesVivas } from './ordenes.js';

(async function init(){
  try{
    await loadAll();
  }catch(e){
    return;
  }
  renderOrdenesVivas();
  initRegistrar(renderOrdenesVivas);
})();
