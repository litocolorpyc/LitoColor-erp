import { loadAll } from './store.js';
import { initRegistrar } from './registrar.js';

document.getElementById('ayuda-toggle').addEventListener('click', () => {
  const box = document.getElementById('ayuda-box');
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
});

(async function init(){
  try{
    await loadAll();
  }catch(e){
    return;
  }
  initRegistrar();
})();
