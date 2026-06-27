-- ============================================================
-- LitoColor ERP — recuperar la máquina en el histórico migrado,
-- SOLO donde el área tiene una única máquina posible (sin adivinar)
-- ============================================================

update produccion set maquina = 'Guillotina'
  where area = 'Guillotina' and maquina is null;

update produccion set maquina = 'Engomadora'
  where area = 'Engomadora' and maquina is null;

update produccion set maquina = 'Troqueladora'
  where area = 'Troquelado' and maquina is null;

-- Litografía (GTO 525 / Adast Dominant 2), Plastificado (Laminadora /
-- Laminadora Manual) y Terminado (7 equipos distintos) se dejan igual
-- a propósito — el Excel original nunca registró cuál máquina
-- específica se usó ahí, así que no hay manera honesta de saberlo.
