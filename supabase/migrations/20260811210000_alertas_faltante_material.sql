-- LitoColor ERP — alertas de faltante de materia prima al crear una orden
-- (pedido del 11ago26)
--
-- Ya existía un aviso puntual (alert() emergente) al guardar una orden si
-- el papel necesario no alcanzaba con el stock — pero se perdía apenas se
-- cerraba el mensaje. Ahora queda guardado: aparece en Alertas y sigue
-- visible hasta que se repone el stock de esa materia prima (ver
-- js/ordenes.js saveOpp/registrarAlertasFaltante, y js/maestros.js
-- materiasCtl, que la resuelve sola al guardar un stock_actual suficiente).
create table if not exists alertas_faltante_material (
  id serial primary key,
  orden int not null,
  materia_prima_codigo text not null references materias_primas(codigo) on delete cascade,
  cantidad_faltante numeric not null,
  unidad text,
  resuelta boolean default false,
  creada_en timestamptz default now(),
  resuelta_en timestamptz,
  unique (orden, materia_prima_codigo)
);

alter table alertas_faltante_material enable row level security;
drop policy if exists "lectura publica alertas_faltante_material" on alertas_faltante_material;
create policy "lectura publica alertas_faltante_material" on alertas_faltante_material for select using (true);
drop policy if exists "insertar alertas_faltante_material" on alertas_faltante_material;
create policy "insertar alertas_faltante_material" on alertas_faltante_material for insert with check (auth.uid() is not null);
drop policy if exists "actualizar alertas_faltante_material" on alertas_faltante_material;
create policy "actualizar alertas_faltante_material" on alertas_faltante_material for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar alertas_faltante_material" on alertas_faltante_material;
create policy "borrar alertas_faltante_material" on alertas_faltante_material for delete using (auth.uid() is not null);
