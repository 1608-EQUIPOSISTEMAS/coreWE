# IA local (Ollama) en el ERP

Modelo: `qwen2.5:7b-instruct` nativo en el host (systemd), ~5 tokens/s en CPU,
atiende de a una petición. Por eso **nada espera al modelo en pantalla**: todo
se precalcula de madrugada o se genera en segundo plano y la pantalla lee de
una tabla. Todas las llamadas pasan por una fila en serie
(`shared/adapters/llm/ollama.adapter.js`).

Criterio común: **las reglas deciden, el modelo solo redacta.** Prioridades,
cifras y semáforos salen de código probado; el 7B inventa si se le deja decidir.

## Qué hace y para quién

| Función | Colaborador | Líder | Dónde |
|---|---|---|---|
| Plan del día · Comercial | sus 5 consultas priorizadas + borrador de WhatsApp + enfoque | plan de cada asesor + nota por persona + resumen del equipo | Panel (Dashboard) |
| Plan del día · FICO / Académica / Producto | qué atender primero hoy + pendientes del área | resumen del área + tarjetas + los mismos pendientes para repartir | Panel (Dashboard) |
| Resumen del lead | retomar la conversación sin leer intento por intento | revisar el lead de un asesor en 10 s | Ficha del lead, sobre "Intentos de contacto" |
| Nota del ticket | qué dato agregar para que lo atiendan sin ida y vuelta | resumen + borrador de primera respuesta ("Usar como respuesta") | Detalle del ticket |

B2B y Fundación tienen plan definido pero no van por defecto (su panel no tiene
lista de trabajo). Marketing no tiene líder ni panel de resultados en el
organigrama: hay que definir sus indicadores antes.

## Encender en producción (en este orden)

1. **Tablas** (idempotente): `psql ... -f scripts/ddl-ai-local.sql`
2. **Variables** en `docker-compose.yml` → servicio `weapp-backend` → `environment`
   (todas APAGADAS por defecto; se pueden encender de a una):

   ```yaml
   - AI_DAILY_PLAN_ENABLED=true            # cron 6:30 Lima lun-sáb + catch-up al arrancar
   - AI_DAILY_PLAN_AREAS=COMERCIAL,FICO,ACADEMICA,PRODUCTO   # opcional (este es el default)
   - AI_LEAD_SUMMARY=true                  # resumen del lead al abrir la ficha
   - AI_LEAD_SUMMARY_PREWARM=true          # cron 5:45: leads movidos ayer
   - AI_LEAD_SUMMARY_PREWARM_LIMIT=40      # tope por noche (~40 min a ~60 s c/u)
   - AI_TICKET_NOTES=true                  # nota al crear ticket / al abrir uno viejo
   ```
3. Merge de `feat/ia-local` a `PROD` en backend y frontend, y `deploy.sh`.

Apagar = quitar la variable y reiniciar el backend. Las pantallas se ocultan
solas cuando la IA está apagada (`estado: 'apagado'`).

## Tiempos medidos (22-sep-2026, copia de la BD, modelo con 6 hilos)

- Área (FICO/Académica/Producto): ~70 s por redacción, 2 por área → ~7 min las tres.
- Resumen de lead: ~55 s la primera vez; después instantáneo hasta que haya un intento nuevo.
- Nota de ticket: ~40 s.
- Comercial: ~2.7 min por asesor (hasta 5 borradores de WhatsApp + 2 notas);
  con los 3 asesores activos de hoy, 491 s.
- Corrida completa de madrugada (Comercial + 3 áreas): ~15 min → a las 6:30
  arranca y a las ~6:45 está listo.

Calidad observada con el 7B: útil y con cifras reales, pero a veces confunde
"consultas" con "ventas" o generaliza ("confirmar el pago de las 5"). Por eso
cada texto dice "revísalo antes de usarlo". Un 14B mejoraría la redacción a
costa de ~2x tiempo (sigue entrando en la madrugada).

Todo comparte el mismo modelo: si el cron de madrugada está corriendo, un
resumen pedido a esa hora espera su turno (la pantalla lo dice: "en fila").

## Endpoints

- `POST /api/dashboard/daily-plan` `{ view_as? }` → plan que le toca a quien pide.
- `POST /api/dashboard/daily-plan/regenerate` `{ view_as? }` → 202; solo líder del área o ADMIN.
- `POST /api/comercial/leadsummary` `{ id }` → `listo | generando | error | sin_intentos | apagado`.
- `POST /api/tickets/ai-note` `{ ticket_id }` → `listo | generando | error | sin_nota | apagado`.

## Comparación 7B vs 14B (22-sep-2026, 23 prompts reales, 6 hilos)

| | 7B (`qwen2.5:7b-instruct`) | 14B (`qwen2.5:14b-instruct`) |
|---|---|---|
| Tiempo medio por respuesta | 26 s | 80 s (≈3x) |
| Velocidad | 5.2 tok/s | 2.7 tok/s |
| RAM / disco | 5 GB / 4.7 GB | 10 GB / 9 GB |
| Respuestas válidas (pasan el parser) | 23/23 | 23/23 |
| Cifras inventadas | 2 ("130 consultas vendidas", "6.6%") | 1 (meta "20 de 110" inventada) |

Dónde gana el 14B: borradores de WhatsApp (el 7B escribió "confirmar que
recibimos su pago" a alguien que aún no paga), tickets (pide el dato correcto:
curso/alumno en un error de matrícula; detecta un ticket vago) y no confunde
consultas con ventas. Dónde no: sigue inventando metas ("contactar 30 de 151")
y a veces plazos ("inician en 14 días" cuando eran 4).

Recomendación: 14B para lo que corre de madrugada (plan del día: ~45 min en vez
de ~15, nadie espera) y 7B para lo que se pide en pantalla (resumen de lead).
