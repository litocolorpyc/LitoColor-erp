import { loadAll } from './store.js';
import { initRegistrar } from './registrar.js';

(async function init(){
  try{
    await loadAll();
  }catch(e){
    return;
  }
  initRegistrar();
})();
