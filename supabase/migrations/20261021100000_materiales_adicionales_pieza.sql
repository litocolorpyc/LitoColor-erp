-- Una pieza puede pedir más de un material (ej. 500 pliegos de Cote 60x90
-- + 100 pliegos de Cote 70x100). El papel principal sigue en `papel`;
-- los demás van aquí como [{"material":"...","cantidad":100}, ...].
alter table opp_piezas
  add column if not exists materiales_adicionales jsonb not null default '[]'::jsonb;
