-- LitoColor ERP — módulo de Inventario completo (pedido del 02sep26):
-- Inventario Físico (conteo), Ajustes de inventario, y que el Kardex
-- (Movimientos de inventario, ver js/inventario.js) también muestre estos
-- ajustes junto a las entradas (compras) y salidas (consumo de producción)
-- que ya tenía.
--
-- Hasta ahora, corregir el "Stock actual" de un material solo se podía
-- hacer editándolo directo en Maestros > "Materias primas"/"Materiales por
-- área" — un cambio silencioso, sin motivo ni rastro, que no quedaba en
-- ningún reporte. Esta tabla es el registro de auditoría de esos cambios:
-- cada fila es UN ajuste (manual, puntual) o UNA línea de un conteo físico
-- completo, con motivo y quién lo hizo.
create table if not exists inventario_ajustes (
  id bigint generated always as identity primary key,
  fecha date not null,
  material_tabla text not null check (material_tabla in ('materias_primas','insumos_area')),
  material_key text not null,  -- codigo (materias_primas) o id (insumos_area), como texto — mismo criterio que recibos_caja_items
  codigo text,
  nombre text not null,
  tipo text not null default 'ajuste' check (tipo in ('ajuste','fisico')), -- 'fisico' = línea de un conteo de Inventario físico
  stock_anterior numeric not null,
  stock_nuevo numeric not null,
  cantidad numeric not null,        -- stock_nuevo - stock_anterior, con signo (positivo = entrada, negativo = salida)
  costo_unitario numeric,
  valor numeric,                    -- cantidad * costo_unitario, con signo (para que sea coherente en reportes)
  motivo text not null,
  usuario text,
  creado_en timestamptz default now()
);

create index if not exists idx_inventario_ajustes_fecha on inventario_ajustes (fecha);
create index if not exists idx_inventario_ajustes_material on inventario_ajustes (material_tabla, material_key);

alter table inventario_ajustes enable row level security;
drop policy if exists "lectura publica inventario_ajustes" on inventario_ajustes;
create policy "lectura publica inventario_ajustes" on inventario_ajustes for select using (true);
drop policy if exists "insertar inventario_ajustes" on inventario_ajustes;
create policy "insertar inventario_ajustes" on inventario_ajustes for insert with check (auth.uid() is not null);
drop policy if exists "actualizar inventario_ajustes" on inventario_ajustes;
create policy "actualizar inventario_ajustes" on inventario_ajustes for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "borrar inventario_ajustes" on inventario_ajustes;
create policy "borrar inventario_ajustes" on inventario_ajustes for delete using (auth.uid() is not null);
