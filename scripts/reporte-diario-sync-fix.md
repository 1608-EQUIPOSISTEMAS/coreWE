# Reporte Diario — por qué el sync dejó de pegar (04/08/2026)

Sheet "Reporte Diario" (`103ct6X7chcxAq3TY3F9BIPMp8UZwNpjgrZ_ECSLL8ak`), Apps Script bound
`1TgIGoULYeE9-t7nns4cYAmQhwVGt70-rwg72vEtYfB62ZJF7adRGEgrn`, función `sincronizarFuente`.

## Síntoma

`Fuente Estatico` congelada al 31/07 y agosto en S/.0 en toda la matriz, aunque la pestaña
AGOSTO del origen ya tenía 376 ventas. En el log, cada ciclo:

```
Snapshot incompleto (2856 filas vs 3849 ya pegadas). NO se toco Fuente Estatico.
```

## Causa raíz

Dos columnas auxiliares de `Fuente Estatico` se corrieron un lugar (alguien insertó una
columna en `R`): el monto en soles pasó de `R` a **`S`** y la categoría de `S` a **`T`**.
El script nunca se enteró:

| | esperaba | realidad |
|---|---|---|
| arrastre de fórmulas | `R1:S1` → cols 18-19 | debía ser `S1:T1` → cols 19-20 |
| limpieza de la cola | `clearContent` sobre 19 cols (`A:S`) | debía cubrir 20 (`A:T`) |

Consecuencia en cadena:

1. La columna `T` (categoría) quedaba **fuera** del arrastre y **fuera** de la limpieza.
2. Un arrastre manual viejo dejó fórmulas en `T` hasta la fila **3849**, con sólo 2.490
   filas de datos reales. Esas fórmulas devuelven texto aunque la fila esté vacía.
3. `dst.getLastRow()` cuenta cualquier celda con contenido → devolvía **3849**, no 2490.
4. La guarda `snapshotIncompleto` compara `origen (2856) < copia previa (3849)` → concluye
   "bloque truncado" y **omite el ciclo**. Como nada limpiaba `T`, el estado nunca se
   corregía solo: bloqueo permanente.

La guarda no estaba mal; le estaban dando una medida inflada de la copia anterior.

## Arreglo aplicado

1. `pegar()` arrastra `S1:T1` (cols 19-20) y limpia 20 columnas en lugar de 19.
2. Nueva `recortarCola(dst)`, llamada desde `sincronizarFuente` **antes** de leer
   `filasPrevias`: borra `A:T` por debajo de la última fila con fecha real en la col `B`.
   Hace el sistema auto-curativo ante cualquier fórmula arrastrada de más.

```js
function recortarCola(dst) {
  var maxFilas = dst.getMaxRows();
  var fechas = dst.getRange(1, 2, maxFilas, 1).getValues();
  var ultima = 0;
  for (var i = fechas.length - 1; i >= 0; i--) {
    if (fechas[i][0] !== '' && fechas[i][0] !== null) { ultima = i + 1; break; }
  }
  if (!ultima || dst.getLastRow() <= ultima) return 0;
  var sobran = maxFilas - ultima;
  dst.getRange(ultima + 1, 1, sobran, 20).clearContent();
  console.log('Cola recortada: se limpiaron ' + sobran + ' filas huerfanas debajo de la ' + ultima + '.');
  return sobran;
}
```

3. Se agregó `diagnostico()` (primera función del archivo, así queda preseleccionada en el
   selector del editor): compara Fuente Principal contra Fuente Estatico, dice en qué fila
   divergen y cuenta filas por mes a cada lado. Es lo que destapó el problema: mostró
   `Fuente Estatico por mes: {"2026-06":1281,"2026-07":1209,"?":1359}` — 1.359 filas sin
   fecha, o sea la cola fantasma de la columna `T`.

## Resultado tras correr `sincronizarFuente`

```
Cola recortada: se limpiaron 1359 filas huerfanas debajo de la 2490.
Copiadas 2858 filas. Celdas con error en el origen: 13 (#REF! en la col 12)
```

INGRESOS TOTALES: Junio 324.806,52 (1078) · Julio 370.812 (1063) · **Agosto 33.004 (116)**.

## Pendiente (del origen, no del script)

13 celdas con `#REF!` en la columna 12 (`L`, medio de pago) del archivo
"Ing. Operativos - GRUPO WE | 2026". Se copian tal cual a propósito: son dato malo del
origen, no una rotura, y no afectan monto ni categoría.

---

# El import se amplió a la columna R (10/08/2026)

El origen agregó una columna `R` = **`WE PLUS-DESC`**: marca la venta hecha con descuento de
membresía Plus. Va a la fila **"6. Programas con Dcto Membresias Plus"** de `Reporte Ingresos`
(clave `ENVIVO-DCTO PLUS`).

La fórmula de `Fuente Estatico!T` (categoría) **ya** contemplaba el caso desde antes:

```
IF(E1="EN VIVO"; IF(ISNUMBER(SEARCH("WE PLUS"; R1)); "ENVIVO-DCTO PLUS"; …
```

pero `R` llegaba siempre vacía porque el pipeline cortaba en `Q`. Resultado: la fila salía en
S/.0 aunque hubiera ventas.

## Qué se cambió

| Dónde | Antes | Ahora |
|---|---|---|
| `Fuente Principal!A1` (3 `IMPORTRANGE`) | `JUNIO/JULIO/AGOSTO!A30:Q3000` | `…!A30:R3000` |
| `Código.gs` — 4 llamadas a `getRange(1, 1, …, 17)` | `17` literal repetido | constante `COLUMNAS_DATOS = 18` |

El `17` estaba copiado en cuatro funciones (`diagnostico`, `sincronizarFuente`, `pegar`,
`forzarPegado`). Ese duplicado es la misma clase de bug que congeló el sync en agosto: se
reemplazó por una sola constante para que el ancho no pueda volver a divergir.

**Techo conocido:** `S` (monto en soles) y `T` (categoría) son columnas propias de
`Fuente Estatico`. Si el origen crece más allá de `R`, hay que correr `S` y `T` **antes** de
subir `COLUMNAS_DATOS`; si no, el pegado pisa la fórmula del monto. El comentario que está
sobre la constante dice esto mismo.

## Resultado tras correr `sincronizarFuente`

```
Copiadas 3054 filas. Celdas con error en el origen: 28 (#REF! en la col 12)
```

"6. Programas con Dcto Membresias Plus": Junio **S/.100** · Julio **S/.1.100** (antes S/.0 en
todos los meses). Agosto sigue en 0: el origen todavía no marca ventas con `WE PLUS-DESC` ese mes.

## `construirConsolidado()` estaba roto por el renombre de pestañas (arreglado el 10/08/2026)

Las pestañas se renombraron —`Ingresos Diarios` → **`Reporte Ingresos`** y `Consolidado Mensual`
→ **`Reporte Consolidado`**— y el script seguía buscando los nombres viejos:

- `bloqueUnidades()` filtraba por `/ingresos\s*diarios/i` → tiraba
  `Error: No encuentro la hoja Ingresos Diarios`.
- Fallaba **después** de `insertSheet('Consolidado Mensual')`, así que cada corrida dejaba una
  pestaña vacía que había que borrar a mano.

Las fórmulas del tablero nunca dejaron de funcionar (son `SUMIFS` sobre `Fuente Estatico`), o
sea se actualizaba solo; lo que no se podía era regenerarlo.

### Qué se cambió

- Nueva `hojaIngresos(ss)`: busca por **coincidencia parcial** (`/ingresos/i`) en vez de por el
  nombre completo, para que el próximo renombre no vuelva a romperlo.
- Nueva constante `TABLERO = 'Reporte Consolidado'`, usada en el `getSheetByName` y en el
  `insertSheet` (antes el literal estaba escrito dos veces).
- **El origen se resuelve ANTES del `deleteSheet`/`insertSheet`.** Ese era el defecto real: la
  validación iba después de la parte destructiva, por eso cada fallo dejaba basura.
- `bloqueUnidades(diario, FE, MES)` recibe la hoja ya resuelta en vez de volver a buscarla.

Corrida de verificación: `Consolidado listo. Metricas en filas 7-99, top en 102.` ·
Ingresos JUN 324.807 · JUL 379.991 · AGO 91.537 · TOTAL 796.335.

**Efecto colateral:** esa primera corrida se comió el logo WE que estaba insertado a mano en
`A1:A2`. Arreglado a continuación.

## El encabezado hecho a mano ahora sobrevive al rebuild

`construirConsolidado()` borra la pestaña y la crea de nuevo. Eso le da hoja limpia gratis (sin
merges viejos ni grupos de filas apilándose corrida tras corrida), pero se lleva puesto todo lo
hecho a mano. Reconstruir *en el sitio* evitaría la pérdida a cambio de desarmar merges, grupos
y filas ocultas una por una: mucho estado sutil que romper. Se eligió lo barato: **seguir
borrando, pero copiar el encabezado a la hoja nueva antes de tirar la vieja.**

El contrato quedó así:

| Filas | Manda |
|---|---|
| **1–3** | el equipo, a mano (logo, banda de título, leyenda) |
| **4** | el script (fechas, oculta) |
| **5 → fin** | el script (tablero completo) |

Cómo funciona (`FILAS_ENCABEZADO = 3`):

1. La hoja nueva se crea con nombre temporal `Reporte Consolidado (nuevo)`; la vieja **no** se
   borra todavía.
2. Se construye y formatea el tablero entero.
3. `adoptarEncabezado(vieja, nueva)` copia filas 1–3 (valores, formato y merges vía `copyTo`)
   + las alturas de fila. Va **después** de `formatearConsolidado`, así lo hecho a mano pisa lo
   que escribió el script y no hace falta ninguna bandera.
4. `copiarImagenes()` aparte: `copyTo` **no** arrastra las imágenes sobre la cuadrícula y el
   logo es una de ellas. Se reinsertan por `getBlob()` respetando ancla, offsets y tamaño.
5. Recién ahí se borra la vieja y la nueva se renombra a `Reporte Consolidado`.

Si la corrida se cae entre el paso 1 y el 5 queda una pestaña `Reporte Consolidado (nuevo)`
visible — a propósito: es ruidoso pero no destructivo, el tablero bueno sigue en su lugar.

**Verificado**: corrida del 10/08 con encabezado presente → filas 1–3 intactas, sin pestaña
`(nuevo)` colgada, mismos totales. La copia de **imágenes** todavía no se probó con una imagen
real (el logo ya no estaba cuando se corrió); conviene confirmarlo la próxima vez que haya una.
